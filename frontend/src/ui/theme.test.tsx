import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle';
import { currentTheme, initTheme } from './theme';

function stubSystemTheme(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: dark, addEventListener: vi.fn() })),
  );
}

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the system until the user picks a theme', () => {
    stubSystemTheme(true);
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(currentTheme()).toBe('dark');
  });

  it('switches and remembers the theme', () => {
    stubSystemTheme(false);
    initTheme();
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Тёмная тема' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('whatever-theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Светлая тема' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
