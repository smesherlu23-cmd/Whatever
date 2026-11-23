import * as Y from 'yjs';
import { BoardDocument, type ElementSource } from '../model/document';
import { DEFAULT_PAGE } from '../model/types';

/** Столько байтов за раз передаётся в String.fromCharCode: больше переполнило бы стек. */
const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Содержимое новой доски: состояние документа одним обновлением Yjs в base64. */
export function encodeBoard(board: BoardDocument): string {
  return toBase64(Y.encodeStateAsUpdate(board.doc));
}

/** Первая страница доски: её показывает превью шаблона. */
export function previewPage(board: BoardDocument): ElementSource {
  return board.page(board.pages()[0]?.id ?? DEFAULT_PAGE);
}

/** Первая страница доски по её содержимому с сервера; null, если содержимое повреждено. */
export function contentPreview(content: Uint8Array): ElementSource | null {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, content);
  } catch {
    return null;
  }
  return previewPage(new BoardDocument(doc));
}
