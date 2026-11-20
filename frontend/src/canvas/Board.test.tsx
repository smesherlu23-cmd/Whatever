import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/Editor';
import { shapes } from '../testing/helpers';
import { Board } from './Board';

/** Контекст-заглушка: Board нужен лишь сам факт, что рисовать есть на чём. */
const nullContext = new Proxy({}, { get: () => () => ({ width: 0 }) });

describe('Board', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      nullContext as CanvasRenderingContext2D,
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

  it('pans the camera with the wheel and zooms with Ctrl', () => {
    const editor = new Editor();
    render(<Board editor={editor} />);
    const canvas = screen.getByLabelText('Холст доски');

    fireEvent.wheel(canvas, { deltaX: 0, deltaY: 100 });
    expect(editor.camera.y).toBe(-100);
    fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: true });
    expect(editor.camera.zoom).toBeGreaterThan(1);
  });
});
