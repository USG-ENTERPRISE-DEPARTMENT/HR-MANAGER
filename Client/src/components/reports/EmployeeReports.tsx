import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { uniqOpts } from '../ui/reportTools';
import { ReportModal, filterSummary, day, fullName, type Cell } from './ReportModal';

// Legacy IceHRM "Employee Information" reports: Active, New Hires and Terminated employees.
// All three read the enriched /employees list and filter it client-side.

const SEPARATED = ['TERMINATED', 'RESIGNED'];
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

function useEmployees() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/employees')
      .then(r => setData(r.data.data ?? []))
      .catch(() => toast.error('Failed to load employee data'))
      .finally(() => setLoading(false));
  }, []);
  const deptOpts = useMemo(() => uniqOpts(data.map((e: any) => e.department?.title)), [data]);
  const branchOpts = useMemo(() => uniqOpts(data.map((e: any) => e.branch?.title)), [data]);
  return { data, loading, deptOpts, branchOpts };
}

const byName = (a: any, b: any) => fullName(a).localeCompare(fullName(b));

// Active = employed today: joined on or before today, no termination on or before today, and not
// separated or still awaiting approval. Mirrors the legacy joined-date / termination-date rule.
export function ActiveEmployeesReport({ onClose, canExport }: { onClose: () => void; canExport: boolean }) {
  const { data, loading, deptOpts, branchOpts } = useEmployees();
  const [f, setF] = useState({ department: '', branch: '' });
  const asOf = today();

  const active = useMemo(() => data.filter((e: any) => {
    if (SEPARATED.includes(e.lifecycleStatus) || e.lifecycleStatus === 'PENDING') return false;
    const hire = day(e.hireDate);
    const term = day(e.termination_date);
    if (hire && hire > asOf) return false;
    if (term && term <= asOf) return false;
    return true;
  }), [data, asOf]);

  const HEADERS = ['Employee ID', 'Name', 'Department', 'Branch', 'Job Title', 'Employment Status', 'Pay Grade', 'Hire Date', 'Supervisor', 'Status'];
  const rows = useMemo(() => active
    .filter((e: any) => (!f.department || e.department?.title === f.department) && (!f.branch || e.branch?.title === f.branch))
    .sort(byName)
    .map((e: any) => [
      e.employee_id ?? '', fullName(e), e.department?.title ?? '', e.branch?.title ?? '', e.jobTitle?.label ?? '',
      e.employmentStatus?.label ?? '', e.paygrade ?? '', day(e.hireDate), e.supervisor?.name ?? '', e.lifecycleStatus ?? '',
    ] as Cell[]), [active, f]);

  return (
    <ReportModal
      title="Active Employee Report" subtitle={`Employees in service as at ${asOf}`} onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading employee data…"
      filters={[
        { key: 'department', label: 'Department', type: 'select', options: deptOpts, allLabel: 'All departments' },
        { key: 'branch', label: 'Branch', type: 'select', options: branchOpts, allLabel: 'All branches' },
      ]}
      values={f} onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v }))} onClear={() => setF({ department: '', branch: '' })}
      headers={HEADERS} rows={rows} total={active.length}
      summary={`As at ${asOf}  ·  ` + filterSummary([['Department', f.department], ['Branch', f.branch]], 'All departments and branches')}
      emptyMessage={data.length ? 'No active employees match the selected filters.' : 'No employee data found.'}
    />
  );
}

export function NewHiresReport({ onClose, canExport }: { onClose: () => void; canExport: boolean }) {
  const { data, loading, deptOpts } = useEmployees();
  const [f, setF] = useState({ department: '', from: yearStart(), to: today() });

  const HEADERS = ['Employee ID', 'Name', 'Department', 'Branch', 'Job Title', 'Employment Status', 'Hire Date', 'Supervisor', 'Status'];
  const hired = useMemo(() => data.filter((e: any) => {
    const hire = day(e.hireDate);
    return hire && (!f.from || hire >= f.from) && (!f.to || hire <= f.to);
  }), [data, f.from, f.to]);
  const rows = useMemo(() => hired
    .filter((e: any) => !f.department || e.department?.title === f.department)
    .sort((a: any, b: any) => day(a.hireDate).localeCompare(day(b.hireDate)) || byName(a, b))
    .map((e: any) => [
      e.employee_id ?? '', fullName(e), e.department?.title ?? '', e.branch?.title ?? '', e.jobTitle?.label ?? '',
      e.employmentStatus?.label ?? '', day(e.hireDate), e.supervisor?.name ?? '', e.lifecycleStatus ?? '',
    ] as Cell[]), [hired, f.department]);

  return (
    <ReportModal
      title="New Hires Employee Report" subtitle="Employees who joined between two dates" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading employee data…"
      filters={[
        { key: 'department', label: 'Department', type: 'select', options: deptOpts, allLabel: 'All departments' },
        { key: 'from', label: 'Joined From', type: 'date' },
        { key: 'to', label: 'Joined To', type: 'date' },
      ]}
      values={f} onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v }))}
      onClear={() => setF(p => ({ ...p, department: '' }))}
      headers={HEADERS} rows={rows} total={hired.length}
      summary={filterSummary([['Joined', `${f.from || '…'} → ${f.to || '…'}`], ['Department', f.department]], '')}
      emptyMessage="No employees joined in this period."
    />
  );
}

export function TerminatedEmployeesReport({ onClose, canExport }: { onClose: () => void; canExport: boolean }) {
  const { data, loading, deptOpts } = useEmployees();
  const [f, setF] = useState({ department: '', status: '', from: yearStart(), to: today() });

  // Separated staff: a termination date, or a Terminated/Resigned lifecycle. The period filters on
  // the termination date, so staff separated without one are listed only when no period is set.
  const separated = useMemo(() => data.filter((e: any) => {
    if (!SEPARATED.includes(e.lifecycleStatus) && !e.termination_date) return false;
    const term = day(e.termination_date);
    if ((f.from || f.to) && !term) return false;
    return (!f.from || term >= f.from) && (!f.to || term <= f.to);
  }), [data, f.from, f.to]);

  const years = (from: string, to: string) => {
    if (!from || !to) return '';
    const y = (new Date(to).getTime() - new Date(from).getTime()) / (365.25 * 86400000);
    return y >= 0 ? y.toFixed(1) : '';
  };
  const HEADERS = ['Employee ID', 'Name', 'Department', 'Job Title', 'Hire Date', 'Termination Date', 'Years of Service', 'Status', 'Reason'];
  const rows = useMemo(() => separated
    .filter((e: any) => (!f.department || e.department?.title === f.department) && (!f.status || e.lifecycleStatus === f.status))
    .sort((a: any, b: any) => day(a.termination_date).localeCompare(day(b.termination_date)) || byName(a, b))
    .map((e: any) => [
      e.employee_id ?? '', fullName(e), e.department?.title ?? '', e.jobTitle?.label ?? '', day(e.hireDate),
      day(e.termination_date), years(day(e.hireDate), day(e.termination_date)), e.lifecycleStatus ?? '', e.actionReason ?? '',
    ] as Cell[]), [separated, f.department, f.status]);

  return (
    <ReportModal
      title="Terminated Employee Report" subtitle="Employees who left between two dates" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading employee data…"
      filters={[
        { key: 'department', label: 'Department', type: 'select', options: deptOpts, allLabel: 'All departments' },
        { key: 'status', label: 'Status', type: 'select', width: 'w-40', allLabel: 'All',
          options: [{ id: 'TERMINATED', label: 'Terminated' }, { id: 'RESIGNED', label: 'Resigned' }] },
        { key: 'from', label: 'Left From', type: 'date' },
        { key: 'to', label: 'Left To', type: 'date' },
      ]}
      values={f} onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v }))}
      onClear={() => setF(p => ({ ...p, department: '', status: '' }))}
      headers={HEADERS} rows={rows} total={separated.length}
      summary={filterSummary([['Left', (f.from || f.to) ? `${f.from || '…'} → ${f.to || '…'}` : ''], ['Department', f.department], ['Status', f.status]], 'All separated employees')}
      emptyMessage="No employees left in this period."
    />
  );
}
