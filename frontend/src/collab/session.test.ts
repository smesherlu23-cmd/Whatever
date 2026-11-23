import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { onSignedOut } from '../api';
import { FakeSocket, indexeddbStub } from '../testing/fakeSocket';
import { stubServer } from '../testing/server';
import { BoardDocument } from '../model/document';
import { contains } from '../model/geometry';
import { DEFAULT_FILL, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { BoardSession, COMMENTS_CHANGED, VERSIONS_CHANGED } from './session';

function note(id: string, x: number, y: number): ShapeElement {
  return {
    id,
    kind: 'note',
    page: 'main',
    x,
    y,
    w: 160,
    h: 100,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  };
}

// В jsdom нет IndexedDB; локальная копия проверяется вручную в браузере.
vi.mock('y-indexeddb', () => import('../testing/fakeSocket').then((m) => m.indexeddbStub));

describe('BoardSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects to the board room and reports the connection status', () => {
    const session = new BoardSession('board-1', 'Анна');
    const stop = session.start();
    expect(FakeSocket.last().url).toMatch(/\/ws\/boards\/board-1$/);
    expect(session.status).toBe('connecting');

    FakeSocket.last().open();
    expect(session.status).toBe('connected');
    stop();
  });

  it('stays "disconnected" while it keeps reconnecting', () => {
    const session = new BoardSession('board-1', 'Анна');
    const stop = session.start();
    FakeSocket.last().open();
    FakeSocket.last().closeByServer(1006);
    expect(session.status).toBe('disconnected');

    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(session.status).toBe('disconnected');

    FakeSocket.last().open();
    expect(session.status).toBe('connected');
    stop();
  });

  it('stops reconnecting when the board does not exist', () => {
    const session = new BoardSession('missing', 'Анна');
    const listener = vi.fn();
    session.subscribe(listener);
    const stop = session.start();
    FakeSocket.last().closeByServer(4404);

    expect(session.status).toBe('not-found');
    expect(listener).toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    stop();
  });

  it('stops reconnecting and drops the local copy when access is revoked', () => {
    const session = new BoardSession('secret', 'Анна');
    const stop = session.start();
    FakeSocket.last().open();
    FakeSocket.last().closeByServer(4403);

    expect(session.status).toBe('forbidden');
    expect(indexeddbStub.IndexeddbPersistence.cleared).toContain('whatever-board-secret');
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    stop();
  });

  it('reconnects quietly when access changes', () => {
    const session = new BoardSession('board-1', 'Анна');
    const stop = session.start();
    FakeSocket.last().open();
    FakeSocket.last().closeByServer(4100);
    // Это не обрыв связи: «нет связи» пользователь не видит.
    expect(session.status).toBe('connecting');

    vi.advanceTimersByTime(1000);
    FakeSocket.last().open();
    expect(session.status).toBe('connected');
    FakeSocket.last().closeByServer(1006);
    expect(session.status).toBe('disconnected');
    stop();
  });

  it('reports a lost session and stops reconnecting', () => {
    const signedOut = vi.fn();
    const stopListening = onSignedOut(signedOut);
    const session = new BoardSession('board-1', 'Анна');
    const stop = session.start();
    FakeSocket.last().closeByServer(4401);

    expect(signedOut).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    stop();
    stopListening();
  });

  it('shows the content of the board once its local copy has loaded', () => {
    const session = new BoardSession('board-1', 'Анна');
    session.editor.setViewport({ width: 800, height: 600 });
    const stop = session.start();
    const copy = new BoardDocument();
    copy.add(note('far', 3000, 2000));
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(copy.doc));
    expect(session.editor.camera).toEqual({ x: 0, y: 0, zoom: 1 });

    indexeddbStub.IndexeddbPersistence.last?.load();
    const visible = session.editor.visibleArea();
    expect(visible && contains(visible, { x: 3000, y: 2000, w: 160, h: 100 })).toBe(true);
    stop();
  });

  it('keeps the camera the user has already moved', () => {
    const session = new BoardSession('board-1', 'Анна');
    session.editor.setViewport({ width: 800, height: 600 });
    const stop = session.start();
    session.editor.wheel({ x: 0, y: 0 }, 0, 100, false);
    const moved = session.editor.camera;
    const copy = new BoardDocument();
    copy.add(note('far', 3000, 2000));
    Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(copy.doc));

    indexeddbStub.IndexeddbPersistence.last?.load();
    expect(session.editor.camera).toBe(moved);
    stop();
  });

  it('reloads the discussions after each sync and when the server says they changed', async () => {
    const fetch = stubServer(() => Response.json([]));
    const session = new BoardSession('board-1', 'Анна');
    const stop = session.start();
    FakeSocket.last().open();
    expect(fetch).not.toHaveBeenCalled();

    // Ответ сервера на синхронизацию: шаг 2 протокола y-websocket с пустым обновлением.
    const update = Y.encodeStateAsUpdate(new Y.Doc());
    FakeSocket.last().receive(new Uint8Array([0, 1, update.length, ...update]));
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/boards/board-1/threads', expect.anything());
    await vi.waitFor(() => {
      expect(session.comments.snapshot.status).toBe('ready');
    });

    FakeSocket.last().receive(new Uint8Array([COMMENTS_CHANGED]));
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it('reloads the open history of versions when the server says it changed', async () => {
    const fetch = stubServer(() => Response.json([]));
    const session = new BoardSession('board-1', 'Анна');
    const stop = session.start();
    FakeSocket.last().open();
    FakeSocket.last().receive(new Uint8Array([VERSIONS_CHANGED]));
    expect(fetch).not.toHaveBeenCalled();

    const unwatch = session.versions.watch();
    await vi.waitFor(() => {
      expect(session.versions.snapshot.status).toBe('ready');
    });
    FakeSocket.last().receive(new Uint8Array([VERSIONS_CHANGED]));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('/api/boards/board-1/versions', expect.anything());
    unwatch();
    stop();
  });

  it('can be started again after it was stopped', () => {
    const session = new BoardSession('board-1', 'Анна');
    session.start()();
    const stop = session.start();
    FakeSocket.last().open();
    expect(session.status).toBe('connected');
    expect(FakeSocket.instances).toHaveLength(2);
    stop();
  });
});
