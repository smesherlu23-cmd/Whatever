import { BoardDocument, newId } from '../model/document';
import { normalizePath } from '../model/geometry';
import { bindTargetAt, isConnectable } from '../model/queries';
import {
  type ArrowEnd,
  type BoardElement,
  DEFAULT_FILL,
  DEFAULT_STROKE,
  type Point,
} from '../model/types';
import { beautifyBounds, straightenLine } from '../recognition/beautify';
import type { Recognized } from '../recognition/recognize';

/** Конец нарисованной линии привязывается к фигуре, если до неё не больше стольких экранных px. */
const BIND_DISTANCE_PX = 24;
/** Центр новой фигуры встаёт на одну линию с соседом, если промах не больше стольких px. */
const ALIGN_DISTANCE_PX = 12;

type Shape = Exclude<Recognized, { kind: 'none' }>;

/**
 * Сохраняет рукописный штрих и, если он распознан, заменяет его ровной фигурой.
 * Замена — отдельный шаг отмены: одно Ctrl+Z возвращает набросок, второе убирает его.
 */
export function commitStroke(
  doc: BoardDocument,
  stroke: readonly Point[],
  result: Recognized | null,
  zoom: number,
): void {
  const pathId = newId();
  const { bounds, points } = normalizePath(stroke);
  doc.stopCapturing();
  doc.add({
    id: pathId,
    kind: 'path',
    ...bounds,
    points,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: 'transparent',
    z: doc.nextZ(),
  });
  doc.stopCapturing();

  if (!result || result.kind === 'none') return;
  const element = toElement(doc, result, pathId, zoom);
  if (!element) return;
  doc.transact(() => {
    doc.remove([pathId]);
    doc.add(element);
  });
  doc.stopCapturing();
}

function toElement(
  doc: BoardDocument,
  result: Shape,
  pathId: string,
  zoom: number,
): BoardElement | null {
  const id = newId();
  const z = doc.nextZ();

  if (result.kind === 'line') {
    const tolerance = BIND_DISTANCE_PX / zoom;
    const from = bindTargetAt(doc, result.start, tolerance, pathId);
    const to = bindTargetAt(doc, result.end, tolerance, pathId);
    // Петля на одной фигуре — скорее каракуля, чем связь: оставляем набросок.
    if (from !== undefined && from.id === to?.id) return null;
    const straight = straightenLine(result.start, result.end);
    const start: ArrowEnd = from ? { ...result.start, shapeId: from.id } : straight.start;
    const end: ArrowEnd = to ? { ...result.end, shapeId: to.id } : straight.end;
    return { id, kind: 'arrow', start, end, route: 'straight', stroke: DEFAULT_STROKE, z };
  }

  const neighbours = doc
    .list()
    .filter(isConnectable)
    .filter((el) => el.kind !== 'text');
  const bounds = beautifyBounds(result.kind, result.bounds, neighbours, ALIGN_DISTANCE_PX / zoom);
  return {
    id,
    kind: result.kind,
    ...bounds,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z,
  };
}
