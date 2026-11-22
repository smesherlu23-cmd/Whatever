import type { Access } from '../api';
import { storageKeys } from '../config';

/*
 * Права на открытые раньше доски. Без сети сервер не спросить, а открыть доску из локальной
 * копии хочется в том же режиме: зрителю — только просмотр. Права запоминаются для каждого
 * пользователя отдельно, ведь браузером могут пользоваться по очереди.
 */

const LEVELS: readonly Access[] = ['view', 'edit', 'manage'];

export function rememberAccess(userId: string, boardId: string, access: Access): void {
  localStorage.setItem(storageKeys.boardAccess(userId, boardId), access);
}

export function forgetAccess(userId: string, boardId: string): void {
  localStorage.removeItem(storageKeys.boardAccess(userId, boardId));
}

export function rememberedAccess(userId: string, boardId: string): Access | null {
  const saved = localStorage.getItem(storageKeys.boardAccess(userId, boardId));
  return LEVELS.find((level) => level === saved) ?? null;
}
