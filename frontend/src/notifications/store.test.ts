import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Notifications, api } from '../api';
import { notification } from '../testing/comments';
import { NotificationStore } from './store';

const MENTION = notification('n1', { thread_id: 't1' });
const REPLY = notification('n2', { kind: 'reply', thread_id: 't2' });
const OLD = notification('n3', { thread_id: 't1', read: true });
const INBOX: Notifications = { unread: 2, items: [MENTION, REPLY, OLD] };

function loaded(store: NotificationStore) {
  return vi.waitFor(() => {
    expect(store.snapshot.loaded).toBe(true);
  });
}

describe('NotificationStore', () => {
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function switchTab(state: DocumentVisibilityState) {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('asks the server every minute while the tab is visible and when it is back', async () => {
    vi.useFakeTimers();
    const notifications = vi.spyOn(api, 'notifications').mockResolvedValue(INBOX);
    const store = new NotificationStore();
    const stop = store.start();
    expect(notifications).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.snapshot).toEqual({ ...INBOX, loaded: true });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(notifications).toHaveBeenCalledTimes(2);

    switchTab('hidden');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(notifications).toHaveBeenCalledTimes(2);
    switchTab('visible');
    expect(notifications).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    switchTab('visible');
    expect(notifications).toHaveBeenCalledTimes(3);
  });

  it('does not ask again while waiting for an answer and keeps the old one without a connection', async () => {
    const notifications = vi.spyOn(api, 'notifications').mockResolvedValueOnce(INBOX);
    const store = new NotificationStore();
    store.refresh();
    store.refresh();
    expect(notifications).toHaveBeenCalledOnce();
    await loaded(store);

    notifications.mockRejectedValueOnce(new Error('offline'));
    store.refresh();
    await vi.waitFor(() => {
      expect(notifications.mock.settledResults[1]?.type).toBe('rejected');
    });
    expect(store.snapshot).toEqual({ ...INBOX, loaded: true });

    notifications.mockResolvedValueOnce({ unread: 0, items: [] });
    store.refresh();
    await vi.waitFor(() => {
      expect(store.snapshot.items).toEqual([]);
    });
  });

  it('reads the notifications of the thread on the screen', async () => {
    vi.spyOn(api, 'notifications').mockResolvedValue(INBOX);
    const readThread = vi.spyOn(api, 'readThread').mockResolvedValue();
    const store = new NotificationStore();
    store.watchThread('t1');
    expect(readThread).not.toHaveBeenCalled();

    store.refresh();
    await loaded(store);
    expect(readThread).toHaveBeenCalledExactlyOnceWith('t1');
    expect(store.snapshot.unread).toBe(1);
    expect(store.snapshot.items.map((n) => n.read)).toEqual([true, false, true]);

    // Прочитанное не отправляется снова, а новое по открытому обсуждению читается сразу.
    store.watchThread('t1');
    readThread.mockRejectedValueOnce(new Error('offline'));
    store.watchThread('t2');
    expect(readThread).toHaveBeenLastCalledWith('t2');
    expect(store.snapshot.unread).toBe(0);
    store.watchThread(null);
    expect(readThread).toHaveBeenCalledTimes(2);
  });

  it('marks everything read', async () => {
    vi.spyOn(api, 'notifications').mockResolvedValue(INBOX);
    const readAll = vi
      .spyOn(api, 'readAllNotifications')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue();
    const store = new NotificationStore();
    store.refresh();
    await loaded(store);

    await expect(store.readAll()).rejects.toThrow('offline');
    expect(store.snapshot.unread).toBe(2);

    const listener = vi.fn();
    store.subscribe(listener);
    await store.readAll();
    expect(store.snapshot.unread).toBe(0);
    expect(store.snapshot.items.every((n) => n.read)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    // Читать уже нечего: подписчики не тревожатся зря.
    await store.readAll();
    expect(readAll).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenCalledOnce();
  });
});
