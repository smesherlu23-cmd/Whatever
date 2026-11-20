import { describe, expect, it } from 'vitest';
import { boundaryPoint, hitTest, resolveArrow } from './geometry';
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
  });

  it('finds the boundary point toward a target', () => {
    expect(boundaryPoint(shape('rectangle'), { x: 300, y: 50 })).toEqual({ x: 100, y: 50 });
    const p = boundaryPoint(shape('ellipse'), { x: 300, y: 300 });
    expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(50);
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
