import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BoardDocument } from '../model/document';
import { intersects } from '../model/geometry';
import { shapeSpec } from '../model/shapes';
import { type ShapeElement, isArrow } from '../model/types';
import { BUILTIN_TEMPLATES, builtinContent, builtinPreview } from './builtin';

/** Доска, какой её получит сервер из содержимого шаблона. */
function boardFrom(content: string): { board: BoardDocument; stored: number } {
  const doc = new Y.Doc();
  Y.applyUpdate(
    doc,
    Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
  );
  return { board: new BoardDocument(doc), stored: doc.getMap('elements').size };
}

const isContainer = (el: ShapeElement) => el.kind !== 'path' && shapeSpec(el.kind).container;

describe.each(BUILTIN_TEMPLATES)('built-in template $name', (template) => {
  const { board, stored } = boardFrom(builtinContent(template));
  const pages = new Set(board.pages().map((page) => page.id));

  it('is a valid board of reasonable size', () => {
    expect(board.size).toBeGreaterThan(0);
    // Ни один элемент не отброшен проверкой данных: шаблон проходит её так же, как правки.
    expect(board.size).toBe(stored);
    expect(board.list().every((el) => pages.has(el.page))).toBe(true);
    expect(atob(builtinContent(template)).length).toBeLessThan(64 * 1024);
  });

  it('binds every arrow to shapes on its page', () => {
    for (const arrow of board.list().filter(isArrow)) {
      for (const end of [arrow.start, arrow.end]) {
        const shape = end.shapeId ? board.get(end.shapeId) : undefined;
        expect(shape?.page).toBe(arrow.page);
      }
    }
  });

  it('does not put shapes on top of each other, except into containers', () => {
    const shapes = board.list().filter((el): el is ShapeElement => !isArrow(el));
    for (const a of shapes) {
      for (const b of shapes) {
        if (a === b || a.page !== b.page || isContainer(a) || isContainer(b)) continue;
        expect(intersects(a, b), `${a.text} и ${b.text}`).toBe(false);
      }
    }
  });
});

describe('built-in templates', () => {
  it('have unique ids and names', () => {
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(BUILTIN_TEMPLATES.length);
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.name)).size).toBe(BUILTIN_TEMPLATES.length);
  });

  it('show their first page in the preview and are built once', () => {
    const c4 = BUILTIN_TEMPLATES.find((t) => t.id === 'c4');
    if (!c4) throw new Error('Нет шаблона C4');
    const preview = builtinPreview(c4);
    expect(preview).toBe(builtinPreview(c4));
    const { board } = boardFrom(builtinContent(c4));
    expect(board.pages().map((page) => page.name)).toEqual(['Контекст', 'Контейнеры']);
    expect(preview.list().map((el) => el.id)).toEqual(
      board.list().flatMap((el) => (el.page === board.pages()[0]?.id ? [el.id] : [])),
    );
  });
});
