import { useEffect, useState } from 'react';
import { type Access, ApiError, api, type BoardInfo, canEdit, canManage } from '../api';
import { useAuth } from '../auth/context';
import type { Peer } from '../collab/presence';
import { BoardSession, type ConnectionStatus } from '../collab/session';
import controls from '../ui/controls.module.css';
import { AppHeader } from './AppHeader';
import { forgetAccess, rememberAccess, rememberedAccess } from './boardAccessCache';
import { BoardView } from './BoardView';
import { NotFoundPage } from './NotFoundPage';
import styles from './pages.module.css';
import { ShareDialog } from './share/ShareDialog';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'Подключение…',
  connected: 'В сети',
  disconnected: 'Нет связи: изменения сохранятся и отправятся позже',
  'not-found': 'Доска не найдена',
  forbidden: 'Нет доступа',
};

const NO_ACCESS = 'Нет доступа к доске. Попросите владельца поделиться ею.';

export function BoardPage({ boardId }: { boardId: string }) {
  const { user } = useAuth();
  const [session] = useState(() => new BoardSession(boardId, user.name));
  const [status, setStatus] = useState<ConnectionStatus>(session.status);
  const [peers, setPeers] = useState<readonly Peer[]>([]);
  const [sharing, setSharing] = useState(false);
  const board = useBoardInfo(boardId, user.id, status === 'connected');

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

  // Пока права неизвестны (без сети и без запомненных прав), доска открывается для просмотра.
  const editable = board.access !== null && canEdit(board.access);
  useEffect(() => {
    session.editor.setReadOnly(!editable);
  }, [session, editable]);

  if (status === 'not-found') {
    return <NotFoundPage message="Доска не найдена. Возможно, её удалили." />;
  }
  if (status === 'forbidden' || board.forbidden) return <NotFoundPage message={NO_ACCESS} />;

  return (
    <>
      <BoardView
        editor={session.editor}
        presence={session.presence}
        header={
          <AppHeader
            actions={
              <>
                <ul className={styles.peers} aria-label="Участники">
                  {peers.map((peer) => (
                    <li key={peer.clientId} title={peer.name} style={{ background: peer.color }}>
                      {peer.name.slice(0, 1).toUpperCase()}
                    </li>
                  ))}
                </ul>
                {board.access && canManage(board.access) && (
                  <button
                    type="button"
                    className={controls.secondary}
                    disabled={status !== 'connected'}
                    title={status === 'connected' ? undefined : 'Доступ меняется только при связи'}
                    onClick={() => setSharing(true)}
                  >
                    Поделиться
                  </button>
                )}
              </>
            }
          >
            <BoardName
              boardId={boardId}
              saved={board.info?.name ?? ''}
              editable={editable}
              onRenamed={board.update}
            />
            <span className={styles.status} data-status={status}>
              {STATUS_TEXT[status]}
            </span>
          </AppHeader>
        }
      />
      {sharing && board.info && (
        <ShareDialog
          board={board.info}
          me={user.id}
          onClose={() => {
            setSharing(false);
          }}
        />
      )}
    </>
  );
}

interface BoardInfoState {
  info: BoardInfo | null;
  /** Права с сервера, а без связи — запомненные с прошлого раза. */
  access: Access | null;
  forbidden: boolean;
  update: (info: BoardInfo) => void;
}

/**
 * Название и права на доску. Загружаются, когда есть связь с сервером, и заново после
 * каждого переподключения: так подхватываются права, изменённые владельцем.
 */
function useBoardInfo(boardId: string, userId: string, online: boolean): BoardInfoState {
  const [info, setInfo] = useState<BoardInfo | null>(null);
  const [access, setAccess] = useState(() => rememberedAccess(userId, boardId));
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    api.getBoard(boardId).then(
      (board) => {
        if (cancelled) return;
        setInfo(board);
        setAccess(board.access);
        rememberAccess(userId, boardId, board.access);
      },
      (error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          forgetAccess(userId, boardId);
          setForbidden(true);
        }
        // Другие сбои не мешают работать с доской: сведения придут при следующем подключении.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [boardId, userId, online]);

  return { info, access, forbidden, update: setInfo };
}

/** Название доски. Переименовать её может тот, кто может её править. */
function BoardName({
  boardId,
  saved,
  editable,
  onRenamed,
}: {
  boardId: string;
  saved: string;
  editable: boolean;
  onRenamed: (board: BoardInfo) => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [shown, setShown] = useState(saved);
  // Название пришло с сервера или изменилось: поле показывает его, а не старый черновик.
  if (saved !== shown) {
    setShown(saved);
    setDraft(saved);
  }

  const rename = () => {
    const name = draft.trim();
    if (!name || name === saved) {
      setDraft(saved);
      return;
    }
    api.renameBoard(boardId, name).then(onRenamed, () => {
      setDraft(saved);
    });
  };

  return (
    <input
      className={styles.title}
      aria-label="Название доски"
      value={draft}
      readOnly={!editable}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={rename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
