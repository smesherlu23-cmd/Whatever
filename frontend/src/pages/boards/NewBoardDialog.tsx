import { type ReactNode, type SubmitEvent, useEffect, useRef, useState } from 'react';
import { api, type BoardInfo, type BoardSource, errorText } from '../../api';
import type { ScreenSize } from '../../canvas/camera';
import { Thumbnail } from '../../canvas/Thumbnail';
import type { ElementSource } from '../../model/document';
import { navigate } from '../../router';
import {
  BUILTIN_TEMPLATES,
  type BuiltinTemplate,
  builtinContent,
  builtinPreview,
} from '../../templates/builtin';
import { contentPreview } from '../../templates/content';
import controls from '../../ui/controls.module.css';
import { Dialog } from '../../ui/Dialog';
import dialog from '../../ui/Dialog.module.css';
import { useInView } from '../../ui/useInView';
import styles from './NewBoardDialog.module.css';

const DEFAULT_NAME = 'Новая доска';
const CARD_PREVIEW: ScreenSize = { width: 180, height: 110 };
const LARGE_PREVIEW: ScreenSize = { width: 372, height: 200 };

/** С чего начинается новая доска. */
type Start =
  | { kind: 'empty' }
  | { kind: 'builtin'; template: BuiltinTemplate }
  | { kind: 'company'; template: BoardInfo };

const EMPTY: Start = { kind: 'empty' };

function startName(start: Start): string {
  return start.kind === 'empty' ? DEFAULT_NAME : start.template.name;
}

function boardSource(start: Start): BoardSource | undefined {
  switch (start.kind) {
    case 'empty':
      return undefined;
    case 'builtin':
      return { content: builtinContent(start.template) };
    case 'company':
      return { template_id: start.template.id };
  }
}

function sameStart(a: Start, b: Start): boolean {
  if (a.kind === 'empty' || b.kind === 'empty') return a.kind === b.kind;
  return a.kind === b.kind && a.template.id === b.template.id;
}

/**
 * Окно «Новая доска»: название и то, с чего начать, — пустая доска, встроенный шаблон
 * или шаблон компании. Доска ложится в папку folderId и сразу открывается.
 */
export function NewBoardDialog({
  folderId,
  onClose,
}: {
  folderId: string | null;
  onClose: () => void;
}) {
  const [start, setStart] = useState<Start>(EMPTY);
  const [name, setName] = useState(DEFAULT_NAME);
  const company = useCompanyTemplates();
  const creation = useCreateBoard(folderId);
  const nameField = useSelectedOnOpen();

  const choose = (next: Start) => {
    // Название, подставленное по шаблону, меняется вместе с шаблоном, а введённое — остаётся.
    if (!name.trim() || name === startName(start)) setName(startName(next));
    setStart(next);
  };

  return (
    <Dialog title="Новая доска" size="large" onClose={onClose}>
      <form className={styles.form} onSubmit={(e) => void creation.submit(e, name, start)}>
        <label className={controls.field}>
          Название доски
          <input
            ref={nameField}
            className={controls.input}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset className={styles.starts}>
          <legend>С чего начать</legend>
          <div className={styles.grid}>
            <StartOption
              choice={EMPTY}
              current={start}
              onChoose={choose}
              label="Пустая доска"
              description="Чистый лист без фигур."
            >
              <span className={styles.blank} aria-hidden="true">
                +
              </span>
            </StartOption>
            {BUILTIN_TEMPLATES.map((template) => (
              <StartOption
                key={template.id}
                choice={{ kind: 'builtin', template }}
                current={start}
                onChoose={choose}
                label={template.name}
                description={template.description}
              >
                <Thumbnail source={builtinPreview(template)} {...CARD_PREVIEW} />
              </StartOption>
            ))}
          </div>
          <h3>Шаблоны компании</h3>
          {company === null && <p className={controls.muted}>Загрузка…</p>}
          {company === 'failed' && (
            <p className={controls.muted}>
              Не удалось загрузить шаблоны компании. Встроенные шаблоны доступны.
            </p>
          )}
          {Array.isArray(company) && company.length === 0 && (
            <p className={controls.muted}>
              Шаблонов компании пока нет. Любую свою доску можно сохранить шаблоном в окне
              «Поделиться».
            </p>
          )}
          {Array.isArray(company) && company.length > 0 && (
            <div className={styles.grid}>
              {company.map((template) => (
                <StartOption
                  key={template.id}
                  choice={{ kind: 'company', template }}
                  current={start}
                  onChoose={choose}
                  label={template.name}
                  description={`Автор: ${template.owner?.name ?? 'не указан'}`}
                >
                  <CompanyPreview template={template} size={CARD_PREVIEW} />
                </StartOption>
              ))}
            </div>
          )}
        </fieldset>
        {/* Шаблонов много, и окно прокручивается: кнопки остаются на виду внизу. */}
        <div className={styles.footer}>
          <Actions creation={creation} name={name} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Окно создания доски по шаблону компании, выбранному заранее: в разделе «Шаблоны»
 * или на самой доске-шаблоне. Доска ложится в корень своих досок.
 */
export function FromTemplateDialog({
  template,
  onClose,
}: {
  template: BoardInfo;
  onClose: () => void;
}) {
  const [name, setName] = useState(template.name);
  const creation = useCreateBoard(null);
  const nameField = useSelectedOnOpen();
  const start: Start = { kind: 'company', template };

  return (
    <Dialog title={`Доска по шаблону «${template.name}»`} size="small" onClose={onClose}>
      <form className={styles.form} onSubmit={(e) => void creation.submit(e, name, start)}>
        <CompanyPreview template={template} size={LARGE_PREVIEW} />
        <label className={controls.field}>
          Название доски
          <input
            ref={nameField}
            className={controls.input}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Actions creation={creation} name={name} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Карточка выбора: превью, название и пояснение. Сама радиокнопка скрыта. */
function StartOption({
  choice,
  current,
  onChoose,
  label,
  description,
  children,
}: {
  choice: Start;
  current: Start;
  onChoose: (choice: Start) => void;
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.card}>
      <input
        type="radio"
        name="start"
        className={styles.radio}
        aria-label={label}
        checked={sameStart(current, choice)}
        onChange={() => onChoose(choice)}
      />
      <span className={styles.preview}>{children}</span>
      <span className={styles.name}>{label}</span>
      <span className={styles.description}>{description}</span>
    </label>
  );
}

/** Превью шаблона компании. Содержимое загружается, когда превью показалось на экране. */
function CompanyPreview({ template, size }: { template: BoardInfo; size: ScreenSize }) {
  const ref = useRef<HTMLSpanElement>(null);
  const preview = useContentPreview(template.id, useInView(ref));
  return (
    <span ref={ref} className={styles.preview} style={{ minHeight: size.height }}>
      {preview === 'failed' && <span className={controls.muted}>Нет превью</span>}
      {preview !== null && preview !== 'failed' && <Thumbnail source={preview} {...size} />}
    </span>
  );
}

function Actions({
  creation,
  name,
  onCancel,
}: {
  creation: BoardCreation;
  name: string;
  onCancel: () => void;
}) {
  return (
    <>
      {creation.error && (
        <p className={controls.error} role="alert">
          {creation.error}
        </p>
      )}
      <div className={dialog.actions}>
        <button type="button" className={controls.secondary} onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className={controls.primary} disabled={creation.busy || !name.trim()}>
          {creation.busy ? 'Создание…' : 'Создать'}
        </button>
      </div>
    </>
  );
}

interface BoardCreation {
  busy: boolean;
  error: string | null;
  submit: (e: SubmitEvent<HTMLFormElement>, name: string, start: Start) => Promise<void>;
}

/** Создаёт доску в папке folderId и открывает её. */
function useCreateBoard(folderId: string | null): BoardCreation {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: SubmitEvent<HTMLFormElement>, name: string, start: Start) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const board = await api.createBoard(trimmed, folderId, boardSource(start));
      navigate(`/b/${board.id}`);
    } catch (failure) {
      setError(errorText(failure, 'Не удалось создать доску. Проверьте связь с сервером.'));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

/** Шаблоны компании; null — пока загружаются. */
function useCompanyTemplates(): BoardInfo[] | 'failed' | null {
  const [templates, setTemplates] = useState<BoardInfo[] | 'failed' | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.listTemplates().then(
      (loaded) => {
        if (!cancelled) setTemplates(loaded);
      },
      () => {
        if (!cancelled) setTemplates('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return templates;
}

/** Первая страница доски boardId; загружается, когда visible станет true. */
function useContentPreview(boardId: string, visible: boolean): ElementSource | 'failed' | null {
  const [preview, setPreview] = useState<ElementSource | 'failed' | null>(null);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    api.boardContent(boardId).then(
      (content) => {
        if (!cancelled) setPreview(contentPreview(content) ?? 'failed');
      },
      () => {
        if (!cancelled) setPreview('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [boardId, visible]);
  return preview;
}

/**
 * Поле, текст которого выделен, когда окно открылось: новое название можно сразу набирать.
 * Окно открывается в эффекте Dialog, а он срабатывает раньше эффекта того, кто его показал.
 */
function useSelectedOnOpen() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return ref;
}
