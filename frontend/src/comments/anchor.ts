import type { CommentThread, ElementAnchor } from '../api';
import { elementBounds } from '../model/geometry';
import type { BoardElement, Bounds, Point } from '../model/types';

type Lookup = (id: string) => BoardElement | undefined;

/** Доля отрезка [start, start + size], в которой лежит value. У нулевого отрезка — середина. */
function fraction(value: number, start: number, size: number): number {
  if (size <= 0) return 0.5;
  return Math.min(Math.max((value - start) / size, 0), 1);
}

/** Метка на элементе в точке point: место на нём в долях его ширины и высоты. */
export function anchorAt(element: BoardElement, point: Point, lookup: Lookup): ElementAnchor {
  const b = elementBounds(element, lookup);
  return { id: element.id, x: fraction(point.x, b.x, b.w), y: fraction(point.y, b.y, b.h) };
}

function pointOn(b: Bounds, anchor: ElementAnchor): Point {
  return { x: b.x + anchor.x * b.w, y: b.y + anchor.y * b.h };
}

/**
 * Где показать метку обсуждения. Метка элемента едет вместе с ним; если элемента на странице
 * больше нет, метка остаётся там, где её поставили.
 */
export function pinPoint(
  thread: Pick<CommentThread, 'page' | 'x' | 'y' | 'element'>,
  lookup: Lookup,
): Point {
  const anchor = thread.element;
  const element = anchor ? lookup(anchor.id) : undefined;
  if (!anchor || element?.page !== thread.page) return { x: thread.x, y: thread.y };
  return pointOn(elementBounds(element, lookup), anchor);
}
