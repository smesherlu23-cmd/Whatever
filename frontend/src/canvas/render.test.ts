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
import { type Call, recordingContext } from '../testing/canvas';
import { renderBoard } from './render';
import type { Theme } from './scene';
import { fileId } from '../testing/helpers';

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
  muted: '#76767f',
  placeholder: '#eeeef0',
  fontFamily: 'sans-serif',
};

const frame = { width: 800, height: 600, dpr: 1, theme };

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

    renderBoard(ctx, editor, { ...frame, theme: dark });

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

    renderBoard(ctx, editor, frame);

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

    renderBoard(ctx, editor, frame);

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

    renderBoard(ctx, editor, frame);

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

    renderBoard(ctx, editor, frame);

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
      view: null,
      selection: [],
    };
    const { ctx, calls } = recordingContext();

    renderBoard(ctx, editor, {
      ...frame,
      dpr: 2,
      peers: [peer, { ...peer, name: 'Олег', page: 'p2' }],
    });

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

    renderBoard(ctx, editor, frame);

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
    renderBoard(first.ctx, editor, frame);
    expect(named(first.calls, 'fillText')).toEqual([['fillText', 'Заказ', 100, 0]]);

    editor.startEditing('arrow');
    const second = recordingContext();
    renderBoard(second.ctx, editor, frame);
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
    renderBoard(ctx, editor, frame);
    expect(named(calls, 'arc').length).toBeGreaterThanOrEqual(3);
    // Каждый наконечник, кроме 'none', поворачивается вдоль линии.
    expect(named(calls, 'rotate').length).toBe(heads.length - 1);
  });
});

describe('renderBoard catalog shapes', () => {
  it('draws the compartments of a class with lines between them', () => {
    const editor = new Editor();
    editor.doc.add(
      shape('c', 0, 0, {
        kind: 'class',
        w: 200,
        h: 120,
        text: 'Заказ\n--\nid: uuid\n--\nоплатить()',
      }),
    );
    const { ctx, calls } = recordingContext();
    renderBoard(ctx, editor, frame);

    expect(named(calls, 'fillText').map(([, text, x]) => [text, x])).toEqual([
      ['Заказ', 100],
      ['id: uuid', 8],
      ['оплатить()', 8],
    ]);
    // Две секции под именем — две линии через всю ширину.
    const separators = named(calls, 'lineTo').filter(([, x]) => x === 200);
    expect(separators).toHaveLength(2);
    expect(named(calls, 'set font').map(([, font]) => font)).toContain('600 14px sans-serif');
  });

  it('writes container titles on one line and a lane title bottom to top', () => {
    const editor = new Editor();
    editor.doc.add(
      shape('f', 0, 0, { kind: 'group', w: 300, h: 200, text: 'Платёжный контур\nвторая строка' }),
    );
    editor.doc.add(shape('l', 0, 300, { kind: 'lane', w: 500, h: 150, text: 'Бухгалтерия' }));
    const { ctx, calls } = recordingContext();
    renderBoard(ctx, editor, frame);

    expect(named(calls, 'fillText').map(([, text]) => text)).toEqual([
      'Платёжный контур',
      'Бухгалтерия',
    ]);
    expect(named(calls, 'rotate')).toContainEqual(['rotate', -Math.PI / 2]);
    // Граница группы пунктиром.
    expect(named(calls, 'setLineDash').map(([, dash]) => dash)).toContainEqual([6, 5]);
  });

  it('cuts a long title with an ellipsis and draws a bold end event', () => {
    const editor = new Editor();
    editor.doc.add(
      shape('f', 0, 0, { kind: 'frame', w: 120, h: 100, text: 'Очень длинное название рамки' }),
    );
    editor.doc.add(shape('e', 300, 0, { kind: 'endEvent', w: 44, h: 44, text: 'Готово', z: 2 }));
    const { ctx, calls } = recordingContext();
    renderBoard(ctx, editor, frame);

    const [title] = named(calls, 'fillText');
    expect(String(title?.[1])).toMatch(/…$/);
    expect(named(calls, 'set lineWidth').map(([, width]) => width)).toContain(3.5);
  });
});

describe('renderBoard files', () => {
  const file = { id: fileId(1), name: 'Схема сети.png', size: 3 * 1024 * 1024, type: 'image/png' };

  it('draws a loaded picture and a placeholder while it loads', () => {
    const editor = new Editor();
    editor.doc.add(shape('p', 0, 0, { kind: 'image', w: 300, h: 200, file }));
    const picture = { width: 300, height: 200 } as unknown as CanvasImageSource;

    const waiting = recordingContext();
    renderBoard(waiting.ctx, editor, { ...frame, images: () => null });
    expect(named(waiting.calls, 'drawImage')).toEqual([]);
    expect(named(waiting.calls, 'fillRect')).toContainEqual(['fillRect', 0, 0, 300, 200]);
    expect(named(waiting.calls, 'set fillStyle').map(([, color]) => color)).toContain(
      theme.placeholder,
    );

    const loaded = recordingContext();
    renderBoard(loaded.ctx, editor, {
      ...frame,
      images: (id) => (id === fileId(1) ? picture : null),
    });
    expect(named(loaded.calls, 'drawImage')).toEqual([['drawImage', picture, 0, 0, 300, 200]]);
  });

  it('writes the name and size on an attachment card, never its text', () => {
    const editor = new Editor();
    const pdf = { ...file, name: 'Регламент.pdf', type: 'application/octet-stream' };
    editor.doc.add(
      shape('c', 0, 0, { kind: 'file', w: 260, h: 72, text: 'чужой текст', file: pdf }),
    );
    const { ctx, calls } = recordingContext();
    renderBoard(ctx, editor, frame);

    expect(named(calls, 'fillText').map(([, text]) => text)).toEqual([
      'Регламент.pdf',
      'PDF · 3 МБ',
    ]);
  });
});
