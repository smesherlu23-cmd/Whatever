import type { FileRef } from './types';

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ'] as const;

/** Размер файла для людей: «820 Б», «12 КБ», «1,4 МБ». */
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: digits })} ${UNITS[unit] ?? ''}`;
}

/** Расширение имени файла заглавными буквами, например «PDF». Если его нет — пустая строка. */
export function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : '';
}

/** Вторая строка карточки вложения: «PDF · 1,4 МБ». */
export function fileSummary(file: FileRef): string {
  const ext = extension(file.name);
  const size = formatSize(file.size);
  return ext ? `${ext} · ${size}` : size;
}
