import { type Hull, shapeSpec } from './shapes';
import { LABEL_FONT_SIZE, estimateMeasure, labelLayout } from './textLayout';
import type { ArrowElement, ArrowEnd, BoardElement, Bounds, Point, ShapeElement } from './types';
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

/** Одна и та же рамка; null равен только null. */
export function sameBounds(a: Bounds | null, b: Bounds | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function center(b: Bounds): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Наименьшая рамка, содержащая обе рамки. */
export function union(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function inside(p: Point, b: Bounds): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
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

const RECT_HULL: Hull = { type: 'rect' };

/** Форма фигуры для попадания и привязки. Рукописный штрих считается своей рамкой. */
function hullOf(shape: ShapeElement): Hull {
  return shape.kind === 'path' ? RECT_HULL : shapeSpec(shape.kind).hull;
}

/** Точка на границе фигуры по направлению из её центра к точке toward. */
export function boundaryPoint(shape: ShapeElement, toward: Point): Point {
  const c = center(shape);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = shape.w / 2;
  const hh = shape.h / 2;
  if ((dx === 0 && dy === 0) || hw === 0 || hh === 0) return c;
  const hull = hullOf(shape);
  let t: number;
  switch (hull.type) {
    case 'ellipse':
      t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
      break;
    case 'polygon':
      t = rayExit(c, { x: dx, y: dy }, hull.points(shape));
      break;
    case 'rect':
      t = Math.min(
        dx === 0 ? Infinity : hw / Math.abs(dx),
        dy === 0 ? Infinity : hh / Math.abs(dy),
      );
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** Привязывает ли фигура конец стрелки к точке на своей оси, а не к краю. */
export function isAnchored(shape: ShapeElement): boolean {
  return shape.kind !== 'path' && shapeSpec(shape.kind).anchored === true;
}

/**
 * Конец стрелки, привязанный к фигуре в точке world. У линии жизни запоминается высота,
 * на которой её коснулись: сообщения в диаграмме последовательности идут на своём уровне.
 */
export function bindEnd(shape: ShapeElement, world: Point): ArrowEnd {
  const end: ArrowEnd = { x: world.x, y: world.y, shapeId: shape.id };
  if (!isAnchored(shape) || shape.h === 0) return end;
  const fy = Math.max(0, Math.min(1, (world.y - shape.y) / shape.h));
  return { ...end, anchor: { x: 0.5, y: fy } };
}

/** Точка привязки на оси фигуры или null, если конец цепляется к краю фигуры. */
function anchorPoint(shape: ShapeElement, end: ArrowEnd): Point | null {
  if (!end.anchor || !isAnchored(shape)) return null;
  return { x: shape.x + shape.w * end.anchor.x, y: shape.y + shape.h * end.anchor.y };
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
  // Конец, привязанный к оси линии жизни, ведёт себя как свободная точка на этой оси.
  const startAnchor = startShape && anchorPoint(startShape, arrow.start);
  const endAnchor = endShape && anchorPoint(endShape, arrow.end);
  if (startAnchor || endAnchor) {
    return elbowPath(
      {
        ...arrow,
        start: startAnchor ?? arrow.start,
        end: endAnchor ?? arrow.end,
      },
      startAnchor ? undefined : startShape,
      endAnchor ? undefined : endShape,
    );
  }
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
  const startFixed = startShape && anchorPoint(startShape, arrow.start);
  const endFixed = endShape && anchorPoint(endShape, arrow.end);
  // Направление на другой конец: от его точки привязки или центра его фигуры.
  const startAim = startFixed ?? (startShape ? center(startShape) : arrow.start);
  const endAim = endFixed ?? (endShape ? center(endShape) : arrow.end);
  const resolve = (
    end: ArrowEnd,
    shape: ShapeElement | undefined,
    fixed: Point | null | undefined,
    aim: Point,
  ): Point => {
    if (fixed) return fixed;
    return shape ? boundaryPoint(shape, aim) : { x: end.x, y: end.y };
  };
  return {
    start: resolve(arrow.start, startShape, startFixed, endAim),
    bends: [],
    end: resolve(arrow.end, endShape, endFixed, startAim),
  };
}

/**
 * Точка подписи стрелки: середина пути вдоль линии. У ровной ломаной из трёх участков
 * это середина среднего, соединяющего участка.
 */
export function labelAnchor(path: ArrowPath): Point {
  const legs = [...segments(pathVertices(path))];
  let rest = legs.reduce((sum, [a, b]) => sum + distance(a, b), 0) / 2;
  for (const [a, b] of legs) {
    const length = distance(a, b);
    if (length > 0 && rest <= length) {
      const t = rest / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= length;
  }
  return path.start;
}

/**
 * Рамка подписи стрелки или null, если подписи нет. Ширина текста здесь оценочная:
 * для попадания указателем и для границ элемента точность холста не нужна.
 */
export function arrowLabelBounds(arrow: ArrowElement, path: ArrowPath): Bounds | null {
  if (!arrow.text) return null;
  return labelLayout(arrow.text, labelAnchor(path), estimateMeasure(LABEL_FONT_SIZE)).box;
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
  const path = arrowPath(el, lookup);
  const line = boundsOf(pathVertices(path));
  const label = arrowLabelBounds(el, path);
  return label ? union(line, label) : line;
}

/**
 * Рамка всего, что видно у элементов, вместе с подписями, которые выходят за фигуру
 * (события BPMN). null — элементов нет.
 */
export function contentBounds(
  elements: readonly BoardElement[],
  lookup: ElementLookup,
): Bounds | null {
  let result: Bounds | null = null;
  for (const el of elements) {
    let bounds = elementBounds(el, lookup);
    if (!isArrow(el) && el.kind !== 'path' && el.text) {
      bounds = union(bounds, shapeSpec(el.kind).textBox(el));
    }
    result = result ? union(result, bounds) : bounds;
  }
  return result;
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
    const path = arrowPath(el, lookup);
    for (const [a, b] of segments(pathVertices(path))) {
      if (distanceToSegment(p, a, b) <= tolerance) return true;
    }
    const label = arrowLabelBounds(el, path);
    return label !== null && inside(p, label);
  }
  if (el.kind === 'path') {
    for (const [a, b] of segments(pathPoints(el))) {
      if (distanceToSegment(p, a, b) <= tolerance + PATH_HIT_SLACK) return true;
    }
    return false;
  }
  const spec = shapeSpec(el.kind);
  if (spec.hit) return spec.hit(el, p, tolerance);
  const { hull } = spec;
  if (hull.type === 'polygon') {
    const polygon = hull.points(el);
    if (insideConvex(p, polygon)) return true;
    for (const [a, b] of edges(polygon)) {
      if (distanceToSegment(p, a, b) <= tolerance) return true;
    }
    return false;
  }
  const c = center(el);
  const hw = el.w / 2 + tolerance;
  const hh = el.h / 2 + tolerance;
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  return hull.type === 'ellipse' ? (dx / hw) ** 2 + (dy / hh) ** 2 <= 1 : dx <= hw && dy <= hh;
}
