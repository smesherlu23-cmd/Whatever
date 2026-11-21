import { type Camera, initialCamera, panBy, screenToWorld, zoomAt } from '../canvas/camera';
import { BoardDocument, newId } from '../model/document';
import {
  contains,
  distance,
  elementBounds,
  normalizeBounds,
  resolveArrow,
} from '../model/geometry';
import { bindTargetAt, elementAt, hasText } from '../model/queries';
import {
  type ArrowElement,
  type ArrowEnd,
  type ArrowRoute,
  type BoardElement,
  type Bounds,
  DEFAULT_FILL,
  DEFAULT_STICKY_FILL,
  DEFAULT_STROKE,
  type Point,
  type ShapeElement,
  type ShapeKind,
  isArrow,
} from '../model/types';
import { recognize } from '../recognition/recognize';
import { type KeyInput, handleShortcut } from './shortcuts';
import { commitStroke } from './smartDrawing';

/** Фигуры, которые рисуются протягиванием рамки. */
export type ShapeTool = Exclude<ShapeKind, 'path'>;
export type Tool = 'select' | 'pen' | 'arrow' | ShapeTool;

const SHAPE_TOOLS: ReadonlySet<Tool> = new Set<ShapeTool>([
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
  'triangle',
  'sticky',
  'text',
]);

function isShapeTool(tool: Tool): tool is ShapeTool {
  return SHAPE_TOOLS.has(tool);
}

/** Вид линий выделенных стрелок: один на всех, «разный» или null, если стрелок не выделено. */
export type SelectionRoute = ArrowRoute | 'mixed' | null;

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Размер в экранных пикселях: зоны захвата не зависят от масштаба. */
const HIT_TOLERANCE_PX = 6;
const HANDLE_SIZE_PX = 10;
const BIND_DISTANCE_PX = 12;
const MIN_SIZE = 8;
const DEFAULT_SIZE: Record<ShapeKind, { w: number; h: number }> = {
  rectangle: { w: 160, h: 80 },
  rounded: { w: 160, h: 80 },
  ellipse: { w: 120, h: 120 },
  diamond: { w: 140, h: 100 },
  triangle: { w: 140, h: 120 },
  sticky: { w: 160, h: 160 },
  text: { w: 160, h: 40 },
  path: { w: 0, h: 0 },
};
const DEFAULT_FILLS: Partial<Record<ShapeKind, string>> = {
  text: 'transparent',
  sticky: DEFAULT_STICKY_FILL,
};
const DUPLICATE_OFFSET = 24;

export interface PointerInput {
  button?: number;
  shift?: boolean;
}

type Interaction =
  | { type: 'none' }
  | { type: 'pan'; last: Point }
  | { type: 'move'; last: Point }
  | { type: 'resize'; id: string; handle: Handle; start: Bounds; origin: Point }
  | { type: 'create'; id: string; origin: Point }
  | { type: 'arrowEnd'; id: string; which: 'start' | 'end'; created: boolean }
  | { type: 'marquee'; origin: Point; current: Point; base: Set<string> }
  | { type: 'draw' };

export interface EditorState {
  tool: Tool;
  smartDrawing: boolean;
  /** Вид линии для новых стрелок. */
  arrowRoute: ArrowRoute;
  selectionRoute: SelectionRoute;
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
  camera: Camera = initialCamera;
  tool: Tool = 'select';
  selection = new Set<string>();
  editingId: string | null = null;
  private draftText = '';
  marquee: Bounds | null = null;
  spaceHeld = false;
  /** Умное рисование: каждый штрих превращается в ровную фигуру, если он на неё похож. */
  smartDrawing = true;
  arrowRoute: ArrowRoute = 'straight';
  /** Штрих, который рисуется сейчас, в мировых координатах. */
  stroke: Point[] | null = null;

  private interaction: Interaction = { type: 'none' };
  private readonly listeners = new Set<() => void>();

  constructor(doc: BoardDocument = new BoardDocument()) {
    this.doc = doc;
    doc.onChange(() => {
      // Убираем из выделения то, что удалили (в том числе другие участники).
      if ([...this.selection].some((id) => !doc.has(id))) {
        this.selection = new Set([...this.selection].filter((id) => doc.has(id)));
      }
      // Фигуру удалил другой участник, пока здесь шёл ввод: сохранять текст некуда.
      if (this.editingId && !doc.has(this.editingId)) {
        this.editingId = null;
        this.draftText = '';
      }
      this.emit();
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): EditorState {
    return {
      tool: this.tool,
      smartDrawing: this.smartDrawing,
      arrowRoute: this.arrowRoute,
      selectionRoute: this.selectionRoute(),
      selection: this.selection,
      editingId: this.editingId,
      camera: this.camera,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private readonly lookup = (id: string) => this.doc.get(id);

  private arrow(id: string): ArrowElement | undefined {
    const el = this.doc.get(id);
    return el && isArrow(el) ? el : undefined;
  }

  private shape(id: string): ShapeElement | undefined {
    const el = this.doc.get(id);
    return el && !isArrow(el) ? el : undefined;
  }

  // ---------- Инструменты, выделение, камера ----------

  setSmartDrawing(enabled: boolean): void {
    this.smartDrawing = enabled;
    this.emit();
  }

  private selectedArrows(): ArrowElement[] {
    return [...this.selection].map((id) => this.arrow(id)).filter((el) => el !== undefined);
  }

  selectionRoute(): SelectionRoute {
    const routes = new Set(this.selectedArrows().map((arrow) => arrow.route));
    if (routes.size === 0) return null;
    const [only] = routes;
    return routes.size === 1 && only ? only : 'mixed';
  }

  /** Вид линии для новых стрелок и для выделенных: меняются одним шагом отмены. */
  setArrowRoute(route: ArrowRoute): void {
    this.arrowRoute = route;
    const arrows = this.selectedArrows().filter((arrow) => arrow.route !== route);
    if (arrows.length > 0) {
      this.doc.stopCapturing();
      this.doc.transact(() => {
        for (const arrow of arrows) this.doc.update(arrow.id, { route });
      });
      this.doc.stopCapturing();
    }
    this.emit();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool !== 'select') this.selection = new Set();
    this.emit();
  }

  select(ids: Iterable<string>): void {
    this.selection = new Set(ids);
    this.emit();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.emit();
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
    return elementAt(this.doc, world, this.px(HIT_TOLERANCE_PX));
  }

  private bindTargetAt(world: Point, exclude?: string): ShapeElement | undefined {
    return bindTargetAt(this.doc, world, this.px(BIND_DISTANCE_PX), exclude);
  }

  /** Ручки изменения размера для одной выделенной фигуры. */
  handlePositions(): { handle: Handle; point: Point }[] {
    const el = this.singleSelected();
    if (!el || isArrow(el)) return [];
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
    const el = this.singleSelected();
    if (!el || !isArrow(el)) return undefined;
    const { start, end } = resolveArrow(el, this.lookup);
    const radius = this.px(HANDLE_SIZE_PX);
    if (distance(start, world) <= radius) return { id: el.id, which: 'start' };
    if (distance(end, world) <= radius) return { id: el.id, which: 'end' };
    return undefined;
  }

  singleSelected(): BoardElement | undefined {
    if (this.selection.size !== 1) return undefined;
    const [id] = this.selection;
    return id === undefined ? undefined : this.doc.get(id);
  }

  // ---------- Указатель ----------

  pointerDown(screen: Point, input: PointerInput = {}): void {
    const world = this.toWorld(screen);
    const button = input.button ?? 0;
    this.doc.stopCapturing();

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
    else if (isShapeTool(tool)) this.beginCreate(tool, world);
  }

  private beginCreate(kind: ShapeKind, world: Point): void {
    const id = newId();
    this.doc.add({
      id,
      kind,
      x: world.x,
      y: world.y,
      w: 0,
      h: 0,
      text: '',
      stroke: DEFAULT_STROKE,
      fill: DEFAULT_FILLS[kind] ?? DEFAULT_FILL,
      z: this.doc.nextZ(),
    });
    this.selection = new Set([id]);
    this.interaction = { type: 'create', id, origin: world };
    this.emit();
  }

  private beginArrow(world: Point): void {
    const id = newId();
    const target = this.bindTargetAt(world);
    const start: ArrowEnd = target ? { x: world.x, y: world.y, shapeId: target.id } : world;
    this.doc.add({
      id,
      kind: 'arrow',
      start,
      end: { x: world.x, y: world.y },
      route: this.arrowRoute,
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
      this.interaction = { type: 'move', last: world };
      this.emit();
      return;
    }
    const base = shift ? new Set(this.selection) : new Set<string>();
    this.selection = new Set(base);
    this.interaction = { type: 'marquee', origin: world, current: world, base };
    this.marquee = normalizeBounds(world, world);
    this.emit();
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
        this.moveSelection(world.x - it.last.x, world.y - it.last.y);
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
          [it.which]: target
            ? { x: world.x, y: world.y, shapeId: target.id }
            : { x: world.x, y: world.y },
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
        const inside = this.doc
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
    commitStroke(this.doc, stroke, result, this.camera.zoom);
  }

  private finishCreate(id: string, origin: Point): void {
    const el = this.shape(id);
    if (!el) return;
    if (el.w < MIN_SIZE && el.h < MIN_SIZE) {
      // Щелчок без перетаскивания: фигура стандартного размера с центром в точке щелчка.
      const size = DEFAULT_SIZE[el.kind];
      this.doc.update(id, { x: origin.x - size.w / 2, y: origin.y - size.h / 2, ...size });
    } else {
      this.doc.update(id, { w: Math.max(el.w, MIN_SIZE), h: Math.max(el.h, MIN_SIZE) });
    }
    this.tool = 'select';
    if (el.kind === 'text') this.startEditing(id);
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

  private moveSelection(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.doc.transact(() => {
      for (const id of this.selection) {
        const el = this.doc.get(id);
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

  private resize(
    it: { id: string; handle: Handle; start: Bounds; origin: Point },
    world: Point,
    keepRatio: boolean,
  ): void {
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

  doubleClick(screen: Point): void {
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

  // ---------- Текст ----------

  /**
   * Открывает редактирование текста фигуры. Набранный текст хранится здесь, а не в поле
   * ввода: так он сохранится при любом способе закончить ввод — Esc, щелчком по холсту,
   * сменой инструмента или уходом фокуса.
   */
  startEditing(id: string): void {
    if (this.editingId === id) return;
    if (this.editingId) this.stopEditing();
    const el = this.doc.get(id);
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
    const el = this.doc.get(id);
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
    if (this.selection.size === 0) return;
    this.doc.stopCapturing();
    this.doc.remove(this.selection);
    this.doc.stopCapturing();
    this.selection = new Set();
    this.emit();
  }

  duplicateSelection(): void {
    const originals = [...this.selection]
      .map((id) => this.doc.get(id))
      .filter((el) => el !== undefined);
    if (originals.length === 0) return;
    // Новые id выдаются заранее, чтобы копии стрелок цеплялись за копии фигур.
    const pairs = originals.map((original) => ({ original, id: newId() }));
    const copyIds = new Map(pairs.map(({ original, id }) => [original.id, id]));
    const copyEnd = (end: ArrowEnd): ArrowEnd => {
      const copiedShape = end.shapeId ? copyIds.get(end.shapeId) : undefined;
      return copiedShape
        ? { ...end, shapeId: copiedShape }
        : { x: end.x + DUPLICATE_OFFSET, y: end.y + DUPLICATE_OFFSET };
    };
    let z = this.doc.nextZ();
    const copies: BoardElement[] = pairs.map(({ original: el, id }) =>
      isArrow(el)
        ? { ...el, id, start: copyEnd(el.start), end: copyEnd(el.end), z: z++ }
        : { ...el, id, x: el.x + DUPLICATE_OFFSET, y: el.y + DUPLICATE_OFFSET, z: z++ },
    );

    this.doc.stopCapturing();
    this.doc.transact(() => {
      for (const copy of copies) this.doc.add(copy);
    });
    this.doc.stopCapturing();
    this.selection = new Set(copies.map((el) => el.id));
    this.emit();
  }

  undo(): void {
    this.doc.undo();
  }

  redo(): void {
    this.doc.redo();
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
