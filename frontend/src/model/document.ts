import * as Y from 'yjs';
import { cloneElements } from './clone';
import { newId } from './ids';
import type { ArrowEnd, BoardElement, Page } from './types';
import { DEFAULT_PAGE, isArrow } from './types';
import { parseElement, parsePage } from './validate';

type FieldMap = Y.Map<unknown>;

/**
 * Записи документа — Y.Map с полями. Другой клиент мог записать вместо неё что угодно,
 * поэтому каждая запись проверяется, прежде чем её читать или менять.
 */
function isFieldMap(value: unknown): value is FieldMap {
  return value instanceof Y.Map;
}

/** Поля записи key, если это Y.Map. */
function fieldsAt(map: Y.Map<unknown>, key: string): FieldMap | undefined {
  const value = map.get(key);
  return isFieldMap(value) ? value : undefined;
}

/** Происхождение локальных правок: только их отменяет Ctrl+Z, чужие правки не трогаются. */
const LOCAL = Symbol('local-edit');

/** Правки, сделанные быстрее этого интервала, объединяются в один шаг отмены. */
const UNDO_CAPTURE_MS = 400;

/** Название страницы с номером n, пока её не переименовали. */
export function pageName(n: number): string {
  return `Страница ${n}`;
}

export const DEFAULT_PAGE_NAME = pageName(1);

/**
 * Пока у доски одна страница, она не записана в документ: так выглядят доски, нарисованные
 * до появления страниц. В документ она попадает при первом изменении списка страниц.
 */
const IMPLICIT_PAGES: readonly Page[] = Object.freeze([
  Object.freeze({ id: DEFAULT_PAGE, name: DEFAULT_PAGE_NAME, order: 0 }),
]);

const NO_ELEMENTS: readonly BoardElement[] = Object.freeze([]);

/** Если соседние страницы стоят ближе, порядок всех страниц пересчитывается заново. */
const MIN_ORDER_GAP = 1e-6;

/** Элементы одной страницы: то, что видит и меняет редактор. */
export interface ElementSource {
  /** Элементы в порядке отрисовки (снизу вверх). */
  list(): readonly BoardElement[];
  get(id: string): BoardElement | undefined;
}

interface Snapshot {
  /** Все элементы доски в порядке отрисовки. */
  readonly list: readonly BoardElement[];
  readonly byId: ReadonlyMap<string, BoardElement>;
  readonly byPage: ReadonlyMap<string, readonly BoardElement[]>;
}

function byZ(a: BoardElement, b: BoardElement): number {
  return a.z - b.z || (a.id < b.id ? -1 : 1);
}

function byOrder(a: Page, b: Page): number {
  return a.order - b.order || (a.id < b.id ? -1 : 1);
}

function fieldMap(fields: object): FieldMap {
  return new Y.Map<unknown>(Object.entries(fields));
}

/** Страница элемента прямо из данных Yjs, даже если остальные поля элемента битые. */
function rawPage(map: FieldMap): string {
  const page = map.get('page');
  return typeof page === 'string' ? page : DEFAULT_PAGE;
}

/** Равны ли два значения из JSON: числа, строки, списки и объекты из них. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.entries(a);
  const right = new Map<string, unknown>(Object.entries(b));
  return (
    left.length === right.size &&
    left.every(([key, value]) => right.has(key) && sameValue(value, right.get(key)))
  );
}

/**
 * Делает to таким же, как from: удаляет лишние записи и поля, добавляет недостающие и меняет
 * отличающиеся. Совпадающее не трогается, поэтому правка выходит такой маленькой, как можно.
 */
function copyMaps(from: Y.Map<unknown>, to: Y.Map<unknown>): void {
  for (const key of [...to.keys()]) {
    if (!isFieldMap(from.get(key))) to.delete(key);
  }
  from.forEach((source, key) => {
    // Битые записи версии не переносим: их уже удалили из текущей доски выше.
    if (!isFieldMap(source)) return;
    const fields = Object.entries(source.toJSON());
    const target = fieldsAt(to, key);
    if (!target) {
      to.set(key, new Y.Map<unknown>(fields));
      return;
    }
    const wanted = new Map<string, unknown>(fields);
    for (const field of [...target.keys()]) {
      if (!wanted.has(field)) target.delete(field);
    }
    for (const [field, value] of wanted) {
      if (!sameValue(target.get(field), value)) target.set(field, value);
    }
  });
}

/**
 * Документ доски поверх Yjs. Каждый элемент хранится в своём Y.Map внутри общего
 * Y.Map("elements"), поэтому правки разных полей одного элемента от разных людей сливаются
 * без потерь. Страницы — отдельный Y.Map("pages"), а элемент знает id своей страницы.
 *
 * Чтение идёт из неизменяемых снимков, которые пересобираются только после изменений:
 * поиск под курсором и отрисовка на каждом кадре не копируют данные Yjs заново.
 */
export class BoardDocument {
  readonly doc: Y.Doc;
  private readonly elements: Y.Map<unknown>;
  private readonly pageMaps: Y.Map<unknown>;
  private readonly undoManager: Y.UndoManager;
  private snapshotCache: Snapshot | null = null;
  private pagesCache: readonly Page[] | null = null;
  private readonly pageViews = new Map<string, ElementSource>();

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.elements = doc.getMap<unknown>('elements');
    this.pageMaps = doc.getMap<unknown>('pages');
    // Регистрируются первыми, чтобы остальные подписчики уже видели свежие снимки.
    this.elements.observeDeep(() => {
      this.snapshotCache = null;
    });
    this.pageMaps.observeDeep(() => {
      this.pagesCache = null;
    });
    this.undoManager = new Y.UndoManager([this.elements, this.pageMaps], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: UNDO_CAPTURE_MS,
    });
  }

  private snapshot(): Snapshot {
    if (!this.snapshotCache) {
      const byId = new Map<string, BoardElement>();
      this.elements.forEach((map) => {
        // Элемент мог прийти от другого клиента: битые данные пропускаем, а не рисуем.
        if (!isFieldMap(map)) return;
        const element = parseElement(map.toJSON());
        if (element) byId.set(element.id, Object.freeze(element));
      });
      const list = [...byId.values()].sort(byZ);
      const byPage = new Map<string, BoardElement[]>();
      for (const el of list) {
        const onPage = byPage.get(el.page);
        if (onPage) onPage.push(el);
        else byPage.set(el.page, [el]);
      }
      this.snapshotCache = { list, byId, byPage };
    }
    return this.snapshotCache;
  }

  // ---------- Элементы ----------

  /** Все элементы доски, со всех страниц. */
  list(): readonly BoardElement[] {
    return this.snapshot().list;
  }

  get(id: string): BoardElement | undefined {
    return this.snapshot().byId.get(id);
  }

  has(id: string): boolean {
    return this.snapshot().byId.has(id);
  }

  get size(): number {
    return this.snapshot().list.length;
  }

  /** Элементы страницы. Объект один на страницу, а данные он всегда берёт из свежего снимка. */
  page(pageId: string): ElementSource {
    let view = this.pageViews.get(pageId);
    if (!view) {
      view = {
        list: () => this.snapshot().byPage.get(pageId) ?? NO_ELEMENTS,
        get: (id) => {
          const el = this.get(id);
          return el?.page === pageId ? el : undefined;
        },
      };
      this.pageViews.set(pageId, view);
    }
    return view;
  }

  nextZ(): number {
    return (this.list().at(-1)?.z ?? 0) + 1;
  }

  /** z ниже всех элементов: так рамки и дорожки встают под фигуры, которые в них лежат. */
  bottomZ(): number {
    return (this.list()[0]?.z ?? 1) - 1;
  }

  /** Выполняет несколько правок как одно изменение (одна рассылка, один шаг отмены). */
  transact(fn: () => void): void {
    this.doc.transact(fn, LOCAL);
  }

  add(element: BoardElement): void {
    this.transact(() => {
      this.elements.set(element.id, fieldMap(element));
      this.snapshotCache = null;
    });
  }

  update(id: string, patch: Partial<BoardElement>): void {
    const map = fieldsAt(this.elements, id);
    if (!map) return;
    this.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'id' || key === 'kind' || key === 'page') continue;
        map.set(key, value);
      }
      this.snapshotCache = null;
    });
  }

  /** Удаляет элементы. Стрелки, привязанные к удалённым фигурам, остаются со свободным концом. */
  remove(ids: Iterable<string>): void {
    const removed = new Set(ids);
    const arrows = this.list().filter(isArrow);
    this.transact(() => {
      for (const id of removed) this.elements.delete(id);
      for (const arrow of arrows) {
        if (removed.has(arrow.id)) continue;
        for (const which of ['start', 'end'] as const) {
          const end: ArrowEnd = arrow[which];
          if (end.shapeId && removed.has(end.shapeId)) {
            fieldsAt(this.elements, arrow.id)?.set(which, { x: end.x, y: end.y });
          }
        }
      }
      this.snapshotCache = null;
    });
  }

  // ---------- Страницы ----------

  /** Страницы по порядку. У доски всегда есть хотя бы одна страница. */
  pages(): readonly Page[] {
    if (!this.pagesCache) {
      const pages: Page[] = [];
      this.pageMaps.forEach((map, id) => {
        if (!isFieldMap(map)) return;
        const page = parsePage(id, map.toJSON());
        if (page) pages.push(Object.freeze(page));
      });
      this.pagesCache = pages.length > 0 ? Object.freeze(pages.sort(byOrder)) : IMPLICIT_PAGES;
    }
    return this.pagesCache;
  }

  hasPage(id: string): boolean {
    return this.pages().some((page) => page.id === id);
  }

  /**
   * Записывает в документ страницы, которые пока только подразумеваются (см. IMPLICIT_PAGES).
   * Если двое делают это одновременно, остаётся одна из одинаковых записей.
   */
  private materializePages(): void {
    for (const page of this.pages()) {
      if (isFieldMap(this.pageMaps.get(page.id))) continue;
      this.pageMaps.set(page.id, fieldMap({ name: page.name, order: page.order }));
    }
  }

  /** Добавляет страницу в конец и возвращает её id. */
  addPage(name: string): string {
    const id = newId();
    const last = this.pages().at(-1);
    this.transact(() => {
      this.materializePages();
      this.pageMaps.set(id, fieldMap({ name, order: (last?.order ?? 0) + 1 }));
    });
    return id;
  }

  renamePage(id: string, name: string): void {
    if (!this.hasPage(id)) return;
    this.transact(() => {
      this.materializePages();
      fieldsAt(this.pageMaps, id)?.set('name', name);
    });
  }

  /** Ставит страницу перед страницей before, а с before = null — в конец. */
  movePage(id: string, before: string | null): void {
    if (id === before || !this.hasPage(id)) return;
    const others = this.pages().filter((page) => page.id !== id);
    const index = before === null ? others.length : others.findIndex((p) => p.id === before);
    if (index < 0) return;
    this.transact(() => {
      this.materializePages();
      this.placePage(id, others, index);
    });
  }

  /**
   * Записывает странице такой порядок, чтобы она встала на место index среди others.
   * Порядок дробится при каждой вставке между двумя страницами: когда места между ними
   * не осталось, все страницы нумеруются заново.
   */
  private placePage(id: string, others: readonly Page[], index: number): void {
    const previous = others[index - 1]?.order;
    const next = others[index]?.order;
    let order: number;
    if (previous === undefined) order = (next ?? 1) - 1;
    else if (next === undefined) order = previous + 1;
    else if (next - previous >= MIN_ORDER_GAP) order = (previous + next) / 2;
    else {
      const ordered = others.map((page) => page.id);
      ordered.splice(index, 0, id);
      ordered.forEach((pageId, position) =>
        fieldsAt(this.pageMaps, pageId)?.set('order', position),
      );
      return;
    }
    fieldsAt(this.pageMaps, id)?.set('order', order);
  }

  /**
   * Удаляет страницу вместе с её элементами. Последнюю страницу удалить нельзя.
   * Если кто-то одновременно добавил на эту страницу фигуру, она останется в документе,
   * но не будет видна: удаление страницы важнее. Отмена удаления вернёт и её.
   */
  removePage(id: string): boolean {
    if (this.pages().length <= 1 || !this.hasPage(id)) return false;
    const elements: string[] = [];
    this.elements.forEach((map, key) => {
      if (isFieldMap(map) && rawPage(map) === id) elements.push(key);
    });
    this.transact(() => {
      this.materializePages();
      this.pageMaps.delete(id);
      for (const key of elements) this.elements.delete(key);
      this.snapshotCache = null;
    });
    return true;
  }

  /** Копия страницы сразу после неё, с копиями всех элементов. Возвращает id копии. */
  duplicatePage(id: string, name: string): string | null {
    const pages = this.pages();
    const index = pages.findIndex((page) => page.id === id);
    if (index < 0) return null;
    const copyId = newId();
    const source = this.page(id);
    const copies = cloneElements(source.list(), {
      page: copyId,
      offset: 0,
      firstZ: this.nextZ(),
      lookup: (elementId) => source.get(elementId),
    });
    this.transact(() => {
      this.materializePages();
      this.pageMaps.set(copyId, fieldMap({ name, order: 0 }));
      this.placePage(copyId, pages, index + 1);
      for (const copy of copies) this.elements.set(copy.id, fieldMap(copy));
      this.snapshotCache = null;
    });
    return copyId;
  }

  // ---------- Версии ----------

  /**
   * Делает доску такой, как в version: те же страницы и элементы с теми же полями.
   * Это одна правка: её отменяет Ctrl+Z, а участники получают её как обычное изменение.
   */
  restoreFrom(version: BoardDocument): void {
    this.stopCapturing();
    this.transact(() => {
      copyMaps(version.elements, this.elements);
      copyMaps(version.pageMaps, this.pageMaps);
      this.snapshotCache = null;
    });
    this.stopCapturing();
  }

  // ---------- Отмена и подписка ----------

  /** Закрывает текущий шаг отмены: следующая правка начнёт новый. */
  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  undo(): boolean {
    return this.undoManager.undo() !== null;
  }

  redo(): boolean {
    return this.undoManager.redo() !== null;
  }

  /** Вызывает listener после любого изменения элементов или страниц. */
  onChange(listener: () => void): () => void {
    const handler = () => {
      listener();
    };
    this.elements.observeDeep(handler);
    this.pageMaps.observeDeep(handler);
    return () => {
      this.elements.unobserveDeep(handler);
      this.pageMaps.unobserveDeep(handler);
    };
  }
}
