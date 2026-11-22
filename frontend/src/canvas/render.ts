import type { Editor } from '../editor/Editor';
import {
  arrowPath,
  elementBounds,
  intersects,
  pathPoints,
  pathVertices,
  resolveArrow,
  trianglePoints,
} from '../model/geometry';
import type { ArrowElement, Bounds, Point, ShapeElement, ShapeKind } from '../model/types';
import { DEFAULT_FILL, DEFAULT_STICKY_FILL, DEFAULT_STROKE, isArrow } from '../model/types';
import type { Peer } from '../collab/presence';
import { screenToWorld, worldToScreen } from './camera';
import { drawGrid } from './grid';
import { FONT_SIZE, LINE_HEIGHT, TEXT_PADDING, textBox, wrapText } from './textLayout';

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
function paint(color: string, theme: Theme): string {
  if (color === DEFAULT_STROKE) return theme.shapeStroke;
  if (color === DEFAULT_FILL) return theme.shapeFill;
  if (color === DEFAULT_STICKY_FILL) return theme.stickyFill;
  return color;
}

const ARROW_HEAD = 12;
const HANDLE_PX = 8;
const CORNER_RADIUS = 3;
const ROUNDED_RADIUS = 20;
const STICKY_RADIUS = 2;
const PEER_LABEL_FONT_SIZE = 12;

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

function polyline(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (const p of rest) ctx.lineTo(p.x, p.y);
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
    ctx.lineWidth = 1.5;
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

function drawArrow(
  ctx: CanvasRenderingContext2D,
  el: ArrowElement,
  editor: Editor,
  theme: Theme,
): void {
  const path = arrowPath(el, (id) => editor.page.get(id));
  const vertices = pathVertices(path);
  const { end } = path;
  // Наконечник смотрит вдоль последнего участка ненулевой длины.
  const before = [...vertices].reverse().find((p) => p.x !== end.x || p.y !== end.y);
  if (!before) return;
  const angle = Math.atan2(end.y - before.y, end.x - before.x);
  ctx.strokeStyle = paint(el.stroke, theme);
  ctx.fillStyle = paint(el.stroke, theme);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  polyline(ctx, [
    ...vertices.slice(0, -1),
    {
      x: end.x - Math.cos(angle) * ARROW_HEAD * 0.8,
      y: end.y - Math.sin(angle) * ARROW_HEAD * 0.8,
    },
  ]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - ARROW_HEAD * Math.cos(angle - Math.PI / 7),
    end.y - ARROW_HEAD * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(
    end.x - ARROW_HEAD * Math.cos(angle + Math.PI / 7),
    end.y - ARROW_HEAD * Math.sin(angle + Math.PI / 7),
  );
  ctx.closePath();
  ctx.fill();
}

function drawSelection(ctx: CanvasRenderingContext2D, editor: Editor, theme: Theme): void {
  const zoom = editor.camera.zoom;
  const lookup = (id: string) => editor.page.get(id);
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1.25 / zoom;
  ctx.setLineDash(editor.selection.size > 1 ? [4 / zoom, 3 / zoom] : []);
  for (const id of editor.selection) {
    const el = editor.page.get(id);
    if (!el || isArrow(el)) continue;
    const pad = 4 / zoom;
    ctx.strokeRect(el.x - pad, el.y - pad, el.w + pad * 2, el.h + pad * 2);
  }
  ctx.setLineDash([]);

  const size = HANDLE_PX / zoom;
  ctx.fillStyle = theme.handleFill;
  for (const { point } of editor.handlePositions()) {
    ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    ctx.strokeRect(point.x - size / 2, point.y - size / 2, size, size);
  }

  const arrow = editor.selectedArrow();
  if (arrow) {
    const { start, end } = resolveArrow(arrow, lookup);
    for (const p of [start, end]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size / 2 + 1 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Штрих, который рисуется прямо сейчас. */
function drawStroke(ctx: CanvasRenderingContext2D, editor: Editor, theme: Theme): void {
  if (!editor.stroke) return;
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  polyline(ctx, editor.stroke);
  ctx.stroke();
}

/** Выделения и курсоры других участников на той же странице, каждый своим цветом. */
function drawPeers(
  ctx: CanvasRenderingContext2D,
  editor: Editor,
  everyone: readonly Peer[],
  dpr: number,
  theme: Theme,
): void {
  const { zoom } = editor.camera;
  const peers = everyone.filter((peer) => peer.page === editor.pageId);
  const lookup = (id: string) => editor.page.get(id);
  for (const peer of peers) {
    ctx.strokeStyle = peer.color;
    ctx.lineWidth = 2 / zoom;
    for (const id of peer.selection) {
      const el = editor.page.get(id);
      if (!el) continue;
      const b = elementBounds(el, lookup);
      const pad = 6 / zoom;
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    }
  }

  // Курсоры рисуются в экранных координатах, чтобы не зависеть от масштаба.
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `${PEER_LABEL_FONT_SIZE}px ${theme.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const peer of peers) {
    if (!peer.cursor) continue;
    const p = worldToScreen(editor.camera, peer.cursor);
    ctx.fillStyle = peer.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 3.5, p.y + 15);
    ctx.lineTo(p.x + 7, p.y + 9.5);
    ctx.lineTo(p.x + 13, p.y + 9);
    ctx.closePath();
    ctx.fill();
    const label = peer.name;
    const width = ctx.measureText(label).width + 12;
    ctx.beginPath();
    ctx.roundRect(p.x + 12, p.y + 14, width, 20, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, p.x + 18, p.y + 24);
  }
  ctx.restore();
}

/** Полная перерисовка кадра. Рисуются только элементы, попавшие в видимую область. */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  editor: Editor,
  width: number,
  height: number,
  dpr: number,
  theme: Theme,
  peers: readonly Peer[] = [],
): void {
  const { camera } = editor;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, camera, width, height, theme.grid);

  const scale = dpr * camera.zoom;
  ctx.setTransform(scale, 0, 0, scale, scale * camera.x, scale * camera.y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: width, y: height });
  const viewport = {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y,
  };
  const lookup = (id: string) => editor.page.get(id);

  for (const el of editor.page.list()) {
    if (!intersects(viewport, elementBounds(el, lookup))) continue;
    if (isArrow(el)) drawArrow(ctx, el, editor, theme);
    else drawShape(ctx, el, el.id === editor.editingId, theme);
  }

  drawPeers(ctx, editor, peers, dpr, theme);
  drawSelection(ctx, editor, theme);
  drawStroke(ctx, editor, theme);

  if (editor.marquee) {
    const m = editor.marquee;
    ctx.fillStyle = theme.marqueeFill;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.strokeRect(m.x, m.y, m.w, m.h);
  }
}
