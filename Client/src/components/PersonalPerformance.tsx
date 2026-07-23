import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  User, Users, Target,
  Plus, Pencil, Trash2, Loader2, CheckCircle2, Eye, Filter, Paperclip, X, AlertTriangle,
} from 'lucide-react';
import { DocPreviewModal } from './ui/DocPreviewModal';
import { RowActions } from './ui/RowActions';
import { CountedTextarea } from './ui/CountedTextarea';
import api from '../../lib/api';
import { toast } from 'sonner';
import { getCurrentUser } from '../../lib/auth';
import { PageHeader } from './ui/PageHeader';
import { FilterSelect } from './ui/FilterSelect';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { ConfirmModal } from './ui/ConfirmModal';
import { ReviewDetailSlideOver } from './ReviewDetailSlideOver';

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return String(v).substring(0, 10); }
}

const STATUS_COLOR: Record<string, string> = {
  'Not Started':       'bg-slate-100 text-slate-500 border border-slate-200',
  'Self Assessment':   'bg-amber-50 text-amber-700 border border-amber-200',
  'Supervisor Review': 'bg-blue-50 text-blue-700 border border-blue-200',
  'HR Review':         'bg-violet-50 text-violet-700 border border-violet-200',
  Completed:           'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

const ACHIEVEMENT_COLOR: Record<string, string> = {
  Exceeded:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Met:             'bg-blue-50 text-blue-700 border border-blue-200',
  'Partially Met': 'bg-amber-50 text-amber-700 border border-amber-200',
  'Not Met':       'bg-rose-50 text-rose-600 border border-rose-200',
};

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

function ScoreChip({ score }: { score: any }) {
  const num = toNum(score);
  if (!num || isNaN(num)) return <span className="text-[var(--text-muted)]">—</span>;
  const color = num >= 4 ? '#22c55e' : num >= 3 ? '#3b82f6' : num >= 2 ? '#f59e0b' : '#ef4444';
  return (
    <span className="text-[12.5px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>
      {num.toFixed(1)} / 5
    </span>
  );
}

function dueCls(dateStr: string | null | undefined): string {
  if (!dateStr) return 'text-[var(--text-muted)]';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  if (d < today) return 'text-rose-600 font-semibold';
  const diff = (d.getTime() - today.getTime()) / 86_400_000;
  if (diff <= 3) return 'text-amber-600 font-semibold';
  return 'text-[var(--text-muted)]';
}

const GOAL_STATUSES = ['Draft', 'Active', 'Completed', 'Cancelled'];

// ─── Goal form modal ──────────────────────────────────────────────────────────

function GoalFormModal({ goal, cycles, employeeId, onClose, onSaved, progressOnly = false }: {
  goal: any | null; cycles: any[]; employeeId: string;
  onClose: () => void; onSaved: () => void;
  progressOnly?: boolean;
}) {
  const [form, setForm] = useState({
    cycle_id:       goal?.cycle_id ? String(goal.cycle_id) : '',
    title:          goal?.title          ?? '',
    description:    goal?.description    ?? '',
    weight:         goal?.weight != null ? String(goal.weight) : '',
    target:         goal?.target         ?? '',
    actual_result:  goal?.actual_result  ?? '',
    employee_score: goal?.employee_score != null ? String(goal.employee_score) : '',
    due_date:       (goal?.due_date      ?? '').substring(0, 10),
    status:         goal?.status         ?? 'Active',
    progress_note:  goal?.progress_note  ?? '',
    comment:        goal?.comment        ?? '',
  });
  const [saving,     setSaving]     = useState(false);
  const [docFile,    setDocFile]    = useState<File | null>(null);
  const [docRef,     setDocRef]     = useState<string>(goal?.document_ref ?? '');
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setDocFile(f);
  };

  const removeDoc = async () => {
    if (goal?.id && docRef && !docFile) {
      await api.put(`/performance/goals/${goal.id}`, { document_ref: '' }).catch(() => {});
    }
    setDocRef('');
    setDocFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    if (!progressOnly && !form.title.trim()) return toast.error('Title is required');
    setSaving(true);
    try {
      let finalDocRef = docRef;

      // Upload new file if selected
      if (docFile) {
        const fd = new FormData();
        fd.append('file', docFile);
        if (goal?.id) {
          const r = await api.post(`/performance/goals/${goal.id}/document`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          finalDocRef = r.data.data?.document_ref ?? finalDocRef;
        } else {
          // For new goals: upload after creation — handled below
        }
      }

      if (progressOnly && goal?.id) {
        await api.put(`/performance/goals/${goal.id}`, {
          actual_result:  form.actual_result  || null,
          employee_score: form.employee_score ? parseFloat(form.employee_score) : null,
          progress_note:  form.progress_note  || null,
          comment:        form.comment        || null,
          document_ref:   finalDocRef         || null,
        });
        toast.success('Progress updated');
      } else {
        const body: any = {
          ...form,
          employee_id: employeeId,
          source:      'employee',
          weight:      form.weight ? Number(form.weight) : null,
          cycle_id:    form.cycle_id || null,
          comment:     form.comment  || null,
          document_ref: finalDocRef  || null,
        };
        if (goal?.id) {
          await api.put(`/performance/goals/${goal.id}`, body);
        } else {
          const r = await api.post('/performance/goals', body);
          // Upload document to the newly created goal
          if (docFile && r.data?.data?.id) {
            const fd = new FormData();
            fd.append('file', docFile);
            await api.post(`/performance/goals/${r.data.data.id}/document`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).catch(() => {});
          }
        }
        toast.success(goal ? 'Goal updated' : 'Goal created');
      }
      onSaved();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  const modalTitle = progressOnly ? 'Report Progress' : (goal ? 'Edit Goal' : 'New Goal');
  const label = saving ? 'Saving…' : (progressOnly ? 'Save Progress' : (goal ? 'Save Changes' : 'Create'));

  const docSection = (
    <div className="flex flex-col gap-2">
      <label className="label">Supporting Document <span className="text-[var(--text-muted)] font-normal">(PDF, JPG, PNG — max 20 MB)</span></label>
      {docRef && !docFile ? (
        <div className="flex items-center gap-2 border border-[var(--border)] rounded-[8px] px-3 py-2 bg-[var(--bg)]">
          <Paperclip size={13} className="text-[var(--accent)] shrink-0" />
          <button type="button" onClick={() => setPreviewDoc(docRef)}
            className="text-[12.5px] text-[var(--accent)] hover:underline flex-1 text-left truncate">
            Preview document
          </button>
          <button type="button" onClick={removeDoc} className="text-[var(--danger)] hover:text-red-600" title="Remove document">
            <X size={14} />
          </button>
        </div>
      ) : docFile ? (
        <div className="flex items-center gap-2 border border-[var(--border)] rounded-[8px] px-3 py-2 bg-[var(--bg)]">
          <Paperclip size={13} className="text-[var(--accent)] shrink-0" />
          <span className="text-[12.5px] text-[var(--text-primary)] flex-1 truncate">{docFile.name}</span>
          <button type="button" onClick={() => { setDocFile(null); if (fileRef.current) fileRef.current.value = ''; }}
            className="text-[var(--danger)] hover:text-red-600" title="Remove">
            <X size={14} />
          </button>
        </div>
      ) : (
        <label className="flex items-center gap-2 border border-dashed border-[var(--border)] rounded-[8px] px-3 py-3 cursor-pointer hover:border-[var(--accent)] transition-colors bg-[var(--bg)]">
          <Paperclip size={14} className="text-[var(--text-muted)] shrink-0" />
          <span className="text-[12.5px] text-[var(--text-muted)]">Click to attach a document…</span>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFile} />
        </label>
      )}
    </div>
  );

  return (
    <>
    {previewDoc && <DocPreviewModal filename={previewDoc} onClose={() => setPreviewDoc(null)} />}
    <FormModal title={modalTitle} maxWidth="lg" scrollable onClose={onClose} onSave={save} saveLabel={label}>
      {progressOnly ? (
        <div className="flex flex-col gap-4">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-[10px] p-4 flex flex-col gap-2">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">{goal?.title}</p>
            {goal?.target && <p className="text-[12px] text-[var(--text-muted)]">Target: {goal.target}</p>}
            {goal?.weight != null && <p className="text-[12px] text-[var(--text-muted)]">Weight: {goal.weight}%</p>}
          </div>
          <FormField label="Actual Result">
            <CountedTextarea className={inputClass} rows={2} maxChars={500}
              value={form.actual_result} onChange={e => set('actual_result', e.target.value)}
              placeholder={`What did you actually achieve? e.g. Scored ${goal?.target ?? '…'}`} />
          </FormField>
          <FormField label={`Score (0 – ${goal?.weight ?? 100} pts)`}>
            <input type="number" min={0} max={goal?.weight ?? 100} step={0.5}
              className={inputClass} value={form.employee_score}
              onChange={e => set('employee_score', e.target.value)}
              onWheel={e => e.currentTarget.blur()}
              placeholder={`0 – ${goal?.weight ?? 100}`} />
          </FormField>
          <FormField label="Progress Note">
            <CountedTextarea className={inputClass} rows={3} maxChars={1000} value={form.progress_note} onChange={e => set('progress_note', e.target.value)} placeholder="Describe your progress against this goal…" />
          </FormField>
          <FormField label="Comment">
            <CountedTextarea className={inputClass} rows={2} maxChars={300} value={form.comment} onChange={e => set('comment', e.target.value)} placeholder="Any additional notes or context…" />
          </FormField>
          {docSection}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Goal Title" required className="col-span-2">
            <input className={inputClass} value={form.title} onChange={e => set('title', e.target.value)} />
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
            <input type="number" min={0} max={100} className={inputClass} value={form.weight} onChange={e => set('weight', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="0–100" />
          </FormField>
          <FormField label="Measurable Target" className="col-span-2">
            <input className={inputClass} value={form.target} onChange={e => set('target', e.target.value)} />
          </FormField>
          <FormField label="Due Date">
            <input type="date" className={inputClass} value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </FormField>
          <FormField label="Status">
            <select className={inputClass} value={form.status} onChange={e => set('status', e.target.value)}>
              {GOAL_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Comment" className="col-span-2">
            <CountedTextarea className={inputClass} rows={2} maxChars={300} value={form.comment} onChange={e => set('comment', e.target.value)} placeholder="Any notes or context for this goal…" />
          </FormField>
          <div className="col-span-2">{docSection}</div>
        </div>
      )}
    </FormModal>
    </>
  );
}

// ─── My Review tab ────────────────────────────────────────────────────────────

function MyReviewTab({ employeeId }: { employeeId: string }) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/performance/reviews/my');
      setReviews(r.data.data ?? r.data);
    } catch { toast.error('Failed to load reviews'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex-1 flex items-center justify-center py-20"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;

  const active    = reviews.filter(r => r.status !== 'Completed');
  const completed = reviews.filter(r => r.status === 'Completed');

  return (
    <div className="flex flex-col gap-6">
      {active.length > 0 ? active.map(rev => (
        <div key={rev.id} className="border border-[var(--accent)]/30 rounded-[12px] p-5 bg-[var(--surface)] flex flex-col gap-3 drop-shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-[14px]">{rev.cycle_name ?? '—'}</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                {fmtDate(rev.period_start)} – {fmtDate(rev.period_end)}
              </p>
            </div>
            <Pill label={rev.status} />
          </div>

          <div className="flex flex-wrap gap-3 text-[12px]">
            {rev.self_due && (
              <span className={`flex items-center gap-1 ${dueCls(rev.self_due)}`}>
                {dueCls(rev.self_due) !== 'text-[var(--text-muted)]' && <AlertTriangle size={11} className="shrink-0" />}
                Self due: <strong>{fmtDate(rev.self_due)}</strong>
              </span>
            )}
            {rev.supervisor_due && (
              <span className={`flex items-center gap-1 ${dueCls(rev.supervisor_due)}`}>
                {dueCls(rev.supervisor_due) !== 'text-[var(--text-muted)]' && <AlertTriangle size={11} className="shrink-0" />}
                Supervisor due: <strong>{fmtDate(rev.supervisor_due)}</strong>
              </span>
            )}
            {rev.hr_due && (
              <span className={`flex items-center gap-1 ${dueCls(rev.hr_due)}`}>
                {dueCls(rev.hr_due) !== 'text-[var(--text-muted)]' && <AlertTriangle size={11} className="shrink-0" />}
                HR due: <strong>{fmtDate(rev.hr_due)}</strong>
              </span>
            )}
          </div>

          {rev.status === 'Not Started' ? (
            <div className="bg-amber-50 border border-amber-200 rounded-[8px] px-4 py-3 text-[13px] text-amber-700 font-medium">
              Your self-assessment is open — click below to begin.
            </div>
          ) : rev.status === 'Self Assessment' ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-[8px] px-4 py-3 text-[13px] text-emerald-700 flex items-center gap-2">
              <CheckCircle2 size={14} /> Self assessment submitted — awaiting supervisor review.
            </div>
          ) : rev.status === 'Supervisor Review' ? (
            <div className="bg-blue-50 border border-blue-200 rounded-[8px] px-4 py-3 text-[13px] text-blue-700 flex items-center gap-2">
              <CheckCircle2 size={14} /> Supervisor review complete — awaiting HR sign-off.
            </div>
          ) : null}

          <button onClick={() => setOpenReviewId(String(rev.id))} className="primary-btn self-start text-[12px]">
            {rev.status === 'Not Started' ? 'Start Self Assessment' : 'View Review'}
          </button>
        </div>
      )) : (
        <div className="border border-[var(--border)] rounded-[12px] p-8 text-center text-[var(--text-muted)] bg-[var(--surface)]">
          No active review cycles assigned to you.
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <h3 className="font-bold text-[13px] text-[var(--text-muted)] mb-3">Completed Reviews</h3>
          <div className="flex flex-col gap-2">
            {completed.map(rev => (
              <div key={rev.id}
                className="flex items-center justify-between gap-3 border border-[var(--border)] rounded-[10px] px-4 py-3 bg-[var(--surface)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                onClick={() => setOpenReviewId(String(rev.id))}>
                <div>
                  <p className="font-semibold text-[13px]">{rev.cycle_name ?? '—'}</p>
                  <p className="text-[11.5px] text-[var(--text-muted)]">{fmtDate(rev.hr_reviewed ?? rev.updated_at)}</p>
                </div>
                <ScoreChip score={rev.overall_score} />
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {openReviewId && (
          <ReviewDetailSlideOver reviewId={openReviewId} mode="employee" onClose={() => { setOpenReviewId(null); load(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── My Team tab (supervisors) ────────────────────────────────────────────────

function MyTeamTab() {
  const [reviews,      setReviews]      = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showFilters,  setShowFilters]  = useState(false);
  const [search,       setSearch]       = useState('');
  const [page,         setPage]         = useState(1);
  const [pageSize,     setPageSize]     = useState(25);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const activeFilterCount = [statusFilter].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/performance/reviews/team');
      setReviews(r.data.data ?? r.data);
    } catch { toast.error('Failed to load team reviews'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = reviews.filter(r =>
    (!statusFilter || r.status === statusFilter) &&
    (!search || (r.employee?.name ?? '').toLowerCase().includes(search.toLowerCase()))
  );
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

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
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={v => { setStatusFilter(v); setPage(1); }}
                placeholder="All"
                minWidth={160}
                options={[{ value: '', label: 'All' }, ...['Not Started', 'Self Assessment', 'Supervisor Review', 'HR Review', 'Completed'].map(s => ({ value: s, label: s }))]}
              />
              {activeFilterCount > 0 && (
                <button onClick={() => setStatusFilter('')}
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
                {['Employee', 'Cycle', 'Status', 'Self Score', ''].map((h, i) => (
                  <th key={i} className={`th${i === 4 ? ' !text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="td text-center py-10"><Loader2 className="animate-spin inline text-[var(--accent)]" /></td></tr>
              ) : paged.map(r => (
                <tr key={r.id} className="tr">
                  <td className="td font-medium">{r.employee?.name ?? '—'}</td>
                  <td className="td text-[var(--text-muted)]">{r.cycle_name ?? '—'}</td>
                  <td className="td"><Pill label={r.status} /></td>
                  <td className="td"><ScoreChip score={r.self_score} /></td>
                  <td className="td text-right">
                    <button onClick={() => setOpenReviewId(String(r.id))} className="action-btn" title="View / Review">
                      <Eye size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && !filtered.length && (
                <tr><td colSpan={5} className="td text-center py-8 text-[var(--text-muted)]">
                  {statusFilter ? 'No reviews match this filter' : reviews.length === 0 ? 'No team reviews assigned to you yet — HR assigns you as supervisor when adding employees to a cycle.' : 'No reviews match the selected filter'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={reviews.length} filtered={filtered.length}
          page={page} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={s => { setPageSize(s); setPage(1); }}
        />
      </div>

      <AnimatePresence>
        {openReviewId && (
          <ReviewDetailSlideOver reviewId={openReviewId} mode="supervisor" onClose={() => { setOpenReviewId(null); load(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── My Goals tab ─────────────────────────────────────────────────────────────

function MyGoalsTab({ employeeId }: { employeeId: string }) {
  const [goals,          setGoals]          = useState<any[]>([]);
  const [cycles,         setCycles]         = useState<any[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [showForm,       setShowForm]       = useState(false);
  const [progressOnly,   setProgressOnly]   = useState(false);
  const [editGoal,       setEditGoal]       = useState<any>(null);
  const [deletePending,  setDeletePending]  = useState<any>(null);
  const [previewDoc,     setPreviewDoc]     = useState<string | null>(null);
  const [statusFilter,   setStatusFilter]   = useState('');
  const [showFilters,    setShowFilters]    = useState(false);
  const [search,         setSearch]         = useState('');
  const [page,           setPage]           = useState(1);
  const [pageSize,       setPageSize]       = useState(25);
  const activeFilterCount = [statusFilter].filter(Boolean).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { employee_id: employeeId };
      if (statusFilter) params.status = statusFilter;
      const [rg, rc] = await Promise.all([
        api.get('/performance/goals', { params }),
        api.get('/performance/cycles'),
      ]);
      setGoals(rg.data.data ?? rg.data);
      setCycles(rc.data.data ?? rc.data);
    } catch { toast.error('Failed to load goals'); }
    finally { setLoading(false); }
  }, [employeeId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const del = async () => {
    if (!deletePending) return;
    try { await api.delete(`/performance/goals/${deletePending.id}`); toast.success('Goal deleted'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    setDeletePending(null);
  };

  const openProgress = (g: any) => { setEditGoal(g); setProgressOnly(true);  setShowForm(true); };
  const openEdit     = (g: any) => { setEditGoal(g); setProgressOnly(false); setShowForm(true); };
  const openNew      = ()       => { setEditGoal(null); setProgressOnly(false); setShowForm(true); };

  const filtered = goals.filter(g =>
    !search || (g.title ?? '').toLowerCase().includes(search.toLowerCase())
  );
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col drop-shadow-sm">
        <TableToolbar
          searchQuery={search}
          onSearchChange={v => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search goals…"
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
              <button className="primary-btn" onClick={openNew}>
                <Plus size={14} /> Add Goal
              </button>
            </>
          }
          filterBar={showFilters ? (
            <div className="flex flex-wrap items-end gap-3">
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={v => { setStatusFilter(v); setPage(1); }}
                placeholder="All"
                minWidth={150}
                options={[{ value: '', label: 'All' }, ...GOAL_STATUSES.map(s => ({ value: s, label: s }))]}
              />
              {activeFilterCount > 0 && (
                <button onClick={() => setStatusFilter('')}
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
                {['Title', 'Cycle', 'Weight', 'Due Date', 'Status', 'Achievement', ''].map((h, i) => (
                  <th key={i} className={`th${i === 6 ? ' !text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="td text-center py-10"><Loader2 className="animate-spin inline text-[var(--accent)]" /></td></tr>
              ) : paged.map(g => {
                const isHR = g.source === 'hr';
                return (
                  <tr key={g.id} className="tr">
                    <td className="td max-w-[240px]">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{g.title}</span>
                          {g.document_ref && (
                            <button type="button" onClick={() => setPreviewDoc(g.document_ref)}
                              className="text-[var(--accent)] shrink-0 hover:opacity-70 transition-opacity" title="Preview document">
                              <Paperclip size={12} />
                            </button>
                          )}
                        </div>
                        {isHR && (
                          <span className="text-[10px] font-semibold text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5 w-fit">
                            Assigned by HR
                          </span>
                        )}
                        {g.comment && (
                          <p className="text-[11px] text-[var(--text-muted)] truncate max-w-[200px]" title={g.comment}>{g.comment}</p>
                        )}
                      </div>
                    </td>
                    <td className="td text-[var(--text-muted)]">{g.cycle_name ?? '—'}</td>
                    <td className="td">{g.weight != null ? `${g.weight}%` : '—'}</td>
                    <td className="td">{fmtDate(g.due_date)}</td>
                    <td className="td"><Pill label={g.status} /></td>
                    <td className="td">
                      {g.achievement
                        ? <span className={`pill text-[10.5px] ${ACHIEVEMENT_COLOR[g.achievement] ?? ''}`}>{g.achievement}</span>
                        : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="td text-right">
                      <div className="inline-flex justify-end">
                        <RowActions actions={isHR
                          ? [{ label: 'Report Progress', icon: Pencil, onClick: () => openProgress(g) }]
                          : [
                              { label: 'Edit', icon: Pencil, onClick: () => openEdit(g) },
                              { label: 'Delete', icon: Trash2, danger: true, onClick: () => setDeletePending(g) },
                            ]} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && !filtered.length && (
                <tr><td colSpan={7} className="td text-center py-8 text-[var(--text-muted)]">No goals yet — add your first goal above.</td></tr>
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
          <GoalFormModal goal={editGoal} cycles={cycles} employeeId={employeeId}
            progressOnly={progressOnly}
            onClose={() => setShowForm(false)}
            onSaved={() => { setShowForm(false); load(); }} />
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

      {previewDoc && <DocPreviewModal filename={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PersonalPerformance() {
  const user = getCurrentUser();
  const employeeId = String(user?.employeeId || '');

  const [activeTab,  setActiveTab]  = useState('My Review');
  const [teamCount,  setTeamCount]  = useState<number | null>(null);

  useEffect(() => {
    api.get('/performance/reviews/team')
      .then(r => { const d = r.data.data ?? r.data; setTeamCount(Array.isArray(d) ? d.length : 0); })
      .catch(() => setTeamCount(0));
  }, []);

  useEffect(() => {
    if (teamCount === 0 && activeTab === 'My Team') setActiveTab('My Review');
  }, [teamCount, activeTab]);

  const TABS = [
    { label: 'My Review', icon: User   },
    ...(teamCount !== 0 ? [{ label: 'My Team', icon: Users }] : []),
    { label: 'My Goals',  icon: Target },
  ];

  if (!employeeId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-[var(--text-muted)]">
        No employee profile linked to your account.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full">
      <PageHeader
        title="Personal Performance"
        subtitle="Your performance reviews, assessments and goals."
      />

      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4">
        {TABS.map(({ label, icon: Icon }) => (
          <button key={label} onClick={() => setActiveTab(label)}
            className={`tab-btn flex items-center gap-1.5 ${activeTab === label ? 'active' : ''}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'My Review' && <MyReviewTab employeeId={employeeId} />}
      {activeTab === 'My Team'   && <MyTeamTab />}
      {activeTab === 'My Goals'  && <MyGoalsTab employeeId={employeeId} />}
    </div>
  );
}
