import type { PathSink } from './pathSink';
import type { Bounds, Point, ShapeKind } from './types';
import { DEFAULT_FILL, DEFAULT_STICKY_FILL } from './types';

/*
 * Каталог фигур. Для каждого вида здесь всё, что о нём нужно знать холсту, редактору
 * и панели фигур: контур, линии поверх заливки, где стоит текст, как в фигуру попадает
 * указатель и куда цепляются стрелки. Контур рисуется в PathSink, поэтому одно описание
 * годится и для холста, и для SVG-иконок панели.
 */

/** Виды фигур из каталога: все, кроме рукописного штриха. */
export type CatalogKind = Exclude<ShapeKind, 'path'>;

/** Как стоит текст фигуры. */
export type TextMode =
  /** Строки по центру области текста. */
  | 'center'
  /** Секции класса и сущности: имя по центру, ниже строки слева; секции делит строка «--». */
  | 'compartments'
  /** Одна строка в полосе заголовка контейнера, слева. */
  | 'title'
  /** Заголовок дорожки: снизу вверх в левой полосе. */
  | 'vertical';

/** Форма фигуры для попадания указателем и привязки стрелок. */
export type Hull =
  | { type: 'rect' }
  | { type: 'ellipse' }
  /** Выпуклый многоугольник; вершины по часовой стрелке на экране. */
  | { type: 'polygon'; points: (b: Bounds) => Point[] };

export interface ShapeSpec {
  /** Название на панели фигур. */
  label: string;
  /** Размер фигуры, поставленной щелчком. */
  size: { w: number; h: number };
  fill: string;
  /** Замкнутый контур: заливается и обводится. */
  outline(sink: PathSink, b: Bounds): void;
  /** Линии поверх заливки: только обводятся. */
  details?(sink: PathSink, b: Bounds): void;
  /** Линии details пунктиром: линия жизни. */
  dashedDetails?: boolean;
  /** Контур пунктиром: граница группы. */
  dashed?: boolean;
  /** Толщина обводки. У стикера и текста её нет, у конечного события BPMN она толще. */
  stroke: 'none' | 'normal' | 'bold';
  /** Тень, как у листка бумаги. */
  shadow?: boolean;
  hull: Hull;
  /**
   * Своя проверка попадания. Контейнер ловит указатель только рамкой и заголовком, чтобы
   * внутри можно было выделять то, что в нём лежит; линия жизни — шапкой и линией.
   */
  hit?(b: Bounds, p: Point, tolerance: number): boolean;
  text: TextMode;
  /** Область текста. Может выходить за рамку: подписи событий BPMN стоят под фигурой. */
  textBox(b: Bounds): Bounds;
  /** Контейнер: новый встаёт под остальные фигуры и при перетаскивании везёт содержимое. */
  container?: boolean;
  /** Стрелка цепляется к линии там, куда её привели, а не к краю: линия жизни. */
  anchored?: boolean;
}

/** Высота полосы заголовка у рамки и группы. */
export const TITLE_BAND = 32;
/** Ширина полосы заголовка дорожки. */
export const LANE_HEADER = 36;

const p = (x: number, y: number): Point => ({ x, y });
const whole = (b: Bounds): Bounds => b;
const inside = (b: Bounds, q: Point) =>
  q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h;
const grow = (b: Bounds, d: number): Bounds => ({
  x: b.x - d,
  y: b.y - d,
  w: b.w + d * 2,
  h: b.h + d * 2,
});
const RECT: Hull = { type: 'rect' };
const ELLIPSE: Hull = { type: 'ellipse' };

function polygon(points: (b: Bounds) => Point[]): {
  outline: ShapeSpec['outline'];
  hull: Hull;
} {
  return {
    outline: (sink, b) => {
      const [first, ...rest] = points(b);
      if (!first) return;
      sink.moveTo(first.x, first.y);
      for (const q of rest) sink.lineTo(q.x, q.y);
      sink.closePath();
    },
    hull: { type: 'polygon', points },
  };
}

/** Окружность как отдельный контур, без линии от предыдущей точки. */
function circle(sink: PathSink, cx: number, cy: number, r: number): void {
  sink.moveTo(cx + r, cy);
  sink.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
}

function line(sink: PathSink, a: Point, b: Point): void {
  sink.moveTo(a.x, a.y);
  sink.lineTo(b.x, b.y);
}

const ellipse = (sink: PathSink, b: Bounds) => {
  sink.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
};

/** У контейнера указатель ловят рамка и полоса заголовка. */
function containerHit(header: (b: Bounds) => Bounds) {
  return (b: Bounds, q: Point, tolerance: number) =>
    (inside(grow(b, tolerance), q) && !inside(grow(b, -tolerance), q)) || inside(header(b), q);
}

const titleBand = (b: Bounds): Bounds => ({ x: b.x, y: b.y, w: b.w, h: Math.min(TITLE_BAND, b.h) });
const laneHeader = (b: Bounds): Bounds => ({
  x: b.x,
  y: b.y,
  w: Math.min(LANE_HEADER, b.w),
  h: b.h,
});
const lifelineHead = (b: Bounds) => Math.min(44, b.h * 0.3);
/** Подпись под небольшими фигурами BPMN: в самой фигуре для неё нет места. */
const below = (b: Bounds): Bounds => ({ x: b.x - 50, y: b.y + b.h + 2, w: b.w + 100, h: 40 });

const diamond = polygon((b) => [
  p(b.x + b.w / 2, b.y),
  p(b.x + b.w, b.y + b.h / 2),
  p(b.x + b.w / 2, b.y + b.h),
  p(b.x, b.y + b.h / 2),
]);
const triangle = polygon((b) => [
  p(b.x + b.w / 2, b.y),
  p(b.x + b.w, b.y + b.h),
  p(b.x, b.y + b.h),
]);
const slant = (b: Bounds) => Math.min(b.w * 0.2, b.h * 0.5);
const parallelogram = polygon((b) => {
  const s = slant(b);
  return [p(b.x + s, b.y), p(b.x + b.w, b.y), p(b.x + b.w - s, b.y + b.h), p(b.x, b.y + b.h)];
});
const hexagon = polygon((b) => {
  const s = slant(b);
  const my = b.y + b.h / 2;
  return [
    p(b.x + s, b.y),
    p(b.x + b.w - s, b.y),
    p(b.x + b.w, my),
    p(b.x + b.w - s, b.y + b.h),
    p(b.x + s, b.y + b.h),
    p(b.x, my),
  ];
});
const fold = (b: Bounds) => Math.min(16, b.w * 0.25, b.h * 0.3);
const note = polygon((b) => {
  const c = fold(b);
  return [
    p(b.x, b.y),
    p(b.x + b.w - c, b.y),
    p(b.x + b.w, b.y + c),
    p(b.x + b.w, b.y + b.h),
    p(b.x, b.y + b.h),
  ];
});
const narrow = (b: Bounds, dx: number, dy = 0): Bounds => ({
  x: b.x + dx,
  y: b.y + dy,
  w: b.w - dx * 2,
  h: b.h - dy * 2,
});

const cylinderLid = (b: Bounds) => Math.min(14, b.h * 0.14);
const tubeCap = (b: Bounds) => Math.min(14, b.w * 0.12);
const serverSlot = (b: Bounds) => Math.min(14, b.h * 0.16);
const browserBar = (b: Bounds) => Math.min(22, b.h * 0.22);
const personHead = (b: Bounds) => Math.min(b.w * 0.2, b.h * 0.2);
/** Человечек актёра занимает верх рамки, имя пишется под ним. */
const actorFigure = (b: Bounds) => b.h * 0.74;
const packageTab = (b: Bounds) => ({ w: Math.min(b.w * 0.4, 90), h: Math.min(20, b.h * 0.2) });

export const SHAPES: Readonly<Record<CatalogKind, ShapeSpec>> = {
  rectangle: {
    label: 'Прямоугольник',
    size: { w: 160, h: 80 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, Math.min(3, b.w / 4, b.h / 4)),
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: whole,
  },
  rounded: {
    label: 'Скруглённый прямоугольник',
    size: { w: 160, h: 80 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, Math.min(20, b.w / 3, b.h / 3)),
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: whole,
  },
  ellipse: {
    label: 'Эллипс',
    size: { w: 120, h: 120 },
    fill: DEFAULT_FILL,
    outline: ellipse,
    stroke: 'normal',
    hull: ELLIPSE,
    text: 'center',
    textBox: whole,
  },
  diamond: {
    label: 'Ромб',
    size: { w: 140, h: 100 },
    fill: DEFAULT_FILL,
    ...diamond,
    stroke: 'normal',
    text: 'center',
    textBox: whole,
  },
  triangle: {
    label: 'Треугольник',
    size: { w: 140, h: 120 },
    fill: DEFAULT_FILL,
    ...triangle,
    stroke: 'normal',
    text: 'center',
    // У вершины для текста нет места: он стоит в нижней половине.
    textBox: (b) => ({ x: b.x + b.w / 4, y: b.y + b.h / 2, w: b.w / 2, h: b.h / 2 }),
  },
  sticky: {
    label: 'Стикер',
    size: { w: 160, h: 160 },
    fill: DEFAULT_STICKY_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 2),
    stroke: 'none',
    shadow: true,
    hull: RECT,
    text: 'center',
    textBox: whole,
  },
  text: {
    label: 'Текст',
    size: { w: 160, h: 40 },
    fill: 'transparent',
    outline: (sink, b) => sink.rect(b.x, b.y, b.w, b.h),
    stroke: 'none',
    hull: RECT,
    text: 'center',
    textBox: whole,
  },
  note: {
    label: 'Заметка',
    size: { w: 160, h: 100 },
    fill: DEFAULT_FILL,
    ...note,
    details: (sink, b) => {
      const c = fold(b);
      sink.moveTo(b.x + b.w - c, b.y);
      sink.lineTo(b.x + b.w - c, b.y + c);
      sink.lineTo(b.x + b.w, b.y + c);
    },
    stroke: 'normal',
    text: 'center',
    textBox: whole,
  },
  terminal: {
    label: 'Начало или конец',
    size: { w: 160, h: 60 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) / 2),
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: whole,
  },
  data: {
    label: 'Данные',
    size: { w: 160, h: 80 },
    fill: DEFAULT_FILL,
    ...parallelogram,
    stroke: 'normal',
    text: 'center',
    textBox: (b) => narrow(b, slant(b) / 2),
  },
  document: {
    label: 'Документ',
    size: { w: 160, h: 90 },
    fill: DEFAULT_FILL,
    outline: (sink, { x, y, w, h }) => {
      sink.moveTo(x, y);
      sink.lineTo(x + w, y);
      sink.lineTo(x + w, y + h * 0.85);
      sink.quadraticCurveTo(x + w * 0.75, y + h * 0.7, x + w * 0.5, y + h * 0.85);
      sink.quadraticCurveTo(x + w * 0.25, y + h, x, y + h * 0.85);
      sink.closePath();
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({ ...b, h: b.h * 0.8 }),
  },
  subprocess: {
    label: 'Подпроцесс',
    size: { w: 160, h: 80 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 2),
    details: (sink, b) => {
      const s = Math.min(12, b.w * 0.1);
      line(sink, p(b.x + s, b.y), p(b.x + s, b.y + b.h));
      line(sink, p(b.x + b.w - s, b.y), p(b.x + b.w - s, b.y + b.h));
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => narrow(b, Math.min(12, b.w * 0.1)),
  },
  hexagon: {
    label: 'Подготовка',
    size: { w: 160, h: 80 },
    fill: DEFAULT_FILL,
    ...hexagon,
    stroke: 'normal',
    text: 'center',
    textBox: (b) => narrow(b, slant(b) / 2),
  },
  database: {
    label: 'База данных',
    size: { w: 120, h: 110 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => {
      const ry = cylinderLid(b);
      const cx = b.x + b.w / 2;
      sink.moveTo(b.x, b.y + ry);
      sink.lineTo(b.x, b.y + b.h - ry);
      sink.ellipse(cx, b.y + b.h - ry, b.w / 2, ry, 0, Math.PI, 0, true);
      sink.lineTo(b.x + b.w, b.y + ry);
      sink.ellipse(cx, b.y + ry, b.w / 2, ry, 0, 0, Math.PI, true);
      sink.closePath();
    },
    details: (sink, b) => {
      const ry = cylinderLid(b);
      sink.moveTo(b.x + b.w, b.y + ry);
      sink.ellipse(b.x + b.w / 2, b.y + ry, b.w / 2, ry, 0, 0, Math.PI);
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => {
      const ry = cylinderLid(b);
      return { x: b.x, y: b.y + ry * 2, w: b.w, h: b.h - ry * 3 };
    },
  },
  queue: {
    label: 'Очередь',
    size: { w: 170, h: 70 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => {
      const rx = tubeCap(b);
      const cy = b.y + b.h / 2;
      sink.moveTo(b.x + rx, b.y);
      sink.lineTo(b.x + b.w - rx, b.y);
      sink.ellipse(b.x + b.w - rx, cy, rx, b.h / 2, 0, -Math.PI / 2, Math.PI / 2);
      sink.lineTo(b.x + rx, b.y + b.h);
      sink.ellipse(b.x + rx, cy, rx, b.h / 2, 0, Math.PI / 2, (Math.PI * 3) / 2);
      sink.closePath();
    },
    details: (sink, b) => {
      const rx = tubeCap(b);
      sink.moveTo(b.x + b.w - rx, b.y);
      sink.ellipse(b.x + b.w - rx, b.y + b.h / 2, rx, b.h / 2, 0, -Math.PI / 2, Math.PI / 2, true);
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({ x: b.x + tubeCap(b), y: b.y, w: b.w - tubeCap(b) * 3, h: b.h }),
  },
  server: {
    label: 'Сервер',
    size: { w: 130, h: 110 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 3),
    details: (sink, b) => {
      const s = serverSlot(b);
      for (let i = 1; i <= 3; i++) line(sink, p(b.x, b.y + s * i), p(b.x + b.w, b.y + s * i));
      for (let i = 0; i < 3; i++) circle(sink, b.x + b.w - s * 0.7, b.y + s * (i + 0.5), s * 0.12);
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({ x: b.x, y: b.y + serverSlot(b) * 3, w: b.w, h: b.h - serverSlot(b) * 3 }),
  },
  cloud: {
    label: 'Облако',
    size: { w: 180, h: 110 },
    fill: DEFAULT_FILL,
    outline: (sink, { x, y, w, h }) => {
      const at = (fx: number, fy: number): [number, number] => [x + fx * w, y + fy * h];
      sink.moveTo(...at(0.24, 0.9));
      sink.bezierCurveTo(...at(0.06, 0.9), ...at(0, 0.7), ...at(0.12, 0.6));
      sink.bezierCurveTo(...at(0.04, 0.4), ...at(0.2, 0.26), ...at(0.34, 0.32));
      sink.bezierCurveTo(...at(0.4, 0.1), ...at(0.64, 0.06), ...at(0.72, 0.26));
      sink.bezierCurveTo(...at(0.88, 0.22), ...at(1, 0.38), ...at(0.93, 0.52));
      sink.bezierCurveTo(...at(1.02, 0.68), ...at(0.94, 0.9), ...at(0.78, 0.9));
      sink.closePath();
    },
    stroke: 'normal',
    hull: ELLIPSE,
    text: 'center',
    textBox: (b) => ({ x: b.x + b.w * 0.15, y: b.y + b.h * 0.34, w: b.w * 0.7, h: b.h * 0.5 }),
  },
  person: {
    label: 'Человек',
    size: { w: 130, h: 140 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => {
      // Голова касается туловища, но не заходит на него: линии не пересекаются.
      const r = personHead(b);
      circle(sink, b.x + b.w / 2, b.y + r, r);
      const top = b.y + r * 2;
      sink.roundRect(b.x, top, b.w, b.y + b.h - top, Math.min(b.w * 0.25, (b.y + b.h - top) / 2));
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({
      x: b.x,
      y: b.y + personHead(b) * 2,
      w: b.w,
      h: b.h - personHead(b) * 2,
    }),
  },
  browser: {
    label: 'Веб-приложение',
    size: { w: 200, h: 130 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 6),
    details: (sink, b) => {
      const bar = browserBar(b);
      line(sink, p(b.x, b.y + bar), p(b.x + b.w, b.y + bar));
      for (let i = 0; i < 3; i++)
        circle(sink, b.x + bar * (0.5 + i * 0.4), b.y + bar / 2, bar * 0.1);
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({ x: b.x, y: b.y + browserBar(b), w: b.w, h: b.h - browserBar(b) }),
  },
  mobile: {
    label: 'Мобильное приложение',
    size: { w: 90, h: 150 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, Math.min(12, b.w * 0.18)),
    details: (sink, b) => {
      line(sink, p(b.x, b.y + b.h * 0.12), p(b.x + b.w, b.y + b.h * 0.12));
      line(sink, p(b.x, b.y + b.h * 0.86), p(b.x + b.w, b.y + b.h * 0.86));
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({ x: b.x, y: b.y + b.h * 0.12, w: b.w, h: b.h * 0.74 }),
  },
  class: {
    label: 'Класс',
    size: { w: 200, h: 130 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 2),
    stroke: 'normal',
    hull: RECT,
    text: 'compartments',
    textBox: whole,
  },
  entity: {
    label: 'Сущность',
    size: { w: 200, h: 130 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 6),
    stroke: 'normal',
    hull: RECT,
    text: 'compartments',
    textBox: whole,
  },
  component: {
    label: 'Компонент',
    size: { w: 180, h: 90 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 3),
    details: (sink, b) => {
      // Значок компонента UML в правом верхнем углу: прямоугольник с двумя выступами.
      const u = Math.min(b.w / 180, b.h / 90, 1);
      const x = b.x + b.w - 26 * u;
      const y = b.y + 8 * u;
      sink.rect(x, y, 16 * u, 12 * u);
      sink.rect(x - 4 * u, y + 2 * u, 8 * u, 3 * u);
      sink.rect(x - 4 * u, y + 7 * u, 8 * u, 3 * u);
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: whole,
  },
  package: {
    label: 'Пакет',
    size: { w: 180, h: 120 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => {
      const tab = packageTab(b);
      sink.moveTo(b.x, b.y);
      sink.lineTo(b.x + tab.w, b.y);
      sink.lineTo(b.x + tab.w, b.y + tab.h);
      sink.lineTo(b.x + b.w, b.y + tab.h);
      sink.lineTo(b.x + b.w, b.y + b.h);
      sink.lineTo(b.x, b.y + b.h);
      sink.closePath();
    },
    details: (sink, b) => {
      const tab = packageTab(b);
      line(sink, p(b.x, b.y + tab.h), p(b.x + tab.w, b.y + tab.h));
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({ x: b.x, y: b.y + packageTab(b).h, w: b.w, h: b.h - packageTab(b).h }),
  },
  actor: {
    label: 'Актёр',
    size: { w: 60, h: 110 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => {
      const fh = actorFigure(b);
      const r = Math.min(b.w * 0.22, fh * 0.15);
      circle(sink, b.x + b.w / 2, b.y + r, r);
    },
    details: (sink, b) => {
      const fh = actorFigure(b);
      const r = Math.min(b.w * 0.22, fh * 0.15);
      const cx = b.x + b.w / 2;
      const hip = b.y + fh * 0.64;
      line(sink, p(cx, b.y + r * 2), p(cx, hip));
      line(sink, p(b.x + b.w * 0.12, b.y + fh * 0.38), p(b.x + b.w * 0.88, b.y + fh * 0.38));
      line(sink, p(cx, hip), p(b.x + b.w * 0.18, b.y + fh));
      line(sink, p(cx, hip), p(b.x + b.w * 0.82, b.y + fh));
    },
    stroke: 'normal',
    hull: RECT,
    text: 'center',
    textBox: (b) => ({
      x: b.x - 40,
      y: b.y + actorFigure(b),
      w: b.w + 80,
      h: b.h - actorFigure(b),
    }),
  },
  lifeline: {
    label: 'Линия жизни',
    size: { w: 140, h: 360 },
    fill: DEFAULT_FILL,
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, lifelineHead(b), 3),
    details: (sink, b) => {
      const cx = b.x + b.w / 2;
      line(sink, p(cx, b.y + lifelineHead(b)), p(cx, b.y + b.h));
    },
    dashedDetails: true,
    stroke: 'normal',
    hull: RECT,
    hit: (b, q, tolerance) =>
      inside(grow({ ...b, h: lifelineHead(b) }, tolerance), q) ||
      (Math.abs(q.x - (b.x + b.w / 2)) <= tolerance + 4 && q.y >= b.y && q.y <= b.y + b.h),
    text: 'center',
    textBox: (b) => ({ ...b, h: lifelineHead(b) }),
    anchored: true,
  },
  startEvent: {
    label: 'Начальное событие',
    size: { w: 44, h: 44 },
    fill: DEFAULT_FILL,
    outline: ellipse,
    stroke: 'normal',
    hull: ELLIPSE,
    text: 'center',
    textBox: below,
  },
  endEvent: {
    label: 'Конечное событие',
    size: { w: 44, h: 44 },
    fill: DEFAULT_FILL,
    outline: ellipse,
    stroke: 'bold',
    hull: ELLIPSE,
    text: 'center',
    textBox: below,
  },
  gateway: {
    label: 'Шлюз',
    size: { w: 56, h: 56 },
    fill: DEFAULT_FILL,
    ...diamond,
    details: (sink, b) => {
      const d = Math.min(b.w, b.h) * 0.16;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      line(sink, p(cx - d, cy - d), p(cx + d, cy + d));
      line(sink, p(cx + d, cy - d), p(cx - d, cy + d));
    },
    stroke: 'normal',
    text: 'center',
    textBox: below,
  },
  frame: {
    label: 'Рамка',
    size: { w: 480, h: 320 },
    fill: 'transparent',
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 6),
    stroke: 'normal',
    hull: RECT,
    hit: containerHit(titleBand),
    text: 'title',
    textBox: titleBand,
    container: true,
  },
  group: {
    label: 'Граница системы',
    size: { w: 480, h: 320 },
    fill: 'transparent',
    outline: (sink, b) => sink.roundRect(b.x, b.y, b.w, b.h, 10),
    dashed: true,
    stroke: 'normal',
    hull: RECT,
    hit: containerHit(titleBand),
    text: 'title',
    textBox: titleBand,
    container: true,
  },
  lane: {
    label: 'Дорожка',
    size: { w: 720, h: 180 },
    fill: 'transparent',
    outline: (sink, b) => sink.rect(b.x, b.y, b.w, b.h),
    details: (sink, b) => {
      const header = laneHeader(b);
      line(sink, p(b.x + header.w, b.y), p(b.x + header.w, b.y + b.h));
    },
    stroke: 'normal',
    hull: RECT,
    hit: containerHit(laneHeader),
    text: 'vertical',
    textBox: laneHeader,
    container: true,
  },
};

export function shapeSpec(kind: CatalogKind): ShapeSpec {
  return SHAPES[kind];
}

/** Строка, которая делит текст класса и сущности на секции. */
export const COMPARTMENT_SEPARATOR = '--';

/** Секции текста класса: имя, поля, методы — в любом количестве. */
export function compartments(text: string): string[][] {
  const sections: string[][] = [[]];
  for (const row of text.split('\n')) {
    if (row.trim() === COMPARTMENT_SEPARATOR) sections.push([]);
    else sections.at(-1)?.push(row);
  }
  return sections;
}
