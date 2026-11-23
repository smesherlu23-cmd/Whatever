import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardVersion } from '../../api';
import { version } from '../../testing/versions';
import { formatMoment } from '../../ui/time';
import { VersionBanner } from './VersionBanner';

const NAMED = version('v1', new Date().toISOString(), { name: 'Перед релизом' });

function setup(fields: { version?: BoardVersion; canRestore?: boolean; restoring?: boolean } = {}) {
  const onRestore = vi.fn();
  const onBack = vi.fn();
  render(
    <VersionBanner
      version={fields.version ?? NAMED}
      restoring={fields.restoring ?? false}
      canRestore={fields.canRestore ?? true}
      onRestore={onRestore}
      onBack={onBack}
    />,
  );
  return { onRestore, onBack };
}

describe('VersionBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the version and restores it only after the user agrees', () => {
    const { onRestore, onBack } = setup();
    const banner = screen.getByRole('region', { name: 'Просмотр версии' });
    expect(
      within(banner).getByText(`Просмотр версии · ${formatMoment(NAMED.created_at)}`),
    ).toBeTruthy();
    expect(within(banner).getByText('Перед релизом')).toBeTruthy();

    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const restore = screen.getByRole('button', { name: 'Восстановить' });
    fireEvent.click(restore);
    expect(onRestore).not.toHaveBeenCalled();
    fireEvent.click(restore);
    expect(onRestore).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toMatch(/^Восстановить эту версию\?/);

    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к текущей' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('names an automatic version by its time and offers no restore on a read-only board', () => {
    setup({ version: { ...NAMED, name: null }, canRestore: false });
    expect(screen.getByText('Просмотр версии')).toBeTruthy();
    expect(screen.getByText(formatMoment(NAMED.created_at))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Восстановить' })).toBeNull();
  });

  it('locks its buttons while the version is being restored', () => {
    setup({ restoring: true });
    expect(screen.getByRole('button', { name: 'Восстановление…' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Вернуться к текущей' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
