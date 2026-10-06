// ─────────────────────────────────────────────────────────────────────────────
// Legacy data migration panel (Settings → System → Migration)
//
// Drives the read-only migration endpoints. Nothing on this screen writes to either database:
// preflight checks the connection, the dry run reports what WOULD move, and Execute is refused
// by the server until the loader is built.
//
// The screen is deliberately built around the exception list rather than a progress bar. The
// risk in a migration is not that it fails loudly — it is that it succeeds quietly while
// dropping or mangling rows, so what would be EXCLUDED is given more room than what would move.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import {
  Database, Play, AlertTriangle, CheckCircle2, XCircle, Loader2,
  ChevronDown, ChevronRight, ServerCrash, ArrowRight, Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { inputClass } from '../ui/FormField';

/* ── Types mirroring the analyzer's report ──────────────────────────────── */
type Preflight = {
  ok: boolean; database?: string; reachable?: boolean; sizeMb?: number;
  tableCount?: number; scratchTableCount?: number;
  scratchTables?: { name: string; rows: number }[];
  missingExpectedTables?: string[]; error?: string;
};

type LookupInfo = {
  danglingId: number; fixedByPlan: number; stillUnresolved: number; blank: number;
  detail: { legacyId: string | number; employees: number; mappedTo: string | null }[];
};

type JobStep = {
  key: string; label: string;
  state: 'pending' | 'running' | 'done' | 'failed';
  inserted: number; updated: number; skipped: number;
  done?: number; total?: number;          // present while a large table is streaming
  startedMs?: number;                     // used to estimate time remaining for this step
  elapsedMs?: number; notes?: string[];
};

type Job = {
  running: boolean;
  target?: string;
  startedAt?: string;
  finishedAt?: string;
  currentStep?: string | null;
  steps: JobStep[];
  error?: string | null;
  elapsedMs: number;
};

type TargetState = {
  provider: string; database: string | null; isRehearsalTarget: boolean;
  counts: Record<string, number | null>; nassitColumnPresent: boolean; isEmpty: boolean;
};

type DryRun = {
  ok: boolean;
  preflight: Preflight;
  target: TargetState;
  employees: {
    total: number; wouldImport: number;
    skipped: { noEmployeeId: number };
    duplicateCodes: { code: string; count: number }[];
    reviewLists: {
      sharedNassit: { number: string; employees: number; active: number; codes: string; names: string }[];
      sharedName: { name: string; pairs: number }[];
    };
    employeesWithNoData: { count: number; sample: any[] };
    genderMapping: { raw: string; count: number; mapsTo: string | null }[];
    unresolvedLookups: Record<string, LookupInfo>;
    nassit: { withNumber: number; duplicates: { number: string; employees: number; active: number; codes: string }[] };
  };
  payroll: {
    runs: { total: number; from: string; to: string; byYear: { year: number; runs: number }[]; byStatus: { status: string; runs: number }[] };
    payrolldata: {
      total: number; wouldImport: number; wouldImportAmount: number;
      excluded: {
        deletedRun: { rows: number; amount: number };
        missingEmployee: { rows: number };
        missingColumn: { rows: number };
      };
      deletedRunDetail: { runId: number; rows: number; amount: number }[];
    };
  };
  medical: Record<string, { rows: number | null; orphanEmployee?: number | null }>;
  warnings: string[];
  elapsedMs: number;
};

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString();

/* ── Small presentational pieces ────────────────────────────────────────── */

function Stat({ label, value, tone = 'default', hint }: {
  label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'bad'; hint?: string;
}) {
  const colour =
    tone === 'good' ? 'var(--success, #16a34a)'
    : tone === 'warn' ? '#b45309'
    : tone === 'bad' ? 'var(--danger, #dc2626)'
    : 'var(--text-primary)';
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="text-[20px] font-bold mt-1" style={{ color: colour }}>{value}</p>
      {hint && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{hint}</p>}
    </div>
  );
}

const ms = (v?: number) => {
  if (!v && v !== 0) return '';
  const s = Math.round(v / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

/**
 * One row per table, showing where the migration has got to.
 *
 * A step that streams (employees, payroll history) reports done/total per batch, so it gets a
 * real progress bar and an estimate; the small ones just tick over to a row count.
 */
function StepRow({ step, active }: { step: JobStep; active: boolean }) {
  const pct = step.total ? Math.min(100, Math.round(((step.done ?? 0) / step.total) * 100)) : null;
  // Rate is measured from this step's own elapsed time, so the estimate does not inherit the
  // slowness of an earlier step.
  const eta = (() => {
    if (!active || !step.total || !step.done || !step.startedMs) return null;
    const elapsed = Date.now() - step.startedMs;
    const rate = step.done / elapsed;
    if (!rate) return null;
    return ms((step.total - step.done) / rate);
  })();

  const colour =
    step.state === 'done'    ? 'var(--success, #16a34a)'
    : step.state === 'failed'  ? 'var(--danger, #dc2626)'
    : step.state === 'running' ? 'var(--accent)'
    : 'var(--text-muted)';

  return (
    <div className="py-2.5 border-b border-[var(--border)] last:border-0">
      <div className="flex items-center gap-2.5">
        <span className="w-4 shrink-0 flex items-center justify-center">
          {step.state === 'done'    && <CheckCircle2 size={14} style={{ color: colour }} />}
          {step.state === 'failed'  && <XCircle size={14} style={{ color: colour }} />}
          {step.state === 'running' && <Loader2 size={14} className="animate-spin" style={{ color: colour }} />}
          {step.state === 'pending' && <div className="w-2 h-2 rounded-full bg-[var(--border)]" />}
        </span>

        <span className="text-[12px] flex-1 min-w-0 truncate"
              style={{ color: step.state === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
                       fontWeight: step.state === 'running' ? 600 : 400 }}>
          {step.label}
        </span>

        {step.state === 'running' && pct !== null && (
          <span className="text-[11px] tabular-nums text-[var(--text-muted)] shrink-0">
            {n(step.done)} / {n(step.total)}
            {eta && <span className="ml-1.5">· {eta} left</span>}
          </span>
        )}
        {step.state === 'done' && (
          <span className="text-[11px] tabular-nums text-[var(--text-muted)] shrink-0">
            {n(step.inserted)} rows
            {step.skipped > 0 && <span style={{ color: '#b45309' }}> · {n(step.skipped)} skipped</span>}
            <span className="ml-1.5">· {ms(step.elapsedMs)}</span>
          </span>
        )}
      </div>

      {/* Bar only while streaming: a full bar on a finished step is noise. */}
      {step.state === 'running' && (
        <div className="mt-1.5 ml-6 h-1 rounded-full bg-[var(--bg)] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'var(--accent)' }}
            animate={{ width: pct !== null ? `${pct}%` : '100%' }}
            transition={{ duration: 0.3 }}
          />
        </div>
      )}

      {step.state === 'done' && !!step.notes?.length && (
        <div className="mt-1 ml-6 space-y-0.5">
          {step.notes.map((note, i) => (
            <p key={i} className="text-[10px] text-[var(--text-muted)]">{note}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, subtitle, children, defaultOpen = false, badge }: {
  title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean; badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[var(--surface-hover)] transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-[var(--text-muted)]" />
              : <ChevronRight size={14} className="text-[var(--text-muted)]" />}
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</span>
        {badge && (
          <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)]">
            {badge}
          </span>
        )}
      </button>
      {subtitle && !open && <p className="px-4 pb-3 -mt-1 text-[11px] text-[var(--text-muted)]">{subtitle}</p>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-[var(--border)]"
          >
            <div className="p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main panel ─────────────────────────────────────────────────────────── */

export function MigrationPanel() {
  const [pre, setPre]         = useState<Preflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning]   = useState(false);
  const [report, setReport]     = useState<DryRun | null>(null);
  // Default to the rehearsal database. The live target holds GL-posted payroll runs, so it should
  // be a deliberate choice rather than the path of least resistance.
  const [target, setTarget]     = useState<'rehearsal' | 'live'>('rehearsal');
  const [loading, setLoading]   = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [job, setJob]           = useState<Job | null>(null);

  // Preflight is cheap (~300ms), so check the connection as soon as the tab opens.
  useEffect(() => { void runPreflight(true); }, []);

  async function runPreflight(silent = false) {
    setChecking(true);
    try {
      const r = await api.post('/migration/preflight', {});
      setPre(r.data?.data ?? r.data);
      if (!silent) toast.success('Source database reachable');
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not reach the source database';
      setPre({ ok: false, reachable: false, error: msg });
      if (!silent) toast.error(msg);
    } finally {
      setChecking(false);
    }
  }

  async function runDryRun() {
    setRunning(true);
    const id = toast.loading('Analysing the source database… this takes about 20 seconds');
    try {
      const r = await api.post('/migration/dry-run', { target });
      const data: DryRun = r.data?.data ?? r.data;
      setReport(data);
      toast.success(`Dry run complete — nothing was written (${(data.elapsedMs / 1000).toFixed(1)}s)`, { id });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Dry run failed', { id });
    } finally {
      setRunning(false);
    }
  }

  // Pick up a run already in flight — so a page refresh, or opening the tab on another machine,
  // still shows live progress rather than an idle screen.
  useEffect(() => { void pollJob(); }, []);

  async function pollJob() {
    try {
      const r = await api.get('/migration/job');
      const data: Job = r.data?.data ?? r.data;
      setJob(data);
      if (data.running) setLoading(true);
      return data;
    } catch { return null; }
  }

  // While a migration runs the server is polled every second; the request itself returns at once
  // (202 Accepted) because a full load takes about ten minutes — far longer than any HTTP timeout.
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(async () => {
      const data = await pollJob();
      if (data && !data.running) {
        setLoading(false);
        if (data.error) toast.error(`Migration failed: ${data.error}`);
        else {
          const rows = data.steps.reduce((s, x) => s + x.inserted, 0);
          toast.success(`Migration complete — ${rows.toLocaleString()} rows into ${data.target}`);
          void runPreflight(true);
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [loading]);

  async function runMigration(which: 'rehearsal' | 'live') {
    setConfirmLive(false);
    setConfirmText('');
    try {
      await api.post('/migration/execute',
        which === 'live' ? { target: 'live', confirm: 'MIGRATE LIVE' } : { target: 'rehearsal' });
      setLoading(true);           // starts the poll loop above
      void pollJob();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not start the migration');
    }
  }

  const emp = report?.employees;
  const pay = report?.payroll;

  return (
    <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">

      {/* ── Connection ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
             style={{ background: 'var(--accent-dim)' }}>
          <Database size={17} style={{ color: 'var(--accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          {checking && !pre && <p className="text-[13px] text-[var(--text-muted)]">Checking the source database…</p>}
          {pre?.ok && (
            <>
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                {pre.database} <span className="font-normal text-[var(--text-muted)]">· {pre.sizeMb} MB · {pre.tableCount} tables</span>
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {pre.scratchTableCount} working tables will be ignored
              </p>
            </>
          )}
          {pre && !pre.ok && (
            <>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--danger, #dc2626)' }}>
                {pre.reachable ? 'Unexpected database' : 'Cannot connect'}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] break-words">
                {pre.error ?? `Missing tables: ${(pre.missingExpectedTables ?? []).join(', ')}`}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Which database the report describes. Rehearsal is the default on purpose. */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {(['rehearsal', 'live'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTarget(t)}
                className="px-2.5 py-1.5 text-[11px] font-semibold transition-colors"
                style={{
                  background: target === t ? (t === 'live' ? '#fef2f2' : 'var(--accent-dim)') : 'transparent',
                  color:      target === t ? (t === 'live' ? '#b91c1c' : 'var(--accent)') : 'var(--text-muted)',
                }}
              >
                {t === 'rehearsal' ? 'Rehearsal' : 'Live'}
              </button>
            ))}
          </div>
          <button onClick={() => runPreflight()} disabled={checking} className="ghost-btn">
            {checking ? <Loader2 size={13} className="animate-spin" /> : <ServerCrash size={13} />}
            <span className="hidden sm:inline">Recheck</span>
          </button>
          <button onClick={runDryRun} disabled={running || !pre?.ok} className="primary-btn">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Analysing…' : 'Run dry run'}
          </button>
        </div>
      </div>

      {/* Nothing is written by anything on this screen — say so plainly. */}
      <div className="flex gap-2.5 p-3 rounded-xl bg-blue-50 border border-blue-100">
        <Info size={15} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[12px] leading-relaxed text-blue-700">
          The dry run only reads. It writes nothing to either database, so it is safe to run as often
          as you like. Review the exceptions below before any load is attempted.
        </p>
      </div>

      {!report && !running && (
        <p className="text-[12px] text-[var(--text-muted)] px-1">
          Run a dry run to see exactly what would be migrated and what would be skipped.
        </p>
      )}

      {report && (
        <>
          {/* ── Warnings first ───────────────────────────────────────────── */}
          {report.warnings.length > 0 && (
            <div className="space-y-2">
              {report.warnings.map((w, i) => (
                <div key={i} className="flex gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[12px] leading-relaxed text-amber-800">{w}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── Headline numbers ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Employees" value={n(emp?.wouldImport)} tone="good"
                  hint={`of ${n(emp?.total)} in the source`} />
            <Stat label="Payroll rows" value={n(pay?.payrolldata.wouldImport)} tone="good"
                  hint={`of ${n(pay?.payrolldata.total)}`} />
            <Stat label="Payroll runs" value={n(pay?.runs.total)}
                  hint={pay ? `${String(pay.runs.from).slice(0, 10)} → ${String(pay.runs.to).slice(0, 10)}` : ''} />
            <Stat
              label="Rows excluded"
              value={n((pay?.payrolldata.total ?? 0) - (pay?.payrolldata.wouldImport ?? 0))}
              tone="warn" hint="see the breakdown below" />
          </div>

          {/* ── Target ───────────────────────────────────────────────────── */}
          <Section title="Target database" defaultOpen
                   badge={report.target.isEmpty ? 'empty' : 'has data'}>
            <p className="text-[12px] mb-3">
              <span className="font-semibold" style={{ color: report.target.isRehearsalTarget ? 'var(--accent)' : '#b91c1c' }}>
                {report.target.isRehearsalTarget
                  ? `Rehearsal database — ${report.target.database}`
                  : 'LIVE database'}
              </span>
            </p>
            <p className="text-[12px] text-[var(--text-muted)] mb-3">
              Provider: <span className="font-semibold text-[var(--text-primary)]">{report.target.provider}</span>
              {' · '}
              employee.nassit_num:{' '}
              {report.target.nassitColumnPresent
                ? <span className="text-green-600 font-semibold">present</span>
                : <span className="text-amber-700 font-semibold">missing — run the migration SQL first</span>}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(report.target.counts).map(([t, c]) => (
                <div key={t} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <span className="text-[11px] text-[var(--text-muted)] truncate">{t}</span>
                  <span className="text-[12px] font-semibold text-[var(--text-primary)]">{c === null ? '—' : n(c)}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Payroll exclusions ───────────────────────────────────────── */}
          <Section
            title="Payroll rows that will not be migrated"
            badge={n((pay?.payrolldata.total ?? 0) - (pay?.payrolldata.wouldImport ?? 0))}
            subtitle="Mostly rows whose payroll run was deleted in the old system"
          >
            <div className="space-y-2 mb-4">
              {[
                ['Payroll run was deleted', pay?.payrolldata.excluded.deletedRun.rows, 'These rows reference a run that no longer exists, so there is nothing to attach them to.'],
                ['Employee no longer exists', pay?.payrolldata.excluded.missingEmployee.rows, ''],
                ['Payroll column no longer exists', pay?.payrolldata.excluded.missingColumn.rows, ''],
              ].map(([label, rows, why]) => (
                <div key={String(label)} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-[var(--text-primary)]">{label}</p>
                    {why ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{why}</p> : null}
                  </div>
                  <span className="text-[13px] font-bold shrink-0" style={{ color: '#b45309' }}>{n(rows as number)}</span>
                </div>
              ))}
            </div>
            {!!pay?.payrolldata.deletedRunDetail.length && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr>
                    <th className="th text-left">Deleted run id</th>
                    <th className="th text-right">Rows</th>
                    <th className="th text-right">Amount</th>
                  </tr></thead>
                  <tbody>
                    {pay.payrolldata.deletedRunDetail.map(r => (
                      <tr key={r.runId} className="tr">
                        <td className="td font-medium">{r.runId}</td>
                        <td className="td text-right">{n(r.rows)}</td>
                        <td className="td text-right">{n(Math.round(r.amount))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── Review lists ─────────────────────────────────────────────── */}
          <Section
            title="For review after the load"
            badge={`${emp?.reviewLists.sharedNassit.length ?? 0} NASSIT · ${emp?.reviewLists.sharedName.length ?? 0} names`}
            subtitle="Nothing here is skipped — every employee imports"
          >
            <p className="text-[12px] text-[var(--text-muted)] mb-4 leading-relaxed">
              Employees are identified by <strong>staff code alone</strong>, and every code in the
              source is unique, so no record is treated as a duplicate. The lists below are things a
              person may want to look at afterwards; neither is reliable enough to decide identity
              automatically, so neither changes what is imported.
            </p>

            {!!emp?.reviewLists.sharedNassit.length && (
              <div className="mb-4">
                <p className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">
                  Same NASSIT number ({emp.reviewLists.sharedNassit.length})
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mb-2">
                  Sometimes one person with two records, sometimes a data-entry error — it is not
                  conclusive either way.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead><tr>
                      <th className="th text-left">Number</th>
                      <th className="th text-left">Staff codes</th>
                      <th className="th text-left">Names</th>
                      <th className="th text-right">Active</th>
                    </tr></thead>
                    <tbody>
                      {emp.reviewLists.sharedNassit.map(d => (
                        <tr key={d.number} className="tr">
                          <td className="td font-medium">{d.number}</td>
                          <td className="td text-[var(--text-muted)]">{d.codes}</td>
                          <td className="td text-[var(--text-muted)]">{d.names}</td>
                          <td className="td text-right">
                            {d.active > 1
                              ? <span style={{ color: '#b45309', fontWeight: 600 }}>{d.active}</span>
                              : d.active}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!!emp?.reviewLists.sharedName.length && (
              <>
                <p className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">
                  Names held by more than one employee ({emp.reviewLists.sharedName.length})
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mb-2">
                  Common names collide often here, so this is weak evidence of anything.
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
                  {emp.reviewLists.sharedName.map(d => (
                    <span key={d.name}
                      className="text-[11px] px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                      {d.name}
                      <span className="text-[var(--text-muted)]"> ×{d.pairs + 1}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Section>

          {/* ── Value mapping ────────────────────────────────────────────── */}
          <Section title="Value mapping" subtitle="How legacy codes become values in this system">
            <p className="text-[12px] font-semibold text-[var(--text-primary)] mb-2">Gender</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {emp?.genderMapping.map(g => (
                <span key={g.raw} className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <span className="text-[var(--text-muted)]">{g.raw}</span>
                  <ArrowRight size={10} className="inline mx-1" />
                  <span className="font-semibold text-[var(--text-primary)]">{g.mapsTo ?? 'null'}</span>
                  <span className="text-[var(--text-muted)]"> · {n(g.count)}</span>
                </span>
              ))}
            </div>

            <p className="text-[12px] font-semibold text-[var(--text-primary)] mb-2">Lookups</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  <th className="th text-left">Field</th>
                  <th className="th text-right">Broken</th>
                  <th className="th text-right">Mapped</th>
                  <th className="th text-right">Left as null</th>
                  <th className="th text-right">Blank in source</th>
                </tr></thead>
                <tbody>
                  {Object.entries(emp?.unresolvedLookups ?? {}).map(([field, info]) => (
                    <tr key={field} className="tr">
                      <td className="td font-medium">
                        {field}
                        {info.detail.filter(d => d.mappedTo).map(d => (
                          <span key={String(d.legacyId)} className="block text-[10px] text-[var(--text-muted)]">
                            id {String(d.legacyId)} → {d.mappedTo} ({n(d.employees)})
                          </span>
                        ))}
                      </td>
                      <td className="td text-right">{n(info.danglingId)}</td>
                      <td className="td text-right" style={{ color: info.fixedByPlan ? 'var(--success, #16a34a)' : undefined }}>
                        {n(info.fixedByPlan)}
                      </td>
                      <td className="td text-right" style={{ color: info.stillUnresolved ? '#b45309' : undefined }}>
                        {n(info.stillUnresolved)}
                      </td>
                      <td className="td text-right text-[var(--text-muted)]">{n(info.blank)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── NASSIT coverage ──────────────────────────────────────────── */}
          {/* Shared numbers are listed under "For review after the load" rather than here, so the
              same table does not appear twice. */}
          <Section title="NASSIT numbers" badge={n(emp?.nassit.withNumber)}
                   subtitle="Needed by the NASSIT statutory report">
            <p className="text-[12px] text-[var(--text-muted)]">
              <strong className="text-[var(--text-primary)]">{n(emp?.nassit.withNumber)}</strong> of{' '}
              {n(emp?.total)} employees have a NASSIT number, and all of them migrate. The{' '}
              {emp?.reviewLists.sharedNassit.length ?? 0} numbers held by more than one employee are
              listed under <em>For review after the load</em>.
            </p>
          </Section>

          {/* ── Medical ──────────────────────────────────────────────────── */}
          <Section title="Medical records">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(report.medical).map(([t, v]) => (
                <div key={t} className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <p className="text-[11px] text-[var(--text-muted)] truncate">{t}</p>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{v.rows === null ? '—' : n(v.rows)}</p>
                  {v.orphanEmployee != null && (
                    <p className="text-[10px] mt-0.5" style={{ color: v.orphanEmployee ? '#b45309' : 'var(--text-muted)' }}>
                      {v.orphanEmployee ? `${v.orphanEmployee} orphaned` : 'no orphans'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* ── Execute ──────────────────────────────────────────────────── */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-start gap-2.5">
              {target === 'live'
                ? <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                : <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {target === 'live' ? 'Load into the LIVE database' : 'Load into the rehearsal database'}
                </p>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                  {target === 'live'
                    ? 'This writes to production. Rehearse first, and make sure the codelists and manual-migration indexes are in place.'
                    : `Writes into ${report.target.database ?? 'the rehearsal database'}. Safe to repeat — the loader matches on staff code and updates rather than duplicating.`}
                </p>
              </div>
              <button
                onClick={() => (target === 'live' ? setConfirmLive(true) : runMigration('rehearsal'))}
                disabled={loading}
                className="primary-btn shrink-0"
                style={target === 'live' ? { background: '#dc2626' } : undefined}
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {loading ? 'Migrating…' : target === 'live' ? 'Migrate live' : 'Run migration'}
              </button>
            </div>

            {/* Typed confirmation, required by the server for the live target. */}
            {confirmLive && (
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <p className="text-[12px] text-[var(--text-primary)] mb-2">
                  Type <code className="px-1 py-0.5 rounded bg-[var(--bg)] font-mono text-[11px]">MIGRATE LIVE</code> to confirm.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder="MIGRATE LIVE"
                    className={`${inputClass} flex-1 font-mono`}
                  />
                  <button
                    onClick={() => runMigration('live')}
                    disabled={confirmText !== 'MIGRATE LIVE' || loading}
                    className="primary-btn shrink-0 disabled:opacity-50"
                    style={{ background: '#dc2626' }}
                  >
                    Confirm
                  </button>
                  <button onClick={() => { setConfirmLive(false); setConfirmText(''); }} className="ghost-btn shrink-0">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

        </>
      )}

      {/* ── Live progress / last run ─────────────────────────────────────
          Rendered outside the dry-run block so it survives a page refresh and shows a run that
          was started elsewhere. */}
      {job && job.steps.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                {job.running ? 'Migration in progress' : job.error ? 'Migration failed' : 'Last migration'}
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {job.target}
                {job.running
                  ? ` · running for ${ms(job.elapsedMs)}`
                  : job.finishedAt ? ` · finished in ${ms(job.elapsedMs)}` : ''}
              </p>
            </div>
            {/* Overall progress, counted in completed steps — the honest measure, since the steps
                are wildly different sizes and a row-weighted bar would sit at 90% for minutes. */}
            <div className="text-right shrink-0">
              <p className="text-[18px] font-bold tabular-nums"
                 style={{ color: job.error ? 'var(--danger, #dc2626)' : job.running ? 'var(--accent)' : 'var(--success, #16a34a)' }}>
                {job.steps.filter(s => s.state === 'done').length}/{job.steps.length}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">steps</p>
            </div>
          </div>

          {job.error && (
            <div className="px-4 py-2.5 bg-red-50 border-b border-red-100">
              <p className="text-[12px] text-red-700 leading-relaxed">
                {job.error}
                <span className="block text-[11px] mt-0.5 text-red-600">
                  Steps that finished are still loaded. Fix the cause and run again — the loader
                  replaces what it owns rather than duplicating it.
                </span>
              </p>
            </div>
          )}

          <div className="px-4">
            {job.steps.map(s => (
              <StepRow key={s.key} step={s} active={job.running && job.currentStep === s.key} />
            ))}
          </div>

          {!job.running && !job.error && (
            <div className="px-4 py-2.5 border-t border-[var(--border)] flex items-center gap-4 text-[11px]">
              <span className="text-[var(--text-muted)]">
                Total <strong className="text-[var(--text-primary)] tabular-nums">
                  {n(job.steps.reduce((t, s) => t + s.inserted, 0))}
                </strong> rows
              </span>
              {job.steps.reduce((t, s) => t + s.skipped, 0) > 0 && (
                <span style={{ color: '#b45309' }}>
                  {n(job.steps.reduce((t, s) => t + s.skipped, 0))} skipped
                </span>
              )}
              <span className="text-[var(--text-muted)] ml-auto">{ms(job.elapsedMs)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
