import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  centerOn,
  fitCamera,
  initialCamera,
  panBy,
  screenToWorld,
  visibleBounds,
  worldToScreen,
  zoomAt,
} from './camera';

describe('camera', () => {
  it('converts screen and world points both ways', () => {
    const camera = { x: 30, y: -10, zoom: 2 };
    const world = { x: 5, y: 7 };
    expect(screenToWorld(camera, worldToScreen(camera, world))).toEqual(world);
  });

  it('pans by screen pixels regardless of zoom', () => {
    const camera = panBy({ x: 0, y: 0, zoom: 2 }, 20, 10);
    expect(worldToScreen(camera, { x: 0, y: 0 })).toEqual({ x: 20, y: 10 });
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const cursor = { x: 300, y: 200 };
    const before = screenToWorld(initialCamera, cursor);
    const zoomed = zoomAt(initialCamera, cursor, 1.5);
    const after = screenToWorld(zoomed, cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom', () => {
    expect(zoomAt(initialCamera, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
  });

  it('centres a point and fits a frame into the window', () => {
    const size = { width: 800, height: 600 };
    const centred = centerOn({ x: 0, y: 0, zoom: 2 }, { x: 100, y: 50 }, size);
    expect(worldToScreen(centred, { x: 100, y: 50 })).toEqual({ x: 400, y: 300 });

    const fitted = fitCamera({ x: 0, y: 0, w: 1000, h: 300 }, size, 50);
    expect(fitted.zoom).toBe(0.7);
    expect(worldToScreen(fitted, { x: 500, y: 150 })).toEqual({ x: 400, y: 300 });
    // Маленькое не увеличивается сверх предела.
    expect(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, size, 50, 1).zoom).toBe(1);
    expect(visibleBounds(fitted, size).w).toBeCloseTo(800 / 0.7);
  });
});
