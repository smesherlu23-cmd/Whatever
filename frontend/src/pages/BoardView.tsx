import { type ReactNode, useRef, useState } from 'react';
import { Board } from '../canvas/Board';
import type { Presence } from '../collab/presence';
import type { Editor } from '../editor/Editor';
import { TextEditor } from '../editor/TextEditor';
import { useEditorState } from '../editor/useEditorState';
import type { BoardFiles } from '../files/boardFiles';
import { ShapePanel } from '../ui/ShapePanel';
import { Toolbar } from '../ui/Toolbar';
import { PageTabs } from './board/PageTabs';
import { useFileInsert } from './board/useFileInsert';
import styles from './pages.module.css';

/** Холст с панелью инструментов. Шапку страницы целиком передаёт родитель. */
export function BoardView({
  editor,
  presence,
  files,
  header,
}: {
  editor: Editor;
  presence?: Presence;
  files: BoardFiles;
  header: ReactNode;
}) {
  const state = useEditorState(editor);
  const [shapesOpen, setShapesOpen] = useState(false);
  const { insert, uploading, error, dismissError } = useFileInsert(editor, files);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.app}>
      {header}
      <main className={styles.main}>
        <Board
          editor={editor}
          presence={presence}
          images={files.images}
          onOpenFile={(file) => files.open(file)}
          onInsertFiles={state.readOnly ? undefined : (chosen, at) => void insert(chosen, at)}
        />
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
              shapesOpen={shapesOpen}
              onShapesToggle={() => setShapesOpen(!shapesOpen)}
              onInsertFile={() => picker.current?.click()}
              onUndo={() => editor.undo()}
              onRedo={() => editor.redo()}
            />
          )}
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Картинки и файлы для вставки"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            // Тот же файл можно будет выбрать снова.
            e.target.value = '';
            if (chosen.length > 0) void insert(chosen, editor.viewportCenter());
          }}
        />
        {uploading > 0 && (
          <p className={styles.notice} role="status">
            {uploading === 1 ? 'Загружается файл…' : `Загружаются файлы: ${uploading}…`}
          </p>
        )}
        {error && uploading === 0 && (
          <p className={styles.notice} role="alert">
            {error}
            <button type="button" className={styles.noticeClose} onClick={dismissError}>
              Закрыть
            </button>
          </p>
        )}
        {shapesOpen && !state.readOnly && (
          <ShapePanel
            tool={state.tool}
            onPick={(tool, preset) => editor.setTool(tool, preset)}
            onClose={() => setShapesOpen(false)}
          />
        )}
        <PageTabs editor={editor} pageId={state.pageId} readOnly={state.readOnly} />
        <div className={styles.zoom} aria-live="polite">
          {Math.round(state.camera.zoom * 100)}%
        </div>
      </main>
    </div>
  );
}
