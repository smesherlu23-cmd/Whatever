import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor/Editor';
import { enableCanvas } from '../testing/canvas';
import { Minimap } from './Minimap';

describe('Minimap', () => {
  beforeEach(() => {
    enableCanvas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('moves the view to the point under the pointer and keeps following the drag', () => {
    const editor = new Editor();
    editor.setViewport({ width: 400, height: 280 });
    render(<Minimap editor={editor} />);
    const map = screen.getByLabelText('Мини-карта: щелчок переносит сюда вид');

    // Пустая страница: на карте только видимая часть 400×280, 128 точек карты на 280 единиц.
    const scale = 128 / 280;
    fireEvent.pointerDown(map, { clientX: 100, clientY: 70, button: 0 });
    const first = editor.viewportCenter();
    expect(first.x).toBeCloseTo(200);
    expect(first.y).toBeCloseTo(140);

    // Пока карту тянут, её масштаб не меняется вслед за камерой.
    fireEvent.pointerMove(map, { clientX: 140, clientY: 70 });
    const moved = 200 + 40 / scale;
    expect(editor.viewportCenter().x).toBeCloseTo(moved);
    fireEvent.pointerUp(map);
    fireEvent.pointerMove(map, { clientX: 10, clientY: 10 });
    expect(editor.viewportCenter().x).toBeCloseTo(moved);

    // Правая кнопка мыши карту не двигает.
    fireEvent.pointerDown(map, { clientX: 10, clientY: 10, button: 2 });
    expect(editor.viewportCenter().x).toBeCloseTo(moved);
  });
});
