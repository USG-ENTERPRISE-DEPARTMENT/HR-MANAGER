import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, CheckCircle2, Download, Eye, FileEdit, FileSpreadsheet, MapPin, Plus, RefreshCw, Save, Send, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { PageHeader } from './ui/PageHeader';
import { TabBar } from './ui/TabBar';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect } from './ui/SearchSelect';
import { DateInput } from './ui/DateInput';
import { Select } from './ui/Select';
import { RowActions } from './ui/RowActions';
import { ConfirmModal } from './ui/ConfirmModal';
import { GlBlockedModal, type GlImbalance, type InvalidAccount } from './ui/GlBlockedModal';
import { GlFailureCard } from './ui/GlFailureCard';
import { exportReportExcel, fmtAmt, reportPdf } from './ui/reportTools';
import { fmtDate, fmtDateTime } from '@/lib/dateFormat';
import { useRealtimeRefresh } from '@/lib/realtime';

// Out of Station allowance: days (start to end, both included, weekends counted) × the daily rate for
// the employee's pay grade. Raised by the employee or their supervisor, approved like leave
// (supervisor, then HR), and paid to the employee's account through the GL on HR's approval.

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
type Settings = { oos_expense_gl: string; oos_gl_branch: string; oos_supervisor_approval: string; oos_payments_enabled: string };
type GlBlock = { accounts: InvalidAccount[] | null; imbalance: GlImbalance | null } | null;

const STATUSES = ['All', 'Draft', 'Pending Approval', 'Pending HR Approval', 'Approved', 'Paid', 'GL Failed', 'Rejected', 'Cancelled'];
const OPEN = ['Draft', 'Pending Approval', 'Pending HR Approval'];

function statusClass(status: string) {
  if (status === 'Paid' || status === 'Approved') return 'pill-success';
  if (status === 'Rejected' || status === 'Cancelled' || status === 'GL Failed') return 'pill-danger';
  if (status === 'Draft') return 'pill-accent';
  return 'pill-warning';
}
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
const period = (r: Request) => `${fmtDate(r.date_start, '')} – ${fmtDate(r.date_end, '')}`;
const daysBetween = (a: string, b: string) => {
  const s = Date.parse(`${a}T00:00:00Z`), e = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s ? Math.round((e - s) / 86400000) + 1 : 0;
};

/** Run an action and surface a GL block (bad accounts / imbalance) when the server reports one. */
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

// ── Request form ──────────────────────────────────────────────────────────────
function RequestForm({ initial, employees, onClose, onSaved }: {
  initial: Request | null; employees: Employee[]; onClose: () => void; onSaved: () => void;
}) {
  const self = employees.find(e => e.is_self);
  const [form, setForm] = useState({
    employee: initial?.employee ? String(initial.employee) : (self?.id ?? employees[0]?.id ?? ''),
    purpose: initial?.purpose ?? '', location: initial?.location ?? '',
    date_start: day(initial?.date_start), date_end: day(initial?.date_end),
  });
  const [quote, setQuote] = useState<{ days: number; daily_rate: number; amount: number; paygrade_name?: string } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));

  // Ask the server for days × rate whenever the employee or dates change: the rate lives with the
  // employee's pay grade, so the form never calculates its own.
  useEffect(() => {
    setQuote(null); setQuoteError('');
    if (!form.employee || !form.date_start || !form.date_end) return;
    if (form.date_end < form.date_start) { setQuoteError('The end date is before the start date'); return; }
    const t = setTimeout(() => {
      api.post('/out-of-station/quote', { employee: form.employee, date_start: form.date_start, date_end: form.date_end })
        .then(r => setQuote(r.data?.data ?? null))
        .catch(e => setQuoteError(e.response?.data?.message || 'Could not work out the amount'));
    }, 300);
    return () => clearTimeout(t);
  }, [form.employee, form.date_start, form.date_end]);

  const save = async (submit: boolean) => {
    if (!form.employee) return toast.error('Choose the employee');
    if (!form.purpose.trim()) return toast.error('Enter the purpose of the assignment');
    if (!form.location.trim()) return toast.error('Enter the location');
    if (!form.date_start || !form.date_end) return toast.error('Enter the start and end dates');
    setSaving(true);
    try {
      if (initial) {
        await api.put(`/out-of-station/requests/${initial.id}`, form);
        if (submit) await api.post(`/out-of-station/requests/${initial.id}/submit`);
        toast.success(submit ? 'Request submitted for approval' : 'Draft updated');
      } else {
        const res = await api.post('/out-of-station/requests', { ...form, submit });
        toast.success(res.data?.message || 'Request saved');
      }
      onSaved(); onClose();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save the request'); }
    finally { setSaving(false); }
  };

  const employeeOptions = employees.map(e => ({ id: String(e.id), label: `${e.employee_name}${e.employee_code ? ` (${e.employee_code})` : ''}${e.is_self ? ' — me' : ''}` }));

  return (
    <FormModal
      title={initial ? `Edit ${initial.request_number}` : 'New Out of Station Request'}
      subtitle="Paid as days × the daily rate for the employee's grade. Weekends are counted."
      onClose={onClose} onSave={() => save(true)} saveLabel={saving ? 'Saving…' : 'Submit for Approval'}
      secondaryAction={{ label: 'Save Draft', onClick: () => { if (!saving) save(false); } }}
      maxWidth="2xl" scrollable>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="Employee" required>
            {employeeOptions.length > 1
              ? <SearchSelect value={form.employee} onChange={v => set('employee', v)} options={employeeOptions} placeholder="Select employee…" disabled={!!initial} />
              : <input className={inputClass} value={employeeOptions[0]?.label ?? 'No employee record is linked to your account'} disabled />}
          </FormField>
        </div>
        <FormField label="Location" required><input id="oos-location" className={inputClass} value={form.location} maxLength={150} onChange={e => set('location', e.target.value)} placeholder="e.g. Makeni" /></FormField>
        <div />
        <FormField label="Start date" required><DateInput className={inputClass} value={form.date_start} onChange={e => set('date_start', e.target.value)} /></FormField>
        <FormField label="End date" required><DateInput className={inputClass} value={form.date_end} onChange={e => set('date_end', e.target.value)} /></FormField>
        <div className="sm:col-span-2">
          <FormField label="Purpose" required>
            <CountedTextarea className={`${inputClass} resize-none`} rows={2} maxChars={255} value={form.purpose} onChange={e => set('purpose', e.target.value)} placeholder="e.g. Relief duties at the Makeni branch" />
          </FormField>
        </div>
      </div>
      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
        {quoteError ? <p className="text-sm text-[var(--danger,#dc2626)]">{quoteError}</p>
          : quote ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[['Days', String(quote.days)], ['Grade', quote.paygrade_name || '—'], ['Daily rate', fmtAmt(quote.daily_rate)], ['Allowance', fmtAmt(quote.amount)]].map(([label, value]) => (
                <div key={label}><p className="text-[10px] font-bold uppercase text-[var(--text-muted)]">{label}</p><p className={`mt-1 text-sm font-semibold tabular-nums ${label === 'Allowance' ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{value}</p></div>
              ))}
            </div>
          ) : <p className="text-sm text-[var(--text-muted)]">{form.date_start && form.date_end ? 'Working out the amount…' : 'Enter the dates to see the days and the allowance.'}</p>}
      </div>
    </FormModal>
  );
}

// ── Reason prompt (reject / cancel) ───────────────────────────────────────────
function ReasonModal({ title, label, required, onClose, onConfirm }: {
  title: string; label: string; required: boolean; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <FormModal title={title} onClose={onClose} saveLabel="Confirm" maxWidth="md"
      onSave={() => { if (required && !reason.trim()) { toast.error('Enter a reason'); return; } onConfirm(reason.trim()); }}>
      <FormField label={label} required={required}>
        <CountedTextarea id="oos-reason" className={`${inputClass} resize-none`} rows={3} maxChars={500} value={reason} onChange={e => setReason(e.target.value)} />
      </FormField>
    </FormModal>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────
function RequestDetail({ request, canRetry, onRetry, retrying, onClose }: {
  request: Request; canRetry: boolean; onRetry: () => void; retrying: boolean; onClose: () => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    api.get(`/out-of-station/requests/${request.id}/history`).then(r => setHistory(r.data?.data ?? [])).catch(() => setHistory([]));
  }, [request.id, request.status]);
  const facts: [string, string][] = [
    ['Employee', `${request.employee_name}${request.employee_code ? ` (${request.employee_code})` : ''}`],
    ['Location', request.location], ['Period', period(request)], ['Days', String(request.days)],
    ['Grade', request.paygrade_name || '—'], ['Daily rate', fmtAmt(Number(request.daily_rate))],
    ['Allowance', fmtAmt(Number(request.amount))], ['Status', request.status],
    ['Account', request.account_no || '—'], ['Branch', request.branch || '—'],
    ['Raised by', request.requested_by_name || '—'], ['GL reference', request.document_ref || '—'],
  ];
  return (
    <FormModal title={request.request_number} subtitle={`${request.employee_name} · ${request.location}`} onClose={onClose} onSave={() => {}} readOnly maxWidth="3xl" scrollable>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 rounded-xl bg-[var(--bg)] p-4 sm:grid-cols-4">
          {facts.map(([label, value]) => <div key={label} className="min-w-0"><p className="text-[10px] font-bold uppercase text-[var(--text-muted)]">{label}</p><p className="mt-1 break-words text-sm font-semibold text-[var(--text-primary)] tabular-nums">{value}</p></div>)}
        </div>
        <div><h4 className="mb-1 text-xs font-bold uppercase text-[var(--text-muted)]">Purpose</h4><p className="text-sm">{request.purpose}</p></div>
        {request.rejection_reason && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-xs font-bold uppercase text-red-600">{request.status === 'Cancelled' ? 'Cancellation reason' : 'Rejection reason'}</p>
            <p className="mt-1 text-sm text-red-800">{request.rejection_reason}</p>
          </div>
        )}
        {request.status === 'GL Failed' && (
          <GlFailureCard paymentLog={request.payment_log} failedAt={request.updated_at} runName={request.request_number} canRetry={canRetry} retrying={retrying} onRetry={onRetry} />
        )}
        <div>
          <h4 className="mb-2 text-sm font-bold">History</h4>
          {!history.length ? <p className="text-sm text-[var(--text-muted)]">No history recorded.</p> : (
            <ol className="space-y-2">
              {history.map(h => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
                  <div className="min-w-0"><p className="text-sm font-semibold">{h.action}</p><p className="text-xs text-[var(--text-muted)]">{h.user_full_name || h.user_name || 'System'}</p></div>
                  <span className="text-xs text-[var(--text-muted)]">{fmtDateTime(h.created_at, '')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </FormModal>
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function SetupPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/out-of-station/settings').then(r => setSettings(r.data?.data ?? null)).catch(() => toast.error('Failed to load settings'));
    api.get('/out-of-station/rates').then(r => {
      const list: Rate[] = r.data?.data ?? [];
      setRates(list);
      setDraft(Object.fromEntries(list.map(x => [String(x.paygrade_id), x.daily_rate == null ? '' : String(x.daily_rate)])));
    }).catch(() => toast.error('Failed to load daily rates'));
  }, []);
  useEffect(load, [load]);

  const saveSettings = async () => {
    if (!settings) return;
    setBusy(true);
    try { await api.put('/out-of-station/settings', settings); toast.success('Settings saved'); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save settings'); }
    finally { setBusy(false); }
  };
  const saveRates = async () => {
    const changed = rates.filter(r => (r.daily_rate == null ? '' : String(r.daily_rate)) !== (draft[String(r.paygrade_id)] ?? ''));
    if (!changed.length) return toast.info('No rate changes to save');
    setBusy(true);
    try {
      await api.put('/out-of-station/rates', { rates: changed.map(r => ({ paygrade_id: r.paygrade_id, daily_rate: draft[String(r.paygrade_id)] })) });
      toast.success(`${changed.length} daily rate${changed.length === 1 ? '' : 's'} saved`);
      load();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save rates'); }
    finally { setBusy(false); }
  };

  if (!settings) return <p className="p-6 text-sm text-[var(--text-muted)]">Loading setup…</p>;
  const set = (k: keyof Settings, v: string) => setSettings(s => (s ? { ...s, [k]: v } : s));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Posting and approval</h3>
        <p className="mb-4 mt-1 text-xs text-[var(--text-muted)]">On HR's approval the allowance is posted: debit the expense account, credit the employee's bank account.</p>
        <div className="grid gap-4">
          <FormField label="Out of Station expense GL account" required><input id="oos-expense-gl" className={inputClass} value={settings.oos_expense_gl} onChange={e => set('oos_expense_gl', e.target.value)} placeholder="e.g. 124500000000" /></FormField>
          <FormField label="Posting branch"><input id="oos-branch" className={inputClass} value={settings.oos_gl_branch} onChange={e => set('oos_gl_branch', e.target.value)} placeholder="Blank uses the GL connection's default branch" /></FormField>
          <FormField label="Supervisor approval before HR">
            <Select className={inputClass} value={settings.oos_supervisor_approval} onChange={e => set('oos_supervisor_approval', e.target.value)}>
              <option value="Yes">Yes — supervisor, then HR</option><option value="No">No — HR only</option>
            </Select>
          </FormField>
          <FormField label="Post to the GL on approval">
            <Select className={inputClass} value={settings.oos_payments_enabled} onChange={e => set('oos_payments_enabled', e.target.value)}>
              <option value="Yes">Yes — pay the employee through the GL</option><option value="No">No — record only</option>
            </Select>
          </FormField>
          <div className="flex justify-end"><button className="primary-btn" onClick={saveSettings} disabled={busy}><Save size={14} />Save Settings</button></div>
        </div>
      </section>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Daily rate by grade</h3>
        <p className="mb-4 mt-1 text-xs text-[var(--text-muted)]">Employees on a grade with no rate can't raise a request. Clear a rate to remove it.</p>
        <div className="max-h-[55vh] overflow-auto rounded-xl border border-[var(--border)]">
          <table className="w-full border-collapse">
            <thead><tr><th className="th">Grade</th><th className="th text-right">Daily rate</th></tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {!rates.length ? <tr><td colSpan={2} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No pay grades found. Set them up in Salary first.</td></tr>
                : rates.map(r => (
                  <tr key={r.paygrade_id}>
                    <td className="px-4 py-2 text-sm">{r.paygrade_name || `Grade ${r.paygrade_id}`}</td>
                    <td className="px-4 py-2"><input id={`oos-rate-${r.paygrade_id}`} type="number" min="0" step="0.01" className={`${inputClass} ml-auto w-36 text-right tabular-nums`} value={draft[String(r.paygrade_id)] ?? ''} onChange={e => setDraft(d => ({ ...d, [String(r.paygrade_id)]: e.target.value }))} placeholder="Not set" /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-end"><button className="primary-btn" onClick={saveRates} disabled={busy}><Save size={14} />Save Rates</button></div>
      </section>
    </div>
  );
}

// ── Pages ─────────────────────────────────────────────────────────────────────
// Two menu entries, like Leave:
//   Personal Out of Station — the caller's own requests, and (for supervisors) their direct reports'
//                             requests: raise on their behalf and give the supervisor approval.
//   Manage Out of Station   — HR: final approvals, every request with the printable schedule, setup.
type Mode = 'personal' | 'manage';

export function PersonalOutOfStation() { return <OutOfStationPage mode="personal" />; }
export function ManageOutOfStation()   { return <OutOfStationPage mode="manage" />; }

function OutOfStationPage({ mode }: { mode: Mode }) {
  const user = getCurrentUser();
  const myUserId = user?.id != null ? String(user.id) : '';
  const can = (p: string) => user?.resolvedPermissions?.has(p) || false;
  const isAdmin = user?.allRoles?.some(r => ['admin', 'super-admin'].includes(r.name)) ?? false;
  const canManage = isAdmin || can('manage_out_of_station');
  const isHr = isAdmin || can('approve_out_of_station');
  const canViewAll = canManage || isHr || can('view_out_of_station');

  // Personal: the caller plus their direct reports. Manage: everyone (for HR setup).
  const [employees, setEmployees] = useState<Employee[]>([]);
  const hasTeam = employees.some(e => e.is_report);
  const tabs = useMemo(() => mode === 'personal'
    ? ['My Requests', ...(hasTeam ? ['Team Requests'] : [])]
    : [...(isHr ? ['Approvals'] : []), ...(canViewAll ? ['All Requests'] : []), ...(canManage ? ['Setup'] : [])],
  [mode, hasTeam, isHr, canViewAll, canManage]);
  const [tab, setTab] = useState(tabs[0] ?? 'My Requests');
  useEffect(() => { if (!tabs.includes(tab)) setTab(tabs[0] ?? 'My Requests'); }, [tabs, tab]);

  const [rows, setRows] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [form, setForm] = useState<Request | null | undefined>(undefined);
  const [detail, setDetail] = useState<Request | null>(null);
  const [reasonFor, setReasonFor] = useState<{ row: Request; kind: 'reject' | 'cancel' } | null>(null);
  const [deleting, setDeleting] = useState<Request | null>(null);
  const [glBlock, setGlBlock] = useState<GlBlock>(null);
  const [retrying, setRetrying] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    api.get('/out-of-station/employees', { params: mode === 'personal' ? { scope: 'personal' } : {} })
      .then(r => setEmployees(r.data?.data ?? [])).catch(() => setEmployees([]));
  }, [mode]);

  const load = useCallback((silent = false) => {
    if (tab === 'Setup') return;
    if (!silent) setLoading(true);
    const req = tab === 'Approvals'
      // HR's queue is the HR tier only; supervisor-tier approvals live under Personal → Team Requests.
      ? api.get('/out-of-station/approvals').then(r => ({ data: { data: (r.data?.data ?? []).filter((x: Request) => x.status === 'Pending HR Approval') } }))
      : api.get('/out-of-station/requests', { params: {
          scope: tab === 'Team Requests' ? 'team' : tab === 'All Requests' ? 'all' : 'mine',
          ...(tab === 'All Requests' && from ? { from } : {}), ...(tab === 'All Requests' && to ? { to } : {}),
        } });
    req.then((r: any) => setRows(r.data?.data ?? []))
      .catch((e: any) => { if (!silent) toast.error(e.response?.data?.message || 'Failed to load requests'); })
      .finally(() => setLoading(false));
  }, [tab, from, to]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh('outofstation', () => load(true));
  useEffect(() => { setStatus('All'); setSearch(''); }, [tab]);

  const filtered = useMemo(() => rows.filter(r =>
    (status === 'All' || r.status === status)
    && `${r.request_number} ${r.employee_name} ${r.employee_code ?? ''} ${r.location} ${r.purpose}`.toLowerCase().includes(search.toLowerCase())
  ), [rows, status, search]);
  const awaitingMe = tab === 'Team Requests' ? rows.filter(r => r.status === 'Pending Approval').length : 0;

  const reload = () => load();
  const act = async (path: string, body: any, ok: string) => {
    const done = await runAction(() => api.post(path, body), setGlBlock, ok);
    if (done) { reload(); setDetail(null); }
    return done;
  };
  const retry = async (row: Request) => {
    setRetrying(true);
    await act(`/out-of-station/requests/${row.id}/retry-gl`, {}, 'Posted');
    setRetrying(false);
  };

  // Who may edit, submit, delete or cancel a draft/open request: the employee (My Requests), whoever
  // raised it, or HR setup in Manage. Matches the server's isOwner check.
  const ownsRow = (r: Request) => tab === 'My Requests'
    || String(r.requested_by ?? '') === myUserId
    || (mode === 'manage' && canManage);
  // Approve/reject: HR's queue, or a supervisor on their report's request at the supervisor tier.
  const mayDecide = (r: Request) => tab === 'Approvals' || (tab === 'Team Requests' && r.status === 'Pending Approval');

  // The schedule as the Bank prints it: name, days, rate, net, account and branch, with a total.
  const scheduleRows = filtered.filter(r => ['Approved', 'Paid', 'GL Failed'].includes(r.status));
  const scheduleHeaders = ['Name', 'Period', 'No. of Days', 'Rate', 'Net', 'A/C No.', 'Branch'];
  const scheduleData = () => {
    const body = scheduleRows.map(r => [r.employee_name, period(r), r.days, fmtAmt(Number(r.daily_rate)), fmtAmt(Number(r.amount)), r.account_no || '', r.branch || '']);
    const total = scheduleRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    return [...body, ['Total', '', scheduleRows.reduce((n, r) => n + Number(r.days || 0), 0), '', fmtAmt(total), '', '']];
  };
  const scheduleTitle = 'Out of Station Allowance Schedule';
  const scheduleSummary = `${from || to ? `${from ? fmtDate(from, '') : '…'} to ${to ? fmtDate(to, '') : '…'}` : 'All dates'} · Approved and paid requests`;

  const showEmployeeCol = tab !== 'My Requests';
  const cols = ['Request', ...(showEmployeeCol ? ['Employee'] : []), 'Location', 'Period', 'Days', 'Allowance', 'Status'];
  // New Request: personal → for yourself (or a report, in Team Requests); manage → anyone, for HR setup.
  const canRaise = mode === 'personal' ? employees.length > 0 : canManage && employees.length > 0;
  const formEmployees = mode === 'manage' ? employees
    : tab === 'Team Requests' ? employees.filter(e => e.is_report)
    : employees.filter(e => e.is_self);

  const emptyText = tab === 'My Requests' ? 'You have no out-of-station requests. Use New Request to raise one.'
    : tab === 'Team Requests' ? 'None of your direct reports has an out-of-station request.'
    : tab === 'Approvals' ? 'Nothing is waiting for HR approval.'
    : 'No requests found.';

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={mode === 'personal' ? 'Personal Out of Station' : 'Manage Out of Station'}
          subtitle={mode === 'personal'
            ? 'Request the allowance for duty away from your station, and handle your team’s requests.'
            : 'Approve out-of-station requests, download the allowance schedule, and set rates and GL accounts.'} />
        {canRaise && tab !== 'Setup' && (formEmployees.length > 0) &&
          <button className="primary-btn" onClick={() => setForm(null)}><Plus size={15} />{tab === 'Team Requests' ? 'Request for a Team Member' : 'New Request'}</button>}
      </div>

      {tabs.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-muted)]">You don't have access to manage out-of-station requests.</div>
      ) : <>
      <TabBar tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === 'Setup' ? <SetupPanel /> : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
            {tab === 'Approvals'
              ? <p className="text-sm text-[var(--text-muted)]">{filtered.length ? `${filtered.length} request${filtered.length === 1 ? '' : 's'} waiting for HR approval` : 'Nothing waiting for HR approval'}</p>
              : <div className="flex flex-wrap gap-2">{STATUSES.map(s => (
                  <button key={s} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === s ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border)] text-[var(--text-muted)]'}`} onClick={() => setStatus(s)}>
                    {s}{s === 'Pending Approval' && awaitingMe > 0 ? ` (${awaitingMe})` : ''}
                  </button>
                ))}</div>}
            <div className="flex flex-wrap items-center gap-2">
              {tab === 'All Requests' && <>
                <DateInput className={`${inputClass} w-40`} value={from} onChange={e => setFrom(e.target.value)} />
                <span className="text-xs text-[var(--text-muted)]">to</span>
                <DateInput className={`${inputClass} w-40`} value={to} onChange={e => setTo(e.target.value)} />
              </>}
              <input id="oos-search" className={`${inputClass} w-52`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests…" />
              <button className="secondary-btn" onClick={reload} title="Refresh"><RefreshCw size={15} /></button>
            </div>
          </div>

          {tab === 'Team Requests' && awaitingMe > 0 && (
            <div className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-xs text-[var(--text-muted)]">
              <span className="font-bold text-[var(--text-primary)]">{awaitingMe}</span> request{awaitingMe === 1 ? '' : 's'} from your team waiting for your approval. Approve or reject from the row menu.
            </div>
          )}

          {tab === 'All Requests' && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-3">
              <p className="text-xs text-[var(--text-muted)]">Schedule: <span className="font-bold text-[var(--text-primary)]">{scheduleRows.length}</span> approved or paid request{scheduleRows.length === 1 ? '' : 's'} · <span className="font-bold text-[var(--text-primary)] tabular-nums">{fmtAmt(scheduleRows.reduce((s, r) => s + Number(r.amount || 0), 0))}</span></p>
              <div className="flex gap-2">
                <button className="secondary-btn !py-1.5 !px-3 !text-[12px]" disabled={!scheduleRows.length} onClick={() => exportReportExcel(scheduleTitle, scheduleSummary, scheduleHeaders, scheduleData())}><FileSpreadsheet size={13} />Export Excel</button>
                <button className="secondary-btn !py-1.5 !px-3 !text-[12px]" disabled={!scheduleRows.length || pdfBusy} onClick={() => reportPdf(scheduleTitle, scheduleSummary, scheduleHeaders, scheduleData(), setPdfBusy)}><Download size={13} />{pdfBusy ? 'Generating…' : 'Download Schedule'}</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>{cols.map(c => <th key={c} className={`th ${['Days', 'Allowance'].includes(c) ? 'text-right' : ''}`}>{c}</th>)}<th className="th text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {loading ? <tr><td colSpan={cols.length + 1} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Loading requests…</td></tr>
                  : !filtered.length ? <tr><td colSpan={cols.length + 1} className="px-4 py-12 text-center"><MapPin className="mx-auto mb-2 text-[var(--text-muted)]" /><p className="text-sm text-[var(--text-muted)]">{emptyText}</p></td></tr>
                    : filtered.map(r => {
                      const owner = ownsRow(r);
                      const decide = mayDecide(r);
                      const hrActions = mode === 'manage' && (isHr || canManage);
                      return (
                        <tr key={r.id} className="hover:bg-[var(--surface-hover)]">
                          <td className="px-4 py-3 text-sm font-bold text-[var(--accent)]"><button className="hover:underline" onClick={() => setDetail(r)}>{r.request_number}</button></td>
                          {showEmployeeCol && <td className="px-4 py-3"><p className="text-sm font-semibold">{r.employee_name}</p><p className="text-xs text-[var(--text-muted)]">{r.employee_code || '—'}</p></td>}
                          <td className="px-4 py-3 text-sm">{r.location}</td>
                          <td className="px-4 py-3 text-sm whitespace-nowrap">{period(r)}</td>
                          <td className="px-4 py-3 text-right text-sm tabular-nums">{r.days}</td>
                          <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">{fmtAmt(Number(r.amount))}</td>
                          <td className="px-4 py-3"><span className={`pill text-[11px] ${statusClass(r.status)}`}>{r.status}</span></td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end">
                              <RowActions actions={[
                                { label: 'View Details', icon: Eye, onClick: () => setDetail(r) },
                                { label: 'Approve', icon: Check, onClick: () => act(`/out-of-station/requests/${r.id}/approve`, {}, 'Approved'), hidden: !decide },
                                { label: 'Reject', icon: XCircle, danger: true, onClick: () => setReasonFor({ row: r, kind: 'reject' }), hidden: !decide },
                                { label: 'Edit', icon: FileEdit, onClick: () => setForm(r), hidden: r.status !== 'Draft' || !owner },
                                { label: 'Submit for Approval', icon: Send, onClick: () => act(`/out-of-station/requests/${r.id}/submit`, {}, 'Submitted'), hidden: r.status !== 'Draft' || !owner },
                                { label: 'Retry GL Posting', icon: RefreshCw, onClick: () => retry(r), hidden: r.status !== 'GL Failed' || !hrActions },
                                { label: 'Post to GL', icon: CheckCircle2, onClick: () => act(`/out-of-station/requests/${r.id}/post`, {}, 'Posted'), hidden: r.status !== 'Approved' || !hrActions },
                                { label: 'Cancel Request', icon: Ban, danger: true, onClick: () => setReasonFor({ row: r, kind: 'cancel' }),
                                  hidden: tab === 'Approvals' || !((OPEN.includes(r.status) && owner) || (['Approved', 'GL Failed'].includes(r.status) && hrActions)) },
                                { label: 'Delete Draft', icon: Trash2, danger: true, onClick: () => setDeleting(r), hidden: r.status !== 'Draft' || !owner },
                              ]} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>}

      {form !== undefined && <RequestForm initial={form} employees={form ? employees : formEmployees} onClose={() => setForm(undefined)} onSaved={reload} />}
      {detail && <RequestDetail request={detail} canRetry={mode === 'manage' && (isHr || canManage)} retrying={retrying} onRetry={() => retry(detail)} onClose={() => setDetail(null)} />}
      {reasonFor && (
        <ReasonModal
          title={reasonFor.kind === 'reject' ? `Reject ${reasonFor.row.request_number}` : `Cancel ${reasonFor.row.request_number}`}
          label={reasonFor.kind === 'reject' ? 'Reason for rejecting' : 'Reason for cancelling (optional)'}
          required={reasonFor.kind === 'reject'}
          onClose={() => setReasonFor(null)}
          onConfirm={async (reason) => {
            const { row, kind } = reasonFor;
            const done = await act(`/out-of-station/requests/${row.id}/${kind}`, { reason }, kind === 'reject' ? 'Rejected' : 'Cancelled');
            if (done) setReasonFor(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmModal title={`Delete ${deleting.request_number}?`} message="The draft is removed permanently." confirmLabel="Delete" variant="danger"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try { await api.delete(`/out-of-station/requests/${deleting.id}`); toast.success('Draft deleted'); reload(); }
            catch (e: any) { toast.error(e.response?.data?.message || 'Failed to delete the draft'); }
            finally { setDeleting(null); }
          }} />
      )}
      <GlBlockedModal isOpen={!!glBlock} accounts={glBlock?.accounts} imbalance={glBlock?.imbalance} context="out-of-station allowance" onClose={() => setGlBlock(null)} />
    </div>
  );
}
