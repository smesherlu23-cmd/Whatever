import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BoardDocument } from '../model/document';
import { arrows, defined, fileId, shapes, takeTwo } from '../testing/helpers';
import {
  DEFAULT_FILL,
  DEFAULT_PAGE,
  DEFAULT_STICKY_FILL,
  DEFAULT_STROKE,
  type ShapeElement,
} from '../model/types';
import { Editor } from './Editor';

function drag(editor: Editor, from: [number, number], to: [number, number], shift = false) {
  editor.pointerDown({ x: from[0], y: from[1] }, { shift });
  editor.pointerMove({ x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2 }, { shift });
  editor.pointerMove({ x: to[0], y: to[1] }, { shift });
  editor.pointerUp();
}

function rectangle(id: string, x: number, y: number): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    page: DEFAULT_PAGE,
    x,
    y,
    w: 100,
    h: 100,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  };
}

describe('Editor', () => {
  it('applies a batch of pointer positions as one document change', () => {
    const editor = new Editor();
    editor.doc.add(rectangle('a', 0, 0));
    editor.pointerDown({ x: 50, y: 50 });
    const updates = vi.fn();
    editor.doc.doc.on('update', updates);
    editor.pointerMoves([60, 70, 80, 90, 100].map((x) => ({ x, y: 50 })));
    expect(updates).toHaveBeenCalledTimes(1);
    expect(editor.doc.get('a')).toMatchObject({ x: 50, y: 0 });
    editor.pointerUp();
  });

  it('keeps every point of a batch while drawing a stroke', () => {
    const editor = new Editor();
    editor.setSmartDrawing(false);
    editor.setTool('pen');
    editor.pointerDown({ x: 0, y: 0 });
    editor.pointerMoves([10, 20, 30].map((x) => ({ x, y: x })));
    expect(editor.stroke).toHaveLength(4);
    editor.pointerUp();
  });

  it('ignores an empty batch', () => {
    const editor = new Editor();
    const listener = vi.fn();
    editor.subscribe(listener);
    editor.pointerMoves([]);
    expect(listener).not.toHaveBeenCalled();
  });

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

  it('keeps the proportions of a picture unless Shift is held', () => {
    const editor = new Editor();
    const file = { id: fileId(1), name: 'схема.png', size: 10, type: 'image/png' };
    editor.insert([
      {
        id: 'p',
        kind: 'image',
        page: editor.pageId,
        x: 0,
        y: 0,
        w: 200,
        h: 100,
        text: '',
        stroke: DEFAULT_STROKE,
        fill: DEFAULT_FILL,
        z: 1,
        file,
      },
    ]);
    drag(editor, [200, 100], [300, 110]);
    expect(shapes(editor.doc)[0]).toMatchObject({ w: 300, h: 150 });
    drag(editor, [300, 150], [320, 300], true);
    expect(shapes(editor.doc)[0]).toMatchObject({ w: 320, h: 300 });
  });

  it('finds the file under the pointer and inserts elements as one undo step', () => {
    const editor = new Editor();
    editor.setViewport({ width: 800, height: 600 });
    expect(editor.viewportCenter()).toEqual({ x: 400, y: 300 });
    const file = { id: fileId(1), name: 'план.pdf', size: 10, type: 'application/octet-stream' };
    const card = {
      id: 'c',
      kind: 'file' as const,
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
    };
    editor.insert([card, { ...card, id: 'elsewhere', page: 'other', x: 400 }]);
    expect([...editor.selection]).toEqual(['c']);
    expect(editor.attachmentAt({ x: 100, y: 30 })).toEqual(file);
    expect(editor.attachmentAt({ x: 600, y: 400 })).toBeUndefined();
    // Двойной щелчок по вложению не открывает ввод текста: у карточки его нет.
    editor.doubleClick({ x: 100, y: 30 });
    expect(editor.editingId).toBeNull();

    editor.undo();
    expect(editor.doc.size).toBe(0);
    editor.setReadOnly(true);
    editor.insert([card]);
    expect(editor.doc.size).toBe(0);
  });

  it('zooms around the middle of the window and shows the whole page or the selection', () => {
    const editor = new Editor();
    editor.setViewport({ width: 1000, height: 800 });
    editor.zoomBy(2);
    expect(editor.camera.zoom).toBe(2);
    expect(editor.viewportCenter()).toEqual({ x: 500, y: 400 });
    editor.resetZoom();
    expect(editor.camera.zoom).toBe(1);

    editor.centerOn({ x: 0, y: 0 });
    expect(editor.viewportCenter()).toEqual({ x: 0, y: 0 });

    // На пустой странице показывать нечего, и камера не меняется.
    const before = editor.camera;
    editor.zoomToFit();
    expect(editor.zoomToSelection()).toBe(false);
    expect(editor.camera).toBe(before);

    editor.setCamera({ x: 0, y: 0, zoom: 1 });
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.setTool('rectangle');
    drag(editor, [2900, 2000], [3000, 2100]);
    editor.zoomToFit();
    expect(editor.camera.zoom).toBeCloseTo(Math.min(904 / 3000, 704 / 2100));
    expect(editor.zoomToSelection()).toBe(true);
    expect(editor.viewportCenter().x).toBeCloseTo(2950);
  });

  it('places a comment pin with one click without changing the board', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    const rect = defined(shapes(editor.doc)[0]);
    const placed = vi.fn();
    const stop = editor.onPlaceComment(placed);

    editor.setTool('comment');
    expect(editor.selection.size).toBe(0);
    editor.pointerDown({ x: 50, y: 40 });
    // Метка встаёт, когда кнопку отпускают: к этому времени браузер уже передвинул фокус,
    // и поле нового обсуждения его не потеряет.
    expect(placed).not.toHaveBeenCalled();
    editor.pointerUp();
    expect(placed).toHaveBeenCalledExactlyOnceWith({
      page: DEFAULT_PAGE,
      point: { x: 50, y: 40 },
      element: rect,
    });
    // После метки снова выбрано выделение: следующий щелчок не ставит вторую.
    expect(editor.tool).toBe('select');
    expect(editor.selection.size).toBe(0);
    expect(editor.doc.list()).toEqual([rect]);

    editor.setTool('comment');
    editor.pointerDown({ x: 400, y: 400 });
    editor.pointerUp();
    expect(placed).toHaveBeenLastCalledWith({
      page: DEFAULT_PAGE,
      point: { x: 400, y: 400 },
      element: undefined,
    });

    stop();
    editor.setTool('comment');
    editor.pointerDown({ x: 400, y: 400 });
    editor.pointerUp();
    expect(placed).toHaveBeenCalledTimes(2);
  });

  it('shows a point of a page, moving the camera only when the point is hidden', () => {
    const editor = new Editor();
    // Окно ещё не показано: страница открывается, а камера ждёт.
    editor.showPoint(DEFAULT_PAGE, { x: 5000, y: 5000 });
    expect(editor.camera).toEqual({ x: 0, y: 0, zoom: 1 });

    editor.setViewport({ width: 1000, height: 800 });
    editor.showPoint(DEFAULT_PAGE, { x: 500, y: 400 });
    expect(editor.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    // У самого края точку тоже видно плохо.
    editor.showPoint(DEFAULT_PAGE, { x: 980, y: 400 });
    expect(editor.viewportCenter()).toEqual({ x: 980, y: 400 });

    const second = editor.doc.addPage('Вторая');
    editor.showPoint(second, { x: -2000, y: 300 });
    expect(editor.pageId).toBe(second);
    expect(editor.viewportCenter()).toEqual({ x: -2000, y: 300 });

    const camera = editor.camera;
    editor.showPoint('deleted-page', { x: 0, y: 0 });
    expect(editor.pageId).toBe(second);
    expect(editor.camera).toBe(camera);
  });

  it('reveals the content of a loaded page until the camera has been placed', () => {
    const editor = new Editor();
    // Смотреть не на что или окно ещё не показано: камера ждёт.
    editor.revealContent();
    editor.doc.add(rectangle('far', 3000, 2000));
    editor.revealContent();
    expect(editor.camera).toEqual({ x: 0, y: 0, zoom: 1 });

    editor.setViewport({ width: 800, height: 600 });
    editor.revealContent();
    expect(editor.viewportCenter()).toEqual({ x: 3050, y: 2050 });
    expect(editor.camera.zoom).toBe(1);

    // Камеру уже поставили: новое содержимое её не двигает.
    editor.doc.add(rectangle('farther', 9000, 2000));
    editor.revealContent();
    expect(editor.viewportCenter()).toEqual({ x: 3050, y: 2050 });
  });

  it('does not move the camera once the user starts working with the board', () => {
    const editor = new Editor();
    editor.setViewport({ width: 800, height: 600 });
    editor.pointerDown({ x: 10, y: 10 });
    editor.pointerUp();
    editor.doc.add(rectangle('far', 3000, 2000));
    editor.revealContent();
    expect(editor.camera).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('opens a page for the first time showing all of it and returning keeps its camera', () => {
    const editor = new Editor();
    editor.setViewport({ width: 800, height: 600 });
    const page = editor.doc.addPage('Контейнеры');
    editor.doc.add({ ...rectangle('far', 3000, 2000), page });
    editor.setPage(page);
    expect(editor.viewportCenter()).toEqual({ x: 3050, y: 2050 });

    editor.setCamera({ x: 0, y: 0, zoom: 2 });
    editor.setPage(DEFAULT_PAGE);
    expect(editor.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    editor.setPage(page);
    expect(editor.camera).toEqual({ x: 0, y: 0, zoom: 2 });
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

  it('selects what is under the pointer before the context menu opens', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.setTool('rectangle');
    drag(editor, [200, 0], [300, 100]);
    const [first, second] = shapes(editor.doc).map((el) => el.id);
    editor.select([defined(first), defined(second)]);

    // Щелчок по выделенному оставляет всё выделение: меню действует на него.
    editor.contextMenu({ x: 50, y: 50 });
    expect(editor.selection).toEqual(new Set([first, second]));
    // Щелчок по другому элементу выделяет только его, по пустому месту — снимает выделение.
    editor.select([defined(first)]);
    editor.contextMenu({ x: 250, y: 50 });
    expect(editor.selection).toEqual(new Set([second]));
    editor.contextMenu({ x: 500, y: 500 });
    expect(editor.selection.size).toBe(0);

    // Начатый ввод сохраняется, а инструмент сменяется на выделение.
    editor.startEditing(defined(first));
    editor.setEditingText('Сервер');
    editor.setTool('ellipse');
    editor.contextMenu({ x: 50, y: 50 });
    expect(editor.editingId).toBeNull();
    expect(editor.tool).toBe('select');
    expect(shapes(editor.doc)[0]?.text).toBe('Сервер');
    expect(editor.selection).toEqual(new Set([first]));
  });

  it('opens typing right away on a new sticky note, which stays even when left empty', () => {
    const editor = new Editor();
    editor.setTool('sticky');
    drag(editor, [0, 0], [150, 150]);
    const sticky = defined(shapes(editor.doc)[0]);
    expect(editor.editingId).toBe(sticky.id);
    editor.stopEditing();
    expect(editor.doc.size).toBe(1);

    // Остальные фигуры чаще ставят без подписи: ввод не открывается.
    editor.setTool('rectangle');
    drag(editor, [200, 0], [300, 100]);
    expect(editor.editingId).toBeNull();
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

  it('lets a viewer start a discussion', () => {
    const { editor, rect } = viewerWithShapes();
    const placed = vi.fn();
    editor.onPlaceComment(placed);
    expect(editor.keyDown({ key: 'с', code: 'KeyC' })).toBe(true);
    expect(editor.tool).toBe('comment');
    editor.pointerDown({ x: 10, y: 10 });
    editor.pointerUp();
    expect(placed).toHaveBeenCalledWith(expect.objectContaining({ element: rect }));
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

describe('Editor.restoreVersion', () => {
  it('keeps the typed text, then restores the version as one undoable change', () => {
    const editor = new Editor();
    editor.doc.add(rectangle('a', 0, 0));
    const version = new BoardDocument();
    Y.applyUpdate(version.doc, Y.encodeStateAsUpdate(editor.doc.doc));
    editor.doc.add(rectangle('b', 300, 0));
    editor.startEditing('a');
    editor.setEditingText('Набранный текст');
    editor.select(['b']);

    expect(editor.restoreVersion(version)).toBe(true);
    expect(editor.editingId).toBeNull();
    expect(editor.doc.has('b')).toBe(false);
    expect(editor.selection.size).toBe(0);
    editor.undo();
    expect(editor.doc.has('b')).toBe(true);
    expect(editor.doc.get('a')).toMatchObject({ text: 'Набранный текст' });
  });

  it('does nothing while the board is read-only', () => {
    const editor = new Editor();
    editor.doc.add(rectangle('a', 0, 0));
    editor.setReadOnly(true);
    expect(editor.restoreVersion(new BoardDocument())).toBe(false);
    expect(editor.doc.has('a')).toBe(true);
  });
});
