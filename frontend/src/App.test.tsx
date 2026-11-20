import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { Editor } from './editor/Editor';
import { BoardView } from './pages/BoardView';
import { boardIdFromPath } from './router';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('lists boards from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json([
            { id: '1', name: 'Схема сервисов', created_at: '2026-11-20', updated_at: '2026-11-20' },
          ]),
        ),
      ),
    );
    render(<App />);
    expect(await screen.findByText('Схема сервисов')).toBeTruthy();
  });

  it('switches the active tool on a board', () => {
    render(<BoardView editor={new Editor()} header={null} />);
    const rectangle = screen.getByRole('button', { name: 'Прямоугольник' });
    fireEvent.click(rectangle);
    expect(rectangle.getAttribute('aria-pressed')).toBe('true');
  });

  it('reads the board id from the address', () => {
    expect(boardIdFromPath('/b/0b7d2d4e-1c2a-4c49-9d6f-1f2e3d4c5b6a')).toBe(
      '0b7d2d4e-1c2a-4c49-9d6f-1f2e3d4c5b6a',
    );
    expect(boardIdFromPath('/')).toBeNull();
  });
});
