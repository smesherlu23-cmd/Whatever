import { describe, expect, it } from 'vitest';
import { defined, shapes } from '../testing/helpers';
import { Editor } from './Editor';

function editorWithRectangle(): Editor {
  const editor = new Editor();
  editor.setTool('rectangle');
  editor.pointerDown({ x: 0, y: 0 });
  editor.pointerUp();
  return editor;
}

describe('keyboard shortcuts', () => {
  it('picks tools by physical key, so they work in the Russian layout too', () => {
    const editor = new Editor();
    expect(editor.keyDown({ key: 'к', code: 'KeyR' })).toBe(true);
    expect(editor.tool).toBe('rectangle');
    expect(editor.keyDown({ key: 'з', code: 'KeyP' })).toBe(true);
    expect(editor.tool).toBe('pen');
    expect(editor.keyDown({ key: 'q', code: 'KeyQ' })).toBe(false);
    for (const [code, tool] of [
      ['KeyU', 'rounded'],
      ['KeyY', 'triangle'],
      ['KeyS', 'sticky'],
    ] as const) {
      editor.keyDown({ key: '', code });
      expect(editor.tool).toBe(tool);
    }
  });

  it('undoes in the Russian layout and redoes with Shift', () => {
    const editor = editorWithRectangle();
    editor.keyDown({ key: 'я', code: 'KeyZ', ctrl: true });
    expect(editor.doc.size).toBe(0);
    editor.keyDown({ key: 'Я', code: 'KeyZ', ctrl: true, shift: true });
    expect(editor.doc.size).toBe(1);
    editor.keyDown({ key: 'я', code: 'KeyZ', ctrl: true });
    editor.keyDown({ key: 'y', ctrl: true });
    expect(editor.doc.size).toBe(1);
  });

  it('leaves unknown Ctrl combinations to the browser', () => {
    expect(new Editor().keyDown({ key: 'p', code: 'KeyP', ctrl: true })).toBe(false);
  });

  it('starts editing the selected shape on Enter and resets on Escape', () => {
    const editor = editorWithRectangle();
    const rect = defined(shapes(editor.doc)[0]);
    editor.stopEditing();
    expect(editor.keyDown({ key: 'Enter' })).toBe(true);
    expect(editor.editingId).toBe(rect.id);
    // Пока идёт ввод текста, клавиши принадлежат полю ввода.
    expect(editor.keyDown({ key: 'Delete' })).toBe(false);

    editor.stopEditing();
    editor.setTool('pen');
    expect(editor.keyDown({ key: 'Escape' })).toBe(true);
    expect(editor.tool).toBe('select');
    expect(editor.selection.size).toBe(0);
    expect(editor.keyDown({ key: 'Enter' })).toBe(false);
  });

  it('zooms with Ctrl and the plus or minus key, and fits the view with Shift and a digit', () => {
    const editor = editorWithRectangle();
    editor.setViewport({ width: 800, height: 600 });
    expect(editor.keyDown({ key: '=', code: 'Equal', ctrl: true })).toBe(true);
    expect(editor.camera.zoom).toBe(1.25);
    editor.keyDown({ key: '-', code: 'Minus', ctrl: true });
    editor.keyDown({ key: '-', code: 'Minus', ctrl: true });
    expect(editor.camera.zoom).toBeCloseTo(0.8);
    expect(editor.keyDown({ key: ')', code: 'Digit0', shift: true })).toBe(true);
    expect(editor.camera.zoom).toBeCloseTo(1);

    editor.keyDown({ key: '!', code: 'Digit1', shift: true });
    // Прямоугольник 160×80 целиком в окне и посередине, но не крупнее 100%.
    expect(editor.camera.zoom).toBe(1);
    expect(editor.viewportCenter()).toEqual({ x: 0, y: 0 });

    editor.keyDown({ key: '@', code: 'Digit2', shift: true });
    expect(editor.camera.zoom).toBeGreaterThan(1);
  });
});
