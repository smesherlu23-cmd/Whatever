import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CommentThread, api } from '../api';
import { ANNA, IVAN, comment, thread } from '../testing/comments';
import { deferred } from '../testing/helpers';
import { CommentStore } from './store';

const QUESTION = thread('t1', [comment('c1', ANNA, 'Вопрос')]);
const ANSWERED = thread('t1', [comment('c1', ANNA, 'Вопрос'), comment('c2', IVAN, 'Ответ')]);
const OTHER = thread('t2', [comment('c3', IVAN, 'Другой вопрос')]);

/** Чтения списка ждут, пока тест на них ответит. */
function pendingLists() {
  const replies: ReturnType<typeof deferred<CommentThread[]>>[] = [];
  const listThreads = vi.spyOn(api, 'listThreads').mockImplementation(() => {
    const reply = deferred<CommentThread[]>();
    replies.push(reply);
    return reply.promise;
  });
  const answer = async (index: number, threads: CommentThread[]) => {
    replies[index]?.resolve(threads);
    await vi.waitFor(() => {
      expect(listThreads.mock.settledResults[index]?.type).toBe('fulfilled');
    });
  };
  return { listThreads, answer, replies };
}

describe('CommentStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the threads and merges refreshes asked for while loading', async () => {
    const { listThreads, answer } = pendingLists();
    const store = new CommentStore('b1');
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.snapshot.status).toBe('loading');

    store.refresh();
    store.refresh();
    store.refresh();
    expect(listThreads).toHaveBeenCalledExactlyOnceWith('b1');

    await answer(0, [QUESTION]);
    expect(store.snapshot).toEqual({ threads: [QUESTION], status: 'ready' });
    expect(listener).toHaveBeenCalled();
    // Три просьбы во время загрузки — одно повторное чтение.
    expect(listThreads).toHaveBeenCalledTimes(2);
    await answer(1, [ANSWERED]);
    expect(store.snapshot.threads).toEqual([ANSWERED]);
    expect(listThreads).toHaveBeenCalledTimes(2);
  });

  it('reports a failed first load and keeps the list after later failures', async () => {
    const listThreads = vi.spyOn(api, 'listThreads').mockRejectedValueOnce(new Error('offline'));
    const store = new CommentStore('b1');
    store.refresh();
    await vi.waitFor(() => {
      expect(store.snapshot.status).toBe('failed');
    });

    listThreads.mockResolvedValueOnce([QUESTION]);
    store.refresh();
    await vi.waitFor(() => {
      expect(store.snapshot).toEqual({ threads: [QUESTION], status: 'ready' });
    });

    listThreads.mockRejectedValueOnce(new Error('offline'));
    store.refresh();
    await vi.waitFor(() => {
      expect(listThreads.mock.settledResults[2]?.type).toBe('rejected');
    });
    expect(store.snapshot).toEqual({ threads: [QUESTION], status: 'ready' });
  });

  it('shows its own change at once and drops a list read before it', async () => {
    const { listThreads, answer } = pendingLists();
    const store = new CommentStore('b1');
    store.refresh();
    await answer(0, [QUESTION]);

    // Чтение началось до ответа: в нём ответа ещё нет.
    store.refresh();
    vi.spyOn(api, 'reply').mockResolvedValue(ANSWERED);
    await store.reply('t1', 'Ответ');
    expect(store.snapshot.threads).toEqual([ANSWERED]);

    await answer(1, [QUESTION]);
    expect(store.snapshot.threads).toEqual([ANSWERED]);
    expect(listThreads).toHaveBeenCalledTimes(3);
    await answer(2, [ANSWERED, OTHER]);
    expect(store.snapshot.threads).toEqual([ANSWERED, OTHER]);
  });

  it('applies every kind of change from the server answer', async () => {
    vi.spyOn(api, 'listThreads').mockResolvedValue([QUESTION, OTHER]);
    const store = new CommentStore('b1');
    store.refresh();
    await vi.waitFor(() => {
      expect(store.snapshot.status).toBe('ready');
    });

    const created = thread('t3', [comment('c4', ANNA, 'Ещё вопрос')]);
    const createThread = vi.spyOn(api, 'createThread').mockResolvedValue(created);
    const draft = { page: 'main', x: 1, y: 2, element: null, text: 'Ещё вопрос' };
    await expect(store.create(draft)).resolves.toBe(created);
    expect(createThread).toHaveBeenCalledWith('b1', draft);
    expect(store.snapshot.threads.map((t) => t.id)).toEqual(['t1', 't2', 't3']);

    const edited = thread('t1', [comment('c1', ANNA, 'Уточнённый вопрос')]);
    vi.spyOn(api, 'editComment').mockResolvedValue(edited);
    await store.edit('c1', 'Уточнённый вопрос');
    expect(store.snapshot.threads[0]).toBe(edited);

    const resolved = { ...edited, resolved_at: '2026-11-23T12:00:00Z', resolved_by: ANNA };
    const setResolved = vi.spyOn(api, 'setThreadResolved').mockResolvedValue(resolved);
    await store.setResolved('t1', true);
    expect(setResolved).toHaveBeenCalledWith('t1', true);
    expect(store.snapshot.threads[0]).toBe(resolved);

    vi.spyOn(api, 'reply').mockResolvedValue(ANSWERED);
    await store.reply('t1', 'Ответ');
    const deleteComment = vi.spyOn(api, 'deleteComment').mockResolvedValue();
    await store.deleteComment('t1', 'c2');
    expect(deleteComment).toHaveBeenCalledWith('c2');
    expect(store.snapshot.threads[0]?.comments.map((c) => c.id)).toEqual(['c1']);

    const deleteThread = vi.spyOn(api, 'deleteThread').mockResolvedValue();
    await store.deleteThread('t2');
    expect(deleteThread).toHaveBeenCalledWith('t2');
    expect(store.snapshot.threads.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('keeps the list unchanged when the server refuses a change', async () => {
    vi.spyOn(api, 'listThreads').mockResolvedValue([QUESTION]);
    const store = new CommentStore('b1');
    store.refresh();
    await vi.waitFor(() => {
      expect(store.snapshot.status).toBe('ready');
    });
    vi.spyOn(api, 'deleteThread').mockRejectedValue(new Error('403'));
    await expect(store.deleteThread('t1')).rejects.toThrow('403');
    expect(store.snapshot.threads).toEqual([QUESTION]);
  });

  it('loads the rest of the list after a change made before it arrived', async () => {
    const { listThreads, answer } = pendingLists();
    vi.spyOn(api, 'createThread').mockResolvedValue(QUESTION);
    const store = new CommentStore('b1');
    await store.create({ page: 'main', x: 1, y: 2, element: null, text: 'Вопрос' });
    expect(store.snapshot).toEqual({ threads: [QUESTION], status: 'ready' });
    expect(listThreads).toHaveBeenCalledOnce();
    await answer(0, [OTHER, QUESTION]);
    expect(store.snapshot.threads).toEqual([OTHER, QUESTION]);
  });

  it('asks who can be mentioned once and again after a failure', async () => {
    const boardPeople = vi
      .spyOn(api, 'boardPeople')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([ANNA, IVAN]);
    const store = new CommentStore('b1');
    await expect(store.people()).rejects.toThrow('offline');
    await expect(store.people()).resolves.toEqual([ANNA, IVAN]);
    await store.people();
    expect(boardPeople).toHaveBeenCalledTimes(2);
    expect(boardPeople).toHaveBeenCalledWith('b1');
  });
});
