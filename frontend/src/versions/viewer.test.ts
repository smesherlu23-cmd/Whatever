import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { api } from '../api';
import { Follow } from '../collab/follow';
import { Editor } from '../editor/Editor';
import { BoardDocument } from '../model/document';
import { DEFAULT_FILL, DEFAULT_PAGE, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { deferred } from '../testing/helpers';
import { participant, relay } from '../testing/peers';
import { version } from '../testing/versions';
import { VersionStore } from './store';
import { VersionViewer } from './viewer';

const MORNING = version('v1', new Date(2026, 10, 23, 9, 0).toISOString());
const NOON = version('v2', new Date(2026, 10, 23, 12, 0).toISOString(), { name: 'Обед' });

function box(id: string): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    page: DEFAULT_PAGE,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  };
}

/** Доска с фигурой a, в версии которой ещё нет фигуры b. */
function setup() {
  const me = participant('Борис');
  const live = new Editor(new BoardDocument(me.ydoc));
  live.setViewport({ width: 800, height: 600 });
  live.doc.add(box('a'));
  const content = Y.encodeStateAsUpdate(me.ydoc);
  live.doc.add(box('b'));
  const follow = new Follow(live, me.presence);
  const viewer = new VersionViewer(new VersionStore('b1'), live, follow);
  const versionState = vi.spyOn(api, 'versionState').mockResolvedValue(content);
  return { me, live, follow, viewer, versionState };
}

async function shown(viewer: VersionViewer) {
  await vi.waitFor(() => {
    expect(viewer.snapshot.opening).toBeNull();
  });
  return viewer.snapshot;
}

describe('VersionViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a version instead of the board and comes back to the same place', async () => {
    const { live, viewer, versionState } = setup();
    const listener = vi.fn();
    viewer.subscribe(listener);

    viewer.show(MORNING);
    expect(viewer.snapshot.opening).toBe(MORNING.id);
    const { preview } = await shown(viewer);
    expect(versionState).toHaveBeenCalledExactlyOnceWith(MORNING.id);
    expect(preview?.version).toBe(MORNING);
    expect(preview?.editor.readOnly).toBe(true);
    expect(preview?.editor.page.list().map((el) => el.id)).toEqual(['a']);
    expect(listener).toHaveBeenCalled();

    viewer.show(MORNING);
    expect(versionState).toHaveBeenCalledOnce();
    const moved = { x: 10, y: 20, zoom: 2 };
    preview?.editor.setCamera(moved);
    viewer.showCurrent();
    expect(viewer.snapshot.preview).toBeNull();
    expect(live.camera).toEqual(moved);
    expect(live.doc.has('b')).toBe(true);
  });

  it('shows only the version asked for last', async () => {
    const { viewer, versionState } = setup();
    const late = deferred<Uint8Array>();
    const content = await api.versionState(NOON.id);
    versionState.mockReturnValueOnce(late.promise);

    viewer.show(MORNING);
    viewer.show(NOON);
    expect((await shown(viewer)).preview?.version).toBe(NOON);
    late.resolve(content);
    await vi.waitFor(() => {
      expect(versionState.mock.settledResults[1]?.type).toBe('fulfilled');
    });
    expect(viewer.snapshot.preview?.version).toBe(NOON);
  });

  it('reports a version that could not be opened', async () => {
    const { viewer, versionState } = setup();
    versionState.mockRejectedValueOnce(new Error('offline'));
    viewer.show(MORNING);
    expect((await shown(viewer)).message).toEqual({
      text: 'Не удалось открыть версию. Проверьте связь с сервером.',
      error: true,
    });

    versionState.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    viewer.show(NOON);
    const state = await shown(viewer);
    expect(state.preview).toBeNull();
    expect(state.message?.error).toBe(true);
    viewer.dismissMessage();
    expect(viewer.snapshot.message).toBeNull();
  });

  it('saves the board as it is, then restores the version as one undoable change', async () => {
    const { live, viewer } = setup();
    const saveVersion = vi.spyOn(api, 'saveVersion').mockImplementation((_board, name) => {
      // Сохраняется то, что было на доске до восстановления.
      expect(live.doc.has('b')).toBe(true);
      return Promise.resolve(version('backup', MORNING.created_at, { name }));
    });
    viewer.show(MORNING);
    await shown(viewer);

    await viewer.restore();
    const backup = 'Перед восстановлением версии от 23 ноября 2026 г. в 09:00';
    expect(saveVersion).toHaveBeenCalledExactlyOnceWith('b1', backup);
    expect(live.doc.has('b')).toBe(false);
    expect(viewer.snapshot).toEqual({
      preview: null,
      opening: null,
      restoring: false,
      message: {
        error: false,
        text: `Версия восстановлена. То, что было на доске до этого, сохранено в истории как «${backup}».`,
      },
    });
    live.undo();
    expect(live.doc.has('b')).toBe(true);
  });

  it('leaves the board as it is when it could not be saved first', async () => {
    const { live, viewer } = setup();
    vi.spyOn(api, 'saveVersion').mockRejectedValue(new Error('offline'));
    viewer.show(MORNING);
    await shown(viewer);

    const restoring = viewer.restore();
    expect(viewer.snapshot.restoring).toBe(true);
    await restoring;
    expect(live.doc.has('b')).toBe(true);
    expect(viewer.snapshot.preview?.version).toBe(MORNING);
    expect(viewer.snapshot.restoring).toBe(false);
    expect(viewer.snapshot.message).toEqual({
      text: 'Не удалось восстановить версию. Проверьте связь с сервером.',
      error: true,
    });
  });

  it('restores nothing on a read-only board or when the history was closed meanwhile', async () => {
    const { live, viewer } = setup();
    const saved = deferred<ReturnType<typeof version>>();
    const saveVersion = vi.spyOn(api, 'saveVersion').mockReturnValue(saved.promise);
    viewer.show(MORNING);
    await shown(viewer);

    live.setReadOnly(true);
    await viewer.restore();
    expect(saveVersion).not.toHaveBeenCalled();
    expect(viewer.snapshot.message?.text).toBe(
      'Доску сейчас нельзя менять, поэтому версию не восстановить.',
    );

    live.setReadOnly(false);
    const restoring = viewer.restore();
    viewer.reset();
    saved.resolve(version('backup', MORNING.created_at, { name: 'Перед восстановлением' }));
    await restoring;
    expect(live.doc.has('b')).toBe(true);
    expect(viewer.snapshot.preview).toBeNull();
  });

  it('restores nothing if the board became read-only while it was being saved', async () => {
    const { live, viewer } = setup();
    const saved = deferred<ReturnType<typeof version>>();
    vi.spyOn(api, 'saveVersion').mockReturnValue(saved.promise);
    viewer.show(MORNING);
    await shown(viewer);

    const restoring = viewer.restore();
    live.setReadOnly(true);
    saved.resolve(version('backup', MORNING.created_at, { name: 'Перед восстановлением' }));
    await restoring;
    expect(live.doc.has('b')).toBe(true);
    expect(viewer.snapshot).toMatchObject({
      preview: { version: MORNING },
      restoring: false,
      message: { text: 'Доску сейчас нельзя менять, поэтому версию не восстановить.', error: true },
    });
  });

  it('shows the board again when following a participant and stops following for a version', async () => {
    const { me, viewer, follow } = setup();
    const stop = viewer.start();
    const alice = participant('Алиса');
    relay(alice, me);

    follow.start(alice.id);
    viewer.show(MORNING);
    expect(follow.leader).toBeNull();
    await shown(viewer);
    follow.start(alice.id);
    expect(viewer.snapshot.preview).toBeNull();
    stop();
  });

  it('deletes a version and shows the board again if it was that version', async () => {
    const { viewer } = setup();
    const deleteVersion = vi.spyOn(api, 'deleteVersion').mockResolvedValue();
    viewer.show(MORNING);
    await shown(viewer);

    await viewer.remove(NOON.id);
    expect(viewer.snapshot.preview?.version).toBe(MORNING);
    await viewer.remove(MORNING.id);
    expect(deleteVersion).toHaveBeenCalledTimes(2);
    expect(viewer.snapshot.preview).toBeNull();
  });
});
