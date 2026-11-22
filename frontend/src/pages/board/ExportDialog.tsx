import { type SubmitEvent, useState } from 'react';
import {
  type ExportBackground,
  exportPng,
  planExport,
  selectionSource,
} from '../../canvas/exportImage';
import type { ImageCache } from '../../canvas/images';
import { themeFor } from '../../canvas/scene';
import type { Editor } from '../../editor/Editor';
import type { ElementSource } from '../../model/document';
import controls from '../../ui/controls.module.css';
import { Dialog } from '../../ui/Dialog';
import dialog from '../../ui/Dialog.module.css';
import { currentTheme } from '../../ui/theme';
import styles from './ExportDialog.module.css';

const SCALES = [1, 2, 3] as const;
type Scale = (typeof SCALES)[number];

const BACKGROUNDS: readonly { id: ExportBackground; label: string }[] = [
  { id: 'light', label: 'Светлый' },
  { id: 'dark', label: 'Тёмный' },
  { id: 'transparent', label: 'Прозрачный' },
];

/** Сколько ждать перед тем, как освободить память картинки: браузер должен начать скачивание. */
const REVOKE_DELAY_MS = 10_000;

/** Имя файла без символов, которые не разрешают файловые системы. */
export function exportFileName(board: string, page: string | null): string {
  const name = page ? `${board} — ${page}` : board;
  return `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Доска'}.png`;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_DELAY_MS);
}

const pixels = (width: number, height: number) =>
  `${width.toLocaleString('ru-RU')} × ${height.toLocaleString('ru-RU')} пикс.`;

/** Окно экспорта открытой страницы или выделенного в PNG. */
export function ExportDialog({
  editor,
  images,
  boardName,
  onClose,
}: {
  editor: Editor;
  images: ImageCache;
  boardName: string;
  onClose: () => void;
}) {
  const hasSelection = editor.selection.size > 0;
  const [part, setPart] = useState<'page' | 'selection'>(hasSelection ? 'selection' : 'page');
  const [scale, setScale] = useState<Scale>(2);
  const [background, setBackground] = useState<ExportBackground>(currentTheme);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = (): ElementSource =>
    part === 'selection' ? selectionSource(editor.page, editor.selection) : editor.page;
  const plans = new Map(SCALES.map((s) => [s, planExport(source(), s)]));
  const plan = plans.get(scale) ?? null;
  const pages = editor.doc.pages();
  const pageName =
    pages.length > 1 ? (pages.find((p) => p.id === editor.pageId)?.name ?? null) : null;

  const save = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Пока окно открыто, доску могли изменить другие участники: размер считается заново.
    const current = source();
    const fresh = planExport(current, scale);
    if (!fresh) return;
    setSaving(true);
    setError(null);
    try {
      const theme = themeFor(background === 'dark' ? 'dark' : 'light');
      const blob = await exportPng(current, fresh, theme, background, images);
      download(blob, exportFileName(boardName, pageName));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить картинку');
      setSaving(false);
    }
  };

  return (
    <Dialog title="Экспорт в PNG" size="small" onClose={onClose}>
      <form className={styles.form} onSubmit={(e) => void save(e)}>
        <fieldset className={styles.group}>
          <legend>Что сохранить</legend>
          <label>
            <input
              type="radio"
              name="part"
              checked={part === 'page'}
              onChange={() => setPart('page')}
            />
            Всю страницу{pageName ? ` «${pageName}»` : ''}
          </label>
          <label>
            <input
              type="radio"
              name="part"
              checked={part === 'selection'}
              disabled={!hasSelection}
              onChange={() => setPart('selection')}
            />
            Только выделенное
          </label>
        </fieldset>
        <fieldset className={styles.group}>
          <legend>Разрешение</legend>
          {SCALES.map((s) => {
            const option = plans.get(s);
            return (
              <label key={s}>
                <input
                  type="radio"
                  name="scale"
                  checked={scale === s}
                  onChange={() => setScale(s)}
                />
                {s}×
                {option && (
                  <span className={controls.muted}>{pixels(option.width, option.height)}</span>
                )}
              </label>
            );
          })}
        </fieldset>
        <fieldset className={styles.group}>
          <legend>Фон</legend>
          {BACKGROUNDS.map((b) => (
            <label key={b.id}>
              <input
                type="radio"
                name="background"
                checked={background === b.id}
                onChange={() => setBackground(b.id)}
              />
              {b.label}
            </label>
          ))}
        </fieldset>
        {!plan && <p className={controls.muted}>На странице пока ничего нет.</p>}
        {plan?.reduced && (
          <p className={controls.muted}>
            В таком разрешении картинка не поместится в память браузера, поэтому она будет меньше:{' '}
            {pixels(plan.width, plan.height)}
          </p>
        )}
        {error && (
          <p className={controls.error} role="alert">
            {error}
          </p>
        )}
        <div className={dialog.actions}>
          <button type="button" className={controls.secondary} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className={controls.primary} disabled={!plan || saving}>
            {saving ? 'Сохранение…' : 'Сохранить PNG'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
