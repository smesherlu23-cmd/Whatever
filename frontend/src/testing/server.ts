import { vi } from 'vitest';

export type Handler = (method: string, path: string, body: unknown) => Response;

/** Подменяет fetch: обработчик получает метод, путь без /api и разобранное тело запроса. */
export function stubServer(handler: Handler) {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return Promise.resolve(handler(init?.method ?? 'GET', url.replace(/^\/api/, ''), body));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Ошибка в том виде, в каком её отдаёт FastAPI. */
export function failure(status: number, detail: unknown): Response {
  return Response.json({ detail }, { status });
}

export function unreachable() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  );
}
