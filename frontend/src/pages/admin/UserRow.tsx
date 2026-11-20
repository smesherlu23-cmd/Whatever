import { type SubmitEvent, useState } from 'react';
import type { User, UserChanges } from '../../api';
import {
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROLES,
  ROLE_NAMES,
  parseRole,
} from '../../auth/accounts';
import controls from '../../ui/controls.module.css';
import admin from './admin.module.css';

/** Сохраняет изменения и сообщает, удалось ли. Ошибку показывает страница. */
type Save = (changes: UserChanges) => Promise<boolean>;

/** Строка таблицы пользователей. Себя администратор не может заблокировать или понизить. */
export function UserRow({ user, isMe, onSave }: { user: User; isMe: boolean; onSave: Save }) {
  const [settingPassword, setSettingPassword] = useState(false);

  const toggleActive = () => {
    if (
      user.is_active &&
      !window.confirm(
        `Заблокировать учётную запись «${user.login}»? Все её сессии сразу завершатся.`,
      )
    ) {
      return;
    }
    void onSave({ is_active: !user.is_active });
  };

  return (
    <>
      <tr className={user.is_active ? undefined : admin.blocked}>
        <td>
          {/* Ключ сбрасывает черновик, когда имя сохранено или изменено в другом месте. */}
          <NameField key={user.name} user={user} onSave={onSave} />
        </td>
        <td>
          {user.login}
          {isMe && <span className={admin.badge}>это вы</span>}
        </td>
        <td>
          <select
            className={admin.role}
            aria-label={`Роль ${user.login}`}
            value={user.role}
            disabled={isMe}
            onChange={(e) => {
              const role = parseRole(e.target.value);
              if (role) void onSave({ role });
            }}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_NAMES[role]}
              </option>
            ))}
          </select>
        </td>
        <td>{user.is_active ? 'Активна' : 'Заблокирована'}</td>
        <td className={admin.actions}>
          <button
            type="button"
            className={controls.ghost}
            aria-label={`Новый пароль для ${user.login}`}
            aria-expanded={settingPassword}
            onClick={() => setSettingPassword(!settingPassword)}
          >
            Новый пароль
          </button>
          <button
            type="button"
            className={controls.ghost}
            aria-label={`${user.is_active ? 'Заблокировать' : 'Разблокировать'} ${user.login}`}
            disabled={isMe}
            onClick={toggleActive}
          >
            {user.is_active ? 'Заблокировать' : 'Разблокировать'}
          </button>
        </td>
      </tr>
      {settingPassword && (
        <tr>
          <td colSpan={5}>
            <PasswordForm
              user={user}
              onSave={onSave}
              onClose={() => {
                setSettingPassword(false);
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** Имя правится прямо в таблице и сохраняется, когда поле теряет фокус или нажат Enter. */
function NameField({ user, onSave }: { user: User; onSave: Save }) {
  const [draft, setDraft] = useState(user.name);

  const commit = async () => {
    const name = draft.trim();
    if (!name || name === user.name || !(await onSave({ name }))) setDraft(user.name);
  };

  return (
    <input
      className={admin.name}
      aria-label={`Имя ${user.login}`}
      maxLength={NAME_MAX_LENGTH}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(user.name);
      }}
    />
  );
}

function PasswordForm({
  user,
  onSave,
  onClose,
}: {
  user: User;
  onSave: Save;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    if (await onSave({ password })) onClose();
    else setBusy(false);
  };

  return (
    <form
      className={admin.passwordForm}
      aria-label={`Новый пароль для ${user.login}`}
      onSubmit={(e) => void submit(e)}
    >
      <label className={controls.field}>
        Новый пароль для «{user.login}», не короче {PASSWORD_MIN_LENGTH} символов
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
      <button type="submit" className={controls.primary} disabled={busy}>
        Сохранить
      </button>
      <button type="button" className={controls.secondary} onClick={onClose}>
        Отмена
      </button>
    </form>
  );
}
