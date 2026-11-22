import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { BoardDocument } from './document';
import type { ArrowElement, ShapeElement } from './types';

const rect = (id: string, x = 0): ShapeElement => ({
  id,
  kind: 'rectangle',
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
