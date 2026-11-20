export interface BoardInfo {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export type Role = 'admin' | 'user';

export interface User {
  id: string;
  login: string;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface NewUser {
  login: string;
  name: string;
  password: string;
  role: Role;
}

/** Изменяются только переданные поля. */
export type UserChanges = Partial<Pick<User, 'name' | 'role' | 'is_active'>> & {
  password?: string;
};

/**
 * Ответ сервера с кодом ошибки. status позволяет отличить «не найдено» от сбоя сети,
 * а detail — готовое для пользователя объяснение от сервера, если оно есть.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | null,
    statusText: string,
  ) {
    super(detail ?? `${status} ${statusText}`);
    this.name = 'ApiError';
  }
}

/** Текст ошибки для пользователя: объяснение сервера, а если его нет — запасной вариант. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.detail ? error.detail : fallback;
}

const signedOutListeners = new Set<() => void>();

/**
 * Подписка на потерю входа: сессия истекла, завершена с другого устройства
 * или учётную запись заблокировали. Об этом сообщают и HTTP-запросы, и синхронизация доски.
 */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}

export function reportSignedOut(): void {
  for (const listener of signedOutListeners) listener();
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Ответ 401 здесь ожидаем (неверный пароль, вход ещё не выполнен) и не означает потерю входа. */
  signIn?: boolean;
}

async function send(path: string, { method, body, signIn = false }: RequestOptions = {}) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    if (response.status === 401 && !signIn) reportSignedOut();
    throw new ApiError(response.status, await readDetail(response), response.statusText);
  }
  return response;
}

/** FastAPI кладёт объяснение ошибки в поле detail. У ошибок валидации это список, а не текст. */
async function readDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'detail' in body) {
      return typeof body.detail === 'string' ? body.detail : null;
    }
  } catch {
    // Тело пустое или не JSON (например, страница ошибки прокси).
  }
  return null;
}

/** Ответы сервера описаны его схемой (FastAPI + Pydantic), поэтому здесь они не перепроверяются. */
async function sendJson<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await send(path, options);
  return (await response.json()) as T;
}

async function sendEmpty(path: string, options?: RequestOptions): Promise<void> {
  await send(path, options);
}

export const api = {
  me: () => sendJson<User>('/auth/me', { signIn: true }),
  logIn: (login: string, password: string) =>
    sendJson<User>('/auth/login', { method: 'POST', body: { login, password }, signIn: true }),
  logOut: () => sendEmpty('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    sendEmpty('/auth/password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),

  listBoards: () => sendJson<BoardInfo[]>('/boards'),
  getBoard: (id: string) => sendJson<BoardInfo>(`/boards/${id}`),
  createBoard: (name: string) => sendJson<BoardInfo>('/boards', { method: 'POST', body: { name } }),
  renameBoard: (id: string, name: string) =>
    sendJson<BoardInfo>(`/boards/${id}`, { method: 'PATCH', body: { name } }),
  deleteBoard: (id: string) => sendEmpty(`/boards/${id}`, { method: 'DELETE' }),

  listUsers: () => sendJson<User[]>('/admin/users'),
  createUser: (user: NewUser) => sendJson<User>('/admin/users', { method: 'POST', body: user }),
  updateUser: (id: string, changes: UserChanges) =>
    sendJson<User>(`/admin/users/${id}`, { method: 'PATCH', body: changes }),
};

/** Адрес WebSocket-синхронизации на том же хосте, что и приложение. */
export function syncUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/boards`;
}
