import { test } from 'vitest';
import { BoardDocument } from './document';
import type { ShapeElement } from './types';

/*
 * Сколько стоит снимок документа на большой доске: npm run bench. Перетаскивание фигуры —
 * одна правка за кадр, и после каждой редактор и отрисовка читают снимок заново.
 */

const ELEMENTS = 5000;

function bigBoard(): BoardDocument {
  const doc = new BoardDocument();
  doc.transact(() => {
    for (let i = 0; i < ELEMENTS; i++) {
      const shape: ShapeElement = {
        id: `e${String(i)}`,
        kind: 'rectangle',
        page: i % 2 === 0 ? 'main' : 'second',
        x: (i % 100) * 120,
        y: Math.floor(i / 100) * 80,
        w: 100,
        h: 60,
        text: `Фигура ${String(i)}`,
        stroke: '#000',
        fill: '#fff',
        z: i,
      };
      doc.add(shape);
    }
  });
  return doc;
}

test(`снимок доски из ${String(ELEMENTS)} элементов`, async ({ bench }) => {
  const doc = bigBoard();
  let x = 0;
  await bench.compare(
    bench('перетаскивание: правка одной фигуры и чтение снимка', () => {
      x += 1;
      doc.update('e42', { x });
      doc.page('main').list();
    }),
    bench('смена порядка: фигура наверх и чтение снимка', () => {
      x += 1;
      doc.update('e42', { z: ELEMENTS + x });
      doc.page('main').list();
    }),
  );
});
