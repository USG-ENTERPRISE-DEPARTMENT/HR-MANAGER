import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Save } from 'lucide-react';
import { motion } from 'motion/react';

const maxWidthMap = {
  sm:  'max-w-sm',
  md:  'max-w-md',
  lg:  'max-w-lg',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
} as const;

interface FormModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSave: () => void;
  saveLabel?: string;
  secondaryAction?: { label: string; onClick: () => void };
  footerActions?: ReactNode;
  maxWidth?: keyof typeof maxWidthMap;
  scrollable?: boolean;
  /** Read-only view: disables all fields and hides the Save button (Cancel becomes Close). */
  readOnly?: boolean;
  children: ReactNode;
}

export function FormModal({
  title,
  subtitle,
  onClose,
  onSave,
  saveLabel = 'Save',
  secondaryAction,
  footerActions,
  maxWidth = '2xl',
  scrollable = true,
  readOnly = false,
  children,
}: FormModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className={`bg-[var(--surface)] w-full ${maxWidthMap[maxWidth]} rounded-2xl shadow-xl z-10 flex flex-col border border-[var(--border)] ${scrollable ? 'max-h-[90vh] overflow-hidden' : 'overflow-visible'}`}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)] shrink-0 ${scrollable ? '' : 'rounded-t-2xl'}`}>
          <div>
            <h3 className="text-lg font-bold text-[var(--text-primary)] syne">{title}</h3>
            {subtitle && <p className="text-xs text-[var(--text-muted)] font-medium mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--surface-hover)] rounded-full text-[var(--text-muted)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className={`${scrollable ? 'flex-1 overflow-y-auto' : ''} p-6`}>
          {readOnly
            ? <fieldset disabled style={{ display: 'contents' }}>{children}</fieldset>
            : children}
        </div>

        <div className={`px-6 py-4 border-t border-[var(--border)] bg-[var(--bg)] flex items-center justify-between gap-3 shrink-0 ${scrollable ? '' : 'rounded-b-2xl'}`}>
          <div className="flex gap-2">
            {!readOnly && footerActions}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="secondary-btn shadow-sm">
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {secondaryAction && !readOnly && (
              <button onClick={secondaryAction.onClick} className="secondary-btn shadow-sm">
                {secondaryAction.label}
              </button>
            )}
            {!readOnly && (
              <button onClick={onSave} className="primary-btn shadow-sm flex items-center gap-2">
                <Save size={16} /> {saveLabel}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
