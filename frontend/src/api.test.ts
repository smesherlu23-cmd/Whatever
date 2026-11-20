import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorText, onSignedOut, syncUrl } from './api';
import { defined } from './testing/helpers';
import { failure, stubServer } from './testing/server';

function stubFetch(response: Response) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the request to fail');
    },
    (error: unknown) => error,
  );
}

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends JSON and returns the parsed response', async () => {
    const fetch = stubFetch(Response.json({ id: '1', name: 'Схема' }));
    await expect(api.renameBoard('1', 'Схема')).resolves.toMatchObject({ name: 'Схема' });
    const [url, init] = defined(fetch.mock.calls[0]);
    expect(url).toBe('/api/boards/1');
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe('{"name":"Схема"}');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('turns an error status into ApiError', async () => {
    stubFetch(new Response(null, { status: 404, statusText: 'Not Found' }));
    const error = await rejection(api.getBoard('missing'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, detail: null, message: '404 Not Found' });
  });

  it('keeps the explanation from the server for the user', async () => {
    stubServer(() => failure(409, 'Такой логин уже занят'));
    const error = await rejection(
      api.createUser({ login: 'ivan', name: 'Иван', password: 'long-password', role: 'user' }),
    );
    expect(errorText(error, 'запасной текст')).toBe('Такой логин уже занят');
  });

  it('falls back to its own text when the server gives no explanation', async () => {
    stubServer(() => failure(422, [{ loc: ['body', 'login'], msg: 'too short' }]));
    const error = await rejection(api.updateUser('1', { name: '' }));
    expect(errorText(error, 'Проверьте поля')).toBe('Проверьте поля');
    expect(errorText(new TypeError('Failed to fetch'), 'Нет связи')).toBe('Нет связи');
  });

  it('reports a lost session, but not a wrong password', async () => {
    const listener = vi.fn();
    const stop = onSignedOut(listener);
    stubServer(() => failure(401, 'Неверный логин или пароль'));

    await rejection(api.logIn('anna', 'wrong'));
    await rejection(api.me());
    expect(listener).not.toHaveBeenCalled();

    await rejection(api.listBoards());
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });

  it('accepts an empty response', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api.deleteBoard('1')).resolves.toBeUndefined();
  });

  it('builds the sync address from the page address', () => {
    expect(syncUrl()).toBe(`ws://${window.location.host}/ws/boards`);
  });
});
