import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '../../editor/Editor';
import { useEditorState } from '../../editor/useEditorState';
import { hasText } from '../../model/queries';
import type { Point } from '../../model/types';
import { MenuItem, MenuSeparator, moveMenuFocus } from '../../ui/Menu';
import menuStyles from '../../ui/Menu.module.css';
import { useDismiss } from '../../ui/useDismiss';
import styles from './BoardMenu.module.css';

/** Отступ меню от края холста, в пикселях. */
const EDGE = 8;

/**
 * Контекстное меню холста: действия с выделенным и со всей страницей. То же самое делается
 * клавишами, они подписаны справа. Меню закрывается выбором пункта, щелчком мимо, Esc и
 * сдвигом доски: тогда оно уже не стоит рядом с тем, к чему относится.
 */
export function BoardMenu({
  editor,
  at,
  onClose,
}: {
  editor: Editor;
  /** Где щёлкнули, в координатах холста. */
  at: Point;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { selection, readOnly, camera } = useEditorState(editor);
  const [openedAt] = useState(camera);
  useDismiss(ref, true, onClose);

  useEffect(() => {
    if (camera !== openedAt) onClose();
  }, [camera, openedAt, onClose]);

  // Меню целиком на холсте: у правого и нижнего края оно открывается влево и вверх от точки.
  useLayoutEffect(() => {
    const menu = ref.current;
    const area = menu?.parentElement;
    if (!menu || !area) return;
    const fit = (value: number, size: number, room: number) =>
      Math.max(EDGE, value + size + EDGE > room ? value - size : value);
    menu.style.left = `${fit(at.x, menu.offsetWidth, area.clientWidth)}px`;
    menu.style.top = `${fit(at.y, menu.offsetHeight, area.clientHeight)}px`;
    // Фокус на первом пункте: с меню можно работать с клавиатуры. Рамку фокуса не рисуем,
    // меню открыли мышью.
    menu
      .querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus({ focusVisible: false });
  }, [at]);

  const single = editor.singleSelected();
  const selected = selection.size > 0;
  const empty = editor.page.list().length === 0;
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={ref}
      className={`${menuStyles.menu} ${styles.menu}`}
      role="menu"
      aria-label={selected ? 'Действия с выделенным' : 'Действия со страницей'}
      onKeyDown={(e) => {
        if (moveMenuFocus(e.currentTarget, e.key)) e.preventDefault();
      }}
    >
      {selected && !readOnly && (
        <>
          {single && hasText(single) && (
            <MenuItem shortcut="Enter" onClick={run(() => editor.editSelectedText())}>
              Изменить текст
            </MenuItem>
          )}
          <MenuItem shortcut="Ctrl+D" onClick={run(() => editor.duplicateSelection())}>
            Дублировать
          </MenuItem>
          <MenuItem shortcut="Delete" danger onClick={run(() => editor.deleteSelection())}>
            Удалить
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      {selected && (
        <MenuItem shortcut="Shift+2" onClick={run(() => editor.zoomToSelection())}>
          Показать выделенное
        </MenuItem>
      )}
      <MenuItem shortcut="Ctrl+A" disabled={empty} onClick={run(() => editor.selectAll())}>
        Выделить всё
      </MenuItem>
      <MenuItem shortcut="Shift+1" disabled={empty} onClick={run(() => editor.zoomToFit())}>
        Показать всё
      </MenuItem>
    </div>
  );
}
