import type { Bounds } from '../model/types';

/** Камера холста: сдвиг и масштаб. Экран = (мир + сдвиг) * масштаб. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Шаг кнопок и клавиш масштаба. */
export const ZOOM_STEP = 1.25;

export const initialCamera: Camera = { x: 0, y: 0, zoom: 1 };

const clampZoom = (zoom: number, max = MAX_ZOOM) => Math.min(max, Math.max(MIN_ZOOM, zoom));

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: p.x / camera.zoom - camera.x, y: p.y / camera.zoom - camera.y };
}

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: (p.x + camera.x) * camera.zoom, y: (p.y + camera.y) * camera.zoom };
}

/** Сдвигает камеру на величину в экранных пикселях. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx / camera.zoom, y: camera.y + dy / camera.zoom };
}

/** Меняет масштаб так, чтобы точка под курсором осталась на месте. */
export function zoomAt(camera: Camera, screenPoint: Point, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const before = screenToWorld(camera, screenPoint);
  return {
    zoom,
    x: screenPoint.x / zoom - before.x,
    y: screenPoint.y / zoom - before.y,
  };
}

/** Размер окна холста в экранных пикселях. */
export interface ScreenSize {
  width: number;
  height: number;
}

/** Камера с тем же масштабом, при которой точка world стоит в середине окна. */
export function centerOn(camera: Camera, world: Point, size: ScreenSize): Camera {
  return {
    zoom: camera.zoom,
    x: size.width / 2 / camera.zoom - world.x,
    y: size.height / 2 / camera.zoom - world.y,
  };
}

/**
 * Камера, при которой рамка bounds целиком видна в окне с полями padding (в пикселях экрана)
 * и стоит посередине. Масштаб не больше maxZoom.
 */
export function fitCamera(
  bounds: Bounds,
  size: ScreenSize,
  padding: number,
  maxZoom = MAX_ZOOM,
): Camera {
  const room = (side: number) => Math.max(side - padding * 2, 1);
  const zoom = clampZoom(
    Math.min(room(size.width) / Math.max(bounds.w, 1), room(size.height) / Math.max(bounds.h, 1)),
    maxZoom,
  );
  const middle = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  return centerOn({ x: 0, y: 0, zoom }, middle, size);
}

/** Видимая часть доски в мировых координатах. */
export function visibleBounds(camera: Camera, size: ScreenSize): Bounds {
  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  return { ...topLeft, w: size.width / camera.zoom, h: size.height / camera.zoom };
}
