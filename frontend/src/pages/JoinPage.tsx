import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { navigate } from '../router';
import controls from '../ui/controls.module.css';
import { MessagePage, NotFoundPage } from './NotFoundPage';

/**
 * Ссылка доступа «/s/<токен>». Сюда попадают уже после входа: сервер выдаёт доступ,
 * и страница сразу открывает доску, не оставляя себя в истории браузера.
 */
export function JoinPage({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.joinLink(token).then(
      (board) => {
        if (!cancelled) navigate(`/b/${board.id}`, { replace: true });
      },
      (err: unknown) => {
        if (!cancelled) setError(errorText(err, 'Не удалось открыть ссылку. Проверьте связь.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) return <NotFoundPage message={error} />;
  return (
    <MessagePage>
      <p className={controls.muted}>Открываем доску…</p>
    </MessagePage>
  );
}
