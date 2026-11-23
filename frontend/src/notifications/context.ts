import { createContext, useContext } from 'react';
import type { NotificationStore } from './store';

/** Уведомления вошедшего пользователя. Их даёт AuthGate; вне его уведомлений нет. */
export const NotificationsContext = createContext<NotificationStore | null>(null);

export function useNotificationStore(): NotificationStore | null {
  return useContext(NotificationsContext);
}
