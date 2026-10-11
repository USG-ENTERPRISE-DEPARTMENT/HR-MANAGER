import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { uniqOpts } from '../ui/reportTools';
import { ReportModal, filterSummary, day, fullName, type Cell } from './ReportModal';

// Legacy IceHRM "Leave Management" reports: Employee Leaves (one row per application) and
// Employee Leave Entitlement (balances for the active leave period).

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
