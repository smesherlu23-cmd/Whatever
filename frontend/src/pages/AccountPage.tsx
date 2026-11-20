import { type SubmitEvent, useState } from 'react';
import { api, errorText } from '../api';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, ROLE_NAMES } from '../auth/accounts';
import { useAuth } from '../auth/context';
import controls from '../ui/controls.module.css';
import { AppHeader } from './AppHeader';
import forms from './forms.module.css';
import styles from './pages.module.css';

export function AccountPage() {
  const { user } = useAuth();
  return (
    <div className={styles.app}>
      <AppHeader />
      <main className={styles.page}>
        <h1 className={forms.heading}>Учётная запись</h1>
        <dl className={forms.details}>
          <dt>Имя</dt>
          <dd>{user.name}</dd>
          <dt>Логин</dt>
          <dd>{user.login}</dd>
          <dt>Роль</dt>
          <dd>{ROLE_NAMES[user.role]}</dd>
        </dl>
        <ChangePassword />
      </main>
    </div>
  );
}

interface Result {
  ok: boolean;
  text: string;
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (next !== repeat) {
      setResult({ ok: false, text: 'Новый пароль и повтор не совпадают.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setResult({
        ok: true,
        text: 'Пароль изменён. На других устройствах нужно будет войти заново.',
      });
    } catch (err) {
      setResult({
        ok: false,
        text: errorText(err, 'Не удалось сменить пароль. Проверьте связь с сервером.'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={forms.form} onSubmit={(e) => void submit(e)}>
      <h2>Смена пароля</h2>
      <label className={controls.field}>
        Текущий пароль
        <input
          className={controls.input}
          type="password"
          autoComplete="current-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className={controls.field}>
        Новый пароль, не короче {PASSWORD_MIN_LENGTH} символов
        <input
          className={controls.input}
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label className={controls.field}>
        Повторите новый пароль
        <input
          className={controls.input}
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>
      {result && (
        <p
          className={result.ok ? controls.success : controls.error}
          role={result.ok ? 'status' : 'alert'}
        >
          {result.text}
        </p>
      )}
      <div>
        <button type="submit" className={controls.primary} disabled={busy}>
          Сменить пароль
        </button>
      </div>
    </form>
  );
}
