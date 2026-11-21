import { boundsOf, distance, distanceToSegment, segments } from '../model/geometry';
import type { Bounds, Point } from '../model/types';

export type Recognized =
  | { kind: ClosedKind; bounds: Bounds; error: number }
  | { kind: 'line'; start: Point; end: Point; error: number }
  | { kind: 'none' };

type ClosedKind = 'rectangle' | 'ellipse' | 'diamond' | 'triangle';
const CLOSED_KINDS: readonly ClosedKind[] = ['rectangle', 'ellipse', 'diamond', 'triangle'];

/** Треугольник вершиной вверх в квадрате [-1, 1] × [-1, 1]. */
const UNIT_TRIANGLE = [
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
] as const;

/** Порог средней ошибки подгонки: выше него штрих остаётся рукописным. */
export const MAX_SHAPE_ERROR = 0.12;
/** Средняя удалённость точек от хорды (в долях её длины), при которой штрих ещё прямая. */
const MAX_LINE_ERROR = 0.06;
/** Хорда должна быть не короче этой доли длины штриха, чтобы считать его прямой. */
const MIN_LINE_CHORD = 0.9;
/** Штрих меньше этого размера — случайный щелчок, а не фигура. */
const MIN_SIZE = 10;
/** Число точек после передискретизации: хватает для точной подгонки и считается быстро. */
const SAMPLE_COUNT = 64;

export function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (const [a, b] of segments(points)) length += distance(a, b);
  return length;
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const length = distance(a, b);
  if (length === 0) return distance(p, a);
  return Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / length;
}

/** Упрощение ломаной алгоритмом Рамера — Дугласа — Пекера: убирает дрожание руки. */
export function simplify(points: readonly Point[], epsilon: number): Point[] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 3) return [...points];
  let maxDistance = 0;
  let index = 0;
  points.forEach((p, i) => {
    const d = perpendicularDistance(p, first, last);
    if (i > 0 && i < points.length - 1 && d > maxDistance) {
      maxDistance = d;
      index = i;
    }
  });
  if (maxDistance <= epsilon) return [first, last];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Равномерная передискретизация, чтобы медленные участки штриха не весили больше быстрых. */
export function resample(points: readonly Point[], count: number): Point[] {
  const first = points[0];
  const last = points.at(-1);
  const total = pathLength(points);
  if (!first || !last || total === 0) return [...points];

  const step = total / (count - 1);
  const result: Point[] = [first];
  let carried = 0;
  for (const [from, to] of segments(points)) {
    let a = from;
    let segment = distance(a, to);
    while (carried + segment >= step && result.length < count) {
      const t = (step - carried) / segment;
      a = { x: a.x + (to.x - a.x) * t, y: a.y + (to.y - a.y) * t };
      result.push(a);
      segment = distance(a, to);
      carried = 0;
    }
    carried += segment;
  }
  while (result.length < count) result.push(last);
  return result;
}

/** Средняя ошибка подгонки замкнутого штриха под фигуру, вписанную в рамку. 0 — идеально. */
function fitError(kind: ClosedKind, points: readonly Point[], b: Bounds): number {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let sum = 0;
  for (const p of points) {
    // Координаты в системе, где фигура вписана в квадрат [-1, 1] × [-1, 1].
    const nx = (p.x - cx) / (b.w / 2);
    const ny = (p.y - cy) / (b.h / 2);
    switch (kind) {
      case 'ellipse':
        sum += Math.abs(Math.hypot(nx, ny) - 1);
        break;
      case 'diamond':
        sum += Math.abs(Math.abs(nx) + Math.abs(ny) - 1);
        break;
      case 'rectangle':
        sum += Math.min(1 - Math.abs(nx), 1 - Math.abs(ny));
        break;
      case 'triangle': {
        const [top, right, left] = UNIT_TRIANGLE;
        const p = { x: nx, y: ny };
        sum += Math.min(
          distanceToSegment(p, top, right),
          distanceToSegment(p, right, left),
          distanceToSegment(p, left, top),
        );
        break;
      }
    }
  }
  return sum / points.length;
}

function recognizeLine(points: readonly Point[], start: Point, end: Point): Recognized | null {
  const chord = distance(start, end);
  if (chord / pathLength(points) < MIN_LINE_CHORD) return null;
  let deviation = 0;
  for (const p of points) deviation += perpendicularDistance(p, start, end);
  const error = deviation / points.length / Math.max(chord, 1);
  return error <= MAX_LINE_ERROR ? { kind: 'line', start, end, error } : null;
}

/**
 * Распознаёт штрих: прямая (станет стрелкой), прямоугольник, эллипс, ромб, треугольник
 * или «не распознано», если ни одна фигура не подходит достаточно хорошо.
 */
export function recognize(raw: readonly Point[]): Recognized {
  const start = raw[0];
  const end = raw.at(-1);
  if (!start || !end || raw.length < 2) return { kind: 'none' };
  const bounds = boundsOf(raw);
  const diagonal = Math.hypot(bounds.w, bounds.h);
  if (diagonal < MIN_SIZE) return { kind: 'none' };

  const points = resample(raw, SAMPLE_COUNT);
  const line = recognizeLine(points, start, end);
  if (line) return line;

  // Замкнутый штрих: конец вернулся близко к началу, а длина не меньше обхода рамки.
  const closed =
    distance(start, end) < Math.max(0.3 * diagonal, 16) && pathLength(raw) > 1.8 * diagonal;
  if (!closed || bounds.w < MIN_SIZE || bounds.h < MIN_SIZE) return { kind: 'none' };

  let best: { kind: ClosedKind; error: number } = { kind: 'rectangle', error: Infinity };
  for (const kind of CLOSED_KINDS) {
    const error = fitError(kind, points, bounds);
    if (error < best.error) best = { kind, error };
  }
  return best.error <= MAX_SHAPE_ERROR ? { ...best, bounds } : { kind: 'none' };
}
