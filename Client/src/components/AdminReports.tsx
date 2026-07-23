import { useState, useEffect, useMemo, type ComponentType } from 'react';
import { Download, FileText, Users, Receipt, Stethoscope, FileSpreadsheet, X, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { exportReportExcel, reportPdf, ReportPreview, fmtAmt, uniqOpts } from './ui/reportTools';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormModal } from './ui/FormModal';
import { AnimatePresence } from 'motion/react';
import { FormField, inputClass } from './ui/FormField';
import { SearchSelect } from './ui/SearchSelect';
import api from '../../lib/api';
import { useCan } from '@/hooks/useCan';
import { PageHeader } from './ui/PageHeader';

interface Report {
  id: number;
  name: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  action?: () => void;
  actionLabel?: string;
  exportOnly?: boolean;   // only relevant when the user can export (pure download report)
}

export function AdminReports() {
  const { can } = useCan();
  const canExport = can('export_reports');   // gates all Excel / PDF export actions
  const [searchQuery, setSearchQuery] = useState('');

  // Medical utilisation modal state
  const [medOpen,    setMedOpen]    = useState(false);
  const [medRows,    setMedRows]    = useState<any[]>([]);
  const [medLoading, setMedLoading] = useState(false);
  const [medPdfBusy, setMedPdfBusy] = useState(false);
  const [medFilters, setMedFilters] = useState({ employee: '', grade: '', band: '' });
  const setMedFilter = (k: keyof typeof medFilters, v: string) => setMedFilters(p => ({ ...p, [k]: v }));
  const medFilterCount = Object.values(medFilters).filter(Boolean).length;

  function openMedicalReport() {
    setMedOpen(true);
    if (medRows.length === 0) {
      setMedLoading(true);
      api.get('/medical/enquiry')
        .then(r => setMedRows(r.data.data ?? []))
        .catch(() => toast.error('Failed to load medical data'))
        .finally(() => setMedLoading(false));
    }
  }

  const MED_BANDS = [
    { id: 'no-limit', label: 'No limit set' },
    { id: 'under-50', label: 'Under 50% used' },
    { id: '50-79',    label: '50% – 79% used' },
    { id: '80-99',    label: '80% – 99% used' },
    { id: '100-plus', label: '100% used or over' },
  ];
  const medPct = (r: any) => {
    const limit = Number(r.medical_limit ?? 0);
    if (!limit) return null;
    return (Number(r.total_utilized ?? 0) / limit) * 100;
  };
  const medGradeOpts = useMemo(() => uniqOpts(medRows.map((r: any) => r.grade)), [medRows]);
  const medEmpOpts   = useMemo(() => uniqOpts(medRows.map((r: any) => r.employee_name)), [medRows]);
  const MED_HEADERS = ['Employee', 'ID', 'Pay Grade', 'Currency', 'Medical Limit', 'Staff Used', 'Dependent Used', 'Total Used', 'Balance', 'Utilisation %'];
  const medFiltered = useMemo(() => medRows.filter((r: any) => {
    if (medFilters.employee && r.employee_name !== medFilters.employee) return false;
    if (medFilters.grade && r.grade !== medFilters.grade) return false;
    if (medFilters.band) {
      const pct = medPct(r);
      if (medFilters.band === 'no-limit'  && pct !== null) return false;
      if (medFilters.band === 'under-50' && (pct === null || pct >= 50)) return false;
      if (medFilters.band === '50-79'    && (pct === null || pct < 50 || pct >= 80)) return false;
      if (medFilters.band === '80-99'    && (pct === null || pct < 80 || pct >= 100)) return false;
      if (medFilters.band === '100-plus' && (pct === null || pct < 100)) return false;
    }
    return true;
  }), [medRows, medFilters]);
  const medRow = (r: any) => {
    const pct = medPct(r);
    return [
      r.employee_name ?? '', r.employee_empid ?? '', r.grade ?? '', r.currency ?? '',
      r.medical_limit != null ? fmtAmt(Number(r.medical_limit)) : '—',
      fmtAmt(Number(r.staff_utilized ?? 0)),
      fmtAmt(Number(r.dep_utilized ?? 0)),
      fmtAmt(Number(r.total_utilized ?? 0)),
      r.limit_balance != null ? fmtAmt(Number(r.limit_balance)) : '—',
      pct !== null ? `${Math.round(pct)}%` : '—',
    ] as (string | number)[];
  };
  const medSummary = () => {
    const p: string[] = [];
    if (medFilters.employee) p.push(`Employee: ${medFilters.employee}`);
    if (medFilters.grade) p.push(`Pay Grade: ${medFilters.grade}`);
    if (medFilters.band)  p.push(`Utilisation: ${MED_BANDS.find(b => b.id === medFilters.band)?.label}`);
    return p.length ? p.join('  ·  ') : 'All employees — no filters applied';
  };

  // ── Performance Report state ───────────────────────────────────────────────
  const [perfOpen,    setPerfOpen]    = useState(false);
  const [perfRows,    setPerfRows]    = useState<any[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfPdfBusy, setPerfPdfBusy] = useState(false);
  const [perfFilters, setPerfFilters] = useState({ employee: '', cycle: '', status: '' });
  const setPerfFilter = (k: keyof typeof perfFilters, v: string) => setPerfFilters(p => ({ ...p, [k]: v }));
  const perfFilterCount = Object.values(perfFilters).filter(Boolean).length;

  function openPerformanceReport() {
    setPerfOpen(true);
    if (perfRows.length === 0) {
      setPerfLoading(true);
      api.get('/performance/reviews', { params: { limit: 10000 } })
        .then(r => { const d = r.data.data ?? r.data; setPerfRows(d.records ?? d ?? []); })
        .catch(() => toast.error('Failed to load performance data'))
        .finally(() => setPerfLoading(false));
    }
  }

  const PERF_HEADERS = ['Employee', 'Cycle', 'Status', 'Self', 'Supervisor', 'HR', 'Overall'];
  const perfEmpOpts   = useMemo(() => uniqOpts(perfRows.map((r: any) => r.employee?.name)), [perfRows]);
  const perfCycleOpts = useMemo(() => uniqOpts(perfRows.map((r: any) => r.cycle_name)), [perfRows]);
  const perfStatusOpts = useMemo(() => uniqOpts(perfRows.map((r: any) => r.status)), [perfRows]);
  const perfFiltered = useMemo(() => perfRows.filter((r: any) => {
    if (perfFilters.employee && (r.employee?.name ?? '') !== perfFilters.employee) return false;
    if (perfFilters.cycle    && (r.cycle_name ?? '')     !== perfFilters.cycle)    return false;
    if (perfFilters.status   && (r.status ?? '')         !== perfFilters.status)   return false;
    return true;
  }), [perfRows, perfFilters]);
  const sc = (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v);
  const perfRow = (r: any) => [
    r.employee?.name ?? '—', r.cycle_name ?? '—', r.status ?? '—',
    sc(r.self_score), sc(r.supervisor_score), sc(r.hr_score), sc(r.overall_score),
  ] as (string | number)[];
  const perfSummary = () => {
    const p: string[] = [];
    if (perfFilters.employee) p.push(`Employee: ${perfFilters.employee}`);
    if (perfFilters.cycle)    p.push(`Cycle: ${perfFilters.cycle}`);
    if (perfFilters.status)   p.push(`Status: ${perfFilters.status}`);
    return p.length ? p.join('  ·  ') : 'All employees — no filters applied';
  };

  // ── Employee Details Report state ──────────────────────────────────────────
  const [empOpen, setEmpOpen]           = useState(false);
  const [empData, setEmpData]           = useState<any[]>([]);
  const [empReportLoading, setEmpReportLoading] = useState(false);
  const [pdfBusy, setPdfBusy]           = useState(false);
  const [empFilters, setEmpFilters] = useState({
    department: '', jobTitle: '', employmentStatus: '', lifecycleStatus: '',
    hireFrom: '', hireTo: '',
  });
  const setEmpFilter = (k: keyof typeof empFilters, v: string) => setEmpFilters(p => ({ ...p, [k]: v }));
  const clearEmpFilters = () => setEmpFilters({ department: '', jobTitle: '', employmentStatus: '', lifecycleStatus: '', hireFrom: '', hireTo: '' });
  const empFilterCount = Object.values(empFilters).filter(Boolean).length;

  function ensureEmployees() {
    if (empData.length === 0) {
      setEmpReportLoading(true);
      api.get('/employees')
        .then(r => setEmpData(r.data.data ?? []))
        .catch(() => toast.error('Failed to load employee data'))
        .finally(() => setEmpReportLoading(false));
    }
  }

  function openEmployeeReport() {
    setEmpOpen(true);
    ensureEmployees();
  }

  // Filter option lists derived from the data itself
  const deptOpts   = useMemo(() => uniqOpts(empData.map((e: any) => e.department?.title)), [empData]);
  const jtOpts     = useMemo(() => uniqOpts(empData.map((e: any) => e.jobTitle?.label)), [empData]);
  const empStOpts  = useMemo(() => uniqOpts(empData.map((e: any) => e.employmentStatus?.label)), [empData]);
  const lifeOpts   = useMemo(() => uniqOpts(empData.map((e: any) => e.lifecycleStatus)), [empData]);

  const empFiltered = useMemo(() => empData.filter((e: any) => {
    if (empFilters.department       && e.department?.title       !== empFilters.department)       return false;
    if (empFilters.jobTitle         && e.jobTitle?.label         !== empFilters.jobTitle)         return false;
    if (empFilters.employmentStatus && e.employmentStatus?.label !== empFilters.employmentStatus) return false;
    if (empFilters.lifecycleStatus  && e.lifecycleStatus         !== empFilters.lifecycleStatus)  return false;
    const hire = e.hireDate ? String(e.hireDate).slice(0, 10) : '';
    if (empFilters.hireFrom && (!hire || hire < empFilters.hireFrom)) return false;
    if (empFilters.hireTo   && (!hire || hire > empFilters.hireTo))   return false;
    return true;
  }), [empData, empFilters]);

  const EMP_HEADERS = ['Employee ID', 'Name', 'Gender', 'Work Email', 'Phone', 'Department', 'Branch', 'Job Title', 'Employment Status', 'Staff Level', 'Hire Date', 'Status'];
  const empRow = (e: any) => [
    e.employee_id ?? '',
    `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
    e.gender?.label ?? '',
    e.work_email ?? e.email ?? '',
    e.phone ?? '',
    e.department?.title ?? '',
    e.branch?.title ?? '',
    e.jobTitle?.label ?? '',
    e.employmentStatus?.label ?? '',
    e.staffLevel?.label ?? '',
    e.hireDate ? String(e.hireDate).slice(0, 10) : '',
    e.lifecycleStatus ?? '',
  ];

  const empFilterSummary = () => {
    const parts: string[] = [];
    if (empFilters.department)       parts.push(`Department: ${empFilters.department}`);
    if (empFilters.jobTitle)         parts.push(`Job Title: ${empFilters.jobTitle}`);
    if (empFilters.employmentStatus) parts.push(`Employment: ${empFilters.employmentStatus}`);
    if (empFilters.lifecycleStatus)  parts.push(`Status: ${empFilters.lifecycleStatus}`);
    if (empFilters.hireFrom || empFilters.hireTo) parts.push(`Hired: ${empFilters.hireFrom || '…'} → ${empFilters.hireTo || '…'}`);
    return parts.length ? parts.join('  ·  ') : 'All employees — no filters applied';
  };

  function exportEmployeeExcel() {
    if (!empFiltered.length) { toast.error('No employees match the selected filters'); return; }
    const aoa = [
      ['Employee Details Report'],
      [`Generated ${new Date().toLocaleString()}`],
      [empFilterSummary()],
      [],
      EMP_HEADERS,
      ...empFiltered.map(empRow),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = EMP_HEADERS.map((h, c) => ({
      wch: Math.max(h.length, ...empFiltered.slice(0, 100).map(e => String(empRow(e)[c] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, `employee-details-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function downloadEmployeePdf() {
    if (!empFiltered.length) { toast.error('No employees match the selected filters'); return; }
    setPdfBusy(true);
    try {
      const res = await api.post('/reports/table.pdf', {
        title: 'Employee Details Report',
        subtitle: empFilterSummary(),
        headers: EMP_HEADERS,
        rows: empFiltered.map(empRow),
        landscape: true,
      }, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `employee-details-report-${new Date().toISOString().slice(0, 10)}.pdf` });
      a.click();
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch (e: any) {
      toast.error(await blobErrMessage(e));
    } finally { setPdfBusy(false); }
  }

  // ── Payroll Summary report state ────────────────────────────────────────────
  const [paySumOpen,    setPaySumOpen]    = useState(false);
  const [paySumRun,     setPaySumRun]     = useState('');
  const [paySumCells,   setPaySumCells]   = useState<any[]>([]);
  const [paySumLoading, setPaySumLoading] = useState(false);
  const [paySumPdfBusy, setPaySumPdfBusy] = useState(false);

  function openPayrollSummary() {
    setPaySumOpen(true);
    setPaySumRun('');
    setPaySumCells([]);
    ensureRuns();
  }

  useEffect(() => {
    if (!paySumRun) { setPaySumCells([]); return; }
    setPaySumLoading(true);
    api.get(`/payroll/runs/${paySumRun}/data`)
      .then(r => {
        const rd = r.data.data;
        setPaySumCells(Array.isArray(rd) ? rd : (rd?.cells ?? []));
      })
      .catch(() => toast.error('Failed to load payroll run data'))
      .finally(() => setPaySumLoading(false));
  }, [paySumRun]);

  const PAYSUM_HEADERS = ['Employee', 'Total Earnings', 'Total Deductions', 'Net Pay'];
  const paySum = useMemo(() => {
    const byEmp = new Map<string, { name: string; pay: number; ded: number }>();
    paySumCells.forEach((c: any) => {
      if (c.visible === 0) return;
      const k = String(c.employee);
      if (!byEmp.has(k)) byEmp.set(k, { name: c.emp_name ?? `Employee ${k}`, pay: 0, ded: 0 });
      const e = byEmp.get(k)!;
      const amt = parseFloat(c.amount || '0') || 0;
      if (c.payment_deduction === 'Deduction') e.ded += amt; else e.pay += amt;
    });
    const list = [...byEmp.values()].sort((a, b) => a.name.localeCompare(b.name));
    const totals = list.reduce((t, e) => ({ pay: t.pay + e.pay, ded: t.ded + e.ded }), { pay: 0, ded: 0 });
    return {
      rows: list.map(e => [e.name, fmtAmt(e.pay), fmtAmt(e.ded), fmtAmt(e.pay - e.ded)]) as (string | number)[][],
      foot: ['Total', fmtAmt(totals.pay), fmtAmt(totals.ded), fmtAmt(totals.pay - totals.ded)] as (string | number)[],
    };
  }, [paySumCells]);
  // ── Leave Utilization report state ──────────────────────────────────────────
  const [leaveOpen,    setLeaveOpen]    = useState(false);
  const [leaveData,    setLeaveData]    = useState<any[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leavePdfBusy, setLeavePdfBusy] = useState(false);
  const [leaveFilters, setLeaveFilters] = useState({ employee: '', type: '', period: '', status: '', from: '', to: '' });
  const setLeaveFilter = (k: keyof typeof leaveFilters, v: string) => setLeaveFilters(p => ({ ...p, [k]: v }));
  const leaveFilterCount = Object.values(leaveFilters).filter(Boolean).length;

  function openLeaveReport() {
    setLeaveOpen(true);
    if (leaveData.length === 0) {
      setLeaveLoading(true);
      api.get('/leave/leaves?all=1')
        .then(r => setLeaveData(r.data.data ?? []))
        .catch(() => toast.error('Failed to load leave data'))
        .finally(() => setLeaveLoading(false));
    }
  }

  const leaveEmpOpts    = useMemo(() => uniqOpts(leaveData.map((l: any) => l.employee_name)), [leaveData]);
  const leaveTypeOpts   = useMemo(() => uniqOpts(leaveData.map((l: any) => l.leave_type_name ?? l.leave_name)), [leaveData]);
  const leavePeriodOpts = useMemo(() => uniqOpts(leaveData.map((l: any) => l.period_name)), [leaveData]);
  const leaveStatusOpts = useMemo(() => uniqOpts(leaveData.map((l: any) => l.status)), [leaveData]);

  const LEAVE_HEADERS = ['Employee', 'ID', 'Leave Type', 'Requests', 'Approved Days', 'Pending Days', 'Rejected'];
  const leaveKey = (l: any) => `${l.employee}|${l.leave_type_name ?? l.leave_name}`;
  const leaveAggTotal = useMemo(() => new Set(leaveData.map(leaveKey)).size, [leaveData]);
  const leaveRows = useMemo(() => {
    const apps = leaveData.filter((l: any) => {
      if (leaveFilters.employee && l.employee_name !== leaveFilters.employee) return false;
      if (leaveFilters.type   && (l.leave_type_name ?? l.leave_name) !== leaveFilters.type) return false;
      if (leaveFilters.period && l.period_name !== leaveFilters.period) return false;
      if (leaveFilters.status && l.status !== leaveFilters.status) return false;
      const start = l.date_start ? String(l.date_start).slice(0, 10) : '';
      if (leaveFilters.from && (!start || start < leaveFilters.from)) return false;
      if (leaveFilters.to   && (!start || start > leaveFilters.to))   return false;
      return true;
    });
    const map = new Map<string, any>();
    apps.forEach((l: any) => {
      const k = leaveKey(l);
      if (!map.has(k)) map.set(k, { name: l.employee_name ?? '', code: l.employee_code ?? '', type: l.leave_type_name ?? l.leave_name ?? '', requests: 0, approved: 0, pending: 0, rejected: 0 });
      const a = map.get(k);
      a.requests++;
      const days = Number(l.day_count ?? 0) || 0;
      const st = String(l.status ?? '');
      if (st === 'Approved' || st === 'Taken') a.approved += days;
      else if (st.startsWith('Pending')) a.pending += days;
      else if (st === 'Rejected') a.rejected++;
    });
    return [...map.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(a => [a.name, a.code, a.type, a.requests, a.approved, a.pending, a.rejected]) as (string | number)[][];
  }, [leaveData, leaveFilters]);
  const leaveSummary = () => {
    const p: string[] = [];
    if (leaveFilters.employee) p.push(`Employee: ${leaveFilters.employee}`);
    if (leaveFilters.type)   p.push(`Type: ${leaveFilters.type}`);
    if (leaveFilters.period) p.push(`Period: ${leaveFilters.period}`);
    if (leaveFilters.status) p.push(`Status: ${leaveFilters.status}`);
    if (leaveFilters.from || leaveFilters.to) p.push(`Starting: ${leaveFilters.from || '…'} → ${leaveFilters.to || '…'}`);
    return p.length ? p.join('  ·  ') : 'All leave applications — no filters applied';
  };

  // ── Department Headcount report state ───────────────────────────────────────
  const [deptOpen,    setDeptOpen]    = useState(false);
  const [deptPdfBusy, setDeptPdfBusy] = useState(false);
  const [deptFilters, setDeptFilters] = useState({ branch: '', employmentStatus: '', lifecycleStatus: '' });
  const setDeptFilter = (k: keyof typeof deptFilters, v: string) => setDeptFilters(p => ({ ...p, [k]: v }));
  const deptFilterCount = Object.values(deptFilters).filter(Boolean).length;

  function openDeptReport() {
    setDeptOpen(true);
    ensureEmployees();
  }

  const branchOpts = useMemo(() => uniqOpts(empData.map((e: any) => e.branch?.title)), [empData]);
  const DEPT_HEADERS = ['Department', 'Headcount', 'Active', '% of Workforce'];
  const deptReport = useMemo(() => {
    const filtered = empData.filter((e: any) => {
      if (deptFilters.branch           && e.branch?.title           !== deptFilters.branch)           return false;
      if (deptFilters.employmentStatus && e.employmentStatus?.label !== deptFilters.employmentStatus) return false;
      if (deptFilters.lifecycleStatus  && e.lifecycleStatus         !== deptFilters.lifecycleStatus)  return false;
      return true;
    });
    const map = new Map<string, { count: number; active: number }>();
    filtered.forEach((e: any) => {
      const d = e.department?.title ?? 'Unassigned';
      if (!map.has(d)) map.set(d, { count: 0, active: 0 });
      const v = map.get(d)!;
      v.count++;
      if (e.lifecycleStatus === 'ACTIVE') v.active++;
    });
    const total = filtered.length;
    const activeTotal = filtered.filter((e: any) => e.lifecycleStatus === 'ACTIVE').length;
    return {
      rows: [...map.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .map(([dept, v]) => [dept, v.count, v.active, total ? `${Math.round((v.count / total) * 100)}%` : '0%']) as (string | number)[][],
      foot: ['Total', total, activeTotal, total ? '100%' : '0%'] as (string | number)[],
    };
  }, [empData, deptFilters]);
  const deptSummary = () => {
    const p: string[] = [];
    if (deptFilters.branch)           p.push(`Branch: ${deptFilters.branch}`);
    if (deptFilters.employmentStatus) p.push(`Employment: ${deptFilters.employmentStatus}`);
    if (deptFilters.lifecycleStatus)  p.push(`Status: ${deptFilters.lifecycleStatus}`);
    return p.length ? p.join('  ·  ') : 'All employees — no filters applied';
  };

  // Payslip report state
  const [payslipOpen,   setPayslipOpen]   = useState(false);
  const [runs,          setRuns]          = useState<any[]>([]);
  const [runsLoading,   setRunsLoading]   = useState(false);
  const [selectedRun,   setSelectedRun]   = useState('');
  const [downloading,   setDownloading]   = useState(false);
  const [employees,     setEmployees]     = useState<any[]>([]);
  const [empLoading,    setEmpLoading]    = useState(false);
  const [selectedEmp,   setSelectedEmp]   = useState('all');

  const paySumRunName = runs.find((r: any) => String(r.id) === paySumRun)?.name ?? '';
  const paySumSummary = paySumRun ? `Payroll run: ${paySumRunName}` : 'No run selected';

  function ensureRuns() {
    if (runs.length === 0) {
      setRunsLoading(true);
      api.get('/payroll/runs')
        .then(r => setRuns((r.data.data ?? []).filter((x: any) => x.status === 'Completed' || x.status === 'Approved')))
        .catch(() => toast.error('Failed to load payroll runs'))
        .finally(() => setRunsLoading(false));
    }
  }

  function openPayslipReport() {
    setPayslipOpen(true);
    setSelectedRun('');
    setSelectedEmp('all');
    setEmployees([]);
    ensureRuns();
  }

  useEffect(() => {
    if (!selectedRun) { setEmployees([]); return; }
    setEmpLoading(true);
    api.get(`/payroll/runs/${selectedRun}/data`)
      .then(r => {
        const rd = r.data.data;
        const data: any[] = Array.isArray(rd) ? rd : (rd?.cells ?? []);
        const seen = new Set<string>();
        const emps: any[] = [];
        data.forEach((row: any) => {
          if (!seen.has(String(row.employee))) {
            seen.add(String(row.employee));
            emps.push({ id: String(row.employee), name: row.emp_name ?? String(row.employee) });
          }
        });
        setEmployees(emps);
      })
      .catch(() => {})
      .finally(() => setEmpLoading(false));
  }, [selectedRun]);

  async function blobErrMessage(e: any): Promise<string> {
    const data = e.response?.data;
    if (data instanceof Blob) {
      try { const j = JSON.parse(await data.text()); return j.message || 'Download failed'; } catch { /* ignore */ }
    }
    return data?.message || e.message || 'Download failed';
  }

  async function downloadPayslipReport() {
    if (!selectedRun) return toast.error('Select a payroll run');
    if (empLoading)   return toast.error('Employees still loading — please wait');
    setDownloading(true);
    try {
      if (selectedEmp === 'all') {
        if (employees.length === 0) return toast.error('No employees found in this run');
        toast.info(`Downloading ${employees.length} payslip${employees.length > 1 ? 's' : ''}…`);
        let ok = 0;
        for (const emp of employees) {
          try {
            const res = await api.get(`/payroll/runs/${selectedRun}/employees/${emp.id}/payslip.pdf`, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const a   = document.createElement('a');
            a.href     = url;
            a.download = `payslip-${emp.name.replace(/\s+/g, '-')}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            ok++;
          } catch { /* skip individual failures silently */ }
        }
        if (ok > 0) toast.success(`${ok} payslip${ok !== 1 ? 's' : ''} downloaded`);
        else toast.error('No payslips could be downloaded for this run');
      } else {
        const res = await api.get(`/payroll/runs/${selectedRun}/employees/${selectedEmp}/payslip.pdf`, { responseType: 'blob' });
        const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
        const emp = employees.find(e => e.id === selectedEmp);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `payslip-${emp?.name?.replace(/\s+/g, '-') ?? selectedEmp}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Payslip downloaded');
      }
    } catch (e: any) {
      toast.error(await blobErrMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  const reports: Report[] = [
    {
      id: 1,
      name: 'Employee Details Report',
      description: 'Comprehensive list of all employees and their personal information.',
      icon: Users,
      action: openEmployeeReport,
      actionLabel: 'Generate',
    },
    {
      id: 2,
      name: 'Payroll Summary',
      description: 'Overview of salary disbursements, deductions, and net pay across the company.',
      icon: FileText,
      action: openPayrollSummary,
      actionLabel: 'Generate',
    },
    {
      id: 3,
      name: 'Payslip Report',
      description: 'Download individual or all employee payslips for any completed payroll run.',
      icon: Receipt,
      action: openPayslipReport,
      actionLabel: 'Generate',
      exportOnly: true,
    },
    {
      id: 4,
      name: 'Leave Utilization',
      description: 'Detailed view of leave balances, taken days, and requests for all employees.',
      icon: FileText,
      action: openLeaveReport,
      actionLabel: 'Generate',
    },
    {
      id: 5,
      name: 'Department Headcount',
      description: 'Employee distribution mapped by department and location.',
      icon: Users,
      action: openDeptReport,
      actionLabel: 'Generate',
    },
    {
      id: 6,
      name: 'Medical Utilisation Report',
      description: 'View medical limit balances and utilisation for all employees by pay grade.',
      icon: Stethoscope,
      action: openMedicalReport,
      actionLabel: 'View Report',
    },
    {
      id: 7,
      name: 'Performance Report',
      description: 'Review scores and status across all employees and appraisal cycles.',
      icon: TrendingUp,
      action: openPerformanceReport,
      actionLabel: 'View Report',
    },
  ];

  const filtered = reports.filter(r =>
    (canExport || !r.exportOnly) &&
    (r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
     r.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex-1 w-full relative h-full flex flex-col">
      <div className="max-w-[1300px] w-full mx-auto px-6 py-8 flex-1 flex flex-col">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <PageHeader title="Admin Reports" subtitle="Generate and view company-wide reports for all employees." />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm"
        >
          <TableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search admin reports..."
            searchWidth="sm:min-w-[300px]"
          />

          <div className="overflow-x-auto flex-1">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className="th">Report Name</th>
                  <th scope="col" className="th">Description</th>
                  <th scope="col" className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length > 0 ? (
                  filtered.map((row, i) => {
                    const Icon = row.icon;
                    return (
                      <motion.tr key={row.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06 }}>
                        <td className="td font-medium text-[var(--text-primary)] w-[30%]">
                          <div className="flex items-center gap-2">
                            <Icon size={15} className="text-[var(--accent)] shrink-0" />
                            {row.name}
                          </div>
                        </td>
                        <td className="td w-[50%]"><span className="text-[var(--text-muted)] line-clamp-1">{row.description}</span></td>
                        <td className="td text-right">
                          <button
                            className="primary-btn shrink-0"
                            onClick={row.action}
                            disabled={!row.action}
                            title={!row.action ? 'Coming soon' : undefined}
                          >
                            <Download size={14} />
                            <span>{row.actionLabel ?? 'Generate'}</span>
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={3} className="td text-center py-10">
                      <p className="text-[var(--text-muted)] text-[13px]">No reports found matching your search.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <TablePagination total={reports.length} filtered={filtered.length} />
        </motion.div>
      </div>

      {/* Employee Details Report modal */}
      <AnimatePresence>
        {empOpen && (
          <FormModal
            title="Employee Details Report"
            subtitle="Filter the workforce, preview the data, then export to Excel or PDF"
            maxWidth="5xl"
            onClose={() => setEmpOpen(false)}
            onSave={() => setEmpOpen(false)}
            saveLabel="Close"
          >
            {empReportLoading ? (
              <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading employee data…</p>
            ) : (
              <div className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <label className="label">Department</label>
                    <SearchSelect value={empFilters.department} onChange={v => setEmpFilter('department', v)}
                      options={[{ id: '', label: 'All departments' }, ...deptOpts]} placeholder="All departments" />
                  </div>
                  <div className="w-44">
                    <label className="label">Job Title</label>
                    <SearchSelect value={empFilters.jobTitle} onChange={v => setEmpFilter('jobTitle', v)}
                      options={[{ id: '', label: 'All job titles' }, ...jtOpts]} placeholder="All job titles" />
                  </div>
                  <div className="w-44">
                    <label className="label">Employment Status</label>
                    <SearchSelect value={empFilters.employmentStatus} onChange={v => setEmpFilter('employmentStatus', v)}
                      options={[{ id: '', label: 'All' }, ...empStOpts]} placeholder="All" />
                  </div>
                  <div className="w-40">
                    <label className="label">Lifecycle</label>
                    <SearchSelect value={empFilters.lifecycleStatus} onChange={v => setEmpFilter('lifecycleStatus', v)}
                      options={[{ id: '', label: 'All' }, ...lifeOpts]} placeholder="All" />
                  </div>
                  <div>
                    <label className="label">Hired From</label>
                    <input type="date" className={inputClass} value={empFilters.hireFrom} onChange={e => setEmpFilter('hireFrom', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Hired To</label>
                    <input type="date" className={inputClass} value={empFilters.hireTo} onChange={e => setEmpFilter('hireTo', e.target.value)} />
                  </div>
                  {empFilterCount > 0 && (
                    <button onClick={clearEmpFilters} className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-9 self-end">
                      <X size={12} /> Clear all ({empFilterCount})
                    </button>
                  )}
                </div>

                {/* Result count + export actions */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12.5px] text-[var(--text-muted)]">
                    <span className="font-bold text-[var(--text-primary)]">{empFiltered.length}</span> of {empData.length} employees match
                  </p>
                  {canExport && (
                  <div className="flex gap-2">
                    <button onClick={exportEmployeeExcel} disabled={!empFiltered.length}
                      className="secondary-btn !py-1.5 !px-3 !text-[12px] disabled:opacity-50">
                      <FileSpreadsheet size={13} /> Export Excel
                    </button>
                    <button onClick={downloadEmployeePdf} disabled={!empFiltered.length || pdfBusy}
                      className="secondary-btn !py-1.5 !px-3 !text-[12px] disabled:opacity-50">
                      <Download size={13} /> {pdfBusy ? 'Generating…' : 'Download PDF'}
                    </button>
                  </div>
                  )}
                </div>

                {/* Preview */}
                <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] max-h-[45vh] overflow-y-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>{EMP_HEADERS.map(h => <th key={h} className="th">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {empFiltered.length === 0 ? (
                        <tr><td colSpan={EMP_HEADERS.length} className="td text-center py-10 text-[var(--text-muted)]">
                          {empData.length === 0 ? 'No employee data found.' : 'No employees match the selected filters.'}
                        </td></tr>
                      ) : empFiltered.slice(0, 200).map((e: any, i: number) => (
                        <tr key={e.id ?? i} className="tr">
                          {empRow(e).map((c, ci) => (
                            <td key={ci} className={`td ${ci === 1 ? 'font-medium text-[var(--text-primary)]' : ''}`}>{c || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {empFiltered.length > 200 && (
                  <p className="text-[11.5px] text-[var(--text-muted)]">
                    Preview shows the first 200 rows — exports include all {empFiltered.length} matching employees.
                  </p>
                )}
              </div>
            )}
          </FormModal>
        )}
      </AnimatePresence>

      {/* Payroll Summary modal */}
      <AnimatePresence>
        {paySumOpen && (
          <FormModal
            title="Payroll Summary"
            subtitle="Earnings, deductions, and net pay per employee for a payroll run"
            maxWidth="4xl"
            onClose={() => setPaySumOpen(false)}
            onSave={() => setPaySumOpen(false)}
            saveLabel="Close"
          >
            <div className="space-y-4">
              <div className="w-80">
                <label className="label">Payroll Run</label>
                <SearchSelect
                  value={paySumRun}
                  onChange={setPaySumRun}
                  options={runs.map((r: any) => ({ id: String(r.id), label: `${r.name} (${r.status})` }))}
                  placeholder={runsLoading ? 'Loading runs…' : 'Select a completed run…'}
                />
              </div>

              {paySumLoading ? (
                <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading run data…</p>
              ) : paySumRun ? (
                <ReportPreview
                  canExport={canExport}
                  headers={PAYSUM_HEADERS}
                  rows={paySum.rows}
                  total={paySum.rows.length}
                  emptyMessage="No payroll data found for this run."
                  pdfBusy={paySumPdfBusy}
                  onExcel={() => exportReportExcel('Payroll Summary', paySumSummary, PAYSUM_HEADERS, [...paySum.rows, paySum.foot])}
                  onPdf={() => reportPdf('Payroll Summary', paySumSummary, PAYSUM_HEADERS, [...paySum.rows, paySum.foot], setPaySumPdfBusy)}
                  footRow={paySum.rows.length ? paySum.foot : undefined}
                />
              ) : (
                <p className="text-center text-[var(--text-muted)] text-sm py-8">Select a payroll run to generate the summary.</p>
              )}
            </div>
          </FormModal>
        )}
      </AnimatePresence>

      {/* Leave Utilization modal */}
      <AnimatePresence>
        {leaveOpen && (
          <FormModal
            title="Leave Utilization Report"
            subtitle="Requests and days taken per employee and leave type"
            maxWidth="5xl"
            onClose={() => setLeaveOpen(false)}
            onSave={() => setLeaveOpen(false)}
            saveLabel="Close"
          >
            {leaveLoading ? (
              <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading leave data…</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-48">
                    <label className="label">Employee</label>
                    <SearchSelect value={leaveFilters.employee} onChange={v => setLeaveFilter('employee', v)}
                      options={[{ id: '', label: 'All employees' }, ...leaveEmpOpts]} placeholder="All employees" />
                  </div>
                  <div className="w-48">
                    <label className="label">Leave Type</label>
                    <SearchSelect value={leaveFilters.type} onChange={v => setLeaveFilter('type', v)}
                      options={[{ id: '', label: 'All types' }, ...leaveTypeOpts]} placeholder="All types" />
                  </div>
                  <div className="w-44">
                    <label className="label">Leave Period</label>
                    <SearchSelect value={leaveFilters.period} onChange={v => setLeaveFilter('period', v)}
                      options={[{ id: '', label: 'All periods' }, ...leavePeriodOpts]} placeholder="All periods" />
                  </div>
                  <div className="w-44">
                    <label className="label">Status</label>
                    <SearchSelect value={leaveFilters.status} onChange={v => setLeaveFilter('status', v)}
                      options={[{ id: '', label: 'All statuses' }, ...leaveStatusOpts]} placeholder="All statuses" />
                  </div>
                  <div>
                    <label className="label">Starting From</label>
                    <input type="date" className={inputClass} value={leaveFilters.from} onChange={e => setLeaveFilter('from', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Starting To</label>
                    <input type="date" className={inputClass} value={leaveFilters.to} onChange={e => setLeaveFilter('to', e.target.value)} />
                  </div>
                  {leaveFilterCount > 0 && (
                    <button onClick={() => setLeaveFilters({ employee: '', type: '', period: '', status: '', from: '', to: '' })}
                      className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-9 self-end">
                      <X size={12} /> Clear all ({leaveFilterCount})
                    </button>
                  )}
                </div>

                <ReportPreview
                  canExport={canExport}
                  headers={LEAVE_HEADERS}
                  rows={leaveRows}
                  total={leaveAggTotal}
                  emptyMessage={leaveData.length === 0 ? 'No leave applications found.' : 'No applications match the selected filters.'}
                  pdfBusy={leavePdfBusy}
                  onExcel={() => exportReportExcel('Leave Utilization Report', leaveSummary(), LEAVE_HEADERS, leaveRows)}
                  onPdf={() => reportPdf('Leave Utilization Report', leaveSummary(), LEAVE_HEADERS, leaveRows, setLeavePdfBusy)}
                />
              </div>
            )}
          </FormModal>
        )}
      </AnimatePresence>

      {/* Department Headcount modal */}
      <AnimatePresence>
        {deptOpen && (
          <FormModal
            title="Department Headcount"
            subtitle="Employee distribution across departments"
            maxWidth="3xl"
            onClose={() => setDeptOpen(false)}
            onSave={() => setDeptOpen(false)}
            saveLabel="Close"
          >
            {empReportLoading ? (
              <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading employee data…</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <label className="label">Branch</label>
                    <SearchSelect value={deptFilters.branch} onChange={v => setDeptFilter('branch', v)}
                      options={[{ id: '', label: 'All branches' }, ...branchOpts]} placeholder="All branches" />
                  </div>
                  <div className="w-44">
                    <label className="label">Employment Status</label>
                    <SearchSelect value={deptFilters.employmentStatus} onChange={v => setDeptFilter('employmentStatus', v)}
                      options={[{ id: '', label: 'All' }, ...empStOpts]} placeholder="All" />
                  </div>
                  <div className="w-40">
                    <label className="label">Lifecycle</label>
                    <SearchSelect value={deptFilters.lifecycleStatus} onChange={v => setDeptFilter('lifecycleStatus', v)}
                      options={[{ id: '', label: 'All' }, ...lifeOpts]} placeholder="All" />
                  </div>
                  {deptFilterCount > 0 && (
                    <button onClick={() => setDeptFilters({ branch: '', employmentStatus: '', lifecycleStatus: '' })}
                      className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-9 self-end">
                      <X size={12} /> Clear all ({deptFilterCount})
                    </button>
                  )}
                </div>

                <ReportPreview
                  canExport={canExport}
                  headers={DEPT_HEADERS}
                  rows={deptReport.rows}
                  total={deptReport.rows.length}
                  emptyMessage={empData.length === 0 ? 'No employee data found.' : 'No employees match the selected filters.'}
                  pdfBusy={deptPdfBusy}
                  onExcel={() => exportReportExcel('Department Headcount', deptSummary(), DEPT_HEADERS, [...deptReport.rows, deptReport.foot])}
                  onPdf={() => reportPdf('Department Headcount', deptSummary(), DEPT_HEADERS, [...deptReport.rows, deptReport.foot], setDeptPdfBusy)}
                  footRow={deptReport.rows.length ? deptReport.foot : undefined}
                />
              </div>
            )}
          </FormModal>
        )}
      </AnimatePresence>

      {/* Medical Utilisation modal */}
      <AnimatePresence>
        {medOpen && (
          <FormModal title="Medical Utilisation Report" subtitle="Medical limit balances and utilisation per employee"
            maxWidth="5xl" onClose={() => setMedOpen(false)} onSave={() => setMedOpen(false)} saveLabel="Close">
            {medLoading ? (
              <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading…</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-52">
                    <label className="label">Employee</label>
                    <SearchSelect value={medFilters.employee} onChange={v => setMedFilter('employee', v)}
                      options={[{ id: '', label: 'All employees' }, ...medEmpOpts]} placeholder="All employees" />
                  </div>
                  <div className="w-44">
                    <label className="label">Pay Grade</label>
                    <SearchSelect value={medFilters.grade} onChange={v => setMedFilter('grade', v)}
                      options={[{ id: '', label: 'All pay grades' }, ...medGradeOpts]} placeholder="All pay grades" />
                  </div>
                  <div className="w-48">
                    <label className="label">Utilisation</label>
                    <SearchSelect value={medFilters.band} onChange={v => setMedFilter('band', v)}
                      options={[{ id: '', label: 'All levels' }, ...MED_BANDS]} placeholder="All levels" />
                  </div>
                  {medFilterCount > 0 && (
                    <button onClick={() => setMedFilters({ employee: '', grade: '', band: '' })}
                      className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-9 self-end">
                      <X size={12} /> Clear all ({medFilterCount})
                    </button>
                  )}
                </div>

                <ReportPreview
                  canExport={canExport}
                  headers={MED_HEADERS}
                  rows={medFiltered.map(medRow)}
                  total={medRows.length}
                  emptyMessage={medRows.length === 0 ? 'No medical data found.' : 'No employees match the selected filters.'}
                  pdfBusy={medPdfBusy}
                  onExcel={() => exportReportExcel('Medical Utilisation Report', medSummary(), MED_HEADERS, medFiltered.map(medRow))}
                  onPdf={() => reportPdf('Medical Utilisation Report', medSummary(), MED_HEADERS, medFiltered.map(medRow), setMedPdfBusy)}
                />
              </div>
            )}
          </FormModal>
        )}
      </AnimatePresence>

      {/* Performance Report modal */}
      <AnimatePresence>
        {perfOpen && (
          <FormModal title="Performance Report" subtitle="Review scores and status across all employees"
            maxWidth="5xl" onClose={() => setPerfOpen(false)} onSave={() => setPerfOpen(false)} saveLabel="Close">
            {perfLoading ? (
              <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading…</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-52">
                    <label className="label">Employee</label>
                    <SearchSelect value={perfFilters.employee} onChange={v => setPerfFilter('employee', v)}
                      options={[{ id: '', label: 'All employees' }, ...perfEmpOpts]} placeholder="All employees" />
                  </div>
                  <div className="w-48">
                    <label className="label">Cycle</label>
                    <SearchSelect value={perfFilters.cycle} onChange={v => setPerfFilter('cycle', v)}
                      options={[{ id: '', label: 'All cycles' }, ...perfCycleOpts]} placeholder="All cycles" />
                  </div>
                  <div className="w-44">
                    <label className="label">Status</label>
                    <SearchSelect value={perfFilters.status} onChange={v => setPerfFilter('status', v)}
                      options={[{ id: '', label: 'All statuses' }, ...perfStatusOpts]} placeholder="All statuses" />
                  </div>
                  {perfFilterCount > 0 && (
                    <button onClick={() => setPerfFilters({ employee: '', cycle: '', status: '' })}
                      className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-9 self-end">
                      <X size={12} /> Clear all ({perfFilterCount})
                    </button>
                  )}
                </div>

                <ReportPreview
                  canExport={canExport}
                  headers={PERF_HEADERS}
                  rows={perfFiltered.map(perfRow)}
                  total={perfRows.length}
                  emptyMessage={perfRows.length === 0 ? 'No performance reviews found.' : 'No reviews match the selected filters.'}
                  pdfBusy={perfPdfBusy}
                  onExcel={() => exportReportExcel('Performance Report', perfSummary(), PERF_HEADERS, perfFiltered.map(perfRow))}
                  onPdf={() => reportPdf('Performance Report', perfSummary(), PERF_HEADERS, perfFiltered.map(perfRow), setPerfPdfBusy)}
                />
              </div>
            )}
          </FormModal>
        )}
      </AnimatePresence>

      {/* Payslip Report modal */}
      <AnimatePresence>
        {payslipOpen && (
          <FormModal
            title="Payslip Report"
            subtitle="Download payslips for a completed payroll run"
            maxWidth="md"
            onClose={() => setPayslipOpen(false)}
            onSave={downloadPayslipReport}
            saveLabel={downloading ? 'Downloading…' : empLoading ? 'Loading…' : 'Download PDF(s)'}
          >
            <div className="space-y-4">
              <FormField label="Payroll Run" required>
                <select
                  className={inputClass}
                  value={selectedRun}
                  onChange={e => { setSelectedRun(e.target.value); setSelectedEmp('all'); }}
                  disabled={runsLoading}
                >
                  <option value="">{runsLoading ? 'Loading runs…' : 'Select a completed run…'}</option>
                  {runs.map(r => (
                    <option key={r.id} value={r.id}>{r.name} ({r.status})</option>
                  ))}
                </select>
              </FormField>

              {selectedRun && (
                <FormField label="Employee">
                  <select
                    className={inputClass}
                    value={selectedEmp}
                    onChange={e => setSelectedEmp(e.target.value)}
                    disabled={empLoading}
                  >
                    <option value="all">{empLoading ? 'Loading…' : `All employees (${employees.length})`}</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </FormField>
              )}

              {selectedRun && selectedEmp === 'all' && employees.length > 0 && (
                <p className="text-[12px] text-[var(--text-muted)]">
                  This will download {employees.length} separate PDF file{employees.length !== 1 ? 's' : ''}, one per employee.
                </p>
              )}
            </div>
          </FormModal>
        )}
      </AnimatePresence>
    </div>
  );
}
