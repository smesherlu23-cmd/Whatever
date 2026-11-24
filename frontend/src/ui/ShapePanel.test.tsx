import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShapePreset, Tool } from '../editor/Editor';
import { ShapePanel } from './ShapePanel';

describe('ShapePanel', () => {
  it('offers only the basic, flowchart and infrastructure sets', () => {
    render(<ShapePanel tool="select" onPick={vi.fn()} onClose={vi.fn()} />);
    const groups = screen.getAllByRole('region');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Основные',
      'Блок-схема',
      'Инфраструктура и C4',
    ]);
    for (const group of groups) expect(within(group).getAllByRole('button')).toHaveLength(8);
  });

  it('picks a shape with its preset', () => {
    const onPick = vi.fn<(tool: Tool, preset: ShapePreset | null) => void>();
    const { rerender } = render(<ShapePanel tool="select" onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Контейнер C4' }));
    const [kind, preset] = onPick.mock.lastCall ?? [];
    expect(kind).toBe('rounded');
    expect(preset).toMatchObject({ text: 'Сервис\n[Технология]' });

    // Скруглённый прямоугольник есть и среди основных, но нажата только выбранная кнопка.
    rerender(<ShapePanel tool="rounded" onPick={onPick} onClose={vi.fn()} />);
    const pressed = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((button) => button.getAttribute('aria-label'))).toEqual(['Контейнер C4']);

    fireEvent.click(screen.getByRole('button', { name: 'Решение' }));
    expect(onPick).toHaveBeenLastCalledWith('diamond', null);
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
