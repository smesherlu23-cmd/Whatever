import type { AppNotification, Comment, CommentThread, Person } from '../api';

/** Те же люди, что вошедшие пользователи из testing/auth.tsx, и ещё одна коллега. */
export const ANNA: Person = { id: 'u-anna', login: 'anna', name: 'Анна Смирнова' };
export const IVAN: Person = { id: 'u-ivan', login: 'ivan', name: 'Иван Петров' };
export const OLGA: Person = { id: 'u-olga', login: 'olga', name: 'Ольга Сидорова' };

export function comment(
  id: string,
  author: Person | null,
  text: string,
  fields: Partial<Comment> = {},
): Comment {
  return {
    id,
    author,
    text,
    mentions: [],
    created_at: '2026-11-23T09:00:00Z',
    edited_at: null,
    ...fields,
  };
}

/** Обсуждение в точке главной страницы. Автор и время начала — как у первого комментария. */
export function thread(
  id: string,
  comments: Comment[],
  fields: Partial<CommentThread> = {},
): CommentThread {
  return {
    id,
    page: 'main',
    x: 100,
    y: 100,
    element: null,
    author: comments[0]?.author ?? null,
    created_at: comments[0]?.created_at ?? '2026-11-23T09:00:00Z',
    resolved_at: null,
    resolved_by: null,
    comments,
    ...fields,
  };
}

export function notification(id: string, fields: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    kind: 'mention',
    read: false,
    created_at: '2026-11-23T09:00:00Z',
    actor: ANNA,
    board: { id: 'b1', name: 'Схема' },
    thread_id: 't1',
    comment_id: `c-${id}`,
    excerpt: '@ivan посмотри',
    ...fields,
  };
}
