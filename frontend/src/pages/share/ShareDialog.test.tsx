import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardAccess, BoardInfo, Person } from '../../api';
import { failure, stubServer } from '../../testing/server';
import { ShareDialog } from './ShareDialog';

const OWNER: Person = { id: 'u-olga', login: 'olga', name: 'Ольга Сидорова' };
const IVAN: Person = { id: 'u-ivan', login: 'ivan', name: 'Иван Петров' };
const ANNA: Person = { id: 'u-anna', login: 'anna', name: 'Анна Смирнова' };

const BOARD: BoardInfo = {
  id: 'b1',
  name: 'Схема',
  owner: OWNER,
  folder_id: null,
  access: 'manage',
  created_at: '',
  updated_at: '',
};

const LINK = {
  token: 'h3Kq9-x_Vb2mN7pLr4sT1uWy',
  role: 'viewer',
  created_at: '2026-11-21T00:00:00Z',
  expires_at: null,
} as const;

function serve(access: BoardAccess = { owner: OWNER, members: [], links: [] }) {
  return stubServer((method, path, body) => {
    if (path === '/boards/b1/access') return Response.json(access);
    if (path === '/users') return Response.json([OWNER, IVAN, ANNA]);
    if (method === 'PUT') {
      const user = path.endsWith(IVAN.id) ? IVAN : ANNA;
      return Response.json({ user, ...(body as object) });
    }
    if (method === 'POST') {
      return Response.json({ ...LINK, token: 'new-link-token-1234567', ...(body as object) });
    }
    return new Response(null, { status: 204 });
  });
}

function open(onClose = vi.fn()) {
  render(<ShareDialog board={BOARD} me={OWNER.id} onClose={onClose} />);
  return onClose;
}

describe('ShareDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives a colleague access and changes it', async () => {
    const fetch = serve();
    open();
    const dialog = await screen.findByRole('dialog', { name: 'Доступ к доске «Схема»' });
    expect(within(dialog).getByText('владелец')).toBeTruthy();

    const people = screen.getByLabelText('Сотрудник');
    // Владельцу доступ выдавать незачем.
    expect(within(people).queryByText(/Ольга/)).toBeNull();
    fireEvent.change(people, { target: { value: IVAN.id } });
    fireEvent.change(screen.getByLabelText('Право нового участника'), {
      target: { value: 'editor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    const role = await screen.findByLabelText<HTMLSelectElement>(`Право: ${IVAN.name}`);
    expect(role.value).toBe('editor');
    expect(fetch).toHaveBeenCalledWith(
      `/api/boards/b1/members/${IVAN.id}`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ role: 'editor' }) }),
    );
    fireEvent.change(role, { target: { value: 'viewer' } });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>(`Право: ${IVAN.name}`).value).toBe('viewer');
    });
  });

  it('removes a member', async () => {
    serve({ owner: OWNER, members: [{ user: IVAN, role: 'viewer' }], links: [] });
    open();
    fireEvent.click(await screen.findByRole('button', { name: `Убрать ${IVAN.name}` }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Иван Петров больше не видит доску.',
    );
    expect(screen.queryByLabelText(`Право: ${IVAN.name}`)).toBeNull();
  });

  it('creates, copies and deletes links', async () => {
    const fetch = serve({ owner: OWNER, members: [], links: [LINK] });
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    open();

    const existing = await screen.findByDisplayValue(`${window.location.origin}/s/${LINK.token}`);
    expect(screen.getByText('просмотр, без срока')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    expect((await screen.findByRole('status')).textContent).toBe('Ссылка скопирована.');
    expect(writeText).toHaveBeenCalledWith((existing as HTMLInputElement).value);

    fireEvent.change(screen.getByLabelText('Право по ссылке'), { target: { value: 'editor' } });
    fireEvent.change(screen.getByLabelText('Срок действия'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    expect(await screen.findByDisplayValue(/new-link-token/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      '/api/boards/b1/links',
      expect.objectContaining({ body: JSON.stringify({ role: 'editor', expires_in_days: 30 }) }),
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: `Удалить ссылку ${existing.getAttribute('value') ?? ''}`,
      }),
    );
    await waitFor(() => {
      expect(screen.queryByDisplayValue(`${window.location.origin}/s/${LINK.token}`)).toBeNull();
    });
  });

  it('selects the link for manual copying where the clipboard is unavailable', async () => {
    serve({ owner: OWNER, members: [], links: [LINK] });
    vi.stubGlobal('navigator', {});
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Копировать' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Ссылка выделена: нажмите Ctrl+C, чтобы скопировать.',
    );
  });

  it('shows the server explanation when a change fails', async () => {
    stubServer((_method, path) => {
      if (path === '/boards/b1/access')
        return Response.json({ owner: OWNER, members: [], links: [] });
      if (path === '/users') return Response.json([IVAN]);
      return failure(403, 'Недостаточно прав для этого действия');
    });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Создать ссылку' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Недостаточно прав для этого действия',
    );
  });

  it('closes on the close button', async () => {
    serve();
    const onClose = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
