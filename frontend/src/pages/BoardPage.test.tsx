import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Access, BoardInfo, CommentThread } from '../api';
import { NotificationsContext } from '../notifications/context';
import { NotificationStore } from '../notifications/store';
import { parseRoute, useLocation } from '../router';
import { MEMBER, signedIn, withAuth } from '../testing/auth';
import { BoardDocument } from '../model/document';
import { enableCanvas } from '../testing/canvas';
import { ANNA, IVAN, comment, notification, thread } from '../testing/comments';
import { FakeSocket } from '../testing/fakeSocket';
import { failure, stubServer } from '../testing/server';
import { version } from '../testing/versions';
import { formatMoment } from '../ui/time';
import { rememberAccess } from './boardAccessCache';
import { BoardPage } from './BoardPage';

vi.mock('y-indexeddb', () => import('../testing/fakeSocket').then((m) => m.indexeddbStub));

function board(access: Access, isTemplate = false): BoardInfo {
  return {
    id: 'b1',
    name: 'Схема',
    owner: { id: 'u-owner', login: 'owner', name: 'Ольга' },
    folder_id: null,
    access,
    is_template: isTemplate,
    created_at: '',
    updated_at: '',
  };
}

const asMember = signedIn(MEMBER);

function serveBoard(access: Access) {
  return stubServer((method, path, body) => {
    if (path === '/boards/b1/access') return Response.json({ owner: null, members: [], links: [] });
    if (path === '/users') return Response.json([]);
    return Response.json(
      method === 'PATCH' ? { ...board(access), ...(body as object) } : board(access),
    );
  });
}

function openBoard() {
  render(withAuth(<BoardPage boardId="b1" />, asMember));
  act(() => {
    FakeSocket.last().open();
  });
}

describe('BoardPage', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows the connection status and loads the name once online', async () => {
    const fetch = serveBoard('edit');
    render(withAuth(<BoardPage boardId="b1" />, asMember));
    expect(screen.getByText('Подключение…')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      FakeSocket.last().open();
    });
    expect(screen.getByText('В сети')).toBeTruthy();
    expect(await screen.findByDisplayValue('Схема')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Прямоугольник' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Поделиться' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать доску по шаблону' })).toBeNull();
  });

  it('renames the board on Enter and ignores an empty name', async () => {
    const fetch = serveBoard('edit');
    openBoard();
    const input = await screen.findByDisplayValue('Схема');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('Схема')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'Архитектура' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(await screen.findByDisplayValue('Архитектура')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/b1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('puts the name back on Escape without renaming the board', async () => {
    const fetch = serveBoard('edit');
    openBoard();
    const input = await screen.findByDisplayValue('Схема');
    input.focus();
    fireEvent.change(input, { target: { value: 'Черновик' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('Схема')).toBe(input);
    expect(document.activeElement).not.toBe(input);
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/boards/b1',
      expect.objectContaining({ method: 'PATCH' }),
    );

    // Следующая правка сохраняется как обычно.
    input.focus();
    fireEvent.change(input, { target: { value: 'Архитектура' } });
    fireEvent.blur(input);
    expect(await screen.findByDisplayValue('Архитектура')).toBeTruthy();
  });

  it('opens the board for viewing only to a viewer', async () => {
    serveBoard('view');
    openBoard();
    expect(await screen.findByText('Только просмотр')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Прямоугольник' })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Название доски').readOnly).toBe(true);
  });

  it('uses the remembered access while there is no connection', () => {
    stubServer(() => Response.json(board('edit')));
    rememberAccess(MEMBER.id, 'b1', 'edit');
    render(withAuth(<BoardPage boardId="b1" />, asMember));
    expect(screen.getByRole('button', { name: 'Прямоугольник' })).toBeTruthy();
  });

  it('stays read-only while the access is unknown', () => {
    stubServer(() => Response.json(board('edit')));
    render(withAuth(<BoardPage boardId="b1" />, asMember));
    expect(screen.getByText('Только просмотр')).toBeTruthy();
  });

  it('lets the owner open the sharing dialog', async () => {
    serveBoard('manage');
    openBoard();
    fireEvent.click(await screen.findByRole('button', { name: 'Поделиться' }));
    expect(await screen.findByRole('dialog', { name: 'Доступ к доске «Схема»' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks a company template and creates a board from it', async () => {
    const fetch = stubServer((method, path) => {
      if (path.endsWith('/content')) return new Response(new Uint8Array([0, 0]));
      if (method === 'POST') return Response.json({ ...board('manage'), id: 'b-new' });
      return Response.json(board('view', true));
    });
    openBoard();
    expect(await screen.findByText('Шаблон')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Создать доску по шаблону' }));
    const dialog = screen.getByRole('dialog', { name: 'Доска по шаблону «Схема»' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/b-new');
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Схема', folder_id: null, template_id: 'b1' }),
      }),
    );
    window.history.pushState(null, '', '/');
  });

  it('explains when access was not given or was revoked', async () => {
    stubServer(() => failure(403, 'Нет доступа к доске. Попросите владельца поделиться ею.'));
    openBoard();
    expect(
      await screen.findByText('Нет доступа к доске. Попросите владельца поделиться ею.'),
    ).toBeTruthy();
  });

  it('explains when the server closes the board for this user', () => {
    serveBoard('edit');
    render(withAuth(<BoardPage boardId="b1" />, asMember));
    act(() => {
      FakeSocket.last().closeByServer(4403);
    });
    expect(
      screen.getByText('Нет доступа к доске. Попросите владельца поделиться ею.'),
    ).toBeTruthy();
  });

  it('tells the user when the board does not exist', () => {
    serveBoard('edit');
    render(withAuth(<BoardPage boardId="b1" />, asMember));
    act(() => {
      FakeSocket.last().closeByServer(4404);
    });
    expect(screen.getByText('Доска не найдена. Возможно, её удалили.')).toBeTruthy();
  });
});

describe('BoardPage discussions', () => {
  const BOARD = '6f1c2a4e-0b1d-4c55-9a43-1d2e3f405162';
  const ASKED = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f00112233';
  const STARTED = '99aabbcc-ddee-4f00-8112-233445566778';
  const QUESTION = thread(ASKED, [comment('c1', ANNA, 'Кто владелец кэша?')], { x: 40, y: 30 });

  /** Страница по адресу, как в App: обсуждение берётся из ?thread=. */
  function AtAddress() {
    const route = parseRoute(useLocation());
    return route.page === 'board' ? (
      <BoardPage boardId={route.boardId} threadId={route.threadId} />
    ) : null;
  }

  function serve(access: Access, threads: CommentThread[]) {
    return stubServer((method, path) => {
      if (path === `/boards/${BOARD}/threads`) {
        if (method === 'GET') return Response.json(threads);
        return Response.json(thread(STARTED, [comment('c2', IVAN, 'Почему здесь?')]), {
          status: 201,
        });
      }
      if (path === `/boards/${BOARD}/people`) return Response.json([ANNA, IVAN]);
      if (path === '/notifications') {
        return Response.json({ unread: 1, items: [notification('n1', { thread_id: ASKED })] });
      }
      if (path === `/threads/${ASKED}/read`) return new Response(null, { status: 204 });
      return Response.json({ ...board(access), id: BOARD });
    });
  }

  /** Доска открыта по адресу и синхронизирована с сервером: обсуждения загружаются после этого. */
  function openAt(address: string, notifications: NotificationStore | null = null) {
    window.history.pushState(null, '', address);
    render(
      withAuth(
        <NotificationsContext value={notifications}>
          <AtAddress />
        </NotificationsContext>,
        asMember,
      ),
    );
    const update = Y.encodeStateAsUpdate(new Y.Doc());
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().receive(new Uint8Array([0, 1, update.length, ...update]));
    });
  }

  const header = () => screen.getByRole('button', { name: /^Обсуждения/ });
  const panel = () => screen.queryByRole('complementary', { name: 'Обсуждения' });
  const address = () => window.location.pathname + window.location.search;

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    enableCanvas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.pushState(null, '', '/');
  });

  it('opens a discussion from its link and reads its notifications', async () => {
    const fetch = serve('edit', [QUESTION]);
    const notifications = new NotificationStore();
    notifications.refresh();
    openAt(`/b/${BOARD}?thread=${ASKED}`, notifications);

    expect(await screen.findByText('Кто владелец кэша?')).toBeTruthy();
    expect(header().getAttribute('aria-pressed')).toBe('true');
    expect(header().textContent).toBe('Обсуждения1');
    const pin = screen.getByRole('button', {
      name: 'Обсуждение: Анна Смирнова: Кто владелец кэша?',
    });
    expect(pin.hasAttribute('data-selected')).toBe(true);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(`/api/threads/${ASKED}/read`, { method: 'POST' });
    });
    expect(notifications.snapshot.unread).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: '← Все обсуждения' }));
    expect(address()).toBe(`/b/${BOARD}`);
    expect(screen.getByRole('radio', { name: 'Открытые: 1' })).toBeTruthy();

    fireEvent.click(pin);
    expect(address()).toBe(`/b/${BOARD}?thread=${ASKED}`);
    expect(await screen.findByRole('list', { name: 'Комментарии' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть обсуждения' }));
    expect(panel()).toBeNull();
    expect(address()).toBe(`/b/${BOARD}`);
    expect(header().getAttribute('aria-pressed')).toBe('false');
  });

  it('opens and closes the panel from the header', async () => {
    serve('edit', []);
    openAt(`/b/${BOARD}`);
    expect(panel()).toBeNull();
    fireEvent.click(header());
    expect(await screen.findByText('Открытых обсуждений нет.')).toBeTruthy();
    fireEvent.click(header());
    expect(panel()).toBeNull();
  });

  it('lets a viewer start a discussion with the comment tool', async () => {
    const fetch = serve('view', []);
    openAt(`/b/${BOARD}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Комментарий' }));
    const canvas = screen.getByLabelText('Холст доски');
    fireEvent.pointerDown(canvas, { clientX: 120, clientY: 80, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: 120, clientY: 80, button: 0 });
    expect(screen.getByText('В точке доски')).toBeTruthy();
    // Поле сразу в фокусе: текст не уйдёт в сочетания клавиш доски.
    const field = screen.getByRole('textbox', { name: 'Текст обсуждения' });
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, {
      target: { value: 'Почему здесь?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => {
      expect(address()).toBe(`/b/${BOARD}?thread=${STARTED}`);
    });
    expect(await screen.findByRole('list', { name: 'Комментарии' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      `/api/boards/${BOARD}/threads`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ page: 'main', x: 120, y: 80, element: null, text: 'Почему здесь?' }),
      }),
    );
  });
});

describe('BoardPage history', () => {
  const BACKUP = 'v-backup';

  /** Доска со страницами pages после первой, как её хранит сервер или версия. */
  function boardWith(...pages: string[]): Uint8Array<ArrayBuffer> {
    const doc = new BoardDocument();
    for (const name of pages) doc.addPage(name);
    return Uint8Array.from(Y.encodeStateAsUpdate(doc.doc));
  }

  const MORNING = version('v-morning', new Date(2026, 10, 23, 9, 0).toISOString());

  function serve(access: Access) {
    return stubServer((method, path, body) => {
      if (path === '/boards/b1/versions') {
        if (method === 'GET') return Response.json([MORNING]);
        const { name } = body as { name: string };
        return Response.json(version(BACKUP, new Date().toISOString(), { name }), { status: 201 });
      }
      if (path === `/versions/${MORNING.id}/state`) return new Response(boardWith('Черновик'));
      if (path === '/boards/b1/threads') return Response.json([]);
      return Response.json(board(access));
    });
  }

  /** Доска открыта и синхронизирована: на ней две страницы. */
  async function openSynced(access: Access) {
    const fetch = serve(access);
    render(withAuth(<BoardPage boardId="b1" />, asMember));
    const update = boardWith('Схема сети');
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().receive(new Uint8Array([0, 1, ...varUint(update.length), ...update]));
    });
    await screen.findByDisplayValue('Схема');
    return fetch;
  }

  const pages = () =>
    within(screen.getByRole('navigation', { name: 'Страницы доски' }))
      .getAllByRole('listitem')
      .map((tab) => tab.textContent);
  const addPage = () => screen.queryByRole('button', { name: 'Добавить страницу' });
  const historyButton = () => screen.getByRole('button', { name: 'История' });

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    enableCanvas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows a version instead of the board and comes back to the board', async () => {
    await openSynced('edit');
    expect(pages()).toEqual(['Страница 1', 'Схема сети']);
    fireEvent.click(screen.getByRole('button', { name: /^Обсуждения/ }));
    fireEvent.click(historyButton());
    expect(screen.queryByRole('complementary', { name: 'Обсуждения' })).toBeNull();
    expect(historyButton().getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(formatMoment(MORNING.created_at)) }),
    );
    const banner = await screen.findByRole('region', { name: 'Просмотр версии' });
    expect(banner.textContent).toContain(formatMoment(MORNING.created_at));
    expect(pages()).toEqual(['Страница 1', 'Черновик']);
    expect(addPage()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Прямоугольник' })).toBeNull();

    fireEvent.click(within(banner).getByRole('button', { name: 'Вернуться к текущей' }));
    expect(screen.queryByRole('region', { name: 'Просмотр версии' })).toBeNull();
    expect(pages()).toEqual(['Страница 1', 'Схема сети']);
    expect(addPage()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Прямоугольник' })).toBeTruthy();

    fireEvent.click(historyButton());
    expect(screen.queryByRole('complementary', { name: 'История версий' })).toBeNull();
  });

  it('restores a version after saving the board as it was', async () => {
    const fetch = await openSynced('manage');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(historyButton());
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(formatMoment(MORNING.created_at)) }),
    );
    const banner = await screen.findByRole('region', { name: 'Просмотр версии' });

    fireEvent.click(within(banner).getByRole('button', { name: 'Восстановить' }));
    const backup = 'Перед восстановлением версии от 23 ноября 2026 г. в 09:00';
    expect(await screen.findByText(new RegExp(`сохранено в истории как «${backup}»`))).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/b1/versions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: backup }) }),
    );
    expect(screen.queryByRole('region', { name: 'Просмотр версии' })).toBeNull();
    expect(pages()).toEqual(['Страница 1', 'Черновик']);
    expect(addPage()).toBeTruthy();
  });

  it('is not offered to those who can only view the board', async () => {
    await openSynced('view');
    expect(screen.queryByRole('button', { name: 'История' })).toBeNull();
  });
});

/** Длина в начале сообщения y-websocket: число байтами по 7 бит, как в lib0. */
function varUint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return bytes;
}
