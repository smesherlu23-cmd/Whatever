import { describe, expect, it } from 'vitest';
import type { Peer } from '../collab/presence';
import { Editor } from '../editor/Editor';
import {
  type ArrowElement,
  DEFAULT_FILL,
  DEFAULT_STICKY_FILL,
  DEFAULT_STROKE,
  type ShapeElement,
} from '../model/types';
import { renderBoard } from './render';
import type { Theme } from './scene';

const theme: Theme = {
  background: '#f4f4f5',
  grid: '#d4d4d8',
  selection: '#3b82f6',
  handleFill: '#ffffff',
  marqueeFill: 'rgba(59,130,246,0.1)',
  ink: '#18181b',
  shapeStroke: '#43434a',
  shapeFill: '#ffffff',
  stickyFill: '#5b5131',
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
    page: 'main',
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
      page: 'main',
      route: 'straight',
      startHead: 'none',
      endHead: 'arrow',
      dashed: false,
      text: '',
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

  it('draws the new shapes: a triangle by its corners, a sticky note without a frame', () => {
    const editor = new Editor();
    editor.doc.add(shape('t', 0, 0, { kind: 'triangle', w: 100, h: 100, text: 'Шлюз' }));
    editor.doc.add(shape('s', 200, 0, { kind: 'sticky', fill: DEFAULT_STICKY_FILL }));
    editor.doc.add(shape('u', 400, 0, { kind: 'rounded' }));
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 1, theme);

    const moves = named(calls, 'moveTo').map(([, x, y]) => [x, y]);
    expect(moves).toContainEqual([50, 0]);
    expect(named(calls, 'lineTo').map(([, x, y]) => [x, y])).toEqual(
      expect.arrayContaining([
        [100, 100],
        [0, 100],
      ]),
    );
    // Текст треугольника стоит в его нижней половине, где для него есть место.
    expect(named(calls, 'fillText')).toEqual([['fillText', 'Шлюз', 50, 75]]);
    const fills = named(calls, 'set fillStyle').map(([, value]) => value);
    expect(fills).toContain(theme.stickyFill);
    expect(named(calls, 'set shadowBlur').length).toBe(1);
    const radii = named(calls, 'roundRect').map((args) => args[5]);
    expect(radii).toEqual(expect.arrayContaining([2, 20]));
  });

  it('draws an elbow arrow through its bends with the head along the last leg', () => {
    const editor = new Editor();
    editor.doc.add({
      id: 'arrow',
      kind: 'arrow',
      page: 'main',
      route: 'elbow',
      startHead: 'none',
      endHead: 'arrow',
      dashed: false,
      text: '',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 40 },
      stroke: DEFAULT_STROKE,
      z: 1,
    });
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 1, theme);

    const points = named(calls, 'lineTo').map(([, x, y]) => [x, y]);
    expect(points.slice(0, 3)).toEqual([
      [50, 0],
      [50, 40],
      [100 - 12 * 0.8, 40],
    ]);
  });

  it("draws other participants' cursors with their names", () => {
    const editor = new Editor();
    const peer: Peer = {
      clientId: 7,
      name: 'Анна',
      color: '#d1495b',
      page: 'main',
      cursor: { x: 100, y: 100 },
      selection: [],
    };
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 2, theme, [peer, { ...peer, name: 'Олег', page: 'p2' }]);

    // Олег смотрит другую страницу: его курсора здесь нет.
    expect(named(calls, 'fillText').map(([, text]) => text)).toEqual(['Анна']);
  });
});

describe('renderBoard arrows', () => {
  const arrow: ArrowElement = {
    id: 'arrow',
    kind: 'arrow',
    page: 'main',
    route: 'straight',
    startHead: 'filledDiamond',
    endHead: 'triangle',
    dashed: true,
    text: 'Заказ',
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 },
    stroke: DEFAULT_STROKE,
    z: 1,
  };

  it('draws a dashed line that stops short of hollow and filled heads', () => {
    const editor = new Editor();
    editor.doc.add(arrow);
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, 800, 600, 1, theme);

    expect(named(calls, 'setLineDash').map(([, dash]) => dash)).toContainEqual([6, 5]);
    // Линия начинается за ромбом (18) и кончается у основания треугольника (200 − 14).
    expect(named(calls, 'moveTo')).toContainEqual(['moveTo', 18, 0]);
    expect(named(calls, 'lineTo')).toContainEqual(['lineTo', 186, 0]);
    // Пустой треугольник залит фоном, закрашенный ромб — цветом линии.
    const fills = named(calls, 'set fillStyle').map(([, value]) => value);
    expect(fills).toEqual(expect.arrayContaining([theme.background, theme.shapeStroke]));
  });

  it('draws the label on a backing in the middle of the line, but not while it is edited', () => {
    const editor = new Editor();
    editor.doc.add(arrow);
    const first = recordingContext();
    renderBoard(first.ctx, editor, 800, 600, 1, theme);
    expect(named(first.calls, 'fillText')).toEqual([['fillText', 'Заказ', 100, 0]]);

    editor.startEditing('arrow');
    const second = recordingContext();
    renderBoard(second.ctx, editor, 800, 600, 1, theme);
    expect(named(second.calls, 'fillText')).toEqual([]);
  });

  it('draws every kind of head', () => {
    const editor = new Editor();
    const heads = [
      'none',
      'arrow',
      'open',
      'diamond',
      'circle',
      'one',
      'zeroOrOne',
      'many',
      'zeroOrMany',
    ] as const;
    // Начало без наконечника, чтобы считать только концы.
    heads.forEach((head, i) => {
      editor.doc.add({
        ...arrow,
        id: head,
        text: '',
        startHead: 'none',
        endHead: head,
        start: { x: 0, y: i * 40 },
        end: { x: 200, y: i * 40 },
      });
    });
    const { ctx, calls } = recordingContext();
    renderBoard(ctx, editor, 800, 600, 1, theme);
    expect(named(calls, 'arc').length).toBeGreaterThanOrEqual(3);
    // Каждый наконечник, кроме 'none', поворачивается вдоль линии.
    expect(named(calls, 'rotate').length).toBe(heads.length - 1);
  });
});
