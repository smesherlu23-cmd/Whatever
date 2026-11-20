import { type SubmitEvent, useId, useState } from 'react';
import { api, errorText, type Role, type User } from '../../api';
import {
  LOGIN_MAX_LENGTH,
  LOGIN_MIN_LENGTH,
  LOGIN_PATTERN,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROLES,
  ROLE_NAMES,
  parseRole,
} from '../../auth/accounts';
import controls from '../../ui/controls.module.css';
import admin from './admin.module.css';

export function NewUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: (user: User) => void;
  onCancel: () => void;
}) {
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const roleId = useId();
  const [role, setRole] = useState<Role>('user');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createUser({ login, name: name.trim(), password, role }));
    } catch (err) {
      setError(errorText(err, 'Не удалось создать учётную запись. Проверьте связь с сервером.'));
      setBusy(false);
    }
  };

  return (
    <form
      className={admin.newUser}
      aria-label="Новый пользователь"
      onSubmit={(e) => void submit(e)}
    >
      <label className={controls.field}>
        Логин: латиница, цифры и знаки . _ @ -
        <input
          className={controls.input}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={LOGIN_MIN_LENGTH}
          maxLength={LOGIN_MAX_LENGTH}
          pattern={LOGIN_PATTERN}
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
      </label>
      <label className={controls.field}>
        Имя и фамилия
        <input
          className={controls.input}
          autoComplete="off"
          required
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className={controls.field}>
        Пароль, не короче {PASSWORD_MIN_LENGTH} символов
        <input
          className={controls.input}
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {/* Подпись связана через id: обёрнутый в label список добавил бы свои пункты к его имени. */}
      <div className={controls.field}>
        <label htmlFor={roleId}>Роль</label>
        <select
          id={roleId}
          className={controls.input}
          value={role}
          onChange={(e) => setRole(parseRole(e.target.value) ?? 'user')}
        >
          {ROLES.map((item) => (
            <option key={item} value={item}>
              {ROLE_NAMES[item]}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className={`${admin.wide} ${controls.error}`} role="alert">
          {error}
        </p>
      )}
      <div className={`${admin.wide} ${admin.buttons}`}>
        <button type="submit" className={controls.primary} disabled={busy}>
          Создать
        </button>
        <button type="button" className={controls.secondary} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
