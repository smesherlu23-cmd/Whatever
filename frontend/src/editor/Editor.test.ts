import { describe, expect, it } from 'vitest';
import { arrows, defined, shapes, takeTwo } from '../testing/helpers';
import { DEFAULT_STICKY_FILL } from '../model/types';
import { Editor } from './Editor';

function drag(editor: Editor, from: [number, number], to: [number, number], shift = false) {
  editor.pointerDown({ x: from[0], y: from[1] }, { shift });
  editor.pointerMove({ x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2 }, { shift });
  editor.pointerMove({ x: to[0], y: to[1] }, { shift });
  editor.pointerUp();
}

describe('Editor', () => {
  it('creates a rectangle by dragging and selects it', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [100, 100], [260, 180]);
    const rect = defined(shapes(editor.doc)[0]);
    expect(rect).toMatchObject({ kind: 'rectangle', x: 100, y: 100, w: 160, h: 80 });
    expect(editor.tool).toBe('select');
    expect([...editor.selection]).toEqual([rect.id]);
  });

  it('creates a default-size shape on a click', () => {
    const editor = new Editor();
    editor.setTool('ellipse');
    editor.pointerDown({ x: 200, y: 200 });
    editor.pointerUp();
    expect(shapes(editor.doc)[0]).toMatchObject({ x: 140, y: 140, w: 120, h: 120 });
  });

  it('creates the new shapes with their own defaults', () => {
    const editor = new Editor();
    for (const [tool, x] of [
      ['rounded', 0],
      ['triangle', 300],
      ['sticky', 600],
    ] as const) {
      editor.setTool(tool);
      editor.pointerDown({ x, y: 0 });
      editor.pointerUp();
    }
    const [rounded, triangle, sticky] = shapes(editor.doc);
    expect(rounded).toMatchObject({ kind: 'rounded', w: 160, h: 80 });
    expect(triangle).toMatchObject({ kind: 'triangle', w: 140, h: 120 });
    expect(sticky).toMatchObject({ kind: 'sticky', w: 160, h: 160, fill: DEFAULT_STICKY_FILL });
  });

  it('draws elbow arrows and switches selected arrows in one undo step', () => {
    const editor = new Editor();
    editor.setArrowRoute('elbow');
    editor.setTool('arrow');
    drag(editor, [0, 0], [200, 100]);
    // Новая стрелка остаётся выделенной: снимаем выделение, чтобы не переключить и её.
    editor.select([]);
    editor.setArrowRoute('straight');
    editor.setTool('arrow');
    drag(editor, [0, 300], [200, 400]);
    const [elbow, straight] = takeTwo(arrows(editor.doc));
    expect(elbow.route).toBe('elbow');
    expect(straight.route).toBe('straight');

    editor.select([elbow.id, straight.id]);
    expect(editor.getState().selectionRoute).toBe('mixed');
    editor.setArrowRoute('elbow');
    expect(arrows(editor.doc).map((a) => a.route)).toEqual(['elbow', 'elbow']);
    expect(editor.getState().selectionRoute).toBe('elbow');
    editor.undo();
    expect(arrows(editor.doc).map((a) => a.route)).toEqual(['elbow', 'straight']);

    editor.select([]);
    expect(editor.getState().selectionRoute).toBeNull();
  });

  it('moves the selection and undoes the whole drag in one step', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    drag(editor, [50, 50], [150, 80]);
    expect(shapes(editor.doc)[0]).toMatchObject({ x: 100, y: 30 });
    editor.undo();
    expect(shapes(editor.doc)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('respects zoom when converting pointer positions', () => {
    const editor = new Editor();
    editor.setCamera({ x: 0, y: 0, zoom: 2 });
    editor.setTool('rectangle');
    drag(editor, [100, 100], [300, 200]);
    expect(shapes(editor.doc)[0]).toMatchObject({ x: 50, y: 50, w: 100, h: 50 });
  });

  it('resizes from a corner handle', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    drag(editor, [100, 100], [150, 120]);
    expect(shapes(editor.doc)[0]).toMatchObject({ x: 0, y: 0, w: 150, h: 120 });
  });

  it('selects shapes fully inside the marquee', () => {
    const editor = new Editor();
    for (const x of [0, 200, 400]) {
      editor.setTool('rectangle');
      drag(editor, [x, 0], [x + 100, 100]);
    }
    editor.select([]);
    drag(editor, [-10, -10], [320, 120]);
    expect(editor.selection.size).toBe(2);
    expect(editor.marquee).toBeNull();
  });

  it('binds an arrow to the shapes it starts and ends on', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.setTool('rectangle');
    drag(editor, [300, 0], [400, 100]);
    const [a, b] = takeTwo(shapes(editor.doc));
    editor.setTool('arrow');
    drag(editor, [50, 50], [350, 50]);
    const arrow = defined(arrows(editor.doc)[0]);
    expect(arrow.start.shapeId).toBe(a.id);
    expect(arrow.end.shapeId).toBe(b.id);

    // Стрелка едет вслед за фигурой.
    editor.select([b.id]);
    drag(editor, [350, 50], [350, 250]);
    expect(arrows(editor.doc)[0]?.end.shapeId).toBe(b.id);
  });

  it('drops an arrow that was only clicked', () => {
    const editor = new Editor();
    editor.setTool('arrow');
    editor.pointerDown({ x: 10, y: 10 });
    editor.pointerUp();
    expect(editor.doc.size).toBe(0);
  });

  it('deletes, duplicates and selects all from the keyboard', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    expect(editor.keyDown({ key: 'd', code: 'KeyD', ctrl: true })).toBe(true);
    expect(editor.doc.size).toBe(2);
    editor.keyDown({ key: 'a', code: 'KeyA', ctrl: true });
    expect(editor.selection.size).toBe(2);
    editor.keyDown({ key: 'Delete' });
    expect(editor.doc.size).toBe(0);
    editor.keyDown({ key: 'z', code: 'KeyZ', ctrl: true });
    expect(editor.doc.size).toBe(2);
  });

  it('edits text and removes an empty text element', () => {
    const editor = new Editor();
    editor.setTool('text');
    editor.pointerDown({ x: 100, y: 100 });
    editor.pointerUp();
    expect(editor.editingId).not.toBeNull();
    editor.stopEditing();
    expect(editor.doc.size).toBe(0);

    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.doubleClick({ x: 50, y: 50 });
    editor.setEditingText('База данных');
    editor.stopEditing();
    expect(shapes(editor.doc)[0]?.text).toBe('База данных');
  });

  it('saves the typed text however editing ends', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    const rect = defined(shapes(editor.doc)[0]);

    // Щелчок по пустому месту доски.
    editor.startEditing(rect.id);
    editor.setEditingText('API');
    editor.pointerDown({ x: 500, y: 500 });
    editor.pointerUp();
    expect(editor.doc.get(rect.id)).toMatchObject({ text: 'API' });

    // Переход к редактированию другой фигуры.
    editor.setTool('ellipse');
    drag(editor, [200, 0], [300, 100]);
    const ellipse = defined(shapes(editor.doc)[1]);
    editor.startEditing(rect.id);
    editor.setEditingText('API v2');
    editor.startEditing(ellipse.id);
    expect(editor.doc.get(rect.id)).toMatchObject({ text: 'API v2' });

    // Ctrl+Z отменяет ввод одним шагом.
    editor.stopEditing();
    editor.undo();
    expect(editor.doc.get(rect.id)).toMatchObject({ text: 'API' });
  });

  it('drops the draft when another participant deletes the shape', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    const rect = defined(shapes(editor.doc)[0]);
    editor.startEditing(rect.id);
    editor.setEditingText('Черновик');
    editor.doc.remove([rect.id]);
    expect(editor.editingId).toBeNull();
    editor.stopEditing();
    expect(editor.doc.size).toBe(0);
  });
});
