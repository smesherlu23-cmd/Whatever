import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/context';
import type { Peer } from '../collab/presence';
import { BoardSession, type ConnectionStatus } from '../collab/session';
import { AppHeader } from './AppHeader';
import { BoardView } from './BoardView';
import { NotFoundPage } from './NotFoundPage';
import styles from './pages.module.css';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'Подключение…',
  connected: 'В сети',
  disconnected: 'Нет связи: изменения сохранятся и отправятся позже',
  'not-found': 'Доска не найдена',
};

export function BoardPage({ boardId }: { boardId: string }) {
  const { user } = useAuth();
  const [session] = useState(() => new BoardSession(boardId, user.name));
  const [status, setStatus] = useState<ConnectionStatus>(session.status);
  const [peers, setPeers] = useState<readonly Peer[]>([]);

  useEffect(() => {
    const stop = session.start();
    const offStatus = session.subscribe(() => {
      setStatus(session.status);
    });
    const offPeers = session.presence.subscribe(() => {
      setPeers(session.presence.peers());
    });
    return () => {
      offStatus();
      offPeers();
      stop();
    };
  }, [session]);

  useEffect(() => {
    session.presence.setUser(user.name);
  }, [session, user.name]);

  if (status === 'not-found') {
    return <NotFoundPage message="Доска не найдена. Возможно, её удалили." />;
  }

  return (
    <BoardView
      editor={session.editor}
      presence={session.presence}
      header={
        <AppHeader
          actions={
            <ul className={styles.peers} aria-label="Участники">
              {peers.map((peer) => (
                <li key={peer.clientId} title={peer.name} style={{ background: peer.color }}>
                  {peer.name.slice(0, 1).toUpperCase()}
                </li>
              ))}
            </ul>
          }
        >
          <BoardName boardId={boardId} online={status === 'connected'} />
          <span className={styles.status} data-status={status}>
            {STATUS_TEXT[status]}
          </span>
        </AppHeader>
      }
    />
  );
}

/**
 * Название доски с переименованием. Загружается, когда есть связь с сервером:
 * без сети доска открывается из локальной копии, а название подтянется после подключения.
 */
function BoardName({ boardId, online }: { boardId: string; online: boolean }) {
  const [saved, setSaved] = useState('');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    api
      .getBoard(boardId)
      .then((board) => {
        if (cancelled) return;
        setSaved(board.name);
        setDraft(board.name);
      })
      .catch(() => {
        // Название не критично для работы с доской: поле останется пустым до следующей попытки.
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, online]);

  const rename = () => {
    const name = draft.trim();
    if (!name || name === saved) {
      setDraft(saved);
      return;
    }
    api
      .renameBoard(boardId, name)
      .then((board) => {
        setSaved(board.name);
        setDraft(board.name);
      })
      .catch(() => {
        setDraft(saved);
      });
  };

  return (
    <input
      className={styles.title}
      aria-label="Название доски"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={rename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
