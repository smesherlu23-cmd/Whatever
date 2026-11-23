import { describe, expect, it } from 'vitest';
import type { Person } from '../api';
import { insertMention, mentionQuery, splitMentions, suggestPeople } from './mentions';

const IVAN: Person = { id: 'u-ivan', login: 'ivan.petrov', name: 'Иван Петров' };
const ANNA: Person = { id: 'u-anna', login: 'anna', name: 'Анна Смирнова' };
const OLGA: Person = { id: 'u-olga', login: 'o.sidorova', name: 'Ольга Сидорова' };

describe('mentions', () => {
  it('marks the people the server recognised', () => {
    expect(
      splitMentions('@Ivan.Petrov, глянь. Пишите на ivan@corp.ru или @nobody.', [IVAN]),
    ).toEqual([
      { text: '@Ivan.Petrov', person: IVAN },
      { text: ', глянь. Пишите на ivan@corp.ru или @nobody.' },
    ]);
    expect(splitMentions('Спасибо, @anna', [ANNA])).toEqual([
      { text: 'Спасибо, ' },
      { text: '@anna', person: ANNA },
    ]);
    expect(splitMentions('Без упоминаний', [])).toEqual([{ text: 'Без упоминаний' }]);
  });

  it('finds the mention being typed before the caret', () => {
    expect(mentionQuery('Привет, @iv', 11)).toEqual({ start: 8, query: 'iv' });
    expect(mentionQuery('Привет, @Ив', 11)).toEqual({ start: 8, query: 'Ив' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('почта a@b', 9)).toBeNull();
    expect(mentionQuery('@ivan готово', 12)).toBeNull();
  });

  it('suggests people by login, first name or last name', () => {
    const people = [IVAN, ANNA, OLGA];
    expect(suggestPeople(people, 'iv', 5)).toEqual([IVAN]);
    expect(suggestPeople(people, 'сидор', 5)).toEqual([OLGA]);
    expect(suggestPeople(people, 'АН', 5)).toEqual([ANNA]);
    expect(suggestPeople(people, '', 2)).toEqual([IVAN, ANNA]);
  });

  it('puts the chosen login in place of what was typed', () => {
    const text = 'Привет, @iv как дела';
    expect(insertMention(text, 11, { start: 8, query: 'iv' }, IVAN)).toEqual({
      text: 'Привет, @ivan.petrov как дела',
      caret: 21,
    });
    expect(insertMention('@a', 2, { start: 0, query: 'a' }, ANNA)).toEqual({
      text: '@anna ',
      caret: 6,
    });
  });
});
