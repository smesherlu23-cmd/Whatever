import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { reportSignedOut, syncUrl } from '../api';
import { storageKeys } from '../config';
import { Editor } from '../editor/Editor';
import { BoardFiles } from '../files/boardFiles';
import { BoardDocument } from '../model/document';
import { Follow } from './follow';
import { Presence } from './presence';
import { syncPresence } from './syncPresence';

export type ConnectionStatus =
  'connecting' | 'connected' | 'disconnected' | 'not-found' | 'forbidden';

/** Коды закрытия от сервера. Те, что от 4400 до 4499, окончательные: клиент не переподключается. */
const SIGNED_OUT = 4401;
const FORBIDDEN = 4403;
const BOARD_NOT_FOUND = 4404;
/** Права на доску изменились: клиент переподключится, и сервер проверит их заново. */
const ACCESS_CHANGED = 4100;

const isFinal = (status: ConnectionStatus) => status === 'not-found' || status === 'forbidden';

/**
 * Открытая доска: документ, редактор, присутствие участников и их связь с внешним миром.
 *
 * Документ и редактор живут, пока жив объект. Всё, что держит внешние ресурсы
 * (IndexedDB, WebSocket, таймеры awareness), создаётся в start() и освобождается
 * функцией, которую он возвращает, поэтому сессию можно запускать повторно.
 */
export class BoardSession {
  readonly doc = new Y.Doc();
  readonly editor: Editor;
  readonly presence: Presence;
  readonly follow: Follow;
  readonly files: BoardFiles;
  private currentStatus: ConnectionStatus = 'connecting';
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly boardId: string,
    userName: string,
  ) {
    this.editor = new Editor(new BoardDocument(this.doc));
    this.presence = new Presence(this.doc.clientID, userName);
    this.follow = new Follow(this.editor, this.presence);
    this.files = new BoardFiles(boardId);
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Подключает локальную копию (доска открывается сразу и работает без сети)
   * и синхронизацию с сервером. Возвращает функцию отключения.
   */
  start(): () => void {
    this.setStatus('connecting');
    const local = new IndexeddbPersistence(storageKeys.boardDocument(this.boardId), this.doc);
    const awareness = new Awareness(this.doc);
    const detachPresence = this.presence.attach(awareness);
    const stopEditorSync = syncPresence(this.editor, this.presence, this.follow);

    // Коды закрытия 4400–4499 y-websocket считает окончательными и больше не переподключается.
    const provider = new WebsocketProvider(syncUrl(), this.boardId, this.doc, { awareness });
    // Переподключение после смены прав — не обрыв связи, «нет связи» тут не показывается.
    let recheckingAccess = false;
    provider.on('connection-close', (event) => {
      recheckingAccess = event?.code === ACCESS_CHANGED;
    });
    provider.on('status', ({ status }) => {
      if (isFinal(this.currentStatus)) return;
      if (status === 'disconnected' && recheckingAccess) {
        this.setStatus('connecting');
        return;
      }
      // Пока клиент переподключается после обрыва, для пользователя это всё ещё «нет связи».
      if (status === 'connecting' && this.currentStatus === 'disconnected') return;
      this.setStatus(status);
    });
    provider.on('closed', ({ code }) => {
      if (code === SIGNED_OUT) {
        reportSignedOut();
        return;
      }
      if (code !== BOARD_NOT_FOUND && code !== FORBIDDEN) return;
      this.setStatus(code === FORBIDDEN ? 'forbidden' : 'not-found');
      // Доски больше нет или доступ к ней отозван: её локальная копия не должна остаться
      // в браузере.
      void local.clearData();
    });

    return () => {
      this.follow.stop();
      stopEditorSync();
      detachPresence();
      provider.destroy();
      awareness.destroy();
      void local.destroy();
    };
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.listeners) listener();
  }
}
