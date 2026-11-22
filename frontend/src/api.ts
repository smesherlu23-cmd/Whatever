import { API_BASE, SYNC_PATH } from './config';

/** Что пользователь может делать с доской. Каждый уровень включает предыдущие. */
export type Access = 'view' | 'edit' | 'manage';

/** Право участника доски: выдаёт владелец или ссылка доступа. */
export type BoardRole = 'viewer' | 'editor';

export const canEdit = (access: Access): boolean => access !== 'view';
export const canManage = (access: Access): boolean => access === 'manage';

/** Пользователь глазами коллег: владелец доски, участник, кандидат в участники. */
export interface Person {
  id: string;
  login: string;
  name: string;
}

export interface BoardInfo {
  id: string;
  name: string;
  owner: Person | null;
  /** Папка в списке владельца; у чужих досок всегда null. */
  folder_id: string | null;
  access: Access;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface Member {
  user: Person;
  role: BoardRole;
}

export interface ShareLink {
  token: string;
  role: BoardRole;
  created_at: string;
  expires_at: string | null;
}

/** Кто имеет доступ к доске. Видно только тем, кто ею управляет. */
export interface BoardAccess {
  owner: Person | null;
  members: Member[];
  links: ShareLink[];
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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
  const response = await fetch(`${API_BASE}${path}`, init);
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

  /** Свои доски и те, к которым дали доступ. */
  listBoards: () => sendJson<BoardInfo[]>('/boards'),
  /** Все доски сервера, только для администратора. */
  listAllBoards: () => sendJson<BoardInfo[]>('/boards?all=true'),
  getBoard: (id: string) => sendJson<BoardInfo>(`/boards/${id}`),
  createBoard: (name: string, folderId: string | null = null) =>
    sendJson<BoardInfo>('/boards', { method: 'POST', body: { name, folder_id: folderId } }),
  renameBoard: (id: string, name: string) =>
    sendJson<BoardInfo>(`/boards/${id}`, { method: 'PATCH', body: { name } }),
  /** null переносит доску из папки в корень. */
  moveBoard: (id: string, folderId: string | null) =>
    sendJson<BoardInfo>(`/boards/${id}`, { method: 'PATCH', body: { folder_id: folderId } }),
  deleteBoard: (id: string) => sendEmpty(`/boards/${id}`, { method: 'DELETE' }),

  listFolders: () => sendJson<Folder[]>('/folders'),
  createFolder: (name: string, parentId: string | null) =>
    sendJson<Folder>('/folders', { method: 'POST', body: { name, parent_id: parentId } }),
  renameFolder: (id: string, name: string) =>
    sendJson<Folder>(`/folders/${id}`, { method: 'PATCH', body: { name } }),
  /** Доски и вложенные папки поднимаются на уровень выше. */
  deleteFolder: (id: string) => sendEmpty(`/folders/${id}`, { method: 'DELETE' }),

  getAccess: (boardId: string) => sendJson<BoardAccess>(`/boards/${boardId}/access`),
  setMember: (boardId: string, userId: string, role: BoardRole) =>
    sendJson<Member>(`/boards/${boardId}/members/${userId}`, { method: 'PUT', body: { role } }),
  removeMember: (boardId: string, userId: string) =>
    sendEmpty(`/boards/${boardId}/members/${userId}`, { method: 'DELETE' }),
  createLink: (boardId: string, role: BoardRole, expiresInDays: number | null) =>
    sendJson<ShareLink>(`/boards/${boardId}/links`, {
      method: 'POST',
      body: { role, expires_in_days: expiresInDays },
    }),
  deleteLink: (boardId: string, token: string) =>
    sendEmpty(`/boards/${boardId}/links/${token}`, { method: 'DELETE' }),
  /** Выдаёт доступ по ссылке и возвращает доску. */
  joinLink: (token: string) => sendJson<BoardInfo>(`/links/${token}/join`, { method: 'POST' }),
  /** Активные пользователи, с которыми можно поделиться доской. */
  listPeople: () => sendJson<Person[]>('/users'),

  listUsers: () => sendJson<User[]>('/admin/users'),
  createUser: (user: NewUser) => sendJson<User>('/admin/users', { method: 'POST', body: user }),
  updateUser: (id: string, changes: UserChanges) =>
    sendJson<User>(`/admin/users/${id}`, { method: 'PATCH', body: changes }),
};

/** Адрес WebSocket-синхронизации на том же хосте, что и приложение. */
export function syncUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${SYNC_PATH}`;
}

/** Ссылка доступа, которую можно отправить коллеге. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/s/${token}`;
}
