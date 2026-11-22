import type { ElementSource } from '../model/document';
import {
  type ArrowPath,
  arrowPath,
  distance,
  elementBounds,
  intersects,
  labelAnchor,
  pathPoints,
  pathVertices,
  trianglePoints,
} from '../model/geometry';
import {
  FONT_SIZE,
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  LINE_HEIGHT,
  TEXT_PADDING,
  labelLayout,
  textBox,
  wrapText,
} from '../model/textLayout';
import type {
  ArrowElement,
  ArrowHead,
  Bounds,
  Point,
  ShapeElement,
  ShapeKind,
} from '../model/types';
import { DEFAULT_FILL, DEFAULT_STICKY_FILL, DEFAULT_STROKE, isArrow } from '../model/types';
import { HEAD_SHAPES, drawHead } from './arrowHeads';

/** Цвета и шрифт, которыми рисуется доска. Берутся из CSS-переменных темы. */
export interface Theme {
  background: string;
  grid: string;
  selection: string;
  handleFill: string;
  marqueeFill: string;
  ink: string;
  shapeStroke: string;
  shapeFill: string;
  stickyFill: string;
  /** Семейство шрифта интерфейса: холст должен писать тем же шрифтом, что и разметка. */
  fontFamily: string;
}

/** Тема элемента el: его CSS-переменные с учётом data-theme ближайшего предка. */
export function readTheme(el: Element): Theme {
  const style = getComputedStyle(el);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: v('--canvas-bg'),
    grid: v('--canvas-grid'),
    selection: v('--selection'),
    handleFill: v('--bg-panel'),
    marqueeFill: v('--selection-fill'),
    ink: v('--text'),
    shapeStroke: v('--shape-stroke'),
    shapeFill: v('--shape-fill'),
    stickyFill: v('--sticky-fill'),
    fontFamily: style.fontFamily,
  };
}

type OutlineKind = Exclude<ShapeKind, 'path'>;

/**
 * Цвет на экране. Цвета по умолчанию хранятся в документе одним значением,
 * а рисуются цветами текущей темы, чтобы фигуры читались и на тёмном фоне.
 */
export function paint(color: string, theme: Theme): string {
  if (color === DEFAULT_STROKE) return theme.shapeStroke;
  if (color === DEFAULT_FILL) return theme.shapeFill;
  if (color === DEFAULT_STICKY_FILL) return theme.stickyFill;
  return color;
}

const LINE_WIDTH = 1.5;
const DASH = [6, 5];
const CORNER_RADIUS = 3;
const ROUNDED_RADIUS = 20;
const STICKY_RADIUS = 2;
const LABEL_RADIUS = 4;

export function polyline(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
}

/** Контур замкнутой фигуры в рамке bounds. Добавляется к текущему пути холста. */
function outline(ctx: CanvasRenderingContext2D, kind: OutlineKind, bounds: Bounds): void {
  const { x, y, w, h } = bounds;
  switch (kind) {
    case 'ellipse':
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w / 2, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
      break;
    case 'triangle':
      polyline(ctx, trianglePoints(bounds));
      ctx.closePath();
      break;
    case 'rectangle':
      ctx.roundRect(x, y, w, h, Math.min(CORNER_RADIUS, w / 4, h / 4));
      break;
    case 'rounded':
      ctx.roundRect(x, y, w, h, Math.min(ROUNDED_RADIUS, w / 3, h / 3));
      break;
    case 'sticky':
      ctx.roundRect(x, y, w, h, STICKY_RADIUS);
      break;
    case 'text':
      ctx.rect(x, y, w, h);
      break;
  }
}

function shapePath(ctx: CanvasRenderingContext2D, el: ShapeElement): void {
  ctx.beginPath();
  if (el.kind === 'path') polyline(ctx, pathPoints(el));
  else outline(ctx, el.kind, el);
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  editing: boolean,
  theme: Theme,
): void {
  const stroke = paint(el.stroke, theme);
  shapePath(ctx, el);
  if (el.kind === 'path') {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  if (el.kind === 'sticky') {
    // Стикер без рамки: от фона его отделяет тень, как у листка бумаги.
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / 0.18)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = paint(el.fill, theme);
    ctx.fill();
    ctx.restore();
  } else if (el.kind !== 'text') {
    if (el.fill !== 'transparent') {
      ctx.fillStyle = paint(el.fill, theme);
      ctx.fill();
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = LINE_WIDTH;
    ctx.stroke();
  }
  if (editing || !el.text) return;
  ctx.fillStyle = stroke;
  ctx.font = `${FONT_SIZE}px ${theme.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const box = textBox(el);
  const lines = wrapText((t) => ctx.measureText(t).width, el.text, box.w - TEXT_PADDING * 2);
  const top = box.y + box.h / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, box.x + box.w / 2, top + i * LINE_HEIGHT);
  });
}

/** Конец линии со стороны tip: острие, точка, откуда приходит линия, и угол к острию. */
interface LineEnd {
  tip: Point;
  from: Point;
  angle: number;
}

/** Конец ломаной со стороны последней точки; null, если вся ломаная — одна точка. */
function lineEnd(points: readonly Point[]): LineEnd | null {
  const tip = points.at(-1);
  for (let i = points.length - 2; tip && i >= 0; i--) {
    const from = points[i];
    if (from && (from.x !== tip.x || from.y !== tip.y)) {
      return { tip, from, angle: Math.atan2(tip.y - from.y, tip.x - from.x) };
    }
  }
  return null;
}

/** Отодвигает конец линии от острия на inset, чтобы линия не торчала из наконечника. */
function inset({ tip, from }: LineEnd, head: ArrowHead): Point {
  const length = distance(from, tip);
  const t = Math.min(HEAD_SHAPES[head].inset, length) / length;
  return { x: tip.x + (from.x - tip.x) * t, y: tip.y + (from.y - tip.y) * t };
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  el: ArrowElement,
  path: ArrowPath,
  editing: boolean,
  theme: Theme,
): void {
  const vertices = pathVertices(path);
  const end = lineEnd(vertices);
  const start = lineEnd([...vertices].reverse());
  if (!end || !start) return;
  const color = paint(el.stroke, theme);
  ctx.strokeStyle = color;
  ctx.lineWidth = LINE_WIDTH;
  ctx.setLineDash(el.dashed ? DASH : []);
  ctx.beginPath();
  polyline(ctx, [inset(start, el.startHead), ...vertices.slice(1, -1), inset(end, el.endHead)]);
  ctx.stroke();
  ctx.setLineDash([]);
  const colors = { fill: color, background: theme.background };
  drawHead(ctx, el.endHead, end.tip, end.angle, colors);
  drawHead(ctx, el.startHead, start.tip, start.angle, colors);
  if (el.text && !editing) drawLabel(ctx, el.text, labelAnchor(path), color, theme);
}

/** Подпись стрелки на подложке цвета фона: линия под текстом прерывается. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchor: Point,
  color: string,
  theme: Theme,
): void {
  ctx.font = `${LABEL_FONT_SIZE}px ${theme.fontFamily}`;
  const { lines, box } = labelLayout(text, anchor, (t) => ctx.measureText(t).width);
  ctx.fillStyle = theme.background;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, LABEL_RADIUS);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const top = anchor.y - ((lines.length - 1) * LABEL_LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, anchor.x, top + i * LABEL_LINE_HEIGHT);
  });
}

export interface SceneOptions {
  /** Рисуются только элементы, задевающие эту область (мировые координаты). */
  viewport?: Bounds;
  /** Текст этого элемента не рисуется: поверх него открыто поле ввода. */
  editingId?: string | null;
}

/** Рисует элементы страницы в мировых координатах текущего преобразования холста. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  source: ElementSource,
  theme: Theme,
  { viewport, editingId = null }: SceneOptions = {},
): void {
  const lookup = (id: string) => source.get(id);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const el of source.list()) {
    if (viewport && !intersects(viewport, elementBounds(el, lookup))) continue;
    const editing = el.id === editingId;
    if (isArrow(el)) drawArrow(ctx, el, arrowPath(el, lookup), editing, theme);
    else drawShape(ctx, el, editing, theme);
  }
}
