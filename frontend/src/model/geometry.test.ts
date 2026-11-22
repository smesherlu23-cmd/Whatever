import { describe, expect, it } from 'vitest';
import {
  arrowLabelBounds,
  arrowPath,
  boundaryPoint,
  elementBounds,
  hitTest,
  labelAnchor,
  resolveArrow,
} from './geometry';
import type { ArrowElement, BoardElement, ShapeElement } from './types';

const shape = (kind: ShapeElement['kind'], x = 0, y = 0): ShapeElement => ({
  id: kind,
  kind,
  page: 'main',
  x,
  y,
  w: 100,
  h: 100,
  text: '',
  stroke: '#000',
  fill: '#fff',
  z: 1,
});
const none = () => undefined;

describe('geometry', () => {
  it('hit-tests each shape by its real outline', () => {
    const corner = { x: 5, y: 5 };
    expect(hitTest(shape('rectangle'), corner, none, 0)).toBe(true);
    expect(hitTest(shape('ellipse'), corner, none, 0)).toBe(false);
    expect(hitTest(shape('diamond'), corner, none, 0)).toBe(false);
    expect(hitTest(shape('diamond'), { x: 50, y: 5 }, none, 0)).toBe(true);
    expect(hitTest(shape('triangle'), corner, none, 0)).toBe(false);
    expect(hitTest(shape('triangle'), { x: 50, y: 60 }, none, 0)).toBe(true);
    // Рядом с наклонной стороной снаружи: попадание только с допуском.
    expect(hitTest(shape('triangle'), { x: 22, y: 50 }, none, 0)).toBe(false);
    expect(hitTest(shape('triangle'), { x: 22, y: 50 }, none, 4)).toBe(true);
    for (const kind of ['rounded', 'sticky'] as const) {
      expect(hitTest(shape(kind), corner, none, 0)).toBe(true);
    }
  });

  it('finds the boundary point toward a target', () => {
    expect(boundaryPoint(shape('rectangle'), { x: 300, y: 50 })).toEqual({ x: 100, y: 50 });
    const p = boundaryPoint(shape('ellipse'), { x: 300, y: 300 });
    expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(50);
    // У треугольника на середине высоты ширина вдвое меньше рамки.
    const side = boundaryPoint(shape('triangle'), { x: 300, y: 50 });
    expect(side.x).toBeCloseTo(75);
    expect(side.y).toBeCloseTo(50);
    expect(boundaryPoint(shape('triangle'), { x: 50, y: -300 })).toEqual({ x: 50, y: 0 });
  });

  it('attaches arrow ends to the edges of bound shapes', () => {
    const a = shape('rectangle', 0, 0);
    const b = { ...shape('rectangle', 300, 0), id: 'b' };
    const elements = new Map<string, BoardElement>([
      ['rectangle', a],
      ['b', b],
    ]);
    const arrow: ArrowElement = {
      id: 'arr',
      kind: 'arrow',
      page: 'main',
      route: 'straight',
      startHead: 'none',
      endHead: 'arrow',
      dashed: false,
      text: '',
      start: { x: 0, y: 0, shapeId: 'rectangle' },
      end: { x: 0, y: 0, shapeId: 'b' },
      stroke: '#000',
      z: 2,
    };
    const { start, end } = resolveArrow(arrow, (id) => elements.get(id));
    expect(start).toEqual({ x: 100, y: 50 });
    expect(end).toEqual({ x: 300, y: 50 });
    expect(hitTest(arrow, { x: 200, y: 53 }, (id) => elements.get(id), 4)).toBe(true);
  });
});

describe('elbow arrows', () => {
  const a = shape('rectangle', 0, 0);
  const b = { ...shape('rectangle', 300, 200), id: 'b' };
  const elements = new Map<string, BoardElement>([
    ['rectangle', a],
    ['b', b],
  ]);
  const lookup = (id: string) => elements.get(id);
  const arrow: ArrowElement = {
    id: 'arr',
    kind: 'arrow',
    page: 'main',
    route: 'elbow',
    startHead: 'none',
    endHead: 'arrow',
    dashed: false,
    text: '',
    start: { x: 0, y: 0, shapeId: 'rectangle' },
    end: { x: 0, y: 0, shapeId: 'b' },
    stroke: '#000',
    z: 2,
  };

  it('leaves and enters shapes through the sides facing each other', () => {
    expect(arrowPath(arrow, lookup)).toEqual({
      start: { x: 100, y: 50 },
      bends: [
        { x: 200, y: 50 },
        { x: 200, y: 250 },
      ],
      end: { x: 300, y: 250 },
    });
  });

  it('goes vertically first when the shapes are mostly one above the other', () => {
    const below = { ...shape('rectangle', 40, 400), id: 'b' };
    const path = arrowPath(arrow, (id) => (id === 'b' ? below : a));
    expect(path.start).toEqual({ x: 50, y: 100 });
    expect(path.end).toEqual({ x: 90, y: 400 });
    expect(path.bends).toEqual([
      { x: 50, y: 250 },
      { x: 90, y: 250 },
    ]);
  });

  it('goes straight instead of a tiny step when the shapes are almost in line', () => {
    const near = { ...shape('rectangle', 300, 8), id: 'b' };
    const path = arrowPath(arrow, (id) => (id === 'b' ? near : a));
    expect(path).toEqual({ start: { x: 100, y: 50 }, bends: [], end: { x: 300, y: 50 } });
  });

  it('is hit and measured along its bends, not along the chord', () => {
    expect(hitTest(arrow, { x: 202, y: 150 }, lookup, 4)).toBe(true);
    expect(hitTest(arrow, { x: 150, y: 150 }, lookup, 4)).toBe(false);
    expect(elementBounds(arrow, lookup)).toEqual({ x: 100, y: 50, w: 200, h: 200 });
  });

  it('keeps free ends where they were dropped', () => {
    const free: ArrowElement = { ...arrow, start: { x: 0, y: 0 }, end: { x: 100, y: 40 } };
    expect(arrowPath(free, none)).toEqual({
      start: { x: 0, y: 0 },
      bends: [
        { x: 50, y: 0 },
        { x: 50, y: 40 },
      ],
      end: { x: 100, y: 40 },
    });
  });
});

describe('arrow labels', () => {
  const free: ArrowElement = {
    id: 'arr',
    kind: 'arrow',
    page: 'main',
    route: 'straight',
    startHead: 'none',
    endHead: 'arrow',
    dashed: false,
    text: 'HTTPS',
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 },
    stroke: '#000',
    z: 1,
  };
  const none = () => undefined;

  it('stands halfway along the line', () => {
    expect(labelAnchor(arrowPath(free, none))).toEqual({ x: 100, y: 0 });
    // Ломаная вниз, вбок и снова вниз: середина пути — середина среднего участка.
    const elbow = { ...free, route: 'elbow' as const, end: { x: 100, y: 300 } };
    expect(labelAnchor(arrowPath(elbow, none))).toEqual({ x: 50, y: 150 });
    const dot = { start: { x: 5, y: 5 }, bends: [], end: { x: 5, y: 5 } };
    expect(labelAnchor(dot)).toEqual({ x: 5, y: 5 });
  });

  it('can be hit and counts in the bounds of the arrow', () => {
    expect(hitTest(free, { x: 100, y: 10 }, none, 2)).toBe(true);
    expect(hitTest({ ...free, text: '' }, { x: 100, y: 10 }, none, 2)).toBe(false);
    const bounds = elementBounds(free, none);
    expect(bounds.y).toBeLessThan(0);
    expect(bounds.h).toBeGreaterThan(0);
    expect(arrowLabelBounds({ ...free, text: '' }, arrowPath(free, none))).toBeNull();
  });
});
