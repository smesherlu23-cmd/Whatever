import type { BoardDocument } from '../model/document';
import { type ArrowElement, type ShapeElement, isArrow } from '../model/types';

/**
 * Проверяет, что значение есть, и сужает тип. В тестах заменяет `!` и `as`:
 * вместо TypeError где-то дальше тест падает здесь с понятным сообщением.
 */
export function defined<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be defined, got ${String(value)}`);
  }
  return value;
}

/** Ровно два элемента списка: для тестов, где на доске две фигуры. */
export function takeTwo<T>(items: readonly T[]): [T, T] {
  const [first, second] = items;
  return [defined(first, 'first item'), defined(second, 'second item')];
}

export function shapes(doc: BoardDocument): ShapeElement[] {
  return doc.list().filter((el): el is ShapeElement => !isArrow(el));
}

export function arrows(doc: BoardDocument): ArrowElement[] {
  return doc.list().filter(isArrow);
}
