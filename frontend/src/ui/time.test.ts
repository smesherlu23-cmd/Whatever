import { describe, expect, it } from 'vitest';
import { formatFullDate, formatMoment, formatWhen } from './time';

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

describe('formatWhen', () => {
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

describe('formatMoment', () => {
  it.each([
    [at(2026, 10, 23, 14, 29, 30), 'сегодня в 14:29'],
    [at(2026, 10, 22, 18, 40), 'вчера в 18:40'],
    [at(2026, 10, 3, 9, 5), '3 нояб. в 09:05'],
    [at(2025, 11, 31, 23, 0), '31 дек. 2025 г. в 23:00'],
  ])('%s', (iso, text) => {
    expect(formatMoment(iso, now)).toBe(text);
  });
});

describe('formatFullDate', () => {
  it('names the day itself rather than "today"', () => {
    expect(formatFullDate(at(2026, 10, 23, 9, 5))).toBe('23 ноября 2026 г. в 09:05');
  });
});
