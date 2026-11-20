import type { Role } from '../api';

/* Ограничения форм учётных записей. Совпадают с проверками сервера в app/api/schemas.py. */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const LOGIN_MIN_LENGTH = 3;
export const LOGIN_MAX_LENGTH = 100;
/** Для атрибута pattern: браузер проверяет его с флагом v, где дефис в классе экранируется. */
export const LOGIN_PATTERN = '[A-Za-z0-9._@\\-]+';
export const NAME_MAX_LENGTH = 200;

export const ROLES: readonly Role[] = ['user', 'admin'];

export const ROLE_NAMES: Record<Role, string> = {
  user: 'Пользователь',
  admin: 'Администратор',
};

export function parseRole(value: string): Role | null {
  return ROLES.find((role) => role === value) ?? null;
}
