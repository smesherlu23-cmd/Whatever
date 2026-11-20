import { useEffect, useRef, useState } from 'react';
import { worldToScreen } from '../canvas/camera';
import { isArrow } from '../model/types';
import type { Editor } from './Editor';
import styles from './TextEditor.module.css';

/** Поле ввода поверх фигуры, текст которой сейчас редактируется. */
export function TextEditor({ editor, id }: { editor: Editor; id: string }) {
  const element = editor.doc.get(id);
  const [value, setValue] = useState(element && !isArrow(element) ? element.text : '');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (!element || isArrow(element)) return null;
  const { zoom } = editor.camera;
  const topLeft = worldToScreen(editor.camera, { x: element.x, y: element.y });

  const finish = () => {
    editor.commitText(id, value);
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
        fontSize: 16 * zoom,
        lineHeight: `${20 * zoom}px`,
        paddingTop: Math.max(0, (element.h * zoom - 20 * zoom * Math.max(1, value.split('\n').length)) / 2),
        color: element.stroke,
      }}
      onChange={(e) => setValue(e.target.value)}
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
