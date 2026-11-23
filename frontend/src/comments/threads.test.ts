import { describe, expect, it } from 'vitest';
import { ANNA, IVAN, OLGA, comment, thread } from '../testing/comments';
import { filterThreads, involves, lastActivity } from './threads';

describe('thread filters', () => {
  const asked = thread('asked', [
    comment('c1', ANNA, 'Вопрос', { created_at: '2026-11-23T09:00:00Z' }),
  ]);
  const answered = thread('answered', [
    comment('c2', OLGA, 'Вопрос', { created_at: '2026-11-23T08:00:00Z' }),
    comment('c3', IVAN, 'Ответ', { created_at: '2026-11-23T10:00:00Z' }),
  ]);
  const mentioned = thread(
    'mentioned',
    [comment('c4', OLGA, '@anna', { created_at: '2026-11-22T10:00:00Z', mentions: [ANNA] })],
    { resolved_at: '2026-11-23T12:00:00Z', resolved_by: OLGA },
  );
  const threads = [asked, answered, mentioned];

  it('starts with the threads that were active last', () => {
    expect(lastActivity(answered)).toBe('2026-11-23T10:00:00Z');
    expect(lastActivity(thread('empty', [], { created_at: '2026-11-01T00:00:00Z' }))).toBe(
      '2026-11-01T00:00:00Z',
    );
    expect(filterThreads(threads, 'all', ANNA.id).map((t) => t.id)).toEqual([
      'answered',
      'asked',
      'mentioned',
    ]);
  });

  it('shows open threads or those the user takes part in', () => {
    expect(filterThreads(threads, 'open', ANNA.id).map((t) => t.id)).toEqual(['answered', 'asked']);
    expect(filterThreads(threads, 'mine', ANNA.id).map((t) => t.id)).toEqual([
      'asked',
      'mentioned',
    ]);
    expect(filterThreads(threads, 'mine', IVAN.id).map((t) => t.id)).toEqual(['answered']);
    expect(involves(answered, ANNA.id)).toBe(false);
  });
});
