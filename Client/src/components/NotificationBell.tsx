import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, Volume2, VolumeX, CheckCheck, CalendarCheck, Stethoscope, Users,
  Banknote, TrendingUp, UserPlus, GraduationCap, BellRing, Trash2, X,
} from 'lucide-react';
import { useNotifications, type Notif } from '@/lib/notifications';
import { isMuted, setMuted } from '@/lib/notificationSound';

const ICONS: Record<string, typeof Bell> = {
  leave:       CalendarCheck,
  medical:     Stethoscope,
  employees:   Users,
  payroll:     Banknote,
  performance: TrendingUp,
  onboarding:  UserPlus,
  training:    GraduationCap,
};

function timeAgo(t: string | null): string {
  if (!t) return '';
  const d = new Date(t).getTime();
  if (isNaN(d)) return '';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60)     return 'just now';
  if (s < 3600)   return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)  return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

export function NotificationBell({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const { items, unreadCount, markOne, markAll, removeOne, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggleMute = () => { const m = !muted; setMuted(m); setMutedState(m); };

  const onItem = (n: Notif) => {
    if (n.status === 'Unread') markOne(n.id);
    if (n.action && onNavigate) onNavigate(n.action);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        className="relative flex items-center justify-center p-2 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] rounded-full transition-colors"
      >
        {unreadCount > 0 ? <BellRing className="w-[18px] h-[18px]" /> : <Bell className="w-[18px] h-[18px]" />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9px] font-bold text-white bg-[var(--danger)] rounded-full border border-[var(--surface)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="fixed right-2 sm:right-4 top-[58px] w-[340px] max-w-[calc(100vw-1rem)] bg-[var(--surface)] border border-[var(--border)] rounded-[14px] shadow-xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <span className="text-[13px] font-bold text-[var(--text-primary)] syne">Notifications</span>
              <div className="flex items-center gap-1">
                <button onClick={toggleMute} title={muted ? 'Unmute sound' : 'Mute sound'}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-colors">
                  {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
                {unreadCount > 0 && (
                  <button onClick={markAll} title="Mark all read"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-colors">
                    <CheckCheck size={15} />
                  </button>
                )}
                {items.length > 0 && (
                  <button onClick={clearAll} title="Clear all"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-colors">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="max-h-[380px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] text-[var(--text-muted)]">
                  <Bell size={22} className="mx-auto mb-2 opacity-40" />
                  You're all caught up.
                </div>
              ) : items.map(n => {
                const Icon = ICONS[n.type ?? ''] ?? Bell;
                const unread = n.status === 'Unread';
                return (
                  <div
                    key={n.id}
                    className={`group relative flex gap-3 px-4 py-3 border-b border-[var(--border-light)] last:border-0 transition-colors hover:bg-[var(--surface-hover)] ${unread ? 'bg-[var(--accent-dim)]' : ''}`}
                  >
                    <button onClick={() => onItem(n)} className="flex gap-3 text-left flex-1 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center shrink-0">
                        <Icon size={15} className="text-[var(--accent)]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[12.5px] leading-snug pr-4 ${unread ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {n.message}
                        </span>
                        <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">{timeAgo(n.time)}</span>
                      </span>
                    </button>
                    {unread && <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[var(--accent)] group-hover:opacity-0 transition-opacity" />}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeOne(n.id); }}
                      title="Clear"
                      className="absolute top-2 right-2 p-1 rounded-md text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition-all"
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
