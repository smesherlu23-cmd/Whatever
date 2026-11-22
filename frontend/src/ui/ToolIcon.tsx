import type { ReactNode } from 'react';

/** Иконки панели инструментов. Фигуры из наборов рисует ShapeIcon по каталогу. */
export type IconName =
  | 'select'
  | 'pen'
  | 'arrow'
  | 'rectangle'
  | 'rounded'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'sticky'
  | 'text'
  | 'shapes'
  | 'image'
  | 'fit'
  | 'map'
  | 'undo'
  | 'redo';

/** Контуры иконок в квадрате 20×20. Рисуются линией цвета текста. */
const ICONS: Record<IconName, ReactNode> = {
  select: <path d="M5 3l10 6.5-4.5 1.2L13 16l-2 1-2.6-5.3L5 14.5z" />,
  pen: <path d="M3.5 16.5l1-4 9-9 3 3-9 9zM12 5l3 3" />,
  rectangle: <rect x="3" y="5" width="14" height="10" rx="1" />,
  rounded: <rect x="3" y="5" width="14" height="10" rx="4" />,
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="6" />,
  diamond: <path d="M10 3l7 7-7 7-7-7z" />,
  triangle: <path d="M10 3.5l7 13H3z" />,
  sticky: <path d="M4 4h12v8l-4 4H4zM16 12h-4v4" />,
  arrow: <path d="M4 16L16 4M9 4h7v7" />,
  text: <path d="M5 5h10M10 5v11M7.5 16h5" />,
  shapes: (
    <>
      <circle cx="6.5" cy="6.5" r="3.5" />
      <rect x="11" y="3" width="6" height="7" rx="1" />
      <path d="M10 11.5l4.5 6h-9z" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M5.5 13.5l3.5-4 2.5 2.5 1.5-1.5 2 3" />
      <circle cx="13" cy="7.5" r="1.2" />
    </>
  ),
  fit: <path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5" />,
  map: <path d="M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2zM7.5 3.5v11M12.5 5.5v11" />,
  undo: <path d="M7.5 5L4 8.5 7.5 12M4 8.5h8a4 4 0 010 8H9" />,
  redo: <path d="M12.5 5L16 8.5 12.5 12M16 8.5H8a4 4 0 000 8h3" />,
};

export function ToolIcon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
