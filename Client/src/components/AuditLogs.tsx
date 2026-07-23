import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, RefreshCw, Filter, X, Clock, User, Box, Activity, ChevronRight } from 'lucide-react';
import api from '../../lib/api';
import { PageHeader } from './ui/PageHeader';
import { TablePagination } from './ui/TablePagination';
import { inputClass } from './ui/FormField';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  module: string;
  action: string;
  entity_id: string | null;
  entity_name: string | null;
  user_id: string | null;
  user_name: string | null;
  ip_address: string | null;
  details: string | null;
  created_at: string;
}

// ── Action badge colours ───────────────────────────────────────────────────────

const ACTION_STYLE: Record<string, { bg: string; text: string; label?: string }> = {
  create:     { bg: 'rgba(16,185,129,0.12)',   text: '#059669' },
  approve:    { bg: 'rgba(16,185,129,0.12)',   text: '#059669' },
  activate:   { bg: 'rgba(16,185,129,0.12)',   text: '#059669' },
  finalize:   { bg: 'rgba(16,185,129,0.12)',   text: '#059669' },
  update:     { bg: 'rgba(99,102,241,0.12)',   text: '#4f46e5' },
  generate:   { bg: 'rgba(99,102,241,0.12)',   text: '#4f46e5' },
  submit:     { bg: 'rgba(245,158,11,0.12)',   text: '#b45309' },
  active:     { bg: 'rgba(245,158,11,0.12)',   text: '#b45309', label: 'reactivate' },
  delete:     { bg: 'rgba(239,68,68,0.12)',    text: '#dc2626' },
  deactivate: { bg: 'rgba(239,68,68,0.12)',    text: '#dc2626' },
  terminated: { bg: 'rgba(239,68,68,0.12)',    text: '#dc2626' },
  suspended:  { bg: 'rgba(239,68,68,0.12)',    text: '#dc2626' },
  reject:     { bg: 'rgba(239,68,68,0.12)',    text: '#dc2626' },
  resign:     { bg: 'rgba(239,68,68,0.12)',    text: '#dc2626' },
};

const MODULE_ICON: Record<string, React.ReactNode> = {
  Employees: <User    size={12} />,
  Users:     <User    size={12} />,
  Payroll:   <Activity size={12} />,
  Company:   <Box     size={12} />,
};

const ALL_MODULES = ['Employees', 'Users', 'Payroll', 'Company'];

function ActionBadge({ action }: { action: string }) {
  const key = action.toLowerCase();
  const style = ACTION_STYLE[key] ?? { bg: 'var(--surface-hover)', text: 'var(--text-muted)' };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize"
      style={{ background: style.bg, color: style.text }}>
      {style.label ?? action}
    </span>
  );
}

function ModuleBadge({ module }: { module: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--accent-dim)] text-[var(--accent)]">
      {MODULE_ICON[module] ?? <Box size={12} />}
      {module}
    </span>
  );
}

function DetailsTip({ raw }: { raw: string | null }) {
  if (!raw) return null;
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const entries = Object.entries(parsed ?? {}).filter(([, v]) => v != null && v !== '');
  if (!entries.length) return null;
  return (
    <div className="mt-1 text-[11px] text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-0.5">
      {entries.map(([k, v]) => (
        <span key={k}><span className="font-semibold">{k}:</span> {String(v)}</span>
      ))}
    </div>
  );
}

// ── Detail slide-over ───────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return String(v); } }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); if (!isNaN(d.getTime())) return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
  return s;
}

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
    <p className="text-[12.5px] text-[var(--text-primary)] mt-0.5 break-words">{value}</p>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">{title}</p>
    {children}
  </div>
);

function KeyValues({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).filter(([k, v]) => k !== 'changes' && v != null && v !== '');
  if (!entries.length) return <p className="text-[12px] text-[var(--text-muted)] italic">—</p>;
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-3 text-[12.5px]">
          <span className="font-semibold text-[var(--text-secondary)] min-w-[130px] shrink-0">{k}</span>
          <span className="text-[var(--text-primary)] break-words">{formatVal(v)}</span>
        </div>
      ))}
    </div>
  );
}

function AuditDetailPanel({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  let parsed: any = null;
  try { parsed = entry.details ? JSON.parse(entry.details) : null; } catch { parsed = null; }
  const changes = parsed?.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  const created = parsed?.created as Record<string, unknown> | undefined;
  const deleted = parsed?.deleted as Record<string, unknown> | undefined;
  const generic = parsed && !changes && !created && !deleted
    ? Object.entries(parsed).filter(([, v]) => v != null && v !== '') : [];

  return (
    <>
      <motion.div className="fixed inset-0 bg-black/40 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="fixed right-0 top-0 bottom-0 w-full max-w-[460px] bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.25 }}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2"><ModuleBadge module={entry.module} /><ActionBadge action={entry.action} /></div>
            <h3 className="text-[15px] font-bold syne text-[var(--text-primary)] break-words">{entry.entity_name ?? 'Activity'}</h3>
          </div>
          <button onClick={onClose} className="action-btn shrink-0" title="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Meta label="When" value={fmtDateTime(entry.created_at)} />
            <Meta label="By" value={entry.user_name ?? '—'} />
            <Meta label="Entity ID" value={entry.entity_id ?? '—'} />
            <Meta label="IP Address" value={entry.ip_address ?? '—'} />
          </div>

          {changes && Object.keys(changes).length > 0 && (
            <Section title="What changed">
              <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                <div className="grid grid-cols-[1.1fr_1fr_1fr] text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] bg-[var(--bg)] px-3 py-2 border-b border-[var(--border)]">
                  <span>Field</span><span>From</span><span>To</span>
                </div>
                {Object.entries(changes).map(([k, c]) => (
                  <div key={k} className="grid grid-cols-[1.1fr_1fr_1fr] gap-2 px-3 py-2 text-[12px] border-b border-[var(--border-light)] last:border-0 items-start">
                    <span className="font-semibold text-[var(--text-primary)] break-words">{k}</span>
                    <span className="text-[var(--danger)] break-words">{formatVal(c.from)}</span>
                    <span className="text-[var(--success)] break-words">{formatVal(c.to)}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(created || deleted) && (
            <Section title={created ? 'Record created' : 'Record deleted'}>
              <KeyValues obj={(created || deleted)!} />
            </Section>
          )}

          {generic.length > 0 && <Section title="Details"><KeyValues obj={parsed} /></Section>}

          {parsed && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-[var(--text-muted)] select-none">Raw JSON</summary>
              <pre className="mt-2 p-3 bg-[var(--bg)] rounded-lg overflow-x-auto text-[11px] text-[var(--text-secondary)] leading-relaxed">{JSON.stringify(parsed, null, 2)}</pre>
            </details>
          )}
          {!parsed && <p className="text-[12px] text-[var(--text-muted)] italic">No additional details were recorded for this action.</p>}
        </div>
      </motion.div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function AuditLogs() {
  const [logs,        setLogs]        = useState<AuditEntry[]>([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [loading,     setLoading]     = useState(false);
  const [search,      setSearch]      = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selected,    setSelected]    = useState<AuditEntry | null>(null);

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(p), limit: String(PAGE_SIZE) };
      if (search)       params.search    = search;
      if (moduleFilter) params.module    = moduleFilter;
      if (dateFrom)     params.date_from = dateFrom;
      if (dateTo)       params.date_to   = dateTo;

      const qs = new URLSearchParams(params).toString();
      const res = await api.get(`/audit-logs?${qs}`);
      const { logs: rows, total: tot } = res.data.data;
      setLogs(rows ?? []);
      setTotal(Number(tot ?? 0));
      setPage(p);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, moduleFilter, dateFrom, dateTo]);

  useEffect(() => { load(1); }, [search, moduleFilter, dateFrom, dateTo]);

  const hasFilters = !!(search || moduleFilter || dateFrom || dateTo);

  function clearFilters() {
    setSearch('');
    setModuleFilter('');
    setDateFrom('');
    setDateTo('');
  }

  function fmt(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full max-w-[1400px] mx-auto flex flex-col gap-5">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <PageHeader title="Audit Logs" subtitle="Track all system-wide activities — who did what and when." />
      </motion.div>

      {/* ── Toolbar ── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden drop-shadow-sm">

        {/* Top row */}
        <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="search-wrap flex-1 sm:max-w-[320px]">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search by name, user, action…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <button
              onClick={() => setShowFilters(s => !s)}
              className={`secondary-btn shrink-0 ${showFilters || hasFilters ? 'ring-2 ring-[var(--accent)] ring-offset-1' : ''}`}
            >
              <Filter size={14} /> Filters
              {hasFilters && (
                <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold">
                  {[search, moduleFilter, dateFrom, dateTo].filter(Boolean).length}
                </span>
              )}
            </button>
            {hasFilters && (
              <button onClick={clearFilters} className="action-btn text-[var(--danger)]" title="Clear filters">
                <X size={15} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="secondary-btn" onClick={() => load(page)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="px-5 pb-4 border-t border-[var(--border)] pt-4 bg-[var(--bg)] flex flex-wrap gap-4">
            {/* Module filter chips */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Module</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setModuleFilter('')}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${!moduleFilter ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}
                >All</button>
                {ALL_MODULES.map(m => (
                  <button key={m}
                    onClick={() => setModuleFilter(moduleFilter === m ? '' : m)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${moduleFilter === m ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]'}`}
                  >{m}</button>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Date Range</span>
              <div className="flex items-center gap-2">
                <input type="date" className={inputClass + ' py-1.5 text-[12px] w-[140px]'}
                  value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                <span className="text-[var(--text-muted)] text-[12px]">to</span>
                <input type="date" className={inputClass + ' py-1.5 text-[12px] w-[140px]'}
                  value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="th text-left py-3 px-4 w-[160px]"><span className="flex items-center gap-1.5"><Clock size={12} /> Time</span></th>
                <th className="th text-left py-3 px-4 w-[110px]">Module</th>
                <th className="th text-left py-3 px-4 w-[110px]">Action</th>
                <th className="th text-left py-3 px-4">Entity</th>
                <th className="th text-left py-3 px-4 w-[150px]"><span className="flex items-center gap-1.5"><User size={12} /> User</span></th>
                <th className="th py-3 px-4 w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="td text-center py-12 text-[var(--text-muted)]">
                  <RefreshCw size={16} className="animate-spin inline mr-2" /> Loading…
                </td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="td text-center py-12 text-[var(--text-muted)]">
                  {hasFilters ? 'No entries match the current filters.' : 'No audit log entries yet.'}
                </td></tr>
              ) : logs.map((entry, i) => (
                <motion.tr key={entry.id} className="tr cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
                  onClick={() => setSelected(entry)}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                  <td className="td py-3 px-4 text-[var(--text-muted)] text-[12px] whitespace-nowrap">{fmt(entry.created_at)}</td>
                  <td className="td py-3 px-4"><ModuleBadge module={entry.module} /></td>
                  <td className="td py-3 px-4"><ActionBadge action={entry.action} /></td>
                  <td className="td py-3 px-4">
                    <div className="font-medium text-[var(--text-primary)]">{entry.entity_name ?? <span className="opacity-40">—</span>}</div>
                    <DetailsTip raw={entry.details} />
                  </td>
                  <td className="td py-3 px-4 text-[var(--text-muted)]">
                    <div>{entry.user_name ?? <span className="opacity-40">—</span>}</div>
                    {entry.ip_address && <div className="text-[11px] opacity-60">{entry.ip_address}</div>}
                  </td>
                  <td className="td py-3 px-4 text-right"><ChevronRight size={15} className="text-[var(--text-muted)]" /></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <TablePagination
            total={total}
            filtered={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={p => load(p)}
          />
        )}
      </motion.div>

      <AnimatePresence>
        {selected && <AuditDetailPanel entry={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}
