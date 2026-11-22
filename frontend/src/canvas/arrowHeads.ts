import type { ArrowHead, Point } from '../model/types';

/**
 * Часть наконечника. Закрашенный многоугольник заливается цветом линии, пустой — цветом
 * фона, чтобы линия под ним не просвечивала. Кружок всегда пустой.
 */
export type HeadPart =
  | { type: 'polygon'; points: readonly Point[]; filled: boolean }
  | { type: 'polyline'; points: readonly Point[] }
  | { type: 'circle'; center: Point; radius: number };

export interface HeadShape {
  /** Части в своих координатах: остриё в (0, 0), линия приходит слева, по оси −x. */
  readonly parts: readonly HeadPart[];
  /** На столько линия не доходит до острия, чтобы не торчать из наконечника. */
  readonly inset: number;
}

const p = (x: number, y: number): Point => ({ x, y });

/** Обычный наконечник: длина 12 и раствор ±π/7, как у стрелок до появления других видов. */
const ARROW_LENGTH = 12;
const wing = p(-ARROW_LENGTH * Math.cos(Math.PI / 7), ARROW_LENGTH * Math.sin(Math.PI / 7));
const wings = [p(wing.x, -wing.y), p(0, 0), wing];

const diamond = [p(0, 0), p(-9, -5.5), p(-18, 0), p(-9, 5.5)];
/** «Воронья лапка»: три линии сходятся на линии связи, расходясь к фигуре. */
const crowfoot = [p(0, -7), p(-12, 0), p(0, 7)];
const bar = (x: number): HeadPart => ({ type: 'polyline', points: [p(x, -7), p(x, 7)] });
const ring = (x: number): HeadPart => ({ type: 'circle', center: p(x, 0), radius: 4.5 });

export const HEAD_SHAPES: Readonly<Record<ArrowHead, HeadShape>> = {
  none: { parts: [], inset: 0 },
  arrow: {
    parts: [{ type: 'polygon', points: wings, filled: true }],
    inset: ARROW_LENGTH * 0.8,
  },
  open: { parts: [{ type: 'polyline', points: wings }], inset: 0 },
  triangle: {
    parts: [{ type: 'polygon', points: [p(0, 0), p(-14, -7.5), p(-14, 7.5)], filled: false }],
    inset: 14,
  },
  diamond: { parts: [{ type: 'polygon', points: diamond, filled: false }], inset: 18 },
  filledDiamond: { parts: [{ type: 'polygon', points: diamond, filled: true }], inset: 18 },
  circle: { parts: [{ type: 'circle', center: p(-5, 0), radius: 5 }], inset: 10 },
  one: { parts: [bar(-6), bar(-11)], inset: 0 },
  zeroOrOne: { parts: [bar(-6), ring(-15.5)], inset: 0 },
  many: { parts: [{ type: 'polyline', points: crowfoot }, bar(-15)], inset: 0 },
  zeroOrMany: { parts: [{ type: 'polyline', points: crowfoot }, ring(-17.5)], inset: 0 },
};

export const HEAD_NAMES: Readonly<Record<ArrowHead, string>> = {
  none: 'Без наконечника',
  arrow: 'Стрелка',
  open: 'Открытая стрелка',
  triangle: 'Треугольник: наследование',
  diamond: 'Пустой ромб: агрегация',
  filledDiamond: 'Закрашенный ромб: композиция',
  circle: 'Кружок',
  one: 'Ровно один',
  zeroOrOne: 'Ноль или один',
  many: 'Один или много',
  zeroOrMany: 'Ноль или много',
};

function trace(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (const point of rest) ctx.lineTo(point.x, point.y);
}

/**
 * Рисует наконечник с остриём в tip, повёрнутый на angle (направление линии к острию).
 * Толщину и цвет линии задаёт вызывающий; fill — цвет линии, background — цвет фона.
 */
export function drawHead(
  ctx: CanvasRenderingContext2D,
  head: ArrowHead,
  tip: Point,
  angle: number,
  colors: { fill: string; background: string },
): void {
  const { parts } = HEAD_SHAPES[head];
  if (parts.length === 0) return;
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(angle);
  ctx.setLineDash([]);
  for (const part of parts) {
    ctx.beginPath();
    if (part.type === 'circle') {
      ctx.arc(part.center.x, part.center.y, part.radius, 0, Math.PI * 2);
      ctx.fillStyle = colors.background;
      ctx.fill();
    } else {
      trace(ctx, part.points);
      if (part.type === 'polygon') {
        ctx.closePath();
        ctx.fillStyle = part.filled ? colors.fill : colors.background;
        ctx.fill();
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}
