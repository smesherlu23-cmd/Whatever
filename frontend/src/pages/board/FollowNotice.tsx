import { useEffect, useEffectEvent } from 'react';
import type { Leader } from '../../collab/follow';
import styles from '../pages.module.css';

/** Сообщение, за кем следуют. Следование прекращают кнопкой или клавишей Esc. */
export function FollowNotice({ leader, onStop }: { leader: Leader; onStop: () => void }) {
  const stop = useEffectEvent(onStop);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <p className={styles.notice} role="status">
      <span className={styles.noticeDot} style={{ background: leader.color }} aria-hidden="true" />
      Вы видите то же, что и {leader.name}
      <button type="button" className={styles.noticeClose} title="Esc" onClick={onStop}>
        Перестать следовать
      </button>
    </p>
  );
}
