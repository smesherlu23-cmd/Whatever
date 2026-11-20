import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { User } from '../api';
import { type Auth, AuthContext } from '../auth/context';

export const ADMIN: User = {
  id: 'u-anna',
  login: 'anna',
  name: 'Анна Смирнова',
  role: 'admin',
  is_active: true,
  created_at: '2026-11-20T10:00:00Z',
};

export const MEMBER: User = {
  id: 'u-ivan',
  login: 'ivan',
  name: 'Иван Петров',
  role: 'user',
  is_active: true,
  created_at: '2026-11-20T10:00:00Z',
};

/** Вошедший пользователь для страниц, которые тест отрисовывает без AuthGate. */
export function signedIn(user: User = ADMIN, overrides: Partial<Auth> = {}): Auth {
  return {
    user,
    logOut: vi.fn(() => Promise.resolve()),
    updateUser: vi.fn(),
    ...overrides,
  };
}

export function withAuth(ui: ReactNode, auth: Auth = signedIn()) {
  return <AuthContext value={auth}>{ui}</AuthContext>;
}
