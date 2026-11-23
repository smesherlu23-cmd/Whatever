import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, onSignedOut, type User } from '../api';
import { NotificationsContext } from '../notifications/context';
import { NotificationStore } from '../notifications/store';
import { LoginPage } from '../pages/LoginPage';
import { navigate } from '../router';
import { type Auth, AuthContext } from './context';
import { forgetUser, rememberUser, rememberedUser } from './rememberedUser';

type State =
  | { status: 'checking' }
  | { status: 'signed-out'; notice: string | null }
  | { status: 'signed-in'; user: User };

const SESSION_ENDED = 'Сессия завершилась. Войдите снова.';
const SERVER_UNREACHABLE = 'Сервер недоступен. Проверьте связь и попробуйте войти.';

/**
 * Показывает страницу входа, пока пользователь не вошёл, а после входа — приложение.
 * Возвращает на страницу входа, когда сервер сообщает, что сессии больше нет.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'checking' });

  const signIn = useCallback((user: User) => {
    rememberUser(user);
    setState({ status: 'signed-in', user });
  }, []);

  const signOut = useCallback((notice: string | null = null) => {
    forgetUser();
    setState({ status: 'signed-out', notice });
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.me().then(
      (user) => {
        if (!cancelled) signIn(user);
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          signOut();
          return;
        }
        // Без связи с сервером работаем от имени последнего вошедшего: доски откроются
        // из локальной копии, а истёкшую сессию сервер отвергнет при подключении.
        const remembered = rememberedUser();
        if (remembered) setState({ status: 'signed-in', user: remembered });
        else setState({ status: 'signed-out', notice: SERVER_UNREACHABLE });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [signIn, signOut]);

  useEffect(
    () =>
      onSignedOut(() => {
        signOut(SESSION_ENDED);
      }),
    [signOut],
  );

  if (state.status === 'checking') return null;
  if (state.status === 'signed-out') {
    return <LoginPage notice={state.notice} onSignedIn={signIn} />;
  }
  return (
    <SignedIn user={state.user} onUpdate={signIn} onSignOut={signOut}>
      {children}
    </SignedIn>
  );
}

function SignedIn({
  user,
  onUpdate,
  onSignOut,
  children,
}: {
  user: User;
  onUpdate: (user: User) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const auth = useMemo<Auth>(
    () => ({
      user,
      logOut: async () => {
        await api.logOut();
        onSignOut();
        navigate('/');
      },
      updateUser: onUpdate,
    }),
    [user, onUpdate, onSignOut],
  );
  // Уведомления спрашиваются, пока пользователь вошёл, и забываются при выходе.
  const [notifications] = useState(() => new NotificationStore());
  useEffect(() => notifications.start(), [notifications]);
  return (
    <AuthContext value={auth}>
      <NotificationsContext value={notifications}>{children}</NotificationsContext>
    </AuthContext>
  );
}
