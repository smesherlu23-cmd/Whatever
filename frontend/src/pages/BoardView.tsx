import { type ReactNode, useRef, useState } from 'react';
import { ZOOM_STEP } from '../canvas/camera';
import { Board } from '../canvas/Board';
import { Minimap } from '../canvas/Minimap';
import type { Follow } from '../collab/follow';
import type { Presence } from '../collab/presence';
import { storageKeys } from '../config';
import type { Editor } from '../editor/Editor';
import { TextEditor } from '../editor/TextEditor';
import { useEditorState } from '../editor/useEditorState';
import type { BoardFiles } from '../files/boardFiles';
import { ShapePanel } from '../ui/ShapePanel';
import { COMMENT_TOOL, IconButton, Toolbar } from '../ui/Toolbar';
import { useStoredFlag } from '../ui/useStoredFlag';
import { ZoomControls } from '../ui/ZoomControls';
import { FollowNotice } from './board/FollowNotice';
import { PageTabs } from './board/PageTabs';
import { useFileInsert } from './board/useFileInsert';
import { useLeader } from './board/useFollow';
import styles from './pages.module.css';

/**
 * Холст с панелью инструментов. Шапку страницы целиком передаёт родитель, как и слой поверх
 * холста (метки обсуждений) и боковую панель.
 * Пока пользователь следует за участником, доска обведена цветом участника, а любое
 * нажатие на ней прекращает следование: пользователь взялся за доску сам.
 */
export function BoardView({
  editor,
  presence,
  follow,
  files,
  header,
  overlay,
  aside,
}: {
  editor: Editor;
  presence?: Presence;
  follow?: Follow;
  files: BoardFiles;
  header: ReactNode;
  /** Поверх холста, под панелями управления. */
  overlay?: ReactNode;
  /** Справа от холста. Холст становится уже. */
  aside?: ReactNode;
}) {
  const state = useEditorState(editor);
  const [shapesOpen, setShapesOpen] = useState(false);
  const { insert, uploading, error, dismissError } = useFileInsert(editor, files);
  const picker = useRef<HTMLInputElement>(null);
  const [minimap, setMinimap] = useStoredFlag(storageKeys.minimap, true);
  const leader = useLeader(follow);
  return (
    <div className={styles.app}>
      {header}
      <main className={styles.main}>
        <div className={styles.stage} onPointerDownCapture={() => follow?.stop()}>
          <Board
            editor={editor}
            presence={presence}
            images={files.images}
            onOpenFile={(file) => files.open(file)}
            onInsertFiles={state.readOnly ? undefined : (chosen, at) => void insert(chosen, at)}
          />
          {overlay}
          {leader && (
            <div
              className={styles.followFrame}
              style={{ borderColor: leader.color }}
              aria-hidden="true"
            />
          )}
          {state.editingId && (
            <TextEditor key={state.editingId} editor={editor} id={state.editingId} />
          )}
          <div className={styles.toolbar}>
            {state.readOnly ? (
              <div className={styles.viewerBar}>
                <IconButton
                  icon={COMMENT_TOOL.id}
                  label={COMMENT_TOOL.label}
                  shortcut={COMMENT_TOOL.key}
                  pressed={state.tool === COMMENT_TOOL.id}
                  onClick={() => editor.setTool('comment')}
                />
                <p className={styles.readOnly} role="status">
                  Только просмотр
                </p>
              </div>
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
          <div className={styles.notices}>
            {follow && leader && <FollowNotice leader={leader} onStop={() => follow.stop()} />}
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
          </div>
          {shapesOpen && !state.readOnly && (
            <ShapePanel
              tool={state.tool}
              onPick={(tool, preset) => editor.setTool(tool, preset)}
              onClose={() => setShapesOpen(false)}
            />
          )}
          <PageTabs editor={editor} pageId={state.pageId} readOnly={state.readOnly} />
          <div className={styles.navigator}>
            {minimap && <Minimap editor={editor} presence={presence} />}
            <ZoomControls
              zoom={state.camera.zoom}
              onZoomOut={() => editor.zoomBy(1 / ZOOM_STEP)}
              onZoomIn={() => editor.zoomBy(ZOOM_STEP)}
              onReset={() => editor.resetZoom()}
              onFit={() => editor.zoomToFit()}
              minimap={minimap}
              onMinimapToggle={() => setMinimap(!minimap)}
            />
          </div>
        </div>
        {aside}
      </main>
    </div>
  );
}
