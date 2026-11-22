import { SvgPath } from '../model/pathSink';
import { type CatalogKind, shapeSpec } from '../model/shapes';
import type { Bounds } from '../model/types';

const VIEW = 24;

/** Рамка иконки по пропорциям фигуры: широкая, квадратная или высокая. */
function iconBox(kind: CatalogKind): Bounds {
  const { w, h } = shapeSpec(kind).size;
  const aspect = w / h;
  const [bw, bh] = aspect > 1.3 ? [20, 13] : aspect < 0.77 ? [12, 20] : [17, 17];
  return { x: (VIEW - bw) / 2, y: (VIEW - bh) / 2, w: bw, h: bh };
}

/** Иконка фигуры для панели: тот же контур, что на холсте, только маленький. */
export function ShapeIcon({ kind }: { kind: CatalogKind }) {
  const spec = shapeSpec(kind);
  const box = iconBox(kind);
  const outline = new SvgPath();
  spec.outline(outline, box);
  const details = new SvgPath();
  spec.details?.(details, box);
  if (spec.text === 'compartments') {
    // Секции класса на холсте рисует текст; в иконке их обозначают две линии.
    for (const share of [0.3, 0.62]) {
      details.moveTo(box.x, box.y + box.h * share);
      details.lineTo(box.x + box.w, box.y + box.h * share);
    }
  }
  const hasDetails = spec.details !== undefined || spec.text === 'compartments';
  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      width={VIEW}
      height={VIEW}
      fill="none"
      stroke="currentColor"
      strokeWidth={spec.stroke === 'bold' ? 2.4 : 1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={outline.toString()} strokeDasharray={spec.dashed ? '3 2' : undefined} />
      {hasDetails && (
        <path
          d={details.toString()}
          strokeWidth={1.3}
          strokeDasharray={spec.dashedDetails ? '2 2' : undefined}
        />
      )}
    </svg>
  );
}
