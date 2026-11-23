const TIME = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const DATE = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' });
const FULL = new Intl.DateTimeFormat('ru', { dateStyle: 'long', timeStyle: 'short' });

const MINUTE = 60_000;

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** «сегодня», «вчера», «3 нояб.» или, если год другой, «31 дек. 2025 г.». */
function dayOf(when: Date, now: Date): string {
  if (sameDay(when, now)) return 'сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(when, yesterday)) return 'вчера';
  return (when.getFullYear() === now.getFullYear() ? DAY : DATE).format(when);
}

/** Когда написан комментарий: «только что», «5 мин назад», «вчера в 14:05», «3 нояб. в 9:30». */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  const ago = now.getTime() - when.getTime();
  if (ago < MINUTE) return 'только что';
  if (ago < 60 * MINUTE) return `${Math.floor(ago / MINUTE)} мин назад`;
  // У давнего важен день, а не минуты.
  if (when.getFullYear() !== now.getFullYear()) return DATE.format(when);
  return formatMoment(iso, now);
}

/**
 * Время с точностью до минуты, даже недавнее: «сегодня в 14:05», «3 нояб. в 9:30»,
 * «31 дек. 2025 г. в 23:00». Так подписаны версии доски: по ним ищут нужный момент.
 */
export function formatMoment(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  return `${dayOf(when, now)} в ${TIME.format(when)}`;
}

/** Дата и время, которые не устаревают со временем, в отличие от «вчера»: «23 ноября 2026 г. в 14:05». */
export function formatFullDate(iso: string): string {
  return FULL.format(new Date(iso));
}
