import { ArrowRight } from 'lucide-react';

export type TransferChange = {
  field: string;
  label: string;
  current: string;
  proposed: string;
};

export function TransferChangeComparison({ changes }: { changes: TransferChange[] }) {
  if (!changes?.length) return <p className="text-sm text-[var(--text-muted)]">No position changes recorded.</p>;
  return (
    <div className="space-y-2">
      {changes.map(change => (
        <div key={change.field} className="grid gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 sm:grid-cols-[120px_1fr_auto_1fr] sm:items-center sm:gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{change.label}</span>
          <span className="text-sm text-[var(--text-muted)] line-through decoration-red-300">{change.current}</span>
          <ArrowRight size={15} className="hidden text-[var(--accent)] sm:block" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">{change.proposed}</span>
        </div>
      ))}
    </div>
  );
}
