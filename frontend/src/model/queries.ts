import { hitTest } from './geometry';
import type { BoardDocument } from './document';
import type { BoardElement, Point, ShapeElement } from './types';
import { isArrow } from './types';

/** Верхний элемент под точкой. tolerance — в мировых единицах. */
export function elementAt(
  doc: BoardDocument,
  world: Point,
  tolerance: number,
): BoardElement | undefined {
  const elements = doc.list();
  const lookup = (id: string) => doc.get(id);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el && hitTest(el, world, lookup, tolerance)) return el;
  }
  return undefined;
}

/** Фигуры, к которым можно привязать стрелку: всё, кроме стрелок и рукописных штрихов. */
export function isConnectable(el: BoardElement): el is ShapeElement {
  return !isArrow(el) && el.kind !== 'path';
}

/** Фигуры, в которых можно написать текст: всё, кроме стрелок и рукописных штрихов. */
export function hasText(el: BoardElement): el is ShapeElement {
  return !isArrow(el) && el.kind !== 'path';
}

/** Верхняя фигура рядом с точкой, к которой можно привязать конец стрелки. */
export function bindTargetAt(
  doc: BoardDocument,
  world: Point,
  tolerance: number,
  exclude?: string,
): ShapeElement | undefined {
  const elements = doc.list();
  const lookup = (id: string) => doc.get(id);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el || el.id === exclude || !isConnectable(el)) continue;
    if (hitTest(el, world, lookup, tolerance)) return el;
  }
  return undefined;
}
