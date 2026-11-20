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

export const initialCamera: Camera = { x: 0, y: 0, zoom: 1 };

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
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  const before = screenToWorld(camera, screenPoint);
  return {
    zoom,
    x: screenPoint.x / zoom - before.x,
    y: screenPoint.y / zoom - before.y,
  };
}
