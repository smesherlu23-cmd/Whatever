import { useEffect, useRef } from 'react';
import type { Presence } from '../collab/presence';
import type { Editor, Tool } from '../editor/Editor';
import { screenToWorld } from './camera';
import styles from './Board.module.css';
import { subscribeTheme } from '../ui/theme';
import { renderBoard } from './render';
import { readTheme } from './scene';

/** Курсор над холстом: стрелка для выделения, I-образный для текста, перекрестие для рисования. */
function cursorFor(tool: Tool): string {
  if (tool === 'select') return 'default';
  return tool === 'text' ? 'text' : 'crosshair';
}

const TYPING_TARGETS = 'input, textarea, select, [contenteditable="true"]';

/** Холст доски. Передаёт события в редактор и перерисовывает кадр, только когда что-то изменилось. */
export function Board({ editor, presence }: { editor: Editor; presence?: Presence }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      requestDraw();
    };

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!dirty) return;
      dirty = false;
      canvas.style.cursor = editor.spaceHeld ? 'grab' : cursorFor(editor.tool);
      renderBoard(
        ctx,
        editor,
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio || 1,
        readTheme(canvas),
        presence?.peers() ?? [],
      );
    };

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

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
      presence?.setCursor(screenToWorld(editor.camera, local(e)));
    };
    const onLeave = () => {
      presence?.setCursor(null);
    };
    const onDoubleClick = (e: MouseEvent) => {
      editor.doubleClick(local(e));
    };

    const onKey = (e: KeyboardEvent) => {
      // Пока пользователь печатает в поле ввода, клавиши принадлежат полю.
      if (e.target instanceof Element && e.target.closest(TYPING_TARGETS)) return;
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
    window.addEventListener('keydown', onKey, { signal });
    window.addEventListener('keyup', onKey, { signal });
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      listeners.abort();
      observer.disconnect();
      unsubscribe();
      unsubscribePresence?.();
      unsubscribeTheme();
    };
  }, [editor, presence]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-label="Холст доски" />;
}
