import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import api from './api';
import { getCurrentUser } from './auth';
import { playChime } from './notificationSound';

export interface Notif {
  id: string;
  message: string | null;
  action: string | null;   // an App activeView key to navigate to
  type: string | null;     // module key (leave, medical, …) for the icon
  status: 'Unread' | 'Read' | null;
  time: string | null;
}

const POLL_MS = 20000;

export async function fetchNotifications(): Promise<{ items: Notif[]; unreadCount: number }> {
  const r = await api.get('/notifications');
  const d = r.data?.data ?? {};
  return { items: d.items ?? [], unreadCount: d.unreadCount ?? 0 };
}

export const markRead    = (id: string) => api.put(`/notifications/${id}/read`);
export const markAllReadApi = () => api.put('/notifications/read-all');
export const deleteNotificationApi = (id: string) => api.delete(`/notifications/${id}`);
export const clearAllApi = () => api.delete('/notifications/clear');

/** Polls for notifications, chimes + toasts on new arrivals, exposes read actions. */
export function useNotifications() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const watermark = useRef<number>(-1);   // highest id seen; -1 = not yet initialised

  const poll = useCallback(async () => {
    if (!getCurrentUser()) return;
    try {
      const { items, unreadCount } = await fetchNotifications();
      setItems(items);
      setUnreadCount(unreadCount);

      const maxId = items.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
      if (watermark.current === -1) {
        watermark.current = maxId;             // first load — set baseline, no alert
      } else if (maxId > watermark.current) {
        const fresh = items.filter(n => (Number(n.id) || 0) > watermark.current && n.status === 'Unread');
        if (fresh.length) {
          playChime();
          fresh.slice(0, 3).forEach(n => { if (n.message) toast(n.message); });
        }
        watermark.current = maxId;
      }
    } catch { /* offline / transient — keep current state */ }
  }, []);

  useEffect(() => {
    if (!getCurrentUser()) return;
    poll();
    const interval = setInterval(poll, POLL_MS);
    const onFocus = () => poll();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [poll]);

  const markOne = useCallback(async (id: string) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, status: 'Read' } : n));
    setUnreadCount(c => Math.max(0, c - 1));
    try { await markRead(id); } catch { /* will reconcile on next poll */ }
  }, []);

  const markAll = useCallback(async () => {
    setItems(prev => prev.map(n => ({ ...n, status: 'Read' as const })));
    setUnreadCount(0);
    try { await markAllReadApi(); } catch { /* will reconcile on next poll */ }
  }, []);

  const removeOne = useCallback(async (id: string) => {
    setItems(prev => prev.filter(n => n.id !== id));
    setUnreadCount(c => {
      const wasUnread = items.find(n => n.id === id)?.status === 'Unread';
      return wasUnread ? Math.max(0, c - 1) : c;
    });
    try { await deleteNotificationApi(id); } catch { /* will reconcile on next poll */ }
  }, [items]);

  const clearAll = useCallback(async () => {
    setItems([]);
    setUnreadCount(0);
    try { await clearAllApi(); } catch { /* will reconcile on next poll */ }
  }, []);

  return { items, unreadCount, markOne, markAll, removeOne, clearAll, refresh: poll };
}
