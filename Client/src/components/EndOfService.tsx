import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, FileEdit, Trash2, Check, X, XCircle, RefreshCw, SendHorizonal, Plus, Save, CheckCircle2, Printer, AlertTriangle } from 'lucide-react';
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
import { Select } from './ui/Select';
import { DateInput } from './ui/DateInput';
import { RowActions } from './ui/RowActions';
import { ConfirmModal } from './ui/ConfirmModal';
import { GlBlockedModal, type GlImbalance, type InvalidAccount } from './ui/GlBlockedModal';
import { GlFailureCard } from './ui/GlFailureCard';
import { fmtDate as formatDmy, fmtDateTime } from '@/lib/dateFormat';
import { useRealtimeRefresh } from '@/lib/realtime';

// End of Service Benefit: EOSB = Annual Gross × Years of Service × Days' Pay per Year ÷ 261, with
// the additions the Bank still owes and the deductions the employee owes. HR raises a settlement,
// it walks the approval stages set in Settings → Approvals, and the final approval marks the
// employee as exited and posts it to the GL. The calculation itself is done on the server.

type Line = {
  id?: string; line_type: 'addition' | 'deduction'; item_code: string; description: string;
  basis?: string | null; amount: number | string; gl_account?: string | null;
};
type Stage = { id: string; stage_order: number; stage_name: string; approver_label?: string | null; status: string; acted_at?: string | null; acted_by_name?: string | null; comment?: string | null };
type Settlement = {
  id: string; settlement_number: string; employee: string; employee_name: string; employee_code?: string;
  job_title?: string | null; branch_name?: string | null; exit_reason: string; notified_date?: string | null;
  effective_date: string; hire_date?: string | null; service_years: number; service_months: number; counted_years: number;
  days_per_year: number; divisor: number; annual_gross: number; gross_overridden: boolean; eligible: boolean;
  eosb_amount: number; total_additions: number; total_deductions: number; net_amount: number;
  notice_given: boolean; salary_paid: boolean; leave_paid: boolean; rent_paid: boolean; clothing_paid: boolean;
  account_no?: string | null; branch?: string | null; next_of_kin?: string | null; notes?: string | null;
  status: string; rejection_reason?: string | null; document_ref?: string | null; payment_log?: string | null;
  created_by?: string | null; created_by_name?: string | null; created_by_username?: string | null;
  submitted_at?: string | null; approved_at?: string | null; posted_at?: string | null; exit_applied_at?: string | null;
  updated_at?: string | null; created_at?: string; current_stage?: string | null;
  lines?: Line[]; stages?: Stage[]; can_decide?: boolean;
};
type Quote = {
  eligible: boolean; service_years: number; service_months: number; counted_years: number; days_per_year: number; divisor: number;
  annual_gross: number; computed_gross: number; gross_overridden: boolean; gross_parts: { name: string; amount: number }[];
  eosb_amount: number; monthly_salary: number; hire_date: string | null;
  notice_given: boolean; salary_paid: boolean; leave_paid: boolean;
  checks?: Record<CheckKey, Check>;
  lines: Line[]; warnings: string[]; account_no?: string | null; branch?: string | null;
};
const CHECK_KEYS = ['notice_given', 'salary_paid', 'leave_paid'] as const;
type CheckKey = (typeof CHECK_KEYS)[number];
type Check = { value: boolean; note: string } | null;
type Employee = { id: string; employee_name: string; employee_code?: string; lifecycle_status?: string; open_settlement?: string | null };
type GlBlock = { accounts: InvalidAccount[] | null; imbalance: GlImbalance | null } | null;
type Settings = Record<string, string> & { exit_reasons?: string[] };

const STATUS_PILL: Record<string, string> = {
  Draft:              'bg-slate-100 border border-slate-200 text-slate-500',
  'Pending Approval': 'bg-amber-500/10 text-amber-700 border border-amber-200/50',
  Approved:           'pill-success',
  Paid:               'pill-success',
  'GL Failed':        'bg-red-500/10 text-red-700 border border-red-200/50',
  Rejected:           'pill-danger',
  Cancelled:          'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-muted)]',
};
function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_PILL[status] ?? ''}`}>{status}</span>;
}

const STATUSES = ['All', 'Draft', 'Pending Approval', 'Approved', 'Paid', 'GL Failed', 'Rejected', 'Cancelled'];
// Lines the calculation suggests; loans and other items are entered by HR and kept on a recalculation.
const AUTO_CODES = ['leave_allowance', 'rent_allowance', 'clothing_allowance', 'final_salary', 'notice_pay', 'pf'];
const fmtDate = (v?: string | null) => formatDmy(v);
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
const amt = (n: any) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const service = (y: number, m: number) => `${y} year${y === 1 ? '' : 's'}${m ? `, ${m} month${m === 1 ? '' : 's'}` : ''}`;
function paginate<T>(arr: T[], page: number, size: number): T[] { return arr.slice((page - 1) * size, page * size); }
const sumLines = (lines: Line[], type: Line['line_type']) => lines.filter(l => l.line_type === type).reduce((t, l) => t + (Number(l.amount) || 0), 0);

async function runAction(call: () => Promise<any>, onGlBlock: (b: GlBlock) => void, fallbackOk: string) {
  try {
    const res = await call();
    const body = res.data ?? {};
    const msg: string = body.message || fallbackOk;
    if (body.glError || /failed|switched off|not changed/i.test(msg)) toast.warning(msg);
    else toast.success(msg);
    if (body.glInvalidAccounts?.length || body.glImbalance) onGlBlock({ accounts: body.glInvalidAccounts ?? null, imbalance: body.glImbalance ?? null });
    return true;
  } catch (e: any) {
    toast.error(e.response?.data?.message || 'Action failed');
    return false;
  }
}

function useUser() {
  const user = getCurrentUser();
  const can = (p: string) => user?.resolvedPermissions?.has(p) || false;
  const isAdmin = user?.allRoles?.some(r => ['admin', 'super-admin'].includes(r.name)) ?? false;
  return {
    userId: user?.id != null ? String(user.id) : '',
    canManage: isAdmin || can('manage_end_of_service'),
    canApprove: isAdmin || can('approve_end_of_service'),
    canView: isAdmin || can('manage_end_of_service') || can('approve_end_of_service') || can('view_end_of_service'),
  };
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-[12px]">
      {[true, false].map(v => (
        <button key={String(v)} type="button" onClick={() => onChange(v)}
          className={`px-4 py-1.5 font-medium ${value === v ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-black/5'}`}>
          {v ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  );
}

// ── Printable letter ──────────────────────────────────────────────────────────
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function printLetter(r: Settlement, settings: Settings) {
  const death = r.exit_reason === 'Death';
  const net = Number(r.net_amount) || 0;
  const account = r.account_no || 'your account';
  const balance = net >= 0
    ? `the balance due to you is NLe ${amt(net)}, which is paid into account ${account}.`
    : `there is a balance of NLe ${amt(-net)} owed to the Bank. Please pay this amount into your current account ${account}.`;
  const vars: Record<string, string> = {
    name: r.employee_name, effective_date: fmtDate(r.effective_date), reason: r.exit_reason.toLowerCase(),
    balance_sentence: death ? balance.replace(/to you/, 'to the estate').replace(/your current account/, 'the current account') : balance,
    account, net_amount: amt(Math.abs(net)),
  };
  const template = (death ? settings.eos_letter_body_death : settings.eos_letter_body) || '';
  const body = template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const lines = r.lines ?? [];
  const row = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="total"' : ''}><td>${esc(label)}</td><td class="n">${esc(value)}</td></tr>`;
  const table = [
    row(`End of Service Benefit (${r.counted_years} year${r.counted_years === 1 ? '' : 's'} × ${amt(r.days_per_year)} days)`, amt(r.eosb_amount)),
    ...lines.filter(l => l.line_type === 'addition').map(l => row(`Add: ${l.description}`, amt(l.amount))),
    ...lines.filter(l => l.line_type === 'deduction').map(l => row(`Less: ${l.description}`, `(${amt(l.amount)})`)),
    row('Balance', net < 0 ? `(${amt(-net)})` : amt(net), true),
  ].join('');
  const addressee = death ? (r.next_of_kin || 'The Next of Kin') : r.employee_name;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.settlement_number)}</title>
<style>
  @page { size: A4; margin: 25mm 20mm; }
  body { font: 11pt/1.55 Georgia, 'Times New Roman', serif; color: #111; }
  .date { text-align: right; margin-bottom: 18pt; }
  .to { margin-bottom: 14pt; }
  .re { font-weight: bold; text-decoration: underline; margin: 12pt 0; }
  p { margin: 0 0 10pt; white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 14pt; font-size: 10.5pt; }
  td { padding: 4pt 6pt; border-bottom: 0.5pt solid #bbb; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: bold; border-top: 1pt solid #111; border-bottom: 0; }
  .sign { margin-top: 36pt; }
  .cc { margin-top: 24pt; font-size: 10pt; }
</style></head><body>
<div class="date">${esc(fmtDate(new Date().toISOString()))}<br>Ref: ${esc(r.settlement_number)}</div>
<div class="to">${esc(addressee)}${death ? '' : `<br>${esc(r.employee_code || '')}`}${r.job_title ? `<br>${esc(r.job_title)}` : ''}${r.branch_name ? `<br>${esc(r.branch_name)}` : ''}</div>
<p>Dear ${esc(death ? addressee : r.employee_name)},</p>
<div class="re">RE: ${death ? `END OF SERVICE — THE LATE ${esc(r.employee_name.toUpperCase())}` : `${esc(r.exit_reason.toUpperCase())} AND END OF SERVICE BENEFIT`}</div>
${body.split(/\n{2,}/).map(par => `<p>${esc(par)}</p>`).join('')}
<table>${table}</table>
<div class="sign">Yours faithfully,<br><br><br>____________________________<br>${esc(settings.eos_letter_signatory || 'Managing Director/CEO')}</div>
<div class="cc">cc: Business Centre Manager${r.branch_name ? `, ${esc(r.branch_name)}` : ''}<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Human Resources</div>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast.error('Allow pop-ups to print the letter'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
}

// ── Settlement form ───────────────────────────────────────────────────────────
function SettlementForm({ initial, employees, reasons, onClose, onSaved }: {
  initial: Settlement | null; employees: Employee[]; reasons: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    employee: initial ? String(initial.employee) : '',
    exit_reason: initial?.exit_reason ?? '',
    effective_date: day(initial?.effective_date),
    notified_date: day(initial?.notified_date),
    // null → the system's records answer (leave module, payroll, the dates); HR can still change it.
    notice_given: (initial ? initial.notice_given : null) as boolean | null,
    salary_paid: (initial ? initial.salary_paid : null) as boolean | null,
    leave_paid: (initial ? initial.leave_paid : null) as boolean | null,
    rent_paid: initial?.rent_paid ?? true,
    clothing_paid: initial?.clothing_paid ?? false,
    annual_gross: initial?.gross_overridden ? String(initial.annual_gross) : '',
    next_of_kin: initial?.next_of_kin ?? '',
    notes: initial?.notes ?? '',
  });
  const [lines, setLines] = useState<Line[]>(initial?.lines ?? []);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [saving, setSaving] = useState(false);
  const [firstQuote, setFirstQuote] = useState(true);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }));

  // The benefit and the suggested lines come from the server. On a recalculation the suggested lines
  // are replaced and the loans / other items HR entered are kept. Opening a draft keeps its lines.
  useEffect(() => {
    setQuoteError('');
    if (!form.employee || !form.exit_reason || !form.effective_date) { setQuote(null); return; }
    const t = setTimeout(() => {
      const { annual_gross, ...rest } = form;
      const answered = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
      api.post('/end-of-service/quote', { ...answered, ...(annual_gross.trim() ? { annual_gross } : {}) })
        .then(r => {
          const q: Quote = r.data?.data;
          setQuote(q);
          if (initial && firstQuote) { setFirstQuote(false); return; }
          setFirstQuote(false);
          setLines(ls => [...q.lines, ...ls.filter(l => !AUTO_CODES.includes(l.item_code))]);
        })
        .catch(e => { setQuote(null); setQuoteError(e.response?.data?.message || 'Could not work out the settlement'); });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.employee, form.exit_reason, form.effective_date, form.notified_date, form.notice_given, form.salary_paid, form.leave_paid, form.rent_paid, form.clothing_paid, form.annual_gross]);

  // The answer in force: HR's when they set one, else what the server worked out from the records.
  const effective = (k: CheckKey) => (form[k] !== null ? !!form[k] : !!quote?.[k]);

  const updateLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = (item_code: 'loan' | 'other') => setLines(ls => [...ls, {
    line_type: 'deduction', item_code, description: item_code === 'loan' ? 'Staff loan balance' : '', basis: null, amount: '', gl_account: '',
  }]);

  const eosb = quote?.eosb_amount ?? initial?.eosb_amount ?? 0;
  const additions = sumLines(lines, 'addition'), deductions = sumLines(lines, 'deduction');
  const net = Math.round((eosb + additions - deductions) * 100) / 100;

  const save = async (submit: boolean) => {
    if (saving) return;
    if (!form.employee) return toast.error('Choose the employee');
    if (!form.exit_reason) return toast.error('Choose the reason for leaving');
    if (!form.effective_date) return toast.error('The effective date is required');
    if (quoteError) return toast.error(quoteError);
    for (const l of lines) {
      if (!String(l.description).trim()) return toast.error('Every line needs a description');
      if (l.item_code === 'loan' && !String(l.gl_account ?? '').trim()) return toast.error(`Enter the loan account for "${l.description}"`);
    }
    setSaving(true);
    const { annual_gross, ...rest } = form;
    const body = {
      ...rest,
      notice_given: effective('notice_given'), salary_paid: effective('salary_paid'), leave_paid: effective('leave_paid'),
      annual_gross: annual_gross.trim() ? annual_gross : null, lines,
    };
    try {
      if (initial) {
        await api.put(`/end-of-service/settlements/${initial.id}`, body);
        if (submit) await api.post(`/end-of-service/settlements/${initial.id}/submit`);
        toast.success(submit ? 'Settlement submitted for approval' : 'Settlement updated');
      } else {
        const res = await api.post('/end-of-service/settlements', { ...body, submit });
        toast.success(res.data?.message || 'Settlement saved');
      }
      onSaved(); onClose();
    } catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save the settlement'); }
    finally { setSaving(false); }
  };

  const options = employees
    .filter(e => !e.open_settlement || (initial && String(e.id) === String(initial.employee)))
    .map(e => ({ id: String(e.id), label: `${e.employee_name}${e.employee_code ? ` (${e.employee_code})` : ''}${e.lifecycle_status && e.lifecycle_status !== 'ACTIVE' ? ` — ${e.lifecycle_status.toLowerCase()}` : ''}` }));

  return (
    <FormModal
      title={initial ? `Edit ${initial.settlement_number}` : 'New End of Service Settlement'}
      subtitle="EOSB = Annual Gross × Years of Service × Days' Pay per Year ÷ divisor, plus additions, less deductions."
      onClose={onClose} onSave={() => save(true)} saveLabel={saving ? 'Saving…' : 'Submit'}
      secondaryAction={{ label: 'Save as Draft', onClick: () => save(false) }}
      maxWidth="4xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <FormField label="Employee" required className="col-span-full">
          <SearchSelect value={form.employee} onChange={v => set('employee', v)} options={options} placeholder="Search employee…" disabled={!!initial} />
        </FormField>
        <FormField label="Reason for Leaving" required>
          <Select className={inputClass} value={form.exit_reason} onChange={e => set('exit_reason', e.target.value)}>
            <option value="">Select reason…</option>
            {reasons.map(r => <option key={r} value={r}>{r}</option>)}
          </Select>
        </FormField>
        <FormField label="Effective Date" required hint="Years of service are counted up to this date">
          <DateInput className={inputClass} value={form.effective_date} onChange={e => set('effective_date', e.target.value)} />
        </FormField>
        <FormField label="Date Notified">
          <DateInput className={inputClass} value={form.notified_date} onChange={e => set('notified_date', e.target.value)} />
        </FormField>
        {form.exit_reason === 'Death' ? (
          <FormField label="Next of Kin" hint="The settlement letter is addressed to them">
            <input className={inputClass} value={form.next_of_kin} maxLength={150} onChange={e => set('next_of_kin', e.target.value)} />
          </FormField>
        ) : <div className="hidden sm:block" />}

        <div className="col-span-full rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)]">
          {([
            ['notice_given', 'Did the employee give the required notice?'],
            ['salary_paid', "Has the final month's salary already been paid?"],
            ['leave_paid', 'Has the leave allowance been paid this year?'],
            ['rent_paid', 'Has the rent allowance been paid for the year?'],
            ['clothing_paid', 'Has the clothing allowance been paid this year?'],
          ] as const).map(([key, label]) => {
            const check = CHECK_KEYS.includes(key as CheckKey) ? quote?.checks?.[key as CheckKey] : undefined;
            const value = CHECK_KEYS.includes(key as CheckKey) ? effective(key as CheckKey) : !!form[key];
            const differs = !!check && form[key] !== null && !!form[key] !== check.value;
            return (
              <div key={key} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {check && form[key] !== null && (
                      <button type="button" className="text-[11px] text-[var(--accent)] hover:underline" onClick={() => set(key, null as any)}>Use system</button>
                    )}
                    <YesNo value={value} onChange={v => set(key, v as any)} />
                  </div>
                </div>
                {check ? (
                  <p className={`mt-1 flex items-start gap-1.5 text-[11px] ${differs ? 'text-amber-700' : 'text-[var(--text-muted)]'}`}>
                    {differs ? <AlertTriangle size={12} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[var(--success)]" />}
                    <span>{differs ? `Your answer differs from the records. ${check.note}` : `${form[key] === null ? 'Answered by the system. ' : ''}${check.note}`}</span>
                  </p>
                ) : key === 'notice_given' && !form.notified_date ? (
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">Enter the date notified and the system checks this against the notice period.</p>
                ) : null}
              </div>
            );
          })}
        </div>

        {quoteError ? (
          <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">{quoteError}</div>
        ) : quote && (
          <div className="col-span-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
              <div><p className="text-[var(--text-muted)]">Service</p><p className="font-semibold text-[var(--text-primary)]">{service(quote.service_years, quote.service_months)}</p></div>
              <div><p className="text-[var(--text-muted)]">Years counted</p><p className="font-semibold text-[var(--text-primary)]">{quote.counted_years}</p></div>
              <div><p className="text-[var(--text-muted)]">Days per year</p><p className="font-semibold text-[var(--text-primary)]">{amt(quote.days_per_year)}</p></div>
              <div><p className="text-[var(--text-muted)]">Annual Gross</p><p className="font-semibold text-[var(--text-primary)] tabular-nums">{amt(quote.annual_gross)}</p></div>
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] tabular-nums">
              {quote.eligible
                ? <>{amt(quote.annual_gross)} × {quote.counted_years} × {amt(quote.days_per_year)} ÷ {amt(quote.divisor)} = <b className="text-[var(--success)]">{money(quote.eosb_amount)}</b></>
                : <>No benefit is paid for {form.exit_reason.toLowerCase()}. Additions and deductions still apply.</>}
            </p>
            {quote.warnings.map(w => (
              <p key={w} className="flex items-start gap-1.5 text-[11px] text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</p>
            ))}
          </div>
        )}

        <FormField label="Annual Gross (override)" hint={quote ? `Leave blank to use ${amt(quote.computed_gross)} from the salary components` : 'Leave blank to use the salary components'}>
          <input type="number" min="0" step="0.01" className={`${inputClass} tabular-nums`} value={form.annual_gross} onChange={e => set('annual_gross', e.target.value)} placeholder="0.00" />
        </FormField>
        <div className="hidden sm:block" />

        <div className="col-span-full">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Additions and deductions</p>
            <div className="flex gap-2">
              <button type="button" className="secondary-btn text-[12px]" onClick={() => addLine('loan')}><Plus size={13} />Staff loan</button>
              <button type="button" className="secondary-btn text-[12px]" onClick={() => addLine('other')}><Plus size={13} />Other item</button>
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--border)] overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th text-left" style={{ width: '16%' }}>Type</th>
                  <th className="th text-left">Item</th>
                  <th className="th text-left" style={{ width: '20%' }}>GL / Loan Account</th>
                  <th className="th" style={{ width: '16%', textAlign: 'right' }}>Amount</th>
                  <th className="th" style={{ width: '4%' }}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={5} className="td text-center text-[12px] text-[var(--text-muted)] py-6">No additions or deductions.</td></tr>
                ) : lines.map((l, i) => (
                  <tr key={i} className="tr">
                    <td className="td">
                      <Select className={inputClass} value={l.line_type} onChange={e => updateLine(i, { line_type: e.target.value as Line['line_type'] })}>
                        <option value="addition">Addition</option>
                        <option value="deduction">Deduction</option>
                      </Select>
                    </td>
                    <td className="td">
                      <input className={inputClass} value={l.description} maxLength={255} onChange={e => updateLine(i, { description: e.target.value })} placeholder="Description" />
                      {l.basis && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{l.basis}</p>}
                    </td>
                    <td className="td">
                      <input className={`${inputClass} font-mono text-[12px]`} value={l.gl_account ?? ''} maxLength={50} onChange={e => updateLine(i, { gl_account: e.target.value })}
                        placeholder={l.item_code === 'loan' ? 'Loan account' : AUTO_CODES.includes(l.item_code) ? 'From settings' : 'GL account'} />
                    </td>
                    <td className="td">
                      <input type="number" min="0" step="0.01" className={`${inputClass} text-right tabular-nums`} value={l.amount} onChange={e => updateLine(i, { amount: e.target.value })} placeholder="0.00" />
                    </td>
                    <td className="td text-right">
                      <button type="button" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-1.5 rounded text-red-500 hover:bg-red-50" title="Remove"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Changing the answers above recalculates the suggested lines. Loans and other items you add are kept.</p>
        </div>

        <div className="col-span-full rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)]">
          {([
            ['End of Service Benefit', amt(eosb), ''],
            ['Add: additions', amt(additions), ''],
            ['Less: deductions', `(${amt(deductions)})`, ''],
          ] as const).map(([label, value]) => (
            <div key={label} className="flex justify-between px-4 py-2 text-[13px]"><span className="text-[var(--text-muted)]">{label}</span><span className="tabular-nums">{value}</span></div>
          ))}
          <div className="flex justify-between px-4 py-2.5 text-[14px] font-bold">
            <span>{net < 0 ? 'Owed by the employee' : 'Net payable'}</span>
            <span className={`tabular-nums ${net < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>{net < 0 ? `(${amt(-net)})` : amt(net)}</span>
          </div>
        </div>

        <FormField label="Notes" className="col-span-full">
          <CountedTextarea className={inputClass} rows={2} maxChars={1000} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything the approvers should know" />
        </FormField>
      </div>
    </FormModal>
  );
}

// ── Settlement detail ─────────────────────────────────────────────────────────
function SettlementDetail({ id, settings, footer, canRetry, retrying, onRetry, onClose }: {
  id: string | null; settings: Settings; footer: (r: Settlement) => React.ReactNode; canRetry: boolean; retrying: boolean; onRetry: (r: Settlement) => void; onClose: () => void;
}) {
  const [r, setR] = useState<Settlement | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const load = useCallback(() => {
    if (!id) { setR(null); return; }
    api.get(`/end-of-service/settlements/${id}`).then(res => setR(res.data?.data ?? null)).catch(() => toast.error('Failed to load the settlement'));
    api.get(`/end-of-service/settlements/${id}/history`).then(res => setHistory(res.data?.data ?? [])).catch(() => setHistory([]));
  }, [id]);
  useEffect(load, [load]);
  useRealtimeRefresh('endofservice', load);

  const net = Number(r?.net_amount) || 0;
  return (
    <DetailSlideOver open={!!id} title="End of Service Settlement" subtitle={r ? `${r.settlement_number} · ${r.employee_name}` : undefined} onClose={onClose}
      footerActions={r ? footer(r) : undefined} maxWidth="xl">
      {r && (
        <div className="space-y-5">
          <div className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: `color-mix(in srgb, var(${net < 0 ? '--danger' : '--accent'}) 8%, transparent)`, border: `1px solid color-mix(in srgb, var(${net < 0 ? '--danger' : '--accent'}) 22%, transparent)` }}>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-[var(--text-primary)] truncate">{r.exit_reason}</p>
              <p className="text-[12px] text-[var(--text-muted)]">Effective {fmtDate(r.effective_date)} · {service(r.service_years, r.service_months)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-[22px] font-bold tabular-nums leading-none ${net < 0 ? 'text-[var(--danger)]' : 'text-[var(--accent)]'}`}>{net < 0 ? `(${amt(-net)})` : amt(net)}</p>
              <p className={`text-[11px] font-semibold mt-1 ${net < 0 ? 'text-[var(--danger)]' : 'text-[var(--accent)]'}`}>{net < 0 ? 'owed by the employee' : 'net payable'}</p>
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
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Settlement</p>
            </div>
            <div className="px-4 divide-y divide-[var(--border)]">
              <div className="flex items-start justify-between py-2.5 text-[13px] gap-4">
                <span className="text-[var(--text-muted)]">End of Service Benefit
                  <span className="block text-[11px]">{r.eligible ? `${amt(r.annual_gross)} × ${r.counted_years} × ${amt(r.days_per_year)} ÷ ${amt(r.divisor)}` : `Not paid for ${r.exit_reason.toLowerCase()}`}</span>
                </span>
                <span className="font-medium tabular-nums">{amt(r.eosb_amount)}</span>
              </div>
              {(r.lines ?? []).map(l => (
                <div key={l.id} className="flex items-start justify-between py-2.5 text-[13px] gap-4">
                  <span className="text-[var(--text-muted)]">{l.line_type === 'addition' ? 'Add' : 'Less'}: {l.description}
                    {(l.basis || l.gl_account) && <span className="block text-[11px]">{[l.basis, l.gl_account].filter(Boolean).join(' · ')}</span>}
                  </span>
                  <span className={`font-medium tabular-nums ${l.line_type === 'deduction' ? 'text-[var(--danger)]' : ''}`}>{l.line_type === 'deduction' ? `(${amt(l.amount)})` : amt(l.amount)}</span>
                </div>
              ))}
              <div className="flex items-start justify-between py-2.5 text-[13px] gap-4 font-bold">
                <span>Balance</span>
                <span className={`tabular-nums ${net < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>{net < 0 ? `(${amt(-net)})` : amt(net)}</span>
              </div>
            </div>
          </div>

          {(r.status === 'Rejected' || (r.status === 'Cancelled' && r.rejection_reason)) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--danger)] mb-2">{r.status === 'Rejected' ? 'Rejection Reason' : 'Cancellation Reason'}</p>
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700 leading-relaxed whitespace-pre-wrap">{r.rejection_reason || 'No reason was provided.'}</div>
            </div>
          )}

          {r.status === 'GL Failed' && (
            <GlFailureCard paymentLog={r.payment_log} failedAt={r.updated_at} runName={r.settlement_number} canRetry={canRetry} retrying={retrying} onRetry={() => onRetry(r)} />
          )}

          <DetailSection title="Details">
            <DetailGrid>
              <DetailField label="Hire date" value={fmtDate(r.hire_date)} />
              <DetailField label="Date notified" value={fmtDate(r.notified_date)} />
              <DetailField label="Notice given" value={r.notice_given ? 'Yes' : 'No'} />
              <DetailField label="Final salary paid" value={r.salary_paid ? 'Yes' : 'No'} />
              <DetailField label="Annual Gross" value={`${amt(r.annual_gross)}${r.gross_overridden ? ' (entered)' : ''}`} />
              <DetailField label="Account" value={r.account_no || '—'} />
              {r.exit_reason === 'Death' && <DetailField label="Next of kin" value={r.next_of_kin || '—'} />}
              <DetailField label="Raised by" value={r.created_by_name || r.created_by_username || '—'} />
              <DetailField label="GL reference" value={r.document_ref || '—'} />
              <DetailField label="Employee exited" value={r.exit_applied_at ? fmtDateTime(r.exit_applied_at, '') : '—'} />
              {r.notes && <DetailField label="Notes" value={r.notes} full />}
            </DetailGrid>
          </DetailSection>

          {(r.stages ?? []).length > 0 && (
            <DetailSection title="Approval">
              <div className="rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)]">
                {(r.stages ?? []).map(st => (
                  <div key={st.id} className="flex items-start justify-between gap-4 px-4 py-2.5 text-[12px]">
                    <div className="min-w-0">
                      <p className="font-medium text-[var(--text-primary)]">{st.stage_order + 1}. {st.stage_name}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{st.approver_label || '—'}{st.acted_by_name ? ` · ${st.acted_by_name}` : ''}{st.comment ? ` · ${st.comment}` : ''}</p>
                    </div>
                    <span className="shrink-0"><StatusPill status={st.status === 'Pending' ? 'Pending Approval' : st.status} /></span>
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

          {['Approved', 'Paid', 'GL Failed'].includes(r.status) && (
            <button className="secondary-btn w-full justify-center" onClick={() => printLetter(r, settings)}><Printer size={14} />Print Settlement Letter</button>
          )}
        </div>
      )}
    </DetailSlideOver>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANAGE END OF SERVICE
// ══════════════════════════════════════════════════════════════════════════════
export function ManageEndOfService() {
  const me = useUser();
  const TABS = [
    ...(me.canView ? ['Settlements'] : []),
    'Approval List',
    ...(me.canManage ? ['Service Bands', 'Provident Fund', 'Calculation Rules', 'Letter Wording'] : []),
  ];
  const [activeTab, setActiveTab] = useState<string>(TABS[0]);
  const [settings, setSettings] = useState<Settings>({});
  const loadSettings = useCallback(() => {
    api.get('/end-of-service/settings').then(r => setSettings(r.data?.data ?? {})).catch(() => {});
  }, []);
  useEffect(loadSettings, [loadSettings]);

  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="End of Service" subtitle="Settle the end of service benefit when an employee leaves. GL accounts, postings and the approval flow are in Settings → Controls." />
      <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} className="flex flex-wrap items-center gap-2 mt-2 mb-4 border-b border-slate-200 pb-2" />
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] flex flex-col min-h-[500px] overflow-hidden">
        {(activeTab === 'Settlements' || activeTab === 'Approval List') && <SettlementsTab key={activeTab} approvals={activeTab === 'Approval List'} me={me} settings={settings} />}
        {activeTab === 'Service Bands' && <BandsTab />}
        {activeTab === 'Provident Fund' && <PfTab />}
        {activeTab === 'Calculation Rules' && <RulesTab settings={settings} onSaved={loadSettings} />}
        {activeTab === 'Letter Wording' && <LetterTab settings={settings} onSaved={loadSettings} />}
      </div>
    </div>
  );
}

function SettlementsTab({ approvals, me, settings }: { approvals: boolean; me: ReturnType<typeof useUser>; settings: Settings }) {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [status, setStatus] = useState('All');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [viewId, setViewId] = useState<string | null>(null);
  const [form, setForm] = useState<Settlement | null | undefined>(undefined);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [glBlock, setGlBlock] = useState<GlBlock>(null);
  const [rejecting, setRejecting] = useState<Settlement | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; onConfirm: () => void } | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get(approvals ? '/end-of-service/approvals' : '/end-of-service/settlements')
      .then(r => setRows(r.data?.data ?? []))
      .catch((e: any) => toast.error(e.response?.data?.message || 'Failed to load settlements'))
      .finally(() => setLoading(false));
  }, [approvals]);
  useEffect(() => { load(); }, [load]);
  useRealtimeRefresh('endofservice', load);
  const loadEmployees = () => api.get('/end-of-service/employees').then(r => setEmployees(r.data?.data ?? [])).catch(() => {});

  const after = () => { load(); };
  const post = (path: string, body: any, ok: string) => runAction(() => api.post(path, body), setGlBlock, ok).then(done => { if (done) after(); return done; });
  const approve = (r: Settlement) => setConfirm({
    title: 'Approve Settlement',
    message: `Approve ${r.settlement_number} for ${r.employee_name}? If this is the last stage, ${r.employee_name} is marked as exited and the settlement is posted to the GL.`,
    label: 'Approve', onConfirm: () => post(`/end-of-service/settlements/${r.id}/approve`, {}, 'Approved'),
  });
  const submit = (r: Settlement) => post(`/end-of-service/settlements/${r.id}/submit`, {}, 'Submitted');
  const postGl = (r: Settlement) => post(`/end-of-service/settlements/${r.id}/post`, {}, 'Posted');
  const retry = async (r: Settlement) => { setRetrying(true); await post(`/end-of-service/settlements/${r.id}/retry-gl`, {}, 'Posted'); setRetrying(false); };
  const cancel = (r: Settlement) => setConfirm({
    title: 'Cancel Settlement', message: `Cancel ${r.settlement_number} for ${r.employee_name}?${r.exit_applied_at ? ' The employee stays exited.' : ''}`,
    label: 'Cancel Settlement', onConfirm: () => post(`/end-of-service/settlements/${r.id}/cancel`, {}, 'Cancelled'),
  });
  const remove = (r: Settlement) => setConfirm({
    title: 'Delete Settlement', message: `Delete draft ${r.settlement_number}? This cannot be undone.`, label: 'Delete',
    onConfirm: () => api.delete(`/end-of-service/settlements/${r.id}`).then(() => { toast.success('Settlement deleted'); load(); })
      .catch((e: any) => toast.error(e.response?.data?.message || 'Failed to delete the settlement')),
  });
  const openEdit = async (r: Settlement | null) => {
    await loadEmployees();
    if (!r) { setForm(null); return; }
    try { const res = await api.get(`/end-of-service/settlements/${r.id}`); setForm(res.data?.data); }
    catch { toast.error('Failed to load the settlement'); }
  };

  const filtered = rows.filter(r => (approvals || status === 'All' || r.status === status) && JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase()));
  useEffect(() => setPage(1), [searchQuery, status]);
  const postActions = me.canManage || me.canApprove;
  const decideButtons = (r: Settlement) => r.can_decide && r.status === 'Pending Approval' ? (
    <>
      <button className="secondary-btn shadow-sm text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5" onClick={() => { setRejecting(r); setRejectReason(''); }}>
        <X size={14} className="mr-1.5 inline" />Reject
      </button>
      <button className="primary-btn shadow-sm bg-[var(--success)] hover:opacity-90" onClick={() => approve(r)}>
        <Check size={14} className="mr-1.5 inline" />Approve
      </button>
    </>
  ) : null;

  return (
    <>
      <TableToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={approvals ? 'Search settlements awaiting you...' : 'Search settlements...'}
        actions={!approvals && me.canManage ? (
          <button className="primary-btn shrink-0" onClick={() => openEdit(null)}>
            <span className="hidden sm:inline">New Settlement</span><span className="sm:hidden">New</span><Plus className="w-[14px] h-[14px]" />
          </button>
        ) : undefined}
      />
      {!approvals && (
        <div className="flex flex-wrap gap-1 px-4 py-3 border-b border-[var(--border)]">
          {STATUSES.map(st => (
            <button key={st} onClick={() => setStatus(st)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${status === st
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}>{st}</button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">Reference</th>
              <th className="th text-left">Employee</th>
              <th className="th text-left">Reason</th>
              <th className="th text-left">Effective</th>
              <th className="th text-center" style={{ width: '7%' }}>Years</th>
              <th className="th" style={{ width: '12%', textAlign: 'right' }}>EOSB</th>
              <th className="th" style={{ width: '12%', textAlign: 'right' }}>Balance</th>
              <th className="th text-left">{approvals ? 'Stage' : 'Status'}</th>
              <th scope="col" className="th" style={{ textAlign: 'right' }}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <TableStateRow cols={9} loading={loading} empty={approvals ? 'No settlements are waiting for your approval.' : 'No end of service settlements yet.'} />
            ) : paginate(filtered, page, pageSize).map((row, i) => {
              const net = Number(row.net_amount) || 0;
              return (
                <motion.tr key={row.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
                  <td className="td font-medium text-[var(--text-primary)]">{row.settlement_number}</td>
                  <td className="td text-[var(--text-primary)] font-medium">{row.employee_name}</td>
                  <td className="td">{row.exit_reason}</td>
                  <td className="td">{fmtDate(row.effective_date)}</td>
                  <td className="td text-center">{row.counted_years}</td>
                  <td className="td text-right tabular-nums text-[13px]">{amt(row.eosb_amount)}</td>
                  <td className="td text-right"><span className={`font-semibold tabular-nums text-[13px] ${net < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>{net < 0 ? `(${amt(-net)})` : amt(net)}</span></td>
                  <td className="td">{approvals ? (row.current_stage || 'Approval') : <StatusPill status={row.status} />}</td>
                  <td className="td text-right"><div className="flex justify-end"><RowActions actions={[
                    { label: 'View', icon: Eye, onClick: () => setViewId(row.id) },
                    { label: 'Approve', icon: Check, onClick: () => approve(row), hidden: !approvals },
                    { label: 'Reject', icon: XCircle, danger: true, onClick: () => { setRejecting(row); setRejectReason(''); }, hidden: !approvals },
                    { label: 'Submit for Approval', icon: SendHorizonal, onClick: () => submit(row), hidden: approvals || row.status !== 'Draft' || !me.canManage },
                    { label: 'Edit', icon: FileEdit, onClick: () => openEdit(row), hidden: approvals || row.status !== 'Draft' || !me.canManage },
                    { label: 'Print Letter', icon: Printer, onClick: async () => { const res = await api.get(`/end-of-service/settlements/${row.id}`); printLetter(res.data?.data, settings); }, hidden: approvals || !['Approved', 'Paid', 'GL Failed'].includes(row.status) },
                    { label: 'Retry GL Posting', icon: RefreshCw, danger: true, onClick: () => retry(row), hidden: approvals || row.status !== 'GL Failed' || !postActions },
                    { label: 'Post to GL', icon: CheckCircle2, onClick: () => postGl(row), hidden: approvals || row.status !== 'Approved' || !postActions },
                    { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove(row), hidden: approvals || row.status !== 'Draft' || !me.canManage },
                    { label: 'Cancel Settlement', icon: XCircle, danger: true, onClick: () => cancel(row), hidden: approvals || !['Draft', 'Pending Approval', 'Approved', 'GL Failed'].includes(row.status) || !!row.document_ref || !me.canManage },
                  ]} /></div></td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TablePagination total={rows.length} filtered={filtered.length} page={page} pageSize={pageSize}
        onPageChange={setPage} onPageSizeChange={p => { setPageSize(p); setPage(1); }} />

      {form !== undefined && (
        <SettlementForm initial={form} employees={employees} reasons={settings.exit_reasons ?? []} onClose={() => setForm(undefined)} onSaved={load} />
      )}
      <SettlementDetail id={viewId} settings={settings} canRetry={postActions} retrying={retrying} onRetry={retry} onClose={() => setViewId(null)} footer={decideButtons} />
      {rejecting && (
        <FormModal title="Reject Settlement" subtitle="Provide a reason for rejection." onClose={() => setRejecting(null)} saveLabel="Reject" maxWidth="md" scrollable={false}
          onSave={async () => {
            if (!rejectReason.trim()) { toast.error('A reason is required'); return; }
            const done = await post(`/end-of-service/settlements/${rejecting.id}/reject`, { reason: rejectReason.trim() }, 'Settlement rejected');
            if (done) setRejecting(null);
          }}>
          <FormField label="Rejection Reason" required>
            <CountedTextarea className={inputClass} rows={3} maxChars={500} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection…" />
          </FormField>
        </FormModal>
      )}
      {confirm && (
        <ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.label} variant={confirm.label === 'Approve' ? undefined : 'danger'}
          onCancel={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />
      )}
      <GlBlockedModal isOpen={!!glBlock} accounts={glBlock?.accounts} imbalance={glBlock?.imbalance} context="end of service settlement" onClose={() => setGlBlock(null)} />
    </>
  );
}

// ── Setup: service bands ──────────────────────────────────────────────────────
function BandsTab() {
  const [bands, setBands] = useState<{ up_to_years: string; days_per_year: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    api.get('/end-of-service/bands')
      .then(r => setBands((r.data?.data ?? []).map((b: any) => ({ up_to_years: b.up_to_years == null ? '' : String(b.up_to_years), days_per_year: String(b.days_per_year) }))))
      .catch(() => toast.error('Failed to load the service bands')).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  const update = (i: number, patch: Partial<(typeof bands)[number]>) => setBands(bs => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const save = async () => {
    setSaving(true);
    try { await api.put('/end-of-service/bands', { bands }); toast.success('Service bands saved'); load(); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save the bands'); }
    finally { setSaving(false); }
  };
  const from = (i: number) => (i === 0 ? '1' : `over ${bands[i - 1]?.up_to_years || '…'}`);

  return (
    <>
      <div className="p-4 sm:p-5 flex flex-wrap items-center justify-end gap-2 border-b border-[var(--border)]">
        <button className="secondary-btn shrink-0" onClick={() => setBands(bs => {
          const open = bs[bs.length - 1];
          const before = bs.slice(0, -1);
          const last = Number(before[before.length - 1]?.up_to_years || 0);
          return [...before, { up_to_years: String(last + 3), days_per_year: open?.days_per_year ?? '' }, open ?? { up_to_years: '', days_per_year: '' }];
        })}><Plus className="w-[14px] h-[14px]" />Add Band</button>
        <button onClick={save} disabled={saving} className="primary-btn shrink-0">{saving ? 'Saving…' : 'Save Bands'}<Save className="w-[14px] h-[14px]" /></button>
      </div>
      <p className="px-4 pt-3 text-[12px] text-[var(--text-muted)]">The rate of the band an employee falls into applies to all their years: 5 years in the "over 3 to 6" band is paid 33 days × 5.</p>
      <div className="overflow-x-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">Years of service</th>
              <th className="th text-left" style={{ width: '22%' }}>Up to (years)</th>
              <th className="th" style={{ width: '22%', textAlign: 'right' }}>Days' pay per year</th>
              <th className="th" style={{ width: '6%' }}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {bands.length === 0 ? <TableStateRow cols={4} loading={loading} empty="No bands set." /> : bands.map((b, i) => {
              const last = i === bands.length - 1;
              return (
                <tr key={i} className="tr">
                  <td className="td font-medium text-[var(--text-primary)]">{last ? `Over ${bands[i - 1]?.up_to_years || '0'} years` : `${from(i)} – ${b.up_to_years || '…'} years`}</td>
                  <td className="td">
                    {last ? <span className="text-[12px] text-[var(--text-muted)]">and above</span>
                      : <input type="number" min="1" step="1" className={`${inputClass} max-w-[120px]`} value={b.up_to_years} onChange={e => update(i, { up_to_years: e.target.value })} />}
                  </td>
                  <td className="td text-right">
                    <input type="number" min="0" step="0.5" className={`${inputClass} ml-auto max-w-[140px] text-right tabular-nums`} value={b.days_per_year} onChange={e => update(i, { days_per_year: e.target.value })} />
                  </td>
                  <td className="td text-right">
                    {!last && <button type="button" onClick={() => setBands(bs => bs.filter((_, idx) => idx !== i))} className="p-1.5 rounded text-red-500 hover:bg-red-50" title="Remove"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Setup: Provident Fund list ────────────────────────────────────────────────
function PfTab() {
  const [rows, setRows] = useState<{ id: string; employee: string; employee_name: string; employee_code?: string; amount: number; note?: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState<{ employee: string; amount: string; note: string } | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [removing, setRemoving] = useState<(typeof rows)[number] | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    api.get('/end-of-service/pf').then(r => setRows(r.data?.data ?? [])).catch(() => toast.error('Failed to load the Provident Fund list')).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  const open = (row?: (typeof rows)[number]) => {
    if (!employees.length) api.get('/end-of-service/employees').then(r => setEmployees(r.data?.data ?? [])).catch(() => {});
    setEditing(row ? { employee: row.employee, amount: String(row.amount), note: row.note ?? '' } : { employee: '', amount: '', note: '' });
  };
  const save = async () => {
    if (!editing) return;
    try { const res = await api.post('/end-of-service/pf', editing); toast.success(res.data?.message || 'Saved'); setEditing(null); load(); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save'); }
  };
  const filtered = rows.filter(r => JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase()));
  const options = employees.map(e => ({ id: String(e.id), label: `${e.employee_name}${e.employee_code ? ` (${e.employee_code})` : ''}` }));

  return (
    <>
      <TableToolbar searchQuery={searchQuery} onSearchChange={setSearchQuery} searchPlaceholder="Search the PF list..."
        actions={<button className="primary-btn shrink-0" onClick={() => open()}>Add Employee<Plus className="w-[14px] h-[14px]" /></button>} />
      <p className="px-4 pt-3 text-[12px] text-[var(--text-muted)]">Only the employees on this list have the fixed amount deducted from their End of Service Benefit.</p>
      <div className="overflow-x-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">Employee</th>
              <th className="th text-left">Note</th>
              <th className="th" style={{ width: '16%', textAlign: 'right' }}>Amount</th>
              <th scope="col" className="th" style={{ textAlign: 'right' }}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? <TableStateRow cols={4} loading={loading} empty="No employees on the Provident Fund list." /> : filtered.map(r => (
              <tr key={r.id} className="tr">
                <td className="td font-medium text-[var(--text-primary)]">{r.employee_name}{r.employee_code ? <span className="ml-1.5 text-[12px] text-[var(--text-muted)]">{r.employee_code}</span> : null}</td>
                <td className="td">{r.note || '—'}</td>
                <td className="td text-right tabular-nums">{amt(r.amount)}</td>
                <td className="td text-right"><div className="flex justify-end"><RowActions actions={[
                  { label: 'Edit', icon: FileEdit, onClick: () => open(r) },
                  { label: 'Remove', icon: Trash2, danger: true, onClick: () => setRemoving(r) },
                ]} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <FormModal title="Provident Fund" subtitle="The fixed amount deducted from this employee's End of Service Benefit." onClose={() => setEditing(null)} onSave={save} maxWidth="lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <FormField label="Employee" required className="col-span-full">
              <SearchSelect value={editing.employee} onChange={v => setEditing(e => e && ({ ...e, employee: v }))} options={options} placeholder="Search employee…" />
            </FormField>
            <FormField label="Amount" required>
              <input type="number" min="0" step="0.01" className={`${inputClass} tabular-nums`} value={editing.amount} onChange={e => setEditing(x => x && ({ ...x, amount: e.target.value }))} />
            </FormField>
            <FormField label="Note">
              <input className={inputClass} maxLength={255} value={editing.note} onChange={e => setEditing(x => x && ({ ...x, note: e.target.value }))} />
            </FormField>
          </div>
        </FormModal>
      )}
      {removing && (
        <ConfirmModal title="Remove from PF List" message={`Remove ${removing.employee_name} from the Provident Fund list?`} confirmLabel="Remove" variant="danger"
          onCancel={() => setRemoving(null)}
          onConfirm={() => { api.delete(`/end-of-service/pf/${removing.id}`).then(() => { toast.success('Removed'); load(); }).catch((e: any) => toast.error(e.response?.data?.message || 'Failed to remove')); setRemoving(null); }} />
      )}
    </>
  );
}

// ── Setup: calculation rules ──────────────────────────────────────────────────
const listOf = (v?: string) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };

function RulesTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, any>>({});
  const [components, setComponents] = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({
      eos_divisor: settings.eos_divisor ?? '261', eos_min_service_months: settings.eos_min_service_months ?? '6',
      eos_round_up_months: settings.eos_round_up_months ?? '6', eos_notice_months: settings.eos_notice_months ?? '1',
      eos_salary_basis: settings.eos_salary_basis ?? 'basic', eos_allowance_basis: settings.eos_allowance_basis ?? 'annual',
      eos_gross_components: listOf(settings.eos_gross_components), eos_rent_components: listOf(settings.eos_rent_components),
      eos_clothing_components: listOf(settings.eos_clothing_components), eos_ineligible_reasons: listOf(settings.eos_ineligible_reasons),
    });
  }, [settings]);
  useEffect(() => {
    api.get('/end-of-service/components').then(r => setComponents((r.data?.data ?? []).map((c: any) => ({ id: String(c.id), label: c.name })))).catch(() => {});
  }, []);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try { await api.put('/end-of-service/settings', form); toast.success('Calculation rules saved'); onSaved(); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };
  const reasons = settings.exit_reasons ?? [];
  const num = (k: string, label: string, hint: string, step = '1') => (
    <FormField label={label} hint={hint}>
      <input type="number" min="0" step={step} className={`${inputClass} tabular-nums`} value={form[k] ?? ''} onChange={e => set(k, e.target.value)} />
    </FormField>
  );

  return (
    <div className="p-5 sm:p-6 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <FormField label="Annual Gross — salary components" hint="Monthly amounts × 12. Basic salary plus all allowances." className="col-span-full">
          <MultiSearchSelect value={form.eos_gross_components ?? []} onChange={v => set('eos_gross_components', v)} options={components} placeholder="Choose components…" />
        </FormField>
        {num('eos_divisor', 'Divisor', 'Working days a year, to turn annual salary into a daily rate')}
        {num('eos_min_service_months', 'Minimum service (months)', 'Less service than this earns no benefit')}
        {num('eos_round_up_months', 'Round a part year up from (months)', 'A part year of this many months or more counts as a full year')}
        {num('eos_notice_months', 'Notice period (months)', 'Salary deducted when no notice is given')}
        <FormField label="One month's salary is" hint="Used for the final salary and for notice pay">
          <Select className={inputClass} value={form.eos_salary_basis} onChange={e => set('eos_salary_basis', e.target.value)}>
            <option value="basic">Basic salary</option>
            <option value="gross">Annual Gross ÷ 12</option>
          </Select>
        </FormField>
        <FormField label="Rent and clothing component amounts are" hint="How the amounts are held on the salary components">
          <Select className={inputClass} value={form.eos_allowance_basis} onChange={e => set('eos_allowance_basis', e.target.value)}>
            <option value="annual">Annual amounts</option>
            <option value="monthly">Monthly amounts</option>
          </Select>
        </FormField>
        <FormField label="Rent allowance components">
          <MultiSearchSelect value={form.eos_rent_components ?? []} onChange={v => set('eos_rent_components', v)} options={components} placeholder="Choose components…" />
        </FormField>
        <FormField label="Clothing allowance components">
          <MultiSearchSelect value={form.eos_clothing_components ?? []} onChange={v => set('eos_clothing_components', v)} options={components} placeholder="Choose components…" />
        </FormField>
        <FormField label="Reasons for leaving with no benefit" hint="Additions and deductions still apply" className="col-span-full">
          <div className="flex flex-wrap gap-2">
            {reasons.map(r => {
              const on = (form.eos_ineligible_reasons ?? []).includes(r);
              return (
                <button key={r} type="button" onClick={() => set('eos_ineligible_reasons', on ? form.eos_ineligible_reasons.filter((x: string) => x !== r) : [...(form.eos_ineligible_reasons ?? []), r])}
                  className={`px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors ${on ? 'bg-[var(--danger)] text-white border-[var(--danger)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]'}`}>{r}</button>
              );
            })}
          </div>
        </FormField>
      </div>
      <p className="text-[12px] text-[var(--text-muted)]">Leave allowance uses the leave module's own calculation (basic × 12 × the annual factor in Leave allowance settings). Monthly amounts are cut off at 2 decimals, not rounded.</p>
      <div className="flex justify-end"><button className="primary-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save Rules'}<Save className="w-[14px] h-[14px]" /></button></div>
    </div>
  );
}

// ── Setup: letter wording ─────────────────────────────────────────────────────
function LetterTab({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [form, setForm] = useState({ eos_letter_signatory: '', eos_letter_body: '', eos_letter_body_death: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({ eos_letter_signatory: settings.eos_letter_signatory ?? '', eos_letter_body: settings.eos_letter_body ?? '', eos_letter_body_death: settings.eos_letter_body_death ?? '' });
  }, [settings]);
  const dirty = form.eos_letter_signatory !== (settings.eos_letter_signatory ?? '')
    || form.eos_letter_body !== (settings.eos_letter_body ?? '')
    || form.eos_letter_body_death !== (settings.eos_letter_body_death ?? '');
  const save = async () => {
    setSaving(true);
    try { await api.put('/end-of-service/settings', form); toast.success('Letter wording saved'); onSaved(); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };
  const placeholders = useMemo(() => [
    ['{name}', "Employee's name"], ['{effective_date}', 'Last working date'], ['{reason}', 'Reason for leaving'],
    ['{balance_sentence}', 'Amount paid or owed, as a sentence'], ['{account}', 'Employee account number'], ['{net_amount}', 'Net settlement amount'],
  ], []);
  const copy = (p: string) => { navigator.clipboard?.writeText(p).then(() => toast.success(`${p} copied`)).catch(() => {}); };
  // The textareas only grow up to a cap and this body scrolls inside the card, so the toolbar (and its
  // Save button) always stays in view however far a box is stretched.
  const area = `${inputClass} resize-y min-h-[160px] max-h-[480px] leading-relaxed`;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-[var(--border)]">
        <div>
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">Settlement letter</p>
          <p className="text-[11.5px] text-[var(--text-muted)]">Printed above the settlement breakdown. Leave a blank line between paragraphs.</p>
        </div>
        <button className="primary-btn shrink-0" disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving…' : dirty ? 'Save Wording' : 'Saved'}<Save className="w-[14px] h-[14px]" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-6 items-start">
          <div className="space-y-5 min-w-0">
            <FormField label="Letter to the employee">
              <CountedTextarea className={area} rows={9} maxChars={4000} value={form.eos_letter_body} onChange={e => setForm(f => ({ ...f, eos_letter_body: e.target.value }))} />
            </FormField>
            <FormField label="Letter to the next of kin (death)">
              <CountedTextarea className={area} rows={8} maxChars={4000} value={form.eos_letter_body_death} onChange={e => setForm(f => ({ ...f, eos_letter_body_death: e.target.value }))} />
            </FormField>
          </div>
          <div className="space-y-5 lg:sticky lg:top-0">
            <FormField label="Signed by">
              <input className={inputClass} value={form.eos_letter_signatory} maxLength={100} placeholder="e.g. Managing Director / CEO" onChange={e => setForm(f => ({ ...f, eos_letter_signatory: e.target.value }))} />
            </FormField>
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-hover)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Placeholders</p>
              <ul className="space-y-1.5">
                {placeholders.map(([p, label]) => (
                  <li key={p} className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => copy(p)} title="Copy"
                      className="font-mono text-[11.5px] px-1.5 py-0.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)] hover:border-[var(--accent)]">{p}</button>
                    <span className="text-[11px] text-[var(--text-muted)] text-right">{label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">Click one to copy it, then paste it into the wording.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
