import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { toast } from 'sonner';

export const inputClass =
  'w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all font-medium';

export const labelClass = 'block text-[13px] font-semibold text-slate-700 mb-1.5 syne';

interface FormFieldProps {
  label: ReactNode;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, required, hint, className, children }: FormFieldProps) {
  return (
    <div className={className}>
      <label className={labelClass}>
        <span className="flex items-center gap-1.5">
          <span>
            {label}
            {required && <span className="text-[var(--danger)]"> *</span>}
          </span>
          {hint && (
            <button
              type="button"
              onClick={() => toast.info(hint, { duration: 5000 })}
              className="shrink-0 text-slate-400 hover:text-[var(--accent)] transition-colors"
              tabIndex={-1}
            >
              <HelpCircle size={13} />
            </button>
          )}
        </span>
      </label>
      {children}
    </div>
  );
}
