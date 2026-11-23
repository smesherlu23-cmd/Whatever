import {
  type Camera,
  type ScreenSize,
  centerOn,
  fitCamera,
  initialCamera,
  panBy,
  screenToWorld,
  visibleBounds,
  zoomAt,
} from '../canvas/camera';
import { cloneElements } from '../model/clone';
import { BoardDocument, type ElementSource } from '../model/document';
import {
  bindEnd,
  contains,
  contentBounds,
  distance,
  elementBounds,
  normalizeBounds,
  resolveArrow,
} from '../model/geometry';
import { newId } from '../model/ids';
import { bindTargetAt, elementAt, hasText } from '../model/queries';
import { type ToolKind, shapeSpec } from '../model/shapes';
import {
  type ArrowElement,
  type ArrowEnd,
  type ArrowStyle,
  type BoardElement,
  type Bounds,
  DEFAULT_ARROW_STYLE,
  DEFAULT_PAGE,
  DEFAULT_STROKE,
  type FileRef,
  type Point,
  type ShapeElement,
  isArrow,
} from '../model/types';
import { recognize } from '../recognition/recognize';
import { type KeyInput, handleShortcut } from './shortcuts';
import { commitStroke } from './smartDrawing';

/** Фигуры, которые рисуются протягиванием рамки: все из каталога, кроме файлов. */
export type ShapeTool = ToolKind;
/** comment ставит метку обсуждения: документ он не меняет, поэтому доступен и зрителю. */
export type Tool = 'select' | 'pen' | 'arrow' | 'comment' | ShapeTool;

function isShapeTool(tool: Tool): tool is ShapeTool {
  return tool !== 'select' && tool !== 'pen' && tool !== 'arrow' && tool !== 'comment';
}

/** Куда поставили метку обсуждения: точка страницы и верхний элемент под ней, если он есть. */
export interface CommentPlace {
  page: string;
  point: Point;
  element: BoardElement | undefined;
}

/** Размер холста в экранных пикселях. */
export type ViewportSize = ScreenSize;

/**
 * Заготовка для инструмента фигуры: например, интерфейс — это класс с заранее
 * написанным стереотипом. Размер заготовки заменяет размер из каталога.
 */
export interface ShapePreset {
  text?: string;
  size?: { w: number; h: number };
}

/** Вид выделенных стрелок. Поле равно null, если у выделенных стрелок оно разное. */
export type MixedArrowStyle = { readonly [K in keyof ArrowStyle]: ArrowStyle[K] | null };

const ARROW_STYLE_KEYS = ['route', 'startHead', 'endHead', 'dashed'] as const;

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Размер в экранных пикселях: зоны захвата не зависят от масштаба. */
const HIT_TOLERANCE_PX = 6;
const HANDLE_SIZE_PX = 10;
const BIND_DISTANCE_PX = 12;
const MIN_SIZE = 8;
const DUPLICATE_OFFSET = 24;
/** Поля вокруг того, что показывают целиком, в пикселях экрана. */
const FIT_PADDING_PX = 48;
/** Насколько точка должна отстоять от края окна, чтобы считаться видной. */
const SHOW_MARGIN_PX = 64;

export interface PointerInput {
  button?: number;
  shift?: boolean;
}

type Interaction =
  | { type: 'none' }
  | { type: 'pan'; last: Point }
  /** carried — то, что лежит в перетаскиваемых контейнерах и едет вместе с ними. */
  | { type: 'move'; last: Point; carried: ReadonlySet<string> }
  | { type: 'resize'; id: string; handle: Handle; start: Bounds; origin: Point }
  | { type: 'create'; id: string; origin: Point }
  | { type: 'arrowEnd'; id: string; which: 'start' | 'end'; created: boolean }
  | { type: 'marquee'; origin: Point; current: Point; base: Set<string> }
  /** Метка обсуждения встанет, когда кнопку отпустят. */
  | { type: 'comment'; at: Point }
  | { type: 'draw' };

export interface EditorState {
  readOnly: boolean;
  /** Открытая страница доски. */
  pageId: string;
  tool: Tool;
  smartDrawing: boolean;
  /** Вид новых стрелок. */
  arrowStyle: ArrowStyle;
  /** Вид выделенных стрелок или null, если стрелок не выделено. */
  selectionArrowStyle: MixedArrowStyle | null;
  selection: ReadonlySet<string>;
  editingId: string | null;
  camera: Camera;
}

/**
 * Логика редактора без привязки к React и DOM: принимает события указателя и клавиатуры
 * в экранных координатах холста и меняет документ, камеру и выделение.
 */
export class Editor {
  readonly doc: BoardDocument;
  /** Страница, которую видно и правят. Остальные страницы редактор не трогает. */
  pageId: string;
  camera: Camera = initialCamera;
  /** Размер холста. Его сообщает холст, пока он не показан — нули. */
  viewport: ViewportSize = { width: 0, height: 0 };
  tool: Tool = 'select';
  selection = new Set<string>();
  editingId: string | null = null;
  private draftText = '';
  marquee: Bounds | null = null;
  spaceHeld = false;
  /** Умное рисование: каждый штрих превращается в ровную фигуру, если он на неё похож. */
  smartDrawing = true;
  arrowStyle: ArrowStyle = DEFAULT_ARROW_STYLE;
  private selectionStyleCache: MixedArrowStyle | null = null;
  /**
   * Только просмотр: можно выделять, смотреть и двигать камеру, но не менять документ.
   * Это удобство для зрителя, а не защита: правки зрителя отбрасывает сервер.
   */
  readOnly = false;
  /** Штрих, который рисуется сейчас, в мировых координатах. */
  stroke: Point[] | null = null;

  private interaction: Interaction = { type: 'none' };
  /** Заготовка для следующей фигуры. Сбрасывается, когда фигура поставлена. */
  private preset: ShapePreset | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly commentListeners = new Set<(place: CommentPlace) => void>();
  /** Камеры страниц, на которых уже побывали: при возврате страница видна как прежде. */
  private readonly cameras = new Map<string, Camera>();
  /**
   * Камеру открытой страницы уже поставили: человек двигал доску или начал на ней работать,
   * за кем-то следуют или страницу открыли переходом. Тогда revealContent её не трогает.
   */
  private cameraPlaced = false;

  constructor(doc: BoardDocument = new BoardDocument()) {
    this.doc = doc;
    this.pageId = doc.pages()[0]?.id ?? DEFAULT_PAGE;
    doc.onChange(() => {
      // Открытую страницу удалили (в том числе другие участники): переходим на первую.
      if (!doc.hasPage(this.pageId)) {
        this.cameras.delete(this.pageId);
        this.setPage(doc.pages()[0]?.id ?? DEFAULT_PAGE);
      }
      // Убираем из выделения то, что удалили.
      const { page } = this;
      if ([...this.selection].some((id) => !page.get(id))) {
        this.selection = new Set([...this.selection].filter((id) => page.get(id)));
      }
      // Фигуру удалил другой участник, пока здесь шёл ввод: сохранять текст некуда.
      if (this.editingId && !page.get(this.editingId)) {
        this.editingId = null;
        this.draftText = '';
      }
      this.emit();
    });
  }

  /** Элементы открытой страницы. */
  get page(): ElementSource {
    return this.doc.page(this.pageId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Подписка на метки обсуждений, которые ставят инструментом «Комментарий». */
  onPlaceComment(listener: (place: CommentPlace) => void): () => void {
    this.commentListeners.add(listener);
    return () => {
      this.commentListeners.delete(listener);
    };
  }

  getState(): EditorState {
    return {
      readOnly: this.readOnly,
      pageId: this.pageId,
      tool: this.tool,
      smartDrawing: this.smartDrawing,
      arrowStyle: this.arrowStyle,
      selectionArrowStyle: this.selectionArrowStyle(),
      selection: this.selection,
      editingId: this.editingId,
      camera: this.camera,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private readonly lookup = (id: string) => this.page.get(id);

  private arrow(id: string): ArrowElement | undefined {
    const el = this.lookup(id);
    return el && isArrow(el) ? el : undefined;
  }

  private shape(id: string): ShapeElement | undefined {
    const el = this.lookup(id);
    return el && !isArrow(el) ? el : undefined;
  }

  // ---------- Инструменты, выделение, камера ----------

  /** Включает и выключает просмотр. Незавершённое действие и ввод текста отменяются. */
  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.readOnly) return;
    this.readOnly = readOnly;
    if (readOnly) {
      this.interaction = { type: 'none' };
      this.stroke = null;
      this.marquee = null;
      this.editingId = null;
      this.draftText = '';
      this.tool = 'select';
    }
    this.emit();
  }

  /**
   * Открывает другую страницу. Набранный текст сохраняется, начатое действие отменяется,
   * выделение снимается. Камера у каждой страницы своя.
   */
  setPage(id: string): void {
    if (id === this.pageId || !this.doc.hasPage(id)) return;
    this.stopEditing();
    this.interaction = { type: 'none' };
    this.stroke = null;
    this.marquee = null;
    this.selection = new Set();
    this.cameras.set(this.pageId, this.camera);
    this.pageId = id;
    // Страница, открытая впервые, показывает своё содержимое целиком.
    this.camera = this.cameras.get(id) ?? this.fittedCamera() ?? initialCamera;
    this.cameraPlaced = true;
    this.emit();
  }

  setSmartDrawing(enabled: boolean): void {
    this.smartDrawing = enabled;
    this.emit();
  }

  private selectedArrows(): ArrowElement[] {
    return [...this.selection].map((id) => this.arrow(id)).filter((el) => el !== undefined);
  }

  selectionArrowStyle(): MixedArrowStyle | null {
    const [first, ...rest] = this.selectedArrows();
    if (!first) return null;
    const common = <K extends keyof ArrowStyle>(key: K): ArrowStyle[K] | null =>
      rest.every((arrow) => arrow[key] === first[key]) ? first[key] : null;
    const style: MixedArrowStyle = {
      route: common('route'),
      startHead: common('startHead'),
      endHead: common('endHead'),
      dashed: common('dashed'),
    };
    // Пока вид не изменился, отдаётся тот же объект: панель не перерисовывается
    // на каждое движение мыши.
    const cached = this.selectionStyleCache;
    if (cached && ARROW_STYLE_KEYS.every((key) => cached[key] === style[key])) return cached;
    this.selectionStyleCache = style;
    return style;
  }

  /** Меняет вид новых стрелок и выделенных. Выделенные меняются одним шагом отмены. */
  setArrowStyle(patch: Partial<ArrowStyle>): void {
    if (this.readOnly) return;
    this.arrowStyle = { ...this.arrowStyle, ...patch };
    const arrows = this.selectedArrows();
    if (arrows.length > 0) {
      this.doc.stopCapturing();
      this.doc.transact(() => {
        for (const arrow of arrows) this.doc.update(arrow.id, patch);
      });
      this.doc.stopCapturing();
    }
    this.emit();
  }

  /** Выбирает инструмент. preset задаёт текст и размер новой фигуры, например для интерфейса. */
  setTool(tool: Tool, preset: ShapePreset | null = null): void {
    if (this.readOnly && tool !== 'select' && tool !== 'comment') return;
    this.tool = tool;
    this.preset = isShapeTool(tool) ? preset : null;
    if (tool !== 'select') this.selection = new Set();
    this.emit();
  }

  select(ids: Iterable<string>): void {
    this.selection = new Set(ids);
    this.emit();
  }

  /** Выделяет всё на открытой странице. */
  selectAll(): void {
    this.select(this.page.list().map((el) => el.id));
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.cameraPlaced = true;
    this.emit();
  }

  setViewport(size: ViewportSize): void {
    this.viewport = size;
    this.emit();
  }

  /** Видимая часть страницы в мировых координатах; null, пока холст не показан. */
  visibleArea(): Bounds | null {
    const { width, height } = this.viewport;
    return width > 0 && height > 0 ? visibleBounds(this.camera, this.viewport) : null;
  }

  /** Середина видимой части холста в мировых координатах. */
  viewportCenter(): Point {
    return this.toWorld({ x: this.viewport.width / 2, y: this.viewport.height / 2 });
  }

  /** Меняет масштаб, а середина окна остаётся на месте. */
  zoomBy(factor: number): void {
    const middle = { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    this.setCamera(zoomAt(this.camera, middle, factor));
  }

  /** Масштаб 100% вокруг середины окна. */
  resetZoom(): void {
    this.zoomBy(1 / this.camera.zoom);
  }

  /** Ставит точку доски в середину окна, не меняя масштаб. */
  centerOn(world: Point): void {
    this.setCamera(centerOn(this.camera, world, this.viewport));
  }

  /**
   * Открывает страницу page и, если точки там не видно, ставит её в середину окна.
   * Точку у самого края тоже переносит: рядом с ней должно быть видно то, к чему она относится.
   */
  showPoint(page: string, point: Point): void {
    this.setPage(page);
    const area = this.visibleArea();
    if (this.pageId !== page || !area) return;
    const margin = this.px(SHOW_MARGIN_PX);
    const inside =
      point.x >= area.x + margin &&
      point.x <= area.x + area.w - margin &&
      point.y >= area.y + margin &&
      point.y <= area.y + area.h - margin;
    if (!inside) this.centerOn(point);
  }

  /** Показывает всё, что есть на странице. Мелкое не увеличивает больше 100%. */
  zoomToFit(): void {
    const camera = this.fittedCamera();
    if (camera) this.setCamera(camera);
  }

  /**
   * Показывает всё, что есть на открытой странице, если её камеру ещё никто не ставил.
   * Так доска, загруженная с сервера, сразу показывает своё содержимое, где бы оно ни было.
   */
  revealContent(): void {
    if (!this.cameraPlaced) this.zoomToFit();
  }

  /** Камера, при которой видно всё содержимое страницы; null, если смотреть не на что. */
  private fittedCamera(): Camera | null {
    const bounds = contentBounds(this.page.list(), this.lookup);
    const { width, height } = this.viewport;
    if (!bounds || width <= 0 || height <= 0) return null;
    return fitCamera(bounds, this.viewport, FIT_PADDING_PX, 1);
  }

  /** Показывает выделенное во всё окно. Возвращает false, если ничего не выделено. */
  zoomToSelection(): boolean {
    const selected = [...this.selection].map(this.lookup).filter((el) => el !== undefined);
    const bounds = contentBounds(selected, this.lookup);
    if (!bounds) return false;
    this.setCamera(fitCamera(bounds, this.viewport, FIT_PADDING_PX));
    return true;
  }

  wheel(screen: Point, deltaX: number, deltaY: number, zoom: boolean): void {
    this.setCamera(
      zoom
        ? zoomAt(this.camera, screen, Math.exp(-deltaY * 0.01))
        : panBy(this.camera, -deltaX, -deltaY),
    );
  }

  private toWorld(screen: Point): Point {
    return screenToWorld(this.camera, screen);
  }

  private px(value: number): number {
    return value / this.camera.zoom;
  }

  // ---------- Поиск под курсором ----------

  elementAt(world: Point): BoardElement | undefined {
    return elementAt(this.page, world, this.px(HIT_TOLERANCE_PX));
  }

  private bindTargetAt(world: Point, exclude?: string): ShapeElement | undefined {
    return bindTargetAt(this.page, world, this.px(BIND_DISTANCE_PX), exclude);
  }

  /** Ручки изменения размера для одной выделенной фигуры. */
  handlePositions(): { handle: Handle; point: Point }[] {
    const el = this.singleSelected();
    if (!el || isArrow(el) || this.readOnly) return [];
    const { x, y, w, h } = el;
    const xs = { w: x, c: x + w / 2, e: x + w };
    const ys = { n: y, c: y + h / 2, s: y + h };
    const at: Record<Handle, Point> = {
      nw: { x: xs.w, y: ys.n },
      n: { x: xs.c, y: ys.n },
      ne: { x: xs.e, y: ys.n },
      e: { x: xs.e, y: ys.c },
      se: { x: xs.e, y: ys.s },
      s: { x: xs.c, y: ys.s },
      sw: { x: xs.w, y: ys.s },
      w: { x: xs.w, y: ys.c },
    };
    return HANDLES.map((handle) => ({ handle, point: at[handle] }));
  }

  private handleAt(world: Point): Handle | undefined {
    const radius = this.px(HANDLE_SIZE_PX);
    return this.handlePositions().find(
      ({ point }) => Math.abs(point.x - world.x) <= radius && Math.abs(point.y - world.y) <= radius,
    )?.handle;
  }

  private arrowEndAt(world: Point): { id: string; which: 'start' | 'end' } | undefined {
    const el = this.selectedArrow();
    if (!el) return undefined;
    const { start, end } = resolveArrow(el, this.lookup);
    const radius = this.px(HANDLE_SIZE_PX);
    if (distance(start, world) <= radius) return { id: el.id, which: 'start' };
    if (distance(end, world) <= radius) return { id: el.id, which: 'end' };
    return undefined;
  }

  singleSelected(): BoardElement | undefined {
    if (this.selection.size !== 1) return undefined;
    const [id] = this.selection;
    return id === undefined ? undefined : this.lookup(id);
  }

  /** Единственная выделенная стрелка, концы которой можно перетаскивать. */
  selectedArrow(): ArrowElement | undefined {
    const el = this.singleSelected();
    return el && isArrow(el) && !this.readOnly ? el : undefined;
  }

  // ---------- Указатель ----------

  pointerDown(screen: Point, input: PointerInput = {}): void {
    const world = this.toWorld(screen);
    const button = input.button ?? 0;
    this.doc.stopCapturing();
    // Человек уже работает с доской: камера не прыгнет, когда догрузится содержимое.
    this.cameraPlaced = true;

    if (button === 1 || (button === 0 && this.spaceHeld)) {
      this.interaction = { type: 'pan', last: screen };
      return;
    }
    if (button !== 0) return;
    if (this.editingId) this.stopEditing();

    const { tool } = this;
    if (tool === 'pen') this.beginStroke(world);
    else if (tool === 'arrow') this.beginArrow(world);
    else if (tool === 'select') this.beginSelect(world, input.shift ?? false);
    else if (tool === 'comment') this.interaction = { type: 'comment', at: world };
    else if (isShapeTool(tool)) this.beginCreate(tool, world);
  }

  /**
   * Метка ставится одним щелчком, после чего снова выбрано выделение. Ставится она, когда
   * кнопку отпускают, а не нажимают: нажатие на холсте уводит фокус со страницы, и поле нового
   * обсуждения, открытое по нажатию, сразу теряло бы его. Тогда набранный текст уходил бы
   * в сочетания клавиш доски.
   */
  private placeComment(world: Point): void {
    const place: CommentPlace = { page: this.pageId, point: world, element: this.elementAt(world) };
    this.tool = 'select';
    this.selection = new Set();
    for (const listener of this.commentListeners) listener(place);
    this.emit();
  }

  private beginCreate(kind: ShapeTool, world: Point): void {
    const id = newId();
    const spec = shapeSpec(kind);
    this.doc.add({
      id,
      kind,
      page: this.pageId,
      x: world.x,
      y: world.y,
      w: 0,
      h: 0,
      text: this.preset?.text ?? '',
      stroke: DEFAULT_STROKE,
      fill: spec.fill,
      // Контейнер встаёт под всё, что уже нарисовано: фигуры остаются на виду и в нём.
      z: spec.container ? this.doc.bottomZ() : this.doc.nextZ(),
    });
    this.selection = new Set([id]);
    this.interaction = { type: 'create', id, origin: world };
    this.emit();
  }

  private beginArrow(world: Point): void {
    const id = newId();
    const target = this.bindTargetAt(world);
    const start: ArrowEnd = target ? bindEnd(target, world) : world;
    this.doc.add({
      id,
      kind: 'arrow',
      page: this.pageId,
      start,
      end: { x: world.x, y: world.y },
      text: '',
      ...this.arrowStyle,
      stroke: DEFAULT_STROKE,
      z: this.doc.nextZ(),
    });
    this.selection = new Set([id]);
    this.interaction = { type: 'arrowEnd', id, which: 'end', created: true };
    this.emit();
  }

  private beginSelect(world: Point, shift: boolean): void {
    const arrowEnd = this.arrowEndAt(world);
    if (arrowEnd) {
      this.interaction = { type: 'arrowEnd', ...arrowEnd, created: false };
      return;
    }
    const handle = this.handleAt(world);
    const single = this.singleSelected();
    if (handle && single && !isArrow(single)) {
      this.interaction = {
        type: 'resize',
        id: single.id,
        handle,
        start: { x: single.x, y: single.y, w: single.w, h: single.h },
        origin: world,
      };
      return;
    }
    const hit = this.elementAt(world);
    if (hit) {
      if (shift) {
        const next = new Set(this.selection);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
        this.selection = next;
      } else if (!this.selection.has(hit.id)) {
        this.selection = new Set([hit.id]);
      }
      this.interaction = this.readOnly
        ? { type: 'none' }
        : { type: 'move', last: world, carried: this.carriedBySelection() };
      this.emit();
      return;
    }
    const base = shift ? new Set(this.selection) : new Set<string>();
    this.selection = new Set(base);
    this.interaction = { type: 'marquee', origin: world, current: world, base };
    this.marquee = normalizeBounds(world, world);
    this.emit();
  }

  /**
   * Несколько положений указателя, накопленных за кадр, по порядку. Штриху нужна каждая точка,
   * а остальным жестам — только последняя: так перетаскивание даёт одну правку документа
   * за кадр, а не по правке на каждое событие мыши, и каждая правка не уходит по сети отдельно.
   */
  pointerMoves(screens: readonly Point[], input: PointerInput = {}): void {
    const last = screens.at(-1);
    if (!last) return;
    if (this.interaction.type === 'draw') {
      for (const screen of screens) this.pointerMove(screen, input);
    } else {
      this.pointerMove(last, input);
    }
  }

  pointerMove(screen: Point, input: PointerInput = {}): void {
    const world = this.toWorld(screen);
    const it = this.interaction;
    switch (it.type) {
      case 'pan':
        this.camera = panBy(this.camera, screen.x - it.last.x, screen.y - it.last.y);
        it.last = screen;
        this.emit();
        return;
      case 'move':
        this.moveSelection(world.x - it.last.x, world.y - it.last.y, it.carried);
        it.last = world;
        return;
      case 'resize':
        this.resize(it, world, input.shift ?? false);
        return;
      case 'create': {
        const b = normalizeBounds(it.origin, world);
        this.doc.update(it.id, b);
        return;
      }
      case 'arrowEnd': {
        const arrow = this.arrow(it.id);
        if (!arrow) return;
        const other = arrow[it.which === 'start' ? 'end' : 'start'];
        const target = this.bindTargetAt(world, other.shapeId);
        this.doc.update(it.id, {
          [it.which]: target ? bindEnd(target, world) : { x: world.x, y: world.y },
        });
        return;
      }
      case 'draw':
        this.stroke?.push(world);
        this.emit();
        return;
      case 'marquee': {
        it.current = world;
        const marquee = normalizeBounds(it.origin, world);
        this.marquee = marquee;
        const inside = this.page
          .list()
          .filter((el) => contains(marquee, elementBounds(el, this.lookup)))
          .map((el) => el.id);
        this.selection = new Set([...it.base, ...inside]);
        this.emit();
        return;
      }
    }
  }

  pointerUp(): void {
    const it = this.interaction;
    this.interaction = { type: 'none' };
    if (it.type === 'create') this.finishCreate(it.id, it.origin);
    if (it.type === 'arrowEnd' && it.created) this.finishArrow(it.id);
    if (it.type === 'marquee') this.marquee = null;
    if (it.type === 'draw') this.finishStroke();
    if (it.type === 'comment') this.placeComment(it.at);
    this.doc.stopCapturing();
    this.emit();
  }

  // ---------- Умное рисование ----------

  private beginStroke(world: Point): void {
    this.selection = new Set();
    this.stroke = [world];
    this.interaction = { type: 'draw' };
    this.emit();
  }

  private finishStroke(): void {
    const { stroke } = this;
    this.stroke = null;
    if (!stroke || stroke.length < 2) return;
    const result = this.smartDrawing ? recognize(stroke) : null;
    commitStroke(this.doc, this.pageId, stroke, result, this.camera.zoom);
  }

  private finishCreate(id: string, origin: Point): void {
    const el = this.shape(id);
    if (!el || el.kind === 'path') return;
    if (el.w < MIN_SIZE && el.h < MIN_SIZE) {
      // Щелчок без перетаскивания: фигура стандартного размера с центром в точке щелчка.
      const size = this.preset?.size ?? shapeSpec(el.kind).size;
      this.doc.update(id, { x: origin.x - size.w / 2, y: origin.y - size.h / 2, ...size });
    } else {
      this.doc.update(id, { w: Math.max(el.w, MIN_SIZE), h: Math.max(el.h, MIN_SIZE) });
    }
    this.tool = 'select';
    this.preset = null;
    // Текст и стикер ставят, чтобы сразу написать: ввод открывается сам. Иначе набранные буквы
    // ушли бы в сочетания клавиш и молча сменили бы инструмент.
    if (el.kind === 'text' || el.kind === 'sticky') this.startEditing(id);
  }

  private finishArrow(id: string): void {
    const arrow = this.arrow(id);
    if (!arrow) return;
    const { start, end } = resolveArrow(arrow, this.lookup);
    const sameShape =
      arrow.start.shapeId !== undefined && arrow.start.shapeId === arrow.end.shapeId;
    if (distance(start, end) < MIN_SIZE || sameShape) {
      this.doc.remove([id]);
      this.selection = new Set();
    }
    this.tool = 'select';
  }

  /**
   * Элементы, которые целиком лежат в выделенных контейнерах, но сами не выделены.
   * Считаются в начале перетаскивания: то, что окажется в рамке по пути, не подхватывается.
   */
  private carriedBySelection(): Set<string> {
    const containers = [...this.selection]
      .map((id) => this.shape(id))
      .filter((el) => el !== undefined && el.kind !== 'path' && shapeSpec(el.kind).container);
    const carried = new Set<string>();
    if (containers.length === 0) return carried;
    for (const el of this.page.list()) {
      if (this.selection.has(el.id)) continue;
      const bounds = elementBounds(el, this.lookup);
      if (containers.some((c) => c !== undefined && contains(c, bounds))) carried.add(el.id);
    }
    return carried;
  }

  private moveSelection(dx: number, dy: number, carried: ReadonlySet<string>): void {
    if (dx === 0 && dy === 0) return;
    this.doc.transact(() => {
      for (const id of [...this.selection, ...carried]) {
        const el = this.lookup(id);
        if (!el) continue;
        if (isArrow(el)) {
          // Привязанные концы следуют за фигурой, свободные двигаются вместе со стрелкой.
          const shift = (end: ArrowEnd): ArrowEnd =>
            end.shapeId ? end : { x: end.x + dx, y: end.y + dy };
          this.doc.update(id, { start: shift(el.start), end: shift(el.end) });
        } else {
          this.doc.update(id, { x: el.x + dx, y: el.y + dy });
        }
      }
    });
  }

  /**
   * Тянет ручку размера. Картинка сохраняет пропорции, а с Shift тянется свободно;
   * остальные фигуры наоборот.
   */
  private resize(
    it: { id: string; handle: Handle; start: Bounds; origin: Point },
    world: Point,
    shift: boolean,
  ): void {
    const keepRatio = shift !== (this.shape(it.id)?.kind === 'image');
    const dx = world.x - it.origin.x;
    const dy = world.y - it.origin.y;
    let { x, y, w, h } = it.start;
    if (it.handle.includes('w')) {
      x += dx;
      w -= dx;
    }
    if (it.handle.includes('e')) w += dx;
    if (it.handle.includes('n')) {
      y += dy;
      h -= dy;
    }
    if (it.handle.includes('s')) h += dy;
    if (keepRatio && it.start.w > 0 && it.start.h > 0) {
      const ratio = it.start.w / it.start.h;
      if (Math.abs(w / ratio) > Math.abs(h)) h = w / ratio;
      else w = h * ratio;
      if (it.handle.includes('n')) y = it.start.y + it.start.h - h;
      if (it.handle.includes('w')) x = it.start.x + it.start.w - w;
    }
    // Перетаскивание через противоположную сторону отражает фигуру.
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    this.doc.update(it.id, { x, y, w: Math.max(w, MIN_SIZE), h: Math.max(h, MIN_SIZE) });
  }

  /** Файл картинки или вложения под указателем: его открывают двойным щелчком. */
  attachmentAt(screen: Point): FileRef | undefined {
    const hit = this.elementAt(this.toWorld(screen));
    return hit && !isArrow(hit) ? hit.file : undefined;
  }

  doubleClick(screen: Point): void {
    if (this.readOnly) return;
    const hit = this.elementAt(this.toWorld(screen));
    if (hit && hasText(hit)) {
      this.selection = new Set([hit.id]);
      this.startEditing(hit.id);
    } else if (!hit) {
      this.tool = 'text';
      this.pointerDown(screen);
      this.pointerUp();
    }
  }

  /**
   * Правый щелчок перед контекстным меню. Меню действует на выделенное, поэтому элемент под
   * указателем выделяется, если его ещё нет в выделении, а щелчок по пустому месту выделение
   * снимает. Начатый ввод текста сохраняется, инструмент сменяется на выделение.
   */
  contextMenu(screen: Point): void {
    this.stopEditing();
    this.tool = 'select';
    this.preset = null;
    const hit = this.elementAt(this.toWorld(screen));
    if (!hit) this.selection = new Set();
    else if (!this.selection.has(hit.id)) this.selection = new Set([hit.id]);
    this.emit();
  }

  // ---------- Текст ----------

  /**
   * Открывает редактирование текста фигуры. Набранный текст хранится здесь, а не в поле
   * ввода: так он сохранится при любом способе закончить ввод — Esc, щелчком по холсту,
   * сменой инструмента или уходом фокуса.
   */
  startEditing(id: string): void {
    if (this.readOnly || this.editingId === id) return;
    if (this.editingId) this.stopEditing();
    const el = this.lookup(id);
    if (!el || !hasText(el)) return;
    this.editingId = id;
    this.draftText = el.text;
    this.emit();
  }

  /** Текст, который сейчас набирается. В документ попадёт при завершении ввода. */
  get editingText(): string {
    return this.draftText;
  }

  setEditingText(text: string): void {
    this.draftText = text;
  }

  /** Завершает ввод и сохраняет текст. Пустой текстовый блок удаляется. */
  stopEditing(): void {
    const id = this.editingId;
    if (id === null) return;
    this.editingId = null;
    this.saveText(id, this.draftText);
    this.draftText = '';
    this.emit();
  }

  private saveText(id: string, text: string): void {
    const el = this.lookup(id);
    if (!el || !hasText(el)) return;
    this.doc.stopCapturing();
    if (el.kind === 'text' && text.trim() === '') {
      this.doc.remove([id]);
    } else if (el.text !== text) {
      this.doc.update(id, { text });
    }
    this.doc.stopCapturing();
  }

  // ---------- Команды ----------

  deleteSelection(): void {
    if (this.readOnly || this.selection.size === 0) return;
    this.doc.stopCapturing();
    this.doc.remove(this.selection);
    this.doc.stopCapturing();
    this.selection = new Set();
    this.emit();
  }

  duplicateSelection(): void {
    if (this.readOnly) return;
    const originals = [...this.selection].map(this.lookup).filter((el) => el !== undefined);
    if (originals.length === 0) return;
    const copies = cloneElements(originals, {
      page: this.pageId,
      offset: DUPLICATE_OFFSET,
      firstZ: this.doc.nextZ(),
      lookup: this.lookup,
    });
    this.doc.stopCapturing();
    this.doc.transact(() => {
      for (const copy of copies) this.doc.add(copy);
    });
    this.doc.stopCapturing();
    this.selection = new Set(copies.map((el) => el.id));
    this.emit();
  }

  /** Добавляет готовые элементы на открытую страницу одним шагом отмены и выделяет их. */
  insert(elements: readonly BoardElement[]): void {
    if (this.readOnly || elements.length === 0) return;
    this.doc.stopCapturing();
    this.doc.transact(() => {
      for (const el of elements) this.doc.add(el);
    });
    this.doc.stopCapturing();
    this.tool = 'select';
    // Элементы могли встать на другую страницу: например, их вставили, пока открыта была она.
    this.selection = new Set(elements.filter((el) => el.page === this.pageId).map((el) => el.id));
    this.emit();
  }

  /**
   * Делает доску такой, как в версии (см. BoardDocument.restoreFrom): одна правка, которую
   * отменяет Ctrl+Z. Набранный текст сохраняется до этого. Возвращает false, если доску
   * сейчас править нельзя.
   */
  restoreVersion(version: BoardDocument): boolean {
    if (this.readOnly) return false;
    this.stopEditing();
    this.interaction = { type: 'none' };
    this.stroke = null;
    this.marquee = null;
    this.doc.restoreFrom(version);
    return true;
  }

  undo(): void {
    if (!this.readOnly) this.doc.undo();
  }

  redo(): void {
    if (!this.readOnly) this.doc.redo();
  }

  /** Возвращает true, если клавиша обработана и браузеру её отдавать не нужно. */
  keyDown(input: KeyInput): boolean {
    if (this.editingId) return false;
    return handleShortcut(this, input);
  }

  /** Начинает редактирование текста единственной выделенной фигуры, если у неё есть текст. */
  editSelectedText(): boolean {
    const el = this.singleSelected();
    if (!el || !hasText(el)) return false;
    this.startEditing(el.id);
    return true;
  }
}
