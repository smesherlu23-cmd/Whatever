import { useEffect, useState } from 'react';
import { api, errorText, type User, type UserChanges } from '../api';
import { useAuth } from '../auth/context';
import controls from '../ui/controls.module.css';
import { NewUserForm } from './admin/NewUserForm';
import { UserRow } from './admin/UserRow';
import admin from './admin/admin.module.css';
import { AppHeader } from './AppHeader';
import styles from './pages.module.css';

export function AdminPage() {
  const { user } = useAuth();
  return (
    <div className={styles.app}>
      <AppHeader />
      <main className={admin.page}>
        {user.role === 'admin' ? (
          <UsersAdmin />
        ) : (
          <p className={controls.muted}>Раздел доступен только администраторам.</p>
        )}
      </main>
    </div>
  );
}

interface Message {
  ok: boolean;
  text: string;
}

const byLogin = (a: User, b: User) => a.login.localeCompare(b.login);

/** Что сообщить после сохранения. Смена имени и роли видна в таблице и без сообщения. */
function savedText(user: User, changes: UserChanges): string | null {
  if (changes.password !== undefined) {
    return `Пароль «${user.login}» изменён, все сессии этой учётной записи завершены.`;
  }
  if (changes.is_active === false) {
    return `Учётная запись «${user.login}» заблокирована, все её сессии завершены.`;
  }
  if (changes.is_active === true) return `Учётная запись «${user.login}» снова активна.`;
  return null;
}

function UsersAdmin() {
  const { user: me, updateUser: updateMe } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listUsers()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMessage({ ok: false, text: errorText(err, 'Не удалось загрузить пользователей.') });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (user: User, changes: UserChanges): Promise<boolean> => {
    try {
      const updated = await api.updateUser(user.id, changes);
      setUsers((list) => list?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
      if (updated.id === me.id) updateMe(updated);
      const text = savedText(updated, changes);
      setMessage(text ? { ok: true, text } : null);
      return true;
    } catch (err) {
      setMessage({
        ok: false,
        text: errorText(err, 'Не удалось сохранить изменения. Проверьте связь с сервером.'),
      });
      return false;
    }
  };

  const created = (user: User) => {
    setUsers((list) => [...(list ?? []), user].sort(byLogin));
    setAdding(false);
    setMessage({ ok: true, text: `Учётная запись «${user.login}» создана.` });
  };

  return (
    <>
      <div className={styles.listHeader}>
        <h1>Пользователи</h1>
        {!adding && (
          <button type="button" className={controls.primary} onClick={() => setAdding(true)}>
            Добавить пользователя
          </button>
        )}
      </div>
      {adding && (
        <NewUserForm
          onCreated={created}
          onCancel={() => {
            setAdding(false);
          }}
        />
      )}
      {message && (
        <p
          className={`${admin.message} ${message.ok ? controls.success : controls.error}`}
          role={message.ok ? 'status' : 'alert'}
        >
          {message.text}
        </p>
      )}
      {users && (
        <table className={admin.table}>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Логин</th>
              <th>Роль</th>
              <th>Состояние</th>
              <th>
                <span className={admin.visuallyHidden}>Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isMe={user.id === me.id}
                onSave={(changes) => save(user, changes)}
              />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
