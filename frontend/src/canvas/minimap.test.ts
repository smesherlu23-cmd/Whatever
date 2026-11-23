import { describe, expect, it } from 'vitest';
import { BoardDocument } from '../model/document';
import { DEFAULT_FILL, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { recordingContext } from '../testing/canvas';
import { drawMinimap, minimapToWorld, minimapView } from './minimap';
import type { Theme } from './scene';

const theme: Theme = {
  background: '#f7f7f8',
  grid: '#c4c4ca',
  selection: '#43434a',
  handleFill: '#ffffff',
  marqueeFill: 'rgb(0 0 0 / 0.1)',
  ink: '#1b1b1f',
  shapeStroke: '#43434a',
  shapeFill: '#ffffff',
  stickyFill: '#fbe9a0',
  muted: '#76767f',
  placeholder: '#eeeef0',
  fontFamily: 'sans-serif',
};

function shape(id: string, x: number, extra: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    page: 'main',
    x,
    y: 0,
    w: 100,
    h: 100,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
    ...extra,
  };
}

const camera = { x: 0, y: 0, zoom: 1 };
const viewport = { width: 400, height: 300 };
const size = { width: 200, height: 140 };

describe('minimap', () => {
  it('fits the page and the visible part into the map and maps points back', () => {
    const doc = new BoardDocument();
    doc.add(shape('far', 1800));
    const view = minimapView(doc.page('main'), camera, viewport, size);
    // Видимая часть 400×300 от нуля и фигура до 1900 по x: вместе 1900 единиц на 188 точек.
    expect(view.scale).toBeCloseTo(188 / 1900);
    expect(minimapToWorld(view, { x: view.offset.x, y: view.offset.y })).toEqual({ x: 0, y: 0 });
    const middle = minimapToWorld(view, { x: 100, y: 70 });
    expect(middle.x).toBeCloseTo(950);
  });

  it('draws shapes as spots, containers as frames, arrows as lines and peers as dots', () => {
    const doc = new BoardDocument();
    doc.add(shape('a', 0));
    doc.add(shape('frame', 200, { kind: 'frame', w: 300, h: 200 }));
    doc.add({
      id: 'arrow',
      kind: 'arrow',
      page: 'main',
      start: { x: 0, y: 0, shapeId: 'a' },
      end: { x: 600, y: 50 },
      route: 'straight',
      startHead: 'none',
      endHead: 'arrow',
      dashed: false,
      text: '',
      stroke: DEFAULT_STROKE,
      z: 2,
    });
    const page = doc.page('main');
    const { ctx, calls } = recordingContext();
    const view = minimapView(page, camera, viewport, size);
    drawMinimap(ctx, view, page, { x: 0, y: 0, w: 400, h: 300 }, theme, [
      { color: '#e11d48', at: { x: 50, y: 50 } },
    ]);

    expect(calls).toContainEqual(['fillRect', 0, 0, 100, 100]);
    expect(calls).toContainEqual(['strokeRect', 200, 0, 300, 200]);
    expect(calls).toContainEqual(['strokeRect', 0, 0, 400, 300]);
    expect(calls.filter(([name]) => name === 'lineTo')).toHaveLength(1);
    expect(calls).toContainEqual(['set fillStyle', '#e11d48']);
  });
});
