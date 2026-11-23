import { useEffect, useRef } from 'react';
import type { Presence } from '../collab/presence';
import type { Editor } from '../editor/Editor';
import { subscribeTheme } from '../ui/theme';
import { visibleBounds } from './camera';
import styles from './Minimap.module.css';
import { type MinimapView, drawMinimap, minimapToWorld, minimapView } from './minimap';
import { readTheme } from './scene';

const SIZE = { width: 200, height: 140 };

/**
 * Мини-карта страницы. Щелчок или перетаскивание по карте переносит туда середину окна.
 * Перерисовывается, только когда меняются доска, камера, участники или тема.
 */
export function Minimap({ editor, presence }: { editor: Editor; presence?: Presence }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE.width * dpr;
    canvas.height = SIZE.height * dpr;

    const currentView = () => minimapView(editor.page, editor.camera, editor.viewport, SIZE);
    let view = currentView();
    /** Пока карту тянут, её вид не меняется: иначе он уплывал бы вслед за камерой. */
    let dragging = false;
    let dirty = true;
    let frame = 0;
    const requestDraw = () => {
      dirty = true;
    };

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!dirty) return;
      dirty = false;
      if (!dragging) view = currentView();
      const markers = (presence?.peers() ?? []).flatMap((peer) =>
        peer.page === editor.pageId && peer.cursor ? [{ color: peer.color, at: peer.cursor }] : [],
      );
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE.width, SIZE.height);
      const visible = visibleBounds(editor.camera, editor.viewport);
      drawMinimap(ctx, view, editor.page, visible, readTheme(canvas), markers);
    };

    const jump = (e: PointerEvent, current: MinimapView) => {
      const rect = canvas.getBoundingClientRect();
      editor.centerOn(
        minimapToWorld(current, { x: e.clientX - rect.left, y: e.clientY - rect.top }),
      );
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      dragging = true;
      jump(e, view);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragging) jump(e, view);
    };
    const onPointerUp = () => {
      dragging = false;
      requestDraw();
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    canvas.addEventListener('pointerdown', onPointerDown, { signal });
    canvas.addEventListener('pointermove', onPointerMove, { signal });
    canvas.addEventListener('pointerup', onPointerUp, { signal });
    canvas.addEventListener('pointercancel', onPointerUp, { signal });
    const unsubscribe = editor.subscribe(requestDraw);
    const unsubscribePresence = presence?.subscribe(requestDraw);
    const unsubscribeTheme = subscribeTheme(requestDraw);
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      listeners.abort();
      unsubscribe();
      unsubscribePresence?.();
      unsubscribeTheme();
    };
  }, [editor, presence]);

  return (
    <canvas
      ref={ref}
      className={styles.minimap}
      style={SIZE}
      aria-label="Мини-карта: щелчок переносит сюда вид"
    />
  );
}
