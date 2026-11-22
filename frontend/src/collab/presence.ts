import type { Awareness } from 'y-protocols/awareness';
import { DEFAULT_PAGE, type Point } from '../model/types';
import { isPoint, isRecord, isStringArray } from '../model/validate';
import { colorFor } from './colors';

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  /** Страница, которую участник сейчас смотрит. Курсор и выделение относятся к ней. */
  page: string;
  cursor: Point | null;
  selection: readonly string[];
}

/** То, что участник публикует о себе через awareness. */
interface PresenceState {
  user?: { name: string; color: string };
  page?: string;
  cursor?: Point | null;
  selection?: readonly string[];
}

/** Участник из состояния awareness или null, если состояние неполное или битое. */
function parsePeer(clientId: number, state: Record<string, unknown>): Peer | null {
  const { user, page, cursor, selection } = state;
  if (!isRecord(user)) return null;
  const { name, color } = user;
  if (typeof name !== 'string' || typeof color !== 'string') return null;
  return {
    clientId,
    name,
    color,
    page: typeof page === 'string' ? page : DEFAULT_PAGE,
    cursor: isPoint(cursor) ? cursor : null,
    selection: isStringArray(selection) ? selection : [],
  };
}

/** Не чаще 20 обновлений курсора в секунду на участника. */
const CURSOR_INTERVAL_MS = 50;

/**
 * Присутствие участников: имя, цвет, курсор и выделение. Данные не попадают в документ
 * и исчезают, когда участник уходит.
 *
 * Своё состояние хранится здесь, а не только в awareness: соединение с сервером может
 * пересоздаваться (переподключение, повторный запуск эффекта в React), и после attach
 * участник сразу появляется у остальных с прежними именем и выделением.
 */
export class Presence {
  private awareness: Awareness | null = null;
  private local: PresenceState;
  private readonly listeners = new Set<() => void>();
  private lastCursorSent = 0;
  private pendingCursor: Point | null | undefined;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly clientId: number,
    name: string,
  ) {
    this.local = {
      user: { name, color: colorFor(clientId) },
      page: DEFAULT_PAGE,
      cursor: null,
      selection: [],
    };
  }

  /** Публикует состояние через awareness соединения. Возвращает функцию отключения. */
  attach(awareness: Awareness): () => void {
    this.awareness = awareness;
    awareness.setLocalState(this.local);
    const notify = () => {
      this.notify();
    };
    awareness.on('change', notify);
    this.notify();
    return () => {
      awareness.off('change', notify);
      this.cancelCursorTimer();
      this.awareness = null;
      this.notify();
    };
  }

  setUser(name: string): void {
    this.publish({ user: { name, color: colorFor(this.clientId) } });
  }

  setSelection(ids: Iterable<string>): void {
    this.publish({ selection: [...ids] });
  }

  /** Другая страница: курсор с прежней страницы там ничего не значит и убирается. */
  setPage(page: string): void {
    if (page === this.local.page) return;
    this.pendingCursor = undefined;
    this.cancelCursorTimer();
    this.publish({ page, cursor: null, selection: [] });
  }

  /** Курсор отправляется не чаще CURSOR_INTERVAL_MS; последнее положение не теряется. */
  setCursor(point: Point | null): void {
    this.pendingCursor = point;
    const wait = CURSOR_INTERVAL_MS - (Date.now() - this.lastCursorSent);
    if (wait <= 0) {
      this.flushCursor();
    } else {
      this.cursorTimer ??= setTimeout(() => {
        this.flushCursor();
      }, wait);
    }
  }

  /** Другие участники, у которых есть имя, по алфавиту. */
  peers(): Peer[] {
    if (!this.awareness) return [];
    const result: Peer[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.clientId) return;
      const peer = parsePeer(clientId, state);
      if (peer) result.push(peer);
    });
    return result.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(change: PresenceState): void {
    this.local = { ...this.local, ...change };
    this.awareness?.setLocalState(this.local);
  }

  private flushCursor(): void {
    this.cancelCursorTimer();
    if (this.pendingCursor === undefined) return;
    this.publish({ cursor: this.pendingCursor });
    this.pendingCursor = undefined;
    this.lastCursorSent = Date.now();
  }

  private cancelCursorTimer(): void {
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = null;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
