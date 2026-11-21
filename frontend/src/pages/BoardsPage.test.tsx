import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardInfo, Folder } from '../api';
import { ADMIN, MEMBER, signedIn, withAuth } from '../testing/auth';
import { stubServer, unreachable } from '../testing/server';
import { BoardsPage } from './BoardsPage';

const ROOT = { view: 'mine', folderId: null } as const;

const owner = { id: MEMBER.id, login: MEMBER.login, name: MEMBER.name };
const colleague = { id: ADMIN.id, login: ADMIN.login, name: ADMIN.name };

function board(id: string, name: string, extra: Partial<BoardInfo> = {}): BoardInfo {
  return {
    id,
    name,
    owner,
    folder_id: null,
    access: 'manage',
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    ...extra,
  };
}

function folder(id: string, name: string, parent: string | null = null): Folder {
  return { id, name, parent_id: parent, created_at: '2026-11-20T10:00:00Z' };
}

const PROJECTS = folder('f-projects', 'Проекты');
const BACKEND = folder('f-backend', 'Бэкенд', PROJECTS.id);
const IN_ROOT = board('b-root', 'Схема сервисов');
const IN_BACKEND = board('b-api', 'API', { folder_id: BACKEND.id });
const SHARED = board('b-shared', 'Чужая схема', { owner: colleague, access: 'view' });

/** Сервер со списками досок и папок; остальные запросы обрабатывает extra. */
function serve(
  extra: (method: string, path: string, body: unknown) => Response | null = () => null,
) {
  return stubServer((method, path, body) => {
    const answer = extra(method, path, body);
    if (answer) return answer;
    if (path === '/boards') return Response.json([IN_ROOT, IN_BACKEND, SHARED]);
    if (path === '/folders') return Response.json([PROJECTS, BACKEND]);
    return Response.json({ detail: `unexpected ${method} ${path}` }, { status: 500 });
  });
}

const asMember = signedIn(MEMBER);

describe('BoardsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.pushState(null, '', '/');
  });

  it('shows own boards and folders of the open folder', async () => {
    serve();
    const { rerender } = render(withAuth(<BoardsPage view={ROOT} />, asMember));
    expect(await screen.findByText('Схема сервисов')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Проекты/ }).getAttribute('href')).toBe(
      `/?folder=${PROJECTS.id}`,
    );
    // Чужая доска — в разделе «Доступные мне», а доска из папки — в своей папке.
    expect(screen.queryByText('Чужая схема')).toBeNull();
    expect(screen.queryByText('API')).toBeNull();

    rerender(withAuth(<BoardsPage view={{ view: 'mine', folderId: BACKEND.id }} />, asMember));
    expect(screen.getByRole('heading', { name: 'Бэкенд' })).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Путь к папке' });
    expect(
      within(crumbs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Мои доски', 'Проекты']);
    expect(screen.getByText('API')).toBeTruthy();
  });

  it('creates a board in the open folder and opens it', async () => {
    const fetch = serve((method, path) =>
      method === 'POST' && path === '/boards' ? Response.json(board('b-new', 'Новая доска')) : null,
    );
    render(withAuth(<BoardsPage view={{ view: 'mine', folderId: PROJECTS.id }} />, asMember));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать доску' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/b-new');
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Новая доска', folder_id: PROJECTS.id }),
      }),
    );
  });

  it('creates, renames and deletes folders', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    serve((method, path, body) => {
      if (method === 'POST' && path === '/folders') return Response.json(folder('f-new', 'Архив'));
      if (method === 'PATCH') return Response.json({ ...PROJECTS, ...(body as object) });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return null;
    });
    render(withAuth(<BoardsPage view={ROOT} />, asMember));
    await screen.findByText('Схема сервисов');

    fireEvent.click(screen.getByRole('button', { name: 'Новая папка' }));
    fireEvent.change(screen.getByLabelText('Название папки'), { target: { value: 'Архив' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('link', { name: /Архив/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать папку Проекты' }));
    const name = screen.getByLabelText('Новое название папки Проекты');
    fireEvent.change(name, { target: { value: 'Работа' } });
    fireEvent.submit(name);
    expect(await screen.findByRole('link', { name: /Работа/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить папку Работа' }));
    // Вложенная папка поднялась на уровень выше.
    expect(await screen.findByRole('link', { name: /Бэкенд/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Работа/ })).toBeNull();
  });

  it('moves a board into a folder', async () => {
    serve((method, path, body) =>
      method === 'PATCH' && path === `/boards/${IN_ROOT.id}`
        ? Response.json({ ...IN_ROOT, ...(body as object) })
        : null,
    );
    render(withAuth(<BoardsPage view={ROOT} />, asMember));
    const select = await screen.findByLabelText(`Папка доски ${IN_ROOT.name}`);
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Без папки', 'Проекты', 'Проекты / Бэкенд']);
    fireEvent.change(select, { target: { value: BACKEND.id } });
    await waitFor(() => {
      expect(screen.queryByText(IN_ROOT.name)).toBeNull();
    });
  });

  it('deletes a board after confirmation', async () => {
    serve((method) => (method === 'DELETE' ? new Response(null, { status: 204 }) : null));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    render(withAuth(<BoardsPage view={ROOT} />, asMember));

    const remove = await screen.findByRole('button', { name: `Удалить доску ${IN_ROOT.name}` });
    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText(IN_ROOT.name)).toBeTruthy();
    fireEvent.click(remove);
    await waitFor(() => {
      expect(screen.queryByText(IN_ROOT.name)).toBeNull();
    });
  });

  it('lists boards shared by colleagues with the owner and the access level', async () => {
    serve();
    render(withAuth(<BoardsPage view={{ view: 'shared' }} />, asMember));
    expect(await screen.findByText('Чужая схема')).toBeTruthy();
    expect(screen.getByText(/владелец Анна Смирнова · просмотр/)).toBeTruthy();
    expect(screen.queryByText('Схема сервисов')).toBeNull();
    expect(screen.getByRole('link', { name: 'Доступные мне' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('shows every board to an administrator', async () => {
    serve((_method, path) => (path === '/boards?all=true' ? Response.json([SHARED]) : null));
    render(withAuth(<BoardsPage view={{ view: 'all' }} />));
    expect(await screen.findByText('Чужая схема')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить доску Чужая схема' })).toBeTruthy();
  });

  it('hides the list of every board from other users', () => {
    serve();
    render(withAuth(<BoardsPage view={{ view: 'all' }} />, asMember));
    expect(screen.queryByRole('link', { name: 'Все доски' })).toBeNull();
    expect(screen.getByText('Раздел доступен только администраторам.')).toBeTruthy();
  });

  it('explains an empty list and an unknown folder', async () => {
    stubServer(() => Response.json([]));
    const { rerender } = render(withAuth(<BoardsPage view={ROOT} />, asMember));
    expect(await screen.findByText('Досок пока нет. Создайте первую.')).toBeTruthy();
    rerender(withAuth(<BoardsPage view={{ view: 'mine', folderId: 'gone' }} />, asMember));
    expect(screen.getByText(/Папка не найдена/)).toBeTruthy();
  });

  it('explains when the server is unreachable', async () => {
    unreachable();
    render(withAuth(<BoardsPage view={ROOT} />));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Сервер недоступен. Попробуйте обновить страницу.',
    );
  });
});
