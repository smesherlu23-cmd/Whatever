import { useEffect, useRef } from 'react';
import type { Editor } from '../editor/Editor';
import styles from './Board.module.css';
import { readTheme, renderBoard } from './render';

const CURSORS: Record<string, string> = {
  select: 'default',
  rectangle: 'crosshair',
  ellipse: 'crosshair',
  diamond: 'crosshair',
  arrow: 'crosshair',
  text: 'text',
};

/** Холст доски. Передаёт события в редактор и перерисовывает кадр, только когда что-то изменилось. */
export function Board({ editor }: { editor: Editor }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
      canvas.style.cursor = editor.spaceHeld ? 'grab' : CURSORS[editor.tool];
      renderBoard(
        ctx,
        editor,
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio || 1,
        readTheme(canvas),
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
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) {
        editor.pointerMove(local(ev), { shift: e.shiftKey });
      }
    };
    const onPointerUp = () => editor.pointerUp();
    const onDoubleClick = (e: MouseEvent) => editor.doubleClick(local(e));

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
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
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [editor]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-label="Холст доски" />;
}
