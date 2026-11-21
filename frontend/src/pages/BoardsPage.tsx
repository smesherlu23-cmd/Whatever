import { useEffect, useState } from 'react';
import { api, type BoardInfo } from '../api';
import { useAuth } from '../auth/context';
import { type BoardsView, boardsPath } from '../router';
import controls from '../ui/controls.module.css';
import { Link } from '../ui/Link';
import { AppHeader } from './AppHeader';
import list from './boards/boards.module.css';
import { ACCESS_TEXT, BoardRow, confirmAndDelete } from './boards/BoardRow';
import { MyBoards } from './boards/MyBoards';
import styles from './pages.module.css';

const UNREACHABLE = 'Сервер недоступен. Попробуйте обновить страницу.';

/** Список досок: свои по папкам, доступные от коллег и, для администратора, все. */
export function BoardsPage({ view }: { view: BoardsView }) {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  return (
    <div className={styles.app}>
      <AppHeader />
      <main className={styles.page}>
        <nav className={list.tabs} aria-label="Разделы досок">
          <Tab to={boardsPath({ view: 'mine', folderId: null })} current={view.view === 'mine'}>
            Мои доски
          </Tab>
          <Tab to={boardsPath({ view: 'shared' })} current={view.view === 'shared'}>
            Доступные мне
          </Tab>
          {admin && (
            <Tab to={boardsPath({ view: 'all' })} current={view.view === 'all'}>
              Все доски
            </Tab>
          )}
        </nav>
        {view.view === 'mine' && <MyBoards folderId={view.folderId} />}
        {view.view === 'shared' && <SharedBoards />}
        {view.view === 'all' &&
          (admin ? (
            <AllBoards />
          ) : (
            <p className={controls.muted}>Раздел доступен только администраторам.</p>
          ))}
      </main>
    </div>
  );
}

function Tab({ to, current, children }: { to: string; current: boolean; children: string }) {
  return (
    <Link to={to} className={list.tab} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}

/** Загружает список досок при открытии раздела. load — постоянная функция из api. */
function useBoards(load: () => Promise<BoardInfo[]>) {
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (loaded) => {
        if (!cancelled) setBoards(loaded);
      },
      () => {
        if (!cancelled) setError(UNREACHABLE);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load]);
  return { boards, setBoards, error, setError };
}

/** Чужие доски, к которым пользователю дали доступ. */
function SharedBoards() {
  const { user } = useAuth();
  const { boards, error } = useBoards(api.listBoards);
  const shared = boards?.filter((board) => board.owner?.id !== user.id);
  return (
    <>
      <div className={styles.listHeader}>
        <h1>Доступные мне</h1>
      </div>
      {error && (
        <p className={controls.error} role="alert">
          {error}
        </p>
      )}
      {shared?.length === 0 && (
        <p className={controls.muted}>
          С вами пока не поделились досками. Попросите коллегу добавить вас или прислать ссылку.
        </p>
      )}
      {shared && shared.length > 0 && (
        <ul className={styles.boards}>
          {shared.map((board) => (
            <BoardRow
              key={board.id}
              board={board}
              details={[`владелец ${board.owner?.name ?? 'не указан'}`, ACCESS_TEXT[board.access]]}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** Все доски сервера: администратор находит и удаляет любую. */
function AllBoards() {
  const { boards, setBoards, error, setError } = useBoards(api.listAllBoards);
  const remove = async (board: BoardInfo) => {
    if (await confirmAndDelete(board, setError)) {
      setBoards((all) => all?.filter((b) => b.id !== board.id) ?? null);
    }
  };
  return (
    <>
      <div className={styles.listHeader}>
        <h1>Все доски</h1>
      </div>
      {error && (
        <p className={controls.error} role="alert">
          {error}
        </p>
      )}
      {boards?.length === 0 && <p className={controls.muted}>На сервере пока нет досок.</p>}
      {boards && boards.length > 0 && (
        <ul className={styles.boards}>
          {boards.map((board) => (
            <BoardRow
              key={board.id}
              board={board}
              details={[`владелец ${board.owner?.name ?? 'не указан'}`]}
            >
              <button
                type="button"
                className={controls.ghost}
                aria-label={`Удалить доску ${board.name}`}
                onClick={() => void remove(board)}
              >
                Удалить
              </button>
            </BoardRow>
          ))}
        </ul>
      )}
    </>
  );
}
