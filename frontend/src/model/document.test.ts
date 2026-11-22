import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { BoardDocument, DEFAULT_PAGE_NAME } from './document';
import { type ArrowElement, DEFAULT_PAGE, type ShapeElement } from './types';

const rect = (id: string, x = 0): ShapeElement => ({
  id,
  kind: 'rectangle',
  page: 'main',
  x,
  y: 0,
  w: 100,
  h: 50,
  text: '',
  stroke: '#000',
  fill: '#fff',
  z: 1,
});

describe('BoardDocument', () => {
  it('adds, updates and lists elements by z order', () => {
    const doc = new BoardDocument();
    doc.add({ ...rect('b'), z: 2 });
    doc.add({ ...rect('a'), z: 1 });
    doc.update('b', { x: 40 });
    expect(doc.list().map((el) => el.id)).toEqual(['a', 'b']);
    expect((doc.get('b') as ShapeElement).x).toBe(40);
    expect(doc.nextZ()).toBe(3);
  });

  it('frees arrow ends bound to a removed shape', () => {
    const doc = new BoardDocument();
    doc.add(rect('a'));
    const arrow: ArrowElement = {
      id: 'arr',
      kind: 'arrow',
      page: 'main',
      route: 'straight',
      start: { x: 10, y: 10, shapeId: 'a' },
      end: { x: 300, y: 10 },
      stroke: '#000',
      z: 2,
    };
    doc.add(arrow);
    doc.remove(['a']);
    expect(doc.get('a')).toBeUndefined();
    expect((doc.get('arr') as ArrowElement).start).toEqual({ x: 10, y: 10 });
  });

  it('undoes and redoes local changes step by step', () => {
    const doc = new BoardDocument();
    doc.add(rect('a'));
    doc.stopCapturing();
    doc.update('a', { x: 50 });
    doc.stopCapturing();
    doc.undo();
    expect((doc.get('a') as ShapeElement).x).toBe(0);
    doc.undo();
    expect(doc.get('a')).toBeUndefined();
    doc.redo();
    expect(doc.get('a')).toBeDefined();
  });

  it('merges concurrent edits of different fields of one shape', () => {
    const alice = new BoardDocument();
    alice.add(rect('a'));
    const bob = new BoardDocument(new Y.Doc());
    Y.applyUpdate(bob.doc, Y.encodeStateAsUpdate(alice.doc));

    alice.update('a', { x: 200 });
    bob.update('a', { text: 'Сервис' });
    Y.applyUpdate(alice.doc, Y.encodeStateAsUpdate(bob.doc));
    Y.applyUpdate(bob.doc, Y.encodeStateAsUpdate(alice.doc));

    for (const doc of [alice, bob]) {
      const shape = doc.get('a') as ShapeElement;
      expect(shape.x).toBe(200);
      expect(shape.text).toBe('Сервис');
    }
  });

  it('does not undo changes made by other people', () => {
    const alice = new BoardDocument();
    const bob = new BoardDocument();
    alice.add(rect('a'));
    Y.applyUpdate(bob.doc, Y.encodeStateAsUpdate(alice.doc));
    bob.update('a', { x: 99 });
    Y.applyUpdate(alice.doc, Y.encodeStateAsUpdate(bob.doc));
    alice.stopCapturing();
    alice.undo();
    expect(alice.get('a')).toBeUndefined();
    alice.redo();
    expect((alice.get('a') as ShapeElement).x).toBe(99);
  });
});

describe('BoardDocument pages', () => {
  it('has one implicit page until the list of pages changes', () => {
    const doc = new BoardDocument();
    expect(doc.pages()).toEqual([{ id: DEFAULT_PAGE, name: DEFAULT_PAGE_NAME, order: 0 }]);
    doc.add(rect('a'));
    expect(
      doc
        .page(DEFAULT_PAGE)
        .list()
        .map((el) => el.id),
    ).toEqual(['a']);

    const second = doc.addPage('Развёртывание');
    expect(doc.pages().map((page) => page.name)).toEqual([DEFAULT_PAGE_NAME, 'Развёртывание']);
    expect(doc.page(second).list()).toEqual([]);
    expect(doc.page(DEFAULT_PAGE).get('a')).toBeDefined();
    expect(doc.page(second).get('a')).toBeUndefined();
  });

  it('keeps the page of an element: updates cannot move it to another page', () => {
    const doc = new BoardDocument();
    const other = doc.addPage('Другая');
    doc.add(rect('a'));
    doc.update('a', { page: other, x: 5 });
    expect(doc.get('a')).toMatchObject({ page: DEFAULT_PAGE, x: 5 });
  });

  it('renames and reorders pages', () => {
    const doc = new BoardDocument();
    const b = doc.addPage('B');
    const c = doc.addPage('C');
    doc.renamePage(DEFAULT_PAGE, 'A');
    doc.movePage(c, DEFAULT_PAGE);
    expect(doc.pages().map((page) => page.name)).toEqual(['C', 'A', 'B']);
    doc.movePage(c, null);
    expect(doc.pages().map((page) => page.name)).toEqual(['A', 'B', 'C']);
    doc.movePage(b, 'missing');
    doc.renamePage('missing', 'X');
    expect(doc.pages().map((page) => page.name)).toEqual(['A', 'B', 'C']);
  });

  it('renumbers the pages when there is no room left between two of them', () => {
    const doc = new BoardDocument();
    const b = doc.addPage('B');
    const c = doc.addPage('C');
    // Каждый перенос делит промежуток между A и B пополам, пока места не останется.
    for (let i = 0; i < 40; i++) doc.movePage(i % 2 ? b : c, i % 2 ? c : b);
    const orders = doc.pages().map((page) => page.order);
    expect(new Set(orders).size).toBe(3);
    expect(doc.pages()[0]?.id).toBe(DEFAULT_PAGE);
  });

  it('removes a page with its elements in one undoable step, but never the last page', () => {
    const doc = new BoardDocument();
    expect(doc.removePage(DEFAULT_PAGE)).toBe(false);
    const second = doc.addPage('Вторая');
    doc.add({ ...rect('b'), page: second });
    doc.add(rect('a'));
    doc.stopCapturing();

    expect(doc.removePage(second)).toBe(true);
    expect(doc.pages().map((page) => page.id)).toEqual([DEFAULT_PAGE]);
    expect(doc.has('b')).toBe(false);
    expect(doc.has('a')).toBe(true);

    doc.undo();
    expect(doc.hasPage(second)).toBe(true);
    expect(doc.page(second).get('b')).toBeDefined();
  });

  it('removes the elements of a page even when another client broke them', () => {
    const doc = new BoardDocument();
    const second = doc.addPage('Вторая');
    doc.doc.getMap<Y.Map<unknown>>('elements').set('broken', new Y.Map([['page', second]]));
    doc.removePage(second);
    expect(doc.doc.getMap('elements').has('broken')).toBe(false);
  });

  it('hides elements that another client added to a page while it was being removed', () => {
    const alice = new BoardDocument();
    const second = alice.addPage('Вторая');
    const bob = new BoardDocument();
    Y.applyUpdate(bob.doc, Y.encodeStateAsUpdate(alice.doc));

    alice.removePage(second);
    bob.add({ ...rect('late'), page: second });
    Y.applyUpdate(alice.doc, Y.encodeStateAsUpdate(bob.doc));

    expect(alice.hasPage(second)).toBe(false);
    expect(alice.page(DEFAULT_PAGE).list()).toEqual([]);
  });

  it('duplicates a page right after the original, with arrows bound to the copies', () => {
    const doc = new BoardDocument();
    const last = doc.addPage('Последняя');
    doc.add(rect('a'));
    doc.add({ ...rect('b', 300), z: 2 });
    const arrow: ArrowElement = {
      id: 'arr',
      kind: 'arrow',
      page: DEFAULT_PAGE,
      route: 'straight',
      start: { x: 50, y: 25, shapeId: 'a' },
      end: { x: 350, y: 25, shapeId: 'b' },
      stroke: '#000',
      z: 3,
    };
    doc.add(arrow);

    const copy = doc.duplicatePage(DEFAULT_PAGE, 'Копия');
    expect(doc.pages().map((page) => page.id)).toEqual([DEFAULT_PAGE, copy, last]);
    const copies = doc.page(copy ?? '').list();
    expect(copies.map((el) => el.kind)).toEqual(['rectangle', 'rectangle', 'arrow']);
    const [a, b, copiedArrow] = copies;
    expect(copiedArrow).toMatchObject({ start: { shapeId: a?.id }, end: { shapeId: b?.id } });
    expect(copies.every((el) => !['a', 'b', 'arr'].includes(el.id))).toBe(true);
    expect(doc.duplicatePage('missing', 'Копия')).toBeNull();
  });

  it('notifies about changes of pages as well as of elements', () => {
    const doc = new BoardDocument();
    let calls = 0;
    const off = doc.onChange(() => {
      calls += 1;
    });
    doc.addPage('Вторая');
    doc.add(rect('a'));
    off();
    doc.addPage('Третья');
    expect(calls).toBe(2);
  });
});
