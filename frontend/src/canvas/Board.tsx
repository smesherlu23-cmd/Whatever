import { useEffect, useEffectEvent, useRef } from 'react';
import type { Presence } from '../collab/presence';
import type { Editor, Tool } from '../editor/Editor';
import type { FileRef, Point } from '../model/types';
import { modalDialogOpen } from '../ui/modal';
import { subscribeTheme } from '../ui/theme';
import { screenToWorld } from './camera';
import styles from './Board.module.css';
import type { ImageCache } from './images';
import { renderOverlay, renderScene } from './render';
import { readTheme } from './scene';

/** Курсор над холстом: стрелка для выделения, I-образный для текста, перекрестие для рисования. */
function cursorFor(tool: Tool): string {
  if (tool === 'select') return 'default';
  return tool === 'text' ? 'text' : 'crosshair';
}

const TYPING_TARGETS = 'input, textarea, select, [contenteditable="true"]';

/** Клавиши и вставка достаются не доске, а открытому окну или полю, в котором печатают. */
const notForBoard = (e: Event): boolean =>
  modalDialogOpen() || (e.target instanceof Element && e.target.closest(TYPING_TARGETS) !== null);

const hasFiles = (data: DataTransfer | null): data is DataTransfer =>
  data !== null && Array.from(data.types).includes('Files');

export interface BoardProps {
  editor: Editor;
  presence?: Presence;
  /** Картинки файлов доски. Без них на месте картинок рисуются заглушки. */
  images?: ImageCache;
  /** Двойной щелчок по картинке или вложению. */
  onOpenFile?: (file: FileRef) => void;
  /**
   * Файлы, брошенные на холст или вставленные из буфера обмена, и точка вставки в мировых
   * координатах. Без обработчика холст файлы не принимает.
   */
  onInsertFiles?: (files: File[], at: Point) => void;
}

/**
 * Холст доски. Передаёт события в редактор и перерисовывает кадр, только когда что-то
 * изменилось, причём сцену — только когда изменилась она сама.
 */
export function Board({ editor, presence, images, onOpenFile, onInsertFiles }: BoardProps) {
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const acceptsFiles = onInsertFiles !== undefined;
  const insertFiles = useEffectEvent((files: File[], at: Point) => {
    onInsertFiles?.(files, at);
  });
  const openFile = useEffectEvent((file: FileRef): boolean => {
    if (!onOpenFile) return false;
    onOpenFile(file);
    return true;
  });

  useEffect(() => {
    const canvas = overlayRef.current;
    const sceneCanvas = sceneRef.current;
    const ctx = canvas?.getContext('2d');
    const sceneCtx = sceneCanvas?.getContext('2d');
    if (!canvas || !sceneCanvas || !ctx || !sceneCtx) return;

    // Сцена перерисовывается, когда изменились документ, камера, тема или картинки;
    // слой поверх неё — при любом изменении (выделение, штрих, чужие курсоры).
    let sceneDirty = true;
    let overlayDirty = true;
    // Что было на сцене в прошлый раз. Снимок страницы и камера неизменяемы: новое значение —
    // новый объект, поэтому хватает сравнения ссылок.
    let drawn: { elements: unknown; camera: unknown; editingId: string | null } | null = null;

    // Положения указателя копятся до ближайшего кадра и отдаются редактору разом.
    let moves: Point[] = [];
    let moveShift = false;
    const flushMoves = () => {
      if (moves.length === 0) return;
      const batch = moves;
      moves = [];
      editor.pointerMoves(batch, { shift: moveShift });
    };

    // Кадр запрашивается, только когда есть что рисовать: в простое поток не просыпается.
    let frame = 0;
    const render = () => {
      // Изменения от накопленных движений попадут в этот же кадр, нового не нужно.
      flushMoves();
      frame = 0;
      if (!sceneDirty && !overlayDirty) return;
      const size = {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        dpr: window.devicePixelRatio || 1,
        theme: readTheme(canvas),
      };
      canvas.style.cursor = editor.spaceHeld ? 'grab' : cursorFor(editor.tool);
      if (sceneDirty) {
        renderScene(sceneCtx, editor, { ...size, images: images?.get });
        drawn = {
          elements: editor.page.list(),
          camera: editor.camera,
          editingId: editor.editingId,
        };
      }
      renderOverlay(ctx, editor, { ...size, peers: presence?.peers() ?? [] });
      sceneDirty = false;
      overlayDirty = false;
    };
    const scheduleFrame = () => {
      if (frame === 0) frame = requestAnimationFrame(render);
    };
    const requestScene = () => {
      sceneDirty = true;
      overlayDirty = true;
      scheduleFrame();
    };
    const requestOverlay = () => {
      overlayDirty = true;
      scheduleFrame();
    };
    const onEditorChange = () => {
      if (
        drawn?.elements !== editor.page.list() ||
        drawn.camera !== editor.camera ||
        drawn.editingId !== editor.editingId
      ) {
        sceneDirty = true;
      }
      requestOverlay();
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const layer of [sceneCanvas, canvas]) {
        layer.width = canvas.clientWidth * dpr;
        layer.height = canvas.clientHeight * dpr;
      }
      editor.setViewport({ width: canvas.clientWidth, height: canvas.clientHeight });
      requestScene();
    };

    const local = (e: { clientX: number; clientY: number }): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    /** Где указатель над холстом; null — он за пределами холста. */
    let pointer: Point | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      editor.wheel(local(e), e.deltaX, e.deltaY, e.ctrlKey || e.metaKey);
    };
    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      // Движения до нажатия относятся к прошлому жесту (или к наведению), а не к новому.
      flushMoves();
      editor.pointerDown(local(e), { button: e.button, shift: e.shiftKey });
    };
    const onPointerMove = (e: PointerEvent) => {
      // Берём все промежуточные точки, которые браузер склеил в одно событие.
      // Safari до версии 18 не умеет getCoalescedEvents.
      const coalesced = 'getCoalescedEvents' in e ? e.getCoalescedEvents() : [];
      for (const ev of coalesced.length > 0 ? coalesced : [e]) moves.push(local(ev));
      moveShift = e.shiftKey;
      scheduleFrame();
    };
    const onPointerUp = () => {
      // Жест заканчивается там, куда указатель успел дойти, даже если кадр ещё не наступил.
      flushMoves();
      editor.pointerUp();
    };
    const onHover = (e: PointerEvent) => {
      pointer = local(e);
      presence?.setCursor(screenToWorld(editor.camera, pointer));
    };
    const onLeave = () => {
      pointer = null;
      presence?.setCursor(null);
    };
    const onDoubleClick = (e: MouseEvent) => {
      const file = editor.attachmentAt(local(e));
      if (file && openFile(file)) return;
      editor.doubleClick(local(e));
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      // Без preventDefault браузер не даст бросить файл и откроет его сам.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) insertFiles(files, screenToWorld(editor.camera, local(e)));
    };
    // Снимок экрана из буфера обмена встаёт под указатель, а если он не над холстом — в середину.
    const onPaste = (e: ClipboardEvent) => {
      if (notForBoard(e)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      insertFiles(files, pointer ? screenToWorld(editor.camera, pointer) : editor.viewportCenter());
    };

    const onKey = (e: KeyboardEvent) => {
      if (notForBoard(e)) return;
      if (e.code === 'Space') {
        editor.spaceHeld = e.type === 'keydown';
        requestOverlay();
        e.preventDefault();
        return;
      }
      if (e.type !== 'keydown') return;
      const handled = editor.keyDown({
        key: e.key,
        code: e.code,
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
      });
      if (handled) e.preventDefault();
    };

    const unsubscribe = editor.subscribe(onEditorChange);
    const unsubscribePresence = presence?.subscribe(requestOverlay);
    const unsubscribeImages = images?.subscribe(requestScene);
    const unsubscribeTheme = subscribeTheme(requestScene);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Один AbortController снимает все обработчики разом и не даёт забыть какой-то из них.
    const listeners = new AbortController();
    const { signal } = listeners;
    canvas.addEventListener('wheel', onWheel, { passive: false, signal });
    canvas.addEventListener('pointerdown', onPointerDown, { signal });
    canvas.addEventListener('pointermove', onPointerMove, { signal });
    canvas.addEventListener('pointermove', onHover, { signal });
    canvas.addEventListener('pointerup', onPointerUp, { signal });
    canvas.addEventListener('pointercancel', onPointerUp, { signal });
    canvas.addEventListener('pointerleave', onLeave, { signal });
    canvas.addEventListener('dblclick', onDoubleClick, { signal });
    if (acceptsFiles) {
      canvas.addEventListener('dragover', onDragOver, { signal });
      canvas.addEventListener('drop', onDrop, { signal });
      window.addEventListener('paste', onPaste, { signal });
    }
    window.addEventListener('keydown', onKey, { signal });
    window.addEventListener('keyup', onKey, { signal });
    scheduleFrame();

    return () => {
      cancelAnimationFrame(frame);
      listeners.abort();
      observer.disconnect();
      unsubscribe();
      unsubscribePresence?.();
      unsubscribeImages?.();
      unsubscribeTheme();
    };
  }, [editor, presence, images, acceptsFiles]);

  // Два холста друг над другом: сцена внизу, курсоры и выделения сверху. События получает
  // верхний.
  return (
    <div className={styles.board}>
      <canvas ref={sceneRef} className={styles.layer} aria-hidden="true" />
      <canvas ref={overlayRef} className={styles.layer} aria-label="Холст доски" />
    </div>
  );
}
