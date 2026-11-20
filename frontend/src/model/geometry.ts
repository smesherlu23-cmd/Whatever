import type { ArrowElement, BoardElement, Bounds, Point, ShapeElement } from './types';
import { isArrow } from './types';

export function normalizeBounds(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function center(b: Bounds): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Точка на границе фигуры по направлению из её центра к точке toward. */
export function boundaryPoint(shape: ShapeElement, toward: Point): Point {
  const c = center(shape);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = shape.w / 2;
  const hh = shape.h / 2;
  if ((dx === 0 && dy === 0) || hw === 0 || hh === 0) return c;
  let t: number;
  switch (shape.kind) {
    case 'ellipse':
      t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
      break;
    case 'diamond':
      t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
      break;
    default:
      t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export type ElementLookup = (id: string) => BoardElement | undefined;

function boundShape(lookup: ElementLookup, id: string | undefined): ShapeElement | undefined {
  if (!id) return undefined;
  const el = lookup(id);
  return el && !isArrow(el) ? el : undefined;
}

/** Реальные координаты концов стрелки с учётом привязки к фигурам. */
export function resolveArrow(arrow: ArrowElement, lookup: ElementLookup): { start: Point; end: Point } {
  const startShape = boundShape(lookup, arrow.start.shapeId);
  const endShape = boundShape(lookup, arrow.end.shapeId);
  const startAnchor = startShape ? center(startShape) : arrow.start;
  const endAnchor = endShape ? center(endShape) : arrow.end;
  return {
    start: startShape ? boundaryPoint(startShape, endAnchor) : { x: arrow.start.x, y: arrow.start.y },
    end: endShape ? boundaryPoint(endShape, startAnchor) : { x: arrow.end.x, y: arrow.end.y },
  };
}

export function elementBounds(el: BoardElement, lookup: ElementLookup): Bounds {
  if (!isArrow(el)) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const { start, end } = resolveArrow(el, lookup);
  return normalizeBounds(start, end);
}

/** Попадает ли точка в элемент. tolerance задаётся в мировых единицах. */
export function hitTest(el: BoardElement, p: Point, lookup: ElementLookup, tolerance: number): boolean {
  if (isArrow(el)) {
    const { start, end } = resolveArrow(el, lookup);
    return distanceToSegment(p, start, end) <= tolerance;
  }
  const c = center(el);
  const hw = el.w / 2 + tolerance;
  const hh = el.h / 2 + tolerance;
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  switch (el.kind) {
    case 'ellipse':
      return (dx / hw) ** 2 + (dy / hh) ** 2 <= 1;
    case 'diamond':
      return dx / hw + dy / hh <= 1;
    default:
      return dx <= hw && dy <= hh;
  }
}
