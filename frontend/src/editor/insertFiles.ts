import { ApiError, type UploadedFile } from '../api';
import { PICTURE_TYPES, prepareFile } from '../files/prepare';
import { newId } from '../model/ids';
import { shapeSpec } from '../model/shapes';
import { DEFAULT_STROKE, type FileRef, type Point, type ShapeElement } from '../model/types';
import type { Editor } from './Editor';

/** Длинная сторона новой картинки на экране, в пикселях. Дальше её тянут как нужно. */
const PICTURE_SCREEN_SIDE = 480;
/** Расстояние между файлами, вставленными вместе. */
const GAP = 24;

export type Upload = (content: Blob, name: string) => Promise<UploadedFile>;

export interface InsertReport {
  inserted: number;
  /** Файлы, которые не удалось вставить, и почему. */
  failed: { name: string; reason: string }[];
}

interface Placed {
  kind: 'image' | 'file';
  file: FileRef;
  w: number;
  h: number;
}

/** Почему файл не вставился, для пользователя. */
function reason(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? `Сервер ответил ошибкой ${error.status}`;
  // fetch отклоняется с TypeError, когда до сервера не достучаться.
  if (error instanceof TypeError) return 'Нет связи с сервером';
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}

async function place(file: File, upload: Upload, zoom: number): Promise<Placed> {
  const prepared = await prepareFile(file);
  const saved = await upload(prepared.content, prepared.name);
  const ref: FileRef = {
    id: saved.id,
    name: saved.name,
    size: saved.size,
    type: saved.content_type,
  };
  const { picture } = prepared;
  // Картинкой файл станет, только если и сервер признал его картинкой.
  if (!picture || !PICTURE_TYPES.has(saved.content_type)) {
    return { kind: 'file', file: ref, ...shapeSpec('file').size };
  }
  const scale = Math.min(1, PICTURE_SCREEN_SIDE / zoom / Math.max(picture.width, picture.height));
  return { kind: 'image', file: ref, w: picture.width * scale, h: picture.height * scale };
}

/**
 * Загружает файлы на доску и ставит их в ряд с серединой в точке at: картинки — картинками,
 * остальное — карточками вложений. Файлы попадают на страницу, которая была открыта
 * при вставке, а все удачные вставки — один шаг отмены. О неудачных сообщает отчёт.
 */
export async function insertFiles(
  editor: Editor,
  files: readonly File[],
  at: Point,
  upload: Upload,
): Promise<InsertReport> {
  if (editor.readOnly || files.length === 0) return { inserted: 0, failed: [] };
  const { pageId } = editor;
  const results = await Promise.allSettled(
    files.map((file) => place(file, upload, editor.camera.zoom)),
  );
  const placed: Placed[] = [];
  const failed: InsertReport['failed'] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') placed.push(result.value);
    else failed.push({ name: files[i]?.name ?? '', reason: reason(result.reason) });
  });

  // Пока файлы загружались, страницу могли удалить: тогда они встанут на открытую.
  const page = editor.doc.hasPage(pageId) ? pageId : editor.pageId;
  const width = placed.reduce((sum, item) => sum + item.w, GAP * (placed.length - 1));
  let x = at.x - width / 2;
  let z = editor.doc.nextZ();
  const elements = placed.map(({ kind, file, w, h }): ShapeElement => {
    const el: ShapeElement = {
      id: newId(),
      kind,
      page,
      x,
      y: at.y - h / 2,
      w,
      h,
      text: '',
      stroke: DEFAULT_STROKE,
      fill: shapeSpec(kind).fill,
      z: z++,
      file,
    };
    x += w + GAP;
    return el;
  });
  editor.insert(elements);
  return { inserted: elements.length, failed };
}
