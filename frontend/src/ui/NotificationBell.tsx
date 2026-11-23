import { useId, useRef, useState } from 'react';
import type { AppNotification } from '../api';
import { useNotificationStore } from '../notifications/context';
import type { NotificationStore } from '../notifications/store';
import { boardPath } from '../router';
import controls from './controls.module.css';
import { Link } from './Link';
import styles from './NotificationBell.module.css';
import { formatWhen } from './time';
import { ToolIcon } from './ToolIcon';
import { useDismiss } from './useDismiss';
import { useSnapshot } from './useSnapshot';

/** Колокольчик в шапке: упоминания и ответы в обсуждениях. Есть, пока пользователь вошёл. */
export function NotificationBell() {
  const store = useNotificationStore();
  return store ? <Bell store={store} /> : null;
}

function title(notification: AppNotification): string {
  return notification.kind === 'mention' ? 'Вас упомянули' : 'Ответ в обсуждении';
}

function Bell({ store }: { store: NotificationStore }) {
  const { unread, items, loaded } = useSnapshot(store);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useDismiss(root, open, () => {
    setOpen(false);
  });

  const readAll = () => {
    setError(null);
    store.readAll().catch(() => {
      setError('Не удалось отметить уведомления. Проверьте связь с сервером.');
    });
  };

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={unread > 0 ? `Уведомления, новых: ${unread}` : 'Уведомления'}
        aria-expanded={open}
        aria-controls={panelId}
        title="Упоминания и ответы в обсуждениях"
        onClick={() => {
          if (!open) store.refresh();
          setOpen(!open);
          setError(null);
        }}
      >
        <ToolIcon name="bell" />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} className={styles.panel}>
          <div className={styles.panelHeader}>
            <strong>Уведомления</strong>
            {unread > 0 && (
              <button type="button" className={controls.ghost} onClick={readAll}>
                Прочитать все
              </button>
            )}
          </div>
          {error && (
            <p className={controls.error} role="alert">
              {error}
            </p>
          )}
          {items.length === 0 ? (
            <p className={styles.empty}>
              {loaded
                ? 'Здесь появятся упоминания и ответы в ваших обсуждениях.'
                : 'Загрузка уведомлений…'}
            </p>
          ) : (
            // Переход по уведомлению закрывает список: обсуждение откроется на доске.
            <ul className={styles.list} onClick={() => setOpen(false)}>
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    className={styles.item}
                    to={boardPath(n.board.id, n.thread_id)}
                    data-unread={n.read ? undefined : ''}
                  >
                    <span className={styles.title}>
                      {title(n)} · {n.board.name}
                    </span>
                    <span className={styles.excerpt}>
                      {n.actor?.name ?? 'Удалённый пользователь'}: {n.excerpt}
                    </span>
                    <time className={styles.when} dateTime={n.created_at}>
                      {formatWhen(n.created_at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
