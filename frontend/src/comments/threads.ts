import type { CommentThread } from '../api';

/** Какие обсуждения показывает панель. */
export type ThreadFilter = 'open' | 'mine' | 'all';

export const isOpen = (thread: CommentThread): boolean => thread.resolved_at === null;

/** Обсуждение пользователя: он его начал, писал в нём или его там упомянули. */
export function involves(thread: CommentThread, userId: string): boolean {
  return (
    thread.author?.id === userId ||
    thread.comments.some(
      (c) => c.author?.id === userId || c.mentions.some((person) => person.id === userId),
    )
  );
}

/** Время последнего комментария: по нему список начинается с самых живых обсуждений. */
export function lastActivity(thread: CommentThread): string {
  return thread.comments.at(-1)?.created_at ?? thread.created_at;
}

export function filterThreads(
  threads: readonly CommentThread[],
  filter: ThreadFilter,
  userId: string,
): CommentThread[] {
  const shown = threads.filter((thread) => {
    if (filter === 'open') return isOpen(thread);
    if (filter === 'mine') return involves(thread, userId);
    return true;
  });
  return shown.sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
}
