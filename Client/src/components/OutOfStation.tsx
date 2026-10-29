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
import { SearchSelect } from './ui/SearchSelect';
import { DateInput } from './ui/DateInput';
import { RowActions } from './ui/RowActions';
import { ConfirmModal } from './ui/ConfirmModal';
import { GlBlockedModal, type GlImbalance, type InvalidAccount } from './ui/GlBlockedModal';
import { GlFailureCard } from './ui/GlFailureCard';
import { exportReportExcel, reportPdf } from './ui/reportTools';
import { fmtDate as formatDmy, fmtDateTime } from '@/lib/dateFormat';
import { useRealtimeRefresh } from '@/lib/realtime';

// Out of Station allowance: days (start to end, both included, weekends counted) × the daily rate for
// the employee's pay grade. Raised by staff who have people reporting to them — for a subordinate or
// for themselves; staff with no reports cannot raise one. Approved like leave
// (supervisor, then HR), and paid to the employee's account through the GL on HR's approval.
//
// Two menu entries, like Leave:
//   Personal Out of Station — the caller's own requests (raised by them, if they have reports, or by
//                             their supervisor) and their subordinates' (raise on their behalf; give
//                             the supervisor approval).
//   Manage Out of Station   — HR: daily rates, posting settings, the HR approval list, every request
//                             with the printable schedule.

type Request = {
  id: string; request_number: string; employee: string; employee_name: string; employee_code?: string;
  supervisor_id?: string | null; purpose: string; location: string; date_start: string; date_end: string;
  days: number; daily_rate: number; amount: number; paygrade_name?: string; account_no?: string; branch?: string;
  status: string; rejection_reason?: string | null; document_ref?: string | null; payment_log?: string | null;
  requested_by?: string | null; requested_by_name?: string | null; submitted_at?: string | null;
  approved_at?: string | null; posted_at?: string | null; updated_at?: string | null; created_at?: string;
};
type Employee = { id: string; employee_name: string; employee_code?: string; paygrade_name?: string; is_self?: boolean; is_report?: boolean };
type Rate = { paygrade_id: string; paygrade_name: string; daily_rate: number | null };
type GlBlock = { accounts: InvalidAccount[] | null; imbalance: GlImbalance | null } | null;

// Same palette as Leave's status pills, plus the GL outcomes.
const STATUS_PILL: Record<string, string> = {
  Draft:                 'bg-slate-100 border border-slate-200 text-slate-500',
  'Pending Approval':    'bg-amber-500/10 text-amber-700 border border-amber-200/50',
  'Pending HR Approval': 'bg-purple-500/10 text-purple-700 border border-purple-200/50',
  Approved:              'pill-success',
  Paid:                  'pill-success',
  'GL Failed':           'bg-red-500/10 text-red-700 border border-red-200/50',
  Rejected:              'pill-danger',
  Cancelled:             'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-muted)]',
};
function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_PILL[status] ?? ''}`}>{status}</span>;
}

const OPEN = ['Draft', 'Pending Approval', 'Pending HR Approval'];
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
    employee: initial?.employee ? String(initial.employee) : (employees.length === 1 ? String(employees[0].id) : ''),
    location: initial?.location ?? '', purpose: initial?.purpose ?? '',
    date_start: day(initial?.date_start), date_end: day(initial?.date_end),
  });
  const [quote, setQuote] = useState<{ days: number; daily_rate: number; amount: number; paygrade_name?: string } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));

  // Days × rate comes from the server: the rate belongs to the employee's pay grade.
  useEffect(() => {
    setQuote(null); setQuoteError('');
    if (!form.employee || !form.date_start || !form.date_end || form.date_end < form.date_start) return;
    const t = setTimeout(() => {
      api.post('/out-of-station/quote', { employee: form.employee, date_start: form.date_start, date_end: form.date_end })
        .then(r => setQuote(r.data?.data ?? null))
        .catch(e => setQuoteError(e.response?.data?.message || 'Could not work out the allowance'));
    }, 300);
    return () => clearTimeout(t);
  }, [form.employee, form.date_start, form.date_end]);

  const save = async (submit: boolean) => {
    if (saving) return;
    if (!form.employee) return toast.error('Select the employee');
    if (!form.location.trim()) return toast.error('Location is required');
    if (!form.date_start || !form.date_end) return toast.error('Start and end dates are required');
    if (!form.purpose.trim()) return toast.error('Purpose is required');
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/out-of-station/requests/${initial.id}`, form);
        if (submit) await api.post(`/out-of-station/requests/${initial.id}/submit`);
        toast.success(submit ? 'Request submitted for approval' : 'Request updated');
      } else {
        const res = await api.post('/out-of-station/requests', { ...form, submit });
        toast.success(res.data?.message || 'Request saved');
      }
      onSaved(); onClose();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save the request'); }
    finally { setSaving(false); }
  };

  const options = employees.map(e => ({ id: String(e.id), label: `${e.employee_name}${e.employee_code ? ` (${e.employee_code})` : ''}` }));

  return (
    <FormModal
      title={title} subtitle={subtitle}
      onClose={onClose} onSave={() => save(true)} saveLabel={saving ? 'Saving…' : 'Submit'}
      secondaryAction={{ label: 'Save as Draft', onClick: () => save(false) }}
      maxWidth="lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {employees.length > 1 && (
          <FormField label="Employee" required className="col-span-full">
            <SearchSelect value={form.employee} onChange={v => set('employee', v)} options={options} placeholder="Search employee…" disabled={!!initial} />
          </FormField>
        )}
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

        {form.date_start && form.date_end && (
          form.date_end < form.date_start ? (
            <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">
              End date must be on or after start date.
            </div>
          ) : quoteError ? (
            <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">{quoteError}</div>
          ) : (
            <div className="col-span-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                  {quote ? `${quote.days} day${quote.days !== 1 ? 's' : ''} × ${amt(quote.daily_rate)}` : 'Working out the allowance…'}
                  <span className="ml-2 text-[11px] font-normal text-[var(--text-muted)]">weekends included</span>
                </span>
                {quote && <span className="text-[13px] font-bold tabular-nums text-[var(--success)]">{money(quote.amount)}</span>}
              </div>
              {quote?.paygrade_name && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Daily rate for grade {quote.paygrade_name}</p>}
            </div>
          )
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
  useEffect(() => {
    if (!request) return;
    api.get(`/out-of-station/requests/${request.id}/history`).then(r => setHistory(r.data?.data ?? [])).catch(() => setHistory([]));
  }, [request?.id, request?.status]);
  const r = request;
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
              <DetailField label="Raised by" value={r.requested_by_name || r.employee_name} />
              <DetailField label="Submitted" value={r.submitted_at ? fmtDateTime(r.submitted_at, '') : '—'} />
              <DetailField label="Paid" value={r.posted_at ? fmtDateTime(r.posted_at, '') : '—'} />
            </DetailGrid>
          </DetailSection>

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
                <td className="td"><StatusPill status={row.status} /></td>
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
const PERSONAL_TABS = ['All my Requests', 'Approved Requests', 'Pending Requests', 'Subordinate Requests'] as const;

export function PersonalOutOfStation() {
  const me = useUser();
  const [activeTab, setActiveTab] = useState<string>('All my Requests');
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState<{ initial: Request | null; forTeam: boolean } | null>(null);
  const [viewRow, setViewRow] = useState<Request | null>(null);

  useEffect(() => {
    api.get('/out-of-station/employees', { params: { scope: 'personal' } }).then(r => setEmployees(r.data?.data ?? [])).catch(() => setEmployees([]));
  }, []);
  // The server lists the caller only when they have people reporting to them.
  const self = employees.filter(e => e.is_self);
  const reports = employees.filter(e => e.is_report);
  const TABS = PERSONAL_TABS.filter(t => t !== 'Subordinate Requests' || reports.length > 0);

  const load = useCallback(() => {
    setLoading(true);
    const scope = activeTab === 'Subordinate Requests' ? 'team' : 'mine';
    api.get('/out-of-station/requests', { params: { scope } })
      .then(r => {
        let list: Request[] = r.data?.data ?? [];
        if (activeTab === 'All my Requests' || activeTab === 'Approved Requests' || activeTab === 'Pending Requests') {
          list = list.filter(x => String(x.employee) === me.employeeId || !me.employeeId);
        }
        if (activeTab === 'Approved Requests') list = list.filter(x => ['Approved', 'Paid'].includes(x.status));
        if (activeTab === 'Pending Requests')  list = list.filter(x => OPEN.includes(x.status));
        setRows(list);
      })
      .catch(() => toast.error('Failed to load requests'))
      .finally(() => setLoading(false));
  }, [activeTab, me.employeeId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh('outofstation', load);

  const act = useRequestActions(() => { load(); setViewRow(null); });
  const filtered = rows.filter(r => JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase()));
  const isSubTab = activeTab === 'Subordinate Requests';
  // Owner of a draft/open request: whoever raised it. An employee whose supervisor raised it only views it.
  const owns = (r: Request) => String(r.requested_by ?? '') === me.userId;
  // Supervisor approval: a report's request waiting at the supervisor stage.
  const decides = (r: Request) => isSubTab && r.status === 'Pending Approval' && String(r.employee) !== me.employeeId;

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full">
      <PageHeader title="Out of Station" subtitle="Request the out-of-station allowance for your subordinates or yourself, and approve your subordinates' requests." />

      <TabBar tabs={[...TABS]} activeTab={activeTab} onChange={setActiveTab} />

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden min-h-[500px] flex flex-col">
        <TableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search requests..."
          searchWidth="sm:w-[280px]"
          actions={isSubTab ? (
            <button className="primary-btn shrink-0" onClick={() => setForm({ initial: null, forTeam: true })}>Request for Subordinate</button>
          ) : activeTab !== 'Approved Requests' && self.length > 0 ? (
            <button className="primary-btn shrink-0" onClick={() => setForm({ initial: null, forTeam: false })}>Apply Out of Station</button>
          ) : undefined}
        />
        <RequestTable
          rows={filtered} loading={loading} showEmployee={isSubTab}
          empty={isSubTab ? 'No requests for your subordinates yet.' : self.length > 0 ? 'No out-of-station requests found.' : 'No out-of-station requests found. Your supervisor raises them on your behalf.'}
          actions={r => [
            { label: 'View', icon: Eye, onClick: () => setViewRow(r) },
            { label: 'Approve', icon: Check, onClick: () => act.approve(r), hidden: !decides(r) },
            { label: 'Reject', icon: XCircle, danger: true, onClick: () => act.openReject(r), hidden: !decides(r) },
            { label: 'Submit for Approval', icon: SendHorizonal, onClick: () => act.submit(r), hidden: r.status !== 'Draft' || !owns(r) },
            { label: 'Edit', icon: FileEdit, onClick: () => setForm({ initial: r, forTeam: isSubTab }), hidden: r.status !== 'Draft' || !owns(r) },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => act.remove(r), hidden: r.status !== 'Draft' || !owns(r) },
            { label: 'Cancel Request', icon: XCircle, danger: true, onClick: () => act.cancel(r), hidden: !OPEN.includes(r.status) || r.status === 'Draft' || !owns(r) },
          ]}
        />
      </div>

      {form && (
        <RequestForm
          initial={form.initial}
          employees={form.initial ? employees : (form.forTeam ? reports : self)}
          title={form.initial ? `Edit ${form.initial.request_number}` : form.forTeam ? 'Request for Subordinate' : 'Apply for Out of Station'}
          subtitle="Paid as days × the daily rate for the employee's grade."
          onClose={() => setForm(null)} onSaved={load} />
      )}

      <RequestDetail
        request={viewRow} canRetry={false} retrying={false} onRetry={() => {}} onClose={() => setViewRow(null)}
        footerActions={viewRow && decides(viewRow) ? (
          <>
            <button className="secondary-btn shadow-sm text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5" onClick={() => act.openReject(viewRow)}>
              <X size={14} className="mr-1.5 inline" />Reject
            </button>
            <button className="primary-btn shadow-sm bg-[var(--success)] hover:opacity-90" onClick={() => act.approve(viewRow)}>
              <Check size={14} className="mr-1.5 inline" />Approve
            </button>
          </>
        ) : undefined}
      />
      {act.modals}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANAGE OUT OF STATION
// ══════════════════════════════════════════════════════════════════════════════
const MANAGE_STATUSES = ['All', 'Pending Approval', 'Pending HR Approval', 'Approved', 'Paid', 'GL Failed', 'Rejected', 'Cancelled'];

export function ManageOutOfStation() {
  const me = useUser();
  const MAIN_TABS = [
    ...(me.canManage ? ['Daily Rates'] : []),
    ...(me.canViewAll ? ['All Requests'] : []),
    ...(me.isHr ? ['Approval List'] : []),
  ];
  const [activeTab, setActiveTab] = useState<string>(MAIN_TABS[0] ?? '');

  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Out of Station Setup" subtitle="Set daily rates, approve requests and download the allowance schedule. Posting and approval controls are in Settings → Controls." />
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
      // HR's list is the HR stage only; the supervisor stage is handled under Personal → Subordinate Requests.
      ? api.get('/out-of-station/approvals').then(r => (r.data?.data ?? []).filter((x: Request) => x.status === 'Pending HR Approval'))
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
  const decides = (r: Request) => approvals && r.status === 'Pending HR Approval' && String(r.employee) !== me.employeeId;

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
        empty={approvals ? 'No requests waiting for HR approval.' : 'No requests found.'}
        actions={r => [
          { label: 'View', icon: Eye, onClick: () => setViewRow(r) },
          { label: 'Approve', icon: Check, onClick: () => act.approve(r), hidden: !decides(r) },
          { label: 'Reject', icon: XCircle, danger: true, onClick: () => act.openReject(r), hidden: !decides(r) },
          { label: 'Retry GL Posting', icon: RefreshCw, danger: true, onClick: () => act.retry(r), hidden: r.status !== 'GL Failed' || !hrActions },
          { label: 'Post to GL', icon: CheckCircle2, onClick: () => act.postGl(r), hidden: r.status !== 'Approved' || !hrActions },
          { label: 'Cancel Request', icon: XCircle, danger: true, onClick: () => act.cancel(r), hidden: approvals || !['Approved', 'GL Failed', ...OPEN].includes(r.status) || !hrActions },
        ]}
      />

      {form !== undefined && (
        <RequestForm initial={form} employees={employees} title="New Out of Station Request" subtitle="Raise a request on behalf of any employee."
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
              <Check size={14} className="mr-1.5 inline" />Approve
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
