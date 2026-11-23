import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Notifications, api } from '../api';
import { NotificationsContext } from '../notifications/context';
import { NotificationStore } from '../notifications/store';
import { IVAN, notification } from '../testing/comments';
import { deferred } from '../testing/helpers';
import { NotificationBell } from './NotificationBell';

const INBOX: Notifications = {
  unread: 1,
  items: [
    notification('n1', { excerpt: '@ivan проверь схему', thread_id: 't1' }),
    notification('n2', {
      kind: 'reply',
      read: true,
      actor: IVAN,
      excerpt: 'Готово',
      board: { id: 'b2', name: 'Сеть' },
      thread_id: 't2',
    }),
    notification('n3', { kind: 'reply', read: true, actor: null, excerpt: 'Старый ответ' }),
  ],
};

function showBell(store = new NotificationStore()) {
  render(
    <NotificationsContext value={store}>
      <NotificationBell />
    </NotificationsContext>,
  );
  return store;
}

describe('NotificationBell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState(null, '', '/');
  });

  it('is not shown without a signed-in user', () => {
    const { container } = render(<NotificationBell />);
    expect(container.childElementCount).toBe(0);
  });

  it('counts the unread notifications and lists the latest ones', async () => {
    const notifications = vi.spyOn(api, 'notifications').mockResolvedValue(INBOX);
    const store = showBell();
    store.refresh();
    const bell = await screen.findByRole('button', { name: 'Уведомления, новых: 1' });

    fireEvent.click(bell);
    expect(notifications).toHaveBeenCalledTimes(2);
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('link');
    expect(items.map((link) => link.getAttribute('href'))).toEqual([
      '/b/b1?thread=t1',
      '/b/b2?thread=t2',
      '/b/b1?thread=t1',
    ]);
    expect(items[0]?.textContent).toContain('Вас упомянули · Схема');
    expect(items[0]?.textContent).toContain('Анна Смирнова: @ivan проверь схему');
    expect(items[0]?.hasAttribute('data-unread')).toBe(true);
    expect(items[1]?.textContent).toContain('Ответ в обсуждении · Сеть');
    expect(items[1]?.hasAttribute('data-unread')).toBe(false);
    expect(items[2]?.textContent).toContain('Удалённый пользователь: Старый ответ');

    fireEvent.click(bell);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows a badge only up to 99', async () => {
    vi.spyOn(api, 'notifications').mockResolvedValue({ unread: 120, items: [] });
    showBell().refresh();
    const bell = await screen.findByRole('button', { name: 'Уведомления, новых: 120' });
    expect(bell.textContent).toBe('99+');
  });

  it('says when there is nothing yet and while loading', async () => {
    const answer = deferred<Notifications>();
    vi.spyOn(api, 'notifications').mockReturnValue(answer.promise);
    showBell();
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    expect(screen.getByText('Загрузка уведомлений…')).toBeTruthy();

    answer.resolve({ unread: 0, items: [] });
    expect(
      await screen.findByText('Здесь появятся упоминания и ответы в ваших обсуждениях.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Прочитать все' })).toBeNull();
  });

  it('opens the thread of a notification and closes the list', async () => {
    vi.spyOn(api, 'notifications').mockResolvedValue(INBOX);
    showBell();
    fireEvent.click(screen.getByRole('button', { name: 'Уведомления' }));
    fireEvent.click(await screen.findByRole('link', { name: /Ответ в обсуждении · Сеть/ }));
    expect(window.location.pathname + window.location.search).toBe('/b/b2?thread=t2');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('marks everything read and says when that failed', async () => {
    vi.spyOn(api, 'notifications').mockResolvedValue(INBOX);
    const readAll = vi
      .spyOn(api, 'readAllNotifications')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue();
    showBell().refresh();
    fireEvent.click(await screen.findByRole('button', { name: 'Уведомления, новых: 1' }));
    const readAllButton = screen.getByRole('button', { name: 'Прочитать все' });

    fireEvent.click(readAllButton);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не удалось отметить уведомления. Проверьте связь с сервером.',
    );
    fireEvent.click(readAllButton);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Прочитать все' })).toBeNull();
    });
    expect(readAll).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Уведомления' })).toBeTruthy();
    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(3);
  });
});
