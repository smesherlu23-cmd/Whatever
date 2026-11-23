import type { ElementSource } from '../model/document';
import { contentBounds } from '../model/geometry';
import type { ScreenSize } from './camera';
import { type Theme, drawScene } from './scene';

/** Поле вокруг содержимого превью, в его пикселях. */
const PADDING = 8;

/**
 * Рисует превью: всё содержимое source, вписанное в рамку size и не крупнее, чем на доске.
 * Без фона, сетки и картинок файлов: на месте картинок заглушки. Масштаб не ограничен
 * снизу, как у камеры: превью большой доски показывает её целиком.
 */
export function drawThumbnail(
  ctx: CanvasRenderingContext2D,
  source: ElementSource,
  size: ScreenSize,
  theme: Theme,
): void {
  const content = contentBounds(source.list(), (id) => source.get(id));
  if (!content) return;
  const scale = Math.min(
    (size.width - PADDING * 2) / Math.max(content.w, 1),
    (size.height - PADDING * 2) / Math.max(content.h, 1),
    1,
  );
  ctx.save();
  ctx.translate(
    size.width / 2 - (content.x + content.w / 2) * scale,
    size.height / 2 - (content.y + content.h / 2) * scale,
  );
  ctx.scale(scale, scale);
  drawScene(ctx, source, theme);
  ctx.restore();
}
