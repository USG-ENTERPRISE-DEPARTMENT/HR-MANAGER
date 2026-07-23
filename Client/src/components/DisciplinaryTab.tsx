import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, X, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import api from '../../lib/api';

export const INCIDENT_TYPES = [
  'Verbal Warning', 'Written Warning', 'Final Warning',
  'Counselling', 'Suspension', 'Gross Misconduct',
  'Performance Issue', 'Policy Violation', 'Dismissal',
];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
export const STATUSES   = ['Open', 'Under Review', 'Resolved', 'Appealed'];

export function severityPill(severity: string) {
  const map: Record<string, string> = {
    Low:      'bg-slate-100 text-slate-600 border-slate-200',
    Medium:   'bg-amber-50 text-amber-700 border-amber-200',
    High:     'bg-orange-50 text-orange-700 border-orange-200',
    Critical: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${map[severity] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
      {severity}
    </span>
  );
}

export function statusPillD(status: string) {
  const map: Record<string, string> = {
    'Open':         'bg-blue-50 text-blue-700 border-blue-200',
    'Under Review': 'bg-purple-50 text-purple-700 border-purple-200',
    'Resolved':     'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Appealed':     'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${map[status] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
      {status}
    </span>
  );
}

const fmtDate = (v: string | null | undefined) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return v; }
};

const PAGE_SIZE = 25;

interface DisciplinaryTabProps {
  onViewEmployee?: (emp: any) => void;
}

export function DisciplinaryTab({ onViewEmployee }: DisciplinaryTabProps) {
  const [records,  setRecords]  = useState<any[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);

  const [search,       setSearch]       = useState('');
  const [debSearch,    setDebSearch]    = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [severity,     setSeverity]     = useState('');
  const [status,       setStatus]       = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 380);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debSearch, incidentType, severity, status, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debSearch)    q.set('search',       debSearch);
      if (incidentType) q.set('incident_type', incidentType);
      if (severity)     q.set('severity',      severity);
      if (status)       q.set('status',        status);
      if (dateFrom)     q.set('date_from',     dateFrom);
      if (dateTo)       q.set('date_to',       dateTo);
      const res = await api.get(`/disciplinary?${q}`);
      const d = res.data.data ?? {};
      setRecords(d.records ?? []);
      setTotal(Number(d.total ?? 0));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [page, debSearch, incidentType, severity, status, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const activeFilters = [incidentType, severity, status, dateFrom, dateTo].filter(Boolean).length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const clearFilters = () => { setIncidentType(''); setSeverity(''); setStatus(''); setDateFrom(''); setDateTo(''); setSearch(''); };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col">
      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-[var(--border)] space-y-2">
        {/* Row 1: search + type */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="search" autoComplete="off"
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search employee, type, or description…"
              className="w-full pl-8 pr-3 py-1.5 text-[12.5px] border border-[var(--border)] rounded-lg bg-[var(--surface-hover)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-all"
            />
          </div>
          <div className="relative shrink-0">
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)] pointer-events-none" />
            <select value={incidentType} onChange={e => setIncidentType(e.target.value)}
              className="pl-6 pr-3 py-1.5 text-[12px] border border-[var(--border)] rounded-lg bg-[var(--surface-hover)] focus:outline-none focus:border-[var(--accent)] appearance-none cursor-pointer">
              <option value="">All types</option>
              {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {/* Row 2: severity + status + date range + clear */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={severity} onChange={e => setSeverity(e.target.value)}
            className="w-auto px-3 py-1.5 text-[12px] border border-[var(--border)] rounded-lg bg-[var(--surface-hover)] focus:outline-none focus:border-[var(--accent)] cursor-pointer">
            <option value="">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="w-auto px-3 py-1.5 text-[12px] border border-[var(--border)] rounded-lg bg-[var(--surface-hover)] focus:outline-none focus:border-[var(--accent)] cursor-pointer">
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="py-1.5 px-2 text-[12px] border border-[var(--border)] rounded-lg bg-[var(--surface-hover)] focus:outline-none focus:border-[var(--accent)]" />
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="py-1.5 px-2 text-[12px] border border-[var(--border)] rounded-lg bg-[var(--surface-hover)] focus:outline-none focus:border-[var(--accent)]" />
          </div>
          {activeFilters > 0 && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline">
              <X size={12} /> Clear ({activeFilters})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th">Employee</th>
              <th className="th">Date</th>
              <th className="th">Type</th>
              <th className="th">Severity</th>
              <th className="th">Action Taken</th>
              <th className="th">Status</th>
              <th className="th text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="td text-center py-10 text-[var(--text-muted)]">Loading…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={7} className="td text-center py-10 text-[var(--text-muted)]">No disciplinary records found.</td></tr>
            ) : records.map((r, i) => (
              <motion.tr key={r.id} className="tr" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 + i * 0.02 }}>
                <td className="td">
                  <p className="font-semibold text-[var(--text-primary)] text-[12.5px]">{r.employee?.name || '—'}</p>
                  {r.employee?.employee_id && <p className="text-[10.5px] text-[var(--text-muted)] font-mono">{r.employee.employee_id}</p>}
                </td>
                <td className="td text-[12.5px]">{fmtDate(r.incident_date)}</td>
                <td className="td text-[12.5px] font-medium text-[var(--text-primary)]">{r.incident_type}</td>
                <td className="td">{severityPill(r.severity)}</td>
                <td className="td text-[12px] text-[var(--text-secondary)] max-w-[200px]">
                  <p className="truncate">{r.action_taken || <span className="italic text-[var(--text-muted)]">—</span>}</p>
                </td>
                <td className="td">{statusPillD(r.status)}</td>
                <td className="td">
                  <div className="flex items-center justify-end">
                    {onViewEmployee && r.employee?.id && (
                      <button
                        onClick={() => onViewEmployee({ id: r.employee.id })}
                        className="action-btn text-[var(--accent)]"
                        title="View employee profile"
                      >
                        <Eye size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(total > 0 || loading) && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] text-[12px] text-[var(--text-muted)]">
          <span>{total} record{total !== 1 ? 's' : ''}{activeFilters > 0 || search ? ' (filtered)' : ''}</span>
          {totalPages > 1 && (
            <div className="flex gap-1.5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded-lg bg-[var(--surface-hover)] hover:bg-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                Prev
              </button>
              <span className="px-2 py-1 text-[var(--text-muted)]">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded-lg bg-[var(--surface-hover)] hover:bg-[var(--border)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
