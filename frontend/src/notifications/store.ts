import { type AppNotification, api, type Notifications } from '../api';

/** Как часто спрашивать сервер, пока вкладка на виду. Новое приходит и при возврате на неё. */
const POLL_INTERVAL_MS = 60_000;

export interface NotificationsState extends Notifications {
  /** Ответ сервера уже был: до него колокольчик не показывает «уведомлений нет». */
  loaded: boolean;
}

/**
 * Уведомления вошедшего пользователя. Сервер их не присылает, поэтому браузер спрашивает
 * сам: раз в минуту, пока вкладка на виду, и сразу, когда на неё вернулись.
 *
 * Уведомления об обсуждении, которое открыто на экране, отмечаются прочитанными сами:
 * человек и так видит, что ему ответили.
 */
export class NotificationStore {
  private state: NotificationsState = { unread: 0, items: [], loaded: false };
  private readonly listeners = new Set<() => void>();
  private watched: string | null = null;
  private loading = false;

  get snapshot(): NotificationsState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Начинает спрашивать сервер. Возвращает функцию, которая перестаёт. */
  start(): () => void {
    this.refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') this.refresh();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  refresh(): void {
    if (this.loading) return;
    this.loading = true;
    api.notifications().then(
      (notifications) => {
        this.loading = false;
        this.set({ ...notifications, loaded: true });
        this.readWatched();
      },
      () => {
        // Без связи остаются прежние уведомления: следующий опрос попробует снова.
        this.loading = false;
      },
    );
  }

  /** Обсуждение, открытое на экране, или null. Его уведомления сразу становятся прочитанными. */
  watchThread(threadId: string | null): void {
    this.watched = threadId;
    this.readWatched();
  }

  async readAll(): Promise<void> {
    await api.readAllNotifications();
    this.markRead(() => true);
  }

  private readWatched(): void {
    const threadId = this.watched;
    if (!threadId || !this.state.items.some((n) => n.thread_id === threadId && !n.read)) return;
    this.markRead((n) => n.thread_id === threadId);
    api.readThread(threadId).catch(() => {
      // Не дошло: уведомление вернётся непрочитанным при следующем опросе и прочитается снова.
    });
  }

  private markRead(matches: (notification: AppNotification) => boolean): void {
    let read = 0;
    const items = this.state.items.map((n) => {
      if (n.read || !matches(n)) return n;
      read += 1;
      return { ...n, read: true };
    });
    if (read === 0) return;
    this.set({ ...this.state, items, unread: Math.max(this.state.unread - read, 0) });
  }

  private set(state: NotificationsState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
