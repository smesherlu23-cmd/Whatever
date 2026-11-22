import { type ElementLookup, resolveArrow } from './geometry';
import { newId } from './ids';
import type { ArrowEnd, BoardElement } from './types';
import { isArrow } from './types';

export interface CloneOptions {
  /** Страница, на которую встанут копии. */
  page: string;
  /** Сдвиг копий по обеим осям в мировых единицах. */
  offset: number;
  /** z нижней копии. Остальные идут следом в прежнем порядке. */
  firstZ: number;
  /** Где искать фигуры, к которым привязаны стрелки. */
  lookup: ElementLookup;
}

/**
 * Копии элементов с новыми id, в прежнем порядке наложения. Стрелка между копируемыми
 * фигурами цепляется за их копии. Конец, привязанный к фигуре, которую не копируют,
 * становится свободным там, где был виден.
 */
export function cloneElements(
  elements: readonly BoardElement[],
  { page, offset, firstZ, lookup }: CloneOptions,
): BoardElement[] {
  const ordered = [...elements].sort((a, b) => a.z - b.z);
  // Новые id выдаются заранее, чтобы копии стрелок цеплялись за копии фигур.
  const copyIds = new Map(ordered.map((el) => [el.id, newId()]));
  const shift = (x: number, y: number) => ({ x: x + offset, y: y + offset });

  return ordered.map((el, index): BoardElement => {
    const id = copyIds.get(el.id) ?? newId();
    const z = firstZ + index;
    if (!isArrow(el)) return { ...el, id, page, z, ...shift(el.x, el.y) };
    const shown = resolveArrow(el, lookup);
    const copyEnd = (end: ArrowEnd, at: { x: number; y: number }): ArrowEnd => {
      const shapeId = end.shapeId ? copyIds.get(end.shapeId) : undefined;
      return shapeId ? { ...end, ...shift(end.x, end.y), shapeId } : shift(at.x, at.y);
    };
    return {
      ...el,
      id,
      page,
      z,
      start: copyEnd(el.start, shown.start),
      end: copyEnd(el.end, shown.end),
    };
  });
}
