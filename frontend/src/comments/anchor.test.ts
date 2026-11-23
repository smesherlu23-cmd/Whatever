import { describe, expect, it } from 'vitest';
import { BoardDocument } from '../model/document';
import { DEFAULT_FILL, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { anchorAt, pinPoint } from './anchor';

function box(id: string, x: number, y: number, w: number, h: number): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    page: 'main',
    x,
    y,
    w,
    h,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  };
}

describe('comment pins', () => {
  const doc = new BoardDocument();
  const lookup = (id: string) => doc.page('main').get(id);

  it('remembers where on the element the pin was put', () => {
    const shape = box('a', 100, 50, 200, 100);
    expect(anchorAt(shape, { x: 150, y: 125 }, lookup)).toEqual({ id: 'a', x: 0.25, y: 0.75 });
    // Щелчок рядом с краем засчитывается краем.
    expect(anchorAt(shape, { x: 310, y: 40 }, lookup)).toEqual({ id: 'a', x: 1, y: 0 });
    // У плоского элемента место по этой оси — середина.
    expect(anchorAt(box('line', 0, 10, 100, 0), { x: 50, y: 10 }, lookup)).toEqual({
      id: 'line',
      x: 0.5,
      y: 0.5,
    });
  });

  it('moves the pin with its element and leaves it in place without one', () => {
    doc.add(box('a', 100, 50, 200, 100));
    const thread = { page: 'main', x: 150, y: 125, element: { id: 'a', x: 0.25, y: 0.75 } };
    expect(pinPoint(thread, lookup)).toEqual({ x: 150, y: 125 });

    doc.update('a', { x: 300, w: 400 });
    expect(pinPoint(thread, lookup)).toEqual({ x: 400, y: 125 });

    doc.remove(['a']);
    expect(pinPoint(thread, lookup)).toEqual({ x: 150, y: 125 });
    expect(pinPoint({ ...thread, element: null, x: 7 }, lookup)).toEqual({ x: 7, y: 125 });
  });
});
