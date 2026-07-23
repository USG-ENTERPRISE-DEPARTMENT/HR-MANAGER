import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import {
  X, CheckCircle, DollarSign, TrendingUp, Users, Loader2, XCircle, FileSpreadsheet,
} from 'lucide-react';
import api from '../../lib/api';
import { FormField } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { inputClass } from './ui/FormField';
import { exportReportExcel } from './ui/reportTools';

/**
 * Read-only payroll review for a stage approver. A payroll stage approver (e.g. Finance Review) can reach
 * Central Approval but not the full Payroll module, so this modal shows exactly the figures they need to
 * decide — the employee × column grid, per-column totals, per-employee gross/deductions/net and summary
 * cards — plus Approve / Reject actions. All data comes from unguarded read endpoints
 * (`/payroll/runs/:id/data`, `/payroll/columns`); the server still enforces that only the current stage's
 * approver may act.
 */

interface Cell {
  employee: string; payroll_item: string; amount: string | null;
  emp_name: string; column_name: string; colorder: number | null;
  payment_deduction: string | null;
}
interface Col {
  id: string; name: string; payment_deduction: string | null; colorder: number | null;
  visible: number | boolean; include_in_net: number | boolean;
}
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'Yes';

export function PayrollReviewModal({
  run, onApprove, onReject, onClose, busy,
}: {
  run: any;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const runId = String(run?.id);
  const [cells, setCells]   = useState<Cell[]>([]);
  const [cols, setCols]     = useState<Col[]>([]);
  // Run's resolved report-template column sets (null when the run has no template → fall back to global flags).
  const [templateVisible, setTemplateVisible] = useState<string[] | null>(null);
  const [templateNet, setTemplateNet]         = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [dataRes, colRes] = await Promise.all([
          api.get(`/payroll/runs/${runId}/data`),
          api.get('/payroll/columns').catch(() => ({ data: { data: [] } })),
        ]);
        if (!alive) return;
        const d = dataRes.data?.data ?? {};
        setCells(d.cells ?? []);
        setTemplateVisible(Array.isArray(d.templateVisibleCols) ? d.templateVisibleCols.map(String) : null);
        setTemplateNet(Array.isArray(d.templateNetCols) ? d.templateNetCols.map(String) : null);
        setCols((colRes.data?.data ?? []).map((c: any) => ({
          id: String(c.id), name: c.name, payment_deduction: c.payment_deduction,
          colorder: c.colorder, visible: c.visible, include_in_net: c.include_in_net,
        })));
      } catch {
        if (alive) toast.error('Failed to load the payroll figures');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [runId]);

  // Column display config mirrors the admin grid: a report template (when one applies to this run) decides
  // which columns show and which count toward net — otherwise each column's own visible/include_in_net flag.
  const hiddenColIds = useMemo(() => {
    if (templateVisible) {
      const shown = new Set(templateVisible);
      return new Set(cols.filter(c => !shown.has(String(c.id))).map(c => String(c.id)));
    }
    return new Set(cols.filter(c => !truthy(c.visible)).map(c => String(c.id)));
  }, [cols, templateVisible]);

  const netExcludedIds = useMemo(() => {
    if (templateNet) {
      const inNet = new Set(templateNet);
      return new Set(cols.filter(c => !inNet.has(String(c.id))).map(c => String(c.id)));
    }
    return new Set(cols.filter(c => !truthy(c.include_in_net)).map(c => String(c.id)));
  }, [cols, templateNet]);

  const empIds = useMemo(() => [...new Set(cells.map(c => c.employee))], [cells]);
  const empNames = useMemo(
    () => Object.fromEntries(cells.map(c => [c.employee, c.emp_name])),
    [cells],
  );

  // Ordered, visible columns derived from the run's cells (same source the admin grid uses).
  const displayCols = useMemo(() => {
    const map = new Map<string, { name: string; pd: string | null; order: number | null }>();
    cells.forEach(c => {
      if (!map.has(String(c.payroll_item)))
        map.set(String(c.payroll_item), { name: c.column_name, pd: c.payment_deduction, order: c.colorder });
    });
    return [...map.entries()]
      .filter(([pid]) => !hiddenColIds.has(String(pid)))
      .sort((a, b) => (a[1].order ?? 99999) - (b[1].order ?? 99999) || Number(a[0]) - Number(b[0]));
  }, [cells, hiddenColIds]);

  const cellOf = useCallback(
    (eid: string, pid: string) => cells.find(c => c.employee === eid && String(c.payroll_item) === String(pid)),
    [cells],
  );
  const num = (v: string | null | undefined) => parseFloat(v ?? '0') || 0;

  const netPay = useCallback((eid: string) =>
    cells
      .filter(c => c.employee === eid && !netExcludedIds.has(String(c.payroll_item)))
      .reduce((s, c) => s + (c.payment_deduction === 'Deduction' ? -1 : 1) * num(c.amount), 0),
    [cells, netExcludedIds],
  );
  const colTotal = useCallback((pid: string) =>
    cells.filter(c => String(c.payroll_item) === String(pid)).reduce((s, c) => s + num(c.amount), 0),
    [cells],
  );

  const totalGross = useMemo(() =>
    cells.filter(c => c.payment_deduction !== 'Deduction' && !netExcludedIds.has(String(c.payroll_item))).reduce((s, c) => s + num(c.amount), 0),
    [cells, netExcludedIds]);
  const totalDed = useMemo(() =>
    cells.filter(c => c.payment_deduction === 'Deduction' && !netExcludedIds.has(String(c.payroll_item))).reduce((s, c) => s + num(c.amount), 0),
    [cells, netExcludedIds]);
  const totalNet = useMemo(() => empIds.reduce((s, eid) => s + netPay(eid), 0), [empIds, netPay]);

  // Excel export — same columns/order/figures shown in the grid, plus a Totals row.
  function exportExcel() {
    if (!empIds.length) return;
    const headers = ['Employee', ...displayCols.map(([, c]) => c.name), 'Net Pay'];
    const rows: (string | number)[][] = empIds.map(eid => [
      empNames[eid] || eid,
      ...displayCols.map(([pid]) => fmt(num(cellOf(eid, pid)?.amount))),
      fmt(netPay(eid)),
    ]);
    rows.push(['Totals', ...displayCols.map(([pid]) => fmt(colTotal(pid))), fmt(totalNet)]);
    const period = run?.date_start ? `${String(run.date_start).slice(0,10)} to ${String(run.date_end || '').slice(0,10)}` : '';
    const summary = [run?.freq_name, period, `${empIds.length} employees`].filter(Boolean).join(' · ');
    exportReportExcel(run?.name || 'Payroll Run', summary, headers, rows);
  }

  const cards = [
    { label: 'Gross Pay',  value: fmt(totalGross),       color: 'text-[var(--accent)]',  bg: 'bg-[var(--accent-dim)]',  icon: <DollarSign size={15} /> },
    { label: 'Deductions', value: fmt(totalDed),         color: 'text-[var(--danger)]',  bg: 'bg-[var(--danger-dim)]',  icon: <TrendingUp size={15} /> },
    { label: 'Net Pay',    value: fmt(totalNet),         color: 'text-[var(--success)]', bg: 'bg-[var(--success-dim)]', icon: <CheckCircle size={15} /> },
    { label: 'Employees',  value: String(empIds.length), color: 'text-[var(--purple)]',  bg: 'bg-[var(--purple-dim)]',  icon: <Users size={15} /> },
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
        className="relative z-10 bg-[var(--surface)] rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl max-h-[92vh] overflow-hidden border border-[var(--border)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h3 className="font-bold text-[var(--text-primary)] syne text-[16px] flex items-center gap-2">
              {run?.name || 'Payroll run'}
              <span className="pill pill-warning text-[11px]">{run?.status || 'Pending Approval'}</span>
            </h3>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              {run?.freq_name ? `${run.freq_name} · ` : ''}
              {run?.date_start ? `${String(run.date_start).slice(0,10)} → ${String(run.date_end || '').slice(0,10)}` : 'Payroll review'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportExcel} disabled={busy || loading || empIds.length === 0}
              className="secondary-btn !py-1.5 !px-3 !text-[12px] disabled:opacity-50" title="Export to Excel">
              <FileSpreadsheet size={13} /> Export Excel
            </button>
            <button onClick={onClose} disabled={busy} className="p-2 rounded-full hover:bg-black/10 text-[var(--text-muted)] transition-colors disabled:opacity-40">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
              <Loader2 className="animate-spin" size={26} />
              <span className="text-[13px]">Loading payroll figures…</span>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                {cards.map((c, i) => (
                  <div key={i} className="stat-card">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.bg} ${c.color}`}>{c.icon}</div>
                      <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide">{c.label}</span>
                    </div>
                    <p className={`text-[20px] font-bold ${c.color}`}>{c.value}</p>
                  </div>
                ))}
              </div>

              {/* Grid */}
              {empIds.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">
                  No payroll figures found for this run.
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                  <div className="flex items-center gap-3 px-3 py-2 text-[12px] text-[var(--text-muted)] border-b border-[var(--border)]">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--accent)]" /> Earnings</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--danger)]" /> Deductions</span>
                    <span>{displayCols.length} columns · {empIds.length} employees</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px] whitespace-nowrap">
                      <thead>
                        <tr className="bg-[var(--bg)]/40">
                          <th className="sticky left-0 z-10 bg-[var(--surface)] text-left px-3 py-2 font-semibold text-[var(--text-muted)] border-b border-[var(--border)]">Employee</th>
                          {displayCols.map(([pid, c]) => (
                            <th key={pid} className={`text-right px-3 py-2 font-semibold border-b border-[var(--border)] ${c.pd === 'Deduction' ? 'text-[var(--danger)]' : 'text-[var(--accent)]'}`}>
                              {c.name}
                            </th>
                          ))}
                          <th className="text-right px-3 py-2 font-semibold text-[var(--success)] border-b border-[var(--border)] border-l border-[var(--border)]">Net Pay</th>
                        </tr>
                      </thead>
                      <tbody>
                        {empIds.map(eid => (
                          <tr key={eid} className="hover:bg-black/5">
                            <td className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-2 font-medium text-[var(--text-primary)] border-b border-[var(--border)]">
                              {empNames[eid] || eid}
                            </td>
                            {displayCols.map(([pid, c]) => {
                              const amount = num(cellOf(eid, pid)?.amount);
                              return (
                                <td key={pid} className={`text-right px-3 py-2 border-b border-[var(--border)] ${amount === 0 ? 'text-[var(--text-muted)]' : c.pd === 'Deduction' ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'}`}>
                                  {fmt(amount)}
                                </td>
                              );
                            })}
                            <td className="text-right px-3 py-2 font-semibold text-[var(--success)] border-b border-[var(--border)] border-l border-[var(--border)]">
                              {fmt(netPay(eid))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[var(--bg)]/40 font-semibold">
                          <td className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-2 text-[var(--text-primary)]">Totals</td>
                          {displayCols.map(([pid, c]) => (
                            <td key={pid} className={`text-right px-3 py-2 ${c.pd === 'Deduction' ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'}`}>
                              {fmt(colTotal(pid))}
                            </td>
                          ))}
                          <td className="text-right px-3 py-2 text-[var(--success)] border-l border-[var(--border)]">{fmt(totalNet)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {rejecting && (
                <FormField label="Rejection Reason">
                  <CountedTextarea
                    className={inputClass + ' resize-none'}
                    rows={3}
                    maxChars={500}
                    placeholder="Enter reason for rejection…"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </FormField>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--border)] shrink-0">
          <button className="secondary-btn" onClick={onClose} disabled={busy}>Close</button>
          {rejecting ? (
            <>
              <button className="secondary-btn" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
              <button className="primary-btn !bg-red-600 hover:!bg-red-700" onClick={() => onReject(reason)} disabled={busy || !reason.trim()}>
                <XCircle size={14} />
                <span>{busy ? 'Rejecting…' : 'Confirm Reject'}</span>
              </button>
            </>
          ) : (
            <>
              <button className="secondary-btn !border-red-500 !text-red-600 hover:!bg-red-50" onClick={() => setRejecting(true)} disabled={busy || loading}>
                <XCircle size={14} />
                <span>Reject</span>
              </button>
              <button className="primary-btn !bg-green-600 hover:!bg-green-700" onClick={onApprove} disabled={busy || loading}>
                <CheckCircle size={14} />
                <span>{busy ? 'Approving…' : 'Approve'}</span>
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
