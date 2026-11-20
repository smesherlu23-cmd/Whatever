import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardsPage } from './BoardsPage';

const BOARD = {
  id: '0b7d2d4e-1c2a-4c49-9d6f-1f2e3d4c5b6a',
  name: 'Схема сервисов',
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
};

function stubServer(handler: (url: string, init?: RequestInit) => Response) {
  const fetch = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('BoardsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.pushState(null, '', '/');
  });

  it('creates a board and opens it', async () => {
    stubServer((_url, init) =>
      init?.method === 'POST' ? Response.json(BOARD) : Response.json([]),
    );
    render(<BoardsPage />);
    expect(await screen.findByText('Досок пока нет. Создайте первую.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Создать доску' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(`/b/${BOARD.id}`);
    });
  });

  it('deletes a board after confirmation', async () => {
    stubServer((_url, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json([BOARD]),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BoardsPage />);

    fireEvent.click(await screen.findByRole('button', { name: `Удалить доску ${BOARD.name}` }));
    await waitFor(() => {
      expect(screen.queryByText(BOARD.name)).toBeNull();
    });
  });

  it('explains when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    render(<BoardsPage />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Сервер недоступен. Попробуйте обновить страницу.',
    );
  });
});
