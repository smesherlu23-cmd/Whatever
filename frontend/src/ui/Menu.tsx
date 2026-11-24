import styles from './Menu.module.css';

/** Пункт всплывающего меню. shortcut — клавиши, которыми то же действие делается без меню. */
export function MenuItem({
  children,
  shortcut,
  onClick,
  disabled = false,
  danger = false,
}: {
  children: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      data-danger={danger || undefined}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      onClick={onClick}
    >
      {children}
      {shortcut && (
        <span className={styles.shortcut} aria-hidden="true">
          {shortcut}
        </span>
      )}
    </button>
  );
}

/** Черта между группами пунктов меню. */
export function MenuSeparator() {
  return <hr className={styles.separator} />;
}

/** Стрелки вверх и вниз переводят фокус между доступными пунктами меню, по кругу. */
export function moveMenuFocus(menu: HTMLElement, key: string): boolean {
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return false;
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
    (item) => !item.disabled,
  );
  const at = items.findIndex((item) => item === document.activeElement);
  const step = key === 'ArrowDown' ? 1 : -1;
  const next = at === -1 ? (step === 1 ? 0 : items.length - 1) : at + step;
  items.at(next % items.length)?.focus();
  return true;
}
