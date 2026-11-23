import { useEffect, useEffectEvent, useRef } from 'react';
import type { Presence } from '../collab/presence';
import type { Editor, Tool } from '../editor/Editor';
import type { FileRef, Point } from '../model/types';
import { modalDialogOpen } from '../ui/modal';
import { subscribeTheme } from '../ui/theme';
import { screenToWorld } from './camera';
import styles from './Board.module.css';
import type { ImageCache } from './images';
import { renderBoard } from './render';
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

/** Холст доски. Передаёт события в редактор и перерисовывает кадр, только когда что-то изменилось. */
export function Board({ editor, presence, images, onOpenFile, onInsertFiles }: BoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let frame = 0;
    let dirty = true;
    const requestDraw = () => {
      dirty = true;
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      editor.setViewport({ width: canvas.clientWidth, height: canvas.clientHeight });
    };

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!dirty) return;
      dirty = false;
      canvas.style.cursor = editor.spaceHeld ? 'grab' : cursorFor(editor.tool);
      renderBoard(ctx, editor, {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        dpr: window.devicePixelRatio || 1,
        theme: readTheme(canvas),
        peers: presence?.peers() ?? [],
        images: images?.get,
      });
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
      editor.pointerDown(local(e), { button: e.button, shift: e.shiftKey });
    };
    const onPointerMove = (e: PointerEvent) => {
      // Берём все промежуточные точки, которые браузер склеил в одно событие.
      // Safari до версии 18 не умеет getCoalescedEvents.
      const coalesced = 'getCoalescedEvents' in e ? e.getCoalescedEvents() : [];
      for (const ev of coalesced.length > 0 ? coalesced : [e]) {
        editor.pointerMove(local(ev), { shift: e.shiftKey });
      }
    };
    const onPointerUp = () => {
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
        requestDraw();
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

    const unsubscribe = editor.subscribe(requestDraw);
    const unsubscribePresence = presence?.subscribe(requestDraw);
    const unsubscribeImages = images?.subscribe(requestDraw);
    const unsubscribeTheme = subscribeTheme(requestDraw);
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
    frame = requestAnimationFrame(render);

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

  return <canvas ref={canvasRef} className={styles.canvas} aria-label="Холст доски" />;
}
