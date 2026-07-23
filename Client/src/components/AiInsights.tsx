import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, RefreshCw, AlertTriangle, TrendingDown, X, Info, ListChecks } from 'lucide-react';
import { PageHeader } from './ui/PageHeader';
import { aiAttrition } from '../../lib/aiClient';

interface Factor { label: string; points: number; }
interface Row {
  employee_id: string; name: string; department: string; job_title: string;
  score: number; band: 'Low' | 'Medium' | 'High'; factors: Factor[];
}

const BAND: Record<string, { bg: string; text: string }> = {
  High:   { bg: 'var(--danger-dim)',  text: 'var(--danger)' },
  Medium: { bg: 'var(--warning-dim)', text: 'var(--warning)' },
  Low:    { bg: 'var(--success-dim)', text: 'var(--success)' },
};

export function AiInsights() {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);

  const load = () => {
    setLoad(true); setError(null);
    aiAttrition()
      .then(setData)
      .catch(e => setError(e?.response?.data?.message || 'Could not compute insights.'))
      .finally(() => setLoad(false));
  };
  useEffect(load, []);

  const rows: Row[] = data?.employees ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <PageHeader title="Attrition Risk Insights" subtitle="Explainable, offline scoring of which employees may be at risk of leaving." />
        <button onClick={load} disabled={loading} className="secondary-btn shrink-0">
          <RefreshCw size={14} className={`inline mr-1.5 ${loading ? 'animate-spin' : ''}`} />Recompute
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[13px] text-[var(--warning)] bg-[var(--warning-dim)] border border-[var(--border)] rounded-xl px-4 py-3 mb-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary */}
      {data && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Employees scored', value: data.total, color: 'var(--accent)' },
            { label: 'High risk',        value: data.high,  color: 'var(--danger)' },
            { label: 'Medium risk',      value: data.medium, color: 'var(--warning)' },
          ].map(c => (
            <div key={c.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-5 py-4">
              <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">{c.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: c.color }}>{c.value ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
          <Sparkles size={15} className="text-[var(--purple)]" />
          <h3 className="text-[14px] font-bold text-[var(--text-primary)] syne">Risk scorecard</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead>
              <tr>
                <th className="th">Employee</th>
                <th className="th">Department</th>
                <th className="th !text-center">Risk</th>
                <th className="th">Score</th>
                <th className="th">Top factors</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="td text-center text-[var(--text-muted)] py-8" colSpan={5}>Computing…</td></tr>
              ) : rows.length ? rows.map(r => (
                <tr key={r.employee_id} className="tr cursor-pointer" onClick={() => setSelected(r)}>
                  <td className="td">
                    <p className="font-semibold text-[13px] text-[var(--text-primary)]">{r.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{r.job_title}</p>
                  </td>
                  <td className="td text-[13px]">{r.department}</td>
                  <td className="td text-center">
                    <span className="pill text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: BAND[r.band]?.bg, color: BAND[r.band]?.text }}>{r.band}</span>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${r.score}%`, background: BAND[r.band]?.text }} />
                      </div>
                      <span className="text-[12px] font-semibold tabular-nums" style={{ color: BAND[r.band]?.text }}>{r.score}</span>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {r.factors.length ? r.factors.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[var(--text-secondary)]">
                          <TrendingDown size={10} /> {f.label}
                        </span>
                      )) : <span className="text-[11px] text-[var(--text-muted)]">—</span>}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td className="td text-center text-[var(--text-muted)] py-8" colSpan={5}>No data.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="text-[11px] text-[var(--text-muted)] mt-3">
        Scores are heuristic and explainable — derived from tenure, attendance, leave, performance, and disciplinary signals.
        Use them as a prompt for a conversation, not a decision on their own.
      </motion.p>

      <AnimatePresence>
        {selected && <AttritionDetail row={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

const BAND_NOTE: Record<string, string> = {
  High:   'This employee shows several concurrent risk signals. A proactive retention conversation is recommended.',
  Medium: 'Some risk signals are present. Worth monitoring and checking in over the coming weeks.',
  Low:    'No significant risk signals detected from the available data.',
};

const NEXT_STEPS: Record<string, string[]> = {
  High: [
    'Schedule a 1:1 retention/career conversation with the employee.',
    'Review workload, recognition, and compensation/notch progression.',
    'Address any open disciplinary or attendance issues constructively.',
  ],
  Medium: [
    'Have an informal check-in to understand current engagement.',
    'Watch attendance and leave patterns over the next cycle.',
  ],
  Low: ['No action needed beyond normal engagement.'],
};

// Slide-over explaining why an employee scored as they did, with suggested next steps.
function AttritionDetail({ row, onClose }: { row: Row; onClose: () => void }) {
  const c = BAND[row.band] ?? BAND.Low;
  return (
    <div className="fixed inset-0 z-[110] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative z-10 w-full max-w-md bg-[var(--surface)] shadow-2xl flex flex-col h-full border-l border-[var(--border)] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-[var(--text-primary)] syne truncate">{row.name}</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{row.job_title} · {row.department}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--bg)] rounded-full text-[var(--text-muted)] shrink-0"><X size={18} /></button>
        </div>

        {/* Score header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center shrink-0" style={{ background: c.bg }}>
            <span className="text-xl font-bold leading-none" style={{ color: c.text }}>{row.score}</span>
            <span className="text-[9px] font-semibold uppercase tracking-wide mt-0.5" style={{ color: c.text }}>{row.band}</span>
          </div>
          <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed">{BAND_NOTE[row.band]}</p>
        </div>

        {/* Contributing factors */}
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-1.5 mb-3">
            <ListChecks size={14} className="text-[var(--purple)]" />
            <h4 className="text-[13px] font-bold text-[var(--text-primary)]">Contributing factors</h4>
          </div>
          {row.factors.length ? (
            <div className="space-y-2">
              {row.factors.map((f, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <span className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
                    <TrendingDown size={13} className="text-[var(--danger)] shrink-0" /> {f.label}
                  </span>
                  <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: c.text }}>+{f.points}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-[var(--text-muted)]">No notable risk factors — this employee's signals look healthy.</p>
          )}
        </div>

        {/* Suggested next steps */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-1.5 mb-3">
            <Info size={14} className="text-[var(--accent)]" />
            <h4 className="text-[13px] font-bold text-[var(--text-primary)]">Suggested next steps</h4>
          </div>
          <ul className="space-y-1.5">
            {(NEXT_STEPS[row.band] ?? []).map((s, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] text-[var(--text-secondary)]">
                <span className="text-[var(--accent)] mt-0.5">•</span><span>{s}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[var(--text-muted)] mt-4 leading-relaxed">
            This is a heuristic indicator from tenure, attendance, leave, performance, and disciplinary data — a prompt for a conversation, not a decision on its own.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
