import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { Follow } from '../../collab/follow';
import type { Participant, Presence } from '../../collab/presence';
import type { Editor } from '../../editor/Editor';
import { useDismiss } from '../../ui/useDismiss';
import styles from './Participants.module.css';
import { useLeader } from './useFollow';
import { usePages } from './usePages';

/** Больше значков в шапке не помещается: остальные участники — в списке «+N». */
const MAX_AVATARS = 5;

const sameParticipant = (a: Participant, b: Participant | undefined) =>
  a.clientId === b?.clientId && a.name === b.name && a.color === b.color && a.page === b.page;

function participantsOf(presence: Presence): readonly Participant[] {
  return presence
    .peers()
    .map(({ clientId, name, color, page }) => ({ clientId, name, color, page }));
}

/**
 * Участники доски. Компонент перерисовывается, когда кто-то приходит, уходит или открывает
 * другую страницу, а не на каждое движение чужого курсора.
 */
function useParticipants(presence: Presence): readonly Participant[] {
  const [list, setList] = useState(() => participantsOf(presence));
  useEffect(
    () =>
      presence.subscribe(() => {
        const next = participantsOf(presence);
        setList((prev) =>
          prev.length === next.length && prev.every((p, i) => sameParticipant(p, next[i]))
            ? prev
            : next,
        );
      }),
    [presence],
  );
  return list;
}

function useOpenPage(editor: Editor): string {
  const subscribe = useCallback((onChange: () => void) => editor.subscribe(onChange), [editor]);
  return useSyncExternalStore(subscribe, () => editor.pageId);
}

/**
 * Участники в шапке доски: значки с первой буквой имени цветом курсора. Щелчок по участнику
 * открывает его страницу и показывает то же, что видит он, пока пользователь сам не двинет
 * доску. Повторный щелчок перестаёт следовать.
 */
export function Participants({
  editor,
  presence,
  follow,
}: {
  editor: Editor;
  presence: Presence;
  follow: Follow;
}) {
  const participants = useParticipants(presence);
  const pages = usePages(editor.doc);
  const openPage = useOpenPage(editor);
  const leader = useLeader(follow);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useDismiss(root, open, () => {
    setOpen(false);
  });

  if (participants.length === 0) return null;
  const shown =
    participants.length > MAX_AVATARS ? participants.slice(0, MAX_AVATARS - 1) : participants;
  const hidden = participants.length - shown.length;

  /** Страница участника, если она не та, что открыта здесь: его курсор отсюда не виден. */
  const elsewhere = (p: Participant) =>
    p.page === openPage ? undefined : pages.find(({ id }) => id === p.page)?.name;
  const place = (p: Participant) => {
    const page = elsewhere(p);
    return page === undefined ? '' : ` · страница «${page}»`;
  };
  const hint = (p: Participant) => {
    const action =
      p.clientId === leader?.clientId ? 'перестать следовать' : 'следовать за участником';
    return `${p.name}${place(p)}. Щелчок — ${action}`;
  };

  return (
    <div className={styles.root} ref={root}>
      <ul className={styles.avatars} aria-label="Участники">
        {shown.map((p) => (
          <li key={p.clientId}>
            <button
              type="button"
              className={styles.avatar}
              style={{ background: p.color }}
              data-away={p.page !== openPage || undefined}
              aria-pressed={p.clientId === leader?.clientId}
              aria-label={`Следовать за участником: ${p.name}${place(p)}`}
              title={hint(p)}
              onClick={() => follow.toggle(p.clientId)}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              className={styles.more}
              aria-expanded={open}
              aria-controls={listId}
              aria-label={`Все участники, ещё ${hidden}`}
              onClick={() => setOpen(!open)}
            >
              +{hidden}
            </button>
          </li>
        )}
      </ul>
      {open && hidden > 0 && (
        <ul id={listId} className={styles.list} aria-label="Все участники">
          {participants.map((p) => {
            const page = elsewhere(p);
            return (
              <li key={p.clientId}>
                <button
                  type="button"
                  className={styles.item}
                  aria-pressed={p.clientId === leader?.clientId}
                  title={hint(p)}
                  onClick={() => {
                    follow.toggle(p.clientId);
                    setOpen(false);
                  }}
                >
                  <span className={styles.dot} style={{ background: p.color }} aria-hidden="true" />
                  <span className={styles.name}>{p.name}</span>
                  {page !== undefined && <span className={styles.place}>страница «{page}»</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
