import { useEffect, useState } from 'react';
import { api, type BoardInfo } from '../api';
import { navigate } from '../router';
import controls from '../ui/controls.module.css';
import { Link } from '../ui/Link';
import { AppHeader } from './AppHeader';
import styles from './pages.module.css';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

export function BoardsPage() {
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listBoards()
      .then((list) => {
        if (!cancelled) setBoards(list);
      })
      .catch(() => {
        if (!cancelled) setError('Сервер недоступен. Попробуйте обновить страницу.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    try {
      const board = await api.createBoard('Новая доска');
      navigate(`/b/${board.id}`);
    } catch {
      setError('Не удалось создать доску. Проверьте связь с сервером.');
    }
  };

  const remove = async (board: BoardInfo) => {
    if (!window.confirm(`Удалить доску «${board.name}»? Это нельзя отменить.`)) return;
    try {
      await api.deleteBoard(board.id);
      setBoards((list) => list?.filter((item) => item.id !== board.id) ?? null);
    } catch {
      setError(`Не удалось удалить доску «${board.name}». Проверьте связь с сервером.`);
    }
  };

  return (
    <div className={styles.app}>
      <AppHeader />
      <main className={styles.page}>
        <div className={styles.listHeader}>
          <h1>Доски</h1>
          <button type="button" className={controls.primary} onClick={() => void create()}>
            Создать доску
          </button>
        </div>
        {error && (
          <p className={controls.error} role="alert">
            {error}
          </p>
        )}
        {boards?.length === 0 && <p className={controls.muted}>Досок пока нет. Создайте первую.</p>}
        <ul className={styles.boards}>
          {boards?.map((board) => (
            <li key={board.id}>
              <Link to={`/b/${board.id}`}>
                <span className={styles.boardName}>{board.name}</span>
                <span className={controls.muted}>
                  изменена {dateFormat.format(new Date(board.updated_at))}
                </span>
              </Link>
              <button
                type="button"
                className={controls.ghost}
                aria-label={`Удалить доску ${board.name}`}
                onClick={() => void remove(board)}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
