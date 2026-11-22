import { pageName } from '../model/document';
import type { Page } from '../model/types';
import type { Editor } from './Editor';

/** Название новой страницы: «Страница N» с первым свободным номером. */
export function nextPageName(pages: readonly Page[]): string {
  const taken = new Set(pages.map((page) => page.name));
  let n = pages.length + 1;
  while (taken.has(pageName(n))) n += 1;
  return pageName(n);
}

/**
 * Изменение страниц как отдельный шаг отмены. Зритель страницы только переключает:
 * его правки всё равно отбросит сервер.
 */
function step<T>(editor: Editor, change: () => T): T | undefined {
  if (editor.readOnly) return undefined;
  editor.doc.stopCapturing();
  const result = change();
  editor.doc.stopCapturing();
  return result;
}

/** Добавляет страницу в конец и открывает её. */
export function addPage(editor: Editor): void {
  const id = step(editor, () => editor.doc.addPage(nextPageName(editor.doc.pages())));
  if (id) editor.setPage(id);
}

export function renamePage(editor: Editor, id: string, name: string): void {
  const trimmed = name.trim();
  const page = editor.doc.pages().find((p) => p.id === id);
  if (!page || !trimmed || trimmed === page.name) return;
  step(editor, () => {
    editor.doc.renamePage(id, trimmed);
  });
}

/** Копия страницы со всем содержимым встаёт следом за ней и сразу открывается. */
export function duplicatePage(editor: Editor, id: string): void {
  const page = editor.doc.pages().find((p) => p.id === id);
  if (!page) return;
  const copy = step(editor, () => editor.doc.duplicatePage(id, `${page.name} (копия)`));
  if (copy) editor.setPage(copy);
}

/** Удаляет страницу. Если она была открыта, редактор сам перейдёт на первую из оставшихся. */
export function removePage(editor: Editor, id: string): void {
  step(editor, () => editor.doc.removePage(id));
}

/** Ставит страницу перед before, а с before = null — в конец. */
export function movePage(editor: Editor, id: string, before: string | null): void {
  step(editor, () => {
    editor.doc.movePage(id, before);
  });
}
