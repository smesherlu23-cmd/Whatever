import { type ReactNode, useId } from 'react';
import controls from './controls.module.css';
import styles from './SidePanel.module.css';

/** Панель справа от холста: заголовок с кнопкой «Закрыть», а под ним содержимое. */
export function SidePanel({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  /** Подпись кнопки «✕» для чтения с экрана, например «Закрыть обсуждения». */
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <aside className={styles.panel} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className={controls.ghost} aria-label={closeLabel} onClick={onClose}>
          ✕
        </button>
      </header>
      {children}
    </aside>
  );
}
