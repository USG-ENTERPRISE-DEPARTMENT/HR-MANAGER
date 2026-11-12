import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, FileEdit, Trash2, Check, X, XCircle, RefreshCw, SendHorizonal, Plus, Download, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { money } from '../../lib/currency';
import { getCurrentUser } from '../../lib/auth';
import { PageHeader } from './ui/PageHeader';
import { TabBar } from './ui/TabBar';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { TableStateRow } from './ui/TableStateRow';
import { FormModal } from './ui/FormModal';
import { DetailSlideOver, DetailGrid, DetailField, DetailSection } from './ui/DetailSlideOver';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect, MultiSearchSelect } from './ui/SearchSelect';
import { FilterSelect } from './ui/FilterSelect';
import { DateInput } from './ui/DateInput';
import { RowActions } from './ui/RowActions';
import { ConfirmModal } from './ui/ConfirmModal';
import { GlBlockedModal, type GlImbalance, type InvalidAccount } from './ui/GlBlockedModal';
import { GlFailureCard } from './ui/GlFailureCard';
import { exportReportExcel, reportPdf } from './ui/reportTools';
import { fmtDate as formatDmy, fmtDateTime } from '@/lib/dateFormat';
import { useRealtimeRefresh } from '@/lib/realtime';

// Out of Station allowance: the number of days entered on the request (not tied to the dates — some
// staff are paid by nights away) × the daily rate for the employee's pay grade.
//
// HR raises every request — one form can raise for several employees at once (filter by department,
// then pick). Approval follows the configured approval flow (Settings → Controls → Approvals), like
// payroll; the final approval pays the allowance to the employee's account through the GL.
//
// Two menu entries:
//   Personal Out of Station — the caller's own requests, read-only, for their history.
//   Manage Out of Station   — HR: daily rates, every request (raise, submit, cancel, post) with the
//                             printable schedule, and the approval list.

type Request = {
  id: string; request_number: string; employee: string; employee_name: string; employee_code?: string;
  purpose: string; location: string; date_start: string; date_end: string;
  days: number; daily_rate: number; amount: number; paygrade_name?: string; account_no?: string; branch?: string;
  status: string; rejection_reason?: string | null; document_ref?: string | null; payment_log?: string | null;
  requested_by?: string | null; requested_by_name?: string | null; requested_by_username?: string | null;
  submitted_at?: string | null; approved_at?: string | null; posted_at?: string | null; updated_at?: string | null; created_at?: string;
  employee_status?: string | null;
  /** The approval stage it is waiting at, when the request has an approval flow. */
  current_stage_name?: string | null;
};
type Stage = {
  id: string; stage_order: number; stage_name: string; approver_type: 'role' | 'user'; approver_label?: string | null;
  status: string; acted_by_name?: string | null; acted_at?: string | null; comment?: string | null;
};
type Employee = {
  id: string; employee_name: string; employee_code?: string; paygrade_name?: string;
  department_id?: string | null; department_name?: string | null;
};
type QuoteLine = { employee: string; employee_name: string; employee_code?: string | null; paygrade_name?: string | null; daily_rate?: number; amount?: number; error?: string };
type Quote = { days: number; lines: QuoteLine[]; total: number; count: number };
type Rate = { paygrade_id: string; paygrade_name: string; daily_rate: number | null };
type GlBlock = { accounts: InvalidAccount[] | null; imbalance: GlImbalance | null } | null;

// Same palette as Leave's status pills, plus the GL outcomes.
const STATUS_PILL: Record<string, string> = {
  Draft:                 'bg-slate-100 border border-slate-200 text-slate-500',
  'Pending Approval':    'bg-amber-500/10 text-amber-700 border border-amber-200/50',
  Approved:             'pill-success',
  Posting:               'bg-sky-500/10 text-sky-700 border border-sky-200/50',
  Paid:                  'pill-success',
  'GL Failed':           'bg-red-500/10 text-red-700 border border-red-200/50',
  Rejected:              'pill-danger',
  Cancelled:             'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-muted)]',
};
function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_PILL[status] ?? ''}`}>{status}</span>;
}

const OPEN = ['Draft', 'Pending Approval'];
const fmtDate = (v?: string | null) => formatDmy(v);
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
const amt = (n: any) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function paginate<T>(arr: T[], page: number, size: number): T[] { return arr.slice((page - 1) * size, page * size); }

/** Run an action; show the server's message and open the GL block modal when it reports one. */
async function runAction(call: () => Promise<any>, onGlBlock: (b: GlBlock) => void, fallbackOk: string) {
  try {
    const res = await call();
    const body = res.data ?? {};
    const msg: string = body.message || fallbackOk;
    if (body.glError || /failed|switched off/i.test(msg)) toast.warning(msg);
    else toast.success(msg);
    if (body.glInvalidAccounts?.length || body.glImbalance) onGlBlock({ accounts: body.glInvalidAccounts ?? null, imbalance: body.glImbalance ?? null });
    return true;
  } catch (e: any) {
    toast.error(e.response?.data?.message || 'Action failed');
    return false;
  }
}

// ── Request form (apply / edit) ───────────────────────────────────────────────
function RequestForm({ initial, employees, title, subtitle, onClose, onSaved }: {
  initial: Request | null; employees: Employee[]; title: string; subtitle: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    location: initial?.location ?? '', purpose: initial?.purpose ?? '',
    date_start: day(initial?.date_start), date_end: day(initial?.date_end),
    days: initial?.days != null ? String(initial.days) : '',
  });
  // Several employees can be picked at once (one request each); editing a draft keeps its one employee.
  const [selected, setSelected] = useState<string[]>(
    initial?.employee ? [String(initial.employee)] : (employees.length === 1 ? [String(employees[0].id)] : []));
  const [department, setDepartment] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));

  // Calendar days in the period — shown for reference only. The days paid are whatever is entered
  // (some staff are paid by nights away, which counts differently).
  const span = form.date_start && form.date_end && form.date_end >= form.date_start
    ? Math.round((Date.parse(form.date_end) - Date.parse(form.date_start)) / 86400000) + 1 : 0;
  const daysNum = Number(form.days);
  const daysError = form.days === '' ? '' : !Number.isInteger(daysNum) || daysNum < 1 ? 'Enter a whole number of 1 or more' : '';

  // Days × rate comes from the server: each employee's rate belongs to their pay grade.
  const selectedKey = selected.join(',');
  useEffect(() => {
    setQuote(null); setQuoteError('');
    if (!selected.length || !span || !form.days || daysError) return;
    const t = setTimeout(() => {
      api.post('/out-of-station/quote', {
        employees: selected, date_start: form.date_start, date_end: form.date_end, days: form.days,
        ...(initial ? { exclude_id: initial.id } : {}),
      })
        .then(r => setQuote(r.data?.data ?? null))
        .catch(e => setQuoteError(e.response?.data?.message || 'Could not work out the allowance'));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, form.date_start, form.date_end, form.days, daysError, span]);

  const save = async (submit: boolean) => {
    if (saving) return;
    if (!selected.length) return toast.error('Select at least one employee');
    if (!form.location.trim()) return toast.error('Location is required');
    if (!form.date_start || !form.date_end) return toast.error('Start and end dates are required');
    if (!form.days) return toast.error('Enter the number of days');
    if (daysError) return toast.error(`Number of days: ${daysError}`);
    if (!form.purpose.trim()) return toast.error('Purpose is required');
    const blocked = quote?.lines.filter(l => l.error) ?? [];
    if (blocked.length) return toast.error(`Remove ${blocked.length === 1 ? blocked[0].employee_name : `the ${blocked.length} employees marked in red`} first — they cannot be included.`);
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/out-of-station/requests/${initial.id}`, form);
        if (submit) await api.post(`/out-of-station/requests/${initial.id}/submit`);
        toast.success(submit ? 'Request submitted for approval' : 'Request updated');
      } else {
        const res = await api.post('/out-of-station/requests', { ...form, employees: selected, submit });
        toast.success(res.data?.message || 'Request saved');
      }
      onSaved(); onClose();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save the request', { duration: 8000 }); }
    finally { setSaving(false); }
  };

  const label = (e: Employee) => `${e.employee_name}${e.employee_code ? ` (${e.employee_code})` : ''}`;
  const departments = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.department_id ? String(e.department_id) : 'none', e.department_name || 'No department');
    return [...m.entries()].map(([value, lbl]) => ({ value, label: lbl })).sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);
  // The list shows the chosen department; anyone already picked stays listed so their chip still shows
  // when the filter moves to another department.
  const options = useMemo(() => employees
    .filter(e => !department || (e.department_id ? String(e.department_id) : 'none') === department || selected.includes(String(e.id)))
    .map(e => ({ id: String(e.id), label: label(e) })), [employees, department, selectedKey]);
  const inDept = department ? employees.filter(e => (e.department_id ? String(e.department_id) : 'none') === department) : [];
  const addDept = () => setSelected(s => [...new Set([...s, ...inDept.map(e => String(e.id))])]);

  const okLines = quote?.lines.filter(l => !l.error) ?? [];
  const badLines = quote?.lines.filter(l => l.error) ?? [];

  return (
    <FormModal
      title={title} subtitle={subtitle}
      onClose={onClose} onSave={() => save(true)} saveLabel={saving ? 'Saving…' : 'Submit'}
      secondaryAction={{ label: 'Save as Draft', onClick: () => save(false) }}
      maxWidth="lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {initial && employees.length > 1 ? (
          <FormField label="Employee" required className="col-span-full">
            <SearchSelect value={selected[0] ?? ''} onChange={() => {}} options={employees.map(e => ({ id: String(e.id), label: label(e) }))} disabled />
          </FormField>
        ) : !initial && employees.length > 1 && <>
          {departments.length > 1 && (
            <FormField label="Department" className="col-span-full">
              <div className="flex flex-wrap items-end gap-2">
                <FilterSelect value={department} onChange={setDepartment} placeholder="All departments" className="flex-1"
                  options={[{ value: '', label: 'All departments' }, ...departments]} />
                {department && (
                  <button type="button" className="secondary-btn shrink-0 h-[34px]" onClick={addDept} disabled={!inDept.length}>
                    Add all {inDept.length} from department
                  </button>
                )}
              </div>
            </FormField>
          )}
          <FormField label={`Employees${selected.length ? ` (${selected.length} selected)` : ''}`} required className="col-span-full">
            <MultiSearchSelect value={selected} onChange={setSelected} options={options} placeholder="Search and select employees…" />
          </FormField>
        </>}
        <FormField label="Location" required className="col-span-full">
          <input id="oos-location" className={inputClass} value={form.location} maxLength={150} onChange={e => set('location', e.target.value)} placeholder="e.g. Makeni" />
        </FormField>
        <FormField label="Start Date" required>
          <DateInput className={inputClass} value={form.date_start}
            onChange={e => setForm(p => ({ ...p, date_start: e.target.value, date_end: p.date_end && e.target.value > p.date_end ? e.target.value : p.date_end }))} />
        </FormField>
        <FormField label="End Date" required>
          <DateInput className={inputClass} value={form.date_end} min={form.date_start || undefined} onChange={e => set('date_end', e.target.value)} />
        </FormField>
        <FormField label="Number of Days" required>
          <input type="number" min={1} step={1} className={inputClass} value={form.days}
            onChange={e => set('days', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="Days to pay" />
          <p className={`mt-1 text-[11px] ${daysError ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
            {daysError || (span ? `Paid at the daily rate. For reference, the dates span ${span} calendar day${span !== 1 ? 's' : ''}.` : 'Paid at the daily rate.')}
          </p>
        </FormField>

        {form.date_start && form.date_end && form.date_end < form.date_start ? (
          <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">
            End date must be on or after start date.
          </div>
        ) : quoteError ? (
          <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">{quoteError}</div>
        ) : selected.length > 0 && span > 0 && form.days && !daysError && (
          <div className="col-span-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                {!quote ? 'Working out the allowance…'
                  : okLines.length === 1 ? `${quote.days} day${quote.days !== 1 ? 's' : ''} × ${amt(okLines[0].daily_rate)}`
                  : `${okLines.length} employee${okLines.length !== 1 ? 's' : ''} × ${quote.days} day${quote.days !== 1 ? 's' : ''}`}
              </span>
              {quote && <span className="text-[13px] font-bold tabular-nums text-[var(--success)]">{money(quote.total)}</span>}
            </div>
            {quote && (quote.lines.length > 1 || badLines.length > 0) && (
              <div className="max-h-56 overflow-y-auto border-t border-[var(--border)] divide-y divide-[var(--border)]">
                {quote.lines.map(l => (
                  <div key={l.employee} className="flex items-start justify-between gap-3 px-4 py-2 text-[12px]">
                    <div className="min-w-0">
                      <p className={`font-medium truncate ${l.error ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'}`}>{l.employee_name}</p>
                      <p className={`text-[11px] ${l.error ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
                        {l.error || `Grade ${l.paygrade_name || '—'} · ${amt(l.daily_rate)} a day`}
                      </p>
                    </div>
                    {l.error ? (
                      !initial && <button type="button" className="shrink-0 text-[11px] font-semibold text-[var(--danger)] hover:underline"
                        onClick={() => setSelected(s => s.filter(id => id !== String(l.employee)))}>Remove</button>
                    ) : <span className="shrink-0 font-semibold tabular-nums text-[var(--text-primary)]">{money(l.amount ?? 0)}</span>}
                  </div>
                ))}
              </div>
            )}
            {quote && quote.lines.length === 1 && okLines[0]?.paygrade_name && (
              <p className="px-4 pb-3 -mt-1 text-[11px] text-[var(--text-muted)]">Daily rate for grade {okLines[0].paygrade_name}</p>
            )}
          </div>
        )}

        <FormField label="Purpose" required className="col-span-full">
          <CountedTextarea className={inputClass} rows={3} maxChars={255} value={form.purpose} onChange={e => set('purpose', e.target.value)} placeholder="e.g. Relief duties at the Makeni branch" />
        </FormField>
      </div>
    </FormModal>
  );
}

// ── Request detail (slide-over) ───────────────────────────────────────────────
function RequestDetail({ request, footerActions, canRetry, retrying, onRetry, onClose }: {
  request: Request | null; footerActions?: React.ReactNode; canRetry: boolean; retrying: boolean; onRetry: () => void; onClose: () => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  useEffect(() => {
    if (!request) return;
    api.get(`/out-of-station/requests/${request.id}/history`).then(r => setHistory(r.data?.data ?? [])).catch(() => setHistory([]));
    api.get(`/out-of-station/requests/${request.id}/stages`).then(r => setStages(r.data?.data ?? [])).catch(() => setStages([]));
  }, [request?.id, request?.status, request?.updated_at]);
  const r = request;
  const STAGE_PILL: Record<string, string> = {
    Pending: 'bg-amber-500/10 text-amber-700 border border-amber-200/50', Approved: 'pill-success',
    Rejected: 'pill-danger', Skipped: 'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-muted)]',
  };
  return (
    <DetailSlideOver open={!!r} title="Out of Station Details" subtitle={r ? `${r.request_number} · ${r.employee_name}` : undefined} onClose={onClose} footerActions={footerActions}>
      {r && (
        <div className="space-y-5">
          {/* Banner — location + period + day count, like Leave Details */}
          <div className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)' }}>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-[var(--text-primary)] truncate">{r.location}</p>
              <p className="text-[12px] text-[var(--text-muted)]">{fmtDate(r.date_start)} → {fmtDate(r.date_end)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[28px] font-bold tabular-nums leading-none text-[var(--accent)]">{r.days}</p>
              <p className="text-[11px] font-semibold mt-0.5 text-[var(--accent)]">day{r.days !== 1 ? 's' : ''}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[12px] border border-[var(--border)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Status</p>
              <StatusPill status={r.status} />
            </div>
            <div className="rounded-[12px] border border-[var(--border)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Employee</p>
              <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{r.employee_name}</p>
            </div>
          </div>

          <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Allowance</p>
            </div>
            <div className="px-4 divide-y divide-[var(--border)]">
              {([
                ['Grade',      r.paygrade_name || '—'],
                ['Daily rate', amt(r.daily_rate)],
                ['Days',       `${r.days} day${r.days !== 1 ? 's' : ''}`],
                ['Net payout', <span key="n" className="font-bold text-[var(--success)] tabular-nums">{money(r.amount)}</span>],
                ['Account',    r.account_no || '—'],
                ['Branch',     r.branch || '—'],
                ...(r.document_ref ? [['GL Reference', <span key="g" className="font-mono tracking-wide">{r.document_ref}</span>]] : []),
              ] as [string, React.ReactNode][]).map(([label, val]) => (
                <div key={label} className="flex items-start justify-between py-2.5 text-[13px] gap-4">
                  <span className="text-[var(--text-muted)] shrink-0">{label}</span>
                  <span className="font-medium text-[var(--text-primary)] text-right">{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Purpose</p>
            <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{r.purpose}</div>
          </div>

          {(r.status === 'Rejected' || (r.status === 'Cancelled' && r.rejection_reason)) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--danger)] mb-2">{r.status === 'Rejected' ? 'Rejection Reason' : 'Cancellation Reason'}</p>
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700 leading-relaxed whitespace-pre-wrap">{r.rejection_reason || 'No reason was provided.'}</div>
            </div>
          )}

          {r.status === 'GL Failed' && (
            <GlFailureCard paymentLog={r.payment_log} failedAt={r.updated_at} runName={r.request_number} canRetry={canRetry} retrying={retrying} onRetry={onRetry} />
          )}

          <DetailSection title="Request">
            <DetailGrid>
              <DetailField label="Reference" value={r.request_number} />
              <DetailField label="Raised by" value={r.requested_by_name || r.requested_by_username || 'HR'} />
              <DetailField label="Submitted" value={r.submitted_at ? fmtDateTime(r.submitted_at, '') : '—'} />
              <DetailField label="Paid" value={r.posted_at ? fmtDateTime(r.posted_at, '') : '—'} />
            </DetailGrid>
          </DetailSection>

          {stages.length > 0 && (
            <DetailSection title="Approval Stages">
              <div className="rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)]">
                {stages.map((st, i) => (
                  <div key={st.id} className="flex items-start justify-between gap-4 px-4 py-2.5 text-[12px]">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--text-primary)]">{i + 1}. {st.stage_name}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {st.acted_by_name ? `${st.acted_by_name} · ${fmtDateTime(st.acted_at, '')}` : (st.approver_label || (st.approver_type === 'user' ? 'Assigned user' : 'Assigned role'))}
                      </p>
                      {st.comment && <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap">{st.comment}</p>}
                    </div>
                    <span className={`pill shrink-0 ${STAGE_PILL[st.status] ?? ''}`}>{st.status}</span>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          {history.length > 0 && (
            <DetailSection title="History">
              <div className="rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)]">
                {history.map(h => (
                  <div key={h.id} className="flex items-start justify-between gap-4 px-4 py-2.5 text-[12px]">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--text-primary)]">{h.action}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{h.user_full_name || h.user_name || 'System'}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{fmtDateTime(h.created_at, '')}</span>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}
        </div>
      )}
    </DetailSlideOver>
  );
}

// ── Shared request table ──────────────────────────────────────────────────────
function RequestTable({ rows, loading, empty, showEmployee, actions }: {
  rows: Request[]; loading: boolean; empty: string; showEmployee: boolean; actions: (r: Request) => React.ComponentProps<typeof RowActions>['actions'];
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => setPage(1), [rows.length]);
  const cols = showEmployee ? 9 : 8;
  return (
    <>
      <div className="overflow-x-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">Reference</th>
              {showEmployee && <th className="th text-left">Employee</th>}
              <th className="th text-left">Location</th>
              <th className="th text-left">Start</th>
              <th className="th text-left">End</th>
              <th className="th text-center" style={{ width: '6%' }}>Days</th>
              <th className="th" style={{ width: '12%', textAlign: 'right' }}>Allowance</th>
              <th className="th text-left">Status</th>
              <th scope="col" className="th" style={{ textAlign: 'right' }}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <TableStateRow cols={cols} loading={loading} empty={empty} />
            ) : paginate(rows, page, pageSize).map((row, i) => (
              <motion.tr key={row.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
                <td className="td font-medium text-[var(--text-primary)]">{row.request_number}</td>
                {showEmployee && <td className="td text-[var(--text-primary)] font-medium">{row.employee_name}</td>}
                <td className="td">{row.location}</td>
                <td className="td">{fmtDate(row.date_start)}</td>
                <td className="td">{fmtDate(row.date_end)}</td>
                <td className="td text-center">{row.days}</td>
                <td className="td text-right"><span className="font-semibold tabular-nums text-[var(--success)] text-[13px]">{money(row.amount)}</span></td>
                <td className="td">
                  <StatusPill status={row.status} />
                  {row.status === 'Pending Approval' && row.current_stage_name && (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">At: {row.current_stage_name}</p>
                  )}
                </td>
                <td className="td text-right"><div className="flex justify-end"><RowActions actions={actions(row)} /></div></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination total={rows.length} filtered={rows.length} page={page} pageSize={pageSize}
        onPageChange={setPage} onPageSizeChange={p => { setPageSize(p); setPage(1); }} />
    </>
  );
}

/** Reject / cancel / delete / approve / retry, shared by both pages. */
function useRequestActions(reload: () => void) {
  const [glBlock, setGlBlock] = useState<GlBlock>(null);
  const [rejecting, setRejecting] = useState<Request | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; onConfirm: () => void } | null>(null);
  const [retrying, setRetrying] = useState(false);

  const post = (path: string, body: any, ok: string) => runAction(() => api.post(path, body), setGlBlock, ok).then(done => { if (done) reload(); return done; });
  const approve = (r: Request) => post(`/out-of-station/requests/${r.id}/approve`, {}, 'Request approved');
  const submit  = (r: Request) => post(`/out-of-station/requests/${r.id}/submit`, {}, 'Request submitted');
  const postGl  = (r: Request) => post(`/out-of-station/requests/${r.id}/post`, {}, 'Posted');
  const retry   = async (r: Request) => { setRetrying(true); await post(`/out-of-station/requests/${r.id}/retry-gl`, {}, 'Posted'); setRetrying(false); };
  const cancel  = (r: Request) => setConfirm({
    title: 'Cancel Request', message: `Cancel out-of-station request ${r.request_number} (${r.location}, ${r.days} day${r.days !== 1 ? 's' : ''})?`,
    label: 'Cancel Request', onConfirm: () => post(`/out-of-station/requests/${r.id}/cancel`, {}, 'Request cancelled'),
  });
  const remove  = (r: Request) => setConfirm({
    title: 'Delete Request', message: `Delete draft ${r.request_number}? This cannot be undone.`, label: 'Delete',
    onConfirm: () => api.delete(`/out-of-station/requests/${r.id}`).then(() => { toast.success('Request deleted'); reload(); })
      .catch((e: any) => toast.error(e.response?.data?.message || 'Failed to delete the request')),
  });
  const openReject = (r: Request) => { setRejecting(r); setRejectReason(''); };

  const modals = (
    <>
      {rejecting && (
        <FormModal title="Reject Request" subtitle="Provide a reason for rejection." onClose={() => setRejecting(null)} saveLabel="Reject" maxWidth="md" scrollable={false}
          onSave={async () => {
            if (!rejectReason.trim()) { toast.error('A reason is required'); return; }
            const done = await post(`/out-of-station/requests/${rejecting.id}/reject`, { reason: rejectReason.trim() }, 'Request rejected');
            if (done) setRejecting(null);
          }}>
          <FormField label="Rejection Reason" required>
            <CountedTextarea className={inputClass} rows={3} maxChars={500} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection…" />
          </FormField>
        </FormModal>
      )}
      {confirm && (
        <ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.label} variant="danger"
          onCancel={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />
      )}
      <GlBlockedModal isOpen={!!glBlock} accounts={glBlock?.accounts} imbalance={glBlock?.imbalance} context="out-of-station allowance" onClose={() => setGlBlock(null)} />
    </>
  );
  return { approve, submit, postGl, retry, retrying, cancel, remove, openReject, modals };
}

function useUser() {
  const user = getCurrentUser();
  const can = (p: string) => user?.resolvedPermissions?.has(p) || false;
  const isAdmin = user?.allRoles?.some(r => ['admin', 'super-admin'].includes(r.name)) ?? false;
  return {
    userId: user?.id != null ? String(user.id) : '',
    employeeId: user?.employeeId != null ? String(user.employeeId) : '',
    canManage: isAdmin || can('manage_out_of_station'),
    isHr: isAdmin || can('approve_out_of_station'),
    canViewAll: isAdmin || can('manage_out_of_station') || can('approve_out_of_station') || can('view_out_of_station'),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL OUT OF STATION
// ══════════════════════════════════════════════════════════════════════════════
const PERSONAL_TABS = ['All my Requests', 'Paid', 'In Progress'] as const;

/** Read-only history of the caller's own requests. HR raises them; the employee can only view. */
export function PersonalOutOfStation() {
  const [activeTab, setActiveTab] = useState<string>('All my Requests');
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewRow, setViewRow] = useState<Request | null>(null);

  // The server returns only requests for the caller's own employee record, never drafts.
  const load = useCallback(() => {
    setLoading(true);
    api.get('/out-of-station/requests', { params: { scope: 'mine' } })
      .then(r => setRows(r.data?.data ?? []))
      .catch(() => toast.error('Failed to load requests'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh('outofstation', load);

  const byTab = rows.filter(x =>
    activeTab === 'Paid' ? x.status === 'Paid'
    : activeTab === 'In Progress' ? ['Pending Approval', 'Approved', 'Posting', 'GL Failed'].includes(x.status)
    : true);
  const filtered = byTab.filter(r => JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full">
      <PageHeader title="Out of Station" subtitle="Your out-of-station allowance history. Requests are raised and approved by HR." />

      <TabBar tabs={[...PERSONAL_TABS]} activeTab={activeTab} onChange={setActiveTab} />

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden min-h-[500px] flex flex-col">
        <TableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search requests..."
          searchWidth="sm:w-[280px]"
        />
        <RequestTable
          rows={filtered} loading={loading} showEmployee={false}
          empty="No out-of-station requests on record for you."
          actions={r => [{ label: 'View', icon: Eye, onClick: () => setViewRow(r) }]}
        />
      </div>

      <RequestDetail request={viewRow} canRetry={false} retrying={false} onRetry={() => {}} onClose={() => setViewRow(null)} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANAGE OUT OF STATION
// ══════════════════════════════════════════════════════════════════════════════
const MANAGE_STATUSES = ['All', 'Draft', 'Pending Approval', 'Approved', 'Posting', 'Paid', 'GL Failed', 'Rejected', 'Cancelled'];

export function ManageOutOfStation() {
  const me = useUser();
  // The Approval List shows only what the caller can approve now (their stage, by role or by name),
  // so it is offered to anyone who can open this page; approvers without it use Central Approval.
  const MAIN_TABS = [
    ...(me.canManage ? ['Daily Rates'] : []),
    ...(me.canViewAll ? ['All Requests'] : []),
    'Approval List',
  ];
  const [activeTab, setActiveTab] = useState<string>(MAIN_TABS[0] ?? '');

  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Out of Station Setup" subtitle="Raise requests, set daily rates, approve requests and download the allowance schedule. The approval flow and posting controls are in Settings → Controls." />
      {MAIN_TABS.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] p-10 text-center text-sm text-[var(--text-muted)]">You don't have access to manage out-of-station requests.</div>
      ) : <>
        <TabBar tabs={MAIN_TABS} activeTab={activeTab} onChange={setActiveTab} className="flex flex-wrap items-center gap-2 mt-2 mb-4 border-b border-slate-200 pb-2" />
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] flex flex-col min-h-[500px] overflow-hidden">
          {activeTab === 'Daily Rates' && <RatesTab />}
          {(activeTab === 'All Requests' || activeTab === 'Approval List') && <ManageRequestsTab key={activeTab} approvals={activeTab === 'Approval List'} me={me} />}
        </div>
      </>}
    </div>
  );
}

function ManageRequestsTab({ approvals, me }: { approvals: boolean; me: ReturnType<typeof useUser> }) {
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewRow, setViewRow] = useState<Request | null>(null);
  const [form, setForm] = useState<Request | null | undefined>(undefined);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const req = approvals
      // The server returns only requests the caller can approve right now.
      ? api.get('/out-of-station/approvals').then(r => r.data?.data ?? [])
      : api.get('/out-of-station/requests', { params: { scope: 'all', ...(from ? { from } : {}), ...(to ? { to } : {}) } }).then(r => r.data?.data ?? []);
    req.then(setRows).catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load requests')).finally(() => setLoading(false));
  }, [approvals, from, to]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh('outofstation', load);
  useEffect(() => {
    if (me.canManage && !approvals) api.get('/out-of-station/employees').then(r => setEmployees(r.data?.data ?? [])).catch(() => {});
  }, [me.canManage, approvals]);

  const act = useRequestActions(() => { load(); setViewRow(null); });
  const filtered = rows.filter(r => (status === 'All' || r.status === status) && JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase()));
  const hrActions = me.isHr || me.canManage;
  // The Approval List already holds only what this user may approve (the server applies the stages
  // and the rule that whoever raised a request never approves it).
  const decides = (r: Request) => approvals && r.status === 'Pending Approval';
  const approveLabel = (r: Request) => (r.current_stage_name ? `Approve — ${r.current_stage_name}` : 'Approve');
  const isDraft = (r: Request) => r.status === 'Draft' && me.canManage;

  // The schedule as the Bank prints it: name, days, rate, net, account and branch, with a total.
  const scheduleRows = filtered.filter(r => ['Approved', 'Paid', 'GL Failed'].includes(r.status));
  const scheduleHeaders = ['Name', 'Period', 'No. of Days', 'Rate', 'Net', 'A/C No.', 'Branch'];
  const scheduleData = () => {
    const body = scheduleRows.map(r => [r.employee_name, `${fmtDate(r.date_start)} – ${fmtDate(r.date_end)}`, r.days, amt(r.daily_rate), amt(r.amount), r.account_no || '', r.branch || '']);
    return [...body, ['Total', '', scheduleRows.reduce((n, r) => n + Number(r.days || 0), 0), '', amt(scheduleRows.reduce((s, r) => s + Number(r.amount || 0), 0)), '', '']];
  };
  const scheduleTitle = 'Out of Station Allowance Schedule';
  const scheduleSummary = `${from || to ? `${from ? fmtDate(from) : '…'} to ${to ? fmtDate(to) : '…'}` : 'All dates'} · Approved and paid requests`;

  return (
    <>
      <TableToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={approvals ? 'Search pending requests...' : 'Search requests...'}
        actions={approvals ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            <button className="secondary-btn shrink-0" disabled={!scheduleRows.length} onClick={() => exportReportExcel(scheduleTitle, scheduleSummary, scheduleHeaders, scheduleData())}>
              <FileSpreadsheet className="w-[14px] h-[14px]" /><span className="hidden sm:inline">Export Excel</span>
            </button>
            <button className="secondary-btn shrink-0" disabled={!scheduleRows.length || pdfBusy} onClick={() => reportPdf(scheduleTitle, scheduleSummary, scheduleHeaders, scheduleData(), setPdfBusy)}>
              <Download className="w-[14px] h-[14px]" /><span className="hidden sm:inline">{pdfBusy ? 'Generating…' : 'Download Schedule'}</span>
            </button>
            {me.canManage && (
              <button className="primary-btn shrink-0" onClick={() => setForm(null)}>
                <span className="hidden sm:inline">New Request</span><span className="sm:hidden">New</span><Plus className="w-[14px] h-[14px]" />
              </button>
            )}
          </div>
        )}
      />
      {!approvals && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <DateInput className={`${inputClass} max-w-[160px]`} value={from} onChange={e => setFrom(e.target.value)} />
          <span className="text-[12px] text-[var(--text-muted)]">to</span>
          <DateInput className={`${inputClass} max-w-[160px]`} value={to} onChange={e => setTo(e.target.value)} />
          <div className="flex flex-wrap gap-1 ml-auto">
            {MANAGE_STATUSES.map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${status === s
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}>{s}</button>
            ))}
          </div>
        </div>
      )}
      <RequestTable
        rows={filtered} loading={loading} showEmployee
        empty={approvals ? 'No requests waiting for your approval.' : 'No requests found.'}
        actions={r => [
          { label: 'View', icon: Eye, onClick: () => setViewRow(r) },
          { label: approveLabel(r), icon: Check, onClick: () => act.approve(r), hidden: !decides(r) },
          { label: 'Reject', icon: XCircle, danger: true, onClick: () => act.openReject(r), hidden: !decides(r) },
          { label: 'Submit for Approval', icon: SendHorizonal, onClick: () => act.submit(r), hidden: approvals || !isDraft(r) },
          { label: 'Edit', icon: FileEdit, onClick: () => setForm(r), hidden: approvals || !isDraft(r) },
          { label: 'Delete', icon: Trash2, danger: true, onClick: () => act.remove(r), hidden: approvals || !isDraft(r) },
          { label: 'Retry GL Posting', icon: RefreshCw, danger: true, onClick: () => act.retry(r), hidden: approvals || r.status !== 'GL Failed' || !hrActions },
          { label: 'Post to GL', icon: CheckCircle2, onClick: () => act.postGl(r), hidden: approvals || r.status !== 'Approved' || !hrActions },
          { label: 'Cancel Request', icon: XCircle, danger: true, onClick: () => act.cancel(r), hidden: approvals || !['Pending Approval', 'Approved', 'GL Failed'].includes(r.status) || !hrActions },
        ]}
      />

      {form !== undefined && (
        <RequestForm initial={form} employees={form ? [{ id: String(form.employee), employee_name: form.employee_name, employee_code: form.employee_code }] : employees}
          title={form ? `Edit ${form.request_number} — ${form.employee_name}` : 'New Out of Station Request'}
          subtitle={form ? 'Paid as days × the daily rate for the employee\'s grade.' : 'Raise a request for one or more employees. Paid as days × the daily rate for each employee\'s grade.'}
          onClose={() => setForm(undefined)} onSaved={load} />
      )}
      <RequestDetail
        request={viewRow} canRetry={hrActions} retrying={act.retrying} onRetry={() => viewRow && act.retry(viewRow)} onClose={() => setViewRow(null)}
        footerActions={viewRow && decides(viewRow) ? (
          <>
            <button className="secondary-btn shadow-sm text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5" onClick={() => act.openReject(viewRow)}>
              <X size={14} className="mr-1.5 inline" />Reject
            </button>
            <button className="primary-btn shadow-sm bg-[var(--success)] hover:opacity-90" onClick={() => act.approve(viewRow)}>
              <Check size={14} className="mr-1.5 inline" />{approveLabel(viewRow)}
            </button>
          </>
        ) : undefined}
      />
      {act.modals}
    </>
  );
}

function RatesTab() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Rate | null>(null);
  const [pending, setPending] = useState<Rate | null>(null);
  const [f, setF] = useState({ paygrade_id: '', daily_rate: '' });

  // The server lists every pay grade; the table shows only the grades that have a rate, like Medical Limits.
  const load = useCallback(() => {
    setLoading(true);
    api.get('/out-of-station/rates').then(r => setRates(r.data?.data ?? []))
      .catch(() => toast.error('Failed to load daily rates')).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const withRate = rates.filter(r => r.daily_rate != null);
  // A grade that already has a rate shouldn't appear again when adding; when editing, keep the row's own grade.
  const gradeOptions = useMemo(() => rates
    .filter(r => r.daily_rate == null || String(r.paygrade_id) === String(sel?.paygrade_id))
    .map(r => ({ id: String(r.paygrade_id), label: r.paygrade_name || `Grade ${r.paygrade_id}` })), [rates, sel]);

  const openAdd = () => { setSel(null); setF({ paygrade_id: '', daily_rate: '' }); setOpen(true); };
  const openEdit = (r: Rate) => { setSel(r); setF({ paygrade_id: String(r.paygrade_id), daily_rate: String(r.daily_rate ?? '') }); setOpen(true); };

  // PUT takes a list of { paygrade_id, daily_rate }; a blank rate removes it. Changing an edited row's grade
  // moves the rate, so the old grade is cleared in the same call.
  const putRates = (list: { paygrade_id: string; daily_rate: string }[]) => api.put('/out-of-station/rates', { rates: list });

  async function handleSave() {
    if (!f.paygrade_id || f.daily_rate === '') return toast.error('All fields are required');
    if (Number(f.daily_rate) < 0) return toast.error('Daily rate cannot be negative');
    setSaving(true);
    try {
      const list = [{ paygrade_id: f.paygrade_id, daily_rate: f.daily_rate }];
      if (sel && String(sel.paygrade_id) !== f.paygrade_id) list.push({ paygrade_id: String(sel.paygrade_id), daily_rate: '' });
      await putRates(list);
      toast.success(sel ? 'Daily rate updated' : 'Daily rate saved');
      setOpen(false); load();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save rate'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!pending) return;
    try { await putRates([{ paygrade_id: String(pending.paygrade_id), daily_rate: '' }]); toast.success('Deleted'); load(); }
    catch { toast.error('Failed'); }
    setPending(null);
  }

  const filtered = withRate.filter(r => String(r.paygrade_name ?? '').toLowerCase().includes(searchQuery.toLowerCase()));
  useEffect(() => { setPage(1); }, [filtered.length]);
  return (
    <>
      <TableToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        actions={<button className="primary-btn" onClick={openAdd}><Plus size={14} />Add Rate</button>}
      />
      <div className="overflow-x-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th">Pay Grade</th>
              <th className="th">Daily Rate</th>
              <th className="th !text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <TableStateRow cols={3} loading={loading} empty={rates.length ? 'No daily rates set yet. Click Add Rate.' : 'No pay grades found. Set them up in Salary first.'} className="py-8" />
            ) : paginate(filtered, page, pageSize).map(r => (
              <tr key={r.paygrade_id} className="tr">
                <td className="td">{r.paygrade_name || `Grade ${r.paygrade_id}`}</td>
                <td className="td tabular-nums">{amt(r.daily_rate ?? 0)}</td>
                <td className="td text-right">
                  <div className="flex justify-end">
                    <RowActions actions={[
                      { label: 'Edit', icon: FileEdit, onClick: () => openEdit(r) },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPending(r) },
                    ]} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination total={withRate.length} filtered={filtered.length} page={page} pageSize={pageSize}
        onPageChange={setPage} onPageSizeChange={p => { setPageSize(p); setPage(1); }} />

      {open && (
        <FormModal title={sel ? 'Edit Daily Rate' : 'Add Daily Rate'} maxWidth="md"
          onClose={() => setOpen(false)} onSave={handleSave} saveLabel={saving ? 'Saving…' : 'Save'}>
          <FormField label="Pay Grade" required>
            <SearchSelect value={f.paygrade_id} onChange={v => setF(p => ({ ...p, paygrade_id: v }))} options={gradeOptions} placeholder="Select pay grade…" />
          </FormField>
          <FormField label="Daily Rate" required>
            <input type="number" min="0" step="0.01" className={inputClass} value={f.daily_rate}
              onChange={e => setF(p => ({ ...p, daily_rate: e.target.value }))} placeholder="0.00"
              onWheel={e => e.currentTarget.blur()} />
          </FormField>
        </FormModal>
      )}
      {pending && (
        <ConfirmModal title="Delete daily rate?" message={`Remove the daily rate for ${pending.paygrade_name || 'this grade'}?`} confirmLabel="Delete" variant="danger"
          onCancel={() => setPending(null)} onConfirm={handleDelete} />
      )}
    </>
  );
}
