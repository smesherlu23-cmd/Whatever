import { ToolIcon } from './ToolIcon';
import styles from './ZoomControls.module.css';

/** Масштаб доски: кнопки «меньше» и «больше», текущий масштаб, «показать всё» и мини-карта. */
export function ZoomControls({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
  onFit,
  minimap,
  onMinimapToggle,
}: {
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  /** Вернуть масштаб 100%. */
  onReset: () => void;
  onFit: () => void;
  minimap: boolean;
  onMinimapToggle: () => void;
}) {
  const percent = Math.round(zoom * 100);
  return (
    <div className={styles.controls} role="group" aria-label="Масштаб">
      <button type="button" aria-label="Уменьшить" title="Уменьшить (Ctrl+−)" onClick={onZoomOut}>
        −
      </button>
      <button
        type="button"
        className={styles.percent}
        aria-label={`Масштаб ${percent}%, вернуть 100%`}
        title="Масштаб 100% (Shift+0)"
        onClick={onReset}
      >
        {percent}%
      </button>
      <button type="button" aria-label="Увеличить" title="Увеличить (Ctrl++)" onClick={onZoomIn}>
        +
      </button>
      <button
        type="button"
        aria-label="Показать всё"
        title="Показать всё (Shift+1), выделенное — Shift+2"
        onClick={onFit}
      >
        <ToolIcon name="fit" />
      </button>
      <button
        type="button"
        aria-label="Мини-карта"
        aria-pressed={minimap}
        title="Мини-карта"
        onClick={onMinimapToggle}
      >
        <ToolIcon name="map" />
      </button>
    </div>
  );
}
