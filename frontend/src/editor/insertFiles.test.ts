import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type UploadedFile } from '../api';
import * as prepare from '../files/prepare';
import { deferred, shapes } from '../testing/helpers';
import { Editor } from './Editor';
import { insertFiles } from './insertFiles';

function uploaded(name: string, contentType: string): UploadedFile {
  return { id: `id-${name}`, name, content_type: contentType, size: 1000 };
}

function prepared(file: File, picture: { width: number; height: number } | null) {
  return { content: file, name: file.name, picture };
}

describe('insertFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts pictures and attachments in a row around the point in one undo step', async () => {
    const editor = new Editor();
    const photo = new File(['jpg'], 'фото.jpg', { type: 'image/jpeg' });
    const report = new File(['pdf'], 'отчёт.pdf', { type: 'application/pdf' });
    vi.spyOn(prepare, 'prepareFile').mockImplementation((file) =>
      Promise.resolve(prepared(file, file === photo ? { width: 960, height: 480 } : null)),
    );
    const upload = vi.fn((_content: Blob, name: string) =>
      Promise.resolve(
        uploaded(name, name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'),
      ),
    );

    const result = await insertFiles(editor, [photo, report], { x: 0, y: 0 }, upload);

    expect(result).toEqual({ inserted: 2, failed: [] });
    const [picture, card] = shapes(editor.doc);
    // Длинная сторона картинки — 480 экранных пикселей; карточка стоит справа от неё.
    expect(picture).toMatchObject({ kind: 'image', x: -382, y: -120, w: 480, h: 240 });
    expect(picture?.file).toEqual({
      id: 'id-фото.jpg',
      name: 'фото.jpg',
      size: 1000,
      type: 'image/jpeg',
    });
    expect(card).toMatchObject({ kind: 'file', x: 122, y: -36, w: 260, h: 72 });
    expect(editor.selection.size).toBe(2);
    editor.undo();
    expect(editor.doc.size).toBe(0);
  });

  it('makes pictures bigger in the world when zoomed out, but never beyond their size', async () => {
    const editor = new Editor();
    editor.setCamera({ x: 0, y: 0, zoom: 0.25 });
    const file = new File(['png'], 'схема.png', { type: 'image/png' });
    vi.spyOn(prepare, 'prepareFile').mockResolvedValue(
      prepared(file, { width: 1000, height: 500 }),
    );
    await insertFiles(editor, [file], { x: 0, y: 0 }, () =>
      Promise.resolve(uploaded('схема.png', 'image/png')),
    );
    expect(shapes(editor.doc)[0]).toMatchObject({ w: 1000, h: 500 });
  });

  it('treats a picture the server did not recognise as an attachment', async () => {
    const editor = new Editor();
    const file = new File(['?'], 'странная.png', { type: 'image/png' });
    vi.spyOn(prepare, 'prepareFile').mockResolvedValue(prepared(file, { width: 10, height: 10 }));
    await insertFiles(editor, [file], { x: 0, y: 0 }, () =>
      Promise.resolve(uploaded('странная.png', 'application/octet-stream')),
    );
    expect(shapes(editor.doc)[0]).toMatchObject({ kind: 'file' });
  });

  it('reports the files that failed and inserts the rest', async () => {
    const editor = new Editor();
    const files = ['большой.zip', 'обрыв.txt', 'хороший.txt', 'странный.bin', 'битый.png'].map(
      (name) => new File(['x'], name),
    );
    vi.spyOn(prepare, 'prepareFile').mockImplementation((file) =>
      file.name === 'битый.png'
        ? Promise.reject(new Error('Браузер не смог сохранить уменьшенную картинку'))
        : Promise.resolve(prepared(file, null)),
    );
    const upload = (_content: Blob, name: string): Promise<UploadedFile> => {
      if (name === 'большой.zip') return Promise.reject(new ApiError(413, 'Файл больше 10 МБ', ''));
      if (name === 'обрыв.txt') return Promise.reject(new TypeError('Failed to fetch'));
      if (name === 'странный.bin') return Promise.reject(new ApiError(500, null, 'Error'));
      return Promise.resolve(uploaded(name, 'application/octet-stream'));
    };

    const result = await insertFiles(editor, files, { x: 0, y: 0 }, upload);

    expect(result.inserted).toBe(1);
    expect(result.failed).toEqual([
      { name: 'большой.zip', reason: 'Файл больше 10 МБ' },
      { name: 'обрыв.txt', reason: 'Нет связи с сервером' },
      { name: 'странный.bin', reason: 'Сервер ответил ошибкой 500' },
      { name: 'битый.png', reason: 'Браузер не смог сохранить уменьшенную картинку' },
    ]);
    expect(shapes(editor.doc)).toHaveLength(1);
  });

  it('puts the files on the page where they were inserted', async () => {
    const editor = new Editor();
    const first = editor.pageId;
    const second = editor.doc.addPage('Вторая');
    const file = new File(['x'], 'план.txt');
    vi.spyOn(prepare, 'prepareFile').mockResolvedValue(prepared(file, null));
    const upload = deferred<UploadedFile>();
    const pending = insertFiles(editor, [file], { x: 0, y: 0 }, () => upload.promise);
    // Пока файл загружается, пользователь перешёл на другую страницу.
    editor.setPage(second);
    upload.resolve(uploaded('план.txt', 'application/octet-stream'));
    await pending;
    expect(editor.doc.page(first).list()).toHaveLength(1);
    expect(editor.selection.size).toBe(0);
  });

  it('does nothing for a viewer', async () => {
    const editor = new Editor();
    editor.setReadOnly(true);
    const upload = vi.fn();
    await expect(
      insertFiles(editor, [new File(['x'], 'a.txt')], { x: 0, y: 0 }, upload),
    ).resolves.toEqual({
      inserted: 0,
      failed: [],
    });
    expect(upload).not.toHaveBeenCalled();
  });
});
