import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const MAX_WIDTH_CLASS: Record<string, string> = {
  sm:   'max-w-sm',
  md:   'max-w-md',
  lg:   'max-w-lg',
  xl:   'max-w-xl',
  '2xl':'max-w-2xl',
  '3xl':'max-w-3xl',
};

interface DetailSlideOverProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footerActions?: ReactNode;
  maxWidth?: keyof typeof MAX_WIDTH_CLASS;
}

// ── Reusable detail-body building blocks ─────────────────────────────────────

/** Responsive grid for DetailField cells (2 columns by default). */
export function DetailGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) {
  return <div className={`grid ${cols === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2.5`}>{children}</div>;
}

/** A single labelled value rendered as a soft card. Pass `full` to span both columns. */
export function DetailField({ label, value, full = false }: { label: string; value: ReactNode; full?: boolean }) {
  const empty = value === null || value === undefined || value === '' || value === '—';
  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 min-w-0 ${full ? 'col-span-2' : ''}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-muted)] mb-1">{label}</div>
      <div className={`text-[13px] font-semibold break-words leading-snug ${empty ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
        {empty ? '—' : value}
      </div>
    </div>
  );
}

/** Optional titled group of detail fields. */
export function DetailSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      {title && <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] px-0.5">{title}</h4>}
      {children}
    </section>
  );
}

export function DetailSlideOver({ open, title, subtitle, onClose, children, footerActions, maxWidth = 'md' }: DetailSlideOverProps) {
  const widthCls = MAX_WIDTH_CLASS[maxWidth] ?? 'max-w-md';
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-slate-900/30 z-40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`fixed right-0 top-0 h-full w-full ${widthCls} bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl`}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)] shrink-0">
              <div>
                <h3 className="font-bold text-[var(--text-primary)] syne text-[16px]">{title}</h3>
                {subtitle && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-[var(--surface-hover)] rounded-full text-[var(--text-muted)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>

            {footerActions && (
              <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--bg)] shrink-0 flex items-center justify-end gap-3">
                {footerActions}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
