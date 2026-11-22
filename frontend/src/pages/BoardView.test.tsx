import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/Editor';
import { BoardFiles } from '../files/boardFiles';
import type { UploadedFile } from '../api';
import { deferred, defined, shapes } from '../testing/helpers';
import { BoardView } from './BoardView';

describe('BoardView text editing', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy({}, { get: () => () => ({ width: 0 }) }) as CanvasRenderingContext2D,
    );
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the typed text when the user clicks elsewhere on the board', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    editor.pointerDown({ x: 100, y: 100 });
    editor.pointerUp();
    const rect = defined(shapes(editor.doc)[0]);
    editor.startEditing(rect.id);
    render(<BoardView editor={editor} files={new BoardFiles('b1')} header={null} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Текст фигуры' }), {
      target: { value: 'Сервис оплаты' },
    });
    // Щелчок по холсту: браузер сначала шлёт pointerdown, а blur поля приходит позже.
    fireEvent.pointerDown(screen.getByLabelText('Холст доски'), {
      clientX: 600,
      clientY: 500,
      button: 0,
    });

    expect(editor.doc.get(rect.id)).toMatchObject({ text: 'Сервис оплаты' });
    expect(screen.queryByRole('textbox', { name: 'Текст фигуры' })).toBeNull();
  });

  it('inserts files chosen with the toolbar button and reports what failed', async () => {
    const editor = new Editor();
    editor.setViewport({ width: 800, height: 600 });
    const files = new BoardFiles('b1');
    const upload = deferred<UploadedFile>();
    vi.spyOn(files, 'upload').mockReturnValue(upload.promise);
    render(<BoardView editor={editor} files={files} header={null} />);
    const picker = screen.getByLabelText<HTMLInputElement>('Картинки и файлы для вставки');
    const click = vi.spyOn(picker, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Картинка или файл' }));
    expect(click).toHaveBeenCalled();

    fireEvent.change(picker, { target: { files: [new File(['x'], 'отчёт.pdf')] } });
    expect((await screen.findByRole('status')).textContent).toBe('Загружается файл…');
    upload.reject(new TypeError('Failed to fetch'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не удалось вставить «отчёт.pdf». Нет связи с сервером.');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
