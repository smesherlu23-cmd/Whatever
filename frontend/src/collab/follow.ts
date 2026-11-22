import { type Camera, fitCamera } from '../canvas/camera';
import type { Editor, ViewportSize } from '../editor/Editor';
import { sameBounds } from '../model/geometry';
import type { Bounds } from '../model/types';
import type { Peer, Presence } from './presence';

/** Участник, за которым следуют. */
export interface Leader {
  clientId: number;
  name: string;
  color: string;
}

/** Что следование показало последним. Всё остальное на экране выставил сам пользователь. */
interface Shown {
  /** Страница и вид участника. */
  page: string;
  view: Bounds | null;
  /** Что открыто здесь: другая страница, пока страница участника не дошла до этого браузера. */
  pageId: string;
  viewport: ViewportSize;
  camera: Camera;
}

/**
 * Следование за участником: открыта та же страница, и видно то же, что у него в окне.
 * Окна у всех разного размера, поэтому вид участника не копируется, а вписывается в окно:
 * видно всё, что видит он, и немного больше по одной из сторон.
 *
 * Следование заканчивается, как только пользователь сам двигает доску или открывает другую
 * страницу, а также когда участник уходит с доски.
 */
export class Follow {
  private current: Leader | null = null;
  private shown: Shown | null = null;
  private shownView: Bounds | null = null;
  /** Камеру и страницу сейчас меняет само следование, а не пользователь. */
  private applying = false;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly editor: Editor,
    private readonly presence: Presence,
  ) {}

  /** За кем следуют. Объект меняется, только когда меняются участник, его имя или цвет. */
  get leader(): Leader | null {
    return this.current;
  }

  /**
   * Вид участника, который сейчас показан, или null. Пока следуют, другим публикуется он,
   * а не своя видимая часть: окна разной формы, и в цепочке или кольце следующих друг
   * за другом вид иначе расширялся бы на каждом шаге.
   */
  get view(): Bounds | null {
    return this.shownView;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Начинает следовать за участником, а если за ним уже следуют — перестаёт. */
  toggle(clientId: number): void {
    if (this.current?.clientId === clientId) this.stop();
    else this.start(clientId);
  }

  start(clientId: number): void {
    const peer = this.peer(clientId);
    if (!peer) return;
    this.detach();
    this.current = leaderOf(peer);
    const offPresence = this.presence.subscribe(() => {
      this.update();
    });
    const offEditor = this.editor.subscribe(() => {
      this.check();
    });
    this.unsubscribe = () => {
      offPresence();
      offEditor();
    };
    this.show(peer.page, peer.view);
    this.emit();
  }

  stop(): void {
    if (!this.current) return;
    this.detach();
    this.emit();
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current = null;
    this.shown = null;
    this.shownView = null;
  }

  private peer(clientId: number): Peer | undefined {
    return this.presence.peers().find((peer) => peer.clientId === clientId);
  }

  /** Участник сменил страницу, вид, имя или ушёл. */
  private update(): void {
    // Своё присутствие следование меняет само, когда двигает камеру: это не новости участника.
    if (this.applying || !this.current) return;
    const peer = this.peer(this.current.clientId);
    if (!peer) {
      this.stop();
      return;
    }
    if (peer.name !== this.current.name || peer.color !== this.current.color) {
      this.current = leaderOf(peer);
      this.emit();
    }
    this.show(peer.page, peer.view);
  }

  /** Камеру или страницу сменило не следование: пользователь сам двинул доску. */
  private check(): void {
    if (this.applying || !this.shown) return;
    const { camera, pageId, viewport } = this.editor;
    if (camera !== this.shown.camera || pageId !== this.shown.pageId) this.stop();
    // Окно стало другого размера или пришла страница участника: вид показывается заново.
    else if (viewport !== this.shown.viewport || pageId !== this.shown.page) this.update();
  }

  private show(page: string, view: Bounds | null): void {
    const { viewport } = this.editor;
    const last = this.shown;
    if (
      last?.page === page &&
      last.pageId === page &&
      last.viewport === viewport &&
      sameBounds(last.view, view)
    ) {
      return;
    }
    this.applying = true;
    try {
      // Вид участника публикуется только вместе с его страницей.
      this.shownView = null;
      this.editor.setPage(page);
      // Новая страница участника могла ещё не дойти до этого браузера: тогда его вид
      // не ставится на другую страницу, а следование ждёт, пока она появится.
      if (view && this.editor.pageId === page) {
        this.shownView = view;
        this.editor.setCamera(fitCamera(view, viewport, 0));
      }
    } finally {
      this.applying = false;
    }
    const { pageId, camera } = this.editor;
    this.shown = { page, view, pageId, viewport, camera };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function leaderOf({ clientId, name, color }: Peer): Leader {
  return { clientId, name, color };
}
