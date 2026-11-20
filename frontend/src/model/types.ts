import type { Point } from '../canvas/camera';

export type ShapeKind = 'rectangle' | 'ellipse' | 'diamond' | 'text';

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
