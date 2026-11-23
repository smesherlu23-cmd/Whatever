import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardDocument } from '../model/document';
import { DEFAULT_FILL, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { contentPreview, encodeBoard } from './content';

function note(id: string, page: string, text = ''): ShapeElement {
  return {
    id,
    kind: 'note',
    page,
    x: 0,
    y: 0,
    w: 160,
    h: 100,
    text,
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  };
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

describe('board content', () => {
  it('encodes the whole document, however large, as base64', () => {
    const board = new BoardDocument();
    // Больше одного куска, который кодируется за раз.
    board.add(note('long', 'main', 'текст '.repeat(20_000)));
    const content = encodeBoard(board);
    expect(content).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, bytes(content));
    expect(new BoardDocument(copy).list()).toEqual(board.list());
  });

  it('previews the first page of the content', () => {
    const board = new BoardDocument();
    board.add(note('first', 'main'));
    const second = board.addPage('Вторая');
    board.add(note('other', second));
    board.movePage(second, 'main');

    const preview = contentPreview(Y.encodeStateAsUpdate(board.doc));
    expect(preview?.list().map((el) => el.id)).toEqual(['other']);
  });

  it('has no preview for broken content', () => {
    expect(contentPreview(new Uint8Array([5, 1, 2, 3]))).toBeNull();
  });
});
