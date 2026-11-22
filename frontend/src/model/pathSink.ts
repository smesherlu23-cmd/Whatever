import type { Point } from './types';

/**
 * То, куда фигура рисует свой контур. Это подмножество CanvasRenderingContext2D, поэтому
 * холст подходит без обёрток, а SvgPath строит из того же описания путь для иконок.
 */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  /** Дуга эллипса без поворота, по правилам холста: от start до end, по часовой, если не ccw. */
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw?: boolean,
  ): void;
  roundRect(x: number, y: number, w: number, h: number, radius: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
}

const TAU = Math.PI * 2;
const n = (value: number) => String(Math.round(value * 100) / 100);

/** Строит атрибут d элемента <path> по тем же командам, что понимает холст. */
export class SvgPath implements PathSink {
  private readonly parts: string[] = [];
  private current: Point | null = null;
  private subpathStart: Point | null = null;

  toString(): string {
    return this.parts.join(' ');
  }

  moveTo(x: number, y: number): void {
    this.parts.push(`M${n(x)} ${n(y)}`);
    this.current = { x, y };
    this.subpathStart = { x, y };
  }

  lineTo(x: number, y: number): void {
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    this.parts.push(`L${n(x)} ${n(y)}`);
    this.current = { x, y };
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    if (!this.current) this.moveTo(c1x, c1y);
    this.parts.push(`C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)}`);
    this.current = { x, y };
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    if (!this.current) this.moveTo(cx, cy);
    this.parts.push(`Q${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`);
    this.current = { x, y };
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    _rotation: number,
    start: number,
    end: number,
    ccw = false,
  ): void {
    const at = (angle: number): Point => ({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
    const raw = ccw ? start - end : end - start;
    const sweep = raw >= TAU ? TAU : ((raw % TAU) + TAU) % TAU;
    const direction = ccw ? -1 : 1;
    const from = at(start);
    // Как на холсте: дуга продолжает текущий путь прямой от последней точки.
    if (this.current) this.lineTo(from.x, from.y);
    else this.moveTo(from.x, from.y);
    const flag = ccw ? 0 : 1;
    const arc = (to: Point, large: number) => {
      this.parts.push(`A${n(rx)} ${n(ry)} 0 ${large} ${flag} ${n(to.x)} ${n(to.y)}`);
      this.current = to;
    };
    if (sweep === TAU) {
      // Полный эллипс одной дугой SVG не нарисовать: две половины.
      arc(at(start + direction * Math.PI), 0);
      arc(from, 0);
      return;
    }
    arc(at(start + direction * sweep), sweep > Math.PI ? 1 : 0);
  }

  roundRect(x: number, y: number, w: number, h: number, radius: number): void {
    const r = Math.max(0, Math.min(radius, w / 2, h / 2));
    const corner = (tx: number, ty: number) =>
      r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(tx)} ${n(ty)}` : `L${n(tx)} ${n(ty)}`;
    this.parts.push(
      `M${n(x + r)} ${n(y)}`,
      `L${n(x + w - r)} ${n(y)}`,
      corner(x + w, y + r),
      `L${n(x + w)} ${n(y + h - r)}`,
      corner(x + w - r, y + h),
      `L${n(x + r)} ${n(y + h)}`,
      corner(x, y + h - r),
      `L${n(x)} ${n(y + r)}`,
      corner(x + r, y),
      'Z',
    );
    this.current = { x, y };
    this.subpathStart = { x, y };
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.roundRect(x, y, w, h, 0);
  }

  closePath(): void {
    this.parts.push('Z');
    this.current = this.subpathStart;
  }
}
