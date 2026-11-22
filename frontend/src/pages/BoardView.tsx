import type { ReactNode } from 'react';
import { Board } from '../canvas/Board';
import type { Presence } from '../collab/presence';
import type { Editor } from '../editor/Editor';
import { TextEditor } from '../editor/TextEditor';
import { useEditorState } from '../editor/useEditorState';
import { Toolbar } from '../ui/Toolbar';
import { PageTabs } from './board/PageTabs';
import styles from './pages.module.css';

/** Холст с панелью инструментов. Шапку страницы целиком передаёт родитель. */
export function BoardView({
  editor,
  presence,
  header,
}: {
  editor: Editor;
  presence?: Presence;
  header: ReactNode;
}) {
  const state = useEditorState(editor);
  return (
    <div className={styles.app}>
      {header}
      <main className={styles.main}>
        <Board editor={editor} presence={presence} />
        {state.editingId && (
          <TextEditor key={state.editingId} editor={editor} id={state.editingId} />
        )}
        <div className={styles.toolbar}>
          {state.readOnly ? (
            <p className={styles.readOnly} role="status">
              Только просмотр
            </p>
          ) : (
            <Toolbar
              tool={state.tool}
              onChange={(tool) => editor.setTool(tool)}
              smartDrawing={state.smartDrawing}
              onSmartDrawingChange={(enabled) => editor.setSmartDrawing(enabled)}
              arrowStyle={state.arrowStyle}
              selectionArrowStyle={state.selectionArrowStyle}
              onArrowStyleChange={(patch) => editor.setArrowStyle(patch)}
              onUndo={() => editor.undo()}
              onRedo={() => editor.redo()}
            />
          )}
        </div>
        <PageTabs editor={editor} pageId={state.pageId} readOnly={state.readOnly} />
        <div className={styles.zoom} aria-live="polite">
          {Math.round(state.camera.zoom * 100)}%
        </div>
      </main>
    </div>
  );
}
