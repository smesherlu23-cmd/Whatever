let counter = 0;

/** Короткий уникальный id: случайная часть плюс счётчик на случай одинаковых случайных значений. */
export function newId(): string {
  counter += 1;
  return `${crypto.randomUUID().slice(0, 8)}${counter.toString(36)}`;
}
