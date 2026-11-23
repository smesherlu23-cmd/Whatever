import { describe, expect, it } from 'vitest';
import { BoardDocument } from '../model/document';
import { DEFAULT_FILL, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { recordingContext } from '../testing/canvas';
import type { Theme } from './scene';
import { drawThumbnail } from './thumbnail';

const theme: Theme = {
  background: '#f7f7f8',
  grid: '#c4c4ca',
  selection: '#43434a',
  handleFill: '#ffffff',
  marqueeFill: 'transparent',
  ink: '#1b1b1f',
  shapeStroke: '#43434a',
  shapeFill: '#ffffff',
  stickyFill: '#fbe9a0',
  muted: '#76767f',
  placeholder: '#eeeef0',
  fontFamily: 'sans-serif',
};

function page(...boxes: [x: number, y: number, w: number, h: number][]) {
  const doc = new BoardDocument();
  boxes.forEach(([x, y, w, h], i) => {
    const shape: ShapeElement = {
      id: `s${i}`,
      kind: 'rectangle',
      page: 'main',
      x,
      y,
      w,
      h,
      text: '',
      stroke: DEFAULT_STROKE,
      fill: DEFAULT_FILL,
      z: i,
    };
    doc.add(shape);
  });
  return doc.page('main');
}

const size = { width: 200, height: 120 };

describe('drawThumbnail', () => {
  it('fits a large page into the preview, centred and without the camera zoom limit', () => {
    const { ctx, calls } = recordingContext();
    // 10 000 единиц по ширине: в 184 точки превью они влезают при масштабе меньше 0,1.
    drawThumbnail(ctx, page([0, 0, 4000, 500], [6000, 0, 4000, 500]), size, theme);
    const scale = 184 / 10_000;
    expect(calls).toContainEqual(['scale', scale, scale]);
    expect(calls).toContainEqual(['translate', 100 - 5000 * scale, 60 - 250 * scale]);
    expect(calls.filter(([name]) => name === 'roundRect')).toHaveLength(2);
  });

  it('does not enlarge a small page', () => {
    const { ctx, calls } = recordingContext();
    drawThumbnail(ctx, page([40, 20, 100, 50]), size, theme);
    expect(calls).toContainEqual(['scale', 1, 1]);
    expect(calls).toContainEqual(['translate', 100 - 90, 60 - 45]);
  });

  it('draws nothing for an empty page', () => {
    const { ctx, calls } = recordingContext();
    drawThumbnail(ctx, page(), size, theme);
    expect(calls).toEqual([]);
  });
});
