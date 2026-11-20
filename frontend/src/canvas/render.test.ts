import { describe, expect, it } from 'vitest';
import type { Peer } from '../collab/presence';
import { Editor } from '../editor/Editor';
import { DEFAULT_FILL, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { type Theme, renderBoard } from './render';

const theme: Theme = {
  background: '#f4f4f5',
  grid: '#d4d4d8',
  selection: '#3b82f6',
  handleFill: '#ffffff',
  marqueeFill: 'rgba(59,130,246,0.1)',
  ink: '#18181b',
  shapeStroke: '#43434a',
  shapeFill: '#ffffff',
  fontFamily: 'sans-serif',
};

type Call = [method: string, ...args: unknown[]];

/** Подделка 2D-контекста: запоминает вызовы методов, присваивания свойств игнорирует. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 8 }) },
    {
      get(target, prop) {
        if (prop === 'measureText') return target.measureText;
        return (...args: unknown[]) => calls.push([String(prop), ...args]);
      },
      set(_target, prop, value) {
        calls.push([`set ${String(prop)}`, value]);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function shape(id: string, x: number, y: number, extra: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    x,
    y,
    w: 100,
    h: 60,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
    ...extra,
  };
}

const named = (calls: Call[], method: string) => calls.filter(([name]) => name === method);

describe('renderBoard', () => {
  it('draws default colours in the colours of the current theme', () => {
    const editor = new Editor();
    editor.doc.add(shape('r', 10, 10));
    const dark: Theme = {
      ...theme,
      shapeStroke: '#dedee2',
      shapeFill: '#2c2c31',
      handleFill: '#2c2c31',
    };
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 1, dark);

    const values = (prop: string) => named(calls, `set ${prop}`).map(([, value]) => value);
    expect(values('fillStyle')).toContain('#2c2c31');
    expect(values('strokeStyle')).toContain('#dedee2');
    expect(values('fillStyle')).not.toContain(DEFAULT_FILL);
  });

  it('draws only the elements inside the viewport', () => {
    const editor = new Editor();
    editor.doc.add(shape('visible', 10, 10, { text: 'Видно' }));
    editor.doc.add(shape('offscreen', 5000, 5000, { text: 'Не видно' }));
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 1, theme);

    expect(named(calls, 'fillText').map(([, text]) => text)).toEqual(['Видно']);
  });

  it('draws arrows, hand-drawn paths and selection handles', () => {
    const editor = new Editor();
    editor.doc.add(shape('a', 0, 0));
    editor.doc.add(shape('path', 200, 0, { kind: 'path', points: [0, 0, 1, 1] }));
    editor.doc.add({
      id: 'arrow',
      kind: 'arrow',
      start: { x: 0, y: 0, shapeId: 'a' },
      end: { x: 300, y: 300 },
      stroke: DEFAULT_STROKE,
      z: 2,
    });
    editor.select(['a']);
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 1, theme);

    expect(named(calls, 'roundRect').length).toBeGreaterThan(0);
    // Наконечник стрелки — закрашенный треугольник, ручки выделения — восемь квадратов.
    expect(named(calls, 'fill').length).toBeGreaterThan(0);
    expect(named(calls, 'fillRect').length).toBeGreaterThanOrEqual(8);
  });

  it("draws other participants' cursors with their names", () => {
    const editor = new Editor();
    const peer: Peer = {
      clientId: 7,
      name: 'Анна',
      color: '#d1495b',
      cursor: { x: 100, y: 100 },
      selection: [],
    };
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 2, theme, [peer]);

    expect(named(calls, 'fillText').map(([, text]) => text)).toEqual(['Анна']);
  });
});
