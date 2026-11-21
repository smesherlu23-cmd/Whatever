import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { Editor } from './editor/Editor';
import { BoardView } from './pages/BoardView';
import { MEMBER } from './testing/auth';
import { stubServer } from './testing/server';

const BOARD = {
  id: '1',
  name: 'Схема сервисов',
  created_at: '2026-11-20',
  updated_at: '2026-11-20',
};

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState(null, '', '/');
  });

  it('lists boards for the logged-in user', async () => {
    stubServer((_method, path) => Response.json(path === '/auth/me' ? MEMBER : [BOARD]));
    render(<App />);
    expect(await screen.findByText('Схема сервисов')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Иван Петров' })).toBeTruthy();
  });

  it.each([
    ['/account', 'Учётная запись'],
    ['/admin', 'Раздел доступен только администраторам.'],
    ['/nowhere', 'Такой страницы нет.'],
  ])('opens %s', async (path, text) => {
    window.history.pushState(null, '', path);
    stubServer(() => Response.json(MEMBER));
    render(<App />);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('switches the active tool on a board', () => {
    render(<BoardView editor={new Editor()} header={null} />);
    const rectangle = screen.getByRole('button', { name: 'Прямоугольник' });
    fireEvent.click(rectangle);
    expect(rectangle.getAttribute('aria-pressed')).toBe('true');
    expect(rectangle.getAttribute('title')).toBe('Прямоугольник (R)');
  });

  it('offers the arrow line kind while the arrow tool is active', () => {
    const editor = new Editor();
    render(<BoardView editor={editor} header={null} />);
    expect(screen.queryByRole('group', { name: 'Линия стрелки' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Стрелка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ломаная' }));
    expect(editor.arrowRoute).toBe('elbow');
    expect(screen.getByRole('button', { name: 'Ломаная' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
