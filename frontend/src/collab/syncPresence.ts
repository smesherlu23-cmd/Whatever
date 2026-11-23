import type { Editor } from '../editor/Editor';
import type { Follow } from './follow';
import type { Presence } from './presence';

/**
 * Публикует в присутствии открытую страницу, выделение и видимую часть доски, когда они
 * меняются. Пока пользователь следует за участником, вместо своей видимой части
 * публикуется вид участника (см. Follow.view). Возвращает функцию отписки.
 */
export function syncPresence(editor: Editor, presence: Presence, follow: Follow): () => void {
  let { pageId, selection, camera, viewport } = editor;
  const publishView = () => {
    presence.setView(follow.view ?? editor.visibleArea());
  };
  presence.setPage(pageId);
  presence.setSelection(selection);
  publishView();
  const offFollow = follow.subscribe(publishView);
  const offEditor = editor.subscribe(() => {
    // Смена страницы сбрасывает опубликованный вид, поэтому после неё он отправляется заново.
    const pageChanged = editor.pageId !== pageId;
    if (pageChanged) {
      pageId = editor.pageId;
      presence.setPage(pageId);
    }
    if (editor.selection !== selection) {
      selection = editor.selection;
      presence.setSelection(selection);
    }
    if (pageChanged || editor.camera !== camera || editor.viewport !== viewport) {
      ({ camera, viewport } = editor);
      publishView();
    }
  });
  return () => {
    offFollow();
    offEditor();
  };
}
