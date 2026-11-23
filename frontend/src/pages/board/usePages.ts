import { useCallback, useSyncExternalStore } from 'react';
import type { BoardDocument } from '../../model/document';
import type { Page } from '../../model/types';

/** Страницы доски по порядку. Компонент перерисовывается, только когда меняется их список. */
export function usePages(doc: BoardDocument): readonly Page[] {
  const subscribe = useCallback((onChange: () => void) => doc.onChange(onChange), [doc]);
  const read = useCallback(() => doc.pages(), [doc]);
  return useSyncExternalStore(subscribe, read);
}
