import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { failure, stubServer, unreachable } from '../testing/server';
import { LoginPage } from './LoginPage';

function submit(login: string, password: string) {
  fireEvent.change(screen.getByLabelText('Логин'), { target: { value: login } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
}

describe('LoginPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows why the login failed and clears the password', async () => {
    stubServer(() => failure(429, 'Слишком много попыток входа. Попробуйте позже.'));
    const onSignedIn = vi.fn();
    render(<LoginPage notice="Сессия завершилась. Войдите снова." onSignedIn={onSignedIn} />);
    expect(screen.getByText('Сессия завершилась. Войдите снова.')).toBeTruthy();

    submit('anna', 'wrong-password');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Слишком много попыток входа. Попробуйте позже.',
    );
    expect(screen.queryByText('Сессия завершилась. Войдите снова.')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Пароль').value).toBe('');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Войти' }).disabled).toBe(false);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('explains that the server is unreachable', async () => {
    unreachable();
    render(<LoginPage notice={null} onSignedIn={vi.fn()} />);
    submit('anna', 'password');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Сервер недоступен. Проверьте связь и попробуйте ещё раз.',
    );
  });
});
