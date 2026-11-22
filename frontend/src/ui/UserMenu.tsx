import { useId, useRef, useState } from 'react';
import { ROLE_NAMES } from '../auth/accounts';
import { useAuth } from '../auth/context';
import { Link } from './Link';
import { useDismiss } from './useDismiss';
import styles from './UserMenu.module.css';

/** Кнопка с именем пользователя и раскрывающимся списком: учётная запись, пользователи, выход. */
export function UserMenu() {
  const { user, logOut } = useAuth();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDismiss(root, open, () => {
    setOpen(false);
  });

  const exit = () => {
    setError(null);
    logOut().catch(() => {
      setError('Не удалось выйти: нет связи с сервером.');
    });
  };

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen(!open);
          setError(null);
        }}
      >
        <span className={styles.avatar} aria-hidden="true">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.name}>{user.name}</span>
      </button>
      {open && (
        // Щелчок по любому пункту закрывает список; переход по ссылке уже произошёл.
        <div id={panelId} className={styles.panel} onClick={() => setOpen(false)}>
          <div className={styles.who}>
            <strong>{user.name}</strong>
            <span>
              {user.login} · {ROLE_NAMES[user.role]}
            </span>
          </div>
          <nav aria-label="Меню пользователя">
            <Link className={styles.item} to="/account">
              Учётная запись
            </Link>
            {user.role === 'admin' && (
              <Link className={styles.item} to="/admin">
                Пользователи
              </Link>
            )}
            <button type="button" className={styles.item} onClick={exit}>
              Выйти
            </button>
          </nav>
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
