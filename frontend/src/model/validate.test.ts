import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardDocument } from './document';
import { parseElement } from './validate';

const rectangle = {
  id: 'r1',
  kind: 'rectangle',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  text: '',
  stroke: '#000',
  fill: '#fff',
  z: 1,
};

describe('parseElement', () => {
  it('accepts shapes, paths and arrows', () => {
    expect(parseElement(rectangle)).toEqual(rectangle);
    expect(parseElement({ ...rectangle, kind: 'path', points: [0, 0, 1, 1] })).toMatchObject({
      points: [0, 0, 1, 1],
    });
    const arrow = {
      id: 'a1',
      kind: 'arrow',
      start: { x: 0, y: 0, shapeId: 'r1' },
      end: { x: 10, y: 10 },
      stroke: '#000',
      z: 2,
    };
    expect(parseElement(arrow)).toEqual(arrow);
  });

  it.each([
    ['unknown kind', { ...rectangle, kind: 'star' }],
    ['missing coordinate', { ...rectangle, x: undefined }],
    ['not a number', { ...rectangle, w: Number.NaN }],
    ['text is not a string', { ...rectangle, text: 42 }],
    ['broken path points', { ...rectangle, kind: 'path', points: [0, 'a'] }],
    [
      'broken arrow end',
      { id: 'a', kind: 'arrow', start: {}, end: { x: 0, y: 0 }, stroke: '', z: 1 },
    ],
    ['not an object', 'rectangle'],
  ])('rejects %s', (_, value) => {
    expect(parseElement(value)).toBeNull();
  });
});

describe('BoardDocument with data from another client', () => {
  it('skips a broken element instead of failing', () => {
    const shared = new Y.Doc();
    const doc = new BoardDocument(shared);
    doc.add({ ...rectangle, kind: 'rectangle' });
    // Чужой клиент с ошибкой записал элемент без координат.
    const broken = new Y.Map<unknown>([
      ['id', 'bad'],
      ['kind', 'ellipse'],
    ]);
    shared.getMap<Y.Map<unknown>>('elements').set('bad', broken);

    expect(doc.list().map((el) => el.id)).toEqual(['r1']);
    expect(doc.has('bad')).toBe(false);
    expect(doc.size).toBe(1);
  });
});
