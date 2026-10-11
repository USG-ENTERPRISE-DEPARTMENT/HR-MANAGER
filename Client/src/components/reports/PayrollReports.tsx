import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { fmtAmt } from '../ui/reportTools';
import { ReportModal, fullName, type Cell, type FilterDef } from './ReportModal';

// Legacy IceHRM payroll reports: General Payroll Report, PAYE Report, GL Summary Report and
// Payroll Meta Data Export. Each runs against a payroll run (or, for the export, a calculation group).

type Props = { onClose: () => void; canExport: boolean };

// Every generated run, not only completed ones, so figures can be checked before the run is finalised.
function useRuns() {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/payroll/runs')
      .then(r => setRuns((r.data.data ?? []).filter((x: any) => x.status !== 'Draft')))
      .catch(() => toast.error('Failed to load payroll runs'))
      .finally(() => setLoading(false));
  }, []);
  const options = useMemo(() => runs.map((r: any) => ({ id: String(r.id), label: `${r.name} (${r.status})` })), [runs]);
  return { runs, options, loading };
}

const runFilter = (options: { id: string; label: string }[]): FilterDef =>
  ({ key: 'run', label: 'Payroll Run', type: 'select', options, width: 'w-96 max-w-full' });

function runSummary(runs: any[], runId: string) {
  const r = runs.find((x: any) => String(x.id) === runId);
  if (!r) return 'No run selected';
  return `Payroll run: ${r.name}` + (r.status === 'Completed' ? '' : `  ·  Status: ${r.status} — figures may still change`);
}

function downloadCsv(filename: string, headers: string[], rows: Cell[][]) {
  const cell = (v: Cell) => (typeof v === 'number' ? v.toFixed(2) : `"${String(v ?? '').replace(/"/g, '""')}"`);
  const csv = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.map(cell).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

const pickRun = <p className="text-center text-[var(--text-muted)] text-sm py-8">Select a payroll run to generate the report.</p>;
const busy = (text: string) => <p className="text-center text-[var(--text-muted)] text-sm py-8">{text}</p>;

// ── General Payroll Report ────────────────────────────────────────────────────
// One row per employee with every column the run's report template shows, plus the staff details the
// legacy report carried (pay grade, notch, account and NASSIT numbers, branch).
export function GeneralPayrollReport({ onClose, canExport }: Props) {
  const { runs, options, loading } = useRuns();
  const [run, setRun] = useState('');
  const [data, setData] = useState<any | null>(null);
  const [emps, setEmps] = useState<Map<string, any>>(new Map());
  const [busyLoading, setBusyLoading] = useState(false);

  useEffect(() => {
    api.get('/employees').then(r => setEmps(new Map((r.data.data ?? []).map((e: any) => [String(e.id), e])))).catch(() => {});
  }, []);
  useEffect(() => {
    setData(null);
    if (!run) return;
    setBusyLoading(true);
    api.get(`/payroll/runs/${run}/data`)
      .then(r => setData(r.data.data ?? null))
      .catch(e => toast.error(e?.response?.data?.message ?? 'Failed to load payroll run data'))
      .finally(() => setBusyLoading(false));
  }, [run]);

  const report = useMemo(() => {
    const cells: any[] = Array.isArray(data) ? data : (data?.cells ?? []);
    const template: string[] | null = data?.templateVisibleCols ? data.templateVisibleCols.map(String) : null;
    const shown = (c: any) => (template ? template.includes(String(c.payroll_item)) : !(c.visible === false || c.visible === 0));
    const cols = new Map<string, { name: string; order: number }>();
    const byEmp = new Map<string, Map<string, number>>();
    for (const c of cells) {
      if (!shown(c)) continue;
      const colId = String(c.payroll_item);
      if (!cols.has(colId)) cols.set(colId, { name: c.column_name ?? `Column ${colId}`, order: Number(c.colorder ?? 99999) });
      const k = String(c.employee);
      if (!byEmp.has(k)) byEmp.set(k, new Map());
      byEmp.get(k)!.set(colId, (byEmp.get(k)!.get(colId) ?? 0) + (parseFloat(c.amount || '0') || 0));
    }
    const colList = [...cols.entries()].sort((a, b) => a[1].order - b[1].order);
    const info = ['Employee ID', 'Name', 'Pay Grade', 'Notch', 'Account Number', 'NASSIT No.', 'Branch'];
    const headers = [...info, ...colList.map(([, c]) => c.name)];
    const emp = (k: string) => emps.get(k);
    const ordered = [...byEmp.keys()].sort((a, b) =>
      String(emp(a)?.employee_id ?? a).localeCompare(String(emp(b)?.employee_id ?? b), undefined, { numeric: true }));
    const base = (k: string) => {
      const e = emp(k);
      return [e?.employee_id ?? '', e ? fullName(e) : `Employee ${k}`, e?.paygrade ?? '', e?.notch ?? '', e?.bankAccount ?? '', e?.nassit_num ?? '', e?.branch?.title ?? ''];
    };
    const raw = ordered.map(k => [...base(k), ...colList.map(([id]) => Math.round((byEmp.get(k)!.get(id) ?? 0) * 100) / 100)]) as Cell[][];
    const totals = colList.map(([id]) => ordered.reduce((s, k) => s + (byEmp.get(k)!.get(id) ?? 0), 0));
    const pad = Array(info.length - 2).fill('');
    return {
      headers,
      raw,
      rows: raw.map(r => r.map((v, i) => (i >= info.length ? fmtAmt(Number(v)) : v))),
      foot: ['Total', `${ordered.length} staff`, ...pad, ...totals.map(fmtAmt)] as Cell[],
      rawFoot: ['Total', '', ...pad, ...totals.map(t => Math.round(t * 100) / 100)] as Cell[],
    };
  }, [data, emps]);

  return (
    <ReportModal
      title="General Payroll Report" subtitle="Every report column per employee for a payroll run" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading payroll runs…"
      filters={[runFilter(options)]} values={{ run }} onFilterChange={(_k, v) => setRun(v)}
      headers={report.headers} rows={report.rows} total={report.rows.length} footRow={report.foot}
      exportRows={report.raw} exportFoot={report.rawFoot}
      summary={runSummary(runs, run)} emptyMessage="No payroll data found for this run."
    >
      {!run ? pickRun : busyLoading ? busy('Loading run data…') : undefined}
    </ReportModal>
  );
}

// ── PAYE Report ───────────────────────────────────────────────────────────────
// Same columns, in the same order, as the legacy PAYE return. TIN is the employee's NASSIT number.
export function PayeReport({ onClose, canExport }: Props) {
  const { runs, options, loading } = useRuns();
  const [run, setRun] = useState('');
  const [data, setData] = useState<any | null>(null);
  const [busyLoading, setBusyLoading] = useState(false);

  useEffect(() => {
    setData(null);
    if (!run) return;
    setBusyLoading(true);
    api.get(`/payroll/runs/${run}/paye-report`)
      .then(r => setData(r.data.data ?? null))
      .catch(e => toast.error(e?.response?.data?.message ?? 'Failed to load the PAYE report'))
      .finally(() => setBusyLoading(false));
  }, [run]);

  const INFO = ['TIN NUMBER', 'EMPLOYEE ID', 'EMPLOYEE NAME', 'DATE OF ENTRY', 'DATE OF BIRTH', 'GENDER', 'DESIGNATION'];
  const report = useMemo(() => {
    const cols: any[] = data?.columns ?? [];
    const list: any[] = data?.rows ?? [];
    const base = (r: any) => [r.tin, r.staff_id, r.name, r.date_of_entry, r.date_of_birth, r.gender, r.designation];
    const raw = list.map(r => [...base(r), ...cols.map(c => r.amounts[c.key] ?? 0)]) as Cell[][];
    const pad = Array(INFO.length - 2).fill('');
    return {
      headers: [...INFO, ...cols.map(c => c.label)],
      raw,
      rows: raw.map(r => r.map((v, i) => (i >= INFO.length ? fmtAmt(Number(v)) : v))),
      foot: ['Total', `${list.length} staff`, ...pad, ...cols.map(c => fmtAmt(data.totals[c.key] ?? 0))] as Cell[],
      rawFoot: ['Total', '', ...pad, ...cols.map(c => data.totals[c.key] ?? 0)] as Cell[],
      sources: cols.filter(c => c.sources.length).map(c => `${c.label}: ${c.sources.join(', ')}`).join(' · '),
    };
  }, [data]);
  const runName = runs.find((r: any) => String(r.id) === run)?.name ?? 'payroll run';

  return (
    <ReportModal
      title="PAYE Report" subtitle="PAYE return per employee for a payroll run" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading payroll runs…"
      filters={[runFilter(options)]} values={{ run }} onFilterChange={(_k, v) => setRun(v)}
      actions={canExport && report.raw.length > 0 && (
        <button className="secondary-btn" onClick={() => downloadCsv(`PAYE REPORT - ${runName}.csv`, report.headers, [...report.raw, report.rawFoot])}>
          <Download size={14} /> Download CSV
        </button>
      )}
      notice={data && (
        <>
          {data.missingTin > 0 && (
            <p className="text-[12px] text-[var(--warning)]">
              {data.missingTin} staff member{data.missingTin === 1 ? ' has' : 's have'} no TIN (NASSIT number) on their employee record.
            </p>
          )}
          {report.sources && <p className="text-[11px] text-[var(--text-muted)]">Source columns — {report.sources}</p>}
        </>
      )}
      headers={report.headers} rows={report.rows} total={report.rows.length} footRow={report.foot}
      exportRows={report.raw} exportFoot={report.rawFoot}
      summary={runSummary(runs, run)} emptyMessage="This payroll run has no PAYE figures."
    >
      {!run ? pickRun : busyLoading ? busy('Loading PAYE figures…') : undefined}
    </ReportModal>
  );
}

// ── GL Summary Report ─────────────────────────────────────────────────────────
// The run's journal by GL account and column — exactly the lines finalising the run posts.
export function GlSummaryReport({ onClose, canExport }: Props) {
  const { runs, options, loading } = useRuns();
  const [run, setRun] = useState('');
  const [data, setData] = useState<any | null>(null);
  const [busyLoading, setBusyLoading] = useState(false);

  useEffect(() => {
    setData(null);
    if (!run) return;
    setBusyLoading(true);
    api.get(`/payroll/runs/${run}/gl-summary`)
      .then(r => setData(r.data.data ?? null))
      .catch(e => toast.error(e?.response?.data?.message ?? 'Failed to load the GL summary'))
      .finally(() => setBusyLoading(false));
  }, [run]);

  const HEADERS = ['Side', 'GL Account', 'Component', 'Branch', 'Lines', 'Debit', 'Credit'];
  const report = useMemo(() => {
    const lines: any[] = data?.lines ?? [];
    const raw = lines.map(l => [l.side, l.account, l.column, l.branch, l.lines,
      l.side === 'Debit' ? l.amount : 0, l.side === 'Credit' ? l.amount : 0]) as Cell[][];
    const t = data?.totals ?? { debit: 0, credit: 0 };
    return {
      raw,
      rows: raw.map(r => r.map((v, i) => (i >= 5 ? (Number(v) ? fmtAmt(Number(v)) : '') : v))),
      foot: ['Total', '', '', '', lines.reduce((s, l) => s + l.lines, 0), fmtAmt(t.debit), fmtAmt(t.credit)] as Cell[],
      rawFoot: ['Total', '', '', '', '', t.debit, t.credit] as Cell[],
    };
  }, [data]);

  return (
    <ReportModal
      title="GL Summary Report" subtitle="Payroll journal by GL account, component and branch" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading payroll runs…"
      filters={[runFilter(options)]} values={{ run }} onFilterChange={(_k, v) => setRun(v)}
      notice={data && (
        <div className="space-y-1 text-[12px]">
          {!data.balanced && (
            <p className="text-[var(--danger)]">
              Journal does not balance — difference {fmtAmt(data.totals.difference)} {data.currency}. Finalising this run will be blocked until it does.
            </p>
          )}
          {data.unmapped.length > 0 && (
            <p className="text-[var(--warning)]">
              {data.unmapped.length} line{data.unmapped.length === 1 ? '' : 's'} left out (no GL account or negative net pay), e.g. {data.unmapped.slice(0, 3).join('; ')}.
            </p>
          )}
          {data.missingNetAccount.length > 0 && (
            <p className="text-[var(--warning)]">
              {data.missingNetAccount.length} employee{data.missingNetAccount.length === 1 ? ' has' : 's have'} no bank account for net pay: {data.missingNetAccount.slice(0, 5).join(', ')}{data.missingNetAccount.length > 5 ? '…' : ''}
            </p>
          )}
        </div>
      )}
      headers={HEADERS} rows={report.rows} total={report.rows.length} footRow={report.foot}
      exportRows={report.raw} exportFoot={report.rawFoot}
      summary={runSummary(runs, run) + (data ? `  ·  Currency: ${data.currency}` : '')}
      emptyMessage="This payroll run has no posting lines."
    >
      {!run ? pickRun : busyLoading ? busy('Building the journal…') : undefined}
    </ReportModal>
  );
}

// ── Payroll Meta Data Export ──────────────────────────────────────────────────
// The payroll configuration for one calculation group: every column that applies to it (its own
// columns plus the ungrouped ones, which apply to everyone) with formulas, components and links.
// Previewed as a table; the JSON download carries the full configuration, as the legacy export did.
export function PayrollMetaExport({ onClose, canExport }: Props) {
  const [loading, setLoading] = useState(true);
  const [cfg, setCfg] = useState<{ cols: any[]; groups: any[]; saved: any[]; comps: any[]; freqs: any[] }>({ cols: [], groups: [], saved: [], comps: [], freqs: [] });
  const [group, setGroup] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/payroll/columns'), api.get('/payroll/calc-groups'), api.get('/payroll/saved-calculations'),
      api.get('/salary/components').catch(() => ({ data: { data: [] } })), api.get('/payroll/pay-frequencies').catch(() => ({ data: { data: [] } })),
    ])
      .then(([c, g, s, sc, f]) => setCfg({
        cols: c.data.data ?? [], groups: g.data.data ?? [], saved: s.data.data ?? [], comps: sc.data.data ?? [], freqs: f.data.data ?? [],
      }))
      .catch(() => toast.error('Failed to load payroll configuration'))
      .finally(() => setLoading(false));
  }, []);

  const groupOpts = useMemo(() => cfg.groups.map((g: any) => ({ id: String(g.id), label: g.name })), [cfg.groups]);
  const colName = useMemo(() => new Map(cfg.cols.map((c: any) => [String(c.id), c.name])), [cfg.cols]);
  const compName = useMemo(() => new Map(cfg.comps.map((c: any) => [String(c.id), c.name])), [cfg.comps]);
  const ruleName = useMemo(() => new Map(cfg.saved.map((s: any) => [String(s.id), s.name])), [cfg.saved]);
  const groupName = groupOpts.find(g => g.id === group)?.label ?? '';

  const columns = useMemo(() => (!group ? [] : cfg.cols.filter((c: any) => {
    const gs: string[] = (c.deduction_groups ?? []).map(String);
    return gs.length === 0 || gs.includes(group);
  })), [cfg.cols, group]);

  const names = (ids: any[], m: Map<string, string>) => (ids ?? []).map((id: any) => m.get(String(id)) ?? `#${id}`).join(', ');
  const HEADERS = ['Order', 'Column', 'Type', 'Applies To', 'Function', 'Formula', 'Components', 'Add Columns', 'Subtract Columns', 'Calculation Rule', 'GL Account', 'Posted', 'Visible', 'Enabled'];
  const rows = useMemo(() => columns.map((c: any) => [
    c.colorder ?? '', c.name, c.payment_deduction ?? '', (c.deduction_groups ?? []).length ? groupName : 'All groups',
    c.function_type ?? '', c.calculation_function ?? '', names(c.component_ids, compName), names(c.add_column_ids, colName),
    names(c.sub_column_ids, colName), c.calculation_rule ? (ruleName.get(String(c.calculation_rule)) ?? `#${c.calculation_rule}`) : '',
    c.salarycomponent_gl ?? '', c.posting_column ?? '', c.visible === false || c.visible === 0 ? 'No' : 'Yes', c.enabled ?? '',
  ] as Cell[]), [columns, groupName, compName, colName, ruleName]);

  function downloadJson() {
    const ruleIds = new Set(columns.map((c: any) => String(c.calculation_rule ?? '')).filter(Boolean));
    const payload = {
      exported_at: new Date().toISOString(),
      calculation_group: cfg.groups.find((g: any) => String(g.id) === group) ?? null,
      payroll_columns: columns,
      saved_calculations: cfg.saved.filter((s: any) => ruleIds.has(String(s.id)) || String(s.calculation_group_id ?? '') === group),
      salary_components: cfg.comps,
      pay_frequencies: cfg.freqs,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), {
      href: url, download: `payroll-meta-data-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'group'}-${new Date().toISOString().slice(0, 10)}.json`,
    }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <ReportModal
      title="Payroll Meta Data Export" subtitle="Payroll column configuration for a calculation group" onClose={onClose} canExport={canExport}
      loading={loading} loadingText="Loading payroll configuration…"
      filters={[{ key: 'group', label: 'Calculation Group', type: 'select', options: groupOpts, width: 'w-72' }]}
      values={{ group }} onFilterChange={(_k, v) => setGroup(v)}
      actions={canExport && columns.length > 0 && (
        <button className="secondary-btn" onClick={downloadJson}><Download size={14} /> Download JSON</button>
      )}
      headers={HEADERS} rows={rows} total={rows.length}
      summary={group ? `Calculation group: ${groupName}  ·  ${rows.length} columns (including ungrouped columns that apply to every group)` : ''}
      emptyMessage="No payroll columns apply to this calculation group."
    >
      {!group ? <p className="text-center text-[var(--text-muted)] text-sm py-8">Select a calculation group to export its configuration.</p> : undefined}
    </ReportModal>
  );
}
