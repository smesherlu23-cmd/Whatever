import type { ReactNode } from 'react';
import { Link } from '../ui/Link';
import { NotificationBell } from '../ui/NotificationBell';
import { ThemeToggle } from '../ui/ThemeToggle';
import { UserMenu } from '../ui/UserMenu';
import styles from './pages.module.css';

/**
 * Шапка страниц: логотип, содержимое страницы, затем справа её действия, уведомления, тема
 * и меню пользователя.
 */
export function AppHeader({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={styles.header}>
      <Link className={styles.logo} to="/" title="К списку досок">
        Whatever
      </Link>
      {children}
      <span className={styles.spacer} />
      {actions}
      <NotificationBell />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
