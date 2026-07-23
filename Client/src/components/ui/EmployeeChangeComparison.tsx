interface EmployeeChange {
  field?: string;
  label?: string;
  oldValue?: string | null;
  newValue?: string | null;
}

export function EmployeeChangeComparison({ changes }: { changes: EmployeeChange[] }) {
  if (!changes.length) return null;

  return (
    <div className="rounded-xl border border-amber-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Proposed Employee Changes</p>
        <p className="text-[11px] text-amber-700/80 mt-0.5">Compare the existing value with the value awaiting approval.</p>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {changes.map((change, index) => (
          <div key={`${change.field ?? 'change'}-${index}`} className="px-4 py-3">
            <p className="text-[11px] font-bold text-[var(--text-primary)] mb-2">{change.label || change.field}</p>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-start text-[12px]">
              <div className="min-w-0 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2">
                <p className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Previous</p>
                <p className="text-[var(--text-secondary)] break-words whitespace-pre-wrap">{change.oldValue || '—'}</p>
              </div>
              <span className="text-[var(--text-muted)] pt-6">→</span>
              <div className="min-w-0 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-2">
                <p className="text-[9px] uppercase tracking-wider text-emerald-700 mb-1">Proposed</p>
                <p className="font-semibold text-emerald-800 break-words whitespace-pre-wrap">{change.newValue || '—'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
