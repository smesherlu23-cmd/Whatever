import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardDocument } from '../model/document';
import { DEFAULT_FILL, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import {
  EXPORT_PADDING,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
  drawExport,
  exportPng,
  planExport,
  selectionSource,
} from './exportImage';
import { ImageCache } from './images';
import type { Theme } from './scene';

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

function shape(id: string, x: number, y: number, extra: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    page: 'main',
    x,
    y,
    w: 100,
    h: 50,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
    ...extra,
  };
}

function page(...elements: ShapeElement[]) {
  const doc = new BoardDocument();
  for (const el of elements) doc.add(el);
  return doc.page('main');
}

type Call = [string, ...unknown[]];

function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'measureText'
          ? (text: string) => ({ width: text.length * 8 })
          : (...args: unknown[]) => calls.push([String(prop), ...args]),
      set: (_target, prop, value) => {
        calls.push([`set ${String(prop)}`, value]);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('planExport', () => {
  it('frames the content with padding at the chosen scale', () => {
    const plan = planExport(page(shape('a', 0, 0), shape('b', 300, 150)), 2);
    expect(plan).toEqual({
      bounds: { x: -EXPORT_PADDING, y: -EXPORT_PADDING, w: 400 + 64, h: 200 + 64 },
      scale: 2,
      width: 928,
      height: 528,
      reduced: false,
    });
    expect(planExport(page(), 1)).toBeNull();
  });

  it('includes a caption below a BPMN event', () => {
    const plan = planExport(
      page(shape('e', 0, 0, { kind: 'startEvent', w: 40, h: 40, text: 'Старт' })),
      1,
    );
    expect(plan?.bounds.y).toBe(-EXPORT_PADDING);
    // Подпись стоит под кружком, на 2 пикселя ниже, высотой 40.
    expect(plan?.bounds.h).toBe(40 + 2 + 40 + EXPORT_PADDING * 2);
  });

  it('shrinks a picture that would not fit into the browser', () => {
    const wide = planExport(page(shape('w', 0, 0, { w: 20000, h: 100 })), 3);
    expect(wide?.reduced).toBe(true);
    expect(wide?.width).toBeLessThanOrEqual(MAX_EXPORT_SIDE);

    const huge = planExport(page(shape('h', 0, 0, { w: 9000, h: 9000 })), 1);
    expect(huge?.reduced).toBe(true);
    expect((huge?.width ?? 0) * (huge?.height ?? 0)).toBeLessThanOrEqual(MAX_EXPORT_PIXELS);
  });
});

describe('selectionSource', () => {
  it('lists only the selection but still finds every shape for the arrows', () => {
    const source = page(shape('a', 0, 0), shape('b', 300, 0));
    const selected = selectionSource(source, new Set(['b']));
    expect(selected.list().map((el) => el.id)).toEqual(['b']);
    expect(selected.get('a')?.id).toBe('a');
  });
});

describe('drawExport', () => {
  it('fills the background unless it is transparent and draws without the grid', () => {
    const source = page(shape('a', 0, 0, { text: 'Сервис' }));
    const plan = planExport(source, 2);
    if (!plan) throw new Error('Nothing to export');

    const solid = recorder();
    drawExport(solid.ctx, source, plan, theme, 'light');
    expect(solid.calls).toContainEqual(['fillRect', 0, 0, plan.width, plan.height]);
    expect(solid.calls).toContainEqual(['setTransform', 2, 0, 0, 2, 64, 64]);
    expect(solid.calls.filter(([name]) => name === 'fillText')).toHaveLength(1);

    const clear = recorder();
    drawExport(clear.ctx, source, plan, theme, 'transparent');
    expect(clear.calls).not.toContainEqual(['fillRect', 0, 0, plan.width, plan.height]);
  });
});

describe('exportPng', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for pictures and encodes the canvas as PNG', async () => {
    const file = { id: 'f1', name: 'схема.png', size: 1, type: 'image/png' };
    const source = page(shape('p', 0, 0, { kind: 'image', file }));
    const plan = planExport(source, 1);
    if (!plan) throw new Error('Nothing to export');
    const images = new ImageCache((id) => `/files/${id}`);
    const ready = vi.spyOn(images, 'ready').mockResolvedValue();
    vi.spyOn(images, 'get').mockReturnValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(recorder().ctx);
    HTMLCanvasElement.prototype.toBlob = vi.fn((done: BlobCallback, type?: string) => {
      done(new Blob(['png'], { type }));
    });

    const blob = await exportPng(source, plan, theme, 'light', images);
    expect(blob.type).toBe('image/png');
    expect(ready).toHaveBeenCalledWith(['f1']);

    HTMLCanvasElement.prototype.toBlob = vi.fn((done: BlobCallback) => {
      done(null);
    });
    await expect(exportPng(source, plan, theme, 'light', images)).rejects.toThrow('памяти');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(exportPng(source, plan, theme, 'light', images)).rejects.toThrow('не дал');
  });
});
