import { X, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ConfirmAlertProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info';
}

export function ConfirmAlert({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'danger'
}: ConfirmAlertProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-[400px] bg-[var(--surface)] border border-[var(--border)] rounded-[16px] shadow-2xl z-[101] overflow-hidden"
          >
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className={`p-2.5 rounded-[12px] shrink-0 border ${variant === 'danger' ? 'bg-[var(--danger-dim)] text-[var(--danger)] border-[var(--danger)]/20' : 'bg-[var(--warning-dim)] text-[var(--warning)] border-[var(--warning)]/20'}`}>
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1 mt-0.5">
                  <h3 className="text-[17px] font-extrabold syne text-[var(--text-primary)]">{title}</h3>
                  <p className="text-[13px] text-[var(--text-muted)] mt-1.5 leading-relaxed font-medium">{message}</p>
                </div>
              </div>
            </div>
            <div className="bg-[var(--surface-hover)] px-6 py-4 border-t border-[var(--border)] flex items-center justify-end gap-2.5">
              <button
                onClick={onCancel}
                className="secondary-btn"
              >
                {cancelText}
              </button>
              <button
                onClick={onConfirm}
                className={`primary-btn ${
                  variant === 'danger' 
                    ? 'bg-[var(--danger)] hover:bg-[#b91c1c] shadow-[0_4px_14px_rgba(220,38,38,0.25)]' 
                    : 'bg-[var(--warning)] hover:bg-[#b45309] shadow-[0_4px_14px_rgba(217,119,6,0.25)]'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
