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
} from '../model/geometry';
import { fileSummary } from '../model/files';
import { type ShapeSpec, compartments, fileIconBox, shapeSpec } from '../model/shapes';
import {
  FONT_SIZE,
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  LINE_HEIGHT,
  SECTION_PADDING,
  SMALL_FONT_SIZE,
  SMALL_LINE_HEIGHT,
  TEXT_PADDING,
  labelLayout,
  sectionHeight,
  wrapText,
} from '../model/textLayout';
import type { ArrowElement, ArrowHead, Bounds, Point, ShapeElement } from '../model/types';
import { DEFAULT_FILL, DEFAULT_STICKY_FILL, DEFAULT_STROKE, isArrow } from '../model/types';
import type { ThemeName } from '../ui/theme';
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
  /** Второстепенный текст: размер файла, значок заглушки. */
  muted: string;
  /** Заглушка на месте картинки, пока она загружается. */
  placeholder: string;
  /** Семейство шрифта интерфейса: холст должен писать тем же шрифтом, что и разметка. */
  fontFamily: string;
}

/** Цвета темы name, какая бы тема ни была открыта сейчас: например, для экспорта. */
export function themeFor(name: ThemeName): Theme {
  const probe = document.createElement('div');
  probe.dataset.theme = name;
  probe.hidden = true;
  document.body.append(probe);
  try {
    return readTheme(probe);
  } finally {
    probe.remove();
  }
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
    muted: v('--text-muted'),
    placeholder: v('--canvas-placeholder'),
    fontFamily: style.fontFamily,
  };
}

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
const BOLD_LINE_WIDTH = 3.5;
const DASH = [6, 5];
const LABEL_RADIUS = 4;
const FILE_SUMMARY_FONT_SIZE = 12;

/** Картинка файла, готовая к отрисовке, или null, пока она не загружена. */
export type ImageLookup = (fileId: string) => CanvasImageSource | null;

export function polyline(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
}

function drawPath(ctx: CanvasRenderingContext2D, el: ShapeElement, theme: Theme): void {
  ctx.beginPath();
  polyline(ctx, pathPoints(el));
  ctx.strokeStyle = paint(el.stroke, theme);
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  editing: boolean,
  theme: Theme,
  images: ImageLookup | undefined,
): void {
  if (el.kind === 'path') {
    drawPath(ctx, el, theme);
    return;
  }
  if (el.kind === 'image') {
    drawPicture(ctx, el, theme, images);
    return;
  }
  const spec = shapeSpec(el.kind);
  const stroke = paint(el.stroke, theme);
  ctx.beginPath();
  spec.outline(ctx, el);
  if (el.fill !== 'transparent') {
    ctx.save();
    if (spec.shadow) {
      // Стикер без рамки: от фона его отделяет тень, как у листка бумаги.
      ctx.shadowColor = 'rgb(0 0 0 / 0.18)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
    }
    ctx.fillStyle = paint(el.fill, theme);
    ctx.fill();
    ctx.restore();
  }
  if (spec.stroke !== 'none') {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = spec.stroke === 'bold' ? BOLD_LINE_WIDTH : LINE_WIDTH;
    ctx.setLineDash(spec.dashed ? DASH : []);
    ctx.stroke();
    if (spec.details) {
      ctx.lineWidth = LINE_WIDTH;
      ctx.setLineDash(spec.dashedDetails ? DASH : []);
      ctx.beginPath();
      spec.details(ctx, el);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (el.kind === 'file') drawFileLabel(ctx, el, stroke, theme);
  else if (spec.text === 'compartments') drawCompartments(ctx, el, editing, stroke, theme);
  else if (spec.text !== 'none' && !editing && el.text) drawText(ctx, el, spec, stroke, theme);
}

/** Картинка, а пока она загружается или если не загрузилась — заглушка того же размера. */
function drawPicture(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  theme: Theme,
  images: ImageLookup | undefined,
): void {
  const picture = el.file && images ? images(el.file.id) : null;
  if (picture) {
    ctx.drawImage(picture, el.x, el.y, el.w, el.h);
    return;
  }
  ctx.fillStyle = theme.placeholder;
  ctx.fillRect(el.x, el.y, el.w, el.h);
  // Значок картинки: рамка, горы и солнце.
  const s = Math.min(48, el.w * 0.4, el.h * 0.5);
  const x = el.x + (el.w - s) / 2;
  const y = el.y + (el.h - s * 0.8) / 2;
  const at = (fx: number, fy: number): [number, number] => [x + s * fx, y + s * fy];
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = LINE_WIDTH;
  ctx.beginPath();
  ctx.roundRect(x, y, s, s * 0.8, s * 0.08);
  ctx.moveTo(...at(0.12, 0.68));
  ctx.lineTo(...at(0.4, 0.38));
  ctx.lineTo(...at(0.62, 0.6));
  ctx.lineTo(...at(0.74, 0.48));
  ctx.lineTo(...at(0.88, 0.68));
  ctx.moveTo(...at(0.78, 0.24));
  ctx.arc(...at(0.7, 0.24), s * 0.08, 0, Math.PI * 2);
  ctx.stroke();
}

/** Имя файла и строка «PDF · 1,4 МБ» справа от значка карточки вложения. */
function drawFileLabel(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  color: string,
  theme: Theme,
): void {
  if (!el.file) return;
  const icon = fileIconBox(el);
  const left = icon.x + icon.w + 12;
  const room = el.x + el.w - TEXT_PADDING - left;
  if (room <= 0) return;
  const measure = (t: string) => ctx.measureText(t).width;
  const middle = el.y + el.h / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.font = `600 ${SMALL_FONT_SIZE}px ${theme.fontFamily}`;
  ctx.fillText(fit(measure, el.file.name, room), left, middle - 9);
  ctx.fillStyle = theme.muted;
  ctx.font = `${FILE_SUMMARY_FONT_SIZE}px ${theme.fontFamily}`;
  ctx.fillText(fit(measure, fileSummary(el.file), room), left, middle + 10);
}

function drawText(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  spec: ShapeSpec,
  color: string,
  theme: Theme,
): void {
  const box = spec.textBox(el);
  ctx.fillStyle = color;
  if (spec.text === 'title' || spec.text === 'vertical') {
    // Заголовок контейнера — одна строка; не влезает — обрезается многоточием.
    ctx.font = `600 ${SMALL_FONT_SIZE}px ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    const vertical = spec.text === 'vertical';
    const room = (vertical ? box.h : box.w) - TEXT_PADDING * 2;
    const title = fit((t) => ctx.measureText(t).width, el.text.split('\n')[0] ?? '', room);
    ctx.save();
    if (vertical) {
      ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(title, 0, 0);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(title, box.x + TEXT_PADDING + 4, box.y + box.h / 2);
    }
    ctx.restore();
    return;
  }
  ctx.font = `${FONT_SIZE}px ${theme.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapText((t) => ctx.measureText(t).width, el.text, box.w - TEXT_PADDING * 2);
  const top = box.y + box.h / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, box.x + box.w / 2, top + i * LINE_HEIGHT);
  });
}

/** Обрезает строку многоточием, чтобы она влезла в width. */
function fit(measure: (text: string) => number, text: string, width: number): string {
  if (measure(text) <= width) return text;
  let cut = text;
  while (cut.length > 0 && measure(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Класс и сущность: секции текста одна под другой с линией между ними. Первая секция —
 * имя по центру, остальные — строки слева. Последняя секция тянется до низа фигуры.
 */
function drawCompartments(
  ctx: CanvasRenderingContext2D,
  el: ShapeElement,
  editing: boolean,
  color: string,
  theme: Theme,
): void {
  const measure = (t: string) => ctx.measureText(t).width;
  const room = el.w - TEXT_PADDING * 2;
  let y = el.y;
  compartments(el.text).forEach((rows, index) => {
    if (index > 0 && y < el.y + el.h) {
      ctx.strokeStyle = color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(el.x, y);
      ctx.lineTo(el.x + el.w, y);
      ctx.stroke();
    }
    const top = y + SECTION_PADDING;
    y += sectionHeight(rows.length);
    if (editing) return;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.font = `${index === 0 ? '600 ' : ''}${SMALL_FONT_SIZE}px ${theme.fontFamily}`;
    ctx.textAlign = index === 0 ? 'center' : 'left';
    const x = index === 0 ? el.x + el.w / 2 : el.x + TEXT_PADDING;
    rows.forEach((row, i) => {
      const rowY = top + (i + 0.5) * SMALL_LINE_HEIGHT;
      if (rowY < el.y + el.h) ctx.fillText(fit(measure, row, room), x, rowY);
    });
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
  /** Картинки файлов. Без них на месте картинок рисуются заглушки. */
  images?: ImageLookup;
}

/** Рисует элементы страницы в мировых координатах текущего преобразования холста. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  source: ElementSource,
  theme: Theme,
  { viewport, editingId = null, images }: SceneOptions = {},
): void {
  const lookup = (id: string) => source.get(id);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const el of source.list()) {
    if (viewport && !intersects(viewport, elementBounds(el, lookup))) continue;
    const editing = el.id === editingId;
    if (isArrow(el)) drawArrow(ctx, el, arrowPath(el, lookup), editing, theme);
    else drawShape(ctx, el, editing, theme, images);
  }
}
