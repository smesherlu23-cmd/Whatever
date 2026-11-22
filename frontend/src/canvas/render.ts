import type { Peer } from '../collab/presence';
import type { Editor } from '../editor/Editor';
import { elementBounds, resolveArrow } from '../model/geometry';
import { isArrow } from '../model/types';
import { screenToWorld, worldToScreen } from './camera';
import { drawGrid } from './grid';
import { type ImageLookup, type Theme, drawScene, polyline } from './scene';

const HANDLE_PX = 8;
const PEER_LABEL_FONT_SIZE = 12;

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

/** Что нужно для кадра, кроме редактора. width и height — размер холста в CSS-пикселях. */
export interface FrameOptions {
  width: number;
  height: number;
  /** Сколько пикселей экрана в одном CSS-пикселе. */
  dpr: number;
  theme: Theme;
  /** Другие участники: их курсоры и выделения. */
  peers?: readonly Peer[];
  images?: ImageLookup;
}

/** Полная перерисовка кадра. Рисуются только элементы, попавшие в видимую область. */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  editor: Editor,
  { width, height, dpr, theme, peers = [], images }: FrameOptions,
): void {
  const { camera } = editor;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, camera, width, height, theme.grid);

  const scale = dpr * camera.zoom;
  ctx.setTransform(scale, 0, 0, scale, scale * camera.x, scale * camera.y);

  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: width, y: height });
  const viewport = {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y,
  };
  drawScene(ctx, editor.page, theme, { viewport, editingId: editor.editingId, images });

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
