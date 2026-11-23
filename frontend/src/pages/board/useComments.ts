import { useCallback, useSyncExternalStore } from 'react';
import type { CommentsState, CommentStore } from '../../comments/store';

/** Обсуждения доски. Компонент перерисовывается, когда список или его состояние изменились. */
export function useComments(store: CommentStore): CommentsState {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  return useSyncExternalStore(subscribe, () => store.snapshot);
}
