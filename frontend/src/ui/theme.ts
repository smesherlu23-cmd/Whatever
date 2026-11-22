import { useSyncExternalStore } from 'react';
import { storageKeys } from '../config';

export type ThemeName = 'light' | 'dark';

const darkQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
const listeners = new Set<() => void>();

function savedTheme(): ThemeName | null {
  const value = localStorage.getItem(storageKeys.theme);
  return value === 'light' || value === 'dark' ? value : null;
}

/** Тема, выбранная пользователем, а пока он не выбирал — тема системы. */
export function currentTheme(): ThemeName {
  return savedTheme() ?? (darkQuery()?.matches ? 'dark' : 'light');
}

function apply(): void {
  document.documentElement.dataset.theme = currentTheme();
  for (const listener of listeners) listener();
}

export function setTheme(theme: ThemeName): void {
  localStorage.setItem(storageKeys.theme, theme);
  apply();
}

/** Применяет тему до первой отрисовки и следит за сменой темы в системе. */
export function initTheme(): void {
  apply();
  darkQuery()?.addEventListener('change', () => {
    if (!savedTheme()) apply();
  });
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribeTheme, currentTheme);
}
