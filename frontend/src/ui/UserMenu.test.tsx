import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN, MEMBER, signedIn, withAuth } from '../testing/auth';
import { UserMenu } from './UserMenu';

function open(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('UserMenu', () => {
  it('shows the account and, for administrators, the user list', () => {
    render(withAuth(<UserMenu />, signedIn(ADMIN)));
    open('Анна Смирнова');
    expect(screen.getByText('anna · Администратор')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Учётная запись' }).getAttribute('href')).toBe(
      '/account',
    );
    expect(screen.getByRole('link', { name: 'Пользователи' }).getAttribute('href')).toBe('/admin');
  });

  it('hides the user list from regular users', () => {
    render(withAuth(<UserMenu />, signedIn(MEMBER)));
    open('Иван Петров');
    expect(screen.queryByRole('link', { name: 'Пользователи' })).toBeNull();
  });

  it('closes on Escape, on a click elsewhere and after choosing an item', () => {
    render(withAuth(<UserMenu />));
    const trigger = screen.getByRole('button', { name: 'Анна Смирнова' });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText('anna · Администратор'));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('link', { name: 'Учётная запись' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(window.location.pathname).toBe('/account');
    window.history.pushState(null, '', '/');
  });

  it('logs out, and says so when the server cannot be reached', async () => {
    const logOut = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    render(withAuth(<UserMenu />, signedIn(ADMIN, { logOut })));
    open('Анна Смирнова');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(logOut).toHaveBeenCalledOnce();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось выйти: нет связи с сервером.',
    );
  });
});
