import * as Y from 'yjs';
import type { ArrowElement, BoardElement } from './types';

type ElementMap = Y.Map<unknown>;

const LOCAL = Symbol('local-edit');

/**
 * Документ доски поверх Yjs. Каждый элемент хранится в своём Y.Map,
 * поэтому правки разных полей одного элемента от разных людей сливаются без потерь.
 */
export class BoardDocument {
  readonly doc: Y.Doc;
  private readonly elements: Y.Map<ElementMap>;
  private readonly undoManager: Y.UndoManager;

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.elements = doc.getMap<ElementMap>('elements');
    this.undoManager = new Y.UndoManager(this.elements, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 400,
    });
  }

  list(): BoardElement[] {
    const result: BoardElement[] = [];
    this.elements.forEach((map) => result.push(map.toJSON() as BoardElement));
    return result.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  }

  get(id: string): BoardElement | undefined {
    return this.elements.get(id)?.toJSON() as BoardElement | undefined;
  }

  has(id: string): boolean {
    return this.elements.has(id);
  }

  get size(): number {
    return this.elements.size;
  }

  nextZ(): number {
    let max = 0;
    this.elements.forEach((map) => {
      max = Math.max(max, (map.get('z') as number) ?? 0);
    });
    return max + 1;
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
    });
  }

  /** Удаляет элементы. Стрелки, привязанные к удалённым фигурам, остаются со свободным концом. */
  remove(ids: Iterable<string>): void {
    const removed = new Set(ids);
    this.transact(() => {
      for (const id of removed) this.elements.delete(id);
      this.elements.forEach((map, id) => {
        if (map.get('kind') !== 'arrow') return;
        const arrow = map.toJSON() as ArrowElement;
        for (const which of ['start', 'end'] as const) {
          const end = arrow[which];
          if (end.shapeId && removed.has(end.shapeId)) {
            this.elements.get(id)!.set(which, { x: end.x, y: end.y });
          }
        }
      });
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
    const handler = () => listener();
    this.elements.observeDeep(handler);
    return () => this.elements.unobserveDeep(handler);
  }

  destroy(): void {
    this.undoManager.destroy();
  }
}

let counter = 0;
export function newId(): string {
  counter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${random}${counter.toString(36)}`;
}
