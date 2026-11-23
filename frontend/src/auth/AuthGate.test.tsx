import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportSignedOut } from '../api';
import { MEMBER } from '../testing/auth';
import { failure, stubServer, unreachable } from '../testing/server';
import { AuthGate } from './AuthGate';
import { useAuth } from './context';
import { rememberUser, rememberedUser } from './rememberedUser';

function Greeting() {
  const { user, logOut } = useAuth();
  return (
    <button type="button" onClick={() => void logOut()}>
      Привет, {user.name}
    </button>
  );
}

function renderGate() {
  render(
    <AuthGate>
      <Greeting />
    </AuthGate>,
  );
}

async function logIn(login: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: login } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
}

describe('AuthGate', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState(null, '', '/');
  });

  it('asks to log in and then shows the app', async () => {
    const fetch = stubServer((_method, path, body) => {
      if (path === '/auth/me') return failure(401, 'Нужно войти в систему');
      if (path === '/notifications') return Response.json({ unread: 0, items: [] });
      expect(body).toEqual({ login: 'ivan', password: 'correct-horse' });
      return Response.json(MEMBER);
    });
    renderGate();
    await logIn('ivan', 'correct-horse');

    expect(await screen.findByText('Привет, Иван Петров')).toBeTruthy();
    // Вошедший сразу узнаёт о своих уведомлениях.
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/me',
      '/api/auth/login',
      '/api/notifications',
    ]);
    expect(rememberedUser()).toEqual(MEMBER);
  });

  it('lets a user with a live session straight in', async () => {
    stubServer(() => Response.json(MEMBER));
    renderGate();
    expect(await screen.findByText('Привет, Иван Петров')).toBeTruthy();
  });

  it('opens for the last user when the server is out of reach', async () => {
    rememberUser(MEMBER);
    unreachable();
    renderGate();
    expect(await screen.findByText('Привет, Иван Петров')).toBeTruthy();
  });

  it('treats a proxy error like an unreachable server', async () => {
    rememberUser(MEMBER);
    stubServer(() => new Response('Bad Gateway', { status: 502 }));
    renderGate();
    expect(await screen.findByText('Привет, Иван Петров')).toBeTruthy();
  });

  it('explains that the server is unreachable when nobody logged in here before', async () => {
    unreachable();
    renderGate();
    expect(
      await screen.findByText('Сервер недоступен. Проверьте связь и попробуйте войти.'),
    ).toBeTruthy();
  });

  it('forgets the user whose session has ended', async () => {
    rememberUser(MEMBER);
    stubServer(() => failure(401, 'Нужно войти в систему'));
    renderGate();
    expect(await screen.findByRole('button', { name: 'Войти' })).toBeTruthy();
    expect(rememberedUser()).toBeNull();
  });

  it('returns to the login page when the server reports a lost session', async () => {
    stubServer(() => Response.json(MEMBER));
    renderGate();
    await screen.findByText('Привет, Иван Петров');

    act(() => {
      reportSignedOut();
    });
    expect(screen.getByText('Сессия завершилась. Войдите снова.')).toBeTruthy();
    expect(screen.queryByText('Привет, Иван Петров')).toBeNull();
  });

  it('logs out and opens the board list for the next user', async () => {
    window.history.pushState(null, '', '/admin');
    const fetch = stubServer((method) =>
      method === 'POST' ? new Response(null, { status: 204 }) : Response.json(MEMBER),
    );
    renderGate();
    fireEvent.click(await screen.findByText('Привет, Иван Петров'));

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeTruthy();
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/logout', { method: 'POST' });
    expect(window.location.pathname).toBe('/');
    expect(rememberedUser()).toBeNull();
  });
});
