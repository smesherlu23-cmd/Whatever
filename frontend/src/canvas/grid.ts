import { type Camera, screenToWorld } from './camera';

export const GRID_STEP = 24;

/** Рисует точечную сетку только в видимой области. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  color: string,
): void {
  // На мелком масштабе прореживаем сетку, чтобы точек не было слишком много.
  let step = GRID_STEP;
  while (step * camera.zoom < 12) step *= 2;

  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: width, y: height });
  const startX = Math.floor(topLeft.x / step) * step;
  const startY = Math.floor(topLeft.y / step) * step;
  const size = Math.max(1, Math.min(2, camera.zoom));

  ctx.fillStyle = color;
  for (let x = startX; x <= bottomRight.x; x += step) {
    for (let y = startY; y <= bottomRight.y; y += step) {
      const sx = (x + camera.x) * camera.zoom;
      const sy = (y + camera.y) * camera.zoom;
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
  }
}
