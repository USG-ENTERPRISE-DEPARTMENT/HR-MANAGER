import { useState, useEffect, useCallback } from 'react';
import {
  GraduationCap, BookOpen, Plus, Edit2, Trash2, Eye, Search,
  Check, X, Send, Award, Clock, CheckCircle2, XCircle,
  RefreshCw, Loader2, UserX, Calendar, MapPin, Users, ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PageHeader }      from './ui/PageHeader';
import { TabBar }          from './ui/TabBar';
import { TableToolbar }    from './ui/TableToolbar';
import { RowActions }      from './ui/RowActions';
import { TablePagination } from './ui/TablePagination';
import { FormModal }       from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { DetailSlideOver } from './ui/DetailSlideOver';
import { SearchSelect }    from './ui/SearchSelect';
import { ConfirmModal }    from './ui/ConfirmModal';
import api                 from '../../lib/api';
import { toast }           from 'sonner';
import { getCurrentUser }  from '../../lib/auth';
import { useCan } from '@/hooks/useCan';

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES   = ['Technical', 'Leadership', 'Compliance', 'Soft Skills', 'Safety', 'Other'];
const COURSE_TYPES = ['Internal', 'External', 'Workshop', 'E-Learning', 'Conference'];
const NOM_TYPES    = ['Self', 'Supervisor', 'Admin'];

const STATUS_MAP: Record<string, string> = {
  Draft:                        'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]',
  'Pending Supervisor Approval':'bg-orange-50 text-orange-700 border border-orange-200',
  'Pending HR Approval':        'bg-amber-500/10 text-amber-700 border border-amber-200/50',
  Approved:                     'pill-success',
  Rejected:                     'pill-danger',
  Completed:                    'bg-indigo-50 text-indigo-700 border border-indigo-200',
  'No Show':                    'bg-slate-100 text-slate-500 border border-slate-200',
};

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const cls = STATUS_MAP[status] ?? 'bg-[var(--surface-hover)] text-[var(--text-muted)]';
  return <span className={`pill ${cls}`}>{status}</span>;
}

function fmtDate(v?: string | null) {
  if (!v) return '—';
  return String(v).substring(0, 10);
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 text-[13px] gap-4 border-b border-[var(--border)] last:border-0">
      <span className="text-[var(--text-muted)] shrink-0">{label}</span>
      <span className="font-medium text-[var(--text-primary)] text-right break-words">{children}</span>
    </div>
  );
}

// ── Shared hooks ──────────────────────────────────────────────────────────────

function useCatalog() {
  const [catalog, setCatalog] = useState<any[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await api.get('/training/catalog');
      setCatalog(r.data?.data ?? []);
    } catch { /* silent */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { catalog, reload: load };
}

function useEmployees() {
  const [employees, setEmployees] = useState<any[]>([]);
  useEffect(() => {
    api.get('/employees/active').then(r => setEmployees(r.data?.data ?? [])).catch(() => {});
  }, []);
  return employees;
}

// ── Nomination Detail Slide-Over ──────────────────────────────────────────────

function NominationDetailSlideOver({
  record, adminMode, supervisorMode = false, onClose, onRefresh,
}: {
  record: any;
  adminMode: boolean;
  supervisorMode?: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { can } = useCan();
  const [busy, setBusy]           = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [completeMode, setCompleteMode] = useState(false);
  const [score, setScore]         = useState('');
  const [cert, setCert]           = useState('');

  useEffect(() => {
    setRejectMode(false); setRejectReason('');
    setCompleteMode(false); setScore(''); setCert('');
  }, [record]);

  if (!record) return null;
  const accent = '#185FA5';

  const action = async (endpoint: string, payload?: object) => {
    setBusy(true);
    try {
      await api.post(`/training/nominations/${record.id}/${endpoint}`, payload ?? {});
      toast.success('Done');
      onRefresh();
      onClose();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Action failed');
    } finally { setBusy(false); }
  };

  const canApprove           = adminMode && can('approve_training') && record.status === 'Pending HR Approval';
  const canComplete          = adminMode && can('approve_training') && record.status === 'Approved';
  const canNoShow            = adminMode && can('approve_training') && record.status === 'Approved';
  const canSubmit            = !adminMode && !supervisorMode && record.status === 'Draft';
  const canSupervisorApprove = supervisorMode && record.status === 'Pending Supervisor Approval';

  const footerActions = (
    <>
      {canSubmit && (
        <button
          disabled={busy}
          onClick={() => action('submit')}
          className="primary-btn shadow-sm disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="inline animate-spin mr-1.5" /> : <Send size={14} className="inline mr-1.5" />}
          Submit for Approval
        </button>
      )}
      {canSupervisorApprove && !rejectMode && (
        <>
          <button
            disabled={busy}
            onClick={() => setRejectMode(true)}
            className="secondary-btn text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5 shadow-sm"
          >
            <X size={14} className="inline mr-1.5" />Reject
          </button>
          <button
            disabled={busy}
            onClick={() => action('supervisor-approve')}
            className="primary-btn bg-[var(--success)] hover:opacity-90 shadow-sm disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1.5" /> : <Check size={14} className="inline mr-1.5" />}
            Approve → HR
          </button>
        </>
      )}
      {canSupervisorApprove && rejectMode && (
        <>
          <button disabled={busy} onClick={() => setRejectMode(false)} className="secondary-btn">Cancel</button>
          <button
            disabled={busy || !rejectReason.trim()}
            onClick={() => action('supervisor-reject', { reason: rejectReason.trim() })}
            className="danger-btn shadow-sm disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1.5" /> : <XCircle size={14} className="inline mr-1.5" />}
            Confirm Reject
          </button>
        </>
      )}
      {canApprove && !rejectMode && (
        <>
          <button
            disabled={busy}
            onClick={() => setRejectMode(true)}
            className="secondary-btn text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5 shadow-sm"
          >
            <X size={14} className="inline mr-1.5" />Reject
          </button>
          <button
            disabled={busy}
            onClick={() => action('approve')}
            className="primary-btn bg-[var(--success)] hover:opacity-90 shadow-sm disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1.5" /> : <Check size={14} className="inline mr-1.5" />}
            Approve
          </button>
        </>
      )}
      {canApprove && rejectMode && (
        <>
          <button disabled={busy} onClick={() => setRejectMode(false)} className="secondary-btn">Cancel</button>
          <button
            disabled={busy || !rejectReason.trim()}
            onClick={() => action('reject', { reason: rejectReason.trim() })}
            className="danger-btn shadow-sm disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1.5" /> : <XCircle size={14} className="inline mr-1.5" />}
            Confirm Reject
          </button>
        </>
      )}
      {canComplete && !completeMode && (
        <>
          <button
            disabled={busy}
            onClick={() => action('no-show')}
            className="secondary-btn text-slate-600 shadow-sm disabled:opacity-60"
          >
            <UserX size={14} className="inline mr-1.5" />No Show
          </button>
          <button disabled={busy} onClick={() => setCompleteMode(true)} className="primary-btn shadow-sm">
            <Award size={14} className="inline mr-1.5" />Mark Complete
          </button>
        </>
      )}
      {canComplete && completeMode && (
        <>
          <button disabled={busy} onClick={() => setCompleteMode(false)} className="secondary-btn">Cancel</button>
          <button
            disabled={busy}
            onClick={() => action('complete', { score: score || undefined, certificate: cert || undefined })}
            className="primary-btn bg-[var(--success)] hover:opacity-90 shadow-sm disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="inline animate-spin mr-1.5" /> : <CheckCircle2 size={14} className="inline mr-1.5" />}
            Confirm Complete
          </button>
        </>
      )}
    </>
  );

  return (
    <DetailSlideOver
      open={!!record}
      title="Training Nomination"
      subtitle={record.employee_name}
      onClose={onClose}
      footerActions={footerActions}
      maxWidth="lg"
    >
      <div className="space-y-5">
        {/* Banner */}
        <div
          className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
          style={{
            background: `color-mix(in srgb, ${accent} 8%, transparent)`,
            border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
          }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accent }} />
              <span className="text-[14px] font-bold text-[var(--text-primary)] truncate">
                {record.training_name}
              </span>
            </div>
            <p className="text-[12px] text-[var(--text-muted)] ml-[18px]">
              {fmtDate(record.start_date)} → {fmtDate(record.end_date)}
              {record.provider && <span className="ml-2" style={{ color: accent }}>· {record.provider}</span>}
            </p>
          </div>
          <StatusPill status={record.status} />
        </div>

        {/* Details card */}
        <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
          <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Details</p>
          </div>
          <div className="px-4 divide-y divide-[var(--border)]">
            {adminMode && <DetailRow label="Employee">{record.employee_name || '—'} {record.employee_empid ? <span className="text-[var(--text-muted)] text-[11px]">({record.employee_empid})</span> : null}</DetailRow>}
            <DetailRow label="Category">{record.category || '—'}</DetailRow>
            <DetailRow label="Type">{record.type || '—'}</DetailRow>
            <DetailRow label="Start Date">{fmtDate(record.start_date)}</DetailRow>
            <DetailRow label="End Date">{fmtDate(record.end_date)}</DetailRow>
            <DetailRow label="Venue">{record.venue || '—'}</DetailRow>
            {(record.cost != null) && (
              <DetailRow label="Cost">
                {Number(record.cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                {record.currency ? ` ${record.currency}` : ''}
              </DetailRow>
            )}
            <DetailRow label="Nomination Type">{record.nomination_type || '—'}</DetailRow>
            {record.nominated_by_name && <DetailRow label="Nominated By">{record.nominated_by_name}</DetailRow>}
          </div>
        </div>

        {/* Notes */}
        {record.notes && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Notes</p>
            <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
              {record.notes}
            </div>
          </div>
        )}

        {/* Rejection reason */}
        {record.status === 'Rejected' && record.rejection_reason && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--danger)] mb-2">Rejection Reason</p>
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700 leading-relaxed">
              {record.rejection_reason}
            </div>
          </div>
        )}

        {/* Completion info */}
        {record.status === 'Completed' && (
          <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Completion</p>
            </div>
            <div className="px-4 divide-y divide-[var(--border)]">
              <DetailRow label="Completed On">{fmtDate(record.completed_at)}</DetailRow>
              {record.score != null && <DetailRow label="Score">{record.score}</DetailRow>}
              {record.certificate && <DetailRow label="Certificate">Uploaded</DetailRow>}
              {record.approved_by_name && <DetailRow label="Approved By">{record.approved_by_name}</DetailRow>}
            </div>
          </div>
        )}

        {/* Reject inline form */}
        {rejectMode && (
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--danger)]">Rejection Reason</label>
            <textarea
              autoFocus
              className={inputClass}
              rows={3}
              maxLength={500}
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Provide a reason for rejection…"
            />
          </div>
        )}

        {/* Complete inline form */}
        {completeMode && (
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Completion Details (optional)</p>
            <FormField label="Score">
              <input
                type="number"
                step="0.01"
                className={inputClass}
                value={score}
                onChange={e => setScore(e.target.value)}
                placeholder="e.g. 85.5"
              />
            </FormField>
            <FormField label="Certificate Reference">
              <input
                className={inputClass}
                value={cert}
                onChange={e => setCert(e.target.value)}
                placeholder="Certificate ID or reference"
              />
            </FormField>
          </div>
        )}
      </div>
    </DetailSlideOver>
  );
}

// ── Training Catalog Tab (admin CRUD — card grid) ─────────────────────────────

type SlotDraft = { _key: string; start_date: string; end_date: string; venue: string; max_seats: string };

// Remaining seats summary for a course card — per-slot caps win; courses
// without slots fall back to the course-level cap. Null = no cap anywhere.
function seatInfo(row: any): { label: string; full: boolean } | null {
  const slots  = row.slots ?? [];
  const capped = slots.filter((sl: any) => sl.max_seats != null);
  if (capped.length > 0) {
    const left      = capped.reduce((sum: number, sl: any) => sum + (sl.seats_left ?? 0), 0);
    const allCapped = capped.length === slots.length;
    if (left <= 0 && allCapped) return { label: 'Fully booked', full: true };
    return { label: `${left}${allCapped ? '' : '+'} seat${left === 1 ? '' : 's'} left`, full: false };
  }
  if (slots.length === 0 && row.max_seats != null) {
    const left = row.seats_left ?? 0;
    if (left <= 0) return { label: 'Fully booked', full: true };
    return { label: `${left} seat${left === 1 ? '' : 's'} left`, full: false };
  }
  return null;
}

// Active values from the CUR code list — used by all currency selects
function useCurrencies() {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    api.get('/system/code-lists/CUR/values')
      .then(r => setList(r.data?.data ?? []))
      .catch(() => {});
  }, []);
  return list;
}

function CurrencySelect({ value, onChange, currencies }: { value: string; onChange: (v: string) => void; currencies: any[] }) {
  const optValue = (c: any) => String(c.code ?? c.label);
  const options  = currencies.map((c: any) => ({ id: optValue(c), label: String(c.label) }));
  // Keep a legacy stored value selectable even if it's no longer in the CUR list
  if (value && !options.some(o => o.id === value)) options.unshift({ id: value, label: value });
  return (
    <SearchSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Select currency…"
    />
  );
}

// ── Course Card (LMS-style) ───────────────────────────────────────────────────

const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  Technical:     ['#185FA5', '#3B8AC9'],
  Leadership:    ['#6D28D9', '#9B6BF2'],
  Compliance:    ['#B45309', '#E0962E'],
  'Soft Skills': ['#0F766E', '#2BB3A3'],
  Safety:        ['#B91C1C', '#E25858'],
  Other:         ['#475569', '#7C93AB'],
};
const categoryGradient = (cat?: string): [string, string] =>
  CATEGORY_GRADIENTS[cat ?? ''] ?? CATEGORY_GRADIENTS.Other;

function CourseCard({ row, onClick, showStatus = false }: { row: any; onClick: () => void; showStatus?: boolean }) {
  const [c1, c2]  = categoryGradient(row.category);
  const seats     = seatInfo(row);
  const today     = new Date().toISOString().slice(0, 10);
  const slots     = row.slots ?? [];
  const nextSlot  = slots.find((sl: any) => (sl.start_date ?? '') >= today) ?? null;
  const isFree    = row.cost == null || Number(row.cost) === 0;

  return (
    <button
      onClick={onClick}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] overflow-hidden text-left transition-all group flex flex-col hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--accent)]/40"
    >
      {/* Cover banner */}
      <div className="relative h-[92px] shrink-0" style={{ background: `linear-gradient(120deg, ${c1}, ${c2})` }}>
        <GraduationCap className="absolute -bottom-3 -right-2 text-white/15" size={86} strokeWidth={1.4} />
        <span className="absolute top-2.5 left-3 font-mono text-[10px] font-bold text-white bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded">
          {row.code}
        </span>
        <div className="absolute top-2.5 right-3 flex items-center gap-1.5">
          {row.type && (
            <span className="text-[10px] font-semibold text-white bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full">
              {row.type}
            </span>
          )}
          {showStatus && !row.is_active && (
            <span className="text-[10px] font-semibold text-white bg-black/30 backdrop-blur-sm px-2 py-0.5 rounded-full">
              Inactive
            </span>
          )}
        </div>
        {row.category && (
          <span className="absolute bottom-2.5 left-3 text-[10px] font-bold uppercase tracking-wider text-white/90">
            {row.category}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4">
        <h3 className="text-[14px] font-bold text-[var(--text-primary)] leading-snug line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
          {row.name}
        </h3>
        {row.provider && (
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{row.provider}</p>
        )}
        {row.description && (
          <p className="text-[12px] text-[var(--text-muted)] line-clamp-2 mt-2 leading-relaxed">{row.description}</p>
        )}

        {/* Meta */}
        <div className="mt-auto pt-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
            <Calendar size={12} className="shrink-0 text-[var(--text-muted)]" />
            {nextSlot
              ? <span className="truncate">Next session {fmtDate(nextSlot.start_date)}{nextSlot.venue ? <span className="text-[var(--text-muted)]"> · {nextSlot.venue}</span> : null}</span>
              : <span className="text-[var(--text-muted)]">{slots.length > 0 ? 'No upcoming sessions' : 'Sessions on request'}</span>}
          </div>
          {seats && (
            <div className={`flex items-center gap-1.5 text-[11.5px] font-semibold ${seats.full ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
              <Users size={12} className="shrink-0" />
              {seats.label}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg)]">
        <span className="text-[13px] font-bold tabular-nums" style={{ color: isFree ? 'var(--success)' : 'var(--text-primary)' }}>
          {isFree ? 'Free' : `${Number(row.cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}${row.currency ? ` ${row.currency}` : ''}`}
        </span>
        <span className="flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity">
          View course <ArrowRight size={12} />
        </span>
      </div>
    </button>
  );
}

const blankCatalog = {
  code: '', name: '', category: '', type: '', provider: '',
  description: '', cost: '', currency: '', max_seats: '', is_active: 'Yes',
};

function CatalogTab() {
  const { can } = useCan();
  const [rows, setRows]       = useState<any[]>([]);
  const [search, setSearch]   = useState('');
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [sel, setSel]         = useState<any>(null);
  const [pending, setPending] = useState<any>(null);
  const [viewRec, setViewRec] = useState<any>(null);
  const [f, setF]             = useState(blankCatalog);
  const [slots, setSlots]     = useState<SlotDraft[]>([]);
  const currencies = useCurrencies();
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const newSlot = (): SlotDraft => ({ _key: Math.random().toString(36).slice(2), start_date: '', end_date: '', venue: '', max_seats: '' });
  const updateSlot = (_key: string, field: string, val: string) =>
    setSlots(p => p.map(s => s._key === _key ? { ...s, [field]: val } : s));

  const load = useCallback(async () => {
    try {
      const r = await api.get('/training/catalog?all=1');
      setRows(r.data?.data ?? []);
    } catch { toast.error('Failed to load catalog'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd  = () => { setSel(null); setF(blankCatalog); setSlots([]); setViewRec(null); setOpen(true); };
  const openEdit = (row: any) => {
    setSel(row);
    setF({
      code:        row.code        ?? '',
      name:        row.name        ?? '',
      category:    row.category    ?? '',
      type:        row.type        ?? '',
      provider:    row.provider    ?? '',
      description: row.description ?? '',
      cost:        row.cost        != null ? String(row.cost)      : '',
      currency:    row.currency    ?? '',
      max_seats:   row.max_seats   != null ? String(row.max_seats) : '',
      is_active:   row.is_active ? 'Yes' : 'No',
    });
    setSlots((row.slots ?? []).map((s: any) => ({
      _key:       String(s.id),
      start_date: (s.start_date ?? '').substring(0, 10),
      end_date:   (s.end_date   ?? '').substring(0, 10),
      venue:      s.venue ?? '',
      max_seats:  s.max_seats != null ? String(s.max_seats) : '',
    })));
    setViewRec(null);
    setOpen(true);
  };

  const handleSave = async () => {
    if (!f.code || !f.name || !f.category || !f.type) {
      toast.error('Code, Name, Category and Type are required');
      return;
    }
    if (slots.some(s => !s.start_date || !s.venue.trim())) {
      toast.error('Each date slot needs a start date and a venue');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...f, is_active: f.is_active === 'Yes' };
      let catalogId: string;
      if (sel) {
        await api.put(`/training/catalog/${sel.id}`, payload);
        catalogId = String(sel.id);
        toast.success('Course updated');
      } else {
        const r = await api.post('/training/catalog', payload);
        catalogId = String(r.data?.data?.id);
        toast.success('Course created');
      }
      await api.post(`/training/catalog/${catalogId}/slots`, {
        slots: slots.filter(s => s.start_date).map(s => ({
          start_date: s.start_date,
          end_date:   s.end_date  || null,
          venue:      s.venue     || null,
          max_seats:  s.max_seats || null,
        })),
      });
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Save failed');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!pending) return;
    try {
      await api.delete(`/training/catalog/${pending.id}`);
      toast.success('Course deleted');
      setPending(null);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Delete failed');
    }
  };

  const filtered = rows.filter(r =>
    !search ||
    r.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.code?.toLowerCase().includes(search.toLowerCase()) ||
    r.provider?.toLowerCase().includes(search.toLowerCase()) ||
    r.category?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <TableToolbar
        searchQuery={search}
        onSearchChange={setSearch}
        actions={
          !can('create_training') ? undefined :
          <button className="primary-btn" onClick={openAdd}>
            <Plus size={15} className="mr-1.5 inline" />Add Course
          </button>
        }
      />

      <div className="overflow-y-auto flex-1 p-4 sm:p-5">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-[13px]">
            {search ? 'No courses match your search' : 'No courses in the catalog yet'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(row => (
              <CourseCard key={row.id} row={row} onClick={() => setViewRec(row)} showStatus />
            ))}
          </div>
        )}
      </div>

      <TablePagination total={rows.length} filtered={filtered.length} />

      <DetailSlideOver
        open={!!viewRec}
        title={viewRec?.name ?? ''}
        subtitle={viewRec?.code ?? ''}
        onClose={() => setViewRec(null)}
        footerActions={viewRec ? (
          <>
            {can('delete_training') && <button onClick={() => { setPending(viewRec); setViewRec(null); }} className="secondary-btn text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5">
              <Trash2 size={14} className="inline mr-1.5" />Delete
            </button>}
            {can('create_training') && <button onClick={() => openEdit(viewRec)} className="primary-btn">
              <Edit2 size={14} className="inline mr-1.5" />Edit
            </button>}
          </>
        ) : undefined}
      >
        {viewRec && (
          <div className="space-y-5">
            <div className="rounded-xl px-5 py-4" style={{ background: 'color-mix(in srgb, #185FA5 8%, transparent)', border: '1px solid color-mix(in srgb, #185FA5 22%, transparent)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold mb-1" style={{ color: '#185FA5' }}>{viewRec.code}</p>
                  <h3 className="text-[15px] font-bold text-[var(--text-primary)] leading-snug">{viewRec.name}</h3>
                  {viewRec.provider && <p className="text-[12px] text-[var(--text-muted)] mt-1">{viewRec.provider}</p>}
                </div>
                <span className={`pill shrink-0 ${viewRec.is_active ? 'pill-success' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                  {viewRec.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              {(viewRec.category || viewRec.type) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {viewRec.category && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'color-mix(in srgb, #185FA5 15%, transparent)', color: '#185FA5' }}>{viewRec.category}</span>
                  )}
                  {viewRec.type && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-secondary)] font-medium bg-[var(--surface)]">{viewRec.type}</span>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Course Details</p>
              </div>
              <div className="px-4 divide-y divide-[var(--border)]">
                <DetailRow label="Cost">{viewRec.cost != null ? `${Number(viewRec.cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}${viewRec.currency ? ` ${viewRec.currency}` : ''}` : '—'}</DetailRow>
                <DetailRow label="Max Seats">{viewRec.max_seats ?? 'Unlimited'}</DetailRow>
              </div>
            </div>

            {/* Slots */}
            <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Date Slots</p>
              </div>
              {(viewRec.slots?.length ?? 0) === 0 ? (
                <p className="px-4 py-3 text-[12px] text-[var(--text-muted)]">No slots defined</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {viewRec.slots.map((sl: any, i: number) => (
                    <div key={sl.id || i} className="px-4 py-2.5 flex items-center justify-between gap-4 text-[13px]">
                      <span className="text-[var(--text-muted)] shrink-0 text-[11px] font-semibold">Slot {i + 1}</span>
                      <div className="text-right">
                        <p className="font-medium text-[var(--text-primary)]">{fmtDate(sl.start_date)}{sl.end_date ? ` → ${fmtDate(sl.end_date)}` : ''}</p>
                        {sl.venue && <p className="text-[11px] text-[var(--text-muted)]">{sl.venue}</p>}
                        {sl.max_seats != null && (
                          <p className={`text-[11px] font-semibold ${(sl.seats_left ?? 0) > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                            {(sl.seats_left ?? 0) > 0 ? `${sl.seats_left} of ${sl.max_seats} seats left` : 'Fully booked'}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {viewRec.description && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Description</p>
                <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">{viewRec.description}</div>
              </div>
            )}
          </div>
        )}
      </DetailSlideOver>

      {/* Add/Edit Modal */}
      {open && (
        <FormModal
          title={sel ? 'Edit Course' : 'Add Course'}
          onClose={() => setOpen(false)}
          onSave={() => { void handleSave(); }}
          maxWidth="3xl"
          scrollable
        >
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code" required>
              <input className={inputClass} value={f.code} onChange={e => set('code', e.target.value)} placeholder="e.g. TECH-001" />
            </FormField>
            <FormField label="Name" required>
              <input className={inputClass} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Course title" />
            </FormField>
            <FormField label="Category" required>
              <select className={inputClass} value={f.category} onChange={e => set('category', e.target.value)}>
                <option value="">Select…</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Type" required>
              <select className={inputClass} value={f.type} onChange={e => set('type', e.target.value)}>
                <option value="">Select…</option>
                {COURSE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Provider">
              <input className={inputClass} value={f.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Coursera" />
            </FormField>
            <FormField label="Cost">
              <input type="number" step="0.01" min="0" className={inputClass} value={f.cost} onChange={e => set('cost', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="0.00" />
            </FormField>
            <FormField label="Currency">
              <CurrencySelect value={f.currency} onChange={v => set('currency', v)} currencies={currencies} />
            </FormField>
            <FormField label="Max Seats">
              <input type="number" min="1" className={inputClass} value={f.max_seats} onChange={e => set('max_seats', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="Leave blank for unlimited" />
            </FormField>
            <FormField label="Status">
              <select className={inputClass} value={f.is_active} onChange={e => set('is_active', e.target.value)}>
                <option>Yes</option>
                <option>No</option>
              </select>
            </FormField>
            <div className="col-span-2">
              <FormField label="Description">
                <textarea className={inputClass} rows={3} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Brief description of the course" />
              </FormField>
            </div>

            {/* Date Slots */}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className="label">Date Slots</label>
                <button
                  type="button"
                  onClick={() => setSlots(p => [...p, newSlot()])}
                  className="secondary-btn py-1 px-2.5 text-[12px]"
                >
                  <Plus size={12} className="inline mr-1" />Add Slot
                </button>
              </div>
              {slots.length === 0 ? (
                <div className="border border-dashed border-[var(--border)] rounded-[10px] py-5 text-center text-[12px] text-[var(--text-muted)]">
                  No date slots yet — click "Add Slot" to define when this course runs.
                </div>
              ) : (
                <div className="space-y-2">
                  {slots.map((sl, i) => (
                    <div key={sl._key} className="grid grid-cols-[1fr_1fr_1fr_90px_auto] gap-2 items-end bg-[var(--bg)] border border-[var(--border)] rounded-[10px] p-3">
                      <FormField label={`Slot ${i + 1} Start`} required>
                        <input type="date" className={inputClass} value={sl.start_date} onChange={e => updateSlot(sl._key, 'start_date', e.target.value)} />
                      </FormField>
                      <FormField label="End Date">
                        <input type="date" className={inputClass} value={sl.end_date} onChange={e => updateSlot(sl._key, 'end_date', e.target.value)} />
                      </FormField>
                      <FormField label="Venue" required>
                        <input className={inputClass} value={sl.venue} onChange={e => updateSlot(sl._key, 'venue', e.target.value)} placeholder="Location" />
                      </FormField>
                      <FormField label="Max Seats">
                        <input type="number" min="1" className={inputClass} value={sl.max_seats} onChange={e => updateSlot(sl._key, 'max_seats', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="∞" />
                      </FormField>
                      <button
                        type="button"
                        onClick={() => setSlots(p => p.filter(s => s._key !== sl._key))}
                        className="action-btn text-[var(--danger)] mb-0.5"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </FormModal>
      )}

      {/* Delete confirm */}
      {pending && (
        <ConfirmModal
          title={`Delete "${pending.name}"?`}
          message="This will permanently remove the course from the catalog."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setPending(null)}
        />
      )}
    </motion.div>
  );
}

// ── Admin Nominations Tab ─────────────────────────────────────────────────────

const ADMIN_STATUS_FILTERS = ['All', 'Pending HR Approval', 'Approved', 'Rejected', 'Completed', 'No Show'];
const MY_STATUS_FILTERS    = ['All', 'Draft', 'Pending Supervisor Approval', 'Pending HR Approval', 'Approved', 'Rejected', 'Completed', 'No Show'];

function AdminNominationsTab() {
  const [rows, setRows]         = useState<any[]>([]);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [viewRec, setViewRec]   = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/training/nominations');
      setRows(r.data?.data ?? []);
    } catch { toast.error('Failed to load nominations'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => {
    if (statusFilter !== 'All' && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.training_name?.toLowerCase().includes(q) ||
        r.employee_name?.toLowerCase().includes(q) ||
        r.employee_empid?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <div className="search-wrap max-w-xs">
          <Search size={14} />
          <input type="search" placeholder="Search nominations…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1 ml-auto">
          {ADMIN_STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                statusFilter === s
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
            >{s}</button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg)]">
              {['Employee', 'ID', 'Training', 'Category', 'Type', 'Start Date', 'Status', ''].map(h => (
                <th key={h} className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="td text-center text-[var(--text-muted)] py-10">No nominations found</td></tr>
            ) : filtered.map(row => (
              <tr key={row.id} className="tr">
                <td className="td font-medium">{row.employee_name || '—'}</td>
                <td className="td text-[var(--text-muted)]">{row.employee_empid || '—'}</td>
                <td className="td">{row.training_name}</td>
                <td className="td">{row.category || '—'}</td>
                <td className="td">{row.type || '—'}</td>
                <td className="td">{fmtDate(row.start_date)}</td>
                <td className="td"><StatusPill status={row.status} /></td>
                <td className="td">
                  <button className="action-btn text-[var(--success)]" onClick={() => setViewRec(row)}>
                    <Eye size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TablePagination total={rows.length} filtered={filtered.length} />

      <NominationDetailSlideOver
        record={viewRec}
        adminMode
        onClose={() => setViewRec(null)}
        onRefresh={load}
      />
    </motion.div>
  );
}

// ── My Training Tab (personal) ────────────────────────────────────────────────

const blankNom = {
  employee: '', training_catalog_id: '', training_name: '',
  provider: '', category: '', type: '', start_date: '', end_date: '',
  venue: '', cost: '', currency: '', nomination_type: 'Self', notes: '',
};

function MyTrainingTab({ preFill, onClearPreFill }: { preFill?: any; onClearPreFill?: () => void }) {
  const user = getCurrentUser();
  const [rows, setRows]           = useState<any[]>([]);
  const [search, setSearch]       = useState('');
  const [open, setOpen]           = useState(false);
  const [saving, setSaving]       = useState(false);
  const [sel, setSel]             = useState<any>(null);
  const [pending, setPending]     = useState<any>(null);
  const [viewRec, setViewRec]     = useState<any>(null);
  const [f, setF]                 = useState(blankNom);
  const [catalog, setCatalog]     = useState<any[]>([]);
  const [catalogSlots, setCatalogSlots] = useState<any[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const currencies = useCurrencies();
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    try {
      const [nomRes, catRes] = await Promise.all([
        api.get('/training/nominations?personal=1'),
        api.get('/training/catalog'),
      ]);
      setRows(nomRes.data?.data ?? []);
      setCatalog(catRes.data?.data ?? []);
    } catch { toast.error('Failed to load training data'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Pre-fill from Browse Catalog tab
  useEffect(() => {
    if (!preFill) return;
    const slots = preFill.slots ?? [];
    const firstSlot = slots.length === 1 && !(slots[0].max_seats != null && (slots[0].seats_left ?? 0) <= 0) ? slots[0] : null;
    setF(p => ({
      ...p,
      training_catalog_id: String(preFill.id),
      training_name:       preFill.name     ?? '',
      provider:            preFill.provider ?? '',
      category:            preFill.category ?? '',
      type:                preFill.type     ?? '',
      cost:                preFill.cost != null ? String(preFill.cost) : '',
      currency:            preFill.currency ?? '',
      start_date: firstSlot ? (firstSlot.start_date ?? '').substring(0, 10) : '',
      end_date:   firstSlot ? (firstSlot.end_date   ?? '').substring(0, 10) : '',
      venue:      firstSlot ? (firstSlot.venue ?? '') : '',
    }));
    setCatalogSlots(slots);
    setSelectedSlotId(firstSlot ? String(firstSlot.id) : '');
    setSel(null);
    setOpen(true);
    onClearPreFill?.();
  }, [preFill, onClearPreFill]);

  const openAdd = () => { setSel(null); setF({ ...blankNom, employee: String(user?.employeeId ?? '') }); setCatalogSlots([]); setSelectedSlotId(''); setOpen(true); };
  const openEdit = (row: any) => {
    setSel(row);
    const cat = catalog.find(c => String(c.id) === String(row.training_catalog_id ?? ''));
    const editSlots = cat?.slots ?? [];
    setCatalogSlots(editSlots);
    const slotMatch = editSlots.find((sl: any) => (sl.start_date ?? '').substring(0, 10) === (row.start_date ?? '').substring(0, 10));
    setSelectedSlotId(slotMatch ? String(slotMatch.id) : '');
    setF({
      employee:            String(row.employee           ?? ''),
      training_catalog_id: row.training_catalog_id != null ? String(row.training_catalog_id) : '',
      training_name:       row.training_name       ?? '',
      provider:            row.provider            ?? '',
      category:            row.category            ?? '',
      type:                row.type                ?? '',
      start_date:          (row.start_date ?? '').substring(0, 10),
      end_date:            (row.end_date   ?? '').substring(0, 10),
      venue:               row.venue               ?? '',
      cost:                row.cost != null         ? String(row.cost) : '',
      currency:            row.currency             ?? '',
      nomination_type:     row.nomination_type      ?? 'Self',
      notes:               row.notes                ?? '',
    });
    setOpen(true);
  };

  const handleCatalogSelect = (id: string) => {
    const cat = catalog.find(c => String(c.id) === id);
    set('training_catalog_id', id);
    const slots = cat?.slots ?? [];
    setCatalogSlots(slots);
    setSelectedSlotId('');
    set('start_date', '');
    set('end_date', '');
    set('venue', '');
    if (cat) {
      set('training_name', cat.name     ?? '');
      set('provider',      cat.provider ?? '');
      set('category',      cat.category ?? '');
      set('type',          cat.type     ?? '');
      set('cost',          cat.cost != null ? String(cat.cost) : '');
      set('currency',      cat.currency ?? '');
      if (slots.length === 1 && !(slots[0].max_seats != null && (slots[0].seats_left ?? 0) <= 0)) {
        setSelectedSlotId(String(slots[0].id));
        set('start_date', (slots[0].start_date ?? '').substring(0, 10));
        set('end_date',   (slots[0].end_date   ?? '').substring(0, 10));
        set('venue',      slots[0].venue ?? '');
      }
    }
  };

  const handleSlotSelect = (slotId: string) => {
    setSelectedSlotId(slotId);
    const sl = catalogSlots.find((s: any) => String(s.id) === slotId);
    if (sl) {
      set('start_date', (sl.start_date ?? '').substring(0, 10));
      set('end_date',   (sl.end_date   ?? '').substring(0, 10));
      set('venue',      sl.venue ?? '');
    }
  };

  const handleSave = async () => {
    const hasSlots = !!f.training_catalog_id && catalogSlots.length > 0;
    if (!f.training_name) { toast.error('Training name is required'); return; }
    if (hasSlots && !selectedSlotId) { toast.error('Please choose a date slot'); return; }
    if (!f.start_date)    { toast.error('Start date is required'); return; }
    setSaving(true);
    try {
      const empId = f.employee || String(user?.employeeId ?? '');
      const payload = { ...f, employee: empId };
      if (sel) {
        await api.put(`/training/nominations/${sel.id}`, payload);
        toast.success('Nomination updated');
      } else {
        await api.post('/training/nominations', payload);
        toast.success('Nomination created');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Save failed');
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!pending) return;
    try {
      await api.delete(`/training/nominations/${pending.id}`);
      toast.success('Nomination deleted');
      setPending(null);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Delete failed');
    }
  };

  const catOptions = catalog.map(c => ({ id: String(c.id), label: `${c.code} — ${c.name}` }));

  const filtered = rows.filter(r =>
    !search ||
    r.training_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.category?.toLowerCase().includes(search.toLowerCase()) ||
    r.provider?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <TableToolbar
        searchQuery={search}
        onSearchChange={setSearch}
        actions={
          <button className="primary-btn" onClick={openAdd}>
            <Plus size={15} className="mr-1.5 inline" />Add Training
          </button>
        }
      />

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg)]">
              {['Training', 'Category', 'Type', 'Provider', 'Start Date', 'End Date', 'Status', ''].map(h => (
                <th key={h} className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="td text-center text-[var(--text-muted)] py-10">No training nominations yet</td></tr>
            ) : filtered.map(row => (
              <tr key={row.id} className="tr">
                <td className="td font-medium">{row.training_name}</td>
                <td className="td">{row.category || '—'}</td>
                <td className="td">{row.type || '—'}</td>
                <td className="td">{row.provider || '—'}</td>
                <td className="td">{fmtDate(row.start_date)}</td>
                <td className="td">{fmtDate(row.end_date)}</td>
                <td className="td"><StatusPill status={row.status} /></td>
                <td className="td">
                  <div className="flex justify-end">
                    <RowActions actions={[
                      { label: 'View', icon: Eye, onClick: () => setViewRec(row) },
                      { label: 'Edit', icon: Edit2, onClick: () => openEdit(row), hidden: row.status !== 'Draft' },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPending(row), hidden: row.status !== 'Draft' },
                    ]} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TablePagination total={rows.length} filtered={filtered.length} />

      {/* Add/Edit Modal */}
      {open && (
        <FormModal
          title={sel ? 'Edit Nomination' : 'Add Training Nomination'}
          onClose={() => setOpen(false)}
          onSave={() => { void handleSave(); }}
          maxWidth="2xl"
          scrollable
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FormField label="Catalog Course (optional)">
                <SearchSelect
                  value={f.training_catalog_id}
                  onChange={handleCatalogSelect}
                  options={catOptions}
                  placeholder="Browse catalog to pre-fill…"
                />
              </FormField>
            </div>
            {f.training_catalog_id && catalogSlots.length > 0 && (
              <div className="col-span-2">
                <FormField label="Date Slot">
                  <select className={inputClass} value={selectedSlotId} onChange={e => handleSlotSelect(e.target.value)}>
                    <option value="">Choose a slot…</option>
                    {catalogSlots.map((sl: any, i: number) => {
                      const full = sl.max_seats != null && (sl.seats_left ?? 0) <= 0;
                      return (
                        <option key={sl.id} value={String(sl.id)} disabled={full}>
                          Slot {i + 1}: {fmtDate(sl.start_date)}{sl.end_date ? ` → ${fmtDate(sl.end_date)}` : ''}{sl.venue ? ` · ${sl.venue}` : ''}{sl.max_seats != null ? (full ? ' · FULL' : ` · ${sl.seats_left} seat${sl.seats_left === 1 ? '' : 's'} left`) : ''}
                        </option>
                      );
                    })}
                  </select>
                </FormField>
              </div>
            )}
            <div className="col-span-2">
              <FormField label="Training Name" required>
                <input className={inputClass} value={f.training_name} onChange={e => set('training_name', e.target.value)} placeholder="e.g. Project Management Fundamentals" />
              </FormField>
            </div>
            <FormField label="Category">
              <select className={inputClass} value={f.category} onChange={e => set('category', e.target.value)}>
                <option value="">Select…</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Type">
              <select className={inputClass} value={f.type} onChange={e => set('type', e.target.value)}>
                <option value="">Select…</option>
                {COURSE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </FormField>
            <div className="col-span-2">
              <FormField label="Provider">
                <input className={inputClass} value={f.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Coursera, Internal L&D" />
              </FormField>
            </div>
            {/* Dates and venue come from the chosen slot when the catalog course defines slots */}
            {!(f.training_catalog_id && catalogSlots.length > 0) && (
              <>
                <FormField label="Start Date" required>
                  <input type="date" className={inputClass} value={f.start_date} onChange={e => set('start_date', e.target.value)} />
                </FormField>
                <FormField label="End Date">
                  <input type="date" className={inputClass} value={f.end_date} onChange={e => set('end_date', e.target.value)} />
                </FormField>
                <div className="col-span-2">
                  <FormField label="Venue / Location">
                    <input className={inputClass} value={f.venue} onChange={e => set('venue', e.target.value)} placeholder="e.g. Conference Room A, Online" />
                  </FormField>
                </div>
              </>
            )}
            <FormField label="Cost">
              <input type="number" step="0.01" min="0" className={inputClass} value={f.cost} onChange={e => set('cost', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="0.00" />
            </FormField>
            <FormField label="Currency">
              <CurrencySelect value={f.currency} onChange={v => set('currency', v)} currencies={currencies} />
            </FormField>
            <div className="col-span-2">
              <FormField label="Notes">
                <textarea className={inputClass} rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Reason for training, learning objectives, etc." />
              </FormField>
            </div>
          </div>
        </FormModal>
      )}

      {/* Delete confirm */}
      {pending && (
        <ConfirmModal
          title="Delete Nomination?"
          message={`Remove "${pending.training_name}" from your training list?`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setPending(null)}
        />
      )}

      <NominationDetailSlideOver
        record={viewRec}
        adminMode={false}
        onClose={() => setViewRec(null)}
        onRefresh={load}
      />
    </motion.div>
  );
}

// ── Browse Catalog Tab (personal) ─────────────────────────────────────────────

function BrowseCatalogTab({ onNominate, onNominateSubordinate }: {
  onNominate: (course: any) => void;
  onNominateSubordinate?: (course: any) => void;
}) {
  const { catalog } = useCatalog();
  const [search, setSearch]   = useState('');
  const [viewRec, setViewRec] = useState<any>(null);

  const filtered = catalog.filter(r =>
    !search ||
    r.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.code?.toLowerCase().includes(search.toLowerCase()) ||
    r.category?.toLowerCase().includes(search.toLowerCase()) ||
    r.provider?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <TableToolbar searchQuery={search} onSearchChange={setSearch} />

      <div className="overflow-y-auto flex-1 p-4 sm:p-5">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-[13px]">
            {search ? 'No courses match your search' : 'No courses available'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map(row => (
              <CourseCard key={row.id} row={row} onClick={() => setViewRec(row)} />
            ))}
          </div>
        )}
      </div>

      <TablePagination total={catalog.length} filtered={filtered.length} />

      {/* Course Detail Slide-Over with Nominate action */}
      <DetailSlideOver
        open={!!viewRec}
        title={viewRec?.name ?? ''}
        subtitle={viewRec?.code ?? ''}
        onClose={() => setViewRec(null)}
        footerActions={viewRec ? (
          <>
            {onNominateSubordinate && (
              <button
                onClick={() => { onNominateSubordinate(viewRec); setViewRec(null); }}
                className="secondary-btn"
              >
                <Plus size={14} className="inline mr-1.5" />Assign to Subordinate
              </button>
            )}
            <button
              onClick={() => { onNominate(viewRec); setViewRec(null); }}
              className="primary-btn"
              style={{ background: '#185FA5' }}
            >
              <Plus size={14} className="inline mr-1.5" />Nominate for Myself
            </button>
          </>
        ) : undefined}
      >
        {viewRec && (
          <div className="space-y-5">
            <div
              className="rounded-xl px-5 py-4"
              style={{
                background: 'color-mix(in srgb, #185FA5 8%, transparent)',
                border: '1px solid color-mix(in srgb, #185FA5 22%, transparent)',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold mb-1" style={{ color: '#185FA5' }}>{viewRec.code}</p>
                  <h3 className="text-[15px] font-bold text-[var(--text-primary)] leading-snug">{viewRec.name}</h3>
                  {viewRec.provider && (
                    <p className="text-[12px] text-[var(--text-muted)] mt-1">{viewRec.provider}</p>
                  )}
                </div>
              </div>
              {(viewRec.category || viewRec.type) && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {viewRec.category && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'color-mix(in srgb, #185FA5 15%, transparent)', color: '#185FA5' }}>
                      {viewRec.category}
                    </span>
                  )}
                  {viewRec.type && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-secondary)] font-medium bg-[var(--surface)]">
                      {viewRec.type}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Course Details</p>
              </div>
              <div className="px-4 divide-y divide-[var(--border)]">
                <DetailRow label="Cost">
                  {viewRec.cost != null
                    ? `${Number(viewRec.cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}${viewRec.currency ? ` ${viewRec.currency}` : ''}`
                    : '—'}
                </DetailRow>
                <DetailRow label="Max Seats">{viewRec.max_seats ?? 'Unlimited'}</DetailRow>
              </div>
            </div>

            {/* Slots */}
            <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Date Slots</p>
              </div>
              {(viewRec.slots?.length ?? 0) === 0 ? (
                <p className="px-4 py-3 text-[12px] text-[var(--text-muted)]">No slots defined for this course</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {viewRec.slots.map((sl: any, i: number) => (
                    <div key={sl.id || i} className="px-4 py-2.5 flex items-center justify-between gap-4 text-[13px]">
                      <span className="text-[var(--text-muted)] shrink-0 text-[11px] font-semibold">Slot {i + 1}</span>
                      <div className="text-right">
                        <p className="font-medium text-[var(--text-primary)]">{fmtDate(sl.start_date)}{sl.end_date ? ` → ${fmtDate(sl.end_date)}` : ''}</p>
                        {sl.venue && <p className="text-[11px] text-[var(--text-muted)]">{sl.venue}</p>}
                        {sl.max_seats != null && (
                          <p className={`text-[11px] font-semibold ${(sl.seats_left ?? 0) > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                            {(sl.seats_left ?? 0) > 0 ? `${sl.seats_left} of ${sl.max_seats} seats left` : 'Fully booked'}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {viewRec.description && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Description</p>
                <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  {viewRec.description}
                </div>
              </div>
            )}
          </div>
        )}
      </DetailSlideOver>
    </motion.div>
  );
}

// ── Subordinate Training Tab ──────────────────────────────────────────────────

const blankSubNom = {
  employee: '', training_catalog_id: '', training_name: '',
  provider: '', category: '', type: '', start_date: '', end_date: '',
  venue: '', cost: '', currency: '', notes: '',
};

function SubordinateTrainingTab({ preFill, onClearPreFill }: { preFill?: any; onClearPreFill?: () => void }) {
  const [rows, setRows]         = useState<any[]>([]);
  const [search, setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [viewRec, setViewRec]   = useState<any>(null);

  // Assign training state
  const [subordinates, setSubordinates] = useState<any[]>([]);
  const [catalog, setCatalog]   = useState<any[]>([]);
  const [open, setOpen]         = useState(false);
  const [f, setF]               = useState(blankSubNom);
  const [catalogSlots, setCatalogSlots] = useState<any[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const currencies = useCurrencies();
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    try {
      const [nomRes, subRes, catRes] = await Promise.all([
        api.get('/training/nominations/subordinate'),
        api.get('/training/subordinates'),
        api.get('/training/catalog'),
      ]);
      setRows(nomRes.data?.data ?? []);
      setSubordinates(subRes.data?.data ?? []);
      setCatalog(catRes.data?.data ?? []);
    } catch { toast.error('Failed to load subordinate training data'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Pre-fill from Browse Catalog tab
  useEffect(() => {
    if (!preFill) return;
    const slots = preFill.slots ?? [];
    const firstSlot = slots.length === 1 && !(slots[0].max_seats != null && (slots[0].seats_left ?? 0) <= 0) ? slots[0] : null;
    setF(p => ({
      ...p,
      training_catalog_id: String(preFill.id),
      training_name:       preFill.name     ?? '',
      provider:            preFill.provider ?? '',
      category:            preFill.category ?? '',
      type:                preFill.type     ?? '',
      cost:                preFill.cost != null ? String(preFill.cost) : '',
      currency:            preFill.currency ?? '',
      start_date: firstSlot ? (firstSlot.start_date ?? '').substring(0, 10) : '',
      end_date:   firstSlot ? (firstSlot.end_date   ?? '').substring(0, 10) : '',
      venue:      firstSlot ? (firstSlot.venue ?? '') : '',
    }));
    setCatalogSlots(slots);
    setSelectedSlotId(firstSlot ? String(firstSlot.id) : '');
    setOpen(true);
    onClearPreFill?.();
  }, [preFill, onClearPreFill]);

  const handleCatalogSelect = (id: string) => {
    const cat = catalog.find(c => String(c.id) === id);
    set('training_catalog_id', id);
    const slots = cat?.slots ?? [];
    setCatalogSlots(slots);
    setSelectedSlotId('');
    set('start_date', '');
    set('end_date', '');
    set('venue', '');
    if (cat) {
      set('training_name', cat.name     ?? '');
      set('provider',      cat.provider ?? '');
      set('category',      cat.category ?? '');
      set('type',          cat.type     ?? '');
      set('cost',          cat.cost != null ? String(cat.cost) : '');
      set('currency',      cat.currency ?? '');
      if (slots.length === 1 && !(slots[0].max_seats != null && (slots[0].seats_left ?? 0) <= 0)) {
        setSelectedSlotId(String(slots[0].id));
        set('start_date', (slots[0].start_date ?? '').substring(0, 10));
        set('end_date',   (slots[0].end_date   ?? '').substring(0, 10));
        set('venue',      slots[0].venue ?? '');
      }
    }
  };

  const handleSlotSelect = (slotId: string) => {
    setSelectedSlotId(slotId);
    const sl = catalogSlots.find((s: any) => String(s.id) === slotId);
    if (sl) {
      set('start_date', (sl.start_date ?? '').substring(0, 10));
      set('end_date',   (sl.end_date   ?? '').substring(0, 10));
      set('venue',      sl.venue ?? '');
    }
  };

  const handleSave = async () => {
    const hasSlots = !!f.training_catalog_id && catalogSlots.length > 0;
    if (!f.employee)      { toast.error('Employee is required'); return; }
    if (!f.training_name) { toast.error('Training name is required'); return; }
    if (hasSlots && !selectedSlotId) { toast.error('Please choose a date slot'); return; }
    if (!f.start_date)    { toast.error('Start date is required'); return; }
    try {
      await api.post('/training/nominations', { ...f, nomination_type: 'Supervisor' });
      toast.success('Training assigned');
      setOpen(false);
      setF(blankSubNom);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Save failed');
    }
  };

  const catOptions = catalog.map(c => ({ id: String(c.id), label: `${c.code} — ${c.name}` }));
  const empOptions = subordinates.map(e => ({ id: String(e.id), label: `${e.name}${e.employee_id ? ` (${e.employee_id})` : ''}` }));

  const filtered = rows.filter(r => {
    if (statusFilter !== 'All' && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.training_name?.toLowerCase().includes(q) ||
        r.employee_name?.toLowerCase().includes(q) ||
        r.employee_empid?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <div className="search-wrap max-w-xs">
          <Search size={14} />
          <input type="search" placeholder="Search nominations…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="primary-btn shrink-0" onClick={() => { setF(blankSubNom); setCatalogSlots([]); setSelectedSlotId(''); setOpen(true); }}>
          <Plus size={15} className="mr-1.5 inline" />Assign Training
        </button>
        <div className="flex flex-wrap gap-1 ml-auto">
          {MY_STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                statusFilter === s
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
            >{s}</button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg)]">
              {['Employee', 'ID', 'Training', 'Category', 'Type', 'Start Date', 'Status', ''].map(h => (
                <th key={h} className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="td text-center text-[var(--text-muted)] py-10">
                  {rows.length === 0 ? 'No direct reports or no training nominations from your team' : 'No nominations match the selected filter'}
                </td>
              </tr>
            ) : filtered.map(row => (
              <tr key={row.id} className="tr">
                <td className="td font-medium">{row.employee_name || '—'}</td>
                <td className="td text-[var(--text-muted)]">{row.employee_empid || '—'}</td>
                <td className="td">{row.training_name}</td>
                <td className="td">{row.category || '—'}</td>
                <td className="td">{row.type || '—'}</td>
                <td className="td">{fmtDate(row.start_date)}</td>
                <td className="td"><StatusPill status={row.status} /></td>
                <td className="td">
                  <button className="action-btn text-[var(--success)]" onClick={() => setViewRec(row)}>
                    <Eye size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TablePagination total={rows.length} filtered={filtered.length} />

      {/* Assign Training Modal */}
      {open && (
        <FormModal
          title="Assign Training"
          subtitle="Nominate a direct report for training"
          onClose={() => setOpen(false)}
          onSave={() => { void handleSave(); }}
          maxWidth="2xl"
          scrollable
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FormField label="Employee" required>
                <SearchSelect
                  value={f.employee}
                  onChange={v => set('employee', v)}
                  options={empOptions}
                  placeholder="Select direct report…"
                />
              </FormField>
            </div>
            <div className="col-span-2">
              <FormField label="Catalog Course (optional)">
                <SearchSelect
                  value={f.training_catalog_id}
                  onChange={handleCatalogSelect}
                  options={catOptions}
                  placeholder="Browse catalog to pre-fill…"
                />
              </FormField>
            </div>
            {f.training_catalog_id && catalogSlots.length > 0 && (
              <div className="col-span-2">
                <FormField label="Date Slot">
                  <select className={inputClass} value={selectedSlotId} onChange={e => handleSlotSelect(e.target.value)}>
                    <option value="">Choose a slot…</option>
                    {catalogSlots.map((sl: any, i: number) => {
                      const full = sl.max_seats != null && (sl.seats_left ?? 0) <= 0;
                      return (
                        <option key={sl.id} value={String(sl.id)} disabled={full}>
                          Slot {i + 1}: {fmtDate(sl.start_date)}{sl.end_date ? ` → ${fmtDate(sl.end_date)}` : ''}{sl.venue ? ` · ${sl.venue}` : ''}{sl.max_seats != null ? (full ? ' · FULL' : ` · ${sl.seats_left} seat${sl.seats_left === 1 ? '' : 's'} left`) : ''}
                        </option>
                      );
                    })}
                  </select>
                </FormField>
              </div>
            )}
            <div className="col-span-2">
              <FormField label="Training Name" required>
                <input className={inputClass} value={f.training_name} onChange={e => set('training_name', e.target.value)} placeholder="e.g. Project Management Fundamentals" />
              </FormField>
            </div>
            <FormField label="Category">
              <select className={inputClass} value={f.category} onChange={e => set('category', e.target.value)}>
                <option value="">Select…</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Type">
              <select className={inputClass} value={f.type} onChange={e => set('type', e.target.value)}>
                <option value="">Select…</option>
                {COURSE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </FormField>
            <div className="col-span-2">
              <FormField label="Provider">
                <input className={inputClass} value={f.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Coursera, Internal L&D" />
              </FormField>
            </div>
            {/* Dates and venue come from the chosen slot when the catalog course defines slots */}
            {!(f.training_catalog_id && catalogSlots.length > 0) && (
              <>
                <FormField label="Start Date" required>
                  <input type="date" className={inputClass} value={f.start_date} onChange={e => set('start_date', e.target.value)} />
                </FormField>
                <FormField label="End Date">
                  <input type="date" className={inputClass} value={f.end_date} onChange={e => set('end_date', e.target.value)} />
                </FormField>
                <div className="col-span-2">
                  <FormField label="Venue / Location">
                    <input className={inputClass} value={f.venue} onChange={e => set('venue', e.target.value)} placeholder="e.g. Conference Room A, Online" />
                  </FormField>
                </div>
              </>
            )}
            <FormField label="Cost">
              <input type="number" step="0.01" min="0" className={inputClass} value={f.cost} onChange={e => set('cost', e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="0.00" />
            </FormField>
            <FormField label="Currency">
              <CurrencySelect value={f.currency} onChange={v => set('currency', v)} currencies={currencies} />
            </FormField>
            <div className="col-span-2">
              <FormField label="Notes">
                <textarea className={inputClass} rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Reason for assignment, learning objectives, etc." />
              </FormField>
            </div>
          </div>
        </FormModal>
      )}

      <NominationDetailSlideOver
        record={viewRec}
        adminMode={false}
        supervisorMode
        onClose={() => setViewRec(null)}
        onRefresh={load}
      />
    </motion.div>
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function AdminTraining() {
  const [tab, setTab] = useState('Training Approval List');
  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full">
      <PageHeader
        title="Manage Training"
        subtitle="Approve nominations and manage the training catalog"
      />
      <TabBar
        tabs={['Create Training', 'Training Approval List']}
        activeTab={tab}
        onChange={setTab}
        icons={{
          'Create Training':        <BookOpen size={14} />,
          'Training Approval List': <CheckCircle2 size={14} />,
        }}
      />
      {tab === 'Create Training'        && <CatalogTab />}
      {tab === 'Training Approval List' && <AdminNominationsTab />}
    </div>
  );
}

export function PersonalTraining() {
  const [tab, setTab]               = useState('Personal Training');
  const [preFill, setPreFill]       = useState<any>(null);
  const [subPreFill, setSubPreFill] = useState<any>(null);

  const handleNominate = useCallback((course: any) => {
    setPreFill(course);
    setTab('Personal Training');
  }, []);

  const handleNominateSubordinate = useCallback((course: any) => {
    setSubPreFill(course);
    setTab('Subordinate Training');
  }, []);

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full">
      <PageHeader
        title="Personal Training"
        subtitle="Track your learning journey and your team's development"
      />
      <TabBar
        tabs={['Personal Training', 'Subordinate Training', 'Browse Catalog']}
        activeTab={tab}
        onChange={setTab}
        icons={{
          'Personal Training':    <GraduationCap size={14} />,
          'Subordinate Training': <Users size={14} />,
          'Browse Catalog':       <BookOpen size={14} />,
        }}
      />
      {tab === 'Personal Training' && (
        <MyTrainingTab
          preFill={preFill}
          onClearPreFill={() => setPreFill(null)}
        />
      )}
      {tab === 'Browse Catalog' && (
        <BrowseCatalogTab
          onNominate={handleNominate}
          onNominateSubordinate={handleNominateSubordinate}
        />
      )}
      {tab === 'Subordinate Training' && (
        <SubordinateTrainingTab
          preFill={subPreFill}
          onClearPreFill={() => setSubPreFill(null)}
        />
      )}
    </div>
  );
}
