import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Follow } from '../collab/follow';
import { Editor } from '../editor/Editor';
import { BoardFiles } from '../files/boardFiles';
import type { UploadedFile } from '../api';
import { BoardDocument } from '../model/document';
import { enableCanvas } from '../testing/canvas';
import { deferred, defined, shapes } from '../testing/helpers';
import { participant, relay } from '../testing/peers';
import { BoardView } from './BoardView';

describe('BoardView text editing', () => {
  beforeEach(() => {
    enableCanvas();
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

  it('zooms with the buttons and remembers whether the minimap is shown', () => {
    localStorage.removeItem('whatever-minimap');
    const editor = new Editor();
    editor.setViewport({ width: 800, height: 600 });
    render(<BoardView editor={editor} files={new BoardFiles('b1')} header={null} />);

    fireEvent.click(screen.getByRole('button', { name: 'Увеличить' }));
    expect(editor.camera.zoom).toBe(1.25);
    fireEvent.click(screen.getByRole('button', { name: 'Уменьшить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Уменьшить' }));
    expect(screen.getByRole('button', { name: 'Масштаб 80%, вернуть 100%' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Масштаб 80%, вернуть 100%' }));
    expect(editor.camera.zoom).toBeCloseTo(1);
    fireEvent.click(screen.getByRole('button', { name: 'Показать всё' }));

    expect(screen.getByLabelText('Мини-карта: щелчок переносит сюда вид')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Мини-карта' }));
    expect(screen.queryByLabelText('Мини-карта: щелчок переносит сюда вид')).toBeNull();
    expect(localStorage.getItem('whatever-minimap')).toBe('false');
  });

  it('says whom the user follows and stops on Esc, the button or a click on the board', () => {
    const me = participant('Борис');
    const alice = participant('Алиса');
    alice.presence.setView({ x: 0, y: 0, w: 1600, h: 1200 });
    relay(alice, me);
    const editor = new Editor(new BoardDocument(me.ydoc));
    editor.setViewport({ width: 800, height: 600 });
    const follow = new Follow(editor, me.presence);
    render(
      <BoardView
        editor={editor}
        presence={me.presence}
        follow={follow}
        files={new BoardFiles('b1')}
        header={null}
      />,
    );
    const notice = () => screen.queryByText('Вы видите то же, что и Алиса');
    const start = () => {
      act(() => {
        follow.start(alice.id);
      });
      expect(notice()).not.toBeNull();
    };

    start();
    expect(editor.camera.zoom).toBe(0.5);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(notice()).toBeNull();

    start();
    fireEvent.click(screen.getByRole('button', { name: 'Перестать следовать' }));
    expect(notice()).toBeNull();

    start();
    fireEvent.pointerDown(screen.getByLabelText('Холст доски'), { button: 0 });
    expect(follow.leader).toBeNull();
    expect(notice()).toBeNull();
  });
});
