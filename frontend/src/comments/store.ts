import { type CommentThread, type NewThread, type Person, api } from '../api';

export type CommentsStatus = 'loading' | 'ready' | 'failed';

export interface CommentsState {
  /** Обсуждения доски по времени начала. */
  threads: readonly CommentThread[];
  /** failed — не загрузились ни разу; если список уже был, при сбое остаётся прежний. */
  status: CommentsStatus;
}

/**
 * Обсуждения открытой доски. Хранятся на сервере, а не в документе доски, поэтому без связи
 * их не прочитать и не написать.
 *
 * Сервер не присылает изменения, а сообщает, что они были (session.ts), и список перечитывается
 * целиком: так он всегда совпадает с сервером, сколько бы сообщений ни потерялось без связи.
 * Свою правку пользователь видит сразу, по ответу сервера. Ответ на перечитывание, начатое до
 * неё, отбрасывается: в нём правки ещё нет, и она бы мелькнула и пропала.
 */
export class CommentStore {
  private state: CommentsState = { threads: [], status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private loading = false;
  private reloadAfter = false;
  /** Растёт с каждой своей правкой: по нему видно, что ответ на перечитывание устарел. */
  private edits = 0;
  private peopleRequest: Promise<Person[]> | null = null;

  constructor(private readonly boardId: string) {}

  get snapshot(): CommentsState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Перечитывает обсуждения. Вызовы во время загрузки сливаются в одно повторное чтение. */
  refresh(): void {
    if (this.loading) {
      this.reloadAfter = true;
      return;
    }
    this.loading = true;
    const edits = this.edits;
    api.listThreads(this.boardId).then(
      (threads) => {
        if (edits === this.edits) this.set({ threads, status: 'ready' });
        else this.reloadAfter = true;
        this.loaded();
      },
      () => {
        if (this.state.status === 'loading') this.set({ ...this.state, status: 'failed' });
        this.loaded();
      },
    );
  }

  private loaded(): void {
    this.loading = false;
    if (!this.reloadAfter) return;
    this.reloadAfter = false;
    this.refresh();
  }

  /** Начинает обсуждение. Возвращает его, чтобы сразу открыть. */
  async create(thread: NewThread): Promise<CommentThread> {
    return this.put(await api.createThread(this.boardId, thread));
  }

  async reply(threadId: string, text: string): Promise<void> {
    this.put(await api.reply(threadId, text));
  }

  async edit(commentId: string, text: string): Promise<void> {
    this.put(await api.editComment(commentId, text));
  }

  async setResolved(threadId: string, resolved: boolean): Promise<void> {
    this.put(await api.setThreadResolved(threadId, resolved));
  }

  async deleteThread(threadId: string): Promise<void> {
    await api.deleteThread(threadId);
    this.change(this.state.threads.filter((t) => t.id !== threadId));
  }

  async deleteComment(threadId: string, commentId: string): Promise<void> {
    await api.deleteComment(commentId);
    this.change(
      this.state.threads.map((t) =>
        t.id === threadId ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t,
      ),
    );
  }

  /**
   * Кого можно упомянуть на доске. Список запрашивается один раз; если запрос не удался,
   * следующий вызов спросит снова.
   */
  people(): Promise<Person[]> {
    this.peopleRequest ??= api.boardPeople(this.boardId).catch((error: unknown) => {
      this.peopleRequest = null;
      throw error;
    });
    return this.peopleRequest;
  }

  private put(thread: CommentThread): CommentThread {
    const { threads } = this.state;
    const known = threads.some((t) => t.id === thread.id);
    this.change(
      known ? threads.map((t) => (t.id === thread.id ? thread : t)) : [...threads, thread],
    );
    return thread;
  }

  private change(threads: readonly CommentThread[]): void {
    this.edits += 1;
    const complete = this.state.status === 'ready';
    this.set({ threads, status: 'ready' });
    // Список ещё не загружался: правка видна сразу, а остальное придёт следом.
    if (!complete) this.refresh();
  }

  private set(state: CommentsState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
