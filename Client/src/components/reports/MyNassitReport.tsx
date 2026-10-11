import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import api from '../../../lib/api';
import { fmtAmt } from '../ui/reportTools';
import { ReportModal, filterSummary, type Cell } from './ReportModal';

// Legacy IceHRM user "NASSIT Report": the signed-in employee's own NASSIT contributions per payroll
// run over a date range.
export function MyNassitReport({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ from: `${new Date().getFullYear()}-01-01`, to: new Date().toISOString().slice(0, 10) });
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/payroll/my-nassit', { params: { from: f.from || undefined, to: f.to || undefined } })
      .then(r => setData(r.data.data ?? null))
      .catch(e => { setData(null); toast.error(e?.response?.data?.message ?? 'Failed to load your NASSIT contributions'); })
      .finally(() => setLoading(false));
  }, [f.from, f.to]);

  const HEADERS = ['Payroll Run', 'Period', 'Basic Salary', 'Employee 5%', 'Employer 10%', 'Total'];
  const report = useMemo(() => {
    const list: any[] = data?.rows ?? [];
    const t = data?.totals ?? { basic: 0, employee: 0, employer: 0, total: 0 };
    return {
      rows: list.map(r => [r.run, r.period, fmtAmt(r.basic), fmtAmt(r.employee), fmtAmt(r.employer), fmtAmt(r.total)]) as Cell[][],
      raw: list.map(r => [r.run, r.period, r.basic, r.employee, r.employer, r.total]) as Cell[][],
      foot: ['Total', `${list.length} run${list.length === 1 ? '' : 's'}`, fmtAmt(t.basic), fmtAmt(t.employee), fmtAmt(t.employer), fmtAmt(t.total)] as Cell[],
      rawFoot: ['Total', '', t.basic, t.employee, t.employer, t.total] as Cell[],
    };
  }, [data]);

  return (
    <ReportModal
      title="My NASSIT Contributions" subtitle="Your employee 5% and employer 10% NASSIT contributions per payroll run"
      maxWidth="4xl" onClose={onClose} canExport
      filters={[{ key: 'from', label: 'Start Date', type: 'date' }, { key: 'to', label: 'End Date', type: 'date' }]}
      values={f} onFilterChange={(k, v) => setF(p => ({ ...p, [k]: v }))}
      notice={data && (
        <p className="text-[12px] text-[var(--text-muted)]">
          Staff ID: <span className="font-medium text-[var(--text-primary)]">{data.staff_id || '—'}</span>
          {'  ·  '}NASSIT No.: <span className="font-medium text-[var(--text-primary)]">{data.nassit_num || 'not on your record'}</span>
        </p>
      )}
      headers={HEADERS} rows={report.rows} total={report.rows.length} footRow={report.foot}
      exportRows={report.raw} exportFoot={report.rawFoot}
      summary={filterSummary([['Dates', `${f.from || '…'} → ${f.to || '…'}`], ['NASSIT No.', data?.nassit_num]], '')}
      emptyMessage="No NASSIT contributions in completed payroll runs for this period."
    >
      {loading ? <p className="text-center text-[var(--text-muted)] text-sm py-8">Loading your contributions…</p> : undefined}
    </ReportModal>
  );
}
