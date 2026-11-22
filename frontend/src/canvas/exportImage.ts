import type { ElementSource } from '../model/document';
import { contentBounds } from '../model/geometry';
import { type Bounds, isArrow } from '../model/types';
import type { ImageCache } from './images';
import { type ImageLookup, type Theme, drawScene } from './scene';

/** Поля вокруг содержимого картинки, в единицах доски. */
export const EXPORT_PADDING = 32;
/** Больше по стороне браузеры холст не создают. */
export const MAX_EXPORT_SIDE = 16384;
/** Около 256 МБ памяти: больше браузер может не суметь сохранить. */
export const MAX_EXPORT_PIXELS = 64_000_000;

/** Фон картинки. Прозрачный рисует фигуры цветами светлой темы. */
export type ExportBackground = 'light' | 'dark' | 'transparent';

export interface ExportPlan {
  /** Что попадёт на картинку, в координатах доски. */
  bounds: Bounds;
  /** Пикселей картинки на единицу доски. */
  scale: number;
  width: number;
  height: number;
  /** Картинка вышла бы слишком большой, и масштаб уменьшен. */
  reduced: boolean;
}

/**
 * Размер картинки с элементами source при масштабе scale; null — рисовать нечего.
 * Если картинка не влезает в пределы браузера, масштаб уменьшается.
 */
export function planExport(source: ElementSource, scale: number): ExportPlan | null {
  const content = contentBounds(source.list(), (id) => source.get(id));
  if (!content) return null;
  const bounds: Bounds = {
    x: content.x - EXPORT_PADDING,
    y: content.y - EXPORT_PADDING,
    w: content.w + EXPORT_PADDING * 2,
    h: content.h + EXPORT_PADDING * 2,
  };
  const fit = Math.min(
    1,
    MAX_EXPORT_SIDE / (bounds.w * scale),
    MAX_EXPORT_SIDE / (bounds.h * scale),
    Math.sqrt(MAX_EXPORT_PIXELS / (bounds.w * bounds.h)) / scale,
  );
  const effective = scale * fit;
  return {
    bounds,
    scale: effective,
    width: Math.max(1, Math.floor(bounds.w * effective)),
    height: Math.max(1, Math.floor(bounds.h * effective)),
    reduced: fit < 1,
  };
}

/**
 * Только выделенные элементы страницы. Фигуры, к которым привязаны их стрелки, ищутся
 * среди всех элементов страницы: стрелка не теряет концы, даже если фигуру не выделили.
 */
export function selectionSource(
  page: ElementSource,
  selection: ReadonlySet<string>,
): ElementSource {
  const list = page.list().filter((el) => selection.has(el.id));
  return { list: () => list, get: (id) => page.get(id) };
}

/** Рисует картинку: фон, если он не прозрачный, и элементы без сетки и выделения. */
export function drawExport(
  ctx: CanvasRenderingContext2D,
  source: ElementSource,
  plan: ExportPlan,
  theme: Theme,
  background: ExportBackground,
  images?: ImageLookup,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (background !== 'transparent') {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, plan.width, plan.height);
  }
  const { scale, bounds } = plan;
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  drawScene(ctx, source, theme, { images });
}

/** PNG с элементами source. Сначала дожидается картинок, иначе на их месте вышли бы заглушки. */
export async function exportPng(
  source: ElementSource,
  plan: ExportPlan,
  theme: Theme,
  background: ExportBackground,
  images: ImageCache,
): Promise<Blob> {
  const files = source.list().flatMap((el) => (!isArrow(el) && el.file ? [el.file.id] : []));
  await images.ready(files);
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не дал нарисовать картинку');
  drawExport(ctx, source, plan, theme, background, images.get);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Браузеру не хватило памяти на такую большую картинку'));
    }, 'image/png');
  });
}
