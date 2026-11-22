import { type ReactNode, useEffect, useId, useRef } from 'react';
import controls from './controls.module.css';
import styles from './Dialog.module.css';

/**
 * Модальное окно с заголовком и кнопкой закрытия. Открывается при появлении, закрывается
 * крестиком, клавишей Esc или кодом через close() — во всех случаях вызывается onClose.
 */
export function Dialog({
  title,
  onClose,
  children,
  size = 'medium',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: 'small' | 'medium' | 'large';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-size={size}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <header className={styles.header}>
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className={controls.ghost}
          aria-label="Закрыть"
          onClick={() => ref.current?.close()}
        >
          ✕
        </button>
      </header>
      {children}
    </dialog>
  );
}
