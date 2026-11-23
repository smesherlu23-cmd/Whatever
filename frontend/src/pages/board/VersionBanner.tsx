import type { BoardVersion } from '../../api';
import controls from '../../ui/controls.module.css';
import { formatMoment } from '../../ui/time';
import styles from './VersionBanner.module.css';

const RESTORE_QUESTION =
  'Восстановить эту версию? Доска станет такой, как в ней, у всех участников. То, что на ' +
  'доске сейчас, сохранится в истории версий, а восстановление можно отменить, как обычную ' +
  'правку.';

/** Плашка над холстом вместо панели инструментов, пока вместо доски видна её версия. */
export function VersionBanner({
  version,
  restoring,
  canRestore,
  onRestore,
  onBack,
}: {
  version: BoardVersion;
  restoring: boolean;
  /** Доску можно сейчас менять. */
  canRestore: boolean;
  onRestore: () => void;
  onBack: () => void;
}) {
  const when = formatMoment(version.created_at);
  return (
    <section className={styles.banner} aria-label="Просмотр версии">
      <p className={styles.text}>
        <span className={styles.label}>Просмотр версии</span>
        <span className={styles.version}>
          {version.name === null ? when : `«${version.name}», ${when}`}
        </span>
      </p>
      {canRestore && (
        <button
          type="button"
          className={controls.primary}
          disabled={restoring}
          onClick={() => {
            if (window.confirm(RESTORE_QUESTION)) onRestore();
          }}
        >
          {restoring ? 'Восстановление…' : 'Восстановить'}
        </button>
      )}
      <button type="button" className={controls.secondary} disabled={restoring} onClick={onBack}>
        Вернуться к текущей
      </button>
    </section>
  );
}
