import { useEffect, useState } from 'react';
import type { Editor, EditorState } from './Editor';

function same(a: EditorState, b: EditorState): boolean {
  return (
    a.readOnly === b.readOnly &&
    a.pageId === b.pageId &&
    a.tool === b.tool &&
    a.smartDrawing === b.smartDrawing &&
    a.arrowStyle === b.arrowStyle &&
    a.selectionArrowStyle === b.selectionArrowStyle &&
    a.selection === b.selection &&
    a.editingId === b.editingId &&
    a.camera === b.camera
  );
}

interface Tracked {
  readonly editor: Editor;
  readonly state: EditorState;
}

/**
 * Подписка React-компонента на состояние редактора. Перерисовывает интерфейс только
 * когда меняется то, что он показывает, а не на каждое движение мыши.
 * Если компоненту передали другой редактор (например, открыли просмотр версии доски),
 * его состояние видно в том же кадре, а не после первого изменения.
 */
export function useEditorState(editor: Editor): EditorState {
  const [tracked, setTracked] = useState<Tracked>(() => ({ editor, state: editor.getState() }));
  let current = tracked;
  if (current.editor !== editor) {
    current = { editor, state: editor.getState() };
    setTracked(current);
  }
  useEffect(
    () =>
      editor.subscribe(() => {
        const next = editor.getState();
        setTracked((prev) =>
          prev.editor === editor && same(prev.state, next) ? prev : { editor, state: next },
        );
      }),
    [editor],
  );
  return current.state;
}
