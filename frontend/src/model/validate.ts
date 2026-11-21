import { type ArrowEnd, type BoardElement, type Point, SHAPE_KINDS, type ShapeKind } from './types';

/*
 * Проверка данных, пришедших от других участников. Документ доски и присутствие приходят
 * по сети от чужих клиентов, поэтому им не доверяем: элемент с битыми полями пропускается,
 * а не ломает отрисовку у всех.
 */

type Fields = Record<string, unknown>;

export const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === 'string';

export function isPoint(value: unknown): value is Point {
  return isRecord(value) && isNumber(value.x) && isNumber(value.y);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isShapeKind(value: unknown): value is ShapeKind {
  return SHAPE_KINDS.some((kind) => kind === value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

function isArrowEnd(value: unknown): value is ArrowEnd {
  return (
    isRecord(value) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    (value.shapeId === undefined || isString(value.shapeId))
  );
}

/** Элемент доски из данных Yjs или null, если данные не похожи на элемент. */
export function parseElement(value: unknown): BoardElement | null {
  if (!isRecord(value) || !isString(value.id) || !isNumber(value.z) || !isString(value.stroke)) {
    return null;
  }
  const { id, z, stroke } = value;
  if (value.kind === 'arrow') {
    const { start, end } = value;
    // У стрелок, нарисованных до появления ломаных, поля route нет: они прямые.
    const route = value.route === 'elbow' ? 'elbow' : 'straight';
    return isArrowEnd(start) && isArrowEnd(end)
      ? { id, kind: 'arrow', start, end, route, stroke, z }
      : null;
  }
  const { kind, x, y, w, h, text, fill, points } = value;
  if (!isShapeKind(kind) || !isNumber(x) || !isNumber(y) || !isNumber(w) || !isNumber(h)) {
    return null;
  }
  if (!isString(text) || !isString(fill)) return null;
  const shape = { id, kind, x, y, w, h, text, fill, stroke, z };
  if (points === undefined) return shape;
  return isNumberArray(points) ? { ...shape, points } : null;
}
