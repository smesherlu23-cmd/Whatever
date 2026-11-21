import { describe, expect, it } from 'vitest';
import { segments } from '../model/geometry';
import type { Point } from '../model/types';
import { recognize, resample, simplify } from './recognize';

/** Детерминированный «дрожащий» шум, как у руки. */
function jitter(points: Point[], amount: number): Point[] {
  return points.map((p, i) => ({
    x: p.x + Math.sin(i * 1.7) * amount,
    y: p.y + Math.cos(i * 2.3) * amount,
  }));
}

function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 60,
  overshoot = 0.05,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= n * (1 + overshoot); i++) {
    const t = (i / n) * Math.PI * 2 - Math.PI / 2;
    points.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return points;
}

function polyline(corners: Point[], perSide = 20): Point[] {
  const points: Point[] = [];
  for (const [a, b] of segments(corners)) {
    for (let k = 0; k < perSide; k++) {
      const t = k / perSide;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  const last = corners.at(-1);
  if (last) points.push(last);
  return points;
}

describe('recognize', () => {
  it('recognizes a wobbly circle', () => {
    const result = recognize(jitter(ellipse(100, 100, 60, 58), 3));
    expect(result.kind).toBe('ellipse');
  });

  it('recognizes a hand-drawn rectangle', () => {
    const rect = polyline([
      { x: 0, y: 0 },
      { x: 200, y: 4 },
      { x: 198, y: 100 },
      { x: 2, y: 96 },
      { x: 4, y: 6 },
    ]);
    const result = recognize(jitter(rect, 2));
    expect(result.kind).toBe('rectangle');
  });

  it('recognizes a diamond', () => {
    const diamond = polyline([
      { x: 100, y: 0 },
      { x: 200, y: 60 },
      { x: 100, y: 120 },
      { x: 0, y: 60 },
      { x: 98, y: 4 },
    ]);
    expect(recognize(jitter(diamond, 2)).kind).toBe('diamond');
  });

  it('recognizes a triangle', () => {
    const triangle = polyline([
      { x: 100, y: 0 },
      { x: 200, y: 160 },
      { x: 2, y: 156 },
      { x: 96, y: 6 },
    ]);
    const result = recognize(jitter(triangle, 2));
    expect(result.kind).toBe('triangle');
  });

  it('recognizes a straight line', () => {
    const line = polyline([
      { x: 0, y: 0 },
      { x: 300, y: 12 },
    ]);
    const result = recognize(jitter(line, 1.5));
    expect(result.kind).toBe('line');
  });

  it('leaves scribbles and open curves alone', () => {
    const zigzag = polyline([
      { x: 0, y: 0 },
      { x: 50, y: 80 },
      { x: 100, y: 0 },
      { x: 150, y: 80 },
    ]);
    expect(recognize(zigzag).kind).toBe('none');
    const arc = ellipse(100, 100, 80, 80, 60, -0.5);
    expect(recognize(arc).kind).toBe('none');
  });

  it('ignores tiny strokes', () => {
    expect(
      recognize([
        { x: 0, y: 0 },
        { x: 3, y: 2 },
      ]).kind,
    ).toBe('none');
  });
});

describe('helpers', () => {
  it('simplifies a noisy straight line to two points', () => {
    const line = jitter(
      polyline([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
      0.5,
    );
    expect(simplify(line, 2)).toHaveLength(2);
  });

  it('resamples to the requested count', () => {
    expect(
      resample(
        polyline(
          [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          3,
        ),
        11,
      ),
    ).toHaveLength(11);
  });
});
