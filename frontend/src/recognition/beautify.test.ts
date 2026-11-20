import { describe, expect, it } from 'vitest';
import { beautifyBounds, straightenLine } from './beautify';

describe('beautifyBounds', () => {
  it('turns an almost-square into a square on the grid', () => {
    const b = beautifyBounds('ellipse', { x: 13, y: 21, w: 100, h: 108 }, [], 12);
    expect(b.w).toBe(b.h);
    expect(b.x % 8).toBe(0);
    expect(b.y % 8).toBe(0);
  });

  it('takes the size of a similar neighbour and lines up with it', () => {
    const neighbour = { kind: 'rectangle', x: 0, y: 0, w: 160, h: 80 };
    const b = beautifyBounds('rectangle', { x: 300, y: 6, w: 150, h: 86 }, [neighbour], 12);
    expect(b).toEqual({ x: 296, y: 0, w: 160, h: 80 });
  });
});

describe('straightenLine', () => {
  it('makes an almost horizontal line horizontal', () => {
    const { start, end } = straightenLine({ x: 0, y: 0 }, { x: 200, y: 10 });
    expect(start.y).toBe(end.y);
  });

  it('keeps a diagonal line', () => {
    const { start, end } = straightenLine({ x: 0, y: 0 }, { x: 100, y: 100 });
    expect(end).toEqual({ x: 100, y: 100 });
    expect(start).toEqual({ x: 0, y: 0 });
  });
});
