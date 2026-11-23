import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BoardVersion, api } from '../api';
import { deferred } from '../testing/helpers';
import { version } from '../testing/versions';
import { VersionStore } from './store';

const MORNING = version('v1', '2026-11-23T07:00:00Z');
const NOON = version('v2', '2026-11-23T09:00:00Z', { name: 'Перед релизом' });

describe('VersionStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the list while it is watched and only then follows the changes', async () => {
    const listVersions = vi.spyOn(api, 'listVersions').mockResolvedValue([MORNING]);
    const store = new VersionStore('b1');
    store.changed();
    expect(listVersions).not.toHaveBeenCalled();

    const unwatch = store.watch();
    expect(listVersions).toHaveBeenCalledExactlyOnceWith('b1');
    await vi.waitFor(() => {
      expect(store.snapshot).toEqual({ versions: [MORNING], status: 'ready' });
    });
    listVersions.mockResolvedValue([NOON, MORNING]);
    store.changed();
    await vi.waitFor(() => {
      expect(store.snapshot.versions).toEqual([NOON, MORNING]);
    });

    unwatch();
    store.changed();
    expect(listVersions).toHaveBeenCalledTimes(2);
  });

  it('reports a list that never loaded and keeps a loaded one after a failure', async () => {
    const listVersions = vi.spyOn(api, 'listVersions').mockRejectedValueOnce(new Error('offline'));
    const store = new VersionStore('b1');
    const unwatch = store.watch();
    await vi.waitFor(() => {
      expect(store.snapshot.status).toBe('failed');
    });

    listVersions.mockResolvedValueOnce([MORNING]).mockRejectedValueOnce(new Error('offline'));
    store.changed();
    await vi.waitFor(() => {
      expect(store.snapshot.status).toBe('ready');
    });
    store.changed();
    await vi.waitFor(() => {
      expect(listVersions.mock.settledResults[2]?.type).toBe('rejected');
    });
    expect(store.snapshot).toEqual({ versions: [MORNING], status: 'ready' });
    unwatch();
  });

  it('shows its own changes at once and drops a list read before them', async () => {
    const reply = deferred<BoardVersion[]>();
    const listVersions = vi
      .spyOn(api, 'listVersions')
      .mockResolvedValueOnce([MORNING])
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValue([NOON, MORNING]);
    const store = new VersionStore('b1');
    const unwatch = store.watch();
    await vi.waitFor(() => {
      expect(store.snapshot.status).toBe('ready');
    });

    const saveVersion = vi.spyOn(api, 'saveVersion').mockResolvedValue(NOON);
    store.changed();
    expect(await store.save('Перед релизом')).toBe(NOON);
    expect(saveVersion).toHaveBeenCalledExactlyOnceWith('b1', 'Перед релизом');
    expect(store.snapshot.versions).toEqual([NOON, MORNING]);
    // Список, прочитанный до сохранения, без новой версии: он не показывается.
    reply.resolve([MORNING]);
    await vi.waitFor(() => {
      expect(listVersions).toHaveBeenCalledTimes(3);
    });
    expect(store.snapshot.versions).toEqual([NOON, MORNING]);

    const renamed = { ...MORNING, name: 'Утро' };
    vi.spyOn(api, 'renameVersion').mockResolvedValue(renamed);
    await store.rename(MORNING.id, 'Утро');
    expect(store.snapshot.versions).toEqual([NOON, renamed]);

    const deleteVersion = vi.spyOn(api, 'deleteVersion').mockResolvedValue();
    await store.remove(NOON.id);
    expect(deleteVersion).toHaveBeenCalledExactlyOnceWith(NOON.id);
    expect(store.snapshot.versions).toEqual([renamed]);
    unwatch();
  });

  it('shows a version saved before the list loaded and then loads the rest', async () => {
    const listVersions = vi.spyOn(api, 'listVersions').mockResolvedValue([NOON, MORNING]);
    vi.spyOn(api, 'saveVersion').mockResolvedValue(NOON);
    const store = new VersionStore('b1');
    await store.save('Перед релизом');
    expect(listVersions).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(store.snapshot.versions).toEqual([NOON, MORNING]);
    });
  });

  it('reads the content of a version from the server', async () => {
    const content = new Uint8Array([1, 2, 3]);
    const versionState = vi.spyOn(api, 'versionState').mockResolvedValue(content);
    expect(await new VersionStore('b1').content('v1')).toBe(content);
    expect(versionState).toHaveBeenCalledExactlyOnceWith('v1');
  });
});
