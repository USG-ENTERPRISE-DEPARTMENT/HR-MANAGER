import { useMemo, useState } from 'react';
import { XCircle, RefreshCw, ChevronDown, ChevronRight, FileWarning, Landmark, Users, Info } from 'lucide-react';
import { GlBlockedModal, type GlImbalance, type InvalidAccount } from './GlBlockedModal';
import { fmtDateTime } from '@/lib/dateFormat';

/**
 * Why a payroll run's GL posting failed, read from the run's `payment_log`:
 *   { error, imbalance? }        — journal refused locally because debits ≠ credits
 *   { error, invalidAccounts? }  — accounts the core system does not recognise
 *   { error }                    — anything else (bank API rejection, network error)
 *
 * Presents the totals and GROUPS the causes by payroll column ("Net Salary UTB — 352 employees")
 * instead of printing the raw message, which for a large run is a wall of hundreds of names. The
 * full list stays available behind "View full report" (GlBlockedModal, with copy).
 */
const money = (n: number) => Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Group { key: string; title: string; reason: string; fix: string; names: string[]; icon: typeof Landmark }

// "Net Salary UTB (JAMES KOROMA)" → column "Net Salary UTB", employee "JAMES KOROMA".
function groupByColumn(items: string[]) {
  const map = new Map<string, string[]>();
  for (const raw of items) {
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(raw);
    const col = (m ? m[1] : raw).trim() || 'Unnamed column';
    const name = m ? m[2].trim() : '';
    if (!map.has(col)) map.set(col, []);
    if (name) map.get(col)!.push(name);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function parseLog(paymentLog?: string | null) {
  try {
    const log = JSON.parse(paymentLog || '{}') ?? {};
    const e = log.error;
    const message = typeof e === 'string' ? e
      : e && typeof e === 'object' ? (e.message || e.responseMessage || '') : '';
    const code = e && typeof e === 'object' ? (e.responseCode ?? e.code ?? null) : null;
    const raw = e && typeof e === 'object' ? JSON.stringify(e, null, 2) : null;
    return {
      message, code, raw,
      imbalance: (log.imbalance ?? null) as GlImbalance | null,
      invalidAccounts: (log.invalidAccounts ?? null) as InvalidAccount[] | null,
    };
  } catch {
    return { message: String(paymentLog ?? ''), code: null, raw: null, imbalance: null, invalidAccounts: null };
  }
}

function CauseRow({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const Icon = group.icon;
  return (
    <div className="border border-[var(--border)] rounded-[10px] bg-[var(--surface)]">
      <button type="button" onClick={() => setOpen(o => !o)} disabled={!group.names.length}
        className="w-full flex items-start gap-3 px-3.5 py-3 text-left disabled:cursor-default">
        <Icon size={15} className="text-[var(--danger)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">{group.title}</p>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{group.reason}</p>
        </div>
        {group.names.length > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--danger)]">
            {group.names.length} employee{group.names.length !== 1 ? 's' : ''}
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3.5 pb-3">
          <div className="max-h-48 overflow-y-auto rounded-lg bg-[var(--bg)] border border-[var(--border)] p-2 flex flex-wrap gap-1.5">
            {group.names.map((n, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)]">{n}</span>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-2 flex items-start gap-1.5"><Info size={12} className="mt-px shrink-0" />{group.fix}</p>
        </div>
      )}
    </div>
  );
}

export function GlFailureCard({ paymentLog, failedAt, runName, canRetry, retrying, onRetry }: {
  paymentLog?: string | null;
  failedAt?: string | null;
  runName?: string;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const info = useMemo(() => parseLog(paymentLog), [paymentLog]);
  const [showReport, setShowReport] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const { imbalance, invalidAccounts } = info;

  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];
    for (const [col, names] of groupByColumn(imbalance?.unmapped ?? [])) {
      out.push({
        key: `col:${col}`, title: col, icon: Landmark, names,
        reason: 'No GL account is mapped to this payroll column, so its lines were left out of the journal.',
        fix: `Map a GL account to "${col}" in Payroll → Payroll Columns, then retry the posting.`,
      });
    }
    const noBank = imbalance?.missingNetAccount ?? [];
    if (noBank.length) {
      out.push({
        key: 'nobank', title: 'Net pay with no bank account', icon: Users, names: noBank,
        reason: 'These employees have no bank account on record and there is no net-payable fallback GL account.',
        fix: 'Add each employee\'s bank account on their profile (or configure PAYROLL_NET_PAYABLE_GL), then retry.',
      });
    }
    return out;
  }, [imbalance]);

  const hasReport = !!imbalance || !!invalidAccounts?.length;
  // The raw sentence repeats every name; show only its first clause when a structured view exists.
  const summary = imbalance
    ? 'The journal\'s debits and credits do not agree, so it was not posted.'
    : invalidAccounts?.length
      ? `${invalidAccounts.length} account${invalidAccounts.length !== 1 ? 's are' : ' is'} not recognised by the core banking system.`
      : info.message || 'The general ledger rejected the posting.';

  return (
    <div className="border border-[var(--danger)] rounded-[14px] bg-[color-mix(in_srgb,var(--danger)_5%,var(--surface))] overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3.5 border-b border-[color-mix(in_srgb,var(--danger)_25%,transparent)]">
        <XCircle size={18} className="text-[var(--danger)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-[var(--danger)]">GL posting failed</p>
          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{summary} Nothing was sent to the general ledger.</p>
        </div>
        {failedAt && <span className="text-[11px] text-[var(--text-muted)] shrink-0">{fmtDateTime(failedAt)}</span>}
      </div>

      <div className="px-4 py-3.5 space-y-3.5">
        {/* Totals */}
        {imbalance && (
          <div className="grid grid-cols-3 gap-2.5">
            {[
              ['Debits', imbalance.totalDr, 'var(--text-primary)'],
              ['Credits', imbalance.totalCr, 'var(--text-primary)'],
              ['Difference', imbalance.diff, 'var(--danger)'],
            ].map(([label, value, color]) => (
              <div key={label as string} className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
                <p className="text-[15px] font-semibold tabular-nums mt-0.5" style={{ color: color as string }}>{money(value as number)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Causes */}
        {groups.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Cause{groups.length !== 1 ? 's' : ''}
            </p>
            {groups.map(g => <CauseRow key={g.key} group={g} />)}
          </div>
        )}

        {invalidAccounts && invalidAccounts.length > 0 && (
          <div className="flex items-start gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
            <FileWarning size={15} className="text-[var(--danger)] mt-0.5 shrink-0" />
            <p className="text-[12px] text-[var(--text-secondary)]">
              The core banking system did not recognise {invalidAccounts.length} account{invalidAccounts.length !== 1 ? 's' : ''} in this journal.
              Open the full report to see which accounts and where each was used.
            </p>
          </div>
        )}

        {/* Non-structured failure: show the bank's message readably, raw payload folded away. */}
        {!hasReport && (info.code || info.raw) && (
          <div className="text-[12px]">
            {info.code && <span className="inline-block mr-2 px-2 py-0.5 rounded-full border border-[var(--danger)] text-[var(--danger)] font-semibold text-[11px]">Code {info.code}</span>}
            {info.raw && (
              <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => setShowRaw(s => !s)}>
                {showRaw ? 'Hide technical details' : 'Show technical details'}
              </button>
            )}
            {showRaw && info.raw && (
              <pre className="mt-2 max-h-48 overflow-auto text-[11px] bg-[var(--bg)] border border-[var(--border)] rounded-lg p-2 whitespace-pre-wrap">{info.raw}</pre>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap pt-0.5">
          {canRetry && (
            <button className="primary-btn text-[12px]" onClick={onRetry} disabled={retrying}>
              <RefreshCw size={13} className={retrying ? 'animate-spin' : ''} />
              {retrying ? 'Retrying…' : 'Retry GL Posting'}
            </button>
          )}
          {hasReport && (
            <button className="secondary-btn text-[12px]" onClick={() => setShowReport(true)}>View full report</button>
          )}
          {groups.some(g => g.key.startsWith('col:')) && (
            <span className="text-[11px] text-[var(--text-muted)]">Fix the mapping in Payroll → Payroll Columns, then retry.</span>
          )}
        </div>
      </div>

      <GlBlockedModal isOpen={showReport} accounts={invalidAccounts} imbalance={imbalance}
        context={runName} onClose={() => setShowReport(false)} />
    </div>
  );
}
