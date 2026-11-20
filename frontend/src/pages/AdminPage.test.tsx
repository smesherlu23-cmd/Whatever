import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api';
import { ADMIN, MEMBER, signedIn, withAuth } from '../testing/auth';
import { defined } from '../testing/helpers';
import { failure, stubServer, unreachable } from '../testing/server';
import { AdminPage } from './AdminPage';

/** Сервер с пользователями ADMIN и MEMBER, который применяет изменения из PATCH. */
function stubUsers(onCreate?: (body: unknown) => Response) {
  let users: User[] = [ADMIN, MEMBER];
  return stubServer((method, path, body) => {
    if (method === 'GET') return Response.json(users);
    if (method === 'POST') return defined(onCreate)(body);
    const id = path.split('/').at(-1);
    users = users.map((user) => (user.id === id ? { ...user, ...(body as Partial<User>) } : user));
    return Response.json(users.find((user) => user.id === id));
  });
}

function memberRow() {
  return within(defined(screen.getByDisplayValue(MEMBER.name).closest('tr')));
}

describe('AdminPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is closed to regular users', () => {
    const fetch = stubUsers();
    render(withAuth(<AdminPage />, signedIn(MEMBER)));
    expect(screen.getByText('Раздел доступен только администраторам.')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lists users and protects the administrator from locking themselves out', async () => {
    stubUsers();
    render(withAuth(<AdminPage />));
    expect(await screen.findByDisplayValue(MEMBER.name)).toBeTruthy();

    const me = within(defined(screen.getByText('это вы').closest('tr')));
    expect(me.getByRole<HTMLSelectElement>('combobox').disabled).toBe(true);
    expect(me.getByRole<HTMLButtonElement>('button', { name: 'Заблокировать anna' }).disabled).toBe(
      true,
    );
  });

  it('creates a user', async () => {
    const created: User = { ...MEMBER, id: 'u-olga', login: 'olga', name: 'Ольга' };
    stubUsers((body) => {
      expect(body).toEqual({
        login: 'olga',
        name: 'Ольга',
        password: 'long-password',
        role: 'admin',
      });
      return Response.json({ ...created, role: 'admin' }, { status: 201 });
    });
    render(withAuth(<AdminPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить пользователя' }));

    const form = within(screen.getByRole('form', { name: 'Новый пользователь' }));
    fireEvent.change(form.getByLabelText(/^Логин/), { target: { value: 'olga' } });
    fireEvent.change(form.getByLabelText('Имя и фамилия'), { target: { value: ' Ольга ' } });
    fireEvent.change(form.getByLabelText(/^Пароль/), { target: { value: 'long-password' } });
    fireEvent.change(form.getByLabelText('Роль'), { target: { value: 'admin' } });
    fireEvent.click(form.getByRole('button', { name: 'Создать' }));

    expect((await screen.findByRole('status')).textContent).toBe('Учётная запись «olga» создана.');
    expect(screen.getByDisplayValue('Ольга')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Новый пользователь' })).toBeNull();
  });

  it('shows why a user could not be created', async () => {
    stubUsers(() => failure(409, 'Такой логин уже занят'));
    render(withAuth(<AdminPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить пользователя' }));
    const form = within(screen.getByRole('form', { name: 'Новый пользователь' }));
    fireEvent.submit(form.getByRole('button', { name: 'Создать' }));

    expect((await form.findByRole('alert')).textContent).toBe('Такой логин уже занят');
    fireEvent.click(form.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('form', { name: 'Новый пользователь' })).toBeNull();
  });

  it('changes the role and renames a user', async () => {
    const fetch = stubUsers();
    render(withAuth(<AdminPage />));
    await screen.findByDisplayValue(MEMBER.name);

    fireEvent.change(memberRow().getByRole('combobox'), { target: { value: 'admin' } });
    await waitFor(() => {
      expect(memberRow().getByRole<HTMLSelectElement>('combobox').value).toBe('admin');
    });

    const name = screen.getByLabelText('Имя ivan');
    fireEvent.change(name, { target: { value: 'Иван Сидоров' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.blur(name);
    expect(await screen.findByDisplayValue('Иван Сидоров')).toBeTruthy();

    // Пустое имя и Escape возвращают сохранённое значение без запроса к серверу.
    const calls = fetch.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Имя ivan'), { target: { value: '  ' } });
    fireEvent.blur(screen.getByLabelText('Имя ivan'));
    fireEvent.change(screen.getByLabelText('Имя ivan'), { target: { value: 'Черновик' } });
    fireEvent.keyDown(screen.getByLabelText('Имя ivan'), { key: 'Escape' });
    expect(screen.getByDisplayValue('Иван Сидоров')).toBeTruthy();
    expect(fetch.mock.calls).toHaveLength(calls);
  });

  it('updates the header when the administrator renames themselves', async () => {
    stubUsers();
    const auth = signedIn(ADMIN);
    render(withAuth(<AdminPage />, auth));
    const name = await screen.findByLabelText('Имя anna');
    fireEvent.change(name, { target: { value: 'Анна Иванова' } });
    fireEvent.blur(name);
    await waitFor(() => {
      expect(auth.updateUser).toHaveBeenCalledWith({ ...ADMIN, name: 'Анна Иванова' });
    });
  });

  it('blocks a user only after confirmation and unblocks them', async () => {
    const fetch = stubUsers();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(withAuth(<AdminPage />));
    await screen.findByDisplayValue(MEMBER.name);

    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать ivan' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать ivan' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Учётная запись «ivan» заблокирована, все её сессии завершены.',
    );
    expect(memberRow().getByText('Заблокирована')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Разблокировать ivan' }));
    expect(await screen.findByText('Учётная запись «ivan» снова активна.')).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('sets a new password for a user', async () => {
    stubUsers();
    render(withAuth(<AdminPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'Новый пароль для ivan' }));

    const form = within(screen.getByRole('form', { name: 'Новый пароль для ivan' }));
    fireEvent.change(form.getByLabelText(/^Новый пароль/), { target: { value: 'temporary-1' } });
    fireEvent.click(form.getByRole('button', { name: 'Сохранить' }));

    expect((await screen.findByRole('status')).textContent).toBe(
      'Пароль «ivan» изменён, все сессии этой учётной записи завершены.',
    );
    expect(screen.queryByRole('form', { name: 'Новый пароль для ivan' })).toBeNull();
  });

  it('keeps the password form open when saving fails', async () => {
    stubServer((method) =>
      method === 'GET' ? Response.json([ADMIN, MEMBER]) : failure(500, null),
    );
    render(withAuth(<AdminPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'Новый пароль для ivan' }));
    const form = within(screen.getByRole('form', { name: 'Новый пароль для ivan' }));
    fireEvent.change(form.getByLabelText(/^Новый пароль/), { target: { value: 'temporary-1' } });
    fireEvent.click(form.getByRole('button', { name: 'Сохранить' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось сохранить изменения. Проверьте связь с сервером.',
    );
    expect(form.getByRole<HTMLButtonElement>('button', { name: 'Сохранить' }).disabled).toBe(false);
    fireEvent.click(form.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('form', { name: 'Новый пароль для ivan' })).toBeNull();
  });

  it('explains when the list cannot be loaded', async () => {
    unreachable();
    render(withAuth(<AdminPage />));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось загрузить пользователей.',
    );
  });
});
