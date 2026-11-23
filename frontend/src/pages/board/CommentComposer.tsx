import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { errorText, type Person } from '../../api';
import {
  type MentionQuery,
  insertMention,
  mentionQuery,
  suggestPeople,
} from '../../comments/mentions';
import controls from '../../ui/controls.module.css';
import styles from './CommentsPanel.module.css';

/** Больше подсказок в списке не нужно: имя уточняют, продолжая набирать. */
const MAX_SUGGESTIONS = 6;
/** Столько же принимает сервер. */
const MAX_LENGTH = 5000;

/**
 * Поле комментария. «@» открывает список коллег, которых можно упомянуть: стрелки выбирают,
 * Enter или Tab вставляют, Esc закрывает. Enter отправляет комментарий, Shift+Enter — новая
 * строка. Если отправить не удалось, текст остаётся в поле.
 */
export function CommentComposer({
  label,
  placeholder,
  submitLabel,
  initialText = '',
  autoFocus = false,
  people,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  initialText?: string;
  autoFocus?: boolean;
  /** Кого можно упомянуть. Запрашивается, когда впервые набрали «@». */
  people: () => Promise<Person[]>;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<MentionQuery | null>(null);
  const [known, setKnown] = useState<Person[] | null>(null);
  const [active, setActive] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Куда поставить каретку после вставки упоминания, когда поле перерисуется. */
  const caretAfter = useRef<number | null>(null);
  const listId = useId();

  const suggestions = typing && known ? suggestPeople(known, typing.query, MAX_SUGGESTIONS) : [];
  const open = suggestions.length > 0;
  const current = suggestions[Math.min(active, suggestions.length - 1)];

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const caret = caretAfter.current;
    if (caret === null) return;
    caretAfter.current = null;
    field.current?.setSelectionRange(caret, caret);
  }, [text]);

  const follow = (value: string, caret: number) => {
    const next = mentionQuery(value, caret);
    setTyping(next);
    setActive(0);
    if (next && known === null) {
      people().then(setKnown, () => {
        setKnown([]);
      });
    }
  };

  const pick = (person: Person) => {
    const el = field.current;
    if (!el || !typing) return;
    const next = insertMention(text, el.selectionStart, typing, person);
    caretAfter.current = next.caret;
    setText(next.text);
    setTyping(null);
    el.focus();
  };

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
      setText('');
      setTyping(null);
    } catch (failure) {
      setError(errorText(failure, 'Не удалось отправить. Проверьте связь с сервером.'));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && current) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : suggestions.length - 1;
        setActive((suggestions.indexOf(current) + step) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(current);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTyping(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const optionId = (person: Person) => `${listId}-${person.id}`;

  return (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={styles.field}>
        <textarea
          ref={field}
          className={controls.input}
          aria-label={label}
          placeholder={`${placeholder}. @ — упомянуть коллегу`}
          title="Enter — отправить, Shift+Enter — новая строка, @ — упомянуть коллегу"
          rows={3}
          maxLength={MAX_LENGTH}
          value={text}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && current ? optionId(current) : undefined}
          onChange={(e) => {
            setText(e.target.value);
            follow(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setTyping(null);
          }}
        />
        {open && (
          <ul id={listId} className={styles.suggestions} role="listbox" aria-label="Кого упомянуть">
            {suggestions.map((person) => (
              <li
                key={person.id}
                id={optionId(person)}
                role="option"
                aria-selected={person === current}
                className={styles.suggestion}
                // Нажатие не уводит фокус из поля: упоминание вставится туда, где каретка.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(person);
                }}
              >
                {person.name} <span className={styles.login}>@{person.login}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className={controls.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.composerActions}>
        {onCancel && (
          <button type="button" className={controls.ghost} onClick={onCancel}>
            Отмена
          </button>
        )}
        <button type="submit" className={controls.primary} disabled={busy || !text.trim()}>
          {busy ? 'Отправка…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
