import type { ReactNode } from 'react';
import { type Access, api, type BoardInfo } from '../../api';
import controls from '../../ui/controls.module.css';
import { Link } from '../../ui/Link';
import styles from '../pages.module.css';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });

export const ACCESS_TEXT: Record<Access, string> = {
  view: 'просмотр',
  edit: 'редактирование',
  manage: 'управление',
};

/** Строка списка досок: название со ссылкой, подробности под ним и действия справа. */
export function BoardRow({
  board,
  details = [],
  children,
}: {
  board: BoardInfo;
  details?: string[];
  children?: ReactNode;
}) {
  const meta = [...details, `изменена ${dateFormat.format(new Date(board.updated_at))}`];
  return (
    <li>
      <Link to={`/b/${board.id}`}>
        <span className={styles.boardName}>{board.name}</span>
        <span className={controls.muted}>{meta.join(' · ')}</span>
      </Link>
      {children}
    </li>
  );
}

/** Удаляет доску после подтверждения. Возвращает true, если доска удалена. */
export async function confirmAndDelete(
  board: BoardInfo,
  onError: (text: string) => void,
): Promise<boolean> {
  if (!window.confirm(`Удалить доску «${board.name}»? Это нельзя отменить.`)) return false;
  try {
    await api.deleteBoard(board.id);
    return true;
  } catch {
    onError(`Не удалось удалить доску «${board.name}». Проверьте связь с сервером.`);
    return false;
  }
}
