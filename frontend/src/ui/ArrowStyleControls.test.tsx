import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ARROW_STYLE } from '../model/types';
import { ArrowStyleControls } from './ArrowStyleControls';

describe('ArrowStyleControls', () => {
  it('picks a head for each end of new arrows', () => {
    const onChange = vi.fn();
    render(<ArrowStyleControls style={DEFAULT_ARROW_STYLE} selection={null} onChange={onChange} />);

    const end = screen.getByRole('button', { name: 'Конец стрелки: Стрелка' });
    fireEvent.click(end);
    const heads = screen.getByRole('group', { name: 'Конец стрелки' });
    expect(within(heads).getAllByRole('button')).toHaveLength(11);
    fireEvent.click(within(heads).getByRole('button', { name: 'Один или много' }));
    expect(onChange).toHaveBeenCalledWith({ endHead: 'many' });
    expect(screen.queryByRole('group', { name: 'Конец стрелки' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Начало стрелки: Без наконечника' }));
    fireEvent.click(screen.getByRole('button', { name: 'Пустой ромб: агрегация' }));
    expect(onChange).toHaveBeenCalledWith({ startHead: 'diamond' });

    fireEvent.click(screen.getByRole('button', { name: 'Пунктир' }));
    expect(onChange).toHaveBeenCalledWith({ dashed: true });
  });

  it('shows the style of the selected arrows, marking nothing where they differ', () => {
    render(
      <ArrowStyleControls
        style={DEFAULT_ARROW_STYLE}
        selection={{ route: 'elbow', startHead: null, endHead: 'open', dashed: null }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ломаная' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Начало стрелки: разные' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пунктир' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Начало стрелки: разные' }));
    const pressed = within(screen.getByRole('group', { name: 'Начало стрелки' }))
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toEqual([]);
  });
});
