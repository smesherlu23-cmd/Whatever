import type { User } from '../api';
import { isRecord } from '../model/validate';

const STORAGE_KEY = 'whatever-user';

/*
 * Последний вошедший пользователь. Cookie сессии недоступна из JavaScript, поэтому без сети
 * нельзя спросить сервер, кто вошёл. С запомненным пользователем доска открывается из локальной
 * копии, а если сессия на самом деле истекла, сервер сообщит об этом при подключении.
 */

export function rememberUser(user: User): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function forgetUser(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function rememberedUser(): User | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return parseUser(JSON.parse(saved));
  } catch {
    return null;
  }
}

function parseUser(value: unknown): User | null {
  if (!isRecord(value)) return null;
  const { id, login, name, role, is_active, created_at } = value;
  if (typeof id !== 'string' || typeof login !== 'string' || typeof name !== 'string') return null;
  if (role !== 'admin' && role !== 'user') return null;
  if (typeof is_active !== 'boolean' || typeof created_at !== 'string') return null;
  return { id, login, name, role, is_active, created_at };
}
