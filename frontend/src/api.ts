export interface BoardInfo {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Ответ сервера с кодом ошибки. status позволяет отличить «не найдено» от сбоя сети. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    throw new ApiError(response.status, `${response.status} ${response.statusText}`);
  }
  return response;
}

/** Ответы сервера описаны его схемой (FastAPI + Pydantic), поэтому здесь они не перепроверяются. */
async function sendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  return (await response.json()) as T;
}

export const api = {
  listBoards: () => sendJson<BoardInfo[]>('/boards'),
  getBoard: (id: string) => sendJson<BoardInfo>(`/boards/${id}`),
  createBoard: (name: string) =>
    sendJson<BoardInfo>('/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  renameBoard: (id: string, name: string) =>
    sendJson<BoardInfo>(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteBoard: async (id: string): Promise<void> => {
    await send(`/boards/${id}`, { method: 'DELETE' });
  },
};

/** Адрес WebSocket-синхронизации на том же хосте, что и приложение. */
export function syncUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/boards`;
}
