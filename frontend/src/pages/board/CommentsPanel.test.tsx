import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type CommentThread, api } from '../../api';
import { CommentStore } from '../../comments/store';
import { Editor } from '../../editor/Editor';
import {
  type ArrowElement,
  DEFAULT_ARROW_STYLE,
  DEFAULT_FILL,
  DEFAULT_PAGE,
  DEFAULT_STROKE,
  type ShapeElement,
} from '../../model/types';
import { ANNA, IVAN, OLGA, comment, thread } from '../../testing/comments';
import { defined } from '../../testing/helpers';
import { useSnapshot } from '../../ui/useSnapshot';
import type { DraftPin } from './CommentPins';
import { CommentsPanel, type Viewer } from './CommentsPanel';

function box(id: string, text: string): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    page: DEFAULT_PAGE,
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    text,
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  };
}

const LINK: ArrowElement = {
  id: 'link',
  kind: 'arrow',
  page: DEFAULT_PAGE,
  start: { x: 0, y: 200 },
  end: { x: 200, y: 200 },
  text: '',
  stroke: DEFAULT_STROKE,
  z: 2,
  ...DEFAULT_ARROW_STYLE,
};

const QUESTION = thread(
  't1',
  [
    comment('c1', ANNA, 'Кто отвечает за @ivan кэш?', {
      created_at: '2026-11-23T08:00:00Z',
      mentions: [IVAN],
      edited_at: '2026-11-23T08:05:00Z',
    }),
    comment('c2', IVAN, 'Я', { created_at: '2026-11-23T08:10:00Z' }),
    comment('c3', OLGA, 'Подтверждаю', { created_at: '2026-11-23T08:20:00Z' }),
  ],
  { element: { id: 'server', x: 0.5, y: 0.5 } },
);
const RESOLVED = thread(
  't2',
  [comment('c4', IVAN, 'Нужен ли балансировщик?', { created_at: '2026-11-23T05:00:00Z' })],
  { resolved_at: '2026-11-23T07:00:00Z', resolved_by: OLGA },
);
const OTHER_PAGE = thread('t3', [
  comment('c5', OLGA, 'Схема сети устарела', { created_at: '2026-11-23T07:30:00Z' }),
]);
const LOST_PAGE = thread(
  't4',
  [comment('c6', null, 'Старый вопрос', { created_at: '2026-11-23T06:00:00Z' })],
  { page: 'gone' },
);

interface Setup {
  threads?: CommentThread[];
  viewer?: Viewer;
  selected?: string | null;
  draft?: DraftPin | null;
}

/** Панель на странице доски: выбор обсуждения и черновик живут у неё снаружи, как в BoardPage. */
function Discussion({
  store,
  editor,
  viewer,
  selected,
  draft,
  onClose,
}: Required<Omit<Setup, 'threads'>> & {
  store: CommentStore;
  editor: Editor;
  onClose: () => void;
}) {
  const comments = useSnapshot(store);
  const [selectedId, setSelectedId] = useState(selected);
  const [shownDraft, setDraft] = useState(draft);
  return (
    <CommentsPanel
      store={store}
      comments={comments}
      editor={editor}
      viewer={viewer}
      selectedId={selectedId}
      draft={shownDraft}
      onSelect={setSelectedId}
      onDraftDone={() => {
        setDraft(null);
      }}
      onClose={onClose}
    />
  );
}

async function setup({
  threads = [QUESTION, RESOLVED, OTHER_PAGE, LOST_PAGE],
  viewer = { id: ANNA.id, moderates: false },
  selected = null,
  draft = null,
}: Setup = {}) {
  vi.spyOn(api, 'listThreads').mockResolvedValue(threads);
  const editor = new Editor();
  editor.doc.add(box('server', 'Сервер приложений\nверсия 2'));
  editor.doc.add({ ...box('blank', ''), kind: 'diamond' });
  editor.doc.add(LINK);
  const network = editor.doc.addPage('Сеть');
  for (const t of threads) if (t === OTHER_PAGE) t.page = network;
  const store = new CommentStore('b1');
  const onClose = vi.fn();
  render(
    <Discussion
      store={store}
      editor={editor}
      viewer={viewer}
      selected={selected}
      draft={draft}
      onClose={onClose}
    />,
  );
  await act(async () => {
    store.refresh();
    await Promise.resolve();
  });
  return { editor, store, onClose };
}

const list = () => within(screen.getByRole('list'));
const items = () => list().getAllByRole('button');
const field = (name: string) => screen.getByRole<HTMLTextAreaElement>('textbox', { name });

describe('CommentsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the discussions, the liveliest first, and filters them', async () => {
    const { onClose } = await setup();
    expect(screen.getByRole('heading', { name: 'Обсуждения' })).toBeTruthy();
    const filter = (name: RegExp) => screen.getByRole('radio', { name });
    expect(filter(/^Открытые: 3$/).matches(':checked')).toBe(true);

    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^ААнна Смирнова.+Кто отвечает за @ivan кэш\?2 ответа$/),
      expect.stringMatching(/^ООльга Сидорова.+Схема сети устареластраница «Сеть»$/),
      expect.stringMatching(/^УУдалённый пользователь.+Старый вопросстраница «удалена»$/),
    ]);

    fireEvent.click(filter(/^Все$/));
    expect(items()).toHaveLength(4);
    expect(items()[3]?.textContent).toContain('решено');

    fireEvent.click(filter(/^Мои$/));
    expect(items()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждения' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('says what is missing and when loading failed', async () => {
    vi.spyOn(api, 'listThreads').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const store = new CommentStore('b1');
    render(
      <Discussion
        store={store}
        editor={new Editor()}
        viewer={{ id: ANNA.id, moderates: false }}
        selected={null}
        draft={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Загрузка обсуждений…')).toBeTruthy();
    act(() => {
      store.refresh();
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось загрузить обсуждения. Проверьте связь с сервером.',
    );
  });

  it('explains an empty list for each filter', async () => {
    await setup({ threads: [] });
    expect(screen.getByText('Открытых обсуждений нет.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Мои' }));
    expect(screen.getByText('Вы пока не участвовали в обсуждениях этой доски.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Все' }));
    expect(screen.getByText('Обсуждений пока нет.')).toBeTruthy();
  });

  it('opens a discussion, answers it and marks it resolved', async () => {
    await setup();
    fireEvent.click(defined(items()[0]));
    const comments = within(screen.getByRole('list', { name: 'Комментарии' })).getAllByRole(
      'listitem',
    );
    expect(comments).toHaveLength(3);
    expect(within(defined(comments[0])).getByTitle(IVAN.name).textContent).toBe('@ivan');
    expect(comments[0]?.textContent).toContain('(изменено)');

    const answered = {
      ...QUESTION,
      comments: [...QUESTION.comments, comment('c7', ANNA, 'Спасибо')],
    };
    const reply = vi.spyOn(api, 'reply').mockResolvedValue(answered);
    fireEvent.change(field('Ответ'), { target: { value: '  Спасибо  ' } });
    fireEvent.keyDown(field('Ответ'), { key: 'Enter' });
    // Текст ещё и в поле ввода, пока ответ не отправлен: ищем его в ленте.
    expect(await screen.findByText('Спасибо', { ignore: 'textarea' })).toBeTruthy();
    expect(reply).toHaveBeenCalledWith('t1', 'Спасибо');
    // Поле очищается, когда сервер принял ответ, — сразу после того, как ответ виден в ленте.
    await waitFor(() => {
      expect(field('Ответ').value).toBe('');
    });

    const resolvedAt = new Date().toISOString();
    vi.spyOn(api, 'setThreadResolved').mockResolvedValue({
      ...answered,
      resolved_at: resolvedAt,
      resolved_by: ANNA,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Вопрос решён' }));
    expect(await screen.findByText('Решено: Анна Смирнова, только что')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть снова' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '← Все обсуждения' }));
    expect(screen.getByRole('radio', { name: /^Открытые/ })).toBeTruthy();
  });

  it('keeps the answer and explains when it could not be sent', async () => {
    await setup({ selected: 't1' });
    vi.spyOn(api, 'reply').mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.change(field('Ответ'), { target: { value: 'Черновик' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось отправить. Проверьте связь с сервером.',
    );
    expect(field('Ответ').value).toBe('Черновик');
    // Shift+Enter — новая строка, а не отправка.
    fireEvent.keyDown(field('Ответ'), { key: 'Enter', shiftKey: true });
    expect(api.reply).toHaveBeenCalledOnce();
  });

  it('lets the author edit their comment', async () => {
    await setup({ selected: 't1', viewer: { id: IVAN.id, moderates: false } });
    expect(screen.getAllByRole('button', { name: 'Изменить' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Удалить обсуждение' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(field('Текст комментария').value).toBe('Я');
    expect(document.activeElement).toBe(field('Текст комментария'));
    fireEvent.keyDown(field('Текст комментария'), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Текст комментария' })).toBeNull();

    const edit = vi.spyOn(api, 'editComment').mockResolvedValue({
      ...QUESTION,
      comments: QUESTION.comments.map((c) =>
        c.id === 'c2' ? { ...c, text: 'Я, до пятницы', edited_at: new Date().toISOString() } : c,
      ),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    fireEvent.change(field('Текст комментария'), { target: { value: 'Я, до пятницы' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Я, до пятницы', { ignore: 'textarea' })).toBeTruthy();
    expect(edit).toHaveBeenCalledWith('c2', 'Я, до пятницы');
    expect(screen.queryByRole('textbox', { name: 'Текст комментария' })).toBeNull();
  });

  it('lets the author or a moderator delete, after a confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await setup({ selected: 't1', viewer: { id: OLGA.id, moderates: true } });
    // Вопрос удаляется только вместе с обсуждением.
    expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(2);
    const deleteComment = vi.spyOn(api, 'deleteComment').mockResolvedValue();

    fireEvent.click(defined(screen.getAllByRole('button', { name: 'Удалить' })[0]));
    expect(confirm).toHaveBeenLastCalledWith('Удалить комментарий?');
    expect(deleteComment).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(defined(screen.getAllByRole('button', { name: 'Удалить' })[0]));
    await waitFor(() => {
      expect(screen.queryByText('Я')).toBeNull();
    });
    expect(deleteComment).toHaveBeenCalledWith('c2');
    // Кнопки заняты, пока удаление не закончилось, — и чуть дольше, чем комментарий виден.
    const deleteThread = () => screen.getByRole('button', { name: 'Удалить обсуждение' });
    await waitFor(() => {
      expect(deleteThread()).toHaveProperty('disabled', false);
    });

    vi.spyOn(api, 'deleteThread')
      .mockRejectedValueOnce(new ApiError(403, 'Удалить обсуждение может его автор', 'Forbidden'))
      .mockResolvedValue();
    fireEvent.click(deleteThread());
    expect(confirm).toHaveBeenLastCalledWith('Удалить обсуждение вместе со всеми ответами?');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Удалить обсуждение может его автор',
    );
    await waitFor(() => {
      expect(deleteThread()).toHaveProperty('disabled', false);
    });
    fireEvent.click(deleteThread());
    expect(await screen.findByRole('radio', { name: /^Открытые/ })).toBeTruthy();
    expect(items()).toHaveLength(2);
  });

  it('explains a discussion that is gone or still loading', async () => {
    vi.spyOn(api, 'listThreads').mockResolvedValue([]);
    const store = new CommentStore('b1');
    render(
      <Discussion
        store={store}
        editor={new Editor()}
        viewer={{ id: ANNA.id, moderates: false }}
        selected="t-gone"
        draft={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Загрузка обсуждения…')).toBeTruthy();
    act(() => {
      store.refresh();
    });
    expect(await screen.findByText('Обсуждение не найдено: возможно, его удалили.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Все обсуждения' }));
    expect(screen.getByText('Открытых обсуждений нет.')).toBeTruthy();
  });

  it.each([
    [{ id: 'server', x: 0.5, y: 0.5 }, 'К «Сервер приложений»'],
    [{ id: 'link', x: 0.5, y: 0.5 }, 'К стрелке'],
    [null, 'В точке доски'],
  ])('starts a new discussion %#', async (element, where) => {
    const draft: DraftPin = { page: DEFAULT_PAGE, x: 50, y: 30, element };
    await setup({ draft });
    expect(screen.getByRole('region', { name: 'Новое обсуждение' }).textContent).toContain(where);
    expect(document.activeElement).toBe(field('Текст обсуждения'));

    const created = thread('t9', [comment('c9', ANNA, 'Почему здесь?')]);
    const create = vi.spyOn(api, 'createThread').mockResolvedValue(created);
    fireEvent.change(field('Текст обсуждения'), { target: { value: 'Почему здесь?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByRole('list', { name: 'Комментарии' })).toBeTruthy();
    expect(create).toHaveBeenCalledWith('b1', { ...draft, text: 'Почему здесь?' });
  });

  it('names a shape without text by its kind and drops the draft on cancel', async () => {
    await setup({
      draft: { page: DEFAULT_PAGE, x: 0, y: 0, element: { id: 'blank', x: 0, y: 0 } },
    });
    expect(screen.getByText('К фигуре «Ромб»')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('region', { name: 'Новое обсуждение' })).toBeNull();
    expect(screen.getByRole('radio', { name: /^Открытые/ })).toBeTruthy();
  });
  it('focuses the field again when the pin is placed somewhere else', () => {
    const store = new CommentStore('b1');
    const panel = (draft: DraftPin) => (
      <CommentsPanel
        store={store}
        comments={{ threads: [], status: 'ready' }}
        editor={new Editor()}
        viewer={{ id: ANNA.id, moderates: false }}
        selectedId={null}
        draft={draft}
        onSelect={vi.fn()}
        onDraftDone={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const { rerender } = render(panel({ page: DEFAULT_PAGE, x: 0, y: 0, element: null }));
    // Щелчок по холсту увёл фокус, и метку поставили в другом месте.
    field('Текст обсуждения').blur();
    rerender(panel({ page: DEFAULT_PAGE, x: 300, y: 200, element: null }));
    expect(document.activeElement).toBe(field('Текст обсуждения'));
  });
});

describe('Mentions in a comment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function typing() {
    await setup({ selected: 't1' });
    const people = vi.spyOn(api, 'boardPeople').mockResolvedValue([ANNA, IVAN, OLGA]);
    const answer = field('Ответ');
    const type = (value: string) => {
      fireEvent.change(answer, { target: { value } });
    };
    const options = () =>
      within(screen.getByRole('listbox', { name: 'Кого упомянуть' })).getAllByRole('option');
    return { people, answer, type, options };
  }

  it('suggests colleagues after @ and puts the chosen login into the text', async () => {
    const { people, answer, type, options } = await typing();
    type('Посмотри, @');
    await waitFor(() => {
      expect(options()).toHaveLength(3);
    });
    expect(people).toHaveBeenCalledOnce();

    type('Посмотри, @о');
    expect(options().map((option) => option.textContent)).toEqual(['Ольга Сидорова @olga']);
    type('Посмотри, @');
    expect(answer.getAttribute('aria-activedescendant')).toBe(options()[0]?.id);

    fireEvent.keyDown(answer, { key: 'ArrowDown' });
    fireEvent.keyDown(answer, { key: 'ArrowDown' });
    expect(options()[2]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(answer, { key: 'ArrowDown' });
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(answer, { key: 'ArrowUp' });
    expect(options()[2]?.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(answer, { key: 'Enter' });
    expect(answer.value).toBe('Посмотри, @olga ');
    expect(answer.selectionStart).toBe('Посмотри, @olga '.length);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(people).toHaveBeenCalledOnce();
  });

  it('picks with the mouse or Tab, and closes on Escape or when the field loses focus', async () => {
    const { answer, type, options } = await typing();
    const reply = vi.spyOn(api, 'reply').mockResolvedValue(QUESTION);
    type('@ив');
    fireEvent.mouseDown(defined((await screen.findAllByRole('option'))[0]));
    expect(answer.value).toBe('@ivan ');

    type('@ivan и @а');
    fireEvent.keyDown(answer, { key: 'Tab' });
    expect(answer.value).toBe('@ivan и @anna ');

    type('@ivan и @anna, @');
    expect(options()).toHaveLength(3);
    fireEvent.keyDown(answer, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    // Без списка Enter отправляет комментарий.
    fireEvent.keyDown(answer, { key: 'Enter' });
    expect(reply).toHaveBeenCalledWith('t1', '@ivan и @anna, @');

    await waitFor(() => {
      expect(answer.value).toBe('');
    });
    type('@');
    expect(options()).toHaveLength(3);
    fireEvent.blur(answer);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('works without suggestions when the list of colleagues did not load', async () => {
    const { people, type } = await typing();
    people.mockRejectedValue(new TypeError('Failed to fetch'));
    type('@');
    await waitFor(() => {
      expect(people.mock.settledResults[0]?.type).toBe('rejected');
    });
    type('@и');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(people).toHaveBeenCalledOnce();
  });
});
