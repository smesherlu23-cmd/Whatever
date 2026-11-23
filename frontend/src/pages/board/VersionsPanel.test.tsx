import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ApiError, type BoardVersion, api } from '../../api';
import { Follow } from '../../collab/follow';
import { Editor } from '../../editor/Editor';
import { BoardDocument } from '../../model/document';
import { ANNA, IVAN, OLGA } from '../../testing/comments';
import { participant } from '../../testing/peers';
import { version } from '../../testing/versions';
import { formatMoment } from '../../ui/time';
import { VersionStore } from '../../versions/store';
import { VersionViewer } from '../../versions/viewer';
import { VersionsPanel } from './VersionsPanel';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const AUTO = version('v-auto', hoursAgo(3), { editors: [ANNA, IVAN] });
const NAMED = version('v-named', hoursAgo(2), { name: 'Перед релизом', editors: [] });
const BUSY = version('v-busy', hoursAgo(1), {
  editors: [ANNA, IVAN, OLGA, { ...ANNA, id: 'u-4', name: 'Пётр' }, { ...ANNA, id: 'u-5' }],
});

/** Панель истории доски b1. versions — что ответит сервер на запрос списка. */
function setup({
  versions = [NAMED, AUTO],
  manages = true,
}: { versions?: BoardVersion[] | Error; manages?: boolean } = {}) {
  const listVersions = vi.spyOn(api, 'listVersions');
  if (versions instanceof Error) listVersions.mockRejectedValue(versions);
  else listVersions.mockResolvedValue(versions);
  vi.spyOn(api, 'versionState').mockResolvedValue(Y.encodeStateAsUpdate(new BoardDocument().doc));
  const me = participant('Анна');
  const live = new Editor(new BoardDocument(me.ydoc));
  const store = new VersionStore('b1');
  const viewer = new VersionViewer(store, live, new Follow(live, me.presence));
  const onClose = vi.fn();
  const view = render(
    <VersionsPanel store={store} viewer={viewer} manages={manages} onClose={onClose} />,
  );
  return { listVersions, store, viewer, onClose, view };
}

const list = () => screen.getByRole('list', { name: 'Версии доски' });
const row = (name: string | RegExp) =>
  within(list()).getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name });

async function open(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  await waitFor(() => {
    expect(row(name).getAttribute('aria-current')).toBe('true');
  });
}

describe('VersionsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the versions from the newest with who saved them and who edited the board', async () => {
    const { listVersions, onClose } = setup({ versions: [BUSY, NAMED, AUTO] });
    expect(screen.getByText('Загрузка версий…')).toBeTruthy();
    expect(listVersions).toHaveBeenCalledExactlyOnceWith('b1');
    await screen.findByText('Перед релизом');

    const items = within(list()).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual([
      'Текущая версияКак сейчас на доске',
      `${formatMoment(BUSY.created_at)}Правки: Анна Смирнова, Иван Петров, Ольга Сидорова и ещё 2`,
      `Перед релизом${formatMoment(NAMED.created_at)} · сохранено: Анна Смирнова`,
      `${formatMoment(AUTO.created_at)}Правки: Анна Смирнова, Иван Петров`,
    ]);
    expect(items[0]?.getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Только названные' }));
    expect(within(list()).getAllByRole('button')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть историю версий' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('follows the changes of the history only while it is open', async () => {
    const { listVersions, store, view } = setup();
    await screen.findByText('Перед релизом');
    store.changed();
    expect(listVersions).toHaveBeenCalledTimes(2);
    view.unmount();
    store.changed();
    expect(listVersions).toHaveBeenCalledTimes(2);
  });

  it('tells when there are no named versions', async () => {
    setup({ versions: [AUTO] });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Только названные' }));
    expect(screen.getByText('Названных версий пока нет.')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Только названные' }));
    expect(screen.queryByText('Названных версий пока нет.')).toBeNull();
  });

  it('explains an empty history', async () => {
    setup({ versions: [] });
    expect(
      await screen.findByText('Версий пока нет. Они появятся сами, когда доску начнут менять.'),
    ).toBeTruthy();
  });

  it('tells when the history could not be loaded', async () => {
    setup({ versions: new Error('offline') });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось загрузить версии. Проверьте связь с сервером.',
    );
  });

  it('saves what is on the board under a name', async () => {
    setup();
    const saved = version('v-new', new Date().toISOString(), { name: 'Релиз' });
    const saveVersion = vi
      .spyOn(api, 'saveVersion')
      .mockRejectedValueOnce(new ApiError(503, 'Сервер занят', 'Service Unavailable'))
      .mockResolvedValueOnce(saved);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить текущую версию' }));
    const name = screen.getByRole('textbox', { name: 'Название версии' });
    const submit = screen.getByRole('button', { name: 'Сохранить' });
    expect(submit).toHaveProperty('disabled', true);
    fireEvent.change(name, { target: { value: '  Релиз  ' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Сервер занят')).toBeTruthy();
    await waitFor(() => {
      expect(submit).toHaveProperty('disabled', false);
    });

    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Название версии' })).toBeNull();
    });
    expect(saveVersion).toHaveBeenLastCalledWith('b1', 'Релиз');
    expect(within(list()).getAllByRole('button')[1]?.textContent).toMatch(/^Релиз/);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить текущую версию' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Название версии' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Название версии' })).toBeNull();
  });

  it('opens a version and names it, renames it or deletes it', async () => {
    const { viewer } = setup();
    await open(formatMoment(AUTO.created_at));
    expect(viewer.snapshot.preview?.version).toEqual(AUTO);

    fireEvent.click(screen.getByRole('button', { name: 'Назвать версию' }));
    const renamed = { ...AUTO, name: 'Утро' };
    const renameVersion = vi.spyOn(api, 'renameVersion').mockResolvedValue(renamed);
    fireEvent.change(screen.getByRole('textbox', { name: 'Название версии' }), {
      target: { value: 'Утро' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Утро')).toBeTruthy();
    expect(renameVersion).toHaveBeenCalledExactlyOnceWith(AUTO.id, 'Утро');

    fireEvent.click(screen.getByRole('button', { name: 'Переименовать' }));
    expect(screen.getByRole('textbox', { name: 'Новое название' })).toHaveProperty('value', 'Утро');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const deleteVersion = vi
      .spyOn(api, 'deleteVersion')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(confirm).toHaveBeenCalledWith('Удалить версию «Утро»?');
    expect(deleteVersion).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(
      await screen.findByText('Не удалось удалить версию. Проверьте связь с сервером.'),
    ).toBeTruthy();
    // Кнопки заняты, пока удаление не закончилось.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Удалить' })).toHaveProperty('disabled', false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => {
      expect(screen.queryByText('Утро')).toBeNull();
    });
    expect(row('Текущая версия').getAttribute('aria-current')).toBe('true');
  });

  it('lets only those who manage the board delete versions', async () => {
    setup({ manages: false });
    await open('Перед релизом');
    expect(screen.getByRole('button', { name: 'Переименовать' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('shows the board again from the current version and reports what went wrong', async () => {
    const { viewer } = setup();
    await open('Перед релизом');
    fireEvent.click(row('Текущая версия'));
    expect(viewer.snapshot.preview).toBeNull();

    vi.mocked(api.versionState).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(row('Перед релизом'));
    expect(row('Перед релизом').getAttribute('aria-busy')).toBe('true');
    expect(within(row('Перед релизом')).getByText('Открывается…')).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Не удалось открыть версию. Проверьте связь с сервером.'),
    ).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Закрыть сообщение' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
