import type { ReactNode } from 'react';
import { Link } from '../ui/Link';
import { AppHeader } from './AppHeader';
import styles from './pages.module.css';

/** Страница с одним сообщением вместо содержимого. */
export function MessagePage({ children }: { children: ReactNode }) {
  return (
    <div className={styles.app}>
      <AppHeader />
      <main className={styles.page}>{children}</main>
    </div>
  );
}

/** Показать нечего: страницы нет, доску удалили, доступа нет, ссылка не действует. */
export function NotFoundPage({ message = 'Такой страницы нет.' }: { message?: string }) {
  return (
    <MessagePage>
      <p>{message}</p>
      <Link to="/">К списку досок</Link>
    </MessagePage>
  );
}
