import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEMBER, signedIn, withAuth } from '../testing/auth';
import { failure, stubServer } from '../testing/server';
import { AccountPage } from './AccountPage';

function fill(current: string, next: string, repeat: string) {
  fireEvent.change(screen.getByLabelText('Текущий пароль'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^Новый пароль/), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Повторите новый пароль'), { target: { value: repeat } });
  fireEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }));
}

describe('AccountPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows who is logged in', () => {
    render(withAuth(<AccountPage />, signedIn(MEMBER)));
    expect(screen.getByRole('heading', { name: 'Учётная запись' })).toBeTruthy();
    expect(screen.getByText('ivan')).toBeTruthy();
    expect(screen.getByText('Пользователь')).toBeTruthy();
  });

  it('checks the repeated password before asking the server', () => {
    const fetch = stubServer(() => new Response(null, { status: 204 }));
    render(withAuth(<AccountPage />));
    fill('old-password', 'new-password', 'new-passwort');
    expect(screen.getByRole('alert').textContent).toBe('Новый пароль и повтор не совпадают.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('changes the password and clears the form', async () => {
    const fetch = stubServer((_method, _path, body) => {
      expect(body).toEqual({ current_password: 'old-password', new_password: 'new-password' });
      return new Response(null, { status: 204 });
    });
    render(withAuth(<AccountPage />));
    fill('old-password', 'new-password', 'new-password');

    expect((await screen.findByRole('status')).textContent).toBe(
      'Пароль изменён. На других устройствах нужно будет войти заново.',
    );
    expect(fetch).toHaveBeenCalledWith('/api/auth/password', expect.anything());
    expect(screen.getByLabelText<HTMLInputElement>('Текущий пароль').value).toBe('');
  });

  it('shows why the server refused', async () => {
    stubServer(() => failure(400, 'Текущий пароль указан неверно'));
    render(withAuth(<AccountPage />));
    fill('wrong-password', 'new-password', 'new-password');
    expect((await screen.findByRole('alert')).textContent).toBe('Текущий пароль указан неверно');
  });
});
