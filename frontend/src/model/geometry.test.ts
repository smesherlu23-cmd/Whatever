import { describe, expect, it } from 'vitest';
import { arrowPath, boundaryPoint, elementBounds, hitTest, resolveArrow } from './geometry';
import type { ArrowElement, BoardElement, ShapeElement } from './types';

const shape = (kind: ShapeElement['kind'], x = 0, y = 0): ShapeElement => ({
  id: kind,
  kind,
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
      route: 'straight',
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
    route: 'elbow',
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
