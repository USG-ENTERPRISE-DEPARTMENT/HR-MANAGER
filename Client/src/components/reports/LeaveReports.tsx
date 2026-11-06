import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mail, Settings2 } from 'lucide-react';
import api from '../../../lib/api';
import { useCan } from '@/hooks/useCan';
import { uniqOpts } from '../ui/reportTools';
import { FormModal } from '../ui/FormModal';
import { FormField, inputClass } from '../ui/FormField';
import { MultiSearchSelect } from '../ui/SearchSelect';
import { ReportModal, filterSummary, day, fullName, type Cell } from './ReportModal';

// Legacy IceHRM "Leave Management" reports: Employee Leaves (one row per application) and
// Employee Leave Entitlement (balances for the active leave period). Managers on Leave (HRM-R01)
// is new: who among the managers is away for a date range, emailed to the MD.

export function EmployeeLeavesReport({ onClose, canExport }: { onClose: () => void; canExport: boolean }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ employee: '', type: '', status: '', from: '', to: '' });

  useEffect(() => {
    api.get('/leave/leaves?all=1')
      .then(r => setData(r.data.data ?? []))
      .catch(() => toast.error('Failed to load leave data'))
      .finally(() => setLoading(false));
  }, []);

  const typeOf = (l: any) => l.leave_type_name ?? l.leave_name ?? '';
  const empOpts = useMemo(() => uniqOpts(data.map((l: any) => l.employee_name)), [data]);
  const typeOpts = useMemo(() => uniqOpts(data.map(typeOf)), [data]);
  const statusOpts = useMemo(() => uniqOpts(data.map((l: any) => l.status)), [data]);

  const HEADERS = ['Employee', 'ID', 'Leave Type', 'Period', 'Start', 'End', 'Days', 'Status', 'Reason'];
  // Overlap, not containment: a leave that started before the window but runs into it still counts.
  const rows = useMemo(() => data
    .filter((l: any) => {
      if (f.employee && l.employee_name !== f.employee) return false;
      if (f.type && typeOf(l) !== f.type) return false;
      if (f.status && l.status !== f.status) return false;
      const start = day(l.date_start), end = day(l.date_end) || start;
      if (f.from && end < f.from) return false;
      if (f.to && start > f.to) return false;
      return true;
    })
    .sort((a: any, b: any) => String(a.employee_name ?? '').localeCompare(String(b.employee_name ?? '')) || day(a.date_start).localeCompare(day(b.date_start)))
    .map((l: any) => [
      l.employee_name ?? '', l.employee_code ?? '', typeOf(l), l.period_name ?? '', day(l.date_start), day(l.date_end),
      Number(l.day_count ?? 0), l.status ?? '', l.details ?? '',
    ] as Cell[]), [data, f]);

  return (
    <ReportModal
      title="Employee Leaves Report" subtitle="Every leave application by employee, date range and status" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading leave data…"
      filters={[
        { key: 'employee', label: 'Employee', type: 'select', options: empOpts, allLabel: 'All employees' },
        { key: 'type', label: 'Leave Type', type: 'select', options: typeOpts, allLabel: 'All types', width: 'w-44' },
        { key: 'status', label: 'Status', type: 'select', options: statusOpts, allLabel: 'All statuses', width: 'w-44' },
        { key: 'from', label: 'From', type: 'date' },
        { key: 'to', label: 'To', type: 'date' },
      ]}
      values={f} onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v }))}
      onClear={() => setF({ employee: '', type: '', status: '', from: '', to: '' })}
      headers={HEADERS} rows={rows} total={data.length}
      summary={filterSummary([['Employee', f.employee], ['Type', f.type], ['Status', f.status],
        ['Dates', (f.from || f.to) ? `${f.from || '…'} → ${f.to || '…'}` : '']], 'All leave applications — no filters applied')}
      emptyMessage={data.length ? 'No applications match the selected filters.' : 'No leave applications found.'}
    />
  );
}

// Balances come from /leave/balance/:employeeId — the same calculation staff see on their own leave
// screen (rules, accrual, carry-forward). It is per employee, so like the legacy report this one is
// run for a department or a single employee rather than the whole company at once.
export function LeaveEntitlementReport({ onClose, canExport }: { onClose: () => void; canExport: boolean }) {
  const [emps, setEmps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ department: '', employee: '' });
  const [rows, setRows] = useState<Cell[][]>([]);
  const [period, setPeriod] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const runId = useRef(0);

  useEffect(() => {
    api.get('/employees')
      .then(r => setEmps((r.data.data ?? []).filter((e: any) => !['TERMINATED', 'RESIGNED', 'PENDING'].includes(e.lifecycleStatus))))
      .catch(() => toast.error('Failed to load employee data'))
      .finally(() => setLoading(false));
  }, []);

  const deptOpts = useMemo(() => uniqOpts(emps.map((e: any) => e.department?.title)), [emps]);
  const empOpts = useMemo(() => emps
    .filter((e: any) => !f.department || e.department?.title === f.department)
    .map((e: any) => ({ id: String(e.id), label: `${fullName(e)} (${e.employee_id ?? ''})` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [emps, f.department]);

  const targets = useMemo(() => {
    if (f.employee) return emps.filter((e: any) => String(e.id) === f.employee);
    if (f.department) return emps.filter((e: any) => e.department?.title === f.department);
    return [];
  }, [emps, f]);

  useEffect(() => {
    const id = ++runId.current;
    setRows([]);
    if (!targets.length) { setProgress(null); return; }
    setProgress({ done: 0, total: targets.length });
    const out: Cell[][] = [];
    let next = 0, done = 0;
    const worker = async () => {
      while (next < targets.length && id === runId.current) {
        const e = targets[next++];
        try {
          const r = await api.get(`/leave/balance/${e.id}`);
          for (const b of (r.data.data ?? [])) {
            if (b.period_name) setPeriod(b.period_name);
            out.push([fullName(e), e.employee_id ?? '', e.department?.title ?? '', b.name ?? '',
              Number(b.allocated ?? 0), Number(b.carry_forward_days ?? 0), Number(b.used ?? 0), Number(b.pending ?? 0), Number(b.balance ?? 0)]);
          }
        } catch { /* one employee failing should not sink the report */ }
        done++;
        if (id === runId.current) setProgress({ done, total: targets.length });
      }
    };
    // A few requests at a time: each balance runs several queries server-side.
    Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker)).then(() => {
      if (id !== runId.current) return;
      out.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])));
      setRows(out);
      setProgress(null);
    });
  }, [targets]);

  const HEADERS = ['Employee', 'ID', 'Department', 'Leave Type', 'Entitled', 'Carried Forward', 'Taken', 'Pending', 'Balance'];
  const empLabel = empOpts.find(o => o.id === f.employee)?.label;
  const waiting = !f.department && !f.employee;

  return (
    <ReportModal
      title="Employee Leave Entitlement" subtitle="Leave entitlement, days taken and balance for the active leave period"
      onClose={onClose} canExport={canExport} loading={loading} loadingText="Loading employees…"
      filters={[
        { key: 'department', label: 'Department', type: 'select', options: deptOpts, allLabel: 'Select department…', width: 'w-56' },
        { key: 'employee', label: 'Employee', type: 'select', options: empOpts, allLabel: 'All in department', width: 'w-64' },
      ]}
      values={f} onFilterChange={(k, v) => setF(p => (k === 'department' ? { department: v, employee: '' } : { ...p, [k]: v }))}
      onClear={() => setF({ department: '', employee: '' })}
      headers={HEADERS} rows={rows} total={rows.length}
      summary={filterSummary([['Period', period], ['Department', f.department], ['Employee', empLabel]], '')}
      emptyMessage="No leave entitlements found for this selection."
      notice={progress && (
        <p className="text-[12.5px] text-[var(--text-muted)]">Calculating balances… {progress.done} of {progress.total} employees</p>
      )}
    >
      {waiting ? (
        <p className="text-center text-[var(--text-muted)] text-sm py-8">Select a department or an employee to calculate entitlements.</p>
      ) : progress ? <></> : undefined}
    </ReportModal>
  );
}

// ── Managers on Leave (HRM-R01) ──────────────────────────────────────────────
// Managers = staff with active direct reports, plus the management pay grades chosen in Settings.
// The server decides who qualifies and computes days and the "back on" date; this screen filters,
// exports, emails the MD on demand, and edits the daily-email settings.

const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dmyOf = (v: string) => (v ? v.split('-').reverse().join('/') : '');

interface MolSettings {
  mol_include_direct_reports: string; mol_paygrades: string; mol_email_enabled: string;
  mol_recipients: string; mol_send_when_empty: string;
}

export function ManagersOnLeaveReport({ onClose, canExport }: { onClose: () => void; canExport: boolean }) {
  const { can } = useCan();
  const [data, setData] = useState<any[]>([]);
  const [basis, setBasis] = useState<{ direct_reports: boolean; paygrade_ids: string[] }>({ direct_reports: true, paygrade_ids: [] });
  const [grades, setGrades] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [f, setF] = useState({ from: todayYmd(), to: todayYmd(), department: '', branch: '', include: 'approved' });

  useEffect(() => {
    api.get('/salary/paygrades')
      .then(r => setGrades((r.data.data ?? r.data ?? []).map((g: any) => ({ id: String(g.id), label: g.name ?? String(g.id) }))))
      .catch(() => {});
  }, []);

  const load = () => {
    if (!f.from) return;
    setBusy(true);
    api.get('/reports/managers-on-leave', { params: { from: f.from, to: f.to || f.from, pending: f.include === 'all' ? '1' : undefined } })
      .then(r => { setData(r.data.data?.rows ?? []); setBasis(r.data.data?.basis ?? basis); })
      .catch(e => toast.error(e?.response?.data?.message ?? 'Failed to load managers on leave'))
      .finally(() => { setBusy(false); setLoading(false); });
  };
  useEffect(load, [f.from, f.to, f.include]);

  const deptOpts = useMemo(() => uniqOpts(data.map((r: any) => r.department)), [data]);
  const branchOpts = useMemo(() => uniqOpts(data.map((r: any) => r.branch)), [data]);
  const shown = useMemo(() => data.filter((r: any) =>
    (!f.department || r.department === f.department) && (!f.branch || r.branch === f.branch)), [data, f.department, f.branch]);

  // Eight columns so the whole row fits on screen and on a landscape page; branch is a filter, and a
  // leave that is not yet approved says so beside its type.
  const HEADERS = ['Manager', 'ID', 'Job Title', 'Department', 'Leave Type', 'From', 'To', 'Back On'];
  const approved = ['Approved', 'GL Scheduled', 'Paid', 'GL Failed'];
  const rows = shown.map((r: any) => [
    r.employee_name, r.employee_code, r.job_title, r.department,
    approved.includes(r.status) ? r.leave_type : `${r.leave_type} (${r.status})`,
    r.start_label, r.end_label, r.back_on_label,
  ] as Cell[]);

  const range = f.from === (f.to || f.from) ? dmyOf(f.from) : `${dmyOf(f.from)} → ${dmyOf(f.to)}`;
  const gradeNames = basis.paygrade_ids.map(id => grades.find(g => g.id === id)?.label ?? id);
  const basisText = [basis.direct_reports ? 'staff with direct reports' : '', gradeNames.length ? `grades ${gradeNames.join(', ')}` : '']
    .filter(Boolean).join(' and ') || 'nobody (no rule set)';

  const emailNow = async () => {
    setSending(true);
    try {
      const r = await api.post('/reports/managers-on-leave/email', { from: f.from, to: f.to || f.from, pending: f.include === 'all' });
      toast.success(r.data?.message ?? 'Report sent');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not send the email');
    } finally { setSending(false); }
  };

  return (
    <>
      <ReportModal
        title="Managers on Leave" subtitle="Managers away for the selected dates, with their cover period and return date"
        onClose={onClose} canExport={canExport} loading={loading} loadingText="Loading managers on leave…"
        filters={[
          { key: 'from', label: 'From', type: 'date' },
          { key: 'to', label: 'To', type: 'date' },
          { key: 'department', label: 'Department', type: 'select', options: deptOpts, allLabel: 'All departments', width: 'w-52' },
          { key: 'branch', label: 'Branch', type: 'select', options: branchOpts, allLabel: 'All branches', width: 'w-44' },
          { key: 'include', label: 'Include', type: 'select', width: 'w-52', options: [
            { id: 'approved', label: 'Approved leave' }, { id: 'all', label: 'Approved and pending' },
          ] },
        ]}
        values={f}
        onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v, ...(k === 'from' && (!p.to || p.to < v) ? { to: v } : {}) }))}
        onClear={() => setF(p => ({ ...p, department: '', branch: '' }))}
        actions={
          <div className="flex gap-2 self-end ml-auto">
            {can('export_reports') && (
              <button className="secondary-btn h-9" onClick={emailNow} disabled={sending || busy}>
                <Mail size={14} /> {sending ? 'Sending…' : 'Email to MD'}
              </button>
            )}
            {can('manage_settings') && (
              <button className="secondary-btn h-9" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={14} /> Settings
              </button>
            )}
          </div>
        }
        notice={
          <p className="text-[12.5px] text-[var(--text-muted)]">
            {busy ? 'Refreshing…' : <>{shown.length} manager{shown.length === 1 ? '' : 's'} on leave for {range}. Managers are {basisText}.</>}
          </p>
        }
        headers={HEADERS} rows={rows} total={data.length}
        summary={filterSummary([['Dates', range], ['Department', f.department], ['Branch', f.branch],
          ['Include', f.include === 'all' ? 'Approved and pending' : 'Approved']], `Dates: ${range}`)}
        emptyMessage={`No managers are on leave for ${range}.`}
      />
      {settingsOpen && (
        <ManagersOnLeaveSettings grades={grades} onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); load(); }} />
      )}
    </>
  );
}

function ManagersOnLeaveSettings({ grades, onClose, onSaved }: {
  grades: { id: string; label: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [s, setS] = useState<MolSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.get('/reports/managers-on-leave/settings')
      .then(r => setS(r.data.data))
      .catch(() => toast.error('Could not load the report settings'));
  }, []);
  const set = (k: keyof MolSettings, v: string) => setS(p => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      await api.put('/reports/managers-on-leave/settings', s);
      toast.success('Settings saved');
      onSaved();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not save the settings');
    } finally { setSaving(false); }
  };

  return (
    <FormModal title="Managers on Leave — Settings" subtitle="Who counts as a manager, and the daily email to the MD"
      onClose={onClose} onSave={save} saveLabel={saving ? 'Saving…' : 'Save'} maxWidth="lg">
      {!s ? <p className="text-sm text-[var(--text-muted)] py-6 text-center">Loading…</p> : (
        <div className="space-y-4">
          <FormField label="Count staff with direct reports as managers" hint="Anyone who is the supervisor of at least one active employee.">
            <select className={inputClass} value={s.mol_include_direct_reports} onChange={e => set('mol_include_direct_reports', e.target.value)}>
              <option value="Yes">Yes</option><option value="No">No</option>
            </select>
          </FormField>
          <FormField label="Management pay grades" hint="Everyone on these grades counts as a manager, with or without direct reports.">
            <MultiSearchSelect value={s.mol_paygrades ? s.mol_paygrades.split(',') : []}
              onChange={v => set('mol_paygrades', v.join(','))} options={grades} placeholder="Choose grades…" />
          </FormField>
          <FormField label="Send the report by email every weekday at 07:30">
            <select className={inputClass} value={s.mol_email_enabled} onChange={e => set('mol_email_enabled', e.target.value)}>
              <option value="0">No</option><option value="1">Yes</option>
            </select>
          </FormField>
          <FormField label="Send to" hint="The MD's email address. Separate several addresses with commas.">
            <input className={inputClass} value={s.mol_recipients} placeholder="md@bank.com"
              onChange={e => set('mol_recipients', e.target.value)} />
          </FormField>
          <FormField label="Also send on days when no manager is on leave">
            <select className={inputClass} value={s.mol_send_when_empty} onChange={e => set('mol_send_when_empty', e.target.value)}>
              <option value="0">No</option><option value="1">Yes</option>
            </select>
          </FormField>
        </div>
      )}
    </FormModal>
  );
}
