import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Access, BoardInfo } from '../api';
import { MEMBER, signedIn, withAuth } from '../testing/auth';
import { FakeSocket } from '../testing/fakeSocket';
import { failure, stubServer } from '../testing/server';
import { rememberAccess } from './boardAccessCache';
import { BoardPage } from './BoardPage';

vi.mock('y-indexeddb', () => import('../testing/fakeSocket').then((m) => m.indexeddbStub));

function board(access: Access): BoardInfo {
  return {
    id: 'b1',
    name: 'Схема',
    owner: { id: 'u-owner', login: 'owner', name: 'Ольга' },
    folder_id: null,
    access,
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
