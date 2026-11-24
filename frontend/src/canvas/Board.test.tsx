import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/Editor';
import { DEFAULT_FILL, DEFAULT_STROKE, type FileRef, type Point } from '../model/types';
import { type Call, enableCanvas, recordingContext } from '../testing/canvas';
import { defined, fileId, shapes } from '../testing/helpers';
import { participant, relay } from '../testing/peers';
import { Dialog } from '../ui/Dialog';
import { Board } from './Board';

describe('Board', () => {
  beforeEach(() => {
    enableCanvas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('turns pointer events into editor actions', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    render(<Board editor={editor} />);
    const canvas = screen.getByLabelText('Холст доски');

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 200, clientY: 120 });
    fireEvent.pointerUp(canvas);

    expect(shapes(editor.doc)).toEqual([
      expect.objectContaining({ kind: 'rectangle', x: 10, y: 10, w: 190, h: 110 }),
    ]);
  });

  it('handles keyboard shortcuts but not while typing in a field', () => {
    const editor = new Editor();
    render(
      <>
        <Board editor={editor} />
        <input aria-label="Поле" />
      </>,
    );
    fireEvent.keyDown(window, { key: 'r', code: 'KeyR' });
    expect(editor.tool).toBe('rectangle');

    fireEvent.keyDown(screen.getByLabelText('Поле'), { key: 'o', code: 'KeyO' });
    expect(editor.tool).toBe('rectangle');
  });

  it('leaves keys to an open menu: Enter picks an item there', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    render(
      <>
        <Board editor={editor} />
        <div role="menu">
          <button type="button" role="menuitem">
            Удалить
          </button>
        </div>
      </>,
    );
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'o', code: 'KeyO' });
    expect(editor.tool).toBe('rectangle');
  });

  it('opens its own context menu on right click, with what is under the pointer selected', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    const onContextMenu = vi.fn<(at: Point) => void>();
    const { rerender } = render(<Board editor={editor} onContextMenu={onContextMenu} />);
    const canvas = screen.getByLabelText('Холст доски');
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(canvas, { clientX: 110, clientY: 110 });
    fireEvent.pointerUp(canvas);
    editor.select([]);

    const menu = createEvent.contextMenu(canvas, { clientX: 50, clientY: 60 });
    fireEvent(canvas, menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(onContextMenu).toHaveBeenCalledExactlyOnceWith({ x: 50, y: 60 });
    expect([...editor.selection]).toEqual([defined(shapes(editor.doc)[0]).id]);

    // Без обработчика остаётся меню браузера.
    rerender(<Board editor={editor} />);
    const native = createEvent.contextMenu(canvas, { clientX: 50, clientY: 60 });
    fireEvent(canvas, native);
    expect(native.defaultPrevented).toBe(false);
  });

  it('leaves keys and pasted files to an open dialog', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    const onInsertFiles = vi.fn<(files: File[], at: Point) => void>();
    render(
      <>
        <Board editor={editor} onInsertFiles={onInsertFiles} />
        <Dialog title="Экспорт" onClose={vi.fn()}>
          <button type="button">Скачать</button>
        </Dialog>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Скачать' });

    // Esc и пробел браузер отдаёт окну: окно закрывается, кнопка нажимается.
    expect(fireEvent.keyDown(button, { key: 'Escape', code: 'Escape' })).toBe(true);
    expect(fireEvent.keyDown(button, { key: ' ', code: 'Space' })).toBe(true);
    expect(editor.spaceHeld).toBe(false);
    fireEvent.keyDown(document.body, { key: 'o', code: 'KeyO' });
    expect(editor.tool).toBe('rectangle');
    fireEvent.paste(window, { clipboardData: { files: [new File(['x'], 'снимок.png')] } });
    expect(onInsertFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(editor.tool).toBe('select');
  });

  it('takes files dropped on the canvas or pasted, and opens attachments', () => {
    const editor = new Editor();
    const file = { id: fileId(1), name: 'план.pdf', size: 10, type: 'application/octet-stream' };
    editor.doc.add({
      id: 'c',
      kind: 'file',
      page: editor.pageId,
      x: 0,
      y: 0,
      w: 260,
      h: 72,
      text: '',
      stroke: DEFAULT_STROKE,
      fill: DEFAULT_FILL,
      z: 1,
      file,
    });
    const onInsertFiles = vi.fn<(files: File[], at: Point) => void>();
    const onOpenFile = vi.fn<(file: FileRef) => void>();
    render(<Board editor={editor} onInsertFiles={onInsertFiles} onOpenFile={onOpenFile} />);
    const canvas = screen.getByLabelText('Холст доски');
    const dropped = new File(['x'], 'схема.png', { type: 'image/png' });
    const transfer = { types: ['Files'], files: [dropped], dropEffect: 'none' };

    const over = fireEvent.dragOver(canvas, { dataTransfer: transfer });
    expect(over).toBe(false);
    expect(transfer.dropEffect).toBe('copy');
    // В jsdom нет DragEvent: координаты у события приходится задать вручную.
    const drop = createEvent.drop(canvas, { dataTransfer: transfer });
    Object.defineProperties(drop, { clientX: { value: 300 }, clientY: { value: 200 } });
    fireEvent(canvas, drop);
    expect(onInsertFiles).toHaveBeenLastCalledWith([dropped], { x: 300, y: 200 });

    // Перетаскивание текста холст не трогает.
    expect(fireEvent.dragOver(canvas, { dataTransfer: { types: ['text/plain'] } })).toBe(true);

    editor.setViewport({ width: 800, height: 600 });
    fireEvent.paste(window, { clipboardData: { files: [dropped] } });
    expect(onInsertFiles).toHaveBeenLastCalledWith([dropped], { x: 400, y: 300 });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 60 });
    fireEvent.paste(window, { clipboardData: { files: [dropped] } });
    expect(onInsertFiles).toHaveBeenLastCalledWith([dropped], { x: 50, y: 60 });
    fireEvent.pointerLeave(canvas);
    fireEvent.paste(window, { clipboardData: { files: [] } });
    expect(onInsertFiles).toHaveBeenCalledTimes(3);

    fireEvent.doubleClick(canvas, { clientX: 100, clientY: 30 });
    expect(onOpenFile).toHaveBeenCalledWith(file);
  });

  it('ignores files when nobody takes them', () => {
    const editor = new Editor();
    render(<Board editor={editor} />);
    const canvas = screen.getByLabelText('Холст доски');
    const transfer = { types: ['Files'], files: [new File(['x'], 'a.txt')] };
    expect(fireEvent.dragOver(canvas, { dataTransfer: transfer })).toBe(true);
  });

  it('pans the camera with the wheel and zooms with Ctrl', () => {
    const editor = new Editor();
    render(<Board editor={editor} />);
    const canvas = screen.getByLabelText('Холст доски');

    fireEvent.wheel(canvas, { deltaX: 0, deltaY: 100 });
    expect(editor.camera.y).toBe(-100);
    fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: true });
    expect(editor.camera.zoom).toBeGreaterThan(1);
  });
  it('redraws the scene only when it changes and asks for no frames while idle', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const drawn = new Map<HTMLCanvasElement, Call[]>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      const { ctx, calls } = recordingContext();
      drawn.set(this, calls);
      return ctx;
    });
    const runFrames = () => {
      for (const frame of frames.splice(0)) frame(0);
    };
    const editor = new Editor();
    const me = participant('Алиса');
    const peer = participant('Борис');
    const { container } = render(<Board editor={editor} presence={me.presence} />);
    const scene = defined(drawn.get(defined(container.querySelector('canvas[aria-hidden]'))));
    const overlay = defined(drawn.get(screen.getByLabelText('Холст доски')));
    const clears = () => overlay.filter(([method]) => method === 'clearRect').length;
    // Фон сцены — заливка от левого верхнего угла холста.
    const backgrounds = () =>
      scene.filter(([method, x, y]) => method === 'fillRect' && x === 0 && y === 0).length;

    runFrames();
    expect(backgrounds()).toBe(1);
    expect(clears()).toBe(1);
    runFrames();
    expect(frames).toEqual([]);

    // Чужой курсор сдвинулся: перерисован только верхний слой.
    peer.presence.setCursor({ x: 10, y: 10 });
    relay(peer, me);
    runFrames();
    expect(backgrounds()).toBe(1);
    expect(clears()).toBe(2);

    // Изменился документ: перерисованы оба слоя.
    editor.setTool('rectangle');
    runFrames();
    expect(backgrounds()).toBe(1);
    editor.doc.add({
      id: 'r',
      kind: 'rectangle',
      text: '',
      page: editor.pageId,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      z: 1,
      stroke: DEFAULT_STROKE,
      fill: DEFAULT_FILL,
    });
    runFrames();
    expect(backgrounds()).toBe(2);
  });
});
