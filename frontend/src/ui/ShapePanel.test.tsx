import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShapePreset, Tool } from '../editor/Editor';
import { ShapePanel } from './ShapePanel';

describe('ShapePanel', () => {
  it('offers sets of shapes and picks one with its preset', () => {
    const onPick = vi.fn<(tool: Tool, preset: ShapePreset | null) => void>();
    const { rerender } = render(<ShapePanel tool="select" onPick={onPick} onClose={vi.fn()} />);
    const uml = screen.getByRole('region', { name: 'UML' });
    fireEvent.click(within(uml).getByRole('button', { name: 'Интерфейс' }));
    const [kind, preset] = onPick.mock.lastCall ?? [];
    expect(kind).toBe('class');
    expect(preset).toMatchObject({ text: '«интерфейс»\nИмя\n--\n+ метод(): Тип' });

    rerender(<ShapePanel tool="class" onPick={onPick} onClose={vi.fn()} />);
    const pressed = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((button) => button.getAttribute('aria-label'))).toEqual(['Интерфейс']);

    fireEvent.click(screen.getByRole('button', { name: 'Шлюз' }));
    expect(onPick).toHaveBeenLastCalledWith('gateway', null);
  });

  it('finds shapes by name and closes', () => {
    const onClose = vi.fn();
    render(<ShapePanel tool="select" onPick={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Найти фигуру' }), {
      target: { value: 'база' },
    });
    expect(screen.getAllByRole('region').map((group) => group.getAttribute('aria-label'))).toEqual([
      'Инфраструктура и C4',
    ]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'звездолёт' } });
    expect(screen.getByText('Таких фигур нет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть фигуры' }));
    expect(onClose).toHaveBeenCalled();
  });
});
