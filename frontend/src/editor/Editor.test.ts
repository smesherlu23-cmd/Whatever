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
    editor.setArrowStyle({ route: 'elbow' });
    editor.setTool('arrow');
    drag(editor, [0, 0], [200, 100]);
    // Новая стрелка остаётся выделенной: снимаем выделение, чтобы не переключить и её.
    editor.select([]);
    editor.setArrowStyle({ route: 'straight' });
    editor.setTool('arrow');
    drag(editor, [0, 300], [200, 400]);
    const [elbow, straight] = takeTwo(arrows(editor.doc));
    expect(elbow.route).toBe('elbow');
    expect(straight.route).toBe('straight');

    editor.select([elbow.id, straight.id]);
    expect(editor.getState().selectionArrowStyle).toMatchObject({ route: null, endHead: 'arrow' });
    editor.setArrowStyle({ route: 'elbow' });
    expect(arrows(editor.doc).map((a) => a.route)).toEqual(['elbow', 'elbow']);
    expect(editor.getState().selectionArrowStyle?.route).toBe('elbow');
    editor.undo();
    expect(arrows(editor.doc).map((a) => a.route)).toEqual(['elbow', 'straight']);

    editor.select([]);
    expect(editor.getState().selectionArrowStyle).toBeNull();
  });

  it('draws new arrows with the chosen heads and dash, and restyles selected ones', () => {
    const editor = new Editor();
    editor.setArrowStyle({ startHead: 'diamond', endHead: 'open', dashed: true });
    editor.setTool('arrow');
    drag(editor, [0, 0], [200, 0]);
    const arrow = defined(arrows(editor.doc)[0]);
    expect(arrow).toMatchObject({ startHead: 'diamond', endHead: 'open', dashed: true, text: '' });

    const before = editor.getState().selectionArrowStyle;
    editor.pointerMove({ x: 5, y: 5 });
    // Пока вид выделенных стрелок тот же, состояние отдаёт тот же объект.
    expect(editor.getState().selectionArrowStyle).toBe(before);
    editor.setArrowStyle({ endHead: 'triangle' });
    expect(editor.doc.get(arrow.id)).toMatchObject({ endHead: 'triangle', startHead: 'diamond' });
    expect(editor.arrowStyle).toMatchObject({ endHead: 'triangle', dashed: true });
  });

  it('edits the label of an arrow on double click', () => {
    const editor = new Editor();
    editor.setTool('arrow');
    drag(editor, [0, 0], [200, 0]);
    const arrow = defined(arrows(editor.doc)[0]);
    editor.select([]);
    editor.doubleClick({ x: 100, y: 1 });
    expect(editor.editingId).toBe(arrow.id);
    editor.setEditingText('HTTPS');
    editor.stopEditing();
    expect(editor.doc.get(arrow.id)).toMatchObject({ text: 'HTTPS' });
    // По подписи теперь тоже можно попасть, даже если она шире линии.
    expect(editor.elementAt({ x: 100, y: 8 })?.id).toBe(arrow.id);
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

describe('Editor in read-only mode', () => {
  function viewerWithShapes() {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.setTool('arrow');
    drag(editor, [300, 0], [500, 0]);
    editor.setReadOnly(true);
    const [rect] = shapes(editor.doc);
    const [arrow] = arrows(editor.doc);
    return { editor, rect: defined(rect), arrow: defined(arrow) };
  }

  it('lets a viewer select and look around but not change anything', () => {
    const { editor, rect, arrow } = viewerWithShapes();
    const before = editor.doc.list();

    editor.setTool('rectangle');
    expect(editor.tool).toBe('select');
    drag(editor, [50, 50], [250, 250]);
    expect([...editor.selection]).toEqual([rect.id]);
    expect(editor.handlePositions()).toEqual([]);

    editor.select([arrow.id]);
    expect(editor.selectedArrow()).toBeUndefined();
    drag(editor, [500, 0], [600, 100]);

    editor.select([rect.id]);
    editor.doubleClick({ x: 50, y: 50 });
    expect(editor.editingId).toBeNull();
    editor.deleteSelection();
    editor.duplicateSelection();
    editor.setArrowStyle({ route: 'elbow' });
    editor.undo();
    expect(editor.keyDown({ key: 'Delete' })).toBe(true);
    expect(editor.doc.list()).toEqual(before);

    editor.wheel({ x: 0, y: 0 }, 0, 100, false);
    expect(editor.camera.y).not.toBe(0);
  });

  it('drops an unfinished edit when access is reduced', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    const rect = defined(shapes(editor.doc)[0]);
    editor.startEditing(rect.id);
    editor.setEditingText('Не успел');
    editor.setTool('pen');

    editor.setReadOnly(true);
    expect(editor.getState()).toMatchObject({ readOnly: true, editingId: null, tool: 'select' });
    expect(editor.doc.get(rect.id)).toMatchObject({ text: '' });

    editor.setReadOnly(false);
    editor.setTool('ellipse');
    expect(editor.tool).toBe('ellipse');
  });
});
