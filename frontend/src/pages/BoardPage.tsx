import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { type Access, ApiError, api, type BoardInfo, canEdit, canManage } from '../api';
import { useAuth } from '../auth/context';
import { BoardSession, type ConnectionStatus } from '../collab/session';
import { anchorAt, pinPoint } from '../comments/anchor';
import type { CommentsState } from '../comments/store';
import { isOpen } from '../comments/threads';
import { useNotificationStore } from '../notifications/context';
import { boardPath, navigate } from '../router';
import controls from '../ui/controls.module.css';
import { useSnapshot } from '../ui/useSnapshot';
import { versionPhrase } from '../versions/preview';
import { VersionViewer } from '../versions/viewer';
import { AppHeader } from './AppHeader';
import { forgetAccess, rememberAccess, rememberedAccess } from './boardAccessCache';
import { CommentPins, type DraftPin } from './board/CommentPins';
import { CommentsPanel } from './board/CommentsPanel';
import { ExportDialog } from './board/ExportDialog';
import { Participants } from './board/Participants';
import { VersionBanner } from './board/VersionBanner';
import { VersionsPanel } from './board/VersionsPanel';
import { FromTemplateDialog } from './boards/NewBoardDialog';
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

/** Боковая панель доски: обсуждения или история версий. Открыта одна из них. */
type Panel = 'discussion' | 'history';

/**
 * Страница доски. threadId — обсуждение, открытое в панели: оно берётся из адреса, поэтому
 * ссылкой на обсуждение можно поделиться, а уведомление ведёт прямо к нему.
 */
export function BoardPage({
  boardId,
  threadId = null,
}: {
  boardId: string;
  threadId?: string | null;
}) {
  const { user } = useAuth();
  const [session] = useState(() => new BoardSession(boardId, user.name));
  const [status, setStatus] = useState<ConnectionStatus>(session.status);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const board = useBoardInfo(boardId, user.id, status === 'connected');
  const [panel, setPanel] = useState<Panel | null>(threadId === null ? null : 'discussion');
  const discussion = useDiscussion(session, boardId, threadId, panel, setPanel);
  const [viewer] = useState(
    () => new VersionViewer(session.versions, session.editor, session.follow),
  );
  const viewed = useSnapshot(viewer);
  const { versions } = useSnapshot(session.versions);

  useEffect(() => {
    const stop = session.start();
    const offStatus = session.subscribe(() => {
      setStatus(session.status);
    });
    return () => {
      offStatus();
      stop();
    };
  }, [session]);

  useEffect(() => viewer.start(), [viewer]);

  useEffect(() => {
    session.presence.setUser(user.name);
  }, [session, user.name]);

  // Пока права неизвестны (без сети и без запомненных прав), доска открывается для просмотра.
  const editable = board.access !== null && canEdit(board.access);
  const manages = board.access !== null && canManage(board.access);
  useEffect(() => {
    session.editor.setReadOnly(!editable);
  }, [session, editable]);

  // Историю видят те, кто может править доску. Если права отобрали, видна снова сама доска.
  const historyOpen = panel === 'history' && editable;
  const preview = historyOpen ? viewed.preview : null;
  // Пока смотрят версию, холст, мини-карта и экспорт показывают её, а не доску.
  const shown = preview?.editor ?? session.editor;
  const openHistory = () => {
    discussion.close();
    viewer.reset();
    setPanel('history');
  };
  const closeHistory = () => {
    viewer.showCurrent();
    setPanel(null);
  };

  if (status === 'not-found') {
    return <NotFoundPage message="Доска не найдена. Возможно, её удалили." />;
  }
  if (status === 'forbidden' || board.forbidden) return <NotFoundPage message={NO_ACCESS} />;

  return (
    <>
      <BoardView
        editor={shown}
        presence={preview ? undefined : session.presence}
        follow={preview ? undefined : session.follow}
        files={session.files}
        banner={
          preview && (
            <VersionBanner
              // Название могли поменять, пока версию смотрят.
              version={versions.find((v) => v.id === preview.version.id) ?? preview.version}
              restoring={viewed.restoring}
              canRestore={editable}
              onRestore={() => void viewer.restore()}
              onBack={() => viewer.showCurrent()}
            />
          )
        }
        overlay={
          !preview && (
            <CommentPins
              editor={session.editor}
              threads={discussion.comments.threads}
              selectedId={discussion.open ? threadId : null}
              draft={discussion.draft}
              onSelect={discussion.select}
            />
          )
        }
        aside={
          historyOpen ? (
            <VersionsPanel
              store={session.versions}
              viewer={viewer}
              manages={manages}
              onClose={closeHistory}
            />
          ) : (
            discussion.open && (
              <CommentsPanel
                store={session.comments}
                comments={discussion.comments}
                editor={session.editor}
                viewer={{ id: user.id, moderates: manages }}
                selectedId={threadId}
                draft={discussion.draft}
                onSelect={discussion.select}
                onDraftDone={discussion.dropDraft}
                onClose={discussion.close}
              />
            )
          )
        }
        header={
          <AppHeader
            actions={
              <>
                <Participants
                  editor={session.editor}
                  presence={session.presence}
                  follow={session.follow}
                />
                {board.info?.is_template && (
                  <button
                    type="button"
                    className={controls.primary}
                    onClick={() => setCopying(true)}
                  >
                    Создать доску по шаблону
                  </button>
                )}
                <button
                  type="button"
                  className={controls.secondary}
                  aria-pressed={discussion.open}
                  title="Вопросы и замечания к схеме"
                  onClick={discussion.toggle}
                >
                  Обсуждения
                  {discussion.openCount > 0 && (
                    <span className={styles.counter}>{discussion.openCount}</span>
                  )}
                </button>
                {editable && (
                  <button
                    type="button"
                    className={controls.secondary}
                    aria-pressed={historyOpen}
                    title="Версии доски: посмотреть и восстановить"
                    onClick={historyOpen ? closeHistory : openHistory}
                  >
                    История
                  </button>
                )}
                <button
                  type="button"
                  className={controls.secondary}
                  title="Сохранить страницу или выделенное картинкой PNG"
                  onClick={() => setExporting(true)}
                >
                  Экспорт
                </button>
                {manages && (
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
            {board.info?.is_template && (
              <span className={styles.badge} title="Шаблон видят все сотрудники">
                Шаблон
              </span>
            )}
            <span className={styles.status} data-status={status}>
              {STATUS_TEXT[status]}
            </span>
          </AppHeader>
        }
      />
      {exporting && (
        <ExportDialog
          editor={shown}
          images={session.files.images}
          boardName={
            preview
              ? `${board.info?.name ?? 'Доска'} — версия ${versionPhrase(preview.version)}`
              : (board.info?.name ?? 'Доска')
          }
          onClose={() => {
            setExporting(false);
          }}
        />
      )}
      {copying && board.info && (
        <FromTemplateDialog
          template={board.info}
          onClose={() => {
            setCopying(false);
          }}
        />
      )}
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

interface Discussion {
  comments: CommentsState;
  /** Открыта ли панель обсуждений. */
  open: boolean;
  openCount: number;
  /** Новое обсуждение, которое пишут, пока его не отправили или не отменили. */
  draft: DraftPin | null;
  select: (threadId: string | null) => void;
  dropDraft: () => void;
  toggle: () => void;
  close: () => void;
}

/**
 * Обсуждения на доске: панель, открытое обсуждение и новое, которое пишут.
 * Открытое обсуждение хранится в адресе страницы (?thread=), какая панель открыта — у самой
 * страницы (panel), всё остальное — здесь.
 */
function useDiscussion(
  session: BoardSession,
  boardId: string,
  threadId: string | null,
  panel: Panel | null,
  setPanel: Dispatch<SetStateAction<Panel | null>>,
): Discussion {
  const { editor } = session;
  const open = panel === 'discussion';
  const comments = useSnapshot(session.comments);
  const notifications = useNotificationStore();
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [shownThread, setShownThread] = useState(threadId);
  // Обсуждение открыли переходом (по уведомлению или ссылке): панель показывает его.
  if (threadId !== shownThread) {
    setShownThread(threadId);
    if (threadId) {
      setPanel('discussion');
      setDraft(null);
    }
  }

  const select = (id: string | null) => {
    setPanel('discussion');
    setDraft(null);
    navigate(boardPath(boardId, id), { replace: true });
  };

  // Щелчок инструментом «Комментарий» ставит метку нового обсуждения.
  useEffect(
    () =>
      editor.onPlaceComment(({ page, point, element }) => {
        const lookup = (id: string) => editor.doc.page(page).get(id);
        setDraft({
          page,
          x: point.x,
          y: point.y,
          element: element ? anchorAt(element, point, lookup) : null,
        });
        setPanel('discussion');
      }),
    [editor, setPanel],
  );

  // Открытое обсуждение видно на доске: открыта его страница, а метка не за краем окна.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    const thread = comments.threads.find((t) => t.id === threadId);
    if (!thread) {
      if (threadId === null) revealed.current = null;
      return;
    }
    if (revealed.current === thread.id) return;
    revealed.current = thread.id;
    editor.showPoint(
      thread.page,
      pinPoint(thread, (id) => editor.doc.page(thread.page).get(id)),
    );
  }, [editor, threadId, comments.threads]);

  // Уведомления об открытом обсуждении прочитаны: человек его видит.
  useEffect(() => {
    if (!notifications) return;
    notifications.watchThread(open ? threadId : null);
    return () => {
      notifications.watchThread(null);
    };
  }, [notifications, open, threadId]);

  const close = () => {
    setPanel(null);
    setDraft(null);
    if (threadId) navigate(boardPath(boardId), { replace: true });
  };

  return {
    comments,
    open,
    openCount: comments.threads.filter(isOpen).length,
    draft,
    select,
    dropDraft: () => {
      setDraft(null);
    },
    toggle: () => {
      if (open) close();
      else setPanel('discussion');
    },
    close,
  };
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
