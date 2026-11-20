import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from '../testing/fakeSocket';
import { BoardPage } from './BoardPage';

vi.mock('y-indexeddb', () => import('../testing/fakeSocket').then((m) => m.indexeddbStub));

const BOARD = { id: 'b1', name: 'Схема', created_at: '', updated_at: '' };

describe('BoardPage', () => {
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    fetch = vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        Response.json(
          init?.method === 'PATCH'
            ? { ...BOARD, ...(JSON.parse(init.body as string) as object) }
            : BOARD,
        ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the connection status and loads the name once online', async () => {
    render(<BoardPage boardId="b1" />);
    expect(screen.getByText('Подключение…')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      FakeSocket.last().open();
    });
    expect(screen.getByText('В сети')).toBeTruthy();
    expect(await screen.findByDisplayValue('Схема')).toBeTruthy();
  });

  it('renames the board on Enter and ignores an empty name', async () => {
    render(<BoardPage boardId="b1" />);
    act(() => {
      FakeSocket.last().open();
    });
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

  it('tells the user when the board does not exist', () => {
    render(<BoardPage boardId="b1" />);
    act(() => {
      FakeSocket.last().closeByServer(4404);
    });
    expect(screen.getByText('Доска не найдена. Возможно, её удалили.')).toBeTruthy();
  });
});
