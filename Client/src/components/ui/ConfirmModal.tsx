import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ConfirmModalProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const isDanger  = variant === 'danger';
  const iconBg    = isDanger ? 'bg-[var(--danger-dim)]'  : 'bg-amber-50';
  const iconColor = isDanger ? 'text-[var(--danger)]'    : 'text-amber-500';

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onCancel} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0  }}
        className="relative bg-[var(--surface)] w-full max-w-sm rounded-2xl shadow-xl border border-[var(--border)] overflow-hidden"
      >
        <div className="px-6 pt-6 pb-5 flex items-start gap-4">
          <div className={`shrink-0 w-10 h-10 rounded-full ${iconBg} flex items-center justify-center`}>
            {isDanger
              ? <Trash2       size={18} className={iconColor} />
              : <AlertTriangle size={18} className={iconColor} />}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-bold text-[var(--text-primary)] syne text-[15px] leading-snug">{title}</h3>
            {message && <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">{message}</p>}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--bg)] flex justify-end gap-3">
          <button onClick={onCancel} className="secondary-btn">Cancel</button>
          <button onClick={onConfirm} className={isDanger ? 'danger-btn' : 'primary-btn'}>
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
