import { useEffect, useId, useState } from 'react';
import { type BoardVersion, errorText, type Person } from '../../api';
import controls from '../../ui/controls.module.css';
import { SidePanel } from '../../ui/SidePanel';
import { formatMoment } from '../../ui/time';
import { useSnapshot } from '../../ui/useSnapshot';
import { MAX_VERSION_NAME, versionTitle } from '../../versions/preview';
import type { VersionStore } from '../../versions/store';
import type { VersionViewer } from '../../versions/viewer';
import styles from './VersionsPanel.module.css';

/** Столько людей перечисляется по имени, остальные — числом. */
const MAX_PEOPLE = 3;

const SAVE_FAILED = 'Не удалось сохранить. Проверьте связь с сервером.';

/**
 * Панель истории версий: сохранить то, что сейчас на доске, найти версию по времени или
 * названию и открыть её. Открытая версия видна вместо доски, а восстанавливают её с плашки
 * над холстом (VersionBanner).
 */
export function VersionsPanel({
  store,
  viewer,
  manages,
  onClose,
}: {
  store: VersionStore;
  viewer: VersionViewer;
  /** Управляет доской: может удалять версии. */
  manages: boolean;
  onClose: () => void;
}) {
  const { versions, status } = useSnapshot(store);
  const { preview, opening, message } = useSnapshot(viewer);
  const [namedOnly, setNamedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => store.watch(), [store]);

  const shown = namedOnly ? versions.filter((v) => v.name !== null) : versions;
  const selectedId = preview?.version.id ?? null;

  let empty = null;
  if (status === 'loading') empty = <p className={styles.empty}>Загрузка версий…</p>;
  else if (status === 'failed') {
    empty = (
      <p className={styles.empty} role="alert">
        Не удалось загрузить версии. Проверьте связь с сервером.
      </p>
    );
  } else if (shown.length === 0) {
    empty = (
      <p className={styles.empty}>
        {namedOnly
          ? 'Названных версий пока нет.'
          : 'Версий пока нет. Они появятся сами, когда доску начнут менять.'}
      </p>
    );
  }

  return (
    <SidePanel title="История версий" closeLabel="Закрыть историю версий" onClose={onClose}>
      <div className={styles.section}>
        {saving ? (
          <NameForm
            label="Название версии"
            submitLabel="Сохранить"
            onSubmit={async (name) => {
              await store.save(name);
              setSaving(false);
            }}
            onCancel={() => {
              setSaving(false);
            }}
          />
        ) : (
          <button
            type="button"
            className={`${controls.secondary} ${styles.save}`}
            title="Сохранить то, что сейчас на доске, под названием"
            onClick={() => {
              setSaving(true);
            }}
          >
            Сохранить текущую версию
          </button>
        )}
        {message && (
          <p className={styles.message} role={message.error ? 'alert' : 'status'}>
            <span>{message.text}</span>
            <button
              type="button"
              className={controls.ghost}
              aria-label="Закрыть сообщение"
              onClick={() => viewer.dismissMessage()}
            >
              ✕
            </button>
          </p>
        )}
        <label className={styles.namedOnly}>
          <input
            type="checkbox"
            checked={namedOnly}
            onChange={(e) => {
              setNamedOnly(e.target.checked);
            }}
          />
          Только названные
        </label>
        <ol className={styles.versions} aria-label="Версии доски">
          <li className={styles.item}>
            <button
              type="button"
              className={styles.version}
              aria-current={selectedId === null ? 'true' : undefined}
              onClick={() => viewer.showCurrent()}
            >
              <span className={styles.title}>Текущая версия</span>
              <span className={styles.meta}>Как сейчас на доске</span>
            </button>
          </li>
          {shown.map((version) => (
            <VersionItem
              key={version.id}
              version={version}
              selected={version.id === selectedId}
              opening={version.id === opening}
              manages={manages}
              store={store}
              viewer={viewer}
            />
          ))}
        </ol>
        {empty}
        <p className={styles.hint}>
          Версии сохраняются сами, пока доску меняют. Безымянные со временем удаляются, а названные
          хранятся, пока их не удалят.
        </p>
      </div>
    </SidePanel>
  );
}

function VersionItem({
  version,
  selected,
  opening,
  manages,
  store,
  viewer,
}: {
  version: BoardVersion;
  selected: boolean;
  opening: boolean;
  manages: boolean;
  store: VersionStore;
  viewer: VersionViewer;
}) {
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = formatMoment(version.created_at);
  const details = [
    version.name !== null && when,
    version.saved_by && `сохранено: ${version.saved_by.name}`,
  ].filter(Boolean);

  const remove = () => {
    if (!window.confirm(`Удалить версию «${versionTitle(version, formatMoment)}»?`)) return;
    setBusy(true);
    setError(null);
    viewer
      .remove(version.id)
      .catch((e: unknown) => {
        setError(errorText(e, 'Не удалось удалить версию. Проверьте связь с сервером.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <li className={styles.item}>
      <button
        type="button"
        className={styles.version}
        aria-current={selected ? 'true' : undefined}
        aria-busy={opening}
        onClick={() => viewer.show(version)}
      >
        <span className={version.name === null ? styles.title : styles.name}>
          {version.name ?? when}
        </span>
        {details.length > 0 && <span className={styles.meta}>{details.join(' · ')}</span>}
        {version.editors.length > 0 && (
          <span className={styles.meta}>Правки: {peopleText(version.editors)}</span>
        )}
        {opening && <span className={styles.meta}>Открывается…</span>}
      </button>
      {selected && naming && (
        <NameForm
          label={version.name === null ? 'Название версии' : 'Новое название'}
          initial={version.name ?? ''}
          submitLabel="Сохранить"
          onSubmit={async (name) => {
            await store.rename(version.id, name);
            setNaming(false);
          }}
          onCancel={() => {
            setNaming(false);
          }}
        />
      )}
      {selected && !naming && (
        <div className={styles.actions}>
          <button
            type="button"
            className={controls.ghost}
            disabled={busy}
            title={
              version.name === null ? 'Названная версия хранится, пока её не удалят' : undefined
            }
            onClick={() => {
              setNaming(true);
            }}
          >
            {version.name === null ? 'Назвать версию' : 'Переименовать'}
          </button>
          {manages && (
            <button type="button" className={controls.ghost} disabled={busy} onClick={remove}>
              Удалить
            </button>
          )}
        </div>
      )}
      {error && (
        <p className={`${controls.error} ${styles.itemError}`} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** «Анна Смирнова, Иван Петров и ещё 2». */
function peopleText(people: readonly Person[]): string {
  const names = people.slice(0, MAX_PEOPLE).map((person) => person.name);
  const rest = people.length - names.length;
  return rest > 0 ? `${names.join(', ')} и ещё ${rest}` : names.join(', ');
}

function NameForm({
  label,
  initial = '',
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const trimmed = name.trim();

  return (
    <form
      className={styles.nameForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || busy) return;
        setBusy(true);
        setError(null);
        onSubmit(trimmed)
          .catch((failure: unknown) => {
            setError(errorText(failure, SAVE_FAILED));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <label className={controls.field} htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className={controls.input}
        value={name}
        maxLength={MAX_VERSION_NAME}
        placeholder="Например, «Перед релизом»"
        autoFocus
        onChange={(e) => {
          setName(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className={styles.formActions}>
        <button type="button" className={controls.ghost} onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className={controls.primary} disabled={busy || !trimmed}>
          {submitLabel}
        </button>
      </div>
      {error && (
        <p className={controls.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
