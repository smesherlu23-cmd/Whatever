import { describe, expect, it } from 'vitest';
import { arrowPath, bindEnd, boundaryPoint, hitTest } from './geometry';
import { SvgPath } from './pathSink';
import { hasText } from './queries';
import { type CatalogKind, SHAPES, compartments, shapeSpec } from './shapes';
import type { ArrowElement, ShapeElement } from './types';
import { DEFAULT_ARROW_STYLE, SHAPE_KINDS } from './types';

const shape = (kind: ShapeElement['kind'], x = 0, y = 0, w = 100, h = 100): ShapeElement => ({
  id: kind,
  kind,
  page: 'main',
  x,
  y,
  w,
  h,
  text: '',
  stroke: '#000',
  fill: '#fff',
  z: 1,
});

const none = () => undefined;

describe('shape catalog', () => {
  it('describes every kind of shape except a hand-drawn path', () => {
    expect(Object.keys(SHAPES).sort()).toEqual(SHAPE_KINDS.filter((k) => k !== 'path').sort());
  });

  it.each(Object.keys(SHAPES) as CatalogKind[])('draws %s into an SVG path', (kind) => {
    const spec = shapeSpec(kind);
    const outline = new SvgPath();
    spec.outline(outline, { x: 0, y: 0, ...spec.size });
    expect(outline.toString()).toMatch(/^M/);
    const box = spec.textBox({ x: 0, y: 0, ...spec.size });
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });

  it('gives text to every shape but hand-drawn paths, pictures and attachments', () => {
    const withoutText = SHAPE_KINDS.filter((kind) => !hasText(shape(kind)));
    expect(withoutText).toEqual(['image', 'file', 'path']);
  });

  it('splits the text of a class into compartments', () => {
    expect(compartments('Заказ\n--\nid: uuid\nсумма: money\n -- \nоплатить()')).toEqual([
      ['Заказ'],
      ['id: uuid', 'сумма: money'],
      ['оплатить()'],
    ]);
    expect(compartments('')).toEqual([['']]);
  });
});

describe('SvgPath', () => {
  it('turns canvas commands into SVG path data', () => {
    const path = new SvgPath();
    path.lineTo(0, 0);
    path.quadraticCurveTo(5, 5, 10, 0);
    path.bezierCurveTo(10, 5, 5, 10, 0, 10);
    path.closePath();
    path.ellipse(50, 50, 10, 10, 0, 0, Math.PI * 2);
    path.ellipse(50, 50, 10, 5, 0, 0, Math.PI, true);
    path.rect(0, 0, 4, 4);
    expect(path.toString()).toBe(
      [
        'M0 0',
        'Q5 5 10 0',
        'C10 5 5 10 0 10',
        'Z',
        'L60 50',
        'A10 10 0 0 1 40 50',
        'A10 10 0 0 1 60 50',
        'L60 50',
        'A10 5 0 0 0 40 50',
        'M0 0 L4 0 L4 0 L4 4 L4 4 L0 4 L0 4 L0 0 L0 0 Z',
      ].join(' '),
    );
    const curve = new SvgPath();
    curve.bezierCurveTo(1, 1, 2, 2, 3, 3);
    curve.quadraticCurveTo(4, 4, 5, 5);
    expect(curve.toString()).toBe('M1 1 C1 1 2 2 3 3 Q4 4 5 5');
    const quad = new SvgPath();
    quad.quadraticCurveTo(1, 1, 2, 2);
    expect(quad.toString()).toBe('M1 1 Q1 1 2 2');
  });
});

describe('geometry of catalog shapes', () => {
  it('finds boundary points of polygons', () => {
    const data = shape('data', 0, 0, 100, 50);
    // Параллелограмм скошен на 20: справа на середине высоты край на x = 90.
    expect(boundaryPoint(data, { x: 500, y: 25 })).toEqual({ x: 90, y: 25 });
    const hexagon = shape('hexagon', 0, 0, 100, 50);
    expect(boundaryPoint(hexagon, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 });
  });

  it('lets the pointer through the inside of a container', () => {
    const frame = shape('frame', 0, 0, 400, 300);
    expect(hitTest(frame, { x: 200, y: 150 }, none, 4)).toBe(false);
    expect(hitTest(frame, { x: 200, y: 10 }, none, 4)).toBe(true);
    expect(hitTest(frame, { x: 398, y: 150 }, none, 4)).toBe(true);
    const lane = shape('lane', 0, 0, 600, 150);
    expect(hitTest(lane, { x: 10, y: 75 }, none, 4)).toBe(true);
    expect(hitTest(lane, { x: 300, y: 75 }, none, 4)).toBe(false);
  });

  it('hits a lifeline by its head and its line only', () => {
    const lifeline = shape('lifeline', 0, 0, 120, 400);
    expect(hitTest(lifeline, { x: 10, y: 20 }, none, 4)).toBe(true);
    expect(hitTest(lifeline, { x: 62, y: 300 }, none, 4)).toBe(true);
    expect(hitTest(lifeline, { x: 10, y: 300 }, none, 4)).toBe(false);
  });

  it('keeps a message on a lifeline at the height where it was attached', () => {
    const a = { ...shape('lifeline', 0, 0, 120, 400), id: 'a' };
    const b = { ...shape('lifeline', 400, 0, 120, 400), id: 'b' };
    const lookup = (id: string) => (id === 'a' ? a : id === 'b' ? b : undefined);
    const start = bindEnd(a, { x: 60, y: 200 });
    const end = bindEnd(b, { x: 455, y: 200 });
    expect(start.anchor).toEqual({ x: 0.5, y: 0.5 });
    const message: ArrowElement = {
      id: 'm',
      kind: 'arrow',
      page: 'main',
      start,
      end,
      text: 'запрос',
      ...DEFAULT_ARROW_STYLE,
      stroke: '#000',
      z: 3,
    };
    expect(arrowPath(message, lookup)).toEqual({
      start: { x: 60, y: 200 },
      bends: [],
      end: { x: 460, y: 200 },
    });
    // Ломаная от линии жизни к обычной фигуре выходит из точки на линии.
    const box = { ...shape('rectangle', 300, 500, 100, 50), id: 'box' };
    const elbow = arrowPath(
      { ...message, route: 'elbow', end: { x: 0, y: 0, shapeId: 'box' } },
      (id) => (id === 'box' ? box : lookup(id)),
    );
    expect(elbow.start).toEqual({ x: 60, y: 200 });
    // Обычная фигура не запоминает точку привязки.
    expect(bindEnd(box, { x: 310, y: 510 }).anchor).toBeUndefined();
  });
});
