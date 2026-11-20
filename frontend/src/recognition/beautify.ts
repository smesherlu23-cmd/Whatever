import type { Bounds, Point, ShapeKind } from '../model/types';

export const SNAP_STEP = 8;
/** Насколько стороны могут различаться, чтобы фигура стала квадратом или кругом. */
const SQUARE_TOLERANCE = 0.15;
/** Насколько размеры соседа могут отличаться, чтобы взять его размер. */
const SIZE_MATCH_TOLERANCE = 0.2;
const AXIS_SNAP_DEGREES = 8;

export interface Neighbour {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

const snap = (value: number, step = SNAP_STEP) => Math.round(value / step) * step;

/** Ближайшее к value из candidates, если оно не дальше maxDistance. */
function nearestWithin(
  candidates: readonly number[],
  value: number,
  maxDistance: number,
): number | undefined {
  let best: number | undefined;
  let bestDistance = maxDistance;
  for (const candidate of candidates) {
    const d = Math.abs(candidate - value);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Делает распознанную фигуру аккуратной: почти квадрат — квадрат, размер как у похожего
 * соседа, центр на одной линии с соседями, координаты по сетке.
 */
export function beautifyBounds(
  kind: ShapeKind,
  raw: Bounds,
  neighbours: readonly Neighbour[],
  alignDistance: number,
): Bounds {
  let { w, h } = raw;
  const cx = raw.x + raw.w / 2;
  const cy = raw.y + raw.h / 2;

  if (Math.abs(w - h) / Math.max(w, h) < SQUARE_TOLERANCE) {
    w = h = (w + h) / 2;
  }

  const sameKind = neighbours.filter((n) => n.kind === kind);
  const similar = sameKind.find(
    (n) =>
      Math.abs(n.w - w) / Math.max(n.w, w) < SIZE_MATCH_TOLERANCE &&
      Math.abs(n.h - h) / Math.max(n.h, h) < SIZE_MATCH_TOLERANCE,
  );
  if (similar) {
    w = similar.w;
    h = similar.h;
  } else {
    w = Math.max(SNAP_STEP, snap(w));
    h = Math.max(SNAP_STEP, snap(h));
  }

  const alignedCx = nearestWithin(
    neighbours.map((n) => n.x + n.w / 2),
    cx,
    alignDistance,
  );
  const alignedCy = nearestWithin(
    neighbours.map((n) => n.y + n.h / 2),
    cy,
    alignDistance,
  );
  const x = alignedCx === undefined ? snap(cx - w / 2) : alignedCx - w / 2;
  const y = alignedCy === undefined ? snap(cy - h / 2) : alignedCy - h / 2;
  return { x, y, w, h };
}

/** Почти горизонтальную или вертикальную линию делает строго такой. */
export function straightenLine(start: Point, end: Point): { start: Point; end: Point } {
  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  const horizontal = Math.min(Math.abs(angle), 180 - Math.abs(angle));
  const vertical = Math.abs(90 - Math.abs(angle));
  if (horizontal < AXIS_SNAP_DEGREES) {
    const y = (start.y + end.y) / 2;
    return { start: { x: start.x, y }, end: { x: end.x, y } };
  }
  if (vertical < AXIS_SNAP_DEGREES) {
    const x = (start.x + end.x) / 2;
    return { start: { x, y: start.y }, end: { x, y: end.y } };
  }
  return { start, end };
}
