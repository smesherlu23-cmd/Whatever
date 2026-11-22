import { HEAD_SHAPES, type HeadPart } from '../canvas/arrowHeads';
import type { ArrowHead } from '../model/types';

/** Наконечники в иконке мельче, чем на холсте. */
const SCALE = 0.8;
const WIDTH = 40;
const HEIGHT = 20;
const MARGIN = 4;

function points(part: Extract<HeadPart, { points: unknown }>): string {
  return part.points.map((p) => `${p.x},${p.y}`).join(' ');
}

function Part({ part }: { part: HeadPart }) {
  // Пустые части заливаются цветом панели, как на холсте — цветом фона.
  const hollow = 'var(--bg-panel)';
  switch (part.type) {
    case 'polygon':
      return <polygon points={points(part)} fill={part.filled ? 'currentColor' : hollow} />;
    case 'polyline':
      return <polyline points={points(part)} fill="none" />;
    case 'circle':
      return <circle cx={part.center.x} cy={part.center.y} r={part.radius} fill={hollow} />;
  }
}

/**
 * Отрезок с наконечником head на правом (end) или левом (start) конце: как стрелка
 * выглядит на холсте. dashed рисует линию пунктиром.
 */
export function HeadIcon({
  head,
  side,
  dashed = false,
}: {
  head: ArrowHead;
  side: 'start' | 'end';
  dashed?: boolean;
}) {
  const shape = HEAD_SHAPES[head];
  const tip = side === 'end' ? WIDTH - MARGIN : MARGIN;
  const inset = shape.inset * SCALE * (side === 'end' ? -1 : 1);
  const [x1, x2] = side === 'end' ? [MARGIN, tip + inset] : [tip + inset, WIDTH - MARGIN];
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line
        x1={x1}
        y1={HEIGHT / 2}
        x2={x2}
        y2={HEIGHT / 2}
        strokeDasharray={dashed ? '4 3' : undefined}
      />
      <g
        transform={`translate(${tip} ${HEIGHT / 2}) rotate(${side === 'end' ? 0 : 180}) scale(${SCALE})`}
        strokeWidth={1.5 / SCALE}
      >
        {shape.parts.map((part, i) => (
          <Part key={i} part={part} />
        ))}
      </g>
    </svg>
  );
}
