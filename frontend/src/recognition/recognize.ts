import type { Bounds, Point } from '../model/types';

export type Recognized =
  | { kind: 'rectangle' | 'ellipse' | 'diamond'; bounds: Bounds; error: number }
  | { kind: 'line'; start: Point; end: Point; error: number }
  | { kind: 'none' };

/** Порог средней ошибки подгонки: выше него штрих остаётся рукописным. */
export const MAX_SHAPE_ERROR = 0.12;
const MAX_LINE_ERROR = 0.06;
const MIN_SIZE = 10;

export function pathLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

export function boundsOf(points: Point[]): Bounds {
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

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length;
}

/** Упрощение ломаной алгоритмом Рамера — Дугласа — Пекера: убирает дрожание руки. */
export function simplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice();
  let maxDistance = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDistance) {
      maxDistance = d;
      index = i;
    }
  }
  if (maxDistance <= epsilon) return [first, last];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Равномерная передискретизация, чтобы медленные участки штриха не весили больше быстрых. */
export function resample(points: Point[], count: number): Point[] {
  const total = pathLength(points);
  if (total === 0 || points.length < 2) return points.slice();
  const step = total / (count - 1);
  const result: Point[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let segment = Math.hypot(b.x - a.x, b.y - a.y);
    while (carried + segment >= step && result.length < count) {
      const t = (step - carried) / segment;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      result.push(p);
      a = p;
      segment = Math.hypot(b.x - a.x, b.y - a.y);
      carried = 0;
    }
    carried += segment;
  }
  while (result.length < count) result.push(points[points.length - 1]);
  return result;
}

/** Средняя ошибка подгонки замкнутого штриха под фигуру, вписанную в рамку. 0 — идеально. */
function fitError(kind: 'rectangle' | 'ellipse' | 'diamond', points: Point[], b: Bounds): number {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const hw = b.w / 2;
  const hh = b.h / 2;
  let sum = 0;
  for (const p of points) {
    const nx = (p.x - cx) / hw;
    const ny = (p.y - cy) / hh;
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
    }
  }
  return sum / points.length;
}

/**
 * Распознаёт штрих: прямая (станет стрелкой), прямоугольник, эллипс, ромб
 * или «не распознано», если ни одна фигура не подходит достаточно хорошо.
 */
export function recognize(raw: Point[]): Recognized {
  if (raw.length < 2) return { kind: 'none' };
  const bounds = boundsOf(raw);
  const diagonal = Math.hypot(bounds.w, bounds.h);
  if (diagonal < MIN_SIZE) return { kind: 'none' };

  const points = resample(raw, 64);
  const length = pathLength(raw);
  const start = raw[0];
  const end = raw[raw.length - 1];
  const gap = Math.hypot(end.x - start.x, end.y - start.y);

  // Открытый почти прямой штрих — линия.
  const chord = gap / length;
  if (chord > 0.9) {
    let deviation = 0;
    for (const p of points) deviation += perpendicularDistance(p, start, end);
    const error = deviation / points.length / Math.max(gap, 1);
    if (error <= MAX_LINE_ERROR) return { kind: 'line', start, end, error };
  }

  // Замкнутый штрих: конец вернулся близко к началу.
  const closed = gap < Math.max(0.3 * diagonal, 16) && length > 2 * diagonal * 0.9;
  if (!closed || bounds.w < MIN_SIZE || bounds.h < MIN_SIZE) return { kind: 'none' };

  const candidates = (['rectangle', 'ellipse', 'diamond'] as const).map((kind) => ({
    kind,
    error: fitError(kind, points, bounds),
  }));
  candidates.sort((a, b) => a.error - b.error);
  const best = candidates[0];
  if (best.error > MAX_SHAPE_ERROR) return { kind: 'none' };
  return { kind: best.kind, bounds, error: best.error };
}
