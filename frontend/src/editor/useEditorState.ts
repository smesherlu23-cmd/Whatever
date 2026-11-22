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

/**
 * Подписка React-компонента на состояние редактора. Перерисовывает интерфейс только
 * когда меняется то, что он показывает, а не на каждое движение мыши.
 */
export function useEditorState(editor: Editor): EditorState {
  const [state, setState] = useState(() => editor.getState());
  useEffect(
    () =>
      editor.subscribe(() => {
        const next = editor.getState();
        setState((prev) => (same(prev, next) ? prev : next));
      }),
    [editor],
  );
  return state;
}
