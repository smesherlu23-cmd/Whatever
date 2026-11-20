import { useEffect, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Board } from './canvas/Board';
import { Editor } from './editor/Editor';
import { TextEditor } from './editor/TextEditor';
import { useEditorState } from './editor/useEditorState';
import { BoardDocument } from './model/document';
import { Toolbar } from './ui/Toolbar';
import styles from './App.module.css';

/** Пока сервера синхронизации нет, доска хранится в браузере под этим именем. */
const LOCAL_BOARD = 'whatever-local-board';

export function App({ persist = true }: { persist?: boolean }) {
  const [editor] = useState(() => new Editor(new BoardDocument()));
  const state = useEditorState(editor);

  useEffect(() => {
    if (!persist || typeof indexedDB === 'undefined') return;
    const persistence = new IndexeddbPersistence(LOCAL_BOARD, editor.doc.doc);
    return () => {
      void persistence.destroy();
    };
  }, [editor, persist]);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.logo}>Whatever</span>
        <span className={styles.title}>Новая доска</span>
      </header>
      <main className={styles.main}>
        <Board editor={editor} />
        {state.editingId && <TextEditor key={state.editingId} editor={editor} id={state.editingId} />}
        <div className={styles.toolbar}>
          <Toolbar
            tool={state.tool}
            onChange={(tool) => editor.setTool(tool)}
            onUndo={() => editor.undo()}
            onRedo={() => editor.redo()}
          />
        </div>
        <div className={styles.zoom} aria-live="polite">
          {Math.round(state.camera.zoom * 100)}%
        </div>
      </main>
    </div>
  );
}
