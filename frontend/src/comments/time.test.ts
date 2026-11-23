import { describe, expect, it } from 'vitest';
import { formatWhen } from './time';

describe('formatWhen', () => {
  // Время задаётся в часовом поясе, где идут тесты: так проверка от него не зависит.
  const now = new Date(2026, 10, 23, 14, 30);
  const at = (
    year: number,
    month: number,
    day: number,
    hours: number,
    minutes: number,
    seconds = 0,
  ) => new Date(year, month, day, hours, minutes, seconds).toISOString();

  it.each([
    [at(2026, 10, 23, 14, 29, 30), 'только что'],
    [at(2026, 10, 23, 14, 5), '25 мин назад'],
    [at(2026, 10, 23, 9, 5), 'сегодня в 09:05'],
    [at(2026, 10, 22, 18, 40), 'вчера в 18:40'],
    [at(2026, 10, 3, 9, 5), '3 нояб. в 09:05'],
    [at(2025, 11, 31, 23, 0), '31 дек. 2025 г.'],
  ])('%s', (iso, text) => {
    expect(formatWhen(iso, now)).toBe(text);
  });
});
