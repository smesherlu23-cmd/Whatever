import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('switches the active tool', () => {
    render(<App persist={false} />);
    const rectangle = screen.getByRole('button', { name: 'Прямоугольник' });
    expect(rectangle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(rectangle);
    expect(rectangle.getAttribute('aria-pressed')).toBe('true');
  });
});
