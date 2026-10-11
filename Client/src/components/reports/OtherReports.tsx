import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { uniqOpts } from '../ui/reportTools';
import { ReportModal, filterSummary, day, type Cell } from './ReportModal';

type Props = { onClose: () => void; canExport: boolean };

// Legacy IceHRM "Job Positions Report": every vacancy with its status and how many applied.
export function JobPositionsReport({ onClose, canExport }: Props) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ department: '', status: '' });

  useEffect(() => {
    Promise.all([api.get('/recruitment/jobs'), api.get('/recruitment/applications').catch(() => ({ data: { data: [] } }))])
      .then(([j, a]) => { setJobs(j.data.data ?? []); setApps(a.data.data ?? []); })
      .catch(() => toast.error('Failed to load job positions'))
      .finally(() => setLoading(false));
  }, []);

  const appCount = useMemo(() => {
    const m = new Map<string, number>();
    apps.forEach((a: any) => m.set(String(a.job), (m.get(String(a.job)) ?? 0) + 1));
    return m;
  }, [apps]);
  const deptOpts = useMemo(() => uniqOpts(jobs.map((j: any) => j.department)), [jobs]);
  const statusOpts = useMemo(() => uniqOpts(jobs.map((j: any) => j.status)), [jobs]);

  const HEADERS = ['Code', 'Job Title', 'Department', 'Employment Type', 'Hiring Manager', 'Location', 'Reason', 'Status', 'Closing Date', 'Applications'];
  const rows = useMemo(() => jobs
    .filter((j: any) => (!f.department || j.department === f.department) && (!f.status || j.status === f.status))
    .map((j: any) => [
      j.code ?? '', j.title ?? '', j.department ?? '', j.employementType ?? '', j.hiringManager ?? '',
      [j.location, j.country].filter(Boolean).join(', '), j.positionReason ?? '', j.status ?? '', day(j.closingDate),
      appCount.get(String(j.id)) ?? 0,
    ] as Cell[]), [jobs, f, appCount]);

  return (
    <ReportModal
      title="Job Positions Report" subtitle="All vacancies in the company" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading job positions…"
      filters={[
        { key: 'department', label: 'Department', type: 'select', options: deptOpts, allLabel: 'All departments' },
        { key: 'status', label: 'Status', type: 'select', options: statusOpts, allLabel: 'All statuses', width: 'w-44' },
      ]}
      values={f} onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v }))} onClear={() => setF({ department: '', status: '' })}
      headers={HEADERS} rows={rows} total={jobs.length}
      summary={filterSummary([['Department', f.department], ['Status', f.status]], 'All job positions')}
      emptyMessage={jobs.length ? 'No job positions match the selected filters.' : 'No job positions found.'}
    />
  );
}

// Legacy IceHRM "Employee Attendance Report": attendance entries by employee and date range.
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const time = (v: unknown) => {
  const s = String(v ?? '');
  const m = s.match(/(\d{2}:\d{2})(:\d{2})?/);
  return m ? m[1] : s;
};
const hours = (mins: unknown) => (mins == null || mins === '' ? '' : (Number(mins) / 60).toFixed(2));

export function AttendanceReport({ onClose, canExport }: Props) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({ from: monthStart(), to: new Date().toISOString().slice(0, 10), employee: '', department: '', status: '' });

  useEffect(() => {
    if (!f.from || !f.to) { setData([]); return; }
    setLoading(true);
    api.get('/attendance', { params: { date_from: f.from, date_to: f.to } })
      .then(r => setData(r.data.data ?? []))
      .catch(() => toast.error('Failed to load attendance'))
      .finally(() => setLoading(false));
  }, [f.from, f.to]);

  const empOpts = useMemo(() => uniqOpts(data.map((a: any) => a.employee_name)), [data]);
  const deptOpts = useMemo(() => uniqOpts(data.map((a: any) => a.department_name)), [data]);
  const statusOpts = useMemo(() => uniqOpts(data.map((a: any) => a.day_status)), [data]);

  const HEADERS = ['Date', 'Employee', 'ID', 'Department', 'In', 'Out', 'Worked (h)', 'Late (min)', 'Early Leave (min)', 'Overtime (min)', 'Status', 'Note'];
  const rows = useMemo(() => data
    .filter((a: any) => (!f.employee || a.employee_name === f.employee) && (!f.department || a.department_name === f.department) && (!f.status || a.day_status === f.status))
    .sort((a: any, b: any) => String(a.employee_name ?? '').localeCompare(String(b.employee_name ?? '')) || day(a.date).localeCompare(day(b.date)))
    .map((a: any) => [
      day(a.date), a.employee_name ?? '', a.employee_no ?? '', a.department_name ?? '', time(a.in_time), a.out_time ? time(a.out_time) : '',
      hours(a.worked_minutes), a.late_minutes ?? '', a.early_leave_minutes ?? '', a.overtime_minutes ?? '', a.day_status ?? '', a.note ?? '',
    ] as Cell[]), [data, f.employee, f.department, f.status]);

  return (
    <ReportModal
      title="Employee Attendance Report" subtitle="Attendance entries by employee and date range" onClose={onClose} canExport={canExport}
      filters={[
        { key: 'from', label: 'Start Date', type: 'date' },
        { key: 'to', label: 'End Date', type: 'date' },
        { key: 'employee', label: 'Employee', type: 'select', options: empOpts, allLabel: 'All employees' },
        { key: 'department', label: 'Department', type: 'select', options: deptOpts, allLabel: 'All departments', width: 'w-44' },
        { key: 'status', label: 'Status', type: 'select', options: statusOpts, allLabel: 'All statuses', width: 'w-40' },
      ]}
      values={f} onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v }))}
      onClear={() => setF(p => ({ ...p, employee: '', department: '', status: '' }))}
      headers={HEADERS} rows={rows} total={data.length}
      summary={filterSummary([['Dates', `${f.from || '…'} → ${f.to || '…'}`], ['Employee', f.employee], ['Department', f.department], ['Status', f.status]], '')}
      emptyMessage={data.length ? 'No attendance entries match the selected filters.' : 'No attendance recorded in this period.'}
    >
      {loading ? <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading attendance…</p> : undefined}
    </ReportModal>
  );
}
