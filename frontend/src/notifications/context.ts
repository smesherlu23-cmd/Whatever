import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { NotificationsState, NotificationStore } from './store';

/** Уведомления вошедшего пользователя. Их даёт AuthGate; вне его уведомлений нет. */
export const NotificationsContext = createContext<NotificationStore | null>(null);

export function useNotificationStore(): NotificationStore | null {
  return useContext(NotificationsContext);
}

/** Уведомления для показа. Компонент перерисовывается, когда они изменились. */
export function useNotifications(store: NotificationStore): NotificationsState {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  return useSyncExternalStore(subscribe, () => store.snapshot);
}
