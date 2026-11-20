import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('switches the active tool', () => {
    render(<App />);
    const pen = screen.getByRole('button', { name: 'Умное рисование' });
    expect(pen.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pen);
    expect(pen.getAttribute('aria-pressed')).toBe('true');
  });
});
