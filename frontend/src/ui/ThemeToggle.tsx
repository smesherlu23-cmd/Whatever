import { setTheme, useTheme } from './theme';
import styles from './ThemeToggle.module.css';

/** Переключатель светлой и тёмной темы. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'Тёмная тема' : 'Светлая тема';
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {theme === 'dark' ? (
          <path
            fill="currentColor"
            d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5 1 3h-2l1-3Zm0 20-1-3h2l-1 3ZM2 12l3-1v2l-3-1Zm20 0-3 1v-2l3 1ZM4.9 4.9l2.8 1.4-1.4 1.4-1.4-2.8Zm14.2 14.2-2.8-1.4 1.4-1.4 1.4 2.8Zm0-14.2-1.4 2.8-1.4-1.4 2.8-1.4ZM4.9 19.1l1.4-2.8 1.4 1.4-2.8 1.4Z"
          />
        ) : (
          <path fill="currentColor" d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        )}
      </svg>
    </button>
  );
}
