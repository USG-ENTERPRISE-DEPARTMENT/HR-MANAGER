import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  BarChart2, ClipboardList, Target, Brain,
  Plus, Pencil, Trash2, Eye, Play, ChevronLeft,
  CheckCircle2, Users, Loader2, Filter, X,
  CalendarRange, Flag, AlertTriangle,
} from 'lucide-react';
import api from '../../lib/api';
import { useCan } from '@/hooks/useCan';
import { toast } from 'sonner';
import { getCurrentUser } from '../../lib/auth';
import { PageHeader } from './ui/PageHeader';
import { RowActions } from './ui/RowActions';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { ConfirmModal } from './ui/ConfirmModal';
import { SearchSelect, MultiSearchSelect } from './ui/SearchSelect';
import { FilterSelect } from './ui/FilterSelect';
import { ReviewDetailSlideOver } from './ReviewDetailSlideOver';
import { CountedTextarea } from './ui/CountedTextarea';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return String(v).substring(0, 10); }
}

const CYCLE_TYPES    = ['Annual', 'Semi-Annual', 'Quarterly', 'Probation'];
const CYCLE_STATUSES = ['Draft', 'Active', 'Closed'];

const STATUS_COLOR: Record<string, string> = {
  Draft:               'bg-slate-100 text-slate-500 border border-slate-200',
  Active:              'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Closed:              'bg-rose-50 text-rose-600 border border-rose-200',
  'Not Started':       'bg-slate-100 text-slate-500 border border-slate-200',
  'Self Assessment':   'bg-amber-50 text-amber-700 border border-amber-200',
  'Supervisor Review': 'bg-blue-50 text-blue-700 border border-blue-200',
  'HR Review':         'bg-violet-50 text-violet-700 border border-violet-200',
  Completed:           'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

const ACHIEVEMENT_COLOR: Record<string, string> = {
  Exceeded:       'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Met:            'bg-blue-50 text-blue-700 border border-blue-200',
  'Partially Met':'bg-amber-50 text-amber-700 border border-amber-200',
  'Not Met':      'bg-rose-50 text-rose-600 border border-rose-200',
};

const REVIEW_STATUSES = ['Not Started', 'Self Assessment', 'Supervisor Review', 'HR Review', 'Completed'];

function Pill({ label }: { label: string }) {
  const cls = STATUS_COLOR[label] ?? 'bg-slate-100 text-slate-500';
  return <span className={`pill text-[11px] ${cls}`}>{label}</span>;
}

function toNum(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? null : n; }
  if (typeof v === 'object' && Array.isArray(v.d) && v.d.length > 0 && typeof v.s === 'number') {
    const sign = v.s < 0 ? -1 : 1;
    const intPart = String(v.d[0]);
    const fracPart = (v.d as number[]).slice(1).map((n: number) => String(n).padStart(7, '0')).join('').replace(/0+$/, '');
    const full = parseFloat(fracPart ? `${intPart}.${fracPart}` : intPart);
    return isNaN(full) ? null : sign * full;
  }
  return null;
}

function ScoreBar({ score }: { score: any }) {
  const num = toNum(score);
  if (!num || isNaN(num)) return <span className="text-[var(--text-muted)]">—</span>;
  const pct = (num / 5) * 100;
  const color = num >= 4 ? '#22c55e' : num >= 3 ? '#3b82f6' : num >= 2 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[12px] font-semibold" style={{ color }}>{num.toFixed(1)}</span>
    </div>
  );
}

function ProgressRing({ completed, total }: { completed: number; total: number }) {
  const r = 20; const circ = 2 * Math.PI * r;
  const pct = total > 0 ? completed / total : 0;
  const dash = pct * circ;
  return (
    <svg width={52} height={52} className="rotate-[-90deg]">
      <circle cx={26} cy={26} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
      <circle cx={26} cy={26} r={r} fill="none" stroke="#22c55e" strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      <text x={26} y={30} textAnchor="middle" fontSize={10} fontWeight={700}
        fill="var(--text-primary)" className="rotate-90" style={{ transform: 'rotate(90deg) translate(0, -52px)' }}>
        {total > 0 ? `${Math.round(pct * 100)}%` : '0%'}
      </text>
    </svg>
  );
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { label: 'Cycles',       icon: BarChart2     },
  { label: 'Reviews',      icon: ClipboardList },
  { label: 'Goals',        icon: Target        },
  { label: 'Competencies', icon: Brain         },
];

// ─── Cycle card ──────────────────────────────────────────────────────────────

const CYCLE_ACCENT: Record<string, string> = {
  Draft:  '#64748b',
  Active: '#16a34a',
  Closed: '#e11d48',
};

function CycleCard({ cycle, onView, onEdit, onActivate, onClose, onDelete, canEdit = true, canDelete = true }: {
  canEdit?: boolean; canDelete?: boolean;
  cycle: any;
  onView: () => void;
  onEdit: () => void;
  onActivate: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const stats  = cycle.stats ?? { total: 0, completed: 0 };
  const accent = CYCLE_ACCENT[cycle.status] ?? '#64748b';

  // ── Cycle timeline math ──────────────────────────────────────────────
  const MS = 86_400_000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = cycle.period_start ? new Date(String(cycle.period_start).substring(0, 10) + 'T00:00:00') : null;
  const end   = cycle.period_end   ? new Date(String(cycle.period_end).substring(0, 10) + 'T00:00:00')   : null;
  const span  = start && end && end > start ? end.getTime() - start.getTime() : null;
  const elapsedPct = span ? Math.min(100, Math.max(0, ((today.getTime() - start!.getTime()) / span) * 100)) : 0;

  const milestones = [
    { key: 'S', label: 'Self assessment',   date: cycle.self_due },
    { key: 'M', label: 'Supervisor review', date: cycle.supervisor_due },
    { key: 'H', label: 'HR review',         date: cycle.hr_due },
  ]
    .filter(m => m.date)
    .map(m => ({ ...m, d: new Date(String(m.date).substring(0, 10) + 'T00:00:00') }));

  const upcoming = milestones.filter(m => m.d >= today).sort((a, b) => a.d.getTime() - b.d.getTime())[0] ?? null;
  const overdue  = cycle.status === 'Active' && !upcoming && milestones.length > 0
    ? milestones.sort((a, b) => b.d.getTime() - a.d.getTime())[0]
    : null;
  const daysTo = (d: Date) => Math.round((d.getTime() - today.getTime()) / MS);

  const completionPct = Number(stats.total) > 0 ? Math.round((Number(stats.completed) / Number(stats.total)) * 100) : 0;

  return (
    <div className="relative overflow-hidden border border-[var(--border)] rounded-[14px] bg-[var(--surface)] flex flex-col transition-all hover:-translate-y-0.5 hover:shadow-md drop-shadow-sm">
      {/* Status accents — subtle wash + hairline arcs, house style */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute inset-0" style={{ background: `linear-gradient(225deg, color-mix(in srgb, ${accent} 6%, transparent), transparent 40%)` }} />
        <svg className="absolute -top-9 -right-9 h-24 w-24" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="34" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${accent} 20%, transparent)` }} />
          <circle cx="48" cy="48" r="42" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${accent} 12%, transparent)` }} />
        </svg>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] shrink-0 mt-0.5" style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)` }}>
          <CalendarRange size={16} style={{ color: accent }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[14px] text-[var(--text-primary)] truncate leading-snug">{cycle.name}</p>
          <p className="text-[11.5px] text-[var(--text-muted)] mt-0.5">
            {cycle.type} · {fmtDate(cycle.period_start)} – {fmtDate(cycle.period_end)}
          </p>
        </div>
        <Pill label={cycle.status} />
      </div>

      {/* Cycle timeline with milestone markers */}
      <div className="px-4 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Cycle Timeline</p>
          <p className="text-[10.5px] tabular-nums text-[var(--text-muted)]">{span ? `${Math.round(elapsedPct)}% elapsed` : '—'}</p>
        </div>
        <div className="relative h-2 rounded-full bg-[var(--border)]/60">
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${elapsedPct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 55%, transparent), ${accent})`, transition: 'width .5s ease' }} />
          {span && milestones.map(m => {
            const pos = Math.min(98, Math.max(2, ((m.d.getTime() - start!.getTime()) / span) * 100));
            const passed = m.d < today;
            return (
              <span
                key={m.key}
                title={`${m.label} due ${fmtDate(m.date)}`}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold border-2 cursor-default"
                style={{
                  left: `${pos}%`,
                  background: passed ? accent : 'var(--surface)',
                  color: passed ? '#fff' : 'var(--text-muted)',
                  borderColor: passed ? accent : 'var(--border)',
                }}
              >{m.key}</span>
            );
          })}
        </div>
        <div className="mt-2 min-h-[16px]">
          {upcoming ? (
            <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
              <Flag size={11} className="shrink-0" style={{ color: accent }} />
              {upcoming.label} due {fmtDate(upcoming.date)}
              <span className="font-semibold" style={{ color: accent }}>
                {daysTo(upcoming.d) === 0 ? '· today' : `· in ${daysTo(upcoming.d)} day${daysTo(upcoming.d) === 1 ? '' : 's'}`}
              </span>
            </p>
          ) : overdue ? (
            <p className="flex items-center gap-1.5 text-[11.5px] text-rose-600 font-medium">
              <AlertTriangle size={11} className="shrink-0" />
              {overdue.label} was due {fmtDate(overdue.date)} — {Math.abs(daysTo(overdue.d))} day{Math.abs(daysTo(overdue.d)) === 1 ? '' : 's'} overdue
            </p>
          ) : (
            <p className="text-[11.5px] text-[var(--text-muted)]">
              {cycle.status === 'Closed' ? 'Cycle closed' : 'No review deadlines set'}
            </p>
          )}
        </div>
      </div>

      {/* Completion */}
      <div className="flex items-center gap-3 px-4 pb-4">
        <div className="relative flex items-center justify-center w-[52px] h-[52px] shrink-0">
          <ProgressRing completed={Number(stats.completed)} total={Number(stats.total)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-[var(--text-secondary)]">
            <span className="text-[15px] font-bold tabular-nums text-[var(--text-primary)]">{stats.completed}</span>
            <span className="text-[var(--text-muted)]"> of {stats.total} reviews completed</span>
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-[var(--border)]/60 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${completionPct}%`, transition: 'width .5s ease' }} />
          </div>
        </div>
        <span className="flex items-center gap-1 text-[11.5px] text-[var(--text-muted)] shrink-0" title="Participants">
          <Users size={12} /> {stats.total}
        </span>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg)]">
        <button onClick={onView}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
          <Eye size={11} /> Reviews
        </button>
        {canEdit && <button onClick={onEdit}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
          <Pencil size={11} /> Edit
        </button>}
        <span className="flex-1" />
        {canEdit && cycle.status === 'Draft' && (
          <button onClick={onActivate}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors">
            <Play size={11} /> Activate
          </button>
        )}
        {canEdit && cycle.status === 'Active' && (
          <button onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={11} /> Close
          </button>
        )}
        {canDelete && cycle.status === 'Draft' && (
          <button onClick={onDelete}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors">
            <Trash2 size={11} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Cycle form modal ─────────────────────────────────────────────────────────

const BLANK_CYCLE = { name: '', type: 'Annual', period_start: '', period_end: '', self_due: '', supervisor_due: '', hr_due: '', notes: '' };

function CycleFormModal({ cycle, onClose, onSaved }: { cycle: any | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(cycle ? {
    name:           cycle.name ?? '',
    type:           cycle.type ?? 'Annual',
    period_start:   (cycle.period_start   ?? '').substring(0, 10),
    period_end:     (cycle.period_end     ?? '').substring(0, 10),
    self_due:       (cycle.self_due       ?? '').substring(0, 10),
    supervisor_due: (cycle.supervisor_due ?? '').substring(0, 10),
    hr_due:         (cycle.hr_due         ?? '').substring(0, 10),
    notes:          cycle.notes ?? '',
  } : { ...BLANK_CYCLE });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim())  return toast.error('Cycle name is required');
    if (!form.period_start) return toast.error('Period start is required');
    if (!form.period_end)   return toast.error('Period end is required');
    setSaving(true);
    try {
      if (cycle?.id) { await api.put(`/performance/cycles/${cycle.id}`, form); toast.success('Cycle updated'); }
      else           { await api.post('/performance/cycles', form);            toast.success('Cycle created'); }
      onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <FormModal title={cycle ? 'Edit Cycle' : 'New Review Cycle'} maxWidth="lg" scrollable
      onClose={onClose} onSave={save} saveLabel={saving ? 'Saving…' : (cycle ? 'Save Changes' : 'Create Cycle')}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Cycle Name" required className="col-span-2">
          <input className={inputClass} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. 2025 Annual Review" />
        </FormField>
        <FormField label="Type">
          <select className={inputClass} value={form.type} onChange={e => set('type', e.target.value)}>
            {CYCLE_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </FormField>
        <div />
        <FormField label="Period Start" required>
          <input type="date" className={inputClass} value={form.period_start} onChange={e => set('period_start', e.target.value)} />
        </FormField>
        <FormField label="Period End" required>
          <input type="date" className={inputClass} value={form.period_end} onChange={e => set('period_end', e.target.value)} />
        </FormField>
        <FormField label="Self-Assessment Due">
          <input type="date" className={inputClass} value={form.self_due} onChange={e => set('self_due', e.target.value)} />
        </FormField>
        <FormField label="Supervisor Review Due">
          <input type="date" className={inputClass} value={form.supervisor_due} onChange={e => set('supervisor_due', e.target.value)} />
        </FormField>
        <FormField label="HR Sign-off Due">
          <input type="date" className={inputClass} value={form.hr_due} onChange={e => set('hr_due', e.target.value)} />
        </FormField>
        <div />
        <FormField label="Notes" className="col-span-2">
          <CountedTextarea className={inputClass} rows={2} maxChars={1000} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </FormField>
      </div>
    </FormModal>
  );
}

// ─── Add employees modal ──────────────────────────────────────────────────────

function AddEmployeesModal({ cycleId, existingEmployeeIds = [], onClose, onSaved }: {
  cycleId: string;
  existingEmployeeIds?: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deptFilter, setDeptFilter] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/employees/active').then(r => {
      setAllEmployees(r.data.data ?? r.data);
    }).catch(() => {});
  }, []);

  const existingSet = new Set(existingEmployeeIds);
  const available = allEmployees.filter((e: any) => !existingSet.has(String(e.id)));

  const departments = Array.from(new Set(available.map((e: any) => e.department).filter(Boolean))).sort();

  const employeeOptions = available
    .filter((e: any) => !deptFilter || e.department === deptFilter)
    .map((e: any) => ({
      id:    String(e.id),
      label: e.name + (e.employee_id ? ` (${e.employee_id})` : ''),
    }));

  const addAllFromDept = () => {
    if (!deptFilter) return;
    const ids = available
      .filter((e: any) => e.department === deptFilter)
      .map((e: any) => String(e.id));
    setSelectedIds(prev => Array.from(new Set([...prev, ...ids])));
    toast.success(`${ids.length} employee(s) from ${deptFilter} selected`);
  };

  const save = async () => {
    if (!selectedIds.length) return toast.error('Select at least one employee');
    setSaving(true);
    try {
      const assignments = selectedIds.map(id => ({ employee_id: id }));
      await api.post(`/performance/cycles/${cycleId}/employees`, { assignments });
      toast.success(`${selectedIds.length} employee(s) added`);
      onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <FormModal title="Add Employees to Cycle" maxWidth="md" scrollable={false}
      onClose={onClose} onSave={save} saveLabel={saving ? 'Adding…' : 'Add Employees'}>
      <div className="flex flex-col gap-4">
        {departments.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Filter by Department</label>
              <select className={inputClass} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="">All departments</option>
                {departments.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            {deptFilter && (
              <button type="button" onClick={addAllFromDept}
                className="secondary-btn shrink-0 flex items-center gap-1.5 whitespace-nowrap">
                <Users size={13} /> Add All from {deptFilter}
              </button>
            )}
          </div>
        )}
        <FormField label="Employees" required hint="Supervisors are automatically assigned from each employee's profile.">
          <MultiSearchSelect options={employeeOptions} value={selectedIds} onChange={setSelectedIds} placeholder="Search employees…" />
        </FormField>
        {selectedIds.length > 0 && (
          <p className="text-[12px] text-[var(--text-muted)]">{selectedIds.length} employee(s) selected</p>
        )}
      </div>
    </FormModal>
  );
}

// ─── Goal form modal ──────────────────────────────────────────────────────────

const GOAL_STATUSES = ['Draft', 'Active', 'Completed', 'Cancelled'];

function GoalFormModal({ goal, cycles, employees, onClose, onSaved }: {
  goal: any | null; cycles: any[]; employees: { id: string; label: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = Boolean(goal?.id);
  const [form, setForm] = useState(isEdit ? {
    cycle_id:    String(goal.cycle_id ?? ''),
    title:       goal.title ?? '',
    description: goal.description ?? '',
    weight:      goal.weight != null ? String(goal.weight) : '',
    target:      goal.target ?? '',
    due_date:    (goal.due_date ?? '').substring(0, 10),
    status:      goal.status ?? 'Active',
  } : { cycle_id: '', title: '', description: '', weight: '', target: '', due_date: '', status: 'Active' });
  const existingEmployeeId = isEdit ? String(goal.employee?.id ?? goal.employee ?? '') : '';
  const [employeeIds, setEmployeeIds] = useState<string[]>(existingEmployeeId ? [existingEmployeeId] : []);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!employeeIds.length) return toast.error('Select at least one employee');
    if (!form.title.trim()) return toast.error('Title is required');
    setSaving(true);
    try {
      const body = { ...form, weight: form.weight ? Number(form.weight) : null, cycle_id: form.cycle_id || null };
      if (isEdit) {
        await api.put(`/performance/goals/${goal.id}`, { ...body, employee_id: employeeIds[0] });
        for (const eid of employeeIds.slice(1)) {
          await api.post('/performance/goals', { ...body, employee_id: eid });
        }
        toast.success(employeeIds.length > 1 ? `Goal updated + ${employeeIds.length - 1} new goal(s) created` : 'Goal updated');
      } else {
        for (const eid of employeeIds) {
          await api.post('/performance/goals', { ...body, employee_id: eid });
        }
        toast.success(employeeIds.length > 1 ? `${employeeIds.length} goals created` : 'Goal created');
      }
      onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <FormModal title={isEdit ? 'Edit Goal' : 'New Goal'} maxWidth="lg" scrollable
      onClose={onClose} onSave={save} saveLabel={saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create')}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Employee" required className="col-span-2">
          <MultiSearchSelect options={employees} value={employeeIds} onChange={setEmployeeIds} placeholder="Select employees…" />
        </FormField>
        <FormField label="Goal Title" required className="col-span-2">
          <input className={inputClass} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Increase customer satisfaction score" />
        </FormField>
        <FormField label="Description" className="col-span-2">
          <CountedTextarea className={inputClass} rows={2} maxChars={2000} value={form.description} onChange={e => set('description', e.target.value)} />
        </FormField>
        <FormField label="Link to Cycle">
          <select className={inputClass} value={form.cycle_id} onChange={e => set('cycle_id', e.target.value)}>
            <option value="">None</option>
            {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Weight (%)">
          <input type="number" min={0} max={100} className={inputClass} value={form.weight}
            onChange={e => set('weight', e.target.value)}
            onWheel={e => e.currentTarget.blur()}
            placeholder="0–100" />
        </FormField>
        <FormField label="Measurable Target" className="col-span-2">
          <input className={inputClass} value={form.target} onChange={e => set('target', e.target.value)} placeholder="e.g. Score ≥ 90% in quarterly survey" />
        </FormField>
        <FormField label="Due Date">
          <input type="date" className={inputClass} value={form.due_date} onChange={e => set('due_date', e.target.value)} />
        </FormField>
        <FormField label="Status">
          <select className={inputClass} value={form.status} onChange={e => set('status', e.target.value)}>
            {GOAL_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </FormField>
      </div>
    </FormModal>
  );
}

// ─── Competency form modal ────────────────────────────────────────────────────

const COMP_CATEGORIES = ['Leadership', 'Technical', 'Communication', 'People', 'Integrity', 'Adaptability', 'Customer Focus', 'Other'];

function CompFormModal({ comp, onClose, onSaved }: { comp: any | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: comp?.name ?? '', category: comp?.category ?? 'Leadership', description: comp?.description ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim())     return toast.error('Name is required');
    if (!form.category.trim()) return toast.error('Category is required');
    setSaving(true);
    try {
      if (comp?.id) await api.put(`/performance/competencies/${comp.id}`, form);
      else          await api.post('/performance/competencies', form);
      toast.success(comp ? 'Updated' : 'Created');
      onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <FormModal title={comp ? 'Edit Competency' : 'New Competency'} maxWidth="md" scrollable={false}
      onClose={onClose} onSave={save} saveLabel={saving ? 'Saving…' : (comp ? 'Save' : 'Create')}>
      <div className="flex flex-col gap-4">
        <FormField label="Name" required>
          <input className={inputClass} value={form.name} onChange={e => set('name', e.target.value)} />
        </FormField>
        <FormField label="Category" required>
          <select className={inputClass} value={form.category} onChange={e => set('category', e.target.value)}>
            {COMP_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label="Description">
          <CountedTextarea className={inputClass} rows={2} maxChars={500} value={form.description} onChange={e => set('description', e.target.value)} />
        </FormField>
      </div>
    </FormModal>
  );
}

// ─── Cycle detail view ────────────────────────────────────────────────────────

function CycleDetailView({ cycleId, onBack }: { cycleId: string; onBack: () => void }) {
  const { can } = useCan();
  const [cycle, setCycle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get(`/performance/cycles/${cycleId}`); setCycle(r.data.data ?? r.data); }
    catch { toast.error('Failed to load cycle'); }
    finally { setLoading(false); }
  }, [cycleId]);

  useEffect(() => { load(); }, [load]);

  const removeEmployee = async () => {
    if (!removeTarget) return;
    try {
      await api.delete(`/performance/cycles/${cycleId}/employees/${removeTarget.employee?.id}`);
      toast.success(`${removeTarget.employee?.name ?? 'Employee'} removed from cycle`);
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    setRemoveTarget(null);
  };

  if (loading) return <div className="flex-1 flex items-center justify-center py-20"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;
  if (!cycle) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent)] text-[13px] transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-[15px]">{cycle.name}</h2>
          <p className="text-[12px] text-[var(--text-muted)]">{fmtDate(cycle.period_start)} – {fmtDate(cycle.period_end)}</p>
        </div>
        <Pill label={cycle.status} />
        {can('create_performance') && <button onClick={() => setShowAddEmp(true)} className="primary-btn flex items-center gap-1.5 text-[12px]">
          <Users size={13} /> Add Employees
        </button>}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col drop-shadow-sm">
        <div className="overflow-x-auto flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Employee', 'Supervisor', 'Status', 'Self', 'Supervisor', 'HR', 'Overall', ''].map((h, i) => (
                  <th key={i} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(cycle.reviews ?? []).map((r: any) => (
                <tr key={r.id} className="tr">
                  <td className="td font-medium">{r.employee?.name ?? '—'}</td>
                  <td className="td text-[var(--text-muted)]">{r.supervisor?.name ?? '—'}</td>
                  <td className="td"><Pill label={r.status} /></td>
                  <td className="td"><ScoreBar score={r.self_score} /></td>
                  <td className="td"><ScoreBar score={r.supervisor_score} /></td>
                  <td className="td"><ScoreBar score={r.hr_score} /></td>
                  <td className="td"><ScoreBar score={r.overall_score} /></td>
                  <td className="td text-right">
                    <div className="inline-flex justify-end">
                      <RowActions actions={[
                        { label: 'View', icon: Eye, onClick: () => setReviewId(String(r.id)) },
                        { label: 'Remove', icon: Trash2, danger: true, onClick: () => setRemoveTarget(r), hidden: !(can('create_performance') && cycle.status === 'Draft') },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
              {!cycle.reviews?.length && (
                <tr><td colSpan={8} className="td text-center py-8 text-[var(--text-muted)]">No employees added yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {reviewId && <ReviewDetailSlideOver reviewId={reviewId} mode="hr" readOnly={!can('review_performance')} onClose={() => { setReviewId(null); load(); }} />}
        {showAddEmp && <AddEmployeesModal cycleId={cycleId} existingEmployeeIds={(cycle.reviews ?? []).map((r: any) => String(r.employee?.id))} onClose={() => setShowAddEmp(false)} onSaved={() => { setShowAddEmp(false); load(); }} />}
      </AnimatePresence>

      {removeTarget && (
        <ConfirmModal
          title="Remove employee?"
          message={`Remove ${removeTarget.employee?.name ?? 'this employee'} from the cycle? This will delete their review record.`}
          confirmLabel="Remove"
          variant="danger"
          onConfirm={removeEmployee}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Cycles tab ───────────────────────────────────────────────────────────────

function CyclesTab() {
  const { can } = useCan();
  const [cycles, setCycles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editCycle, setEditCycle] = useState<any>(null);
  const [viewCycleId, setViewCycleId] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState<any>(null);
  const [closePending,  setClosePending]  = useState<any>(null);
  const activeFilterCount = [statusFilter, typeFilter].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/performance/cycles'); setCycles(r.data.data ?? r.data); }
    catch { toast.error('Failed to load cycles'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activate = async (id: string) => {
    try { await api.post(`/performance/cycles/${id}/activate`); toast.success('Cycle activated'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
  };

  const del = async () => {
    if (!deletePending) return;
    try { await api.delete(`/performance/cycles/${deletePending.id}`); toast.success('Cycle deleted'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    setDeletePending(null);
  };

  const closeCycle = async () => {
    if (!closePending) return;
    try { await api.post(`/performance/cycles/${closePending.id}/close`); toast.success('Cycle closed'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    setClosePending(null);
  };

  if (viewCycleId) return <CycleDetailView cycleId={viewCycleId} onBack={() => { setViewCycleId(null); load(); }} />;

  const filtered = cycles.filter(c =>
    (!search || c.name.toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || c.status === statusFilter) &&
    (!typeFilter   || c.type   === typeFilter)
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] drop-shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <input
            className="border border-[var(--border)] rounded-lg px-3 py-2 text-[13px] bg-[var(--surface)] focus:outline-none focus:border-[var(--accent)] w-52"
            placeholder="Search cycles…" value={search} onChange={e => setSearch(e.target.value)} />
          <button
            onClick={() => setShowFilters(s => !s)}
            className={`secondary-btn shrink-0 relative ${showFilters || activeFilterCount > 0 ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
          >
            Filter <Filter className="w-[14px] h-[14px]" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          <div className="flex-1" />
          {can('create_performance') && (
            <button onClick={() => { setEditCycle(null); setShowForm(true); }} className="primary-btn">
              <Plus size={14} /> New Cycle
            </button>
          )}
        </div>
        {showFilters && (
          <div className="px-4 py-3 bg-[var(--surface-hover)] border-t border-[var(--border)] flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 min-w-[150px]">
              <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Status</label>
              <select className="text-[12px] h-8 px-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                {CYCLE_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-[150px]">
              <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Type</label>
              <select className="text-[12px] h-8 px-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="">All</option>
                {CYCLE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            {activeFilterCount > 0 && (
              <button onClick={() => { setStatusFilter(''); setTypeFilter(''); }}
                className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-[var(--accent)]" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(c => (
            <CycleCard key={c.id} cycle={c}
              canEdit={can('create_performance')}
              canDelete={can('delete_performance')}
              onView={() => setViewCycleId(String(c.id))}
              onEdit={() => { setEditCycle(c); setShowForm(true); }}
              onActivate={() => activate(String(c.id))}
              onClose={() => setClosePending(c)}
              onDelete={() => setDeletePending(c)}
            />
          ))}
          {!filtered.length && <p className="col-span-4 text-center py-12 text-[var(--text-muted)] text-[13px]">No cycles found</p>}
        </div>
      )}

      <AnimatePresence>
        {showForm && <CycleFormModal cycle={editCycle} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
      </AnimatePresence>

      {deletePending && (
        <ConfirmModal
          title="Delete cycle?"
          message={`Remove "${deletePending.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={del}
          onCancel={() => setDeletePending(null)}
        />
      )}

      {closePending && (
        <ConfirmModal
          title="Close cycle?"
          message={`Close "${closePending.name}"? No further changes can be made to reviews once a cycle is closed.`}
          confirmLabel="Close Cycle"
          variant="warning"
          onConfirm={closeCycle}
          onCancel={() => setClosePending(null)}
        />
      )}
    </div>
  );
}

// ─── Reviews tab ──────────────────────────────────────────────────────────────

function ReviewsTab() {
  const { can } = useCan();
  const [reviews, setReviews]           = useState<any[]>([]);
  const [cycles,  setCycles]            = useState<any[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading]           = useState(true);
  const [statusFilter,   setStatusFilter]   = useState('');
  const [cycleFilter,    setCycleFilter]    = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [showFilters,    setShowFilters]    = useState(false);
  const [search,   setSearch]       = useState('');
  const [page,     setPage]         = useState(1);
  const [pageSize, setPageSize]     = useState(25);
  const [total,    setTotal]        = useState(0);
  const [reviewId, setReviewId]     = useState<string | null>(null);
  const activeFilterCount = [statusFilter, cycleFilter, employeeFilter].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: pageSize };
      if (statusFilter)   params.status      = statusFilter;
      if (cycleFilter)    params.cycle_id    = cycleFilter;
      if (employeeFilter) params.employee_id = employeeFilter;
      if (search)         params.search      = search;
      const [rr, rc, re] = await Promise.all([
        api.get('/performance/reviews', { params }),
        api.get('/performance/cycles'),
        api.get('/employees/active'),
      ]);
      const d = rr.data.data ?? rr.data;
      setReviews(d.records ?? d);
      setTotal(d.total ?? (d.records ?? d).length);
      setCycles(rc.data.data ?? rc.data);
      setEmployeeOptions([
        { id: '', label: 'All Employees' },
        ...(re.data.data ?? re.data).map((e: any) => ({
          id:    String(e.id),
          label: e.name + (e.employee_id ? ` (${e.employee_id})` : ''),
        })),
      ]);
    } catch { toast.error('Failed to load reviews'); }
    finally { setLoading(false); }
  }, [page, pageSize, statusFilter, cycleFilter, employeeFilter, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col drop-shadow-sm">
        <TableToolbar
          searchQuery={search}
          onSearchChange={v => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search employee…"
          actions={
            <button
              onClick={() => setShowFilters(s => !s)}
              className={`secondary-btn shrink-0 relative ${showFilters || activeFilterCount > 0 ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
            >
              Filter <Filter className="w-[14px] h-[14px]" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          }
          filterBar={showFilters ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1 min-w-[200px]">
                <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Employee</label>
                <SearchSelect
                  options={employeeOptions}
                  value={employeeFilter}
                  onChange={v => { setEmployeeFilter(v); setPage(1); }}
                  placeholder="All Employees"
                />
              </div>
              <FilterSelect
                label="Cycle"
                value={cycleFilter}
                onChange={v => { setCycleFilter(v); setPage(1); }}
                placeholder="All Cycles"
                minWidth={160}
                options={[{ value: '', label: 'All Cycles' }, ...cycles.map(c => ({ value: String(c.id), label: c.name }))]}
              />
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={v => { setStatusFilter(v); setPage(1); }}
                placeholder="All"
                minWidth={160}
                options={[{ value: '', label: 'All' }, ...REVIEW_STATUSES.map(s => ({ value: s, label: s }))]}
              />
              {activeFilterCount > 0 && (
                <button onClick={() => { setStatusFilter(''); setCycleFilter(''); setEmployeeFilter(''); }}
                  className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
                  Clear all
                </button>
              )}
            </div>
          ) : undefined}
        />
        <div className="overflow-x-auto flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Employee', 'Cycle', 'Status', 'Self', 'Supervisor', 'HR', 'Overall', ''].map((h, i) => (
                  <th key={i} className={`th${i === 7 ? ' !text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="td text-center py-10"><Loader2 className="animate-spin inline text-[var(--accent)]" /></td></tr>
              ) : reviews.map(r => (
                <tr key={r.id} className="tr cursor-pointer" onClick={() => setReviewId(String(r.id))}>
                  <td className="td font-medium">{r.employee?.name ?? '—'}</td>
                  <td className="td text-[var(--text-muted)]">{r.cycle_name ?? '—'}</td>
                  <td className="td"><Pill label={r.status} /></td>
                  <td className="td"><ScoreBar score={r.self_score} /></td>
                  <td className="td"><ScoreBar score={r.supervisor_score} /></td>
                  <td className="td"><ScoreBar score={r.hr_score} /></td>
                  <td className="td"><ScoreBar score={r.overall_score} /></td>
                  <td className="td text-right">
                    <button className="action-btn" title="View"><Eye size={13} /></button>
                  </td>
                </tr>
              ))}
              {!loading && !reviews.length && (
                <tr><td colSpan={8} className="td text-center py-8 text-[var(--text-muted)]">No reviews found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={total} filtered={reviews.length}
          page={page} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={s => { setPageSize(s); setPage(1); }}
        />
      </div>

      <AnimatePresence>
        {reviewId && <ReviewDetailSlideOver reviewId={reviewId} mode="hr" readOnly={!can('review_performance')} onClose={() => { setReviewId(null); load(); }} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Goals tab ────────────────────────────────────────────────────────────────

function GoalsTab() {
  const { can } = useCan();
  const [goals,           setGoals]           = useState<any[]>([]);
  const [cycles,          setCycles]          = useState<any[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [showForm,        setShowForm]        = useState(false);
  const [editGoal,        setEditGoal]        = useState<any>(null);
  const [deletePending,   setDeletePending]   = useState<any>(null);
  const [statusFilter,    setStatusFilter]    = useState('');
  const [employeeFilter,  setEmployeeFilter]  = useState('');
  const [showFilters,     setShowFilters]     = useState(false);
  const [search,          setSearch]          = useState('');
  const [page,            setPage]            = useState(1);
  const [pageSize,        setPageSize]        = useState(25);
  const activeFilterCount = [statusFilter, employeeFilter].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter)   params.status      = statusFilter;
      if (employeeFilter) params.employee_id = employeeFilter;
      const [rg, rc, re] = await Promise.all([
        api.get('/performance/goals', { params }),
        api.get('/performance/cycles'),
        api.get('/employees/active'),
      ]);
      setGoals(rg.data.data ?? rg.data);
      setCycles(rc.data.data ?? rc.data);
      setEmployeeOptions((re.data.data ?? re.data).map((e: any) => ({
        id:    String(e.id),
        label: e.name + (e.employee_id ? ` (${e.employee_id})` : ''),
      })));
    } catch { toast.error('Failed to load goals'); }
    finally { setLoading(false); }
  }, [statusFilter, employeeFilter]);

  useEffect(() => { load(); }, [load]);

  const del = async () => {
    if (!deletePending) return;
    try { await api.delete(`/performance/goals/${deletePending.id}`); toast.success('Goal deleted'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    setDeletePending(null);
  };

  const filtered = goals.filter(g =>
    !search || (g.title ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (g.employee?.name ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col drop-shadow-sm">
        <TableToolbar
          searchQuery={search}
          onSearchChange={v => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search goals or employee…"
          actions={
            <>
              <button
                onClick={() => setShowFilters(s => !s)}
                className={`secondary-btn shrink-0 relative ${showFilters || activeFilterCount > 0 ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
              >
                Filter <Filter className="w-[14px] h-[14px]" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {can('create_performance') && <button className="primary-btn" onClick={() => { setEditGoal(null); setShowForm(true); }}>
                <Plus size={14} /> Add Goal
              </button>}
            </>
          }
          filterBar={showFilters ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1 min-w-[200px]">
                <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Employee</label>
                <SearchSelect
                  options={[{ id: '', label: 'All Employees' }, ...employeeOptions]}
                  value={employeeFilter}
                  onChange={v => { setEmployeeFilter(v); setPage(1); }}
                  placeholder="All Employees"
                />
              </div>
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={v => { setStatusFilter(v); setPage(1); }}
                placeholder="All"
                minWidth={150}
                options={[{ value: '', label: 'All' }, ...GOAL_STATUSES.map(s => ({ value: s, label: s }))]}
              />
              {activeFilterCount > 0 && (
                <button onClick={() => { setStatusFilter(''); setEmployeeFilter(''); }}
                  className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
                  Clear all
                </button>
              )}
            </div>
          ) : undefined}
        />
        <div className="overflow-x-auto flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Employee', 'Title', 'Cycle', 'Weight', 'Due Date', 'Status', 'Achievement', ''].map((h, i) => (
                  <th key={i} className={`th${i === 7 ? ' !text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="td text-center py-10"><Loader2 className="animate-spin inline text-[var(--accent)]" /></td></tr>
              ) : paged.map(g => (
                <tr key={g.id} className="tr">
                  <td className="td font-medium">{g.employee?.name ?? '—'}</td>
                  <td className="td max-w-[200px] truncate">{g.title}</td>
                  <td className="td text-[var(--text-muted)]">{g.cycle_name ?? '—'}</td>
                  <td className="td">{g.weight != null ? `${g.weight}%` : '—'}</td>
                  <td className="td">{fmtDate(g.due_date)}</td>
                  <td className="td"><Pill label={g.status} /></td>
                  <td className="td">
                    {g.achievement
                      ? <span className={`pill text-[11px] ${ACHIEVEMENT_COLOR[g.achievement] ?? ''}`}>{g.achievement}</span>
                      : <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="td text-right">
                    <div className="inline-flex justify-end">
                      <RowActions actions={[
                        { label: 'Edit', icon: Pencil, onClick: () => { setEditGoal(g); setShowForm(true); }, hidden: !can('create_performance') },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => setDeletePending(g), hidden: !can('delete_performance') },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length && (
                <tr><td colSpan={8} className="td text-center py-8 text-[var(--text-muted)]">No goals found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={goals.length} filtered={filtered.length}
          page={page} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={s => { setPageSize(s); setPage(1); }}
        />
      </div>

      <AnimatePresence>
        {showForm && (
          <GoalFormModal goal={editGoal} cycles={cycles} employees={employeeOptions}
            onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
        )}
      </AnimatePresence>

      {deletePending && (
        <ConfirmModal
          title="Delete goal?"
          message={`Remove "${deletePending.title}"?`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={del}
          onCancel={() => setDeletePending(null)}
        />
      )}
    </div>
  );
}

// ─── Competencies tab ─────────────────────────────────────────────────────────

function CompetenciesTab() {
  const { can } = useCan();
  const [comps,          setComps]          = useState<any[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [showForm,       setShowForm]       = useState(false);
  const [editComp,       setEditComp]       = useState<any>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showFilters,    setShowFilters]    = useState(false);
  const [search,         setSearch]         = useState('');
  const [page,           setPage]           = useState(1);
  const [pageSize,       setPageSize]       = useState(25);
  const activeFilterCount = [categoryFilter].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/performance/competencies'); setComps(r.data.data ?? r.data); }
    catch { toast.error('Failed to load competencies'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (comp: any) => {
    try { await api.put(`/performance/competencies/${comp.id}`, { is_active: !comp.is_active }); load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
  };

  const filtered = comps.filter(c =>
    (!categoryFilter || c.category === categoryFilter) &&
    (!search || (c.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.category ?? '').toLowerCase().includes(search.toLowerCase()))
  );
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col drop-shadow-sm">
        <TableToolbar
          searchQuery={search}
          onSearchChange={v => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search competencies…"
          actions={
            <>
              <button
                onClick={() => setShowFilters(s => !s)}
                className={`secondary-btn shrink-0 relative ${showFilters || activeFilterCount > 0 ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
              >
                Filter <Filter className="w-[14px] h-[14px]" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {can('create_performance') && <button className="primary-btn" onClick={() => { setEditComp(null); setShowForm(true); }}>
                <Plus size={14} /> Add Competency
              </button>}
            </>
          }
          filterBar={showFilters ? (
            <div className="flex flex-wrap items-end gap-3">
              <FilterSelect
                label="Category"
                value={categoryFilter}
                onChange={v => { setCategoryFilter(v); setPage(1); }}
                placeholder="All Categories"
                minWidth={150}
                options={[{ value: '', label: 'All Categories' }, ...COMP_CATEGORIES.map(c => ({ value: c, label: c }))]}
              />
              {activeFilterCount > 0 && (
                <button onClick={() => setCategoryFilter('')}
                  className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
                  Clear all
                </button>
              )}
            </div>
          ) : undefined}
        />
        <div className="overflow-x-auto flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Name', 'Category', 'Description', 'Active', ''].map((h, i) => (
                  <th key={i} className={`th${i === 4 ? ' !text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="td text-center py-10"><Loader2 className="animate-spin inline text-[var(--accent)]" /></td></tr>
              ) : paged.map(c => (
                <tr key={c.id} className="tr">
                  <td className="td font-medium">{c.name}</td>
                  <td className="td text-[var(--text-muted)]">{c.category}</td>
                  <td className="td max-w-[280px] truncate text-[var(--text-muted)]">{c.description ?? '—'}</td>
                  <td className="td">
                    <button onClick={() => toggle(c)} disabled={!can('create_performance')}
                      className={`w-8 h-4 rounded-full transition-colors ${c.is_active ? 'bg-emerald-500' : 'bg-slate-300'} relative ${can('create_performance') ? '' : 'opacity-50 cursor-not-allowed'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${c.is_active ? 'translate-x-4' : ''}`} />
                    </button>
                  </td>
                  <td className="td text-right">
                    {can('create_performance')
                      ? <button onClick={() => { setEditComp(c); setShowForm(true); }} className="action-btn" title="Edit"><Pencil size={13} /></button>
                      : <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length && (
                <tr><td colSpan={5} className="td text-center py-8 text-[var(--text-muted)]">No competencies found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={comps.length} filtered={filtered.length}
          page={page} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={s => { setPageSize(s); setPage(1); }}
        />
      </div>

      <AnimatePresence>
        {showForm && <CompFormModal comp={editComp} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ManagePerformance() {
  const [activeTab, setActiveTab] = useState('Cycles');
  getCurrentUser(); // ensure auth context is fresh

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full">
      <PageHeader title="Manage Performance" subtitle="Create review cycles, track reviews and manage goals." />

      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4">
        {TABS.map(({ label, icon: Icon }) => (
          <button key={label} onClick={() => setActiveTab(label)}
            className={`tab-btn flex items-center gap-1.5 ${activeTab === label ? 'active' : ''}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'Cycles'       && <CyclesTab />}
      {activeTab === 'Reviews'      && <ReviewsTab />}
      {activeTab === 'Goals'        && <GoalsTab />}
      {activeTab === 'Competencies' && <CompetenciesTab />}
    </div>
  );
}
