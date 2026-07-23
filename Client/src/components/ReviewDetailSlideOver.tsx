import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Loader2, CheckCircle2, Clock, ChevronDown, Star, Paperclip, Calendar, Upload, RotateCcw, Save, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { toast } from 'sonner';
import { DocPreviewModal } from './ui/DocPreviewModal';
import { CountedTextarea } from './ui/CountedTextarea';
import { ConfirmModal } from './ui/ConfirmModal';
import { DraftWithAI } from './ai/DraftWithAI';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReviewMode = 'employee' | 'supervisor' | 'hr';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return String(v).substring(0, 10); }
}

const STEPS = ['Not Started', 'Self Assessment', 'Supervisor Review', 'HR Review', 'Completed'];
const STATUS_IDX: Record<string, number> = Object.fromEntries(STEPS.map((s, i) => [s, i]));

const RATING_LABELS: Record<number, string> = {
  0.5: 'Below Expectations',
  1:   'Below Expectations',
  1.5: 'Needs Improvement',
  2:   'Needs Improvement',
  2.5: 'Meets Expectations',
  3:   'Meets Expectations',
  3.5: 'Exceeds Expectations',
  4:   'Exceeds Expectations',
  4.5: 'Outstanding',
  5:   'Outstanding',
};

const STATUS_COLOR: Record<string, string> = {
  'Not Started':       'bg-slate-100 text-slate-500',
  'Self Assessment':   'bg-amber-50 text-amber-700',
  'Supervisor Review': 'bg-blue-50 text-blue-700',
  'HR Review':         'bg-violet-50 text-violet-700',
  Completed:           'bg-emerald-50 text-emerald-700',
};

const GOAL_SCORE_COLORS = { red: '#ef4444', amber: '#f59e0b', green: '#22c55e' } as const;
type ScoreColor = 'red' | 'amber' | 'green';
function calcScoreColor(stars: number | null): ScoreColor | null {
  if (stars == null) return null;
  if (stars < 2)    return 'red';
  if (stars <= 3.5) return 'amber';
  return 'green';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusStepper({ status }: { status: string }) {
  const current = STATUS_IDX[status] ?? 0;
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const done    = i < current;
        const active  = i === current;
        const last    = i === STEPS.length - 1;
        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2
                ${done   ? 'bg-emerald-500 border-emerald-500 text-white'
                : active ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                :          'bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)]'}`}>
                {done ? <CheckCircle2 size={13} /> : i + 1}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${active ? 'font-bold text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {step}
              </span>
            </div>
            {!last && (
              <div className={`w-8 h-0.5 mb-4 ${i < current ? 'bg-emerald-400' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StarIcon({ fill, color }: { fill: 'full' | 'half' | 'empty'; color?: string }) {
  const fillColor = color ?? '#facc15';
  if (fill === 'full')  return <Star size={20} style={{ fill: fillColor, color: fillColor }} />;
  if (fill === 'empty') return <Star size={20} className="text-slate-300" />;
  return (
    <span className="relative inline-block" style={{ width: 20, height: 20 }}>
      <Star size={20} className="text-slate-300 absolute inset-0" />
      <Star size={20} style={{ fill: fillColor, color: fillColor, clipPath: 'inset(0 50% 0 0)' }} className="absolute inset-0" />
    </span>
  );
}

function StarPicker({ value, onChange, readonly, allowHalf = false, colorOverride }: {
  value: number; onChange: (v: number) => void; readonly?: boolean; allowHalf?: boolean;
  colorOverride?: ScoreColor;
}) {
  const [hover, setHover] = useState(0);
  const lastClick = useRef<{ n: number; t: number } | null>(null);

  const handleClick = (n: number) => {
    if (readonly) return;
    if (!allowHalf) { onChange(n); return; }
    const now = Date.now();
    const prev = lastClick.current;
    if (prev && prev.n === n && now - prev.t < 400) {
      onChange(Math.max(0.5, n - 0.5));
      lastClick.current = null;
    } else {
      onChange(n);
      lastClick.current = { n, t: now };
    }
  };

  const displayVal = hover || value;
  const starFill = (n: number): 'full' | 'half' | 'empty' => {
    if (displayVal >= n) return 'full';
    if (allowHalf && displayVal >= n - 0.5) return 'half';
    return 'empty';
  };
  const starColor = readonly && colorOverride ? GOAL_SCORE_COLORS[colorOverride] : undefined;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" disabled={readonly}
          onClick={() => handleClick(n)}
          onMouseEnter={() => !readonly && setHover(n)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`transition-colors ${readonly ? 'cursor-default' : 'cursor-pointer'}`}>
          <StarIcon fill={starFill(n)} color={starColor} />
        </button>
      ))}
      {value > 0 && (
        <span className="text-[12px] font-medium text-[var(--text-muted)] ml-1">
          {RATING_LABELS[value] ?? RATING_LABELS[Math.ceil(value)] ?? ''}
        </span>
      )}
      {allowHalf && !readonly && value === 0 && (
        <span className="text-[11px] text-[var(--text-muted)] ml-1">double-click for ½ star</span>
      )}
    </div>
  );
}

const RATER_STYLES = {
  employee:   { pill: 'text-amber-700  bg-amber-50  border border-amber-200',  dot: 'bg-amber-400'  },
  supervisor: { pill: 'text-blue-700   bg-blue-50   border border-blue-200',   dot: 'bg-blue-400'   },
  hr:         { pill: 'text-violet-700 bg-violet-50 border border-violet-200', dot: 'bg-violet-400' },
};

function CompetencyCard({ n, selfRating, supRating, hrRating, selfComment, supComment, hrComment,
  onSelfChange, onSupChange, onHrChange, onSelfComment, onSupComment, onHrComment,
  mode, reviewStatus }: any) {

  const statusI  = STATUS_IDX[reviewStatus] ?? 0;
  const canSelf  = mode === 'employee'   && statusI === 0;
  const canSup   = mode === 'supervisor' && statusI === 1;
  const canHr    = mode === 'hr'         && statusI >= 2;

  const ratingLabel = (v: number) =>
    RATING_LABELS[v] ?? RATING_LABELS[Math.ceil(v)] ?? null;

  const raters = [
    { key: 'employee',   label: 'Employee',   rating: selfRating ?? 0, comment: selfComment ?? '',
      canEdit: canSelf,  onChange: onSelfChange, onComment: onSelfComment },
    { key: 'supervisor', label: 'Supervisor',  rating: supRating  ?? 0, comment: supComment  ?? '',
      canEdit: canSup,   onChange: onSupChange,  onComment: onSupComment  },
    { key: 'hr',         label: 'HR',          rating: hrRating   ?? 0, comment: hrComment   ?? '',
      canEdit: canHr,    onChange: onHrChange,   onComment: onHrComment   },
  ] as const;

  return (
    <div className="border border-[var(--border)] rounded-[10px] overflow-hidden">
      {/* Competency name header */}
      <div className="px-4 py-2.5 bg-[var(--bg)] border-b border-[var(--border)]">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">{n}</p>
      </div>

      {/* Rater rows */}
      <div className="divide-y divide-[var(--border)]">
        {raters.map(row => {
          const style  = RATER_STYLES[row.key as keyof typeof RATER_STYLES];
          const label  = ratingLabel(row.rating);
          const active = row.canEdit;
          return (
            <div key={row.key} className={`px-4 py-3 flex flex-col gap-2 transition-colors ${active ? 'bg-[var(--surface)]' : ''}`}>
              {/* Rater info + stars */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 ${style.pill}`} style={{ minWidth: 76, textAlign: 'center' }}>
                  {row.label}
                </span>
                {row.rating > 0 || active ? (
                  <StarPicker value={row.rating} onChange={row.onChange as any} readonly={!active} />
                ) : (
                  <span className="text-[12px] text-[var(--text-muted)]">—</span>
                )}
                {row.rating > 0 && label && (
                  <span className="text-[11.5px] text-[var(--text-muted)]">{label}</span>
                )}
              </div>

              {/* Comment — editable for active rater, read-only if they left one */}
              {active ? (
                <CountedTextarea
                  className="border border-[var(--border)] rounded-[7px] px-3 py-1.5 text-[12px] bg-white resize-y w-full focus:outline-none focus:border-[var(--accent)]"
                  rows={2}
                  maxChars={500}
                  placeholder="Add a comment on this competency…"
                  value={row.comment}
                  onChange={e => (row.onComment as any)?.(e.target.value)}
                />
              ) : row.comment ? (
                <p className="text-[12px] text-[var(--text-muted)] italic pl-1">{row.comment}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, locked, defaultExpanded = true, children }: {
  title: string; locked: boolean; defaultExpanded?: boolean; children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className={`border border-[var(--border)] rounded-[10px] overflow-hidden ${locked ? 'opacity-50' : ''}`}>
      <button
        type="button"
        disabled={locked}
        onClick={() => !locked && setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-[var(--bg)] text-left"
      >
        {locked
          ? <Clock size={13} className="text-[var(--text-muted)] shrink-0" />
          : <CheckCircle2 size={13} className="text-[var(--accent)] shrink-0" />}
        <h3 className="text-[13px] font-bold text-[var(--text-primary)] flex-1">{title}</h3>
        {locked
          ? <span className="text-[10.5px] text-[var(--text-muted)]">Locked — prior stage not complete</span>
          : <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />}
      </button>
      {!locked && expanded && (
        <div className="p-4 border-t border-[var(--border)]">{children}</div>
      )}
    </div>
  );
}

function ScoreDisplay({ val, maxPts, canEdit, setter }: { val: string; maxPts: number; canEdit: boolean; setter: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      {canEdit ? (
        <input type="number" min={0} max={maxPts} step={0.5}
          className="w-20 border border-[var(--border)] rounded-[7px] px-2 py-1 text-[12.5px] bg-[var(--surface)] focus:outline-none focus:border-[var(--accent)]"
          value={val}
          onChange={e => setter(e.target.value)}
          onWheel={e => e.currentTarget.blur()} />
      ) : (
        <span className="font-semibold text-[13px] text-[var(--text-primary)]">{val || '—'}</span>
      )}
      <span className="text-[11.5px] text-[var(--text-muted)]">/ {maxPts} pts</span>
    </div>
  );
}

const ta = 'border border-[var(--border)] rounded-[8px] px-3 py-2 text-[13px] bg-[var(--surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] w-full resize-y min-h-[64px]';

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  reviewId: string;
  mode: ReviewMode;
  onClose: () => void;
  /** When true the review is view-only (e.g. HR viewer without review_performance). */
  readOnly?: boolean;
}

export function ReviewDetailSlideOver({ reviewId, mode, onClose, readOnly = false }: Props) {
  const [review, setReview]     = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'self' | 'supervisor' | 'hr' | null>(null);

  // Self-assessment form state
  const [selfComments, setSelfComments] = useState('');
  const [goalEmpScores,     setGoalEmpScores]     = useState<Record<string, string>>({});
  const [goalSupScores,     setGoalSupScores]     = useState<Record<string, string>>({});
  const [goalHrScores,      setGoalHrScores]      = useState<Record<string, string>>({});
  const [goalActualResults, setGoalActualResults] = useState<Record<string, string>>({});
  const [goalComments,      setGoalComments]      = useState<Record<string, string>>({});
  const [goalSupComments,   setGoalSupComments]   = useState<Record<string, string>>({});
  const [goalHrComments,    setGoalHrComments]    = useState<Record<string, string>>({});
  const [goalDocRefs,       setGoalDocRefs]       = useState<Record<string, string>>({});
  const [goalDocUploading,  setGoalDocUploading]  = useState<Record<string, boolean>>({});

  // Supervisor form state
  const [supComments, setSupComments] = useState('');
  const [strengths,   setStrengths]   = useState('');
  const [improvements, setImprovements] = useState('');

  // HR form state
  const [hrComments,       setHrComments]        = useState('');
  const [developmentPlan,  setDevelopmentPlan]   = useState('');

  // Competency ratings state: { competencyId: { self_rating, supervisor_rating, hr_rating, self_comment, supervisor_comment, hr_comment } }
  const [compRatings, setCompRatings] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/performance/reviews/${reviewId}`);
      const rev = r.data.data ?? r.data;
      setReview(rev);

      // Handles: plain number, numeric string, or Prisma.Decimal serialised as {s,e,d}.
      // Reconstructs full decimal precision (e.g. 2.5, not just 2) from the d[] array.
      const safeScore = (v: any): number => {
        if (v == null) return 0;
        if (typeof v === 'number') return isNaN(v) ? 0 : v;
        if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
        if (typeof v === 'object' && Array.isArray(v.d) && v.d.length > 0 && typeof v.s === 'number') {
          const sign = (v.s as number) < 0 ? -1 : 1;
          const intPart = String(v.d[0]);
          const fracPart = (v.d as number[]).slice(1)
            .map(n => String(n).padStart(7, '0')).join('').replace(/0+$/, '');
          const full = parseFloat(fracPart ? `${intPart}.${fracPart}` : intPart);
          return isNaN(full) ? 0 : sign * full;
        }
        return 0;
      };
      // For decimal values (overall_score average), reconstruct full precision from {s,e,d}
      const safeDecimalStr = (v: any): string => {
        if (v == null) return '';
        if (typeof v === 'number' && !isNaN(v) && v > 0) return v.toFixed(2);
        if (typeof v === 'string' && parseFloat(v) > 0) return parseFloat(v).toFixed(2);
        if (typeof v === 'object' && Array.isArray(v.d) && v.d.length > 0 && typeof v.s === 'number') {
          // Reconstruct decimal string from Decimal.js base-1e7 chunks
          const sign = v.s < 0 ? '-' : '';
          const intPart = String(v.d[0]);
          const fracPart = v.d.slice(1).map((n: number) => String(n).padStart(7, '0')).join('').replace(/0+$/, '');
          const full = parseFloat(`${sign}${intPart}${fracPart ? '.' + fracPart : ''}`);
          return isNaN(full) || full <= 0 ? '' : full.toFixed(2);
        }
        return '';
      };

      // Pre-fill self
      setSelfComments(rev.self_comments ?? '');

      // Pre-fill supervisor
      setSupComments(rev.supervisor_comments ?? '');
      setStrengths(rev.strengths ?? '');
      setImprovements(rev.improvements ?? '');

      // Pre-fill HR
      setHrComments(rev.hr_comments ?? '');
      setDevelopmentPlan(rev.development_plan ?? '');

      // Pre-fill goal scores, actual results, comments and doc refs
      const ges: Record<string, string> = {};
      const gss: Record<string, string> = {};
      const ghs: Record<string, string> = {};
      const gar: Record<string, string> = {};
      const gc:  Record<string, string> = {};
      const gsc: Record<string, string> = {};
      const ghc: Record<string, string> = {};
      const gd:  Record<string, string> = {};
      (rev.goals ?? []).forEach((g: any) => {
        ges[String(g.id)] = g.employee_score   != null ? String(safeScore(g.employee_score))   : '';
        gss[String(g.id)] = g.supervisor_score != null ? String(safeScore(g.supervisor_score)) : '';
        ghs[String(g.id)] = g.hr_score         != null ? String(safeScore(g.hr_score))         : '';
        gar[String(g.id)] = g.actual_result    ?? '';
        gc[String(g.id)]  = g.comment            ?? '';
        gsc[String(g.id)] = g.supervisor_comment ?? '';
        ghc[String(g.id)] = g.hr_comment         ?? '';
        gd[String(g.id)]  = g.document_ref     ?? '';
      });
      setGoalEmpScores(ges);
      setGoalSupScores(gss);
      setGoalHrScores(ghs);
      setGoalActualResults(gar);
      setGoalComments(gc);
      setGoalSupComments(gsc);
      setGoalHrComments(ghc);
      setGoalDocRefs(gd);

      // Pre-fill competency ratings
      const cr: Record<string, any> = {};
      (rev.ratings ?? []).forEach((r: any) => {
        cr[String(r.competency_id)] = {
          self_rating:        r.self_rating        ?? 0,
          supervisor_rating:  r.supervisor_rating  ?? 0,
          hr_rating:          r.hr_rating          ?? 0,
          self_comment:       r.self_comment        ?? '',
          supervisor_comment: r.supervisor_comment  ?? '',
          hr_comment:         r.hr_comment          ?? '',
        };
      });
      setCompRatings(cr);
    } catch { toast.error('Failed to load review'); }
    finally { setLoading(false); }
  }, [reviewId]);

  useEffect(() => { load(); }, [load]);

  // Save competency ratings helper
  const saveRatings = async (reviewIdStr: string) => {
    const ratings = Object.entries(compRatings).map(([competency_id, v]) => ({ competency_id, ...v }));
    if (ratings.length) {
      await api.post(`/performance/reviews/${reviewIdStr}/ratings`, { ratings });
    }
  };

  const saveGoalScores = async (empScores: Record<string,string>, supScores: Record<string,string>, hrScores: Record<string,string>) => {
    const allIds = new Set([...Object.keys(empScores), ...Object.keys(supScores), ...Object.keys(hrScores)]);
    for (const goalId of allIds) {
      const es  = empScores[goalId];
      const ss  = supScores[goalId];
      const hs  = hrScores[goalId];
      const ar  = goalActualResults[goalId] ?? '';
      const cmt = goalComments[goalId] ?? '';
      const scmt = goalSupComments[goalId] ?? '';
      const hcmt = goalHrComments[goalId] ?? '';
      const payload: any = {};
      if (es  !== undefined) payload.employee_score   = es  !== '' ? parseFloat(es)  : null;
      if (ss  !== undefined) payload.supervisor_score = ss  !== '' ? parseFloat(ss)  : null;
      if (hs  !== undefined) payload.hr_score         = hs  !== '' ? parseFloat(hs)  : null;
      if (ar  !== undefined) payload.actual_result    = ar  || null;
      if (cmt !== undefined) payload.comment          = cmt || null;
      payload.supervisor_comment = scmt || null;
      payload.hr_comment         = hcmt || null;
      if (Object.keys(payload).length) {
        await api.put(`/performance/goals/${goalId}`, payload)
          .catch((err: any) => toast.error(err?.response?.data?.message ?? `Failed to save goal score`));
      }
    }
  };

  const submitSelf = async () => {
    setSaving(true);
    try {
      await api.post(`/performance/reviews/${reviewId}/self`, {
        self_score: calcSelfScore ?? null,
        self_comments: selfComments,
      });
      await saveRatings(reviewId);
      await saveGoalScores(goalEmpScores, {}, {});
      toast.success('Self assessment submitted');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  const submitSupervisor = async () => {
    setSaving(true);
    try {
      await api.post(`/performance/reviews/${reviewId}/supervisor`, {
        supervisor_score: calcSupScore ?? null,
        supervisor_comments: supComments,
        strengths, improvements,
      });
      await saveRatings(reviewId);
      await saveGoalScores({}, goalSupScores, {});
      toast.success('Supervisor review submitted');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  const submitHR = async () => {
    setSaving(true);
    try {
      const parts = [calcSelfScore, calcSupScore, calcHrScore].filter((v): v is number => v != null);
      const finalOverall = parts.length ? parseFloat((parts.reduce((a, b) => a + b, 0) / parts.length).toFixed(2)) : null;
      await api.post(`/performance/reviews/${reviewId}/hr`, {
        hr_score:         calcHrScore   ?? null,
        hr_comments:      hrComments,
        overall_score:    finalOverall,
        development_plan: developmentPlan,
      });
      await saveRatings(reviewId);
      await saveGoalScores({}, {}, goalHrScores);
      toast.success('Review completed');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
    finally { setSaving(false); }
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const body: any = {};
      if (mode === 'employee') {
        body.self_score    = calcSelfScore ?? null;
        body.self_comments = selfComments || null;
      } else if (mode === 'supervisor') {
        body.supervisor_score    = calcSupScore ?? null;
        body.supervisor_comments = supComments || null;
        body.strengths    = strengths    || null;
        body.improvements = improvements || null;
      } else if (mode === 'hr') {
        body.hr_score         = calcHrScore  ?? null;
        body.hr_comments      = hrComments   || null;
        body.development_plan = developmentPlan || null;
      }
      await api.put(`/performance/reviews/${reviewId}`, body);
      await saveRatings(reviewId);
      await saveGoalScores(
        mode === 'employee'   ? goalEmpScores : {},
        mode === 'supervisor' ? goalSupScores : {},
        mode === 'hr'         ? goalHrScores  : {},
      );
      toast.success('Draft saved — you can continue later');
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save draft'); }
    finally { setSaving(false); }
  };

  const statusIdx = review ? (STATUS_IDX[review.status] ?? 0) : 0;

  // Overdue warning — computed from current date vs due dates relative to active stage
  const overdueMsg = useMemo(() => {
    if (!review) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const past = (d: string | null | undefined) => !!d && new Date(d) < today;
    if ((statusIdx === 0 || statusIdx === 1) && past(review.self_due))       return `Self-assessment was due ${fmtDate(review.self_due)} — overdue`;
    if (statusIdx === 2                       && past(review.supervisor_due)) return `Supervisor review was due ${fmtDate(review.supervisor_due)} — overdue`;
    if (statusIdx === 3                       && past(review.hr_due))         return `HR sign-off was due ${fmtDate(review.hr_due)} — overdue`;
    return null;
  }, [review, statusIdx]);

  // Auto-calculate stage scores from goal scores
  const calcStars = useCallback((scores: Record<string, string>, goals: any[]): number | null => {
    const weighted = goals.filter((g: any) => Number(g.weight) > 0);
    if (!weighted.length) return null;
    const totalWeight = weighted.reduce((s: number, g: any) => s + Number(g.weight), 0);
    if (!totalWeight) return null;
    const totalScore = weighted.reduce((s: number, g: any) => s + (parseFloat(scores[String(g.id)] || '0') || 0), 0);
    return parseFloat(((totalScore / totalWeight) * 5).toFixed(2));
  }, []);

  const calcSelfScore = useMemo(() => calcStars(goalEmpScores, review?.goals ?? []), [calcStars, goalEmpScores, review?.goals]);
  const calcSupScore  = useMemo(() => calcStars(goalSupScores, review?.goals ?? []), [calcStars, goalSupScores, review?.goals]);
  const calcHrScore   = useMemo(() => calcStars(goalHrScores,  review?.goals ?? []), [calcStars, goalHrScores,  review?.goals]);
  const hasWeightedGoals = useMemo(() => (review?.goals ?? []).some((g: any) => Number(g.weight) > 0), [review?.goals]);

  // Competency helpers
  const setCompField = (compId: string, field: string, val: any) => {
    setCompRatings(prev => ({
      ...prev,
      [compId]: { ...(prev[compId] ?? {}), [field]: val },
    }));
  };

  // Group competencies by category
  const groupedRatings = review ? (() => {
    const groups: Record<string, any[]> = {};
    (review.ratings ?? []).forEach((r: any) => {
      const cat = r.category ?? 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    });
    return groups;
  })() : {};

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-[860px] bg-[var(--surface)] h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0 bg-[var(--bg)]">
          <div className="min-w-0">
            {review && (
              <>
                <p className="font-bold text-[15px] text-[var(--text-primary)] truncate">{review.employee?.name ?? '—'}</p>
                <p className="text-[12px] text-[var(--text-muted)]">
                  {review.cycle_name ?? '—'}
                  {review.employee?.employee_id ? ` · ${review.employee.employee_id}` : ''}
                </p>
              </>
            )}
          </div>
          {review && (
            <span className={`pill text-[11px] ${STATUS_COLOR[review.status] ?? ''}`}>{review.status}</span>
          )}
          <button onClick={onClose} className="ml-4 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="animate-spin text-[var(--accent)]" size={28} />
          </div>
        ) : !review ? (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">Review not found</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">

            {/* Status stepper */}
            <div className="flex justify-center py-2 overflow-x-auto">
              <StatusStepper status={review.status} />
            </div>

            {/* Due dates */}
            {(review.self_due || review.supervisor_due || review.hr_due) && (
              <div className="flex flex-wrap gap-4 text-[12px] text-[var(--text-muted)] px-1">
                {review.self_due       && <span>Self due: <strong className="text-[var(--text-primary)]">{fmtDate(review.self_due)}</strong></span>}
                {review.supervisor_due && <span>Supervisor due: <strong className="text-[var(--text-primary)]">{fmtDate(review.supervisor_due)}</strong></span>}
                {review.hr_due         && <span>HR due: <strong className="text-[var(--text-primary)]">{fmtDate(review.hr_due)}</strong></span>}
              </div>
            )}

            {/* Overdue warning */}
            {overdueMsg && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-[8px] px-4 py-3 text-[12.5px] text-red-700 font-medium">
                <AlertTriangle size={14} className="shrink-0" /> {overdueMsg}
              </div>
            )}

            {/* ── Stage 1: Self Assessment ─────────────────────────── */}
            <Section title="Stage 1 — Self Assessment" locked={false} defaultExpanded={statusIdx <= 1}>
              <div className="flex flex-col gap-4">
                {hasWeightedGoals && (
                  <div>
                    <label className="label mb-1">Self Score <span className="text-[var(--text-muted)] font-normal text-[11px]">(calculated from goals)</span></label>
                    {calcSelfScore != null
                      ? <StarPicker value={calcSelfScore} onChange={() => {}} readonly allowHalf colorOverride={calcScoreColor(calcSelfScore) ?? undefined} />
                      : <p className="text-[12.5px] text-[var(--text-muted)]">Score all goals to see your rating</p>
                    }
                  </div>
                )}
                <div>
                  <label className="label">Comments</label>
                  <CountedTextarea className={ta} rows={3} value={selfComments}
                    readOnly={mode !== 'employee' || statusIdx !== 0}
                    onChange={e => setSelfComments(e.target.value)}
                    placeholder="Describe your achievements and areas you worked on…"
                    maxChars={1000} />
                </div>

                {/* Goals */}
                {(review.goals ?? []).length > 0 && (
                  <div>
                    <label className="label mb-2">Goals</label>
                    <div className="flex flex-col gap-3">
                      {(review.goals ?? []).map((g: any) => {
                        const gId = String(g.id);
                        const canEmpEdit = mode === 'employee'   && statusIdx === 0;
                        const canSupEdit = mode === 'supervisor' && statusIdx === 1;
                        const canHrEdit  = mode === 'hr'         && statusIdx === 2 && !readOnly;
                        const empScore   = goalEmpScores[gId]     ?? '';
                        const supScore   = goalSupScores[gId]     ?? '';
                        const hrScore    = goalHrScores[gId]      ?? '';
                        const maxPts     = g.weight ?? 100;

                        return (
                          <div key={g.id} className="border border-[var(--border)] rounded-[10px] overflow-hidden">
                            {/* Goal header */}
                            <div className="px-4 py-3 bg-[var(--bg)] flex flex-col gap-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">{g.title}</p>
                                {g.document_ref && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewDoc(g.document_ref)}
                                    className="shrink-0 flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline mt-0.5"
                                    title="Preview supporting document"
                                  >
                                    <Paperclip size={12} /> Doc
                                  </button>
                                )}
                              </div>
                              {/* Meta row */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--text-muted)]">
                                {g.target     && <span>Target: <strong className="text-[var(--text-primary)]">{g.target}</strong></span>}
                                {g.weight != null && <span>Max: <strong className="text-[var(--text-primary)]">{g.weight} pts</strong></span>}
                                {g.due_date    && (
                                  <span className="flex items-center gap-1">
                                    <Calendar size={10} /> Goal due: <strong className="text-[var(--text-primary)]">{fmtDate(g.due_date)}</strong>
                                  </span>
                                )}
                                {g.cycle_self_due && (
                                  <span className="flex items-center gap-1 text-amber-600 font-medium">
                                    <Calendar size={10} /> Cycle self-due: <strong>{fmtDate(g.cycle_self_due)}</strong>
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Scores + Actual Result + Document + Comment */}
                            <div className="px-4 py-3 border-t border-[var(--border)] flex flex-col gap-3">
                              {/* Employee section */}
                              <div className="flex flex-col gap-2">
                                <div className="grid grid-cols-2 gap-3 items-start">
                                  {/* Employee Score */}
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Your Score</span>
                                    <ScoreDisplay val={empScore} maxPts={maxPts} canEdit={canEmpEdit}
                                      setter={v => setGoalEmpScores(prev => ({ ...prev, [gId]: v }))} />
                                  </div>

                                  {/* Supporting Document */}
                                  <div className="flex flex-col gap-1">
                                    <span className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Supporting Doc</span>
                                    {goalDocRefs[gId] ? (
                                      <div className="flex flex-wrap items-center gap-2">
                                        <button type="button" onClick={() => setPreviewDoc(goalDocRefs[gId])}
                                          className="flex items-center gap-1.5 text-[12px] text-[var(--accent)] hover:underline">
                                          <Paperclip size={12} /> Preview
                                        </button>
                                        {canEmpEdit && (
                                          <label className="flex items-center gap-1 text-[11.5px] text-amber-600 cursor-pointer hover:underline">
                                            <RotateCcw size={11} /> Replace
                                            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                                              disabled={goalDocUploading[gId]}
                                              onChange={async e => {
                                                const file = e.target.files?.[0]; if (!file) return;
                                                setGoalDocUploading(prev => ({ ...prev, [gId]: true }));
                                                try {
                                                  const fd = new FormData(); fd.append('file', file);
                                                  const r = await api.post(`/performance/goals/${g.id}/document`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                                                  setGoalDocRefs(prev => ({ ...prev, [gId]: r.data.data?.document_ref ?? '' }));
                                                  toast.success('Document replaced');
                                                } catch { toast.error('Upload failed'); }
                                                finally { setGoalDocUploading(prev => ({ ...prev, [gId]: false })); e.target.value = ''; }
                                              }} />
                                          </label>
                                        )}
                                        {goalDocUploading[gId] && <Loader2 size={12} className="animate-spin text-[var(--accent)]" />}
                                      </div>
                                    ) : canEmpEdit ? (
                                      <label className={`inline-flex items-center gap-1.5 border border-dashed border-[var(--border)] rounded-[7px] px-2.5 py-1.5 cursor-pointer hover:border-[var(--accent)] transition-colors bg-[var(--bg)] text-[11.5px] text-[var(--text-muted)] ${goalDocUploading[gId] ? 'opacity-60 pointer-events-none' : ''}`}>
                                        {goalDocUploading[gId] ? <Loader2 size={12} className="animate-spin text-[var(--accent)] shrink-0" /> : <Upload size={12} className="shrink-0" />}
                                        {goalDocUploading[gId] ? 'Uploading…' : 'Attach file'}
                                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                                          disabled={goalDocUploading[gId]}
                                          onChange={async e => {
                                            const file = e.target.files?.[0]; if (!file) return;
                                            setGoalDocUploading(prev => ({ ...prev, [gId]: true }));
                                            try {
                                              const fd = new FormData(); fd.append('file', file);
                                              const r = await api.post(`/performance/goals/${g.id}/document`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                                              setGoalDocRefs(prev => ({ ...prev, [gId]: r.data.data?.document_ref ?? '' }));
                                              toast.success('Document attached');
                                            } catch { toast.error('Upload failed'); }
                                            finally { setGoalDocUploading(prev => ({ ...prev, [gId]: false })); e.target.value = ''; }
                                          }} />
                                      </label>
                                    ) : (
                                      <p className="text-[12px] text-[var(--text-muted)] italic">None</p>
                                    )}
                                  </div>
                                </div>

                                {/* Your Comment */}
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Your Comment</span>
                                  {canEmpEdit ? (
                                    <CountedTextarea
                                      className="border border-[var(--border)] rounded-[7px] px-3 py-2 text-[12.5px] bg-[var(--surface)] resize-y w-full focus:outline-none focus:border-[var(--accent)]"
                                      rows={2} maxChars={300}
                                      placeholder="Add your comment on this goal…"
                                      value={goalComments[gId] ?? ''}
                                      onChange={e => setGoalComments(prev => ({ ...prev, [gId]: e.target.value }))}
                                    />
                                  ) : goalComments[gId] ? (
                                    <p className="text-[12.5px] text-[var(--text-primary)]">{goalComments[gId]}</p>
                                  ) : (
                                    <p className="text-[12px] text-[var(--text-muted)] italic">No comment</p>
                                  )}
                                </div>
                              </div>

                              {/* Supervisor score row */}
                              {(mode === 'supervisor' || mode === 'hr') && (
                                <div className="flex flex-col gap-1 pt-2 border-t border-[var(--border)]">
                                  <span className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Supervisor Score</span>
                                  <ScoreDisplay val={supScore} maxPts={maxPts} canEdit={canSupEdit}
                                    setter={v => setGoalSupScores(prev => ({ ...prev, [gId]: v }))} />
                                </div>
                              )}

                              {/* Supervisor comment */}
                              {(mode === 'supervisor' || mode === 'hr') && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Supervisor Comment</span>
                                  {canSupEdit ? (
                                    <CountedTextarea
                                      className="border border-[var(--border)] rounded-[7px] px-3 py-2 text-[12.5px] bg-[var(--surface)] resize-y w-full focus:outline-none focus:border-[var(--accent)]"
                                      rows={2} maxChars={300}
                                      placeholder="Add your comment on this goal…"
                                      value={goalSupComments[gId] ?? ''}
                                      onChange={e => setGoalSupComments(prev => ({ ...prev, [gId]: e.target.value }))}
                                    />
                                  ) : goalSupComments[gId] ? (
                                    <p className="text-[12.5px] text-[var(--text-primary)]">{goalSupComments[gId]}</p>
                                  ) : (
                                    <p className="text-[12px] text-[var(--text-muted)] italic">No comment</p>
                                  )}
                                </div>
                              )}

                              {/* HR score row */}
                              {mode === 'hr' && (
                                <div className="flex flex-col gap-1 pt-2 border-t border-[var(--border)]">
                                  <span className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">HR Score</span>
                                  <ScoreDisplay val={hrScore} maxPts={maxPts} canEdit={canHrEdit}
                                    setter={v => setGoalHrScores(prev => ({ ...prev, [gId]: v }))} />
                                </div>
                              )}

                              {/* HR comment */}
                              {mode === 'hr' && (
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">HR Comment</span>
                                  {canHrEdit ? (
                                    <CountedTextarea
                                      className="border border-[var(--border)] rounded-[7px] px-3 py-2 text-[12.5px] bg-[var(--surface)] resize-y w-full focus:outline-none focus:border-[var(--accent)]"
                                      rows={2} maxChars={300}
                                      placeholder="Add your comment on this goal…"
                                      value={goalHrComments[gId] ?? ''}
                                      onChange={e => setGoalHrComments(prev => ({ ...prev, [gId]: e.target.value }))}
                                    />
                                  ) : goalHrComments[gId] ? (
                                    <p className="text-[12.5px] text-[var(--text-primary)]">{goalHrComments[gId]}</p>
                                  ) : (
                                    <p className="text-[12px] text-[var(--text-muted)] italic">No comment</p>
                                  )}
                                </div>
                              )}

                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Competency ratings */}
                {Object.keys(groupedRatings).length > 0 && (
                  <div className="flex flex-col gap-4">
                    <label className="label">Competency Ratings</label>
                    {Object.entries(groupedRatings).map(([cat, items]) => (
                      <div key={cat} className="flex flex-col gap-2">
                        {/* Category bar */}
                        <div className="flex items-center gap-2">
                          <div className="h-px flex-1 bg-[var(--border)]" />
                          <span className="text-[10.5px] font-bold uppercase tracking-widest text-[var(--accent)] px-2 shrink-0">{cat}</span>
                          <div className="h-px flex-1 bg-[var(--border)]" />
                        </div>
                        {/* Competency cards */}
                        <div className="flex flex-col gap-2">
                          {items.map((r: any) => {
                            const cr = compRatings[String(r.competency_id)] ?? {};
                            return (
                              <CompetencyCard key={r.competency_id} n={r.competency_name}
                                selfRating={cr.self_rating} supRating={cr.supervisor_rating} hrRating={cr.hr_rating}
                                selfComment={cr.self_comment} supComment={cr.supervisor_comment} hrComment={cr.hr_comment}
                                mode={mode} reviewStatus={review.status}
                                onSelfChange={(v: number) => setCompField(String(r.competency_id), 'self_rating', v)}
                                onSupChange={(v: number)  => setCompField(String(r.competency_id), 'supervisor_rating', v)}
                                onHrChange={(v: number)   => setCompField(String(r.competency_id), 'hr_rating', v)}
                                onSelfComment={(v: string) => setCompField(String(r.competency_id), 'self_comment', v)}
                                onSupComment={(v: string)  => setCompField(String(r.competency_id), 'supervisor_comment', v)}
                                onHrComment={(v: string)   => setCompField(String(r.competency_id), 'hr_comment', v)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {mode === 'employee' && statusIdx === 0 && (
                  <div className="flex items-center gap-2">
                    <button onClick={saveDraft} disabled={saving} className="secondary-btn flex items-center gap-1.5">
                      {saving && <Loader2 size={13} className="animate-spin" />} <Save size={13} /> Save Draft
                    </button>
                    <button onClick={() => setConfirmAction('self')} disabled={saving} className="primary-btn flex items-center gap-1.5">
                      Submit Self Assessment
                    </button>
                  </div>
                )}
                {statusIdx > 0 && review.self_submitted && (
                  <p className="text-[11.5px] text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={13} /> Submitted {fmtDate(review.self_submitted)}
                  </p>
                )}
              </div>
            </Section>

            {/* ── Stage 2: Supervisor Review ───────────────────────── */}
            <Section title="Stage 2 — Supervisor Review" locked={statusIdx < 1} defaultExpanded={statusIdx === 1 || statusIdx === 2}>
              <div className="flex flex-col gap-4">
                {hasWeightedGoals && (
                  <div>
                    <label className="label mb-1">Supervisor Score <span className="text-[var(--text-muted)] font-normal text-[11px]">(calculated from goals)</span></label>
                    {calcSupScore != null
                      ? <StarPicker value={calcSupScore} onChange={() => {}} readonly allowHalf colorOverride={calcScoreColor(calcSupScore) ?? undefined} />
                      : <p className="text-[12.5px] text-[var(--text-muted)]">Score all goals to see the rating</p>
                    }
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="label">Supervisor Comments</label>
                    {mode === 'supervisor' && statusIdx === 1 && (
                      <DraftWithAI
                        kind="review_feedback"
                        maxChars={1000}
                        getContext={() => `Performance review feedback for ${review?.employee?.name ?? 'the employee'}${calcSupScore ? `, overall score ${calcSupScore}/5` : ''}. Strengths: ${strengths || 'not specified'}. Areas for improvement: ${improvements || 'not specified'}.`}
                        onText={setSupComments}
                      />
                    )}
                  </div>
                  <CountedTextarea className={ta} rows={3} value={supComments}
                    readOnly={mode !== 'supervisor' || statusIdx !== 1}
                    onChange={e => setSupComments(e.target.value)}
                    placeholder="Your overall assessment of the employee's performance…"
                    maxChars={1000} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Strengths</label>
                    <CountedTextarea className={ta} rows={2} value={strengths}
                      readOnly={mode !== 'supervisor' || statusIdx !== 1}
                      onChange={e => setStrengths(e.target.value)}
                      placeholder="Key strengths observed…"
                      maxChars={500} />
                  </div>
                  <div>
                    <label className="label">Areas for Improvement</label>
                    <CountedTextarea className={ta} rows={2} value={improvements}
                      readOnly={mode !== 'supervisor' || statusIdx !== 1}
                      onChange={e => setImprovements(e.target.value)}
                      placeholder="Development areas…"
                      maxChars={500} />
                  </div>
                </div>

                {mode === 'supervisor' && statusIdx === 1 && (
                  <div className="flex items-center gap-2">
                    <button onClick={saveDraft} disabled={saving} className="secondary-btn flex items-center gap-1.5">
                      {saving && <Loader2 size={13} className="animate-spin" />} <Save size={13} /> Save Draft
                    </button>
                    <button onClick={() => setConfirmAction('supervisor')} disabled={saving} className="primary-btn flex items-center gap-1.5">
                      Submit to HR
                    </button>
                  </div>
                )}
                {statusIdx > 1 && review.supervisor_reviewed && (
                  <p className="text-[11.5px] text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={13} /> Submitted {fmtDate(review.supervisor_reviewed)}
                    {review.supervisor?.name && ` by ${review.supervisor.name}`}
                  </p>
                )}
              </div>
            </Section>

            {/* ── Stage 3: HR Sign-off ─────────────────────────────── */}
            <Section title="Stage 3 — HR Final Sign-off" locked={statusIdx < 2} defaultExpanded={statusIdx >= 2}>
              <div className="flex flex-col gap-4">
                {hasWeightedGoals && (
                  <div>
                    <label className="label mb-1">HR Score <span className="text-[var(--text-muted)] font-normal text-[11px]">(calculated from goals)</span></label>
                    {calcHrScore != null
                      ? <StarPicker value={calcHrScore} onChange={() => {}} readonly allowHalf colorOverride={calcScoreColor(calcHrScore) ?? undefined} />
                      : <p className="text-[12.5px] text-[var(--text-muted)]">Score all goals to see the rating</p>
                    }
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="label">HR Comments</label>
                    {mode === 'hr' && statusIdx === 2 && !readOnly && (
                      <DraftWithAI
                        kind="review_feedback"
                        maxChars={1000}
                        getContext={() => `HR final review comments for ${review?.employee?.name ?? 'the employee'}${calcHrScore ? `, overall score ${calcHrScore}/5` : ''}. Supervisor notes: ${supComments || 'none'}. Strengths: ${strengths || 'none'}. Areas for improvement: ${improvements || 'none'}.`}
                        onText={setHrComments}
                      />
                    )}
                  </div>
                  <CountedTextarea className={ta} rows={2} value={hrComments}
                    readOnly={readOnly || mode !== 'hr' || statusIdx < 2 || statusIdx === 4}
                    onChange={e => setHrComments(e.target.value)}
                    placeholder="Final HR observations…"
                    maxChars={1000} />
                </div>
                {hasWeightedGoals && (() => {
                  const parts = [calcSelfScore, calcSupScore, calcHrScore].filter((v): v is number => v != null);
                  const overallCalc = parts.length ? parseFloat((parts.reduce((a, b) => a + b, 0) / parts.length).toFixed(2)) : null;
                  return (
                    <div>
                      <label className="label mb-1">Overall Score <span className="text-[var(--text-muted)] font-normal text-[11px]">(average of all stages)</span></label>
                      {overallCalc != null
                        ? <StarPicker value={overallCalc} onChange={() => {}} readonly allowHalf colorOverride={calcScoreColor(overallCalc) ?? undefined} />
                        : <p className="text-[12.5px] text-[var(--text-muted)]">Complete all stages to see overall score</p>
                      }
                    </div>
                  );
                })()}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="label">Development Plan</label>
                    {mode === 'hr' && statusIdx === 2 && !readOnly && (
                      <DraftWithAI
                        kind="development_plan"
                        maxChars={2000}
                        getContext={() => `Development plan for ${review?.employee?.name ?? 'the employee'}. Strengths: ${strengths || 'none'}. Areas for improvement: ${improvements || 'none'}. HR comments: ${hrComments || 'none'}.`}
                        onText={setDevelopmentPlan}
                      />
                    )}
                  </div>
                  <CountedTextarea className={ta} rows={3} value={developmentPlan}
                    readOnly={readOnly || mode !== 'hr' || statusIdx < 2 || statusIdx === 4}
                    onChange={e => setDevelopmentPlan(e.target.value)}
                    placeholder="Training, mentoring, and growth objectives…"
                    maxChars={2000} />
                </div>

                {mode === 'hr' && statusIdx === 2 && !readOnly && (
                  <div className="flex items-center gap-2">
                    <button onClick={saveDraft} disabled={saving} className="secondary-btn flex items-center gap-1.5">
                      {saving && <Loader2 size={13} className="animate-spin" />} <Save size={13} /> Save Draft
                    </button>
                    <button onClick={() => setConfirmAction('hr')} disabled={saving} className="primary-btn flex items-center gap-1.5">
                      Complete Review
                    </button>
                  </div>
                )}
                {statusIdx === 4 && review.hr_reviewed && (
                  <p className="text-[11.5px] text-emerald-600 font-medium flex items-center gap-1">
                    <CheckCircle2 size={13} /> Completed {fmtDate(review.hr_reviewed)}
                  </p>
                )}
              </div>
            </Section>

          </div>
        )}
      </div>

      {previewDoc && <DocPreviewModal filename={previewDoc} onClose={() => setPreviewDoc(null)} />}

      {confirmAction && (
        <ConfirmModal
          variant="warning"
          title={
            confirmAction === 'self'       ? 'Submit self-assessment?' :
            confirmAction === 'supervisor' ? 'Submit supervisor review?' :
                                             'Complete this review?'
          }
          message="This action cannot be undone. The next stage will be unlocked for the next reviewer."
          confirmLabel={
            confirmAction === 'self'       ? 'Submit' :
            confirmAction === 'supervisor' ? 'Submit to HR' :
                                             'Complete Review'
          }
          onConfirm={() => {
            const fn = confirmAction === 'self' ? submitSelf
                     : confirmAction === 'supervisor' ? submitSupervisor
                     : submitHR;
            setConfirmAction(null);
            fn();
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
