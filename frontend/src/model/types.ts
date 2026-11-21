import type { Point } from '../canvas/camera';

/**
 * rounded — прямоугольник с заметно скруглёнными углами, triangle — равнобедренный
 * треугольник вершиной вверх, sticky — стикер, path — рукописный штрих, который не распознан.
 */
export type ShapeKind =
  'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'triangle' | 'sticky' | 'text' | 'path';

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
  'triangle',
  'sticky',
  'text',
  'path',
];

/** straight — отрезок между концами, elbow — ломаная из горизонтальных и вертикальных участков. */
export type ArrowRoute = 'straight' | 'elbow';

export interface ShapeElement {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  stroke: string;
  fill: string;
  z: number;
  /** Только для path: точки x0, y0, x1, y1, … в долях рамки (0..1). */
  points?: number[];
}

/** Конец стрелки: свободная точка или привязка к фигуре. */
export interface ArrowEnd {
  x: number;
  y: number;
  shapeId?: string;
}

export interface ArrowElement {
  id: string;
  kind: 'arrow';
  start: ArrowEnd;
  end: ArrowEnd;
  route: ArrowRoute;
  stroke: string;
  z: number;
}

export type BoardElement = ShapeElement | ArrowElement;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type { Point };

export function isArrow(el: BoardElement): el is ArrowElement {
  return el.kind === 'arrow';
}

export const DEFAULT_STROKE = '#43434a';
export const DEFAULT_FILL = '#ffffff';
/** Цвет стикера по умолчанию. На экране, как и остальные цвета по умолчанию, зависит от темы. */
export const DEFAULT_STICKY_FILL = '#fbe9a0';
