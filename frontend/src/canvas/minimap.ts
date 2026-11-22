import type { ElementSource } from '../model/document';
import { arrowPath, contentBounds, pathVertices, union } from '../model/geometry';
import { shapeSpec } from '../model/shapes';
import { type Bounds, type Point, isArrow } from '../model/types';
import { type Camera, type ScreenSize, visibleBounds } from './camera';
import { type Theme, polyline } from './scene';

/** Как мини-карта показывает доску: экран карты = (доска − origin) × scale + offset. */
export interface MinimapView {
  origin: Point;
  scale: number;
  offset: Point;
}

/** Метка участника на карте: его курсор. */
export interface MinimapMarker {
  color: string;
  at: Point;
}

/** Поле внутри карты, в её пикселях. */
const MARGIN = 6;
const MARKER_RADIUS = 3;

/** Вид карты: всё, что есть на странице, и видимая часть доски, вписанные в карту. */
export function minimapView(
  source: ElementSource,
  camera: Camera,
  viewport: ScreenSize,
  size: ScreenSize,
): MinimapView {
  const visible = visibleBounds(camera, viewport);
  const content = contentBounds(source.list(), (id) => source.get(id));
  const world = content ? union(content, visible) : visible;
  const scale = Math.min(
    (size.width - MARGIN * 2) / Math.max(world.w, 1),
    (size.height - MARGIN * 2) / Math.max(world.h, 1),
  );
  return {
    origin: { x: world.x, y: world.y },
    scale,
    offset: { x: (size.width - world.w * scale) / 2, y: (size.height - world.h * scale) / 2 },
  };
}

/** Точка доски под точкой карты. */
export function minimapToWorld(view: MinimapView, p: Point): Point {
  return {
    x: (p.x - view.offset.x) / view.scale + view.origin.x,
    y: (p.y - view.offset.y) / view.scale + view.origin.y,
  };
}

/**
 * Рисует карту: фигуры — пятнами, контейнеры — рамками, стрелки — линиями, поверх —
 * видимая часть доски и курсоры участников. Подробности на карте не нужны, поэтому
 * она дешёвая даже для большой доски.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  view: MinimapView,
  source: ElementSource,
  visible: Bounds,
  theme: Theme,
  markers: readonly MinimapMarker[] = [],
): void {
  const lookup = (id: string) => source.get(id);
  // Одна точка карты в единицах доски: толщина линий не зависит от масштаба карты.
  const unit = 1 / view.scale;
  ctx.save();
  ctx.translate(
    view.offset.x - view.origin.x * view.scale,
    view.offset.y - view.origin.y * view.scale,
  );
  ctx.scale(view.scale, view.scale);
  ctx.fillStyle = theme.muted;
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = unit;
  for (const el of source.list()) {
    if (isArrow(el)) {
      ctx.beginPath();
      polyline(ctx, pathVertices(arrowPath(el, lookup)));
      ctx.stroke();
    } else if (el.kind !== 'path' && shapeSpec(el.kind).container) {
      ctx.strokeRect(el.x, el.y, el.w, el.h);
    } else {
      ctx.globalAlpha = 0.45;
      ctx.fillRect(el.x, el.y, el.w, el.h);
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = theme.marqueeFill;
  ctx.fillRect(visible.x, visible.y, visible.w, visible.h);
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = unit * 1.5;
  ctx.strokeRect(visible.x, visible.y, visible.w, visible.h);
  for (const marker of markers) {
    ctx.fillStyle = marker.color;
    ctx.beginPath();
    ctx.arc(marker.at.x, marker.at.y, MARKER_RADIUS * unit, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
