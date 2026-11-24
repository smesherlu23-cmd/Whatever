import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CommentThread, ElementAnchor } from '../../api';
import { worldToScreen } from '../../canvas/camera';
import { pinPoint } from '../../comments/anchor';
import { isOpen } from '../../comments/threads';
import type { Editor } from '../../editor/Editor';
import type { Point } from '../../model/types';
import styles from './CommentPins.module.css';

/** Новое обсуждение, которое ещё пишут: где будет метка. */
export interface DraftPin {
  page: string;
  x: number;
  y: number;
  element: ElementAnchor | null;
}

interface PinView {
  id: string;
  thread: CommentThread | null;
  at: Point;
}

const DRAFT = 'draft';

/** Метки открытой страницы в экранных координатах холста. */
function layout(
  editor: Editor,
  threads: readonly CommentThread[],
  selectedId: string | null,
  draft: DraftPin | null,
): PinView[] {
  const lookup = (id: string) => editor.page.get(id);
  const toScreen = (point: Point) => worldToScreen(editor.camera, point);
  const pins: PinView[] = threads
    .filter((t) => t.page === editor.pageId && (isOpen(t) || t.id === selectedId))
    .map((thread) => ({ id: thread.id, thread, at: toScreen(pinPoint(thread, lookup)) }));
  if (draft?.page === editor.pageId) {
    pins.push({ id: DRAFT, thread: null, at: toScreen(pinPoint(draft, lookup)) });
  }
  return pins;
}

const samePins = (a: readonly PinView[], b: readonly PinView[]) =>
  a.length === b.length &&
  a.every((pin, i) => {
    const other = b[i];
    return pin.thread === other?.thread && pin.at.x === other.at.x && pin.at.y === other.at.y;
  });

/**
 * Метки для useSyncExternalStore. Пересчитываются при каждом изменении редактора, а прежний
 * список отдаётся, пока ни одна метка не сдвинулась: тогда компонент не перерисовывается.
 */
class PinLayout {
  private last: PinView[] = [];

  constructor(
    private readonly editor: Editor,
    private readonly threads: readonly CommentThread[],
    private readonly selectedId: string | null,
    private readonly draft: DraftPin | null,
  ) {}

  readonly subscribe = (onChange: () => void) => this.editor.subscribe(onChange);

  readonly read = (): PinView[] => {
    const next = layout(this.editor, this.threads, this.selectedId, this.draft);
    if (!samePins(this.last, next)) this.last = next;
    return this.last;
  };
}

/**
 * Метки обсуждений поверх холста. Двигаются вместе с камерой и с элементами, к которым
 * прикреплены. Решённые обсуждения не показываются, кроме открытого в панели.
 */
export function CommentPins({
  editor,
  threads,
  selectedId,
  draft,
  onSelect,
}: {
  editor: Editor;
  threads: readonly CommentThread[];
  selectedId: string | null;
  draft: DraftPin | null;
  onSelect: (threadId: string) => void;
}) {
  const pinLayout = useMemo(
    () => new PinLayout(editor, threads, selectedId, draft),
    [editor, threads, selectedId, draft],
  );
  const pins = useSyncExternalStore(pinLayout.subscribe, pinLayout.read);
  const layer = useRef<HTMLDivElement>(null);

  // Колесо над меткой двигает и масштабирует доску, как над холстом: метка лежит поверх
  // холста и иначе забирала бы прокрутку себе, а Ctrl+колесо масштабировало бы страницу.
  // Слушатель не пассивный, иначе масштаб страницы браузера не отменить.
  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      editor.wheel(at, e.deltaX, e.deltaY, e.ctrlKey || e.metaKey);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [editor]);

  return (
    <div ref={layer} className={styles.layer}>
      {pins.map(({ id, thread, at }) => {
        // Сдвиг задаётся свойством translate, а не transform: увеличение при наведении (scale)
        // тогда растягивает метку на месте, а не уносит её из-под указателя.
        const style = { translate: `${at.x}px ${at.y}px` };
        if (!thread) {
          return (
            <span key={id} className={styles.pin} data-draft="" style={style} aria-hidden="true">
              +
            </span>
          );
        }
        const [question] = thread.comments;
        const author = thread.author?.name ?? 'Удалённый пользователь';
        const replies = thread.comments.length - 1;
        return (
          <button
            key={id}
            type="button"
            className={styles.pin}
            style={style}
            data-selected={thread.id === selectedId ? '' : undefined}
            data-resolved={isOpen(thread) ? undefined : ''}
            aria-label={`Обсуждение: ${author}: ${question?.text ?? ''}`}
            title={replies > 0 ? `${author} и ещё ответов: ${replies}` : author}
            onClick={() => {
              onSelect(thread.id);
            }}
          >
            {author.slice(0, 1).toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
