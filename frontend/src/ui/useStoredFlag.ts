import { useCallback, useState } from 'react';

/** Флаг, который помнит браузер: например, показывать ли мини-карту. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved === null ? initial : saved === 'true';
  });
  const update = useCallback(
    (next: boolean) => {
      localStorage.setItem(key, String(next));
      setValue(next);
    },
    [key],
  );
  return [value, update];
}
