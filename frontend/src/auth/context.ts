import { createContext, useContext } from 'react';
import type { User } from '../api';

export interface Auth {
  user: User;
  /** Завершает сессию на сервере. Если сервер недоступен, вход сохраняется, а промис отклоняется. */
  logOut: () => Promise<void>;
  /** Обновляет данные вошедшего пользователя, например после смены своего имени. */
  updateUser: (user: User) => void;
}

export const AuthContext = createContext<Auth | null>(null);

/** Вошедший пользователь. Доступен на всех страницах внутри AuthGate. */
export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth используется вне AuthGate');
  return auth;
}
