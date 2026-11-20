import { type Camera, initialCamera, panBy, screenToWorld, zoomAt } from '../canvas/camera';
import { BoardDocument, newId } from '../model/document';
import {
  contains,
  elementBounds,
  hitTest,
  normalizeBounds,
  normalizePath,
  resolveArrow,
} from '../model/geometry';
import {
  type ArrowElement,
  type ArrowEnd,
  type BoardElement,
  type Bounds,
  DEFAULT_FILL,
  DEFAULT_STROKE,
  type Point,
  type ShapeElement,
  type ShapeKind,
  isArrow,
} from '../model/types';
import { beautifyBounds, straightenLine } from '../recognition/beautify';
import { type Recognized, recognize } from '../recognition/recognize';

export type Tool = 'select' | 'pen' | 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'text';

/**
 * Когда превращать набросок в фигуру: hold — если задержать курсор в конце штриха
 * (как в Telegram), always — после каждого штриха, off — никогда.
 */
export type SmartMode = 'hold' | 'always' | 'off';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Размер в экранных пикселях: зоны захвата не зависят от масштаба. */
const HIT_TOLERANCE_PX = 6;
const HANDLE_SIZE_PX = 10;
const BIND_DISTANCE_PX = 12;
const MIN_SIZE = 8;
const DEFAULT_SIZE: Record<ShapeKind, { w: number; h: number }> = {
  rectangle: { w: 160, h: 80 },
  ellipse: { w: 120, h: 120 },
  diamond: { w: 140, h: 100 },
  text: { w: 160, h: 40 },
  path: { w: 0, h: 0 },
};
const DUPLICATE_OFFSET = 24;
/** Сколько держать курсор неподвижно в конце штриха, чтобы фигура выровнялась. */
export const HOLD_MS = 450;
const HOLD_STILL_PX = 3;
const SMART_BIND_PX = 24;
const SMART_ALIGN_PX = 12;

export interface PointerInput {
  button?: number;
  shift?: boolean;
}

export interface KeyInput {
  key: string;
  code?: string;
  ctrl?: boolean;
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
  | { type: 'draw'; anchor: Point };

export interface EditorState {
  tool: Tool;
  smartMode: SmartMode;
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
  marquee: Bounds | null = null;
  spaceHeld = false;
  smartMode: SmartMode = 'hold';
  /** Штрих, который рисуется сейчас (мировые координаты), и его распознанный вид при задержке. */
  stroke: Point[] | null = null;
  strokePreview: Recognized | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private interaction: Interaction = { type: 'none' };
  private listeners = new Set<() => void>();
  private unsubscribeDoc: () => void;

  constructor(doc: BoardDocument = new BoardDocument()) {
    this.doc = doc;
    this.unsubscribeDoc = doc.onChange(() => {
      // Убираем из выделения то, что удалили (в том числе другие участники).
      for (const id of this.selection) if (!doc.has(id)) this.selection.delete(id);
      if (this.editingId && !doc.has(this.editingId)) this.editingId = null;
      this.emit();
    });
  }

  destroy(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.unsubscribeDoc();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): EditorState {
    return {
      tool: this.tool,
      smartMode: this.smartMode,
      selection: this.selection,
      editingId: this.editingId,
      camera: this.camera,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private lookup = (id: string) => this.doc.get(id);

  // ---------- Инструменты, выделение, камера ----------

  setSmartMode(mode: SmartMode): void {
    this.smartMode = mode;
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
    const elements = this.doc.list();
    const tolerance = this.px(HIT_TOLERANCE_PX);
    for (let i = elements.length - 1; i >= 0; i--) {
      if (hitTest(elements[i], world, this.lookup, tolerance)) return elements[i];
    }
    return undefined;
  }

  /** Фигура, к которой можно привязать конец стрелки. */
  private bindTargetAt(world: Point, exclude?: string): ShapeElement | undefined {
    const elements = this.doc.list();
    const tolerance = this.px(BIND_DISTANCE_PX);
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (isArrow(el) || el.id === exclude || el.kind === 'path') continue;
      if (hitTest(el, world, this.lookup, tolerance)) return el;
    }
    return undefined;
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
    if (Math.hypot(start.x - world.x, start.y - world.y) <= radius) return { id: el.id, which: 'start' };
    if (Math.hypot(end.x - world.x, end.y - world.y) <= radius) return { id: el.id, which: 'end' };
    return undefined;
  }

  singleSelected(): BoardElement | undefined {
    if (this.selection.size !== 1) return undefined;
    const [id] = this.selection;
    return this.doc.get(id);
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

    switch (this.tool) {
      case 'pen':
        this.beginStroke(world, screen);
        return;
      case 'rectangle':
      case 'ellipse':
      case 'diamond':
      case 'text':
        this.beginCreate(this.tool, world);
        return;
      case 'arrow':
        this.beginArrow(world);
        return;
      case 'select':
        this.beginSelect(world, input.shift ?? false);
    }
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
      fill: kind === 'text' ? 'transparent' : DEFAULT_FILL,
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
        const arrow = this.doc.get(it.id) as ArrowElement | undefined;
        if (!arrow) return;
        const other = arrow[it.which === 'start' ? 'end' : 'start'];
        const target = this.bindTargetAt(world, other.shapeId);
        this.doc.update(it.id, {
          [it.which]: target ? { x: world.x, y: world.y, shapeId: target.id } : { x: world.x, y: world.y },
        });
        return;
      }
      case 'draw': {
        this.stroke?.push(world);
        if (Math.hypot(screen.x - it.anchor.x, screen.y - it.anchor.y) > HOLD_STILL_PX) {
          it.anchor = screen;
          this.strokePreview = null;
          this.scheduleHold();
        }
        this.emit();
        return;
      }
      case 'marquee': {
        it.current = world;
        this.marquee = normalizeBounds(it.origin, world);
        const inside = this.doc
          .list()
          .filter((el) => contains(this.marquee!, elementBounds(el, this.lookup)))
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

  private beginStroke(world: Point, screen: Point): void {
    this.selection = new Set();
    this.stroke = [world];
    this.strokePreview = null;
    this.interaction = { type: 'draw', anchor: screen };
    this.scheduleHold();
    this.emit();
  }

  private scheduleHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    if (this.smartMode !== 'hold') return;
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (!this.stroke) return;
      const result = recognize(this.stroke);
      this.strokePreview = result.kind === 'none' ? null : result;
      this.emit();
    }, HOLD_MS);
  }

  private finishStroke(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    const stroke = this.stroke;
    const preview = this.strokePreview;
    this.stroke = null;
    this.strokePreview = null;
    if (!stroke || stroke.length < 2) return;

    let result: Recognized | null = null;
    if (this.smartMode === 'hold') result = preview;
    if (this.smartMode === 'always') result = recognize(stroke);

    // Сначала сохраняем рукописный штрих, потом заменяем его фигурой отдельным шагом:
    // так одно Ctrl+Z возвращает набросок, а второе убирает его совсем.
    const pathId = newId();
    const { bounds, points } = normalizePath(stroke);
    this.doc.stopCapturing();
    this.doc.add({
      id: pathId,
      kind: 'path',
      ...bounds,
      points,
      text: '',
      stroke: DEFAULT_STROKE,
      fill: 'transparent',
      z: this.doc.nextZ(),
    });
    this.doc.stopCapturing();
    if (result && result.kind !== 'none') this.replaceWithShape(pathId, result);
  }

  /** Заменяет штрих распознанной фигурой или стрелкой. Возвращает id нового элемента. */
  private replaceWithShape(pathId: string, result: Exclude<Recognized, { kind: 'none' }>): string | null {
    const z = this.doc.nextZ();
    const id = newId();
    if (result.kind === 'line') {
      const tolerance = this.px(SMART_BIND_PX);
      const from = this.bindTargetNear(result.start, tolerance, pathId);
      const to = this.bindTargetNear(result.end, tolerance, pathId);
      if (from && to && from.id === to.id) return null;
      const straight = straightenLine(result.start, result.end);
      const start: ArrowEnd = from ? { ...result.start, shapeId: from.id } : straight.start;
      const end: ArrowEnd = to ? { ...result.end, shapeId: to.id } : straight.end;
      this.doc.transact(() => {
        this.doc.remove([pathId]);
        this.doc.add({ id, kind: 'arrow', start, end, stroke: DEFAULT_STROKE, z });
      });
    } else {
      const neighbours = this.doc
        .list()
        .filter((el): el is ShapeElement => !isArrow(el) && el.kind !== 'path' && el.kind !== 'text');
      const bounds = beautifyBounds(result.kind, result.bounds, neighbours, this.px(SMART_ALIGN_PX));
      this.doc.transact(() => {
        this.doc.remove([pathId]);
        this.doc.add({
          id,
          kind: result.kind,
          ...bounds,
          text: '',
          stroke: DEFAULT_STROKE,
          fill: DEFAULT_FILL,
          z,
        });
      });
    }
    this.doc.stopCapturing();
    return id;
  }

  private bindTargetNear(world: Point, tolerance: number, exclude: string): ShapeElement | undefined {
    const elements = this.doc.list();
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (isArrow(el) || el.id === exclude || el.kind === 'path') continue;
      if (hitTest(el, world, this.lookup, tolerance)) return el;
    }
    return undefined;
  }

  private finishCreate(id: string, origin: Point): void {
    const el = this.doc.get(id) as ShapeElement | undefined;
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
    const arrow = this.doc.get(id) as ArrowElement | undefined;
    if (!arrow) return;
    const { start, end } = resolveArrow(arrow, this.lookup);
    const sameShape = arrow.start.shapeId && arrow.start.shapeId === arrow.end.shapeId;
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_SIZE || sameShape) {
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
    if (hit && !isArrow(hit) && hit.kind !== 'path') {
      this.selection = new Set([hit.id]);
      this.startEditing(hit.id);
    } else if (!hit) {
      this.tool = 'text';
      this.pointerDown(screen);
      this.pointerUp();
    }
  }

  // ---------- Текст ----------

  startEditing(id: string): void {
    this.editingId = id;
    this.emit();
  }

  commitText(id: string, text: string): void {
    const el = this.doc.get(id);
    if (!el || isArrow(el)) return;
    this.doc.stopCapturing();
    if (el.kind === 'text' && text.trim() === '') {
      this.doc.remove([id]);
    } else if (el.text !== text) {
      this.doc.update(id, { text });
    }
  }

  stopEditing(): void {
    this.editingId = null;
    this.emit();
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
    const copies = new Map<string, string>();
    const elements = [...this.selection].map((id) => this.doc.get(id)).filter((el) => el !== undefined);
    for (const el of elements) copies.set(el.id, newId());
    let z = this.doc.nextZ();
    this.doc.stopCapturing();
    this.doc.transact(() => {
      for (const el of elements) {
        const id = copies.get(el.id)!;
        if (isArrow(el)) {
          const copyEnd = (end: ArrowEnd): ArrowEnd =>
            end.shapeId && copies.has(end.shapeId)
              ? { ...end, shapeId: copies.get(end.shapeId) }
              : { x: end.x + DUPLICATE_OFFSET, y: end.y + DUPLICATE_OFFSET };
          this.doc.add({ ...el, id, start: copyEnd(el.start), end: copyEnd(el.end), z: z++ });
        } else {
          this.doc.add({ ...el, id, x: el.x + DUPLICATE_OFFSET, y: el.y + DUPLICATE_OFFSET, z: z++ });
        }
      }
    });
    this.doc.stopCapturing();
    this.selection = new Set(copies.values());
    this.emit();
  }

  undo(): void {
    this.doc.undo();
  }

  redo(): void {
    this.doc.redo();
  }

  /** Возвращает true, если клавиша обработана и браузеру её отдавать не нужно. */
  keyDown(e: KeyInput): boolean {
    if (this.editingId) return false;
    const key = e.key.toLowerCase();
    if (e.ctrl) {
      if (e.code === 'KeyZ' || key === 'z') {
        if (e.shift) this.redo();
        else this.undo();
        return true;
      }
      if (e.code === 'KeyY' || key === 'y') {
        this.redo();
        return true;
      }
      if (e.code === 'KeyA' || key === 'a') {
        this.select(this.doc.list().map((el) => el.id));
        return true;
      }
      if (e.code === 'KeyD' || key === 'd') {
        this.duplicateSelection();
        return true;
      }
      return false;
    }
    if (key === 'delete' || key === 'backspace') {
      this.deleteSelection();
      return true;
    }
    if (key === 'escape') {
      this.select([]);
      this.setTool('select');
      return true;
    }
    if (key === 'enter') {
      const el = this.singleSelected();
      if (el && !isArrow(el) && el.kind !== 'path') {
        this.startEditing(el.id);
        return true;
      }
      return false;
    }
    const tools: Record<string, Tool> = {
      KeyV: 'select',
      KeyP: 'pen',
      KeyR: 'rectangle',
      KeyO: 'ellipse',
      KeyD: 'diamond',
      KeyA: 'arrow',
      KeyT: 'text',
    };
    const tool = e.code ? tools[e.code] : undefined;
    if (tool) {
      this.setTool(tool);
      return true;
    }
    return false;
  }
}
