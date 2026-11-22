import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from '../../editor/Editor';
import { DEFAULT_PAGE_NAME } from '../../model/document';
import { DEFAULT_PAGE } from '../../model/types';
import { useEditorState } from '../../editor/useEditorState';
import { defined } from '../../testing/helpers';
import { PageTabs } from './PageTabs';

function Tabs({ editor }: { editor: Editor }) {
  const state = useEditorState(editor);
  return <PageTabs editor={editor} pageId={state.pageId} readOnly={state.readOnly} />;
}

function setup(readOnly = false) {
  const editor = new Editor();
  editor.setReadOnly(readOnly);
  render(<Tabs editor={editor} />);
  const tabs = () =>
    within(screen.getByRole('navigation', { name: 'Страницы доски' }))
      .getAllByRole('button')
      .filter((button) => !button.getAttribute('aria-label'));
  return { editor, tabs, names: () => tabs().map((tab) => tab.textContent) };
}

describe('PageTabs', () => {
  it('adds a page, opens it and switches back', () => {
    const { editor, tabs, names } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить страницу' }));
    expect(names()).toEqual([DEFAULT_PAGE_NAME, 'Страница 2']);
    expect(defined(tabs()[1]).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: DEFAULT_PAGE_NAME }));
    expect(editor.pageId).toBe(DEFAULT_PAGE);
    expect(defined(tabs()[0]).getAttribute('aria-current')).toBe('page');
  });

  it('renames a page by double click: Enter saves, Escape cancels', () => {
    const { names } = setup();
    fireEvent.doubleClick(screen.getByRole('button', { name: DEFAULT_PAGE_NAME }));
    const field = screen.getByRole('textbox', { name: 'Название страницы' });
    fireEvent.change(field, { target: { value: 'Контекст' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(names()).toEqual(['Контекст']);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Контекст' }));
    const again = screen.getByRole('textbox', { name: 'Название страницы' });
    fireEvent.change(again, { target: { value: 'Не то' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(names()).toEqual(['Контекст']);
  });

  it('duplicates, moves and removes pages from the menu', () => {
    const { editor, names } = setup();
    const menu = () => {
      fireEvent.click(screen.getByRole('button', { name: /^Действия со страницей/ }));
      return screen.getByRole('menu');
    };
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Дублировать' }));
    expect(names()).toEqual([DEFAULT_PAGE_NAME, `${DEFAULT_PAGE_NAME} (копия)`]);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Переместить левее' }));
    expect(names()).toEqual([`${DEFAULT_PAGE_NAME} (копия)`, DEFAULT_PAGE_NAME]);
    expect(within(menu()).getByRole('menuitem', { name: 'Переместить левее' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Переместить правее' }),
    );
    expect(names()).toEqual([DEFAULT_PAGE_NAME, `${DEFAULT_PAGE_NAME} (копия)`]);

    // Пустая страница удаляется без вопроса.
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Удалить' }));
    expect(names()).toEqual([DEFAULT_PAGE_NAME]);
    expect(within(menu()).getByRole('menuitem', { name: 'Удалить' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(editor.pageId).toBe(DEFAULT_PAGE);
  });

  it('asks before removing a page with drawings on it', () => {
    const { editor, names } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить страницу' }));
    editor.setTool('rectangle');
    editor.pointerDown({ x: 0, y: 0 });
    editor.pointerUp();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Страница 2' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Удалить' }));

    const dialog = screen.getByRole('dialog', { name: 'Удалить страницу?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(names()).toHaveLength(2);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Страница 2' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Удалить' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    expect(names()).toEqual([DEFAULT_PAGE_NAME]);
  });

  it('reorders pages by dragging a tab onto another one', () => {
    const { editor, names } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить страницу' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить страницу' }));
    const third = screen.getByRole('button', { name: 'Страница 3' });
    const first = screen.getByRole('button', { name: DEFAULT_PAGE_NAME });

    fireEvent.dragStart(third, { dataTransfer: { setData: () => undefined } });
    fireEvent.dragOver(first.parentElement ?? first);
    expect(first.parentElement?.getAttribute('data-drop')).toBe('before');
    fireEvent.drop(first.parentElement ?? first);
    expect(names()).toEqual(['Страница 3', DEFAULT_PAGE_NAME, 'Страница 2']);
    expect(editor.doc.pages()[0]?.name).toBe('Страница 3');
  });

  it('lets a viewer only switch pages', () => {
    const editor = new Editor();
    editor.doc.addPage('Вторая');
    editor.setReadOnly(true);
    render(<Tabs editor={editor} />);
    expect(screen.queryByRole('button', { name: 'Добавить страницу' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Действия/ })).toBeNull();

    const second = screen.getByRole('button', { name: 'Вторая' });
    expect(second.getAttribute('draggable')).toBe('false');
    fireEvent.doubleClick(second);
    fireEvent.contextMenu(second);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(second);
    expect(editor.pageId).not.toBe(DEFAULT_PAGE);
  });
});
