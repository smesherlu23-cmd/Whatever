import type { Editor } from '../editor/Editor';
import { elementBounds, intersects, pathPoints, resolveArrow } from '../model/geometry';
import type { ArrowElement, BoardElement, Point, ShapeElement } from '../model/types';
import { isArrow } from '../model/types';
import { screenToWorld } from './camera';
import { drawGrid } from './grid';

export interface Theme {
  background: string;
  grid: string;
  selection: string;
  handleFill: string;
  marqueeFill: string;
  ink: string;
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
  };
}

const FONT_SIZE = 16;
const LINE_HEIGHT = 20;
const TEXT_PADDING = 8;
const ARROW_HEAD = 12;
const HANDLE_PX = 8;

export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function shapePath(ctx: CanvasRenderingContext2D, el: ShapeElement): void {
  const { x, y, w, h } = el;
  ctx.beginPath();
  switch (el.kind) {
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
    case 'rectangle':
      ctx.roundRect(x, y, w, h, Math.min(8, w / 4, h / 4));
      break;
    case 'text':
      ctx.rect(x, y, w, h);
      break;
    case 'path':
      polyline(ctx, pathPoints(el));
      break;
  }
}

function polyline(ctx: CanvasRenderingContext2D, points: Point[]): void {
  if (points.length === 0) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
}

function drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement, editing: boolean): void {
  shapePath(ctx, el);
  if (el.kind === 'path') {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  if (el.kind !== 'text') {
    if (el.fill !== 'transparent') {
      ctx.fillStyle = el.fill;
      ctx.fill();
    }
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (editing || !el.text) return;
  ctx.fillStyle = el.stroke;
  ctx.font = `${FONT_SIZE}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapText((t) => ctx.measureText(t).width, el.text, el.w - TEXT_PADDING * 2);
  const top = el.y + el.h / 2 - ((lines.length - 1) * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => ctx.fillText(line, el.x + el.w / 2, top + i * LINE_HEIGHT));
}

function drawArrow(ctx: CanvasRenderingContext2D, el: ArrowElement, editor: Editor): void {
  const { start, end } = resolveArrow(el, (id) => editor.doc.get(id));
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.strokeStyle = el.stroke;
  ctx.fillStyle = el.stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x - Math.cos(angle) * ARROW_HEAD * 0.8, end.y - Math.sin(angle) * ARROW_HEAD * 0.8);
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
  const lookup = (id: string) => editor.doc.get(id);
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1.25 / zoom;
  ctx.setLineDash(editor.selection.size > 1 ? [4 / zoom, 3 / zoom] : []);
  for (const id of editor.selection) {
    const el = editor.doc.get(id);
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

  const single = editor.singleSelected();
  if (single && isArrow(single)) {
    const { start, end } = resolveArrow(single, lookup);
    for (const p of [start, end]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size / 2 + 1 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Штрих, который рисуется прямо сейчас, или фигура, в которую он превратится. */
function drawStroke(ctx: CanvasRenderingContext2D, editor: Editor, theme: Theme): void {
  const preview = editor.strokePreview;
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (preview && preview.kind === 'line') {
    polyline(ctx, [preview.start, preview.end]);
  } else if (preview && preview.kind !== 'none') {
    shapePath(ctx, { ...preview.bounds, kind: preview.kind } as ShapeElement);
  } else if (editor.stroke) {
    polyline(ctx, editor.stroke);
  } else {
    return;
  }
  ctx.stroke();
}

/** Полная перерисовка кадра. Рисуются только элементы, попавшие в видимую область. */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  editor: Editor,
  width: number,
  height: number,
  dpr: number,
  theme: Theme,
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
  const viewport = { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y };
  const lookup = (id: string) => editor.doc.get(id);

  const elements: BoardElement[] = editor.doc.list();
  for (const el of elements) {
    if (!intersects(viewport, elementBounds(el, lookup))) continue;
    if (isArrow(el)) drawArrow(ctx, el, editor);
    else drawShape(ctx, el, el.id === editor.editingId);
  }

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
