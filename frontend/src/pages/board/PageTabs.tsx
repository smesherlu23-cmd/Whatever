import { type DragEvent, useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '../../editor/Editor';
import { addPage, duplicatePage, movePage, removePage, renamePage } from '../../editor/pages';
import type { BoardDocument } from '../../model/document';
import type { Page } from '../../model/types';
import controls from '../../ui/controls.module.css';
import { Dialog } from '../../ui/Dialog';
import dialogStyles from '../../ui/Dialog.module.css';
import { useDismiss } from '../../ui/useDismiss';
import styles from './PageTabs.module.css';

/** Страницы доски по порядку. Компонент перерисовывается, только когда меняется их список. */
export function usePages(doc: BoardDocument): readonly Page[] {
  const subscribe = useCallback((onChange: () => void) => doc.onChange(onChange), [doc]);
  const read = useCallback(() => doc.pages(), [doc]);
  return useSyncExternalStore(subscribe, read);
}

/** Куда встанет перетаскиваемая вкладка: перед этой страницей или в конец (null). */
interface Drop {
  over: string;
  before: string | null;
}

/**
 * Вкладки страниц внизу слева. Переключаться между страницами может каждый, а добавлять,
 * переименовывать (двойной щелчок), переставлять (перетаскиванием), копировать и удалять —
 * тот, кто может править доску.
 */
export function PageTabs({
  editor,
  pageId,
  readOnly,
}: {
  editor: Editor;
  pageId: string;
  readOnly: boolean;
}) {
  const pages = usePages(editor.doc);
  const bar = useRef<HTMLElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [confirming, setConfirming] = useState<Page | null>(null);
  useDismiss(bar, menuOpen, () => {
    setMenuOpen(false);
  });

  const index = pages.findIndex((page) => page.id === pageId);
  const current = pages[index];

  const remove = (page: Page) => {
    // Пустая страница удаляется сразу, а страница с рисунками — после вопроса.
    if (editor.doc.page(page.id).list().length === 0) removePage(editor, page.id);
    else setConfirming(page);
  };

  const dropPosition = (e: DragEvent<HTMLElement>, page: Page, at: number): Drop => {
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    return { over: page.id, before: after ? (pages[at + 1]?.id ?? null) : page.id };
  };

  return (
    <>
      <nav ref={bar} className={styles.bar} aria-label="Страницы доски">
        <ul className={styles.list}>
          {pages.map((page, at) => (
            <li
              key={page.id}
              className={styles.item}
              data-drop={
                drop?.over === page.id ? (drop.before === page.id ? 'before' : 'after') : undefined
              }
              onDragOver={(e) => {
                if (!dragged || dragged === page.id) return;
                e.preventDefault();
                setDrop(dropPosition(e, page, at));
              }}
              onDragLeave={() => {
                setDrop(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged) movePage(editor, dragged, dropPosition(e, page, at).before);
                setDragged(null);
                setDrop(null);
              }}
            >
              {renaming === page.id ? (
                <RenameField
                  name={page.name}
                  onDone={(name) => {
                    if (name !== null) renamePage(editor, page.id, name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={styles.tab}
                  aria-current={page.id === pageId ? 'page' : undefined}
                  title={readOnly ? page.name : `${page.name}. Двойной щелчок — переименовать`}
                  draggable={!readOnly}
                  onClick={() => editor.setPage(page.id)}
                  onDoubleClick={() => {
                    if (!readOnly) setRenaming(page.id);
                  }}
                  onContextMenu={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    editor.setPage(page.id);
                    setMenuOpen(true);
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', page.name);
                    setDragged(page.id);
                  }}
                  onDragEnd={() => {
                    setDragged(null);
                    setDrop(null);
                  }}
                >
                  {page.name}
                </button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && current && (
          <button
            type="button"
            className={styles.icon}
            aria-label={`Действия со страницей «${current.name}»`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ⋯
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            className={styles.icon}
            aria-label="Добавить страницу"
            title="Добавить страницу"
            onClick={() => addPage(editor)}
          >
            +
          </button>
        )}
        {menuOpen && current && (
          // Щелчок по любому пункту закрывает меню.
          <div className={styles.menu} role="menu" onClick={() => setMenuOpen(false)}>
            <MenuItem onClick={() => setRenaming(current.id)}>Переименовать</MenuItem>
            <MenuItem onClick={() => duplicatePage(editor, current.id)}>Дублировать</MenuItem>
            <MenuItem
              disabled={index === 0}
              onClick={() => movePage(editor, current.id, pages[index - 1]?.id ?? null)}
            >
              Переместить левее
            </MenuItem>
            <MenuItem
              disabled={index === pages.length - 1}
              onClick={() => movePage(editor, current.id, pages[index + 2]?.id ?? null)}
            >
              Переместить правее
            </MenuItem>
            <MenuItem danger disabled={pages.length <= 1} onClick={() => remove(current)}>
              Удалить
            </MenuItem>
          </div>
        )}
      </nav>
      {confirming && (
        <Dialog
          title="Удалить страницу?"
          size="small"
          onClose={() => {
            setConfirming(null);
          }}
        >
          <p>
            Страница «{confirming.name}» удалится вместе со всем, что на ней нарисовано. Вернуть её
            можно сразу же сочетанием Ctrl+Z.
          </p>
          <form method="dialog" className={dialogStyles.actions}>
            <button type="submit" className={controls.secondary}>
              Отмена
            </button>
            <button
              type="submit"
              className={controls.danger}
              onClick={() => removePage(editor, confirming.id)}
            >
              Удалить
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}

function MenuItem({
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={styles.menuItem}
      data-danger={danger || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Поле переименования на месте вкладки. Enter и уход фокуса сохраняют, Esc отменяет. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(name);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      className={styles.rename}
      aria-label="Название страницы"
      value={draft}
      maxLength={100}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(draft);
        if (e.key === 'Escape') finish(null);
      }}
    />
  );
}
