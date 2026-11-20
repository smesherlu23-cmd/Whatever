import { type SubmitEvent, useId, useState } from 'react';
import { api, errorText, type User } from '../api';
import { LOGIN_MAX_LENGTH, PASSWORD_MAX_LENGTH } from '../auth/accounts';
import controls from '../ui/controls.module.css';
import { ThemeToggle } from '../ui/ThemeToggle';
import styles from './LoginPage.module.css';

const SERVER_ERROR = 'Сервер недоступен. Проверьте связь и попробуйте ещё раз.';

export function LoginPage({
  notice,
  onSignedIn,
}: {
  /** Почему пользователь видит вход, например «сессия завершилась». */
  notice: string | null;
  onSignedIn: (user: User) => void;
}) {
  const titleId = useId();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.logIn(login, password));
    } catch (err) {
      setError(errorText(err, SERVER_ERROR));
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.corner}>
        <ThemeToggle />
      </div>
      <form className={styles.card} aria-labelledby={titleId} onSubmit={(e) => void submit(e)}>
        <span className={styles.logo}>Whatever</span>
        <h1 id={titleId}>Вход</h1>
        {notice && !error && <p className={controls.muted}>{notice}</p>}
        <label className={controls.field}>
          Логин
          <input
            className={controls.input}
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={LOGIN_MAX_LENGTH}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>
        <label className={controls.field}>
          Пароль
          <input
            className={controls.input}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className={controls.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={controls.primary} disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <p className={styles.hint}>Учётные записи выдаёт администратор.</p>
      </form>
    </div>
  );
}
