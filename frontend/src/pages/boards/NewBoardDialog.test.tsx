import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { BoardInfo } from '../../api';
import { BoardDocument } from '../../model/document';
import { DEFAULT_FILL, DEFAULT_STROKE } from '../../model/types';
import { BUILTIN_TEMPLATES, builtinContent } from '../../templates/builtin';
import { failure, stubServer } from '../../testing/server';
import { FromTemplateDialog, NewBoardDialog } from './NewBoardDialog';

function info(id: string, name: string, extra: Partial<BoardInfo> = {}): BoardInfo {
  return {
    id,
    name,
    owner: { id: 'u-1', login: 'anna', name: 'Анна Смирнова' },
    folder_id: null,
    access: 'view',
    is_template: true,
    created_at: '2026-11-20T10:00:00Z',
    updated_at: '2026-11-20T10:00:00Z',
    ...extra,
  };
}

const ARCHITECTURE = info('t-arch', 'Архитектура отдела');

/** Содержимое шаблона компании: одна заметка. */
function content(): Uint8Array<ArrayBuffer> {
  const board = new BoardDocument();
  board.add({
    id: 'n',
    kind: 'note',
    page: 'main',
    x: 0,
    y: 0,
    w: 160,
    h: 100,
    text: 'Сервисы',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  });
  return new Uint8Array(Y.encodeStateAsUpdate(board.doc));
}

interface Server {
  templates?: () => Response;
  preview?: () => Response;
  create?: () => Response;
}

function serve({
  templates = () => Response.json([ARCHITECTURE]),
  preview = () => new Response(content()),
  create = () => Response.json(info('b-new', 'Новая доска', { is_template: false })),
}: Server = {}) {
  return stubServer((method, path) => {
    if (path === '/templates') return templates();
    if (path.endsWith('/content')) return preview();
    if (method === 'POST' && path === '/boards') return create();
    return failure(500, `unexpected ${method} ${path}`);
  });
}

/** Тело запроса на создание доски. */
function createdWith(fetch: ReturnType<typeof serve>): unknown {
  const call = fetch.mock.calls.find(([url, init]) => url === '/api/boards' && init?.method);
  const body = call?.[1]?.body;
  if (typeof body !== 'string') throw new Error('Доску не создавали');
  return JSON.parse(body);
}

const nameField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Название доски' });
const builtin = (id: string) => {
  const template = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Нет шаблона ${id}`);
  return template;
};

describe('NewBoardDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState(null, '', '/');
  });

  it('creates an empty board in the folder and opens it', async () => {
    const fetch = serve();
    render(<NewBoardDialog folderId="f-1" onClose={vi.fn()} />);
    // Название выделено: новое можно сразу набирать.
    expect(document.activeElement).toBe(nameField());
    expect(screen.getByRole('radio', { name: 'Пустая доска' })).toHaveProperty('checked', true);

    fireEvent.change(nameField(), { target: { value: '  Схема API ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/b-new');
    });
    expect(createdWith(fetch)).toEqual({ name: 'Схема API', folder_id: 'f-1' });
  });

  it('starts a board from a built-in template and names it after the template', async () => {
    const fetch = serve();
    render(<NewBoardDialog folderId={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Ретроспектива' }));
    expect(nameField().value).toBe('Ретроспектива');
    fireEvent.click(screen.getByRole('radio', { name: 'Карта рисков' }));
    expect(nameField().value).toBe('Карта рисков');

    // Название, введённое вручную, при смене шаблона остаётся.
    fireEvent.change(nameField(), { target: { value: 'Риски релиза' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Блок-схема процесса' }));
    expect(nameField().value).toBe('Риски релиза');

    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/b-new');
    });
    expect(createdWith(fetch)).toEqual({
      name: 'Риски релиза',
      folder_id: null,
      content: builtinContent(builtin('flowchart')),
    });
  });

  it('offers company templates with previews and copies the chosen one', async () => {
    const fetch = serve();
    render(<NewBoardDialog folderId={null} onClose={vi.fn()} />);
    const choice = await screen.findByRole('radio', { name: 'Архитектура отдела' });
    const card = choice.closest('label');
    if (!card) throw new Error('Нет карточки шаблона');
    expect(within(card).getByText('Автор: Анна Смирнова')).toBeTruthy();
    await waitFor(() => {
      expect(card.querySelector('canvas')).not.toBeNull();
    });
    expect(fetch).toHaveBeenCalledWith('/api/boards/t-arch/content', expect.anything());

    fireEvent.click(choice);
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/b-new');
    });
    expect(createdWith(fetch)).toEqual({
      name: 'Архитектура отдела',
      folder_id: null,
      template_id: 't-arch',
    });
  });

  it('tells when there are no company templates or they did not load', async () => {
    serve({ templates: () => Response.json([]) });
    const { unmount } = render(<NewBoardDialog folderId={null} onClose={vi.fn()} />);
    expect(await screen.findByText(/Шаблонов компании пока нет/)).toBeTruthy();
    unmount();

    serve({ templates: () => failure(500, 'Сбой') });
    render(<NewBoardDialog folderId={null} onClose={vi.fn()} />);
    expect(await screen.findByText(/Не удалось загрузить шаблоны компании/)).toBeTruthy();
  });

  it('shows that a preview is not available', async () => {
    serve({
      templates: () => Response.json([ARCHITECTURE, info('t-bad', 'Сломанный')]),
      preview: () => new Response(new Uint8Array([5, 1, 2, 3])),
    });
    render(<NewBoardDialog folderId={null} onClose={vi.fn()} />);
    expect(await screen.findAllByText('Нет превью')).toHaveLength(2);
  });

  it('keeps the dialog open and explains why the board was not created', async () => {
    serve({ create: () => failure(404, 'Шаблон не найден') });
    render(<NewBoardDialog folderId={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Шаблон не найден');
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Создать' })).toHaveProperty('disabled', false);
  });

  it('needs a name and closes on cancel', () => {
    serve();
    const onClose = vi.fn();
    render(<NewBoardDialog folderId={null} onClose={onClose} />);
    fireEvent.change(nameField(), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Создать' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('FromTemplateDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState(null, '', '/');
  });

  it('creates a board from the chosen company template in the root', async () => {
    const fetch = serve();
    render(<FromTemplateDialog template={ARCHITECTURE} onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Доска по шаблону «Архитектура отдела»' }));
    expect(nameField().value).toBe('Архитектура отдела');
    await waitFor(() => {
      expect(document.querySelector('dialog canvas')).not.toBeNull();
    });

    fireEvent.change(nameField(), { target: { value: 'Архитектура платежей' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/b-new');
    });
    expect(createdWith(fetch)).toEqual({
      name: 'Архитектура платежей',
      folder_id: null,
      template_id: 't-arch',
    });
  });
});
