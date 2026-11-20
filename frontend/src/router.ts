import { useEffect, useState } from 'react';

export type Route =
  | { page: 'boards' }
  | { page: 'board'; boardId: string }
  | { page: 'account' }
  | { page: 'admin' }
  | { page: 'not-found' };

/** Минимальная навигация без перезагрузки страницы. */
export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onChange = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return path;
}

/** «/» — список досок, «/b/<id>» — доска, «/account» — учётная запись, «/admin» — пользователи. */
export function parseRoute(path: string): Route {
  const normalized = path.length > 1 ? path.replace(/\/$/, '') : path;
  if (normalized === '/') return { page: 'boards' };
  if (normalized === '/account') return { page: 'account' };
  if (normalized === '/admin') return { page: 'admin' };
  const board = /^\/b\/([0-9a-f-]{36})$/i.exec(normalized);
  return board?.[1] ? { page: 'board', boardId: board[1] } : { page: 'not-found' };
}
