import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Link } from './Link';

describe('Link', () => {
  afterEach(() => {
    window.history.pushState(null, '', '/');
  });

  it('navigates without reloading the page', () => {
    render(<Link to="/b/42">Доска</Link>);
    fireEvent.click(screen.getByText('Доска'));
    expect(window.location.pathname).toBe('/b/42');
  });

  it('leaves Ctrl+click to the browser to open a new tab', () => {
    render(<Link to="/b/42">Доска</Link>);
    const opened = fireEvent.click(screen.getByText('Доска'), { ctrlKey: true });
    expect(opened).toBe(true);
    expect(window.location.pathname).toBe('/');
  });
});
