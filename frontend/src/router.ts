import { useEffect, useState } from 'react';

/** Что показывает список досок: свои по папкам, доступные от коллег или все (администратору). */
export type BoardsView =
  { view: 'mine'; folderId: string | null } | { view: 'shared' } | { view: 'all' };

export type Route =
  | ({ page: 'boards' } & BoardsView)
  | { page: 'board'; boardId: string }
  | { page: 'join'; token: string }
  | { page: 'account' }
  | { page: 'admin' }
  | { page: 'not-found' };

/** Минимальная навигация без перезагрузки страницы. replace не оставляет шага в истории. */
export function navigate(path: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Адрес списка досок для выбранного вида. Обратная операция к разбору в parseRoute. */
export function boardsPath(view: BoardsView): string {
  if (view.view === 'shared') return '/?view=shared';
  if (view.view === 'all') return '/?view=all';
  return view.folderId ? `/?folder=${view.folderId}` : '/';
}

const currentLocation = () => window.location.pathname + window.location.search;

/** Путь и параметры текущего адреса. Компонент перерисовывается при переходах. */
export function useLocation(): string {
  const [location, setLocation] = useState(currentLocation);
  useEffect(() => {
    const onChange = () => {
      setLocation(currentLocation());
    };
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return location;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BOARD = new RegExp(`^/b/(${UUID})$`, 'i');
const FOLDER = new RegExp(`^${UUID}$`, 'i');
const JOIN = /^\/s\/([A-Za-z0-9_-]{16,64})$/;

/**
 * «/» — свои доски (в папке — «/?folder=<id>», доступные — «/?view=shared», все — «/?view=all»),
 * «/b/<id>» — доска, «/s/<токен>» — ссылка доступа, «/account» — учётная запись,
 * «/admin» — пользователи.
 */
export function parseRoute(location: string): Route {
  const url = new URL(location, 'http://app.invalid');
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
  if (path === '/') return { page: 'boards', ...parseBoardsView(url.searchParams) };
  if (path === '/account') return { page: 'account' };
  if (path === '/admin') return { page: 'admin' };
  const board = BOARD.exec(path)?.[1];
  if (board) return { page: 'board', boardId: board };
  const token = JOIN.exec(path)?.[1];
  if (token) return { page: 'join', token };
  return { page: 'not-found' };
}

function parseBoardsView(params: URLSearchParams): BoardsView {
  const view = params.get('view');
  if (view === 'shared' || view === 'all') return { view };
  const folder = params.get('folder');
  return { view: 'mine', folderId: folder && FOLDER.test(folder) ? folder : null };
}
