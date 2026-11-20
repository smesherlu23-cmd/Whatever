import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Peer } from '../collab/presence';
import { BoardSession, type ConnectionStatus } from '../collab/session';
import { loadUserName, saveUserName } from '../collab/user';
import { Link } from '../ui/Link';
import { BoardView } from './BoardView';
import styles from './pages.module.css';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'Подключение…',
  connected: 'В сети',
  disconnected: 'Нет связи: изменения сохранятся и отправятся позже',
  'not-found': 'Доска не найдена',
};

export function BoardPage({ boardId }: { boardId: string }) {
  const [userName, setUserName] = useState(loadUserName);
  const [session] = useState(() => new BoardSession(boardId, userName));
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
    const name = userName.trim();
    if (name) session.presence.setUser(name);
  }, [session, userName]);

  if (status === 'not-found') {
    return (
      <div className={styles.page}>
        <p>Доска не найдена. Возможно, её удалили.</p>
        <Link to="/">К списку досок</Link>
      </div>
    );
  }

  const commitUserName = () => {
    const name = userName.trim();
    if (name) saveUserName(name);
    else setUserName(loadUserName());
  };

  return (
    <BoardView
      editor={session.editor}
      presence={session.presence}
      header={
        <>
          <Link className={styles.logo} to="/" title="К списку досок">
            Whatever
          </Link>
          <BoardName boardId={boardId} online={status === 'connected'} />
          <span className={styles.status} data-status={status}>
            {STATUS_TEXT[status]}
          </span>
          <span className={styles.spacer} />
          <ul className={styles.peers} aria-label="Участники">
            {peers.map((peer) => (
              <li key={peer.clientId} title={peer.name} style={{ background: peer.color }}>
                {peer.name.slice(0, 1).toUpperCase()}
              </li>
            ))}
          </ul>
          <input
            className={styles.userName}
            aria-label="Ваше имя"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            onBlur={commitUserName}
          />
        </>
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
