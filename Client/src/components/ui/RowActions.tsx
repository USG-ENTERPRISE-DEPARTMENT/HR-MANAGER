import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { MoreVertical } from 'lucide-react';

export interface RowAction {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  hidden?: boolean;     // omit from the menu entirely
  disabled?: boolean;
  danger?: boolean;     // red styling (delete / destructive)
  spin?: boolean;       // spin the icon (e.g. while syncing)
  title?: string;       // tooltip, useful to explain a disabled action
}

const MENU_W = 210;
const ROW_H = 38;

/**
 * Overflow ("kebab") row-action menu. Renders a single ⋮ button per row so the
 * action column always stays aligned regardless of how many actions a row has.
 * The dropdown is portalled to <body> with fixed positioning so it is never
 * clipped by a scrolling table container.
 */
export function RowActions({ actions }: { actions: RowAction[] }) {
  const visible = actions.filter(a => !a.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const estH = visible.length * ROW_H + 10;
    const openUp = b.bottom + estH > window.innerHeight - 8;
    const left = Math.max(8, Math.min(b.right - MENU_W, window.innerWidth - MENU_W - 8));
    const top = openUp ? b.top - estH - 4 : b.bottom + 4;
    setPos({ top, left });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        title="Actions"
        className={`action-btn ${open ? 'text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
      >
        <MoreVertical size={15} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, scale: 0.97, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -4 }}
              transition={{ duration: 0.12 }}
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W }}
              className="z-[200] bg-[var(--surface)] border border-[var(--border)] rounded-[10px] shadow-xl py-1 overflow-hidden"
            >
              {visible.map((a, i) => {
                const Icon = a.icon;
                return (
                  <button
                    key={i}
                    disabled={a.disabled}
                    title={a.title}
                    onClick={() => { if (a.disabled) return; setOpen(false); a.onClick(); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors
                      ${a.disabled
                        ? 'text-[var(--text-muted)] opacity-50 cursor-not-allowed'
                        : a.danger
                          ? 'text-[var(--danger)] hover:bg-[var(--danger-dim)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'}`}
                  >
                    <Icon size={14} className={`shrink-0 ${a.spin ? 'animate-spin' : ''}`} />
                    {a.label}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
