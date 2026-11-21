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

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Пары соседних точек ломаной. */
export function* segments(points: readonly Point[]): Generator<[Point, Point]> {
  let previous: Point | undefined;
  for (const point of points) {
    if (previous) yield [previous, point];
    previous = point;
  }
}

/** Наименьшая рамка, содержащая все точки. Для пустого списка — нулевая рамка в начале координат. */
export function boundsOf(points: readonly Point[]): Bounds {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Вершины треугольника, вписанного в рамку: вершина посередине сверху, основание снизу. */
export function trianglePoints(b: Bounds): [Point, Point, Point] {
  return [
    { x: b.x + b.w / 2, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** Пары соседних вершин замкнутого многоугольника, включая последнюю с первой. */
function* edges(polygon: readonly Point[]): Generator<[Point, Point]> {
  yield* segments(polygon);
  const first = polygon[0];
  const last = polygon.at(-1);
  if (first && last && polygon.length > 2) yield [last, first];
}

/**
 * Параметр t, при котором луч origin + t·direction выходит из выпуклого многоугольника.
 * Луч начинается внутри, поэтому пересечение с границей одно.
 */
function rayExit(origin: Point, direction: Point, polygon: readonly Point[]): number {
  let best = Infinity;
  for (const [a, b] of edges(polygon)) {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denominator = direction.x * ey - direction.y * ex;
    if (denominator === 0) continue;
    const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / denominator;
    const s = ((a.x - origin.x) * direction.y - (a.y - origin.y) * direction.x) / denominator;
    if (t > 0 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
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
    case 'triangle':
      t = rayExit(c, { x: dx, y: dy }, trianglePoints(shape));
      break;
    default:
      t = Math.min(
        dx === 0 ? Infinity : hw / Math.abs(dx),
        dy === 0 ? Infinity : hh / Math.abs(dy),
      );
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Внутри ли точка выпуклого многоугольника, обходимого по часовой стрелке (на экране). */
function insideConvex(p: Point, polygon: readonly Point[]): boolean {
  for (const [a, b] of edges(polygon)) {
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) return false;
  }
  return true;
}

/** Штрих тоньше фигуры, поэтому попасть в него чуть проще. */
const PATH_HIT_SLACK = 2;

export type ElementLookup = (id: string) => BoardElement | undefined;

function boundShape(lookup: ElementLookup, id: string | undefined): ShapeElement | undefined {
  if (!id) return undefined;
  const el = lookup(id);
  return el && !isArrow(el) ? el : undefined;
}

/** Расхождение (в мировых единицах), при котором ломаная стрелка выпрямляется. */
const ELBOW_STRAIGHTEN = 12;

/** Линия стрелки: концы и точки изгиба между ними (у прямой стрелки их нет). */
export interface ArrowPath {
  start: Point;
  bends: Point[];
  end: Point;
}

export function pathVertices(path: ArrowPath): Point[] {
  return [path.start, ...path.bends, path.end];
}

/**
 * Ломаная стрелка идёт по горизонтали и вертикали с изгибами на середине пути.
 * Основное направление выбирается по тому, куда дальше от начала до конца. Привязанный
 * конец выходит из середины той стороны фигуры, что смотрит на другой конец.
 */
function elbowPath(
  arrow: ArrowElement,
  startShape: ShapeElement | undefined,
  endShape: ShapeElement | undefined,
): ArrowPath {
  const from = startShape ? center(startShape) : arrow.start;
  const to = endShape ? center(endShape) : arrow.end;
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const forward = horizontal ? Math.sign(to.x - from.x) || 1 : Math.sign(to.y - from.y) || 1;
  const side = (shape: ShapeElement, sign: number): Point => {
    const c = center(shape);
    return boundaryPoint(shape, horizontal ? { x: c.x + sign, y: c.y } : { x: c.x, y: c.y + sign });
  };
  const start = startShape ? side(startShape, forward) : { x: arrow.start.x, y: arrow.start.y };
  const end = endShape ? side(endShape, -forward) : { x: arrow.end.x, y: arrow.end.y };
  // Фигуры стоят почти на одной линии: вместо мелкой ступеньки стрелка идёт прямо,
  // а привязанный конец сдвигается вдоль стороны фигуры.
  const axis = horizontal ? 'y' : 'x';
  if (Math.abs(end[axis] - start[axis]) <= ELBOW_STRAIGHTEN && (endShape ?? startShape)) {
    if (endShape) end[axis] = start[axis];
    else start[axis] = end[axis];
    return { start, bends: [], end };
  }
  if (horizontal) {
    const x = (start.x + end.x) / 2;
    return {
      start,
      bends: [
        { x, y: start.y },
        { x, y: end.y },
      ],
      end,
    };
  }
  const y = (start.y + end.y) / 2;
  return {
    start,
    bends: [
      { x: start.x, y },
      { x: end.x, y },
    ],
    end,
  };
}

/** Линия стрелки с учётом привязки концов к фигурам и вида линии. */
export function arrowPath(arrow: ArrowElement, lookup: ElementLookup): ArrowPath {
  const startShape = boundShape(lookup, arrow.start.shapeId);
  const endShape = boundShape(lookup, arrow.end.shapeId);
  if (arrow.route === 'elbow') return elbowPath(arrow, startShape, endShape);
  const startAnchor = startShape ? center(startShape) : arrow.start;
  const endAnchor = endShape ? center(endShape) : arrow.end;
  return {
    start: startShape
      ? boundaryPoint(startShape, endAnchor)
      : { x: arrow.start.x, y: arrow.start.y },
    bends: [],
    end: endShape ? boundaryPoint(endShape, startAnchor) : { x: arrow.end.x, y: arrow.end.y },
  };
}

/** Реальные координаты концов стрелки. */
export function resolveArrow(
  arrow: ArrowElement,
  lookup: ElementLookup,
): { start: Point; end: Point } {
  const { start, end } = arrowPath(arrow, lookup);
  return { start, end };
}

export function elementBounds(el: BoardElement, lookup: ElementLookup): Bounds {
  if (!isArrow(el)) return { x: el.x, y: el.y, w: el.w, h: el.h };
  return boundsOf(pathVertices(arrowPath(el, lookup)));
}

/** Точки рукописного штриха в мировых координатах. */
export function pathPoints(el: ShapeElement): Point[] {
  const flat = el.points ?? [];
  const result: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const fx = flat[i] ?? 0;
    const fy = flat[i + 1] ?? 0;
    result.push({ x: el.x + fx * el.w, y: el.y + fy * el.h });
  }
  return result;
}

/** Переводит точки штриха в доли рамки, чтобы штрих масштабировался вместе с ней. */
export function normalizePath(points: readonly Point[]): { bounds: Bounds; points: number[] } {
  const bounds = boundsOf(points);
  const flat = points.flatMap((p) => [
    bounds.w ? (p.x - bounds.x) / bounds.w : 0,
    bounds.h ? (p.y - bounds.y) / bounds.h : 0,
  ]);
  return { bounds, points: flat };
}

/** Попадает ли точка в элемент. tolerance задаётся в мировых единицах. */
export function hitTest(
  el: BoardElement,
  p: Point,
  lookup: ElementLookup,
  tolerance: number,
): boolean {
  if (isArrow(el)) {
    for (const [a, b] of segments(pathVertices(arrowPath(el, lookup)))) {
      if (distanceToSegment(p, a, b) <= tolerance) return true;
    }
    return false;
  }
  if (el.kind === 'path') {
    for (const [a, b] of segments(pathPoints(el))) {
      if (distanceToSegment(p, a, b) <= tolerance + PATH_HIT_SLACK) return true;
    }
    return false;
  }
  if (el.kind === 'triangle') {
    const triangle = trianglePoints(el);
    if (insideConvex(p, triangle)) return true;
    for (const [a, b] of edges(triangle)) {
      if (distanceToSegment(p, a, b) <= tolerance) return true;
    }
    return false;
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
