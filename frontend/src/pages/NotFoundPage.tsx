import { Link } from '../ui/Link';
import { AppHeader } from './AppHeader';
import styles from './pages.module.css';

export function NotFoundPage({ message = 'Такой страницы нет.' }: { message?: string }) {
  return (
    <div className={styles.app}>
      <AppHeader />
      <main className={styles.page}>
        <p>{message}</p>
        <Link to="/">К списку досок</Link>
      </main>
    </div>
  );
}
