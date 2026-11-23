import type { Person } from '../api';

/**
 * Упоминание коллеги: @логин. Правило то же, что на сервере (app/mentions.py): логин может
 * содержать точку, дефис и @, но заканчивается буквой, цифрой или подчёркиванием, а перед @
 * не стоит символ логина, иначе это адрес почты в тексте.
 */
const MENTION = /(?<![A-Za-z0-9._@-])@([A-Za-z0-9._@-]*[A-Za-z0-9_])/g;

/** Кусок текста комментария: обычный текст или упоминание того, кого сервер узнал. */
export type TextPart = { text: string } | { text: string; person: Person };

/** Делит текст на куски, выделяя упоминания из mentions. Остальные @слова — обычный текст. */
export function splitMentions(text: string, mentions: readonly Person[]): TextPart[] {
  const byLogin = new Map(mentions.map((person) => [person.login.toLowerCase(), person]));
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    const person = byLogin.get((match[1] ?? '').toLowerCase());
    if (!person) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[0], person });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Упоминание, которое набирают прямо перед кареткой: где начинается «@» и что набрано после. */
export interface MentionQuery {
  start: number;
  query: string;
}

/** После «@» ищут и по имени, поэтому набранное может быть и кириллицей, а не только логином. */
const TYPING = /(?<![A-Za-z0-9._@-])@([\p{L}\p{N}._@-]*)$/u;

export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = TYPING.exec(text.slice(0, caret));
  return match ? { start: match.index, query: match[1] ?? '' } : null;
}

/** Коллеги, подходящие к набранному: по началу логина, имени или фамилии. */
export function suggestPeople(people: readonly Person[], query: string, limit: number): Person[] {
  const needle = query.toLowerCase();
  const fits = (person: Person) =>
    person.login.toLowerCase().startsWith(needle) ||
    person.name
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.startsWith(needle));
  return people.filter(fits).slice(0, limit);
}

/** Текст с упоминанием person вместо набранного «@…» и позиция каретки после него. */
export function insertMention(
  text: string,
  caret: number,
  at: MentionQuery,
  person: Person,
): { text: string; caret: number } {
  const mention = `@${person.login} `;
  const rest = text.slice(caret).replace(/^\s/, '');
  return { text: text.slice(0, at.start) + mention + rest, caret: at.start + mention.length };
}
