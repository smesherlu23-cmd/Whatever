import * as Y from 'yjs';
import type { BoardVersion } from '../api';
import { Editor } from '../editor/Editor';
import { BoardDocument } from '../model/document';
import { formatFullDate } from '../ui/time';

/** Самое длинное название версии; столько же принимает сервер. */
export const MAX_VERSION_NAME = 200;

/**
 * Редактор для просмотра версии: её документ отдельно от доски и только для чтения.
 * Открывается та же страница и тот же вид, что в from, чтобы версию было легко сравнить
 * с доской. Если такой страницы в версии нет, видна её первая страница целиком.
 */
export function previewEditor(content: Uint8Array, from: Editor): Editor {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, content);
  const editor = new Editor(new BoardDocument(doc));
  editor.setReadOnly(true);
  editor.setViewport(from.viewport);
  if (!showSameView(from, editor)) editor.zoomToFit();
  return editor;
}

/** Открывает в to страницу и вид из from. Возвращает false, если такой страницы в to нет. */
export function showSameView(from: Editor, to: Editor): boolean {
  if (!to.doc.hasPage(from.pageId)) return false;
  to.setPage(from.pageId);
  to.setCamera(from.camera);
  return true;
}

/** Как называть версию в интерфейсе: по названию, а безымянную — по времени. */
export function versionTitle(version: BoardVersion, when: (iso: string) => string): string {
  return version.name ?? when(version.created_at);
}

/**
 * Версия в середине фразы: «Релиз 2.0» в кавычках, а безымянная — «от 23 ноября 2026 г.
 * в 10:05». Дата полная: такие фразы сохраняются, а «вчера» через день стало бы неправдой.
 */
export function versionPhrase(version: BoardVersion): string {
  return version.name === null ? `от ${formatFullDate(version.created_at)}` : `«${version.name}»`;
}

/** Название версии, которая сохраняет доску перед восстановлением другой. */
export function backupName(version: BoardVersion): string {
  const name = `Перед восстановлением версии ${versionPhrase(version)}`;
  return name.length > MAX_VERSION_NAME ? `${name.slice(0, MAX_VERSION_NAME - 2)}…»` : name;
}
