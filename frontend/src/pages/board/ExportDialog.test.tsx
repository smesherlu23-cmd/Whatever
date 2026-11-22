import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as exportImage from '../../canvas/exportImage';
import { ImageCache } from '../../canvas/images';
import { Editor } from '../../editor/Editor';
import { DEFAULT_FILL, DEFAULT_STROKE } from '../../model/types';
import { ExportDialog, exportFileName } from './ExportDialog';

function editorWithShapes(): Editor {
  const editor = new Editor();
  for (const [id, x] of [
    ['a', 0],
    ['b', 300],
  ] as const) {
    editor.doc.add({
      id,
      kind: 'rectangle',
      page: editor.pageId,
      x,
      y: 0,
      w: 100,
      h: 50,
      text: '',
      stroke: DEFAULT_STROKE,
      fill: DEFAULT_FILL,
      z: 1,
    });
  }
  return editor;
}

describe('ExportDialog', () => {
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:png', revokeObjectURL: vi.fn() }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the size of each resolution and saves the chosen one', async () => {
    const editor = editorWithShapes();
    const exportPng = vi.spyOn(exportImage, 'exportPng').mockResolvedValue(new Blob(['png']));
    const onClose = vi.fn();
    render(
      <ExportDialog
        editor={editor}
        images={new ImageCache(String)}
        boardName="Схема: оплата"
        onClose={onClose}
      />,
    );

    // Без выделения сохраняется вся страница.
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Только выделенное' }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole('radio', { name: /^1×/ }).parentElement?.textContent.replace(/\s/g, ' '),
    ).toContain('464 × 114');
    expect(
      screen.getByRole('radio', { name: /^3×/ }).parentElement?.textContent.replace(/\s/g, ' '),
    ).toContain('1 392 × 342');

    fireEvent.click(screen.getByRole('radio', { name: /^3×/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Тёмный' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить PNG' }));

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    const [, plan, , background] = exportPng.mock.lastCall ?? [];
    expect(plan?.scale).toBe(3);
    expect(background).toBe('dark');
    expect(clicked[0]?.download).toBe('Схема_ оплата.png');
  });

  it('saves only the selection when something is selected and reports a failure', async () => {
    const editor = editorWithShapes();
    editor.select(['b']);
    vi.spyOn(exportImage, 'exportPng').mockRejectedValue(new Error('Браузеру не хватило памяти'));
    render(
      <ExportDialog
        editor={editor}
        images={new ImageCache(String)}
        boardName="Доска"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Только выделенное' }).checked).toBe(
      true,
    );
    expect(
      screen.getByRole('radio', { name: /^2×/ }).parentElement?.textContent.replace(/\s/g, ' '),
    ).toContain('328 × 228');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить PNG' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Браузеру не хватило памяти');
  });

  it('has nothing to save on an empty page', () => {
    render(
      <ExportDialog
        editor={new Editor()}
        images={new ImageCache(String)}
        boardName="Доска"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('На странице пока ничего нет.')).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Сохранить PNG' }).disabled).toBe(
      true,
    );
  });
});

describe('exportFileName', () => {
  it('names the file after the board and the page', () => {
    expect(exportFileName('Схема', null)).toBe('Схема.png');
    expect(exportFileName('Схема', 'Контекст')).toBe('Схема — Контекст.png');
    expect(exportFileName('a/b\\c*?', null)).toBe('a_b_c_.png');
    expect(exportFileName(' ', null)).toBe('Доска.png');
  });
});
