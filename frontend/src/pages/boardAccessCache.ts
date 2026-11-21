import type { Access } from '../api';

/*
 * Права на открытые раньше доски. Без сети сервер не спросить, а открыть доску из локальной
 * копии хочется в том же режиме: зрителю — только просмотр. Права запоминаются для каждого
 * пользователя отдельно, ведь браузером могут пользоваться по очереди.
 */

const LEVELS: readonly Access[] = ['view', 'edit', 'manage'];

const key = (userId: string, boardId: string) => `whatever-access-${userId}-${boardId}`;

export function rememberAccess(userId: string, boardId: string, access: Access): void {
  localStorage.setItem(key(userId, boardId), access);
}

export function forgetAccess(userId: string, boardId: string): void {
  localStorage.removeItem(key(userId, boardId));
}

export function rememberedAccess(userId: string, boardId: string): Access | null {
  const saved = localStorage.getItem(key(userId, boardId));
  return LEVELS.find((level) => level === saved) ?? null;
}
