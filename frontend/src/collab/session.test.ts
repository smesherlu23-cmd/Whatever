import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onSignedOut } from '../api';
import { FakeSocket, indexeddbStub } from '../testing/fakeSocket';
import { BoardSession } from './session';

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
