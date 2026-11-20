import * as Y from 'yjs';
import type { ArrowEnd, BoardElement } from './types';
import { isArrow } from './types';
import { parseElement } from './validate';

type ElementMap = Y.Map<unknown>;

/** Происхождение локальных правок: только их отменяет Ctrl+Z, чужие правки не трогаются. */
const LOCAL = Symbol('local-edit');

/** Правки, сделанные быстрее этого интервала, объединяются в один шаг отмены. */
const UNDO_CAPTURE_MS = 400;

interface Snapshot {
  /** Элементы в порядке отрисовки (снизу вверх). */
  readonly list: readonly BoardElement[];
  readonly byId: ReadonlyMap<string, BoardElement>;
}

function byZ(a: BoardElement, b: BoardElement): number {
  return a.z - b.z || (a.id < b.id ? -1 : 1);
}

/**
 * Документ доски поверх Yjs. Каждый элемент хранится в своём Y.Map,
 * поэтому правки разных полей одного элемента от разных людей сливаются без потерь.
 *
 * Чтение идёт из неизменяемого снимка, который пересобирается только после изменений:
 * поиск под курсором и отрисовка на каждом кадре не копируют данные Yjs заново.
 */
export class BoardDocument {
  readonly doc: Y.Doc;
  private readonly elements: Y.Map<ElementMap>;
  private readonly undoManager: Y.UndoManager;
  private snapshotCache: Snapshot | null = null;

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.elements = doc.getMap<ElementMap>('elements');
    // Регистрируется первым, чтобы остальные подписчики уже видели свежий снимок.
    this.elements.observeDeep(() => {
      this.snapshotCache = null;
    });
    this.undoManager = new Y.UndoManager(this.elements, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: UNDO_CAPTURE_MS,
    });
  }

  private snapshot(): Snapshot {
    if (!this.snapshotCache) {
      const byId = new Map<string, BoardElement>();
      this.elements.forEach((map) => {
        // Элемент мог прийти от другого клиента: битые данные пропускаем, а не рисуем.
        const element = parseElement(map.toJSON());
        if (element) byId.set(element.id, Object.freeze(element));
      });
      this.snapshotCache = { list: [...byId.values()].sort(byZ), byId };
    }
    return this.snapshotCache;
  }

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

  nextZ(): number {
    return (this.list().at(-1)?.z ?? 0) + 1;
  }

  /** Выполняет несколько правок как одно изменение (одна рассылка, один шаг отмены). */
  transact(fn: () => void): void {
    this.doc.transact(fn, LOCAL);
  }

  add(element: BoardElement): void {
    this.transact(() => {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(element)) map.set(key, value);
      this.elements.set(element.id, map);
      this.snapshotCache = null;
    });
  }

  update(id: string, patch: Partial<BoardElement>): void {
    const map = this.elements.get(id);
    if (!map) return;
    this.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'id' || key === 'kind') continue;
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
            this.elements.get(arrow.id)?.set(which, { x: end.x, y: end.y });
          }
        }
      }
      this.snapshotCache = null;
    });
  }

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

  onChange(listener: () => void): () => void {
    const handler = () => {
      listener();
    };
    this.elements.observeDeep(handler);
    return () => {
      this.elements.unobserveDeep(handler);
    };
  }
}

let counter = 0;

/** Короткий уникальный id: случайная часть плюс счётчик на случай одинаковых случайных значений. */
export function newId(): string {
  counter += 1;
  return `${crypto.randomUUID().slice(0, 8)}${counter.toString(36)}`;
}
