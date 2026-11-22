import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { worldToScreen } from '../canvas/camera';
import { arrowPath, labelAnchor } from '../model/geometry';
import { shapeSpec } from '../model/shapes';
import {
  FONT_SIZE,
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  LABEL_MAX_WIDTH,
  LABEL_PADDING,
  LINE_HEIGHT,
  SECTION_PADDING,
  SMALL_FONT_SIZE,
  SMALL_LINE_HEIGHT,
  estimateMeasure,
  wrapText,
} from '../model/textLayout';
import { type BoardElement, type Bounds, DEFAULT_STROKE, isArrow } from '../model/types';
import type { Editor } from './Editor';
import styles from './TextEditor.module.css';

interface Frame {
  /** Где стоит текст, в мировых координатах. */
  box: Bounds;
  fontSize: number;
  lineHeight: number;
  fontWeight?: number;
  align: 'center' | 'left';
  /** Отступ текста сверху; null — по центру по вертикали, как на холсте. */
  top: number | null;
  /** Одна строка: Enter завершает ввод. */
  singleLine: boolean;
  /** Подпись стрелки закрывает линию, как на холсте. */
  opaque: boolean;
  /** Заголовок дорожки пишется снизу вверх, и поле повёрнуто так же. */
  vertical: boolean;
}

const base = {
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  align: 'center',
  top: null,
  singleLine: false,
  opaque: false,
  vertical: false,
} as const;

/** Место и вид текста элемента: те же, что при отрисовке на холсте. */
function frameOf(element: BoardElement, editor: Editor, text: string): Frame {
  if (isArrow(element)) {
    const anchor = labelAnchor(arrowPath(element, (id) => editor.page.get(id)));
    const lines = wrapText(estimateMeasure(LABEL_FONT_SIZE), text, LABEL_MAX_WIDTH).length;
    const h = lines * LABEL_LINE_HEIGHT + LABEL_PADDING * 2;
    return {
      ...base,
      box: { x: anchor.x - LABEL_MAX_WIDTH / 2, y: anchor.y - h / 2, w: LABEL_MAX_WIDTH, h },
      fontSize: LABEL_FONT_SIZE,
      lineHeight: LABEL_LINE_HEIGHT,
      singleLine: true,
      opaque: true,
    };
  }
  if (element.kind === 'path') return { ...base, box: element };
  const spec = shapeSpec(element.kind);
  const box = spec.textBox(element);
  const small = { fontSize: SMALL_FONT_SIZE, lineHeight: SMALL_LINE_HEIGHT };
  switch (spec.text) {
    case 'compartments':
      return { ...base, ...small, box, align: 'left', top: SECTION_PADDING };
    case 'title':
      return { ...base, ...small, box, fontWeight: 600, align: 'left', singleLine: true };
    case 'vertical':
      return { ...base, ...small, box, fontWeight: 600, singleLine: true, vertical: true };
    // У картинок и вложений текста нет, и поле для них не открывается (см. hasText).
    case 'none':
    case 'center':
      return { ...base, box };
  }
}

/** Поле ввода поверх фигуры или подписи стрелки, текст которой сейчас редактируется. */
export function TextEditor({ editor, id }: { editor: Editor; id: string }) {
  const element = editor.page.get(id);
  const [value, setValue] = useState(() => editor.editingText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!element) return null;
  const { zoom } = editor.camera;
  const frame = frameOf(element, editor, value);
  const { box } = frame;
  // Повёрнутое поле: до поворота его ширина — высота полосы, высота — её ширина.
  const [w, h] = frame.vertical ? [box.h, box.w] : [box.w, box.h];
  const center = worldToScreen(editor.camera, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
  const lines = Math.max(1, value.split('\n').length);

  const style: CSSProperties = {
    left: center.x - (w * zoom) / 2,
    top: center.y - (h * zoom) / 2,
    width: w * zoom,
    height: h * zoom,
    fontSize: frame.fontSize * zoom,
    fontWeight: frame.fontWeight,
    lineHeight: `${frame.lineHeight * zoom}px`,
    textAlign: frame.align,
    paddingTop: (frame.top ?? Math.max(0, (h - frame.lineHeight * lines) / 2)) * zoom,
    transform: frame.vertical ? 'rotate(-90deg)' : undefined,
    // Цвет по умолчанию берётся из темы, как на холсте.
    color: element.stroke === DEFAULT_STROKE ? 'var(--shape-stroke)' : element.stroke,
    background: frame.opaque ? 'var(--canvas-bg)' : undefined,
  };

  const finish = () => {
    editor.stopEditing();
  };

  return (
    <textarea
      ref={ref}
      className={styles.input}
      aria-label={isArrow(element) ? 'Подпись стрелки' : 'Текст фигуры'}
      value={value}
      style={style}
      onChange={(e) => {
        setValue(e.target.value);
        editor.setEditingText(e.target.value);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        // Подпись и заголовок — короткие строки: Enter завершает ввод, Shift+Enter переносит.
        const submit = frame.singleLine ? !e.shiftKey : e.ctrlKey || e.metaKey;
        if (e.key === 'Escape' || (e.key === 'Enter' && submit)) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}
