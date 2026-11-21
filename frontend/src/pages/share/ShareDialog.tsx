import { type SubmitEvent, useEffect, useRef, useState } from 'react';
import {
  type BoardAccess,
  type BoardInfo,
  type BoardRole,
  type Member,
  type Person,
  type ShareLink,
  api,
  errorText,
  shareUrl,
} from '../../api';
import controls from '../../ui/controls.module.css';
import styles from './ShareDialog.module.css';

export const ROLE_TEXT: Record<BoardRole, string> = {
  viewer: 'Просмотр',
  editor: 'Редактирование',
};

/** Сроки действия ссылки на выбор. 0 — без срока. */
const LINK_TERMS = [
  { days: 0, text: 'Без срока' },
  { days: 1, text: '1 день' },
  { days: 7, text: '7 дней' },
  { days: 30, text: '30 дней' },
] as const;

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' });

interface Message {
  ok: boolean;
  text: string;
}

const FAILED = 'Не удалось сохранить. Проверьте связь с сервером.';

/**
 * Окно «Поделиться»: участники доски с правом просмотра или редактирования и ссылки доступа.
 * Открывается только у тех, кто управляет доской; права всё равно проверяет сервер.
 */
export function ShareDialog({
  board,
  me,
  onClose,
}: {
  board: BoardInfo;
  me: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [access, setAccess] = useState<BoardAccess | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getAccess(board.id), api.listPeople()]).then(
      ([loaded, colleagues]) => {
        if (cancelled) return;
        setAccess(loaded);
        setPeople(colleagues);
      },
      (error: unknown) => {
        if (!cancelled) {
          setMessage({ ok: false, text: errorText(error, 'Не удалось загрузить доступ.') });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  /** Выполняет изменение и показывает его итог. */
  const run = async (change: () => Promise<string | null>) => {
    try {
      const done = await change();
      setMessage(done ? { ok: true, text: done } : null);
    } catch (error) {
      setMessage({ ok: false, text: errorText(error, FAILED) });
    }
  };

  const setMember = (person: Person, role: BoardRole) =>
    run(async () => {
      const member = await api.setMember(board.id, person.id, role);
      setAccess((current) => current && { ...current, members: withMember(current, member) });
      return null;
    });

  const removeMember = (member: Member) =>
    run(async () => {
      await api.removeMember(board.id, member.user.id);
      setAccess(
        (current) =>
          current && {
            ...current,
            members: current.members.filter((m) => m.user.id !== member.user.id),
          },
      );
      return `${member.user.name} больше не видит доску.`;
    });

  const createLink = (role: BoardRole, days: number) =>
    run(async () => {
      const link = await api.createLink(board.id, role, days || null);
      setAccess((current) => current && { ...current, links: [...current.links, link] });
      return null;
    });

  const deleteLink = (link: ShareLink) =>
    run(async () => {
      await api.deleteLink(board.id, link.token);
      setAccess(
        (current) =>
          current && { ...current, links: current.links.filter((l) => l.token !== link.token) },
      );
      return 'Ссылка удалена. Доступ, уже полученный по ней, остался.';
    });

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="share-title" onClose={onClose}>
      <header className={styles.header}>
        <h2 id="share-title">Доступ к доске «{board.name}»</h2>
        <button
          type="button"
          className={controls.ghost}
          aria-label="Закрыть"
          onClick={() => dialog.current?.close()}
        >
          ✕
        </button>
      </header>

      {message && (
        <p
          className={message.ok ? controls.success : controls.error}
          role={message.ok ? 'status' : 'alert'}
        >
          {message.text}
        </p>
      )}

      {access && (
        <>
          <section className={styles.section} aria-labelledby="share-members">
            <h3 id="share-members">Участники</h3>
            <ul className={styles.list}>
              {access.owner && (
                <li>
                  <PersonName person={access.owner} me={me} />
                  <span className={controls.muted}>владелец</span>
                </li>
              )}
              {access.members.map((member) => (
                <li key={member.user.id}>
                  <PersonName person={member.user} me={me} />
                  <RoleSelect
                    label={`Право: ${member.user.name}`}
                    value={member.role}
                    onChange={(role) => void setMember(member.user, role)}
                  />
                  <button
                    type="button"
                    className={controls.ghost}
                    aria-label={`Убрать ${member.user.name}`}
                    onClick={() => void removeMember(member)}
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
            <AddMember
              candidates={people.filter((p) => !hasAccess(access, p))}
              onAdd={(person, role) => void setMember(person, role)}
            />
          </section>

          <section className={styles.section} aria-labelledby="share-links">
            <h3 id="share-links">Ссылки доступа</h3>
            <p className={controls.muted}>
              По ссылке доступ получает любой сотрудник, когда войдёт в систему.
            </p>
            {access.links.length > 0 && (
              <ul className={styles.list}>
                {access.links.map((link) => (
                  <LinkRow
                    key={link.token}
                    link={link}
                    onCopied={(copied) => {
                      setMessage({
                        ok: true,
                        text: copied
                          ? 'Ссылка скопирована.'
                          : 'Ссылка выделена: нажмите Ctrl+C, чтобы скопировать.',
                      });
                    }}
                    onDelete={() => void deleteLink(link)}
                  />
                ))}
              </ul>
            )}
            <NewLink onCreate={(role, days) => void createLink(role, days)} />
          </section>
        </>
      )}
    </dialog>
  );
}

function withMember(access: BoardAccess, member: Member): Member[] {
  const others = access.members.filter((m) => m.user.id !== member.user.id);
  return [...others, member].sort((a, b) => a.user.name.localeCompare(b.user.name, 'ru'));
}

function hasAccess(access: BoardAccess, person: Person): boolean {
  return access.owner?.id === person.id || access.members.some((m) => m.user.id === person.id);
}

function PersonName({ person, me }: { person: Person; me: string }) {
  return (
    <span className={styles.person}>
      {person.name}
      {person.id === me && ' (вы)'}
      <span className={controls.muted}>{person.login}</span>
    </span>
  );
}

function RoleSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BoardRole;
  onChange: (role: BoardRole) => void;
}) {
  return (
    <select
      className={controls.input}
      aria-label={label}
      value={value}
      onChange={(e) => {
        onChange(e.target.value === 'editor' ? 'editor' : 'viewer');
      }}
    >
      <option value="viewer">{ROLE_TEXT.viewer}</option>
      <option value="editor">{ROLE_TEXT.editor}</option>
    </select>
  );
}

function AddMember({
  candidates,
  onAdd,
}: {
  candidates: Person[];
  onAdd: (person: Person, role: BoardRole) => void;
}) {
  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState<BoardRole>('viewer');
  const person = candidates.find((p) => p.id === personId);

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!person) return;
    onAdd(person, role);
    setPersonId('');
  };

  if (candidates.length === 0) {
    return <p className={controls.muted}>Доступ есть у всех сотрудников.</p>;
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <select
        className={controls.input}
        aria-label="Сотрудник"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
      >
        <option value="">Выберите сотрудника</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.login})
          </option>
        ))}
      </select>
      <RoleSelect label="Право нового участника" value={role} onChange={setRole} />
      <button type="submit" className={controls.primary} disabled={!person}>
        Добавить
      </button>
    </form>
  );
}

function LinkRow({
  link,
  onCopied,
  onDelete,
}: {
  link: ShareLink;
  onCopied: (copied: boolean) => void;
  onDelete: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const url = shareUrl(link.token);
  const term = link.expires_at ? `до ${dateFormat.format(new Date(link.expires_at))}` : 'без срока';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      onCopied(true);
    } catch {
      // Буфер обмена доступен только по HTTPS. По HTTP ссылку можно скопировать вручную.
      input.current?.select();
      onCopied(false);
    }
  };

  return (
    <li className={styles.link}>
      <input
        ref={input}
        className={controls.input}
        aria-label="Ссылка"
        value={url}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
      />
      <span className={controls.muted}>
        {ROLE_TEXT[link.role].toLowerCase()}, {term}
      </span>
      <button type="button" className={controls.secondary} onClick={() => void copy()}>
        Копировать
      </button>
      <button
        type="button"
        className={controls.ghost}
        aria-label={`Удалить ссылку ${url}`}
        onClick={onDelete}
      >
        Удалить
      </button>
    </li>
  );
}

function NewLink({ onCreate }: { onCreate: (role: BoardRole, days: number) => void }) {
  const [role, setRole] = useState<BoardRole>('viewer');
  const [days, setDays] = useState<number>(7);

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    onCreate(role, days);
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <RoleSelect label="Право по ссылке" value={role} onChange={setRole} />
      <select
        className={controls.input}
        aria-label="Срок действия"
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
      >
        {LINK_TERMS.map((term) => (
          <option key={term.days} value={term.days}>
            {term.text}
          </option>
        ))}
      </select>
      <button type="submit" className={controls.secondary}>
        Создать ссылку
      </button>
    </form>
  );
}
