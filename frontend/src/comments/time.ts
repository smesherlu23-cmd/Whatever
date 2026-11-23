const TIME = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const DATE = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' });

const MINUTE = 60_000;

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Когда написан комментарий: «только что», «5 мин назад», «вчера в 14:05», «3 нояб. в 9:30». */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  const ago = now.getTime() - when.getTime();
  if (ago < MINUTE) return 'только что';
  if (ago < 60 * MINUTE) return `${Math.floor(ago / MINUTE)} мин назад`;
  if (sameDay(when, now)) return `сегодня в ${TIME.format(when)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(when, yesterday)) return `вчера в ${TIME.format(when)}`;
  if (when.getFullYear() === now.getFullYear()) return `${DAY.format(when)} в ${TIME.format(when)}`;
  return DATE.format(when);
}
