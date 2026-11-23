import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '../../editor/Editor';
import { DEFAULT_FILL, DEFAULT_PAGE, DEFAULT_STROKE } from '../../model/types';
import { BoardMenu } from './BoardMenu';

function setup({ selected = true, readOnly = false } = {}) {
  const editor = new Editor();
  for (const id of ['a', 'b']) {
    editor.doc.add({
      id,
      kind: 'rectangle',
      page: DEFAULT_PAGE,
      x: id === 'a' ? 0 : 200,
      y: 0,
      w: 100,
      h: 100,
      text: '',
      stroke: DEFAULT_STROKE,
      fill: DEFAULT_FILL,
      z: 1,
    });
  }
  if (selected) editor.select(['a']);
  editor.setReadOnly(readOnly);
  const onClose = vi.fn();
  render(<BoardMenu editor={editor} at={{ x: 50, y: 50 }} onClose={onClose} />);
  const items = () =>
    within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
  return { editor, onClose, items };
}

describe('BoardMenu', () => {
  it('deletes the selection and closes', () => {
    const { editor, onClose, items } = setup();
    expect(items()).toEqual([
      'Изменить текстEnter',
      'ДублироватьCtrl+D',
      'УдалитьDelete',
      'Показать выделенноеShift+2',
      'Выделить всёCtrl+A',
      'Показать всёShift+1',
    ]);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Изменить текст/ }));

    fireEvent.click(screen.getByRole('menuitem', { name: /Удалить/ }));
    expect(editor.page.get('a')).toBeUndefined();
    expect(editor.page.get('b')).toBeDefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('duplicates the selection', () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: /Дублировать/ }));
    expect(editor.page.list()).toHaveLength(3);
  });

  it('offers only page actions on an empty spot', () => {
    expect(setup({ selected: false }).items()).toEqual([
      'Выделить всёCtrl+A',
      'Показать всёShift+1',
    ]);
  });

  it('does not let a viewer change the board', () => {
    const { items } = setup({ readOnly: true });
    expect(items()).toEqual([
      'Показать выделенноеShift+2',
      'Выделить всёCtrl+A',
      'Показать всёShift+1',
    ]);
  });

  it('moves the focus with the arrow keys and closes on Escape or when the board moves', () => {
    const { editor, onClose } = setup();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Показать всё/ }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Изменить текст/ }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      editor.zoomBy(2);
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
