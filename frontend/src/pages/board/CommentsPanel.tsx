import { useId, useState } from 'react';
import { type Comment, type CommentThread, errorText, type Person } from '../../api';
import { splitMentions } from '../../comments/mentions';
import type { CommentsState, CommentStore } from '../../comments/store';
import { type ThreadFilter, filterThreads, isOpen } from '../../comments/threads';
import { formatWhen } from '../../ui/time';
import type { Editor } from '../../editor/Editor';
import { useEditorState } from '../../editor/useEditorState';
import { shapeSpec } from '../../model/shapes';
import { type BoardElement, type Page, isArrow } from '../../model/types';
import controls from '../../ui/controls.module.css';
import { SidePanel } from '../../ui/SidePanel';
import { CommentComposer } from './CommentComposer';
import type { DraftPin } from './CommentPins';
import styles from './CommentsPanel.module.css';
import { usePages } from './usePages';

const FILTERS: readonly { id: ThreadFilter; label: string; empty: string }[] = [
  { id: 'open', label: 'Открытые', empty: 'Открытых обсуждений нет.' },
  { id: 'mine', label: 'Мои', empty: 'Вы пока не участвовали в обсуждениях этой доски.' },
  { id: 'all', label: 'Все', empty: 'Обсуждений пока нет.' },
];

const SOMEONE = 'Удалённый пользователь';

/** Что видит и может пользователь: свои комментарии он правит, а чужие удаляет модератор. */
export interface Viewer {
  id: string;
  /** Управляет доской: может удалять чужие комментарии и обсуждения. */
  moderates: boolean;
}

/**
 * Боковая панель обсуждений: список с фильтром, открытое обсуждение с ответами или новое
 * обсуждение, которое пишут.
 */
export function CommentsPanel({
  store,
  comments,
  editor,
  viewer,
  selectedId,
  draft,
  onSelect,
  onDraftDone,
  onClose,
}: {
  store: CommentStore;
  comments: CommentsState;
  editor: Editor;
  viewer: Viewer;
  selectedId: string | null;
  draft: DraftPin | null;
  onSelect: (threadId: string | null) => void;
  onDraftDone: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ThreadFilter>('open');
  const { pageId } = useEditorState(editor);
  const pages = usePages(editor.doc);
  const selected = comments.threads.find((t) => t.id === selectedId);

  let body;
  if (draft) {
    body = (
      <NewThread
        store={store}
        draft={draft}
        target={draft.element ? editor.doc.page(draft.page).get(draft.element.id) : undefined}
        onCreated={(thread) => {
          onDraftDone();
          onSelect(thread.id);
        }}
        onCancel={onDraftDone}
      />
    );
  } else if (selectedId) {
    body = selected ? (
      <ThreadView
        key={selected.id}
        store={store}
        thread={selected}
        viewer={viewer}
        onBack={() => onSelect(null)}
      />
    ) : (
      <div className={styles.section}>
        <BackButton onClick={() => onSelect(null)} />
        <p className={styles.empty}>
          {comments.status === 'ready'
            ? 'Обсуждение не найдено: возможно, его удалили.'
            : 'Загрузка обсуждения…'}
        </p>
      </div>
    );
  } else {
    body = (
      <ThreadList
        comments={comments}
        viewer={viewer}
        filter={filter}
        onFilter={setFilter}
        pageId={pageId}
        pages={pages}
        onSelect={onSelect}
      />
    );
  }

  return (
    <SidePanel title="Обсуждения" closeLabel="Закрыть обсуждения" onClose={onClose}>
      {body}
    </SidePanel>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={`${controls.ghost} ${styles.back}`} onClick={onClick}>
      ← Все обсуждения
    </button>
  );
}

function ThreadList({
  comments,
  viewer,
  filter,
  onFilter,
  pageId,
  pages,
  onSelect,
}: {
  comments: CommentsState;
  viewer: Viewer;
  filter: ThreadFilter;
  onFilter: (filter: ThreadFilter) => void;
  pageId: string;
  pages: readonly Page[];
  onSelect: (threadId: string) => void;
}) {
  const name = useId();
  const shown = filterThreads(comments.threads, filter, viewer.id);
  const openCount = comments.threads.filter(isOpen).length;
  const pageName = (id: string) => pages.find((page) => page.id === id)?.name;

  let content;
  if (comments.status === 'loading') {
    content = <p className={styles.empty}>Загрузка обсуждений…</p>;
  } else if (comments.status === 'failed') {
    content = (
      <p className={styles.empty} role="alert">
        Не удалось загрузить обсуждения. Проверьте связь с сервером.
      </p>
    );
  } else if (shown.length === 0) {
    content = <p className={styles.empty}>{FILTERS.find((f) => f.id === filter)?.empty}</p>;
  } else {
    content = (
      <ul className={styles.threads}>
        {shown.map((thread) => {
          const [question] = thread.comments;
          const replies = thread.comments.length - 1;
          const page = thread.page === pageId ? null : (pageName(thread.page) ?? 'удалена');
          return (
            <li key={thread.id}>
              <button
                type="button"
                className={styles.threadItem}
                onClick={() => {
                  onSelect(thread.id);
                }}
              >
                <AuthorLine author={thread.author} when={thread.created_at} />
                <span className={styles.excerpt}>{question?.text}</span>
                <span className={styles.meta}>
                  {[
                    replies > 0 && repliesText(replies),
                    page && `страница «${page}»`,
                    !isOpen(thread) && 'решено',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.filters} role="radiogroup" aria-label="Какие обсуждения показать">
        {FILTERS.map((f) => (
          <label key={f.id} className={styles.filter}>
            <input
              type="radio"
              name={name}
              checked={filter === f.id}
              onChange={() => {
                onFilter(f.id);
              }}
            />
            {f.id === 'open' && openCount > 0 ? `${f.label}: ${openCount}` : f.label}
          </label>
        ))}
      </div>
      {content}
      <p className={styles.hint}>
        Чтобы начать обсуждение, выберите инструмент «Комментарий» (C) и щёлкните по доске или
        фигуре.
      </p>
    </div>
  );
}

function repliesText(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} ответов`;
  if (ones === 1) return `${count} ответ`;
  if (ones >= 2 && ones <= 4) return `${count} ответа`;
  return `${count} ответов`;
}

function AuthorLine({ author, when }: { author: Person | null; when: string }) {
  const name = author?.name ?? SOMEONE;
  return (
    <span className={styles.authorLine}>
      <span className={styles.avatar} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className={styles.author}>{name}</span>
      <time className={styles.when} dateTime={when} title={new Date(when).toLocaleString('ru')}>
        {formatWhen(when)}
      </time>
    </span>
  );
}

/** Подпись элемента, к которому пишут: его текст, а если текста нет — что это за фигура. */
function elementName(el: BoardElement): string {
  const text = el.kind === 'path' ? '' : (el.text.split('\n')[0]?.trim() ?? '');
  if (text) return `«${text.length > 40 ? `${text.slice(0, 39)}…` : text}»`;
  if (isArrow(el)) return 'стрелке';
  if (el.kind === 'path') return 'рисунку';
  return `фигуре «${shapeSpec(el.kind).label}»`;
}

function NewThread({
  store,
  draft,
  target,
  onCreated,
  onCancel,
}: {
  store: CommentStore;
  draft: DraftPin;
  target: BoardElement | undefined;
  onCreated: (thread: CommentThread) => void;
  onCancel: () => void;
}) {
  return (
    <section className={styles.section} aria-label="Новое обсуждение">
      <h3 className={styles.subtitle}>Новое обсуждение</h3>
      <p className={styles.where}>{target ? `К ${elementName(target)}` : 'В точке доски'}</p>
      <CommentComposer
        // Метку переставили: поле снова получает фокус, иначе набранное ушло бы на доску.
        key={`${draft.page}:${draft.x}:${draft.y}`}
        label="Текст обсуждения"
        placeholder="Вопрос или замечание"
        submitLabel="Отправить"
        autoFocus
        people={() => store.people()}
        onSubmit={async (text) => {
          onCreated(await store.create({ ...draft, text }));
        }}
        onCancel={onCancel}
      />
    </section>
  );
}

function ThreadView({
  store,
  thread,
  viewer,
  onBack,
}: {
  store: CommentStore;
  thread: CommentThread;
  viewer: Viewer;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = isOpen(thread);
  const mayDelete = (author: Person | null) => author?.id === viewer.id || viewer.moderates;

  const run = (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError(null);
    work()
      .catch((e: unknown) => {
        setError(errorText(e, failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className={styles.section}>
      <BackButton onClick={onBack} />
      {thread.resolved_at && (
        <p className={styles.resolved}>
          Решено{thread.resolved_by ? `: ${thread.resolved_by.name}` : ''},{' '}
          {formatWhen(thread.resolved_at)}
        </p>
      )}
      <ol className={styles.comments} aria-label="Комментарии">
        {thread.comments.map((comment, index) => (
          <CommentItem
            key={comment.id}
            store={store}
            comment={comment}
            mayEdit={comment.author?.id === viewer.id}
            // Первый комментарий — вопрос: он удаляется вместе с обсуждением.
            mayDelete={index > 0 && mayDelete(comment.author)}
            onDelete={() => {
              if (!window.confirm('Удалить комментарий?')) return;
              run(
                () => store.deleteComment(thread.id, comment.id),
                'Не удалось удалить комментарий. Проверьте связь с сервером.',
              );
            }}
          />
        ))}
      </ol>
      <div className={styles.threadActions}>
        <button
          type="button"
          className={controls.secondary}
          disabled={busy}
          onClick={() => {
            run(
              () => store.setResolved(thread.id, open),
              'Не удалось изменить обсуждение. Проверьте связь с сервером.',
            );
          }}
        >
          {open ? 'Вопрос решён' : 'Открыть снова'}
        </button>
        {mayDelete(thread.author) && (
          <button
            type="button"
            className={controls.ghost}
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Удалить обсуждение вместе со всеми ответами?')) return;
              run(async () => {
                await store.deleteThread(thread.id);
                onBack();
              }, 'Не удалось удалить обсуждение. Проверьте связь с сервером.');
            }}
          >
            Удалить обсуждение
          </button>
        )}
      </div>
      {error && (
        <p className={controls.error} role="alert">
          {error}
        </p>
      )}
      <CommentComposer
        label="Ответ"
        placeholder="Ответить"
        submitLabel="Ответить"
        people={() => store.people()}
        onSubmit={(text) => store.reply(thread.id, text)}
      />
    </div>
  );
}

function CommentItem({
  store,
  comment,
  mayEdit,
  mayDelete,
  onDelete,
}: {
  store: CommentStore;
  comment: Comment;
  mayEdit: boolean;
  mayDelete: boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className={styles.comment}>
      <AuthorLine author={comment.author} when={comment.created_at} />
      {editing ? (
        <CommentComposer
          label="Текст комментария"
          placeholder="Текст комментария"
          submitLabel="Сохранить"
          initialText={comment.text}
          autoFocus
          people={() => store.people()}
          onSubmit={async (text) => {
            await store.edit(comment.id, text);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : (
        <p className={styles.text}>
          {splitMentions(comment.text, comment.mentions).map((part, i) =>
            'person' in part ? (
              <span key={i} className={styles.mention} title={part.person.name}>
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
          {comment.edited_at && <span className={styles.edited}> (изменено)</span>}
        </p>
      )}
      {!editing && (mayEdit || mayDelete) && (
        <div className={styles.commentActions}>
          {mayEdit && (
            <button
              type="button"
              className={controls.ghost}
              onClick={() => {
                setEditing(true);
              }}
            >
              Изменить
            </button>
          )}
          {mayDelete && (
            <button type="button" className={controls.ghost} onClick={onDelete}>
              Удалить
            </button>
          )}
        </div>
      )}
    </li>
  );
}
