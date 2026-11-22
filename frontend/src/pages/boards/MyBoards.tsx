import { type SubmitEvent, useEffect, useState } from 'react';
import { api, type BoardInfo, errorText, type Folder } from '../../api';
import { useAuth } from '../../auth/context';
import { boardsPath, navigate } from '../../router';
import controls from '../../ui/controls.module.css';
import { Link } from '../../ui/Link';
import styles from '../pages.module.css';
import list from './boards.module.css';
import { BoardRow, confirmAndDelete } from './BoardRow';
import { folderChoices, folderPath, subfolders } from './folders';

const UNREACHABLE = 'Сервер недоступен. Попробуйте обновить страницу.';

const folderLink = (id: string | null) => boardsPath({ view: 'mine', folderId: id });

/** Свои доски, разложенные по личным папкам. folderId — открытая папка, null — корень. */
export function MyBoards({ folderId }: { folderId: string | null }) {
  const { user } = useAuth();
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listBoards(), api.listFolders()]).then(
      ([allBoards, allFolders]) => {
        if (cancelled) return;
        setBoards(allBoards.filter((board) => board.owner?.id === user.id));
        setFolders(allFolders);
      },
      () => {
        if (!cancelled) setError(UNREACHABLE);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const path = folderPath(folders, folderId);
  const current = path.at(-1) ?? null;
  const here = boards?.filter((board) => board.folder_id === folderId) ?? [];
  const inner = subfolders(folders, folderId);
  const failed = (err: unknown) => {
    setError(errorText(err, 'Не удалось сохранить. Проверьте связь с сервером.'));
  };

  const createBoard = async () => {
    try {
      const board = await api.createBoard('Новая доска', current?.id ?? null);
      navigate(`/b/${board.id}`);
    } catch {
      setError('Не удалось создать доску. Проверьте связь с сервером.');
    }
  };

  const createFolder = async (name: string) => {
    try {
      const folder = await api.createFolder(name, current?.id ?? null);
      setFolders((all) => [...all, folder]);
      setCreatingFolder(false);
    } catch (err) {
      failed(err);
    }
  };

  const renameFolder = async (folder: Folder, name: string) => {
    try {
      const renamed = await api.renameFolder(folder.id, name);
      setFolders((all) => all.map((f) => (f.id === renamed.id ? renamed : f)));
    } catch (err) {
      failed(err);
    }
  };

  const deleteFolder = async (folder: Folder) => {
    const question = `Удалить папку «${folder.name}»? Её доски и папки переместятся на уровень выше.`;
    if (!window.confirm(question)) return;
    try {
      await api.deleteFolder(folder.id);
      // Сервер поднял содержимое на уровень выше; здесь то же самое, без повторной загрузки.
      setFolders((all) =>
        all
          .filter((f) => f.id !== folder.id)
          .map((f) => (f.parent_id === folder.id ? { ...f, parent_id: folder.parent_id } : f)),
      );
      setBoards(
        (all) =>
          all?.map((b) =>
            b.folder_id === folder.id ? { ...b, folder_id: folder.parent_id } : b,
          ) ?? null,
      );
    } catch (err) {
      failed(err);
    }
  };

  const moveBoard = async (board: BoardInfo, target: string | null) => {
    try {
      const moved = await api.moveBoard(board.id, target);
      setBoards((all) => all?.map((b) => (b.id === moved.id ? moved : b)) ?? null);
    } catch (err) {
      failed(err);
    }
  };

  const deleteBoard = async (board: BoardInfo) => {
    if (await confirmAndDelete(board, setError)) {
      setBoards((all) => all?.filter((b) => b.id !== board.id) ?? null);
    }
  };

  if (folderId !== null && boards !== null && current === null) {
    return (
      <p>
        Папка не найдена. Возможно, её удалили. <Link to={folderLink(null)}>К своим доскам</Link>
      </p>
    );
  }

  return (
    <>
      {current && (
        <nav className={list.breadcrumbs} aria-label="Путь к папке">
          <Link to={folderLink(null)}>Мои доски</Link>
          {path.slice(0, -1).map((folder) => (
            <Link key={folder.id} to={folderLink(folder.id)}>
              {folder.name}
            </Link>
          ))}
        </nav>
      )}
      <div className={styles.listHeader}>
        <h1>{current?.name ?? 'Мои доски'}</h1>
        <div className={list.actions}>
          <button
            type="button"
            className={controls.secondary}
            onClick={() => setCreatingFolder(true)}
          >
            Новая папка
          </button>
          <button type="button" className={controls.primary} onClick={() => void createBoard()}>
            Создать доску
          </button>
        </div>
      </div>
      {error && (
        <p className={controls.error} role="alert">
          {error}
        </p>
      )}
      {creatingFolder && (
        <NameForm
          label="Название папки"
          initial=""
          submitText="Создать"
          onSubmit={(name) => void createFolder(name)}
          onCancel={() => setCreatingFolder(false)}
        />
      )}
      {boards?.length === 0 && folders.length === 0 && (
        <p className={controls.muted}>Досок пока нет. Создайте первую.</p>
      )}
      {boards && (boards.length > 0 || folders.length > 0) && here.length + inner.length === 0 && (
        <p className={controls.muted}>В этой папке пусто.</p>
      )}
      {(inner.length > 0 || here.length > 0) && (
        <ul className={styles.boards}>
          {inner.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              onRename={(name) => void renameFolder(folder, name)}
              onDelete={() => void deleteFolder(folder)}
            />
          ))}
          {here.map((board) => (
            <BoardRow key={board.id} board={board}>
              <select
                className={`${controls.input} ${list.move}`}
                aria-label={`Папка доски ${board.name}`}
                value={board.folder_id ?? ''}
                onChange={(e) => void moveBoard(board, e.target.value || null)}
              >
                <option value="">Без папки</option>
                {folderChoices(folders).map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={controls.ghost}
                aria-label={`Удалить доску ${board.name}`}
                onClick={() => void deleteBoard(board)}
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

function FolderRow({
  folder,
  onRename,
  onDelete,
}: {
  folder: Folder;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <li>
        <NameForm
          label={`Новое название папки ${folder.name}`}
          initial={folder.name}
          submitText="Сохранить"
          onSubmit={(name) => {
            setRenaming(false);
            if (name !== folder.name) onRename(name);
          }}
          onCancel={() => setRenaming(false)}
        />
      </li>
    );
  }
  return (
    <li>
      <Link to={folderLink(folder.id)}>
        <span className={styles.boardName}>
          <span className={list.folderIcon} aria-hidden="true" />
          {folder.name}
        </span>
        <span className={controls.muted}>папка</span>
      </Link>
      <button
        type="button"
        className={controls.ghost}
        aria-label={`Переименовать папку ${folder.name}`}
        onClick={() => setRenaming(true)}
      >
        Переименовать
      </button>
      <button
        type="button"
        className={controls.ghost}
        aria-label={`Удалить папку ${folder.name}`}
        onClick={onDelete}
      >
        Удалить
      </button>
    </li>
  );
}

/** Поле с названием и кнопками: для новой папки и для переименования. */
function NameForm({
  label,
  initial,
  submitText,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submitText: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <form className={list.nameForm} onSubmit={submit}>
      <input
        className={controls.input}
        aria-label={label}
        value={name}
        maxLength={200}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button type="submit" className={controls.primary} disabled={!name.trim()}>
        {submitText}
      </button>
      <button type="button" className={controls.ghost} onClick={onCancel}>
        Отмена
      </button>
    </form>
  );
}
