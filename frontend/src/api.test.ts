import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, syncUrl } from './api';
import { defined } from './testing/helpers';

function stubFetch(response: Response) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
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
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('turns an error status into ApiError', async () => {
    stubFetch(new Response(null, { status: 404, statusText: 'Not Found' }));
    const error: unknown = await api.getBoard('missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it('accepts an empty response on delete', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api.deleteBoard('1')).resolves.toBeUndefined();
  });

  it('builds the sync address from the page address', () => {
    expect(syncUrl()).toBe(`ws://${window.location.host}/ws/boards`);
  });
});
