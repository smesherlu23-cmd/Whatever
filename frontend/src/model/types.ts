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

/**
 * Наконечник на конце стрелки. Кроме обычных стрелок, это обозначения UML (пустой
 * треугольник — наследование, ромбы — агрегация и композиция) и нотации «воронья лапка»
 * для связей ER: one — ровно один, zeroOrOne — ноль или один, many — один или много,
 * zeroOrMany — ноль или много.
 */
export type ArrowHead =
  | 'none'
  | 'arrow'
  | 'open'
  | 'triangle'
  | 'diamond'
  | 'filledDiamond'
  | 'circle'
  | 'one'
  | 'zeroOrOne'
  | 'many'
  | 'zeroOrMany';

export const ARROW_HEADS: readonly ArrowHead[] = [
  'none',
  'arrow',
  'open',
  'triangle',
  'diamond',
  'filledDiamond',
  'circle',
  'one',
  'zeroOrOne',
  'many',
  'zeroOrMany',
];

/** Вид стрелки, который выбирают на панели: линия, наконечники и пунктир. */
export interface ArrowStyle {
  route: ArrowRoute;
  startHead: ArrowHead;
  endHead: ArrowHead;
  dashed: boolean;
}

/** Так выглядят новые стрелки и стрелки, нарисованные до появления наконечников. */
export const DEFAULT_ARROW_STYLE: ArrowStyle = Object.freeze({
  route: 'straight',
  startHead: 'none',
  endHead: 'arrow',
  dashed: false,
});

/** Страница, на которой лежат элементы, нарисованные до появления страниц. */
export const DEFAULT_PAGE = 'main';

/** Страница доски. Порядок вкладок задаёт order, а не место в документе. */
export interface Page {
  id: string;
  name: string;
  order: number;
}

export interface ShapeElement {
  id: string;
  kind: ShapeKind;
  /** id страницы. У элементов, нарисованных до появления страниц, — DEFAULT_PAGE. */
  page: string;
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

export interface ArrowElement extends ArrowStyle {
  id: string;
  kind: 'arrow';
  page: string;
  start: ArrowEnd;
  end: ArrowEnd;
  /** Подпись посередине линии. */
  text: string;
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
