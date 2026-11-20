import { useEffect, useRef } from 'react';
import { type Camera, initialCamera, panBy, zoomAt } from './camera';
import { drawGrid } from './grid';
import styles from './Board.module.css';

/** Холст доски: бесконечная сетка, сдвиг и масштаб. Перерисовка через requestAnimationFrame. */
export function Board({ onZoomChange }: { onZoomChange?: (zoom: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>(initialCamera);

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
      const dpr = window.devicePixelRatio || 1;
      const style = getComputedStyle(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = style.getPropertyValue('--canvas-bg');
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      drawGrid(
        ctx,
        cameraRef.current,
        canvas.clientWidth,
        canvas.clientHeight,
        style.getPropertyValue('--canvas-grid'),
      );
    };

    const setCamera = (camera: Camera) => {
      cameraRef.current = camera;
      onZoomChange?.(camera.zoom);
      requestDraw();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setCamera(zoomAt(cameraRef.current, point, Math.exp(-e.deltaY * 0.01)));
      } else {
        setCamera(panBy(cameraRef.current, -e.deltaX, -e.deltaY));
      }
    };

    let dragging: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      // Средняя кнопка или пробел + левая кнопка двигают холст.
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        dragging = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      setCamera(panBy(cameraRef.current, e.clientX - dragging.x, e.clientY - dragging.y));
      dragging = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = () => {
      dragging = null;
    };

    let spaceHeld = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld = e.type === 'keydown';
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [onZoomChange]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-label="Холст доски" />;
}
