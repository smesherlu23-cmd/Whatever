import { useEffect, useRef } from 'react';
import type { ElementSource } from '../model/document';
import { subscribeTheme } from '../ui/theme';
import { readTheme } from './scene';
import { drawThumbnail } from './thumbnail';

/** Превью страницы доски размером width × height. Перерисовывается при смене темы. */
export function Thumbnail({
  source,
  width,
  height,
  className,
}: {
  source: ElementSource;
  width: number;
  height: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      // Новый размер холста заодно стирает прежний рисунок.
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawThumbnail(ctx, source, { width, height }, readTheme(canvas));
    };
    draw();
    return subscribeTheme(draw);
  }, [source, width, height]);

  return <canvas ref={ref} className={className} style={{ width, height }} aria-hidden="true" />;
}
