import { useEffect, useRef, useState } from 'react';
import { worldToScreen } from '../canvas/camera';
import { FONT_SIZE, LINE_HEIGHT } from '../canvas/textLayout';
import { DEFAULT_STROKE, isArrow } from '../model/types';
import type { Editor } from './Editor';
import styles from './TextEditor.module.css';

/** Поле ввода поверх фигуры, текст которой сейчас редактируется. */
export function TextEditor({ editor, id }: { editor: Editor; id: string }) {
  const element = editor.doc.get(id);
  const [value, setValue] = useState(() => editor.editingText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!element || isArrow(element)) return null;
  const { zoom } = editor.camera;
  const topLeft = worldToScreen(editor.camera, { x: element.x, y: element.y });

  const finish = () => {
    editor.stopEditing();
  };

  return (
    <textarea
      ref={ref}
      className={styles.input}
      aria-label="Текст фигуры"
      value={value}
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: element.w * zoom,
        height: element.h * zoom,
        fontSize: FONT_SIZE * zoom,
        lineHeight: `${LINE_HEIGHT * zoom}px`,
        // Текст по вертикали по центру, как на холсте.
        paddingTop: Math.max(
          0,
          (element.h - LINE_HEIGHT * Math.max(1, value.split('\n').length)) * zoom * 0.5,
        ),
        // Цвет по умолчанию берётся из темы, как на холсте.
        color: element.stroke === DEFAULT_STROKE ? 'var(--shape-stroke)' : element.stroke,
      }}
      onChange={(e) => {
        setValue(e.target.value);
        editor.setEditingText(e.target.value);
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          finish();
        }
      }}
    />
  );
}
