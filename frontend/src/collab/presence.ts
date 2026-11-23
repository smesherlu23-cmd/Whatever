import type { Awareness } from 'y-protocols/awareness';
import { sameBounds } from '../model/geometry';
import { type Bounds, DEFAULT_PAGE, type Point } from '../model/types';
import { isBounds, isPoint, isRecord, isStringArray } from '../model/validate';
import { colorFor } from './colors';

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  /** Страница, которую участник сейчас смотрит. Курсор и выделение относятся к ней. */
  page: string;
  cursor: Point | null;
  /** Часть страницы, которая видна у участника в окне; null, пока он её не сообщил. */
  view: Bounds | null;
  selection: readonly string[];
}

/** Участник без курсора, вида и выделения: то, что показывает список в шапке. */
export type Participant = Pick<Peer, 'clientId' | 'name' | 'color' | 'page'>;

/** То, что участник публикует о себе через awareness. */
interface PresenceState {
  user?: { name: string; color: string };
  page?: string;
  cursor?: Point | null;
  view?: Bounds | null;
  selection?: readonly string[];
}

/** То, что меняется непрерывно, пока участник водит мышью или двигает доску. */
type LiveState = Pick<PresenceState, 'cursor' | 'view'>;

/** Участник из состояния awareness или null, если состояние неполное или битое. */
function parsePeer(clientId: number, state: Record<string, unknown>): Peer | null {
  const { user, page, cursor, view, selection } = state;
  if (!isRecord(user)) return null;
  const { name, color } = user;
  if (typeof name !== 'string' || typeof color !== 'string') return null;
  return {
    clientId,
    name,
    color,
    page: typeof page === 'string' ? page : DEFAULT_PAGE,
    cursor: isPoint(cursor) ? cursor : null,
    view: isBounds(view) ? { x: view.x, y: view.y, w: view.w, h: view.h } : null,
    selection: isStringArray(selection) ? selection : [],
  };
}

/** Курсор и вид уходят вместе и не чаще 20 раз в секунду на участника. */
const LIVE_INTERVAL_MS = 50;

/**
 * Присутствие участников: имя, цвет, открытая страница, курсор, видимая часть доски
 * и выделение. Данные не попадают в документ и исчезают, когда участник уходит.
 *
 * Своё состояние хранится здесь, а не только в awareness: соединение с сервером может
 * пересоздаваться (переподключение, повторный запуск эффекта в React), и после attach
 * участник сразу появляется у остальных с прежними именем и выделением.
 */
export class Presence {
  private awareness: Awareness | null = null;
  private local: PresenceState;
  private readonly listeners = new Set<() => void>();
  private lastLiveSent = 0;
  private pendingLive: LiveState | null = null;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly clientId: number,
    name: string,
  ) {
    this.local = {
      user: { name, color: colorFor(clientId) },
      page: DEFAULT_PAGE,
      cursor: null,
      view: null,
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
      this.cancelLiveTimer();
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

  /** Другая страница: курсор и вид с прежней страницы там ничего не значат и убираются. */
  setPage(page: string): void {
    if (page === this.local.page) return;
    this.pendingLive = null;
    this.cancelLiveTimer();
    this.publish({ page, cursor: null, view: null, selection: [] });
  }

  setCursor(point: Point | null): void {
    this.publishLive({ cursor: point });
  }

  /** Видимая часть доски: по ней коллеги следуют за участником. Тот же вид не отправляется. */
  setView(view: Bounds | null): void {
    const current = this.pendingLive?.view === undefined ? this.local.view : this.pendingLive.view;
    if (sameBounds(current ?? null, view)) return;
    this.publishLive({ view });
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

  /**
   * Курсор и вид отправляются одним обновлением не чаще LIVE_INTERVAL_MS, а последние
   * значения не теряются: отложенное обновление уйдёт, когда интервал закончится.
   */
  private publishLive(change: LiveState): void {
    this.pendingLive = { ...this.pendingLive, ...change };
    const wait = LIVE_INTERVAL_MS - (Date.now() - this.lastLiveSent);
    if (wait <= 0) {
      this.flushLive();
    } else {
      this.liveTimer ??= setTimeout(() => {
        this.flushLive();
      }, wait);
    }
  }

  private flushLive(): void {
    this.cancelLiveTimer();
    if (!this.pendingLive) return;
    this.publish(this.pendingLive);
    this.pendingLive = null;
    this.lastLiveSent = Date.now();
  }

  private cancelLiveTimer(): void {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = null;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
