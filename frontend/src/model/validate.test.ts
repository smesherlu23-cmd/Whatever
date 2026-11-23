import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardDocument } from './document';
import { parseElement, parsePage } from './validate';
import { fileId } from '../testing/helpers';

const rectangle = {
  id: 'r1',
  kind: 'rectangle',
  page: 'p1',
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
      page: 'p1',
      start: { x: 0, y: 0, shapeId: 'r1' },
      end: { x: 10, y: 10 },
      route: 'elbow',
      startHead: 'none',
      endHead: 'arrow',
      dashed: false,
      text: '',
      stroke: '#000',
      z: 2,
    };
    expect(parseElement(arrow)).toEqual(arrow);
    for (const kind of ['rounded', 'triangle', 'sticky']) {
      expect(parseElement({ ...rectangle, kind })).toMatchObject({ kind });
    }
  });

  it('accepts pictures and attachments only with a valid file', () => {
    const file = { id: fileId(1), name: 'схема.png', size: 2048, type: 'image/png' };
    const picture = { ...rectangle, kind: 'image', file: { ...file, extra: 'отброшено' } };
    expect(parseElement(picture)).toEqual({ ...rectangle, kind: 'image', file });
    expect(parseElement({ ...rectangle, kind: 'file', file })).toMatchObject({ file });
    expect(parseElement({ ...rectangle, kind: 'image' })).toBeNull();
    const notUuid = [
      { ...file, id: 'f1' },
      { ...file, id: '../../admin/users' },
    ];
    for (const broken of [null, 'f1', { ...file, size: -1 }, { ...file, id: 7 }, ...notUuid]) {
      expect(parseElement({ ...rectangle, kind: 'file', file: broken })).toBeNull();
    }
    // Другим фигурам файл ни к чему: поле не попадает дальше.
    expect(parseElement({ ...rectangle, file })).toEqual(rectangle);
  });

  it('puts elements drawn before pages existed on the first page', () => {
    expect(parseElement({ ...rectangle, page: undefined })).toMatchObject({ page: 'main' });
  });

  it('reads arrows without a line kind, or with an unknown one, as straight', () => {
    const arrow = {
      id: 'a1',
      kind: 'arrow',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      stroke: '#000',
      z: 2,
    };
    expect(parseElement(arrow)).toMatchObject({ route: 'straight' });
    expect(parseElement({ ...arrow, route: 'curved' })).toMatchObject({ route: 'straight' });
  });

  it('draws arrows from before heads and labels existed as they were', () => {
    const arrow = {
      id: 'a1',
      kind: 'arrow',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 },
      stroke: '#000',
      z: 2,
    };
    expect(parseElement(arrow)).toMatchObject({
      text: '',
      startHead: 'none',
      endHead: 'arrow',
      dashed: false,
    });
    expect(
      parseElement({ ...arrow, startHead: 'star', endHead: 'many', dashed: 'yes', text: 5 }),
    ).toMatchObject({ startHead: 'none', endHead: 'many', dashed: false, text: '' });
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

describe('parsePage', () => {
  it('reads a page and rejects a broken one', () => {
    expect(parsePage('p1', { name: 'Схема', order: 2 })).toEqual({
      id: 'p1',
      name: 'Схема',
      order: 2,
    });
    expect(parsePage('p1', { name: 'Схема' })).toBeNull();
    expect(parsePage('p1', { name: 7, order: 1 })).toBeNull();
    expect(parsePage('p1', null)).toBeNull();
  });
});

describe('BoardDocument with data from another client', () => {
  it('skips a broken element instead of failing', () => {
    const shared = new Y.Doc();
    const doc = new BoardDocument(shared);
    doc.add({ ...rectangle, kind: 'rectangle', page: 'main' });
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
