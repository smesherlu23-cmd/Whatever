import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { worldToScreen } from '../canvas/camera';
import { arrowPath, labelAnchor } from '../model/geometry';
import {
  FONT_SIZE,
  LABEL_FONT_SIZE,
  LABEL_LINE_HEIGHT,
  LABEL_MAX_WIDTH,
  LABEL_PADDING,
  LINE_HEIGHT,
  estimateMeasure,
  textBox,
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
  /** Сколько строк займёт текст: по ним поле ставит его по центру по вертикали. */
  lines: number;
  /** Подпись стрелки закрывает линию, как на холсте. */
  opaque: boolean;
}

/** Место и размер текста элемента: те же, что при отрисовке на холсте. */
function frameOf(element: BoardElement, editor: Editor, text: string): Frame {
  if (!isArrow(element)) {
    return {
      box: textBox(element),
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      lines: Math.max(1, text.split('\n').length),
      opaque: false,
    };
  }
  const anchor = labelAnchor(arrowPath(element, (id) => editor.page.get(id)));
  const lines = wrapText(estimateMeasure(LABEL_FONT_SIZE), text, LABEL_MAX_WIDTH).length;
  const h = lines * LABEL_LINE_HEIGHT + LABEL_PADDING * 2;
  return {
    box: { x: anchor.x - LABEL_MAX_WIDTH / 2, y: anchor.y - h / 2, w: LABEL_MAX_WIDTH, h },
    fontSize: LABEL_FONT_SIZE,
    lineHeight: LABEL_LINE_HEIGHT,
    lines,
    opaque: true,
  };
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
  const topLeft = worldToScreen(editor.camera, { x: frame.box.x, y: frame.box.y });

  const finish = () => {
    editor.stopEditing();
  };

  const style: CSSProperties = {
    left: topLeft.x,
    top: topLeft.y,
    width: frame.box.w * zoom,
    height: frame.box.h * zoom,
    fontSize: frame.fontSize * zoom,
    lineHeight: `${frame.lineHeight * zoom}px`,
    // Текст по вертикали по центру, как на холсте.
    paddingTop: Math.max(0, (frame.box.h - frame.lineHeight * frame.lines) * zoom * 0.5),
    // Цвет по умолчанию берётся из темы, как на холсте.
    color: element.stroke === DEFAULT_STROKE ? 'var(--shape-stroke)' : element.stroke,
    background: frame.opaque ? 'var(--canvas-bg)' : undefined,
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
        // У подписи стрелки Enter завершает ввод, а Shift+Enter переносит строку:
        // подписи обычно короткие.
        const submit = isArrow(element) ? !e.shiftKey : e.ctrlKey || e.metaKey;
        if (e.key === 'Escape' || (e.key === 'Enter' && submit)) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}
