import type { Bounds, Point } from '../model/types';

export const SNAP_STEP = 8;
/** Насколько стороны могут различаться, чтобы фигура стала квадратом или кругом. */
const SQUARE_TOLERANCE = 0.15;
/** Насколько размеры соседа могут отличаться, чтобы взять его размер. */
const SIZE_MATCH_TOLERANCE = 0.2;
const AXIS_SNAP_DEGREES = 8;

export interface Neighbour {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const snap = (value: number, step = SNAP_STEP) => Math.round(value / step) * step;

/**
 * Делает распознанную фигуру аккуратной: почти квадрат — квадрат, размер как у похожего
 * соседа, центр на одной линии с соседями, координаты по сетке.
 */
export function beautifyBounds(
  kind: string,
  raw: Bounds,
  neighbours: Neighbour[],
  alignDistance: number,
): Bounds {
  let { w, h } = raw;
  let cx = raw.x + raw.w / 2;
  let cy = raw.y + raw.h / 2;

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

  let alignedX = false;
  let alignedY = false;
  let bestX = alignDistance;
  let bestY = alignDistance;
  for (const n of neighbours) {
    const ncx = n.x + n.w / 2;
    const ncy = n.y + n.h / 2;
    if (Math.abs(ncx - cx) < bestX) {
      bestX = Math.abs(ncx - cx);
      cx = ncx;
      alignedX = true;
    }
    if (Math.abs(ncy - cy) < bestY) {
      bestY = Math.abs(ncy - cy);
      cy = ncy;
      alignedY = true;
    }
  }

  const x = alignedX ? cx - w / 2 : snap(cx - w / 2);
  const y = alignedY ? cy - h / 2 : snap(cy - h / 2);
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
