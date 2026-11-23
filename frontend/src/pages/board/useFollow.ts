import { useCallback, useSyncExternalStore } from 'react';
import type { Follow, Leader } from '../../collab/follow';

const nothingToUnsubscribe = () => undefined;

/**
 * За кем следуют сейчас; без follow (доска без совместной работы) — ни за кем.
 * Компонент перерисовывается, только когда это меняется.
 */
export function useLeader(follow: Follow | undefined): Leader | null {
  const subscribe = useCallback(
    (onChange: () => void) => follow?.subscribe(onChange) ?? nothingToUnsubscribe,
    [follow],
  );
  const read = useCallback(() => follow?.leader ?? null, [follow]);
  return useSyncExternalStore(subscribe, read);
}
