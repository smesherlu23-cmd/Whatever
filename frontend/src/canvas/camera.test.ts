import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, initialCamera, panBy, screenToWorld, worldToScreen, zoomAt } from './camera';

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
});
