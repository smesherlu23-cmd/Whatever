/** Картинки, которые показываются на доске. Остальные файлы становятся вложениями. */
export const PICTURE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * Картинка больше этого по длинной стороне уменьшается перед загрузкой: на доске такая
 * чёткость не нужна, а загружается и рисуется картинка заметно быстрее.
 */
export const MAX_PICTURE_SIDE = 2048;
const QUALITY = 0.9;

export interface PreparedFile {
  content: Blob;
  name: string;
  /** Размер картинки в пикселях; null — файл не картинка и станет вложением. */
  picture: { width: number; height: number } | null;
}

/** Готовит файл к загрузке: узнаёт размер картинки и уменьшает слишком большую. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  const attachment = { content: file, name: file.name, picture: null };
  if (!PICTURE_TYPES.has(file.type)) return attachment;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Повреждённая картинка: её можно хотя бы приложить к доске файлом.
    return attachment;
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_PICTURE_SIDE / Math.max(width, height));
    if (scale === 1) return { content: file, name: file.name, picture: { width, height } };
    const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
    // GIF после уменьшения — это один кадр, и он сохраняется в PNG.
    const type = file.type === 'image/gif' ? 'image/png' : file.type;
    const content = await encode(bitmap, size, type);
    const name = type === file.type ? file.name : `${file.name.replace(/\.[^.]*$/, '')}.png`;
    return { content, name, picture: size };
  } finally {
    bitmap.close();
  }
}

function encode(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  type: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Браузер не дал нарисовать картинку'));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Браузер не смог сохранить уменьшенную картинку'));
      },
      type,
      QUALITY,
    );
  });
}
