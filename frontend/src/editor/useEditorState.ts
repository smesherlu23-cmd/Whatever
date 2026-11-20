import { useEffect, useState } from 'react';
import type { Editor, EditorState } from './Editor';

/** Подписка React-компонента на состояние редактора. */
export function useEditorState(editor: Editor): EditorState {
  const [state, setState] = useState(() => editor.getState());
  useEffect(() => editor.subscribe(() => setState(editor.getState())), [editor]);
  return state;
}
