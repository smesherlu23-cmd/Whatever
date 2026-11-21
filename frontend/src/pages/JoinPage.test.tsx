import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withAuth } from '../testing/auth';
import { failure, stubServer } from '../testing/server';
import { JoinPage } from './JoinPage';

describe('JoinPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState(null, '', '/');
  });

  it('opens the board in place of the link', async () => {
    window.history.pushState(null, '', '/s/token-token-token-1');
    const steps = window.history.length;
    const fetch = stubServer(() => Response.json({ id: 'b1' }));
    render(withAuth(<JoinPage token="token-token-token-1" />));
    expect(screen.getByText('Открываем доску…')).toBeTruthy();

    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/b1');
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/links/token-token-token-1/join',
      expect.objectContaining({ method: 'POST' }),
    );
    // Ссылка заменена доской, а не добавлена в историю: «Назад» не ведёт на неё снова.
    expect(window.history.length).toBe(steps);
  });

  it('explains why the link does not work', async () => {
    stubServer(() =>
      failure(410, 'Срок действия ссылки истёк. Попросите владельца прислать новую.'),
    );
    render(withAuth(<JoinPage token="token-token-token-1" />));
    expect(
      await screen.findByText('Срок действия ссылки истёк. Попросите владельца прислать новую.'),
    ).toBeTruthy();
  });
});
