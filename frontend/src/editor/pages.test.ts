import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_NAME } from '../model/document';
import { DEFAULT_PAGE } from '../model/types';
import { arrows, defined, shapes } from '../testing/helpers';
import { Editor } from './Editor';
import { addPage, duplicatePage, movePage, nextPageName, removePage, renamePage } from './pages';

function drag(editor: Editor, from: [number, number], to: [number, number]) {
  editor.pointerDown({ x: from[0], y: from[1] });
  editor.pointerMove({ x: to[0], y: to[1] });
  editor.pointerUp();
}

const names = (editor: Editor) => editor.doc.pages().map((page) => page.name);

describe('page commands', () => {
  it('names new pages with the first free number', () => {
    const page = (name: string, order: number) => ({ id: name, name, order });
    expect(nextPageName([page(DEFAULT_PAGE_NAME, 0)])).toBe('Страница 2');
    expect(nextPageName([page('Схема', 0), page('Страница 2', 1)])).toBe('Страница 3');
  });

  it('adds a page and opens it, each change being its own undo step', () => {
    const editor = new Editor();
    addPage(editor);
    expect(names(editor)).toEqual([DEFAULT_PAGE_NAME, 'Страница 2']);
    expect(editor.pageId).not.toBe(DEFAULT_PAGE);

    renamePage(editor, editor.pageId, '  Развёртывание ');
    renamePage(editor, editor.pageId, '   ');
    expect(names(editor)).toEqual([DEFAULT_PAGE_NAME, 'Развёртывание']);
    editor.undo();
    expect(names(editor)).toEqual([DEFAULT_PAGE_NAME, 'Страница 2']);
    editor.undo();
    // Страницу, которая была открыта, отменили: редактор вернулся на первую.
    expect(editor.pageId).toBe(DEFAULT_PAGE);
  });

  it('duplicates, moves and removes pages', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    duplicatePage(editor, DEFAULT_PAGE);
    expect(names(editor)).toEqual([DEFAULT_PAGE_NAME, `${DEFAULT_PAGE_NAME} (копия)`]);
    const copy = editor.pageId;
    expect(shapes(editor.doc)).toHaveLength(2);

    movePage(editor, copy, DEFAULT_PAGE);
    expect(editor.doc.pages()[0]?.id).toBe(copy);
    removePage(editor, copy);
    expect(names(editor)).toEqual([DEFAULT_PAGE_NAME]);
    expect(editor.pageId).toBe(DEFAULT_PAGE);
    duplicatePage(editor, 'missing');
    expect(names(editor)).toEqual([DEFAULT_PAGE_NAME]);
  });

  it('does not change pages for a viewer', () => {
    const editor = new Editor();
    editor.setReadOnly(true);
    addPage(editor);
    duplicatePage(editor, DEFAULT_PAGE);
    renamePage(editor, DEFAULT_PAGE, 'Схема');
    expect(names(editor)).toEqual([DEFAULT_PAGE_NAME]);
  });
});

describe('Editor on a board with several pages', () => {
  it('draws on the open page and keeps a camera for each page', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.setCamera({ x: -40, y: 0, zoom: 2 });

    addPage(editor);
    const second = editor.pageId;
    expect(editor.camera).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(editor.selection.size).toBe(0);
    editor.setTool('ellipse');
    drag(editor, [0, 0], [100, 100]);
    const ellipse = defined(shapes(editor.doc).find((el) => el.kind === 'ellipse'));
    expect(ellipse.page).toBe(second);

    // Выделение рамкой и Ctrl+A видят только открытую страницу.
    editor.select([]);
    drag(editor, [-500, -500], [500, 500]);
    expect([...editor.selection]).toEqual([ellipse.id]);
    editor.keyDown({ key: 'a', code: 'KeyA', ctrl: true });
    expect([...editor.selection]).toEqual([ellipse.id]);

    editor.setPage(DEFAULT_PAGE);
    expect(editor.camera).toEqual({ x: -40, y: 0, zoom: 2 });
    expect(editor.elementAt({ x: 20, y: 20 })?.kind).toBe('rectangle');
    editor.setPage('missing');
    expect(editor.pageId).toBe(DEFAULT_PAGE);
  });

  it('saves the typed text when switching pages', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    const rect = defined(shapes(editor.doc)[0]);
    editor.startEditing(rect.id);
    editor.setEditingText('Шлюз');
    addPage(editor);
    expect(editor.editingId).toBeNull();
    expect(editor.doc.get(rect.id)).toMatchObject({ text: 'Шлюз' });
  });

  it('moves to the first page when another participant removes the open one', () => {
    const editor = new Editor();
    addPage(editor);
    const second = editor.pageId;
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.doc.removePage(second);
    expect(editor.pageId).toBe(DEFAULT_PAGE);
    expect(editor.selection.size).toBe(0);
  });

  it('duplicates a selection on the open page and frees arrow ends whose shape is not copied', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [0, 0], [100, 100]);
    editor.setTool('rectangle');
    drag(editor, [300, 0], [400, 100]);
    editor.setTool('arrow');
    drag(editor, [50, 50], [350, 50]);
    const arrow = defined(arrows(editor.doc)[0]);
    const [left] = shapes(editor.doc);

    editor.select([defined(left).id, arrow.id]);
    editor.duplicateSelection();
    const copy = defined(arrows(editor.doc).find((el) => el.id !== arrow.id));
    const copiedShape = defined(shapes(editor.doc).find((el) => editor.selection.has(el.id)));
    expect(copy.page).toBe(DEFAULT_PAGE);
    expect(copy.start.shapeId).toBe(copiedShape.id);
    // Правая фигура не копировалась: конец копии свободен там, где был виден, со сдвигом.
    expect(copy.end).toEqual({ x: 300 + 24, y: 50 + 24 });
  });
});
