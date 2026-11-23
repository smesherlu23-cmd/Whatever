import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CommentThread } from '../../api';
import { Editor } from '../../editor/Editor';
import { DEFAULT_FILL, DEFAULT_PAGE, DEFAULT_STROKE } from '../../model/types';
import { ANNA, IVAN, comment, thread } from '../../testing/comments';
import { type DraftPin, CommentPins } from './CommentPins';

const ON_SHAPE = thread(
  't1',
  [comment('c1', ANNA, 'Почему два?'), comment('c2', IVAN, 'Для отказоустойчивости')],
  { x: 200, y: 150, element: { id: 'server', x: 0.5, y: 0.5 } },
);
const IN_SPACE = thread('t2', [comment('c3', null, 'Что здесь будет?')], { x: 500, y: 400 });
const RESOLVED = thread('t3', [comment('c4', ANNA, 'Готово')], {
  x: 50,
  y: 50,
  resolved_at: '2026-11-23T10:00:00Z',
  resolved_by: ANNA,
});

function setup({
  threads = [ON_SHAPE, IN_SPACE, RESOLVED],
  selectedId = null,
  draft = null,
}: { threads?: CommentThread[]; selectedId?: string | null; draft?: DraftPin | null } = {}) {
  const editor = new Editor();
  editor.doc.add({
    id: 'server',
    kind: 'rectangle',
    page: DEFAULT_PAGE,
    x: 100,
    y: 100,
    w: 200,
    h: 100,
    text: 'Сервер',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  });
  const onSelect = vi.fn();
  const view = render(
    <CommentPins
      editor={editor}
      threads={threads}
      selectedId={selectedId}
      draft={draft}
      onSelect={onSelect}
    />,
  );
  return { editor, onSelect, ...view };
}

const pins = () => screen.queryAllByRole('button');
const placeOf = (element: Element | undefined) =>
  element instanceof HTMLElement ? element.style.transform : null;

describe('CommentPins', () => {
  it('marks the open discussions and moves them with their shapes and the camera', () => {
    const { editor } = setup();
    const [onShape, inSpace] = pins();
    expect(pins()).toHaveLength(2);
    expect(onShape?.getAttribute('aria-label')).toBe('Обсуждение: Анна Смирнова: Почему два?');
    expect(onShape?.getAttribute('title')).toBe('Анна Смирнова и ещё ответов: 1');
    expect(onShape?.textContent).toBe('А');
    expect(placeOf(onShape)).toBe('translate(200px, 150px)');
    expect(inSpace?.getAttribute('title')).toBe('Удалённый пользователь');
    expect(placeOf(inSpace)).toBe('translate(500px, 400px)');

    // Метка стоит посередине фигуры и остаётся там, когда фигуру двигают.
    act(() => {
      editor.doc.update('server', { x: 300 });
    });
    expect(placeOf(pins()[0])).toBe('translate(400px, 150px)');

    act(() => {
      editor.setCamera({ x: -100, y: 0, zoom: 2 });
    });
    expect(placeOf(pins()[0])).toBe('translate(600px, 300px)');
    expect(placeOf(pins()[1])).toBe('translate(800px, 800px)');
  });

  it('opens a discussion from its pin', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Что здесь будет\?/ }));
    expect(onSelect).toHaveBeenCalledWith('t2');
  });

  it('shows a resolved discussion only while it is open, and the pin being placed', () => {
    const draft = { page: DEFAULT_PAGE, x: 10, y: 20, element: null };
    const { container } = setup({ selectedId: 't3', draft });
    const resolved = screen.getByRole('button', { name: /Готово/ });
    expect(resolved.hasAttribute('data-resolved')).toBe(true);
    expect(resolved.hasAttribute('data-selected')).toBe(true);
    const placing = container.querySelector('[data-draft]');
    expect(placing?.textContent).toBe('+');
    expect(placeOf(placing ?? undefined)).toBe('translate(10px, 20px)');
  });

  it('shows only the pins of the open page', () => {
    const { editor, container } = setup({
      draft: { page: DEFAULT_PAGE, x: 10, y: 20, element: null },
    });
    act(() => {
      editor.setPage(editor.doc.addPage('Вторая'));
    });
    expect(pins()).toHaveLength(0);
    expect(container.querySelector('[data-draft]')).toBeNull();
  });
});
