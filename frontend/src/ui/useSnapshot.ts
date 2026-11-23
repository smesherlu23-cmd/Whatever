import { useCallback, useSyncExternalStore } from 'react';

/** Состояние, которое меняется само и сообщает об этом: обсуждения, версии, уведомления. */
export interface Observable<T> {
  readonly snapshot: T;
  subscribe(listener: () => void): () => void;
}

/** Текущее состояние source. Компонент перерисовывается, когда оно сменилось. */
export function useSnapshot<T>(source: Observable<T>): T {
  const subscribe = useCallback((onChange: () => void) => source.subscribe(onChange), [source]);
  return useSyncExternalStore(subscribe, () => source.snapshot);
}
