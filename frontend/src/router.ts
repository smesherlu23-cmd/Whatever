import { useEffect, useState } from 'react';

/** Минимальная навигация без перезагрузки страницы: «/» — список досок, «/b/<id>» — доска. */
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

export function boardIdFromPath(path: string): string | null {
  const match = /^\/b\/([0-9a-f-]{36})\/?$/i.exec(path);
  return match?.[1] ?? null;
}
