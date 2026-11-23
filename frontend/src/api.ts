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
  /** Шаблон компании: его видят все и выбирают при создании доски. */
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * С чего начинается новая доска: с содержимого, собранного в браузере (так создаются доски
 * по встроенным шаблонам), или с копии шаблона компании. Без источника доска пустая.
 */
export type BoardSource = { content: string } | { template_id: string };

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

/** Файл, загруженный на доску. content_type определяет сервер по содержимому. */
export interface UploadedFile {
  id: string;
  name: string;
  content_type: string;
  size: number;
}

/** Кто имеет доступ к доске. Видно только тем, кто ею управляет. */
export interface BoardAccess {
  owner: Person | null;
  members: Member[];
  links: ShareLink[];
}

/** Метка на элементе: id элемента и место на нём в долях ширины и высоты. */
export interface ElementAnchor {
  id: string;
  x: number;
  y: number;
}

export interface Comment {
  id: string;
  author: Person | null;
  text: string;
  /** Упомянутые через @логин, которые могут открыть доску. */
  mentions: Person[];
  created_at: string;
  edited_at: string | null;
}

/** Обсуждение на доске. Первый комментарий — вопрос, остальные — ответы. */
export interface CommentThread {
  id: string;
  page: string;
  /** Точка страницы, где поставили метку. Метка элемента показывается на нём, пока он есть. */
  x: number;
  y: number;
  element: ElementAnchor | null;
  author: Person | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: Person | null;
  comments: Comment[];
}

export type NewThread = Pick<CommentThread, 'page' | 'x' | 'y' | 'element'> & { text: string };

export interface AppNotification {
  id: string;
  /** Упоминание или ответ в обсуждении, где пользователь участвует. */
  kind: 'mention' | 'reply';
  read: boolean;
  created_at: string;
  /** Автор комментария. */
  actor: Person | null;
  board: { id: string; name: string };
  thread_id: string;
  comment_id: string;
  /** Начало комментария. */
  excerpt: string;
}

export interface Notifications {
  unread: number;
  /** Последние уведомления, начиная с новых. */
  items: AppNotification[];
}

/** Версия доски: её содержимое в какой-то момент. Само содержимое загружается отдельно. */
export interface BoardVersion {
  id: string;
  /** У автоматических версий названия нет. */
  name: string | null;
  created_at: string;
  /** Кто сохранил версию вручную. */
  saved_by: Person | null;
  /** Кто менял доску после предыдущей версии. */
  editors: Person[];
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
  /** Тело запроса в JSON. */
  body?: unknown;
  /** Тело запроса как есть: содержимое файла. */
  content?: Blob;
  headers?: Record<string, string>;
  /** Ответ 401 здесь ожидаем (неверный пароль, вход ещё не выполнен) и не означает потерю входа. */
  signIn?: boolean;
}

async function send(
  path: string,
  { method, body, content, headers, signIn = false }: RequestOptions = {},
) {
  const init: RequestInit = { method };
  if (headers) init.headers = headers;
  if (body !== undefined) {
    init.headers = { ...headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  } else if (content !== undefined) {
    init.body = content;
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
  createBoard: (name: string, folderId: string | null = null, source?: BoardSource) =>
    sendJson<BoardInfo>('/boards', {
      method: 'POST',
      body: { name, folder_id: folderId, ...source },
    }),
  renameBoard: (id: string, name: string) =>
    sendJson<BoardInfo>(`/boards/${id}`, { method: 'PATCH', body: { name } }),
  /** null переносит доску из папки в корень. */
  moveBoard: (id: string, folderId: string | null) =>
    sendJson<BoardInfo>(`/boards/${id}`, { method: 'PATCH', body: { folder_id: folderId } }),
  deleteBoard: (id: string) => sendEmpty(`/boards/${id}`, { method: 'DELETE' }),
  /** Содержимое доски одним обновлением Yjs: по нему рисуется превью шаблона. */
  boardContent: async (id: string) =>
    new Uint8Array(await (await send(`/boards/${id}/content`)).arrayBuffer()),

  /** Шаблоны компании по названию. */
  listTemplates: () => sendJson<BoardInfo[]>('/templates'),
  /** Сохраняет копию доски шаблоном компании. */
  saveTemplate: (boardId: string, name: string) =>
    sendJson<BoardInfo>(`/boards/${boardId}/template`, { method: 'POST', body: { name } }),

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

  /**
   * Загружает файл на доску. Имя передаётся в заголовке, закодированным как часть адреса:
   * в заголовках допустима только латиница.
   */
  uploadFile: (boardId: string, content: Blob, name: string) =>
    sendJson<UploadedFile>(`/boards/${boardId}/files`, {
      method: 'POST',
      content,
      headers: { 'X-File-Name': encodeURIComponent(name) },
    }),

  /** Обсуждения доски, в том числе решённые, по времени начала. */
  listThreads: (boardId: string) => sendJson<CommentThread[]>(`/boards/${boardId}/threads`),
  createThread: (boardId: string, thread: NewThread) =>
    sendJson<CommentThread>(`/boards/${boardId}/threads`, { method: 'POST', body: thread }),
  setThreadResolved: (threadId: string, resolved: boolean) =>
    sendJson<CommentThread>(`/threads/${threadId}`, { method: 'PATCH', body: { resolved } }),
  deleteThread: (threadId: string) => sendEmpty(`/threads/${threadId}`, { method: 'DELETE' }),
  /** Ответ в обсуждении. Возвращает обсуждение целиком. */
  reply: (threadId: string, text: string) =>
    sendJson<CommentThread>(`/threads/${threadId}/comments`, { method: 'POST', body: { text } }),
  editComment: (commentId: string, text: string) =>
    sendJson<CommentThread>(`/comments/${commentId}`, { method: 'PATCH', body: { text } }),
  deleteComment: (commentId: string) => sendEmpty(`/comments/${commentId}`, { method: 'DELETE' }),
  /** Кого можно упомянуть: активные пользователи, которые могут открыть доску. */
  boardPeople: (boardId: string) => sendJson<Person[]>(`/boards/${boardId}/people`),

  notifications: () => sendJson<Notifications>('/notifications'),
  /** Отмечает прочитанными уведомления об обсуждении: его открыли. */
  readThread: (threadId: string) => sendEmpty(`/threads/${threadId}/read`, { method: 'POST' }),
  readAllNotifications: () => sendEmpty('/notifications/read-all', { method: 'POST' }),

  /** Версии доски, начиная с новых. */
  listVersions: (boardId: string) => sendJson<BoardVersion[]>(`/boards/${boardId}/versions`),
  /** Сохраняет версию с тем, что сейчас на доске. */
  saveVersion: (boardId: string, name: string) =>
    sendJson<BoardVersion>(`/boards/${boardId}/versions`, { method: 'POST', body: { name } }),
  renameVersion: (versionId: string, name: string) =>
    sendJson<BoardVersion>(`/versions/${versionId}`, { method: 'PATCH', body: { name } }),
  deleteVersion: (versionId: string) => sendEmpty(`/versions/${versionId}`, { method: 'DELETE' }),
  /** Содержимое доски в версии одним обновлением Yjs. */
  versionState: async (versionId: string): Promise<Uint8Array> =>
    new Uint8Array(await (await send(`/versions/${versionId}/state`)).arrayBuffer()),

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

/** Адрес файла доски: картинки открываются в браузере, остальное скачивается. */
export function fileUrl(boardId: string, fileId: string): string {
  return `${API_BASE}/boards/${boardId}/files/${fileId}`;
}

/** Ссылка доступа, которую можно отправить коллеге. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/s/${token}`;
}
