import type { Point } from '../canvas/camera';

/** path — рукописный штрих, который не распознан как фигура. */
export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'path';

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
