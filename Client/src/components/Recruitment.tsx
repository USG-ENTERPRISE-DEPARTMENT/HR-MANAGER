import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Plus, Eye, Trash2, FileEdit, Copy, Send, Loader2, Save, Mail, ChevronDown, X, Briefcase, Users, FileText, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { RowActions } from './ui/RowActions';
import { FormField, inputClass } from './ui/FormField';
import { SearchSelect } from './ui/SearchSelect';
import { CountedTextarea } from './ui/CountedTextarea';
import { DetailSlideOver } from './ui/DetailSlideOver';
import { JobForm } from './JobForm';
import { JobDetails } from './JobDetails';
import { CandidateForm } from './CandidateForm';
import { CandidateDetails } from './CandidateDetails';
import { InterviewForm } from './InterviewForm';
import api from '../../lib/api';
import { useCan } from '@/hooks/useCan';

// ── Pipeline stage helpers ────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  Short_Listed: 'bg-blue-50 text-blue-700 border border-blue-200',
  Phone_Screen: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  Assessment:   'bg-amber-50 text-amber-700 border border-amber-200',
  Interview:    'bg-purple-50 text-purple-700 border border-purple-200',
  Hired:        'pill-success',
  Rejected:     'pill-danger',
  Archived:     'bg-slate-100 text-slate-500 border border-slate-200',
};

const STAGE_LABEL: Record<string, string> = {
  Short_Listed: 'Short Listed',
  Phone_Screen: 'Phone Screen',
  Assessment:   'Assessment',
  Interview:    'Interview',
  Hired:        'Hired',
  Rejected:     'Rejected',
  Archived:     'Archived',
};

function StagePill({ type }: { type?: string | null }) {
  if (!type) return <span className="pill bg-slate-100 text-slate-400 border border-slate-200">—</span>;
  return <span className={`pill ${STAGE_COLORS[type] ?? 'bg-slate-100 text-slate-500'}`}>{STAGE_LABEL[type] ?? type}</span>;
}

function JobStatusPill({ status }: { status?: string | null }) {
  const cls =
    status === 'Active'  ? 'pill-success' :
    status === 'Closed'  ? 'pill-danger'  :
    status === 'On Hold' ? 'pill-warning' : '';
  return <span className={`pill ${cls}`}>{status ?? '—'}</span>;
}

function OutcomePill({ outcome }: { outcome?: string | null }) {
  if (!outcome) return <span className="text-[var(--text-muted)]">—</span>;
  const cls = outcome === 'Passed' ? 'pill-success' : outcome === 'Failed' ? 'pill-danger' : 'pill-warning';
  return <span className={`pill ${cls}`}>{outcome}</span>;
}

// ── Interview details slide-over ───────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">{children}</p>;
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 w-24 pt-0.5 leading-snug">{label}</span>
      <span className="text-[13px] text-[var(--text-primary)] flex-1 leading-relaxed">{value || '—'}</span>
    </div>
  );
}

function InterviewDetails({ interview, candidate, job, pipeline, canManage = true, onClose, onSaveOutcome, onMoveStage, onSendLink, onSendInvite, onViewCandidate, onScheduleNextRound, onRefresh }: any) {
  const [status,        setStatus]        = useState<string>(interview.status   ?? 'Scheduled');
  const [outcome,       setOutcome]       = useState<string>(interview.outcome  ?? '');
  const [feedback,      setFeedback]      = useState<string>(interview.feedback ?? '');
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [movingStage,   setMovingStage]   = useState<string | null>(null);
  const [sendingLink,   setSendingLink]   = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [outcomeSaved,  setOutcomeSaved]  = useState<{ status: string; outcome: string } | null>(
    interview.status === 'Completed' || interview.status === 'Cancelled' || interview.status === 'No Show'
      ? { status: interview.status, outcome: interview.outcome ?? '' }
      : null
  );

  const currentStage    = String(candidate?.hiringStage ?? '');
  const currentStageObj = pipeline.find((s: any) => String(s.id) === currentStage);
  const isHired         = currentStageObj?.type === 'Hired';
  const currentStageIdx = pipeline.findIndex((s: any) => String(s.id) === currentStage);
  const nextStage       = pipeline.find((s: any, idx: number) =>
    idx > currentStageIdx && !['Hired', 'Rejected', 'Archived'].includes(s.type ?? '')
  );
  const rejectedStage   = pipeline.find((s: any) => s.type === 'Rejected');

  const isConfirmed = interview.scheduleUpdated === 1 || interview.scheduleUpdated === '1';
  const statusLabel = interview.status === 'Completed' ? 'Completed'
    : interview.status === 'Cancelled' ? 'Cancelled'
    : interview.status === 'No Show'   ? 'No Show'
    : isConfirmed ? 'Confirmed' : 'Scheduled';

  const handleSaveOutcome = async () => {
    setSavingOutcome(true);
    await onSaveOutcome({ status, outcome, feedback });
    setSavingOutcome(false);
    setOutcomeSaved({ status, outcome });
  };

  const handleMoveStage = async (stageId: string) => {
    setMovingStage(stageId);
    try { await onMoveStage(interview.candidate, stageId); } finally { setMovingStage(null); }
  };

  return (
    <DetailSlideOver
      open
      title={candidate ? `${candidate.first_name} ${candidate.last_name}` : 'Interview Details'}
      subtitle={job?.title ?? ''}
      onClose={onClose}
      maxWidth="xl"
      footerActions={(() => {
        if (isHired || !canManage) return undefined;
        const hasSlots = (() => { try { return JSON.parse(interview.schedule_options || '[]').length > 0; } catch { return false; } })();
        if (hasSlots && !interview.scheduled) {
          const sentAt = interview.schedule_link_sent_at ? new Date(interview.schedule_link_sent_at) : null;
          return (
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-center gap-2">
                <button
                  className="secondary-btn flex items-center gap-1.5"
                  onClick={async () => { setSendingLink(true); try { await onSendLink(); await onRefresh?.(); } finally { setSendingLink(false); } }}
                  disabled={sendingLink}
                  title="Emails the candidate a link to pick their interview slot"
                >
                  {sendingLink ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {sendingLink ? 'Sending…' : 'Send Scheduling Link'}
                </button>
                <span className="text-[11px] text-amber-600 flex items-center gap-1">
                  <Mail size={11} /> Emails the candidate
                </span>
              </div>
              {sentAt && (
                <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                  ✓ Last sent {sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {sentAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          );
        }
        if (interview.scheduled) {
          const sentAt = interview.invite_sent_at ? new Date(interview.invite_sent_at) : null;
          return (
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-center gap-2">
                <button
                  className="secondary-btn flex items-center gap-1.5"
                  onClick={async () => { setSendingInvite(true); try { await onSendInvite(); await onRefresh?.(); } finally { setSendingInvite(false); } }}
                  disabled={sendingInvite}
                  title="Sends interview details and calendar invite to all parties"
                >
                  {sendingInvite ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {sendingInvite ? 'Sending…' : 'Send Interview Invite'}
                </button>
                <span className="text-[11px] text-amber-600 flex items-center gap-1">
                  <Mail size={11} /> Candidate, hiring manager & interviewers
                </span>
              </div>
              {sentAt && (
                <p className="text-[11px] text-emerald-600 flex items-center gap-1">
                  ✓ Last sent {sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {sentAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          );
        }
        return undefined;
      })()}
    >
      <div className="flex flex-col gap-6">

        {/* Interview info */}
        <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
          <InfoRow label="Round"        value={interview.level} />
          <InfoRow label="Status"       value={statusLabel} />
          <InfoRow label="Date"         value={interview.scheduled ? new Date(interview.scheduled).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : null} />
          <InfoRow label="Time"         value={
            interview.scheduled
              ? interview.scheduled_end
                ? `${new Date(interview.scheduled).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} – ${new Date(interview.scheduled_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                : new Date(interview.scheduled).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              : null
          } />
          <InfoRow label="Location"     value={interview.location} />
          <InfoRow label="Interviewers" value={interview.interviewers} />
          {interview.notes && <InfoRow label="Notes" value={interview.notes} />}
        </div>

        {/* Pipeline stage */}
        <div>
          <SectionLabel>Pipeline Stage</SectionLabel>
          {isHired ? (
            <p className="text-[11px] text-emerald-600 flex items-center gap-1 mb-3 -mt-1 font-semibold">
              Candidate is hired — stage is locked.
            </p>
          ) : canManage ? (
            <p className="text-[11px] text-amber-600 flex items-center gap-1 mb-3 -mt-1">
              <Mail size={11} /> Changing the stage sends an email notification to the candidate.
            </p>
          ) : null}
          {pipeline.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic">No pipeline stages configured.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {pipeline.map((stage: any) => {
                const isActive = String(stage.id) === currentStage;
                const isMoving = movingStage === String(stage.id);
                return (isHired || !canManage) ? (
                  <span key={stage.id}
                    className={[
                      'text-[11px] font-semibold px-3 py-1.5 rounded-full border',
                      isActive
                        ? `${STAGE_COLORS[stage.type ?? ''] ?? 'bg-blue-50 text-blue-700 border-blue-200'} ring-2 ring-[var(--accent)] ring-offset-1`
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] opacity-40',
                    ].join(' ')}
                  >
                    {STAGE_LABEL[stage.type ?? ''] ?? stage.name}
                  </span>
                ) : (
                  <button key={stage.id} type="button"
                    onClick={() => !isActive && handleMoveStage(String(stage.id))}
                    disabled={!!movingStage}
                    className={[
                      'text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-all',
                      isActive
                        ? `${STAGE_COLORS[stage.type ?? ''] ?? 'bg-blue-50 text-blue-700 border-blue-200'} ring-2 ring-[var(--accent)] ring-offset-1 cursor-default`
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer',
                      movingStage ? 'opacity-60' : '',
                    ].join(' ')}
                  >
                    {isMoving ? <Loader2 size={11} className="animate-spin inline" /> : (STAGE_LABEL[stage.type ?? ''] ?? stage.name)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Record Outcome — locked once candidate is hired, or read-only without manage permission */}
        {(isHired || !canManage) ? (
          <div className="rounded-xl border border-[var(--border)] p-4 bg-[var(--surface-hover)]">
            <SectionLabel>Record Outcome</SectionLabel>
            <div className="flex flex-col gap-2 mt-1">
              {interview.status && (
                <p className="text-[13px] text-[var(--text-primary)]">
                  <span className="font-semibold">Status:</span> {interview.status}
                </p>
              )}
              {interview.outcome && (
                <p className="text-[13px] text-[var(--text-primary)]">
                  <span className="font-semibold">Outcome:</span> {interview.outcome}
                </p>
              )}
              {interview.feedback && (
                <p className="text-[13px] text-[var(--text-secondary)] italic mt-1">{interview.feedback}</p>
              )}
              {isHired && <p className="text-[11px] text-[var(--text-muted)] mt-1">Locked — candidate has been hired.</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] p-4 flex flex-col gap-4">
            <SectionLabel>Record Outcome</SectionLabel>
            <FormField label="Interview Status">
              <SearchSelect
                value={status}
                onChange={v => { setStatus(v); setOutcomeSaved(null); }}
                options={['Scheduled', 'Completed', 'Cancelled', 'No Show'].map(s => ({ id: s, label: s }))}
              />
            </FormField>
            {status === 'Completed' && (
              <FormField label="Outcome">
                <SearchSelect
                  value={outcome}
                  onChange={v => { setOutcome(v); setOutcomeSaved(null); }}
                  options={[{ id: 'Passed', label: 'Passed' }, { id: 'Failed', label: 'Failed' }, { id: 'Pending', label: 'Pending Decision' }]}
                  placeholder="Select…"
                />
              </FormField>
            )}
            <FormField label="Feedback / Notes">
              <CountedTextarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={4} maxChars={1000} className={inputClass} placeholder="Optional notes…" />
            </FormField>
            <button type="button" className="primary-btn self-end flex items-center gap-1.5"
              onClick={handleSaveOutcome} disabled={savingOutcome}>
              {savingOutcome ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save Outcome
            </button>
          </div>
        )}

        {/* What's next — shown after outcome is saved */}
        {outcomeSaved && outcomeSaved.status !== 'Scheduled' && (
          <div className="rounded-xl border-2 border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] p-4 flex flex-col gap-3">
            <p className="text-[12px] font-bold text-[var(--accent)] uppercase tracking-widest">What's next?</p>

            {outcomeSaved.status === 'Completed' && outcomeSaved.outcome === 'Passed' && (
              <div className="flex flex-col gap-2">
                {isHired ? (
                  candidate?.hired_employee_id ? (
                    <p className="text-[13px] text-emerald-600 font-semibold">
                      Employee record has been created. View them in the Employees section.
                    </p>
                  ) : (
                    <>
                      <p className="text-[13px] text-[var(--text-primary)]">
                        Candidate is hired! Open their profile to convert them to an employee record.
                      </p>
                      <button type="button" className="secondary-btn self-start" onClick={onViewCandidate}>
                        Open Candidate Profile
                      </button>
                    </>
                  )
                ) : (
                  <>
                    <p className="text-[13px] text-[var(--text-primary)]">Candidate passed. Advance their application:</p>
                    <div className="flex flex-wrap gap-2">
                      {nextStage && (
                        <button type="button"
                          className="primary-btn flex items-center gap-1.5"
                          onClick={() => handleMoveStage(String(nextStage.id))}
                          disabled={!!movingStage}
                          title="Sends an email notification to the candidate"
                        >
                          {movingStage === String(nextStage.id) ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                          Move to {STAGE_LABEL[nextStage.type ?? ''] ?? nextStage.name}
                        </button>
                      )}
                      <button type="button" className="secondary-btn flex items-center gap-1.5"
                        onClick={onScheduleNextRound}>
                        Schedule Next Round
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {(outcomeSaved.status === 'Completed' && outcomeSaved.outcome === 'Failed') ||
             outcomeSaved.status === 'No Show' ? (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-[var(--text-primary)]">
                  {outcomeSaved.status === 'No Show' ? 'Candidate did not show up.' : 'Candidate did not pass.'} Mark their application:
                </p>
                {rejectedStage && (
                  <button type="button"
                    className="danger-btn flex items-center gap-1.5 self-start"
                    onClick={() => handleMoveStage(String(rejectedStage.id))}
                    disabled={!!movingStage}
                    title="Sends an email notification to the candidate"
                  >
                    {movingStage === String(rejectedStage.id) ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                    Mark as Rejected
                  </button>
                )}
              </div>
            ) : null}

            {outcomeSaved.status === 'Completed' && outcomeSaved.outcome === 'Pending' && (
              <p className="text-[13px] text-[var(--text-muted)]">Decision pending — no action required yet.</p>
            )}

            {outcomeSaved.status === 'Cancelled' && (
              <p className="text-[13px] text-[var(--text-muted)]">Interview cancelled. Edit the interview to reschedule or send a new scheduling link.</p>
            )}
          </div>
        )}

      </div>
    </DetailSlideOver>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { label: 'Jobs',         icon: Briefcase },
  { label: 'Candidates',   icon: Users     },
  { label: 'Applications', icon: FileText  },
  { label: 'Interviews',   icon: Calendar  },
];

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <tr>
      <td colSpan={cols} className="td text-center py-12 text-[var(--text-muted)]">{label}</td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Recruitment({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const { can } = useCan();
  // Per-tab action permissions — view_recruitment only reveals the page + tabs (read-only).
  const canJobs         = can('manage_jobs');
  const canCandidates   = can('manage_candidates');
  const canApplications = can('manage_applications');
  const canInterviews   = can('manage_interviews');
  const [activeTab, setActiveTab] = useState('Jobs');
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(10);

  const [jobs, setJobs]               = useState<any[]>([]);
  const [candidates, setCandidates]   = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [interviews, setInterviews]   = useState<any[]>([]);
  const [pipeline, setPipeline]       = useState<any[]>([]);
  const [employees, setEmployees]     = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);

  const [collapsedGroups, setCollapsedGroups]       = useState<Set<string>>(new Set());
  const [viewingApplication, setViewingApplication] = useState<any | null>(null);
  const [cvUrl, setCvUrl]                           = useState<string | null>(null);

  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const [showJobForm, setShowJobForm]             = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [showInterviewForm, setShowInterviewForm] = useState(false);
  const [editTarget, setEditTarget]               = useState<any | null>(null);
  const [jobFormSeed, setJobFormSeed]             = useState<any | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<any>(null);
  const [selectedJobId, setSelectedJobId]         = useState<any>(null);
  const [interviewDetailTarget, setInterviewDetailTarget] = useState<any | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [jRes, cRes, aRes, iRes, pRes, eRes] = await Promise.all([
        api.get('/recruitment/jobs'),
        api.get('/recruitment/candidates'),
        api.get('/recruitment/applications'),
        api.get('/recruitment/interviews'),
        api.get('/recruitment/pipeline'),
        api.get('/employees/active'),
      ]);
      setJobs(jRes.data.data         ?? []);
      setCandidates(cRes.data.data   ?? []);
      setApplications(aRes.data.data ?? []);
      setInterviews(iRes.data.data   ?? []);
      setPipeline(pRes.data.data     ?? []);
      setEmployees(eRes.data.data    ?? eRes.data ?? []);
    } catch {
      toast.error('Failed to load recruitment data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { setPage(1); }, [search, activeTab]);

  // ── Derived maps ──────────────────────────────────────────────────────────

  const stageMap = useMemo(() => {
    const m: Record<string, any> = {};
    pipeline.forEach(p => { m[String(p.id)] = p; });
    return m;
  }, [pipeline]);

  const jobMap = useMemo(() => {
    const m: Record<string, any> = {};
    jobs.forEach(j => { m[String(j.id)] = j; });
    return m;
  }, [jobs]);

  const candidateMap = useMemo(() => {
    const m: Record<string, any> = {};
    candidates.forEach(c => { m[String(c.id)] = c; });
    return m;
  }, [candidates]);

  // ── Filtered rows ─────────────────────────────────────────────────────────

  const q = search.toLowerCase();

  const filteredJobs = useMemo(() =>
    jobs.filter(j => !q || j.title?.toLowerCase().includes(q) || j.department?.toLowerCase().includes(q)),
    [jobs, q]);

  const filteredCandidates = useMemo(() =>
    candidates.filter(c =>
      !q ||
      c.first_name?.toLowerCase().includes(q) ||
      c.last_name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    ),
    [candidates, q]);

  const filteredApplications = useMemo(() =>
    applications.filter(a => {
      const cand = candidateMap[String(a.candidate)];
      const job  = jobMap[String(a.job)];
      return !q || cand?.first_name?.toLowerCase().includes(q) || cand?.last_name?.toLowerCase().includes(q) || job?.title?.toLowerCase().includes(q);
    }),
    [applications, q, candidateMap, jobMap]);

  const filteredInterviews = useMemo(() =>
    interviews.filter(i => {
      const cand = candidateMap[String(i.candidate)];
      const job  = jobMap[String(i.job)];
      return !q || cand?.first_name?.toLowerCase().includes(q) || cand?.last_name?.toLowerCase().includes(q) || job?.title?.toLowerCase().includes(q) || i.level?.toLowerCase().includes(q);
    }),
    [interviews, q, candidateMap, jobMap]);

  // Group paginated interviews by candidate for the Interviews tab
  const groupedInterviews = useMemo(() => {
    const paged = paginate(filteredInterviews);
    const seen = new Map<string, { cand: any; rows: any[] }>();
    paged.forEach(iv => {
      const key = String(iv.candidate);
      if (!seen.has(key)) seen.set(key, { cand: candidateMap[key], rows: [] });
      seen.get(key)!.rows.push(iv);
    });
    return Array.from(seen.values());
  }, [filteredInterviews, candidateMap, page, pageSize]);

  function paginate<T>(arr: T[]) {
    const start = (page - 1) * pageSize;
    return arr.slice(start, start + pageSize);
  }

  // ── CRUD handlers ─────────────────────────────────────────────────────────

  const saveJob = async (data: any) => {
    try {
      if (editTarget) { await api.put(`/recruitment/jobs/${editTarget.id}`, data); toast.success('Job updated'); }
      else            { await api.post('/recruitment/jobs', data);                  toast.success('Job created'); }
      setShowJobForm(false); setEditTarget(null); fetchAll();
    } catch { toast.error('Failed to save job'); }
  };

  const deleteJob = async (id: any) => {
    try { await api.delete(`/recruitment/jobs/${id}`); toast.success('Job deleted'); fetchAll(); }
    catch { toast.error('Failed to delete job'); }
  };

  const duplicateJob = (job: any) => {
    const { id, created, updated, code, ...rest } = job;
    setJobFormSeed({ ...rest, title: `${rest.title} (Copy)`, status: 'On Hold' });
    setEditTarget(null);
    setShowJobForm(true);
  };

  const saveCandidate = async (data: any) => {
    try {
      if (editTarget) { await api.put(`/recruitment/candidates/${editTarget.id}`, data); toast.success('Candidate updated'); }
      else            { await api.post('/recruitment/candidates', data);                   toast.success('Candidate added'); }
      setShowCandidateForm(false); setEditTarget(null); fetchAll();
    } catch { toast.error('Failed to save candidate'); }
  };

  const deleteCandidate = async (id: any) => {
    try { await api.delete(`/recruitment/candidates/${id}`); toast.success('Candidate deleted'); fetchAll(); }
    catch { toast.error('Failed to delete candidate'); }
  };

  const saveInterview = async (data: any) => {
    try {
      if (editTarget?.id) {
        await api.put(`/recruitment/interviews/${editTarget.id}`, data);
        toast.success('Interview updated');
      } else if (Array.isArray(data.candidates) && data.candidates.length > 0) {
        const { candidates: ids, ...rest } = data;
        await Promise.all(ids.map((cid: string) => api.post('/recruitment/interviews', { ...rest, candidate: cid })));
        toast.success(`${ids.length} interview${ids.length > 1 ? 's' : ''} scheduled`);
      } else {
        await api.post('/recruitment/interviews', data);
        toast.success('Interview scheduled');
      }
      setShowInterviewForm(false); setEditTarget(null); fetchAll();
    } catch { toast.error('Failed to save interview'); }
  };

  const scheduleNextRound = (interview: any) => {
    const existingRounds = interviews.filter(
      iv => String(iv.candidate) === String(interview.candidate) && String(iv.job) === String(interview.job)
    ).length;
    setInterviewDetailTarget(null);
    // Seed with job + candidate but no id → saveInterview will POST (create new)
    setEditTarget({ job: interview.job, candidate: interview.candidate, level: `Round ${existingRounds + 1}`, status: 'Scheduled' });
    setShowInterviewForm(true);
  };

  const sendScheduleLink = async (id: any) => {
    try {
      await api.post(`/recruitment/interviews/${id}/send-schedule-link`);
      toast.success('Scheduling link sent to candidate');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to send scheduling link');
    }
  };

  const sendInvite = async (id: any) => {
    try {
      await api.post(`/recruitment/interviews/${id}/send-invite`);
      toast.success('Interview invite sent to all parties');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to send invite');
    }
  };

  const saveOutcome = async (data: any) => {
    try {
      await api.put(`/recruitment/interviews/${interviewDetailTarget.id}`, data);
      toast.success('Outcome recorded');
      fetchAll();
    } catch { toast.error('Failed to save outcome'); }
  };

  const moveStageFromInterview = async (candidateId: any, stageId: string) => {
    try {
      await api.put(`/recruitment/candidates/${candidateId}/stage`, { stageId });
      toast.success('Stage updated — candidate notified by email.');
      fetchAll();
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to update stage';
      toast.error(msg, { duration: 6000 });
      fetchAll();
      throw err;
    }
  };

  const deleteInterview = async (id: any) => {
    try { await api.delete(`/recruitment/interviews/${id}`); toast.success('Interview deleted'); fetchAll(); }
    catch { toast.error('Failed to delete interview'); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const ROW_ANIM = { initial: { opacity: 0, x: -6 }, animate: { opacity: 1, x: 0 } };

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Recruitment" subtitle="Manage job postings, candidates, and interviews." />

      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4">
        {TABS.map(({ label, icon: Icon }) => (
          <button key={label} onClick={() => setActiveTab(label)}
            className={`tab-btn flex items-center gap-1.5 ${activeTab === label ? 'active' : ''}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col min-h-0 flex-1">

        {/* ── JOBS ──────────────────────────────────────────────────────────── */}
        {activeTab === 'Jobs' && (
          <>
            <TableToolbar
              searchQuery={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search jobs..."
              actions={
                canJobs ? (<button className="primary-btn" onClick={() => { setEditTarget(null); setShowJobForm(true); }}>
                  <Plus size={14} /> Add Job
                </button>) : undefined
              }
            />
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th">Title</th>
                    <th className="th">Department</th>
                    <th className="th">Status</th>
                    <th className="th">Closing Date</th>
                    <th className="th text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="td text-center py-12 text-[var(--text-muted)]">Loading…</td></tr>
                  ) : filteredJobs.length === 0 ? (
                    <EmptyRow cols={5} label="No job postings yet." />
                  ) : paginate(filteredJobs).map((job, i) => (
                    <motion.tr key={job.id} className="tr" {...ROW_ANIM} transition={{ delay: i * 0.03 }}>
                      <td className="td font-medium text-[var(--text-primary)]">{job.title}</td>
                      <td className="td">{job.department ?? '—'}</td>
                      <td className="td"><JobStatusPill status={job.status} /></td>
                      <td className="td">{job.closingDate ? new Date(job.closingDate).toLocaleDateString() : '—'}</td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View', icon: Eye, onClick: () => setSelectedJobId(job.id) },
                            { label: 'Edit', icon: FileEdit, onClick: () => { setEditTarget(job); setShowJobForm(true); }, hidden: !canJobs },
                            { label: 'Duplicate', icon: Copy, onClick: () => duplicateJob(job), hidden: !canJobs },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteJob(job.id), hidden: !canJobs },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} pageSize={pageSize} total={jobs.length} filtered={filteredJobs.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}

        {/* ── CANDIDATES ────────────────────────────────────────────────────── */}
        {activeTab === 'Candidates' && (
          <>
            <TableToolbar
              searchQuery={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search candidates..."
              actions={
                <div className="flex items-center gap-2">
                  <button className="secondary-btn" onClick={fetchAll} title="Refresh">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    Refresh
                  </button>
                  {canCandidates && <button className="primary-btn" onClick={() => { setEditTarget(null); setShowCandidateForm(true); }}>
                    <Plus size={14} /> Add Candidate
                  </button>}
                </div>
              }
            />
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th w-10"><span className="sr-only">Avatar</span></th>
                    <th className="th">Name</th>
                    <th className="th">Email</th>
                    <th className="th">Phone</th>
                    <th className="th">Stage</th>
                    <th className="th">Source</th>
                    <th className="th text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="td text-center py-12 text-[var(--text-muted)]">Loading…</td></tr>
                  ) : filteredCandidates.length === 0 ? (
                    <EmptyRow cols={7} label="No candidates yet." />
                  ) : paginate(filteredCandidates).map((c, i) => (
                    <motion.tr key={c.id} className="tr" {...ROW_ANIM} transition={{ delay: i * 0.03 }}>
                      <td className="td">
                        <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center shrink-0">
                          <span className="font-bold text-[13px] text-[var(--accent)]">
                            {c.first_name?.charAt(0)?.toUpperCase() ?? '?'}
                          </span>
                        </div>
                      </td>
                      <td className="td font-medium text-[var(--text-primary)]">{c.first_name} {c.last_name}</td>
                      <td className="td text-[var(--text-muted)]">{c.email ?? '—'}</td>
                      <td className="td">{c.mobile_phone ?? '—'}</td>
                      <td className="td"><StagePill type={stageMap[String(c.hiringStage)]?.type} /></td>
                      <td className="td">
                        <span className="pill pill-accent text-[11px]">{c.source ?? 'Sourced'}</span>
                      </td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View Profile', icon: Eye, onClick: () => setSelectedCandidateId(c.id) },
                            { label: 'Edit', icon: FileEdit, onClick: () => { setEditTarget(c); setShowCandidateForm(true); }, hidden: !canCandidates },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteCandidate(c.id), hidden: !canCandidates },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} pageSize={pageSize} total={candidates.length} filtered={filteredCandidates.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}

        {/* ── APPLICATIONS ──────────────────────────────────────────────────── */}
        {activeTab === 'Applications' && (
          <>
            <TableToolbar searchQuery={search} onSearchChange={setSearch} searchPlaceholder="Search applications..." />
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th">Candidate</th>
                    <th className="th">Job</th>
                    <th className="th">Date Applied</th>
                    <th className="th">Cover Letter</th>
                    <th className="th text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={5} className="td text-center py-12 text-[var(--text-muted)]">Loading…</td></tr>
                  ) : filteredApplications.length === 0 ? (
                    <EmptyRow cols={5} label="No applications on file." />
                  ) : paginate(filteredApplications).map((a, i) => {
                    const cand = candidateMap[String(a.candidate)];
                    const job  = jobMap[String(a.job)];
                    return (
                      <motion.tr key={a.id} className="tr" {...ROW_ANIM} transition={{ delay: i * 0.03 }}>
                        <td className="td font-medium text-[var(--text-primary)]">
                          {cand ? `${cand.first_name} ${cand.last_name}` : `#${a.candidate}`}
                        </td>
                        <td className="td">{job?.title ?? `#${a.job}`}</td>
                        <td className="td">{a.created ? new Date(a.created).toLocaleDateString() : '—'}</td>
                        <td className="td text-[var(--text-muted)] max-w-[200px] truncate text-xs">{a.notes ? a.notes.slice(0, 80) + (a.notes.length > 80 ? '…' : '') : '—'}</td>
                        <td className="td">
                          <div className="flex justify-end">
                            <RowActions actions={[
                              { label: 'View Details', icon: Eye, onClick: () => setViewingApplication(a) },
                              { label: 'Remove Application', icon: Trash2, danger: true, hidden: !canApplications,
                                onClick: async () => {
                                  try { await api.delete(`/recruitment/applications/${a.id}`); toast.success('Application removed'); fetchAll(); }
                                  catch { toast.error('Failed to delete'); }
                                } },
                            ]} />
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} pageSize={pageSize} total={applications.length} filtered={filteredApplications.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}

        {/* ── INTERVIEWS ────────────────────────────────────────────────────── */}
        {activeTab === 'Interviews' && (
          <>
            <TableToolbar
              searchQuery={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search interviews..."
              actions={
                canInterviews ? (<button className="primary-btn" onClick={() => { setEditTarget(null); setShowInterviewForm(true); }}>
                  <Plus size={14} /> Schedule Interview
                </button>) : undefined
              }
            />
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th">Job</th>
                    <th className="th">Round</th>
                    <th className="th">Scheduled</th>
                    <th className="th">Status</th>
                    <th className="th">Outcome</th>
                    <th className="th text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="td text-center py-12 text-[var(--text-muted)]">Loading…</td></tr>
                  ) : filteredInterviews.length === 0 ? (
                    <EmptyRow cols={6} label="No interviews scheduled." />
                  ) : groupedInterviews.map(({ cand, rows }) => {
                    const groupKey = String(cand?.id ?? rows[0]?.candidate);
                    const isCollapsed = collapsedGroups.has(groupKey);
                    return (
                    <React.Fragment key={groupKey}>
                      {/* Candidate group header — click to collapse/expand */}
                      <tr
                        className="bg-[var(--surface-hover)] cursor-pointer select-none hover:bg-[color-mix(in_srgb,var(--accent)_4%,var(--surface-hover))]"
                        onClick={() => toggleGroup(groupKey)}
                      >
                        <td colSpan={6} className="px-4 py-2.5 border-b border-[var(--border)]">
                          <div className="flex items-center gap-2">
                            <ChevronDown
                              size={14}
                              className="text-[var(--text-muted)] shrink-0 transition-transform duration-150"
                              style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                            />
                            <span className="font-semibold text-[13px] text-[var(--text-primary)]">
                              {cand ? `${cand.first_name} ${cand.last_name}` : '—'}
                            </span>
                            <StagePill type={stageMap[String(cand?.hiringStage)]?.type} />
                            <span className="ml-auto text-[11px] text-[var(--text-muted)]">
                              {rows.length} {rows.length === 1 ? 'interview' : 'interviews'}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {/* Interview rows — hidden when collapsed */}
                      {!isCollapsed && rows.map((iv, i) => {
                        const job = jobMap[String(iv.job)];
                        const isConfirmed = iv.scheduleUpdated === 1 || iv.scheduleUpdated === '1';
                        const isTerminal  = ['Completed', 'Cancelled', 'No Show'].includes(iv.status ?? '');
                        const isOverdue   = !!iv.scheduled && !isTerminal && new Date(iv.scheduled) < new Date();
                        const statusLabel =
                          iv.status === 'Completed' ? 'Completed' :
                          iv.status === 'Cancelled' ? 'Cancelled' :
                          iv.status === 'No Show'   ? 'No Show'   :
                          isConfirmed               ? 'Confirmed' : 'Scheduled';
                        const statusCls =
                          iv.status === 'Completed' ? 'pill-success' :
                          iv.status === 'Cancelled' ? 'pill-danger'  :
                          iv.status === 'No Show'   ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                          isConfirmed               ? 'bg-teal-50 text-teal-700 border border-teal-200' :
                          'pill-warning';
                        const accentColor =
                          iv.status === 'Completed' ? '#10b981' :
                          iv.status === 'Cancelled' ? '#ef4444' :
                          iv.status === 'No Show'   ? '#f97316' :
                          isConfirmed               ? '#14b8a6' : '#f59e0b';
                        return (
                          <motion.tr key={iv.id} className="tr" style={{ boxShadow: `inset 3px 0 0 ${accentColor}` }} {...ROW_ANIM} transition={{ delay: i * 0.02 }}>
                            <td className="td text-[var(--text-secondary)]">{job?.title ?? '—'}</td>
                            <td className="td">
                              <span className="block text-[13px]">{iv.level ?? '—'}</span>
                              {iv.interviewers && (
                                <span className="block text-[11px] text-[var(--text-muted)] mt-0.5 truncate max-w-[160px]">{iv.interviewers}</span>
                              )}
                            </td>
                            <td className="td">
                              {iv.scheduled ? (
                                <span>
                                  <span className={`block text-[13px]${isOverdue ? ' text-red-600 font-semibold' : ''}`}>
                                    {new Date(iv.scheduled).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </span>
                                  <span className="block text-[11px] text-[var(--text-muted)]">
                                    {new Date(iv.scheduled).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                    {iv.scheduled_end ? ` – ${new Date(iv.scheduled_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : ''}
                                  </span>
                                  {isOverdue && <span className="pill bg-red-50 text-red-600 border border-red-200 text-[10px] mt-0.5 inline-flex">Overdue</span>}
                                </span>
                              ) : (
                                <span className="pill bg-slate-100 text-slate-400 border border-slate-200 text-[11px]">Not scheduled</span>
                              )}
                            </td>
                            <td className="td"><span className={`pill ${statusCls}`}>{statusLabel}</span></td>
                            <td className="td">
                              {iv.status === 'Completed' ? <OutcomePill outcome={iv.outcome} /> : <span className="text-[var(--text-muted)]">—</span>}
                            </td>
                            <td className="td">
                              <div className="flex justify-end">
                                <RowActions actions={[
                                  { label: 'View Details', icon: Eye, onClick: () => setInterviewDetailTarget(iv) },
                                  { label: 'Edit Interview', icon: FileEdit, onClick: () => { setEditTarget(iv); setShowInterviewForm(true); }, hidden: !canInterviews },
                                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteInterview(iv.id), hidden: !canInterviews },
                                ]} />
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </React.Fragment>
                  );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} pageSize={pageSize} total={interviews.length} filtered={filteredInterviews.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}

      {showJobForm && (
        <JobForm
          key={editTarget?.id ?? (jobFormSeed ? 'duplicate' : 'new')}
          initialData={editTarget ?? jobFormSeed}
          isDuplicate={!editTarget && !!jobFormSeed}
          onClose={() => { setShowJobForm(false); setEditTarget(null); setJobFormSeed(null); }}
          onSave={saveJob}
        />
      )}

      {showCandidateForm && (
        <CandidateForm
          key={editTarget?.id ?? 'new'}
          initialData={editTarget}
          jobs={jobs}
          onClose={() => { setShowCandidateForm(false); setEditTarget(null); }}
          onSave={saveCandidate}
        />
      )}

      {showInterviewForm && (
        <InterviewForm
          key={editTarget?.id ?? 'new'}
          initialData={editTarget}
          candidates={candidates}
          jobs={jobs}
          interviews={interviews}
          employees={employees}
          onClose={() => { setShowInterviewForm(false); setEditTarget(null); }}
          onSave={saveInterview}
        />
      )}

      {selectedCandidateId != null && (
        <CandidateDetails
          candidateId={selectedCandidateId}
          onClose={() => setSelectedCandidateId(null)}
          onRefresh={fetchAll}
          onHired={() => {
            setSelectedCandidateId(null);
            onNavigate?.('Employees');
          }}
        />
      )}

      {interviewDetailTarget && (() => {
        const liveInterview = interviews.find(iv => String(iv.id) === String(interviewDetailTarget.id)) ?? interviewDetailTarget;
        return (
          <InterviewDetails
            interview={liveInterview}
            candidate={candidateMap[String(liveInterview.candidate)]}
            job={jobMap[String(liveInterview.job)]}
            pipeline={pipeline}
            canManage={canInterviews}
            onClose={() => setInterviewDetailTarget(null)}
            onSaveOutcome={saveOutcome}
            onMoveStage={moveStageFromInterview}
            onSendLink={() => sendScheduleLink(liveInterview.id)}
            onSendInvite={() => sendInvite(liveInterview.id)}
            onRefresh={fetchAll}
            onViewCandidate={() => { setInterviewDetailTarget(null); setSelectedCandidateId(liveInterview.candidate); }}
            onScheduleNextRound={() => scheduleNextRound(liveInterview)}
          />
        );
      })()}

      {selectedJobId != null && (() => {
        const job = jobMap[String(selectedJobId)];
        if (!job) return null;
        const count = candidates.filter(c => String(c.jobId) === String(selectedJobId)).length;
        return (
          <JobDetails
            job={job}
            candidateCount={count}
            onClose={() => setSelectedJobId(null)}
            onEdit={() => { setSelectedJobId(null); setEditTarget(job); setShowJobForm(true); }}
          />
        );
      })()}

      {/* ── Application Details Modal ──────────────────────────────────── */}
      {viewingApplication && (() => {
        const cand = candidateMap[String(viewingApplication.candidate)];
        const job  = jobMap[String(viewingApplication.job)];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
                <div>
                  <h2 className="text-[16px] font-bold text-[var(--text-primary)]">
                    {cand ? `${cand.first_name} ${cand.last_name}` : '—'}
                  </h2>
                  <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{job?.title ?? '—'} · Applied {viewingApplication.created ? new Date(viewingApplication.created).toLocaleDateString() : '—'}</p>
                </div>
                <button onClick={() => setViewingApplication(null)} className="p-1.5 rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
                  <X size={16} className="text-[var(--text-muted)]" />
                </button>
              </div>
              {/* Body */}
              <div className="overflow-y-auto flex-1 p-6 space-y-6">
                {/* Cover letter */}
                <div>
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Cover Letter</p>
                  {viewingApplication.notes ? (
                    <p className="text-[14px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">{viewingApplication.notes}</p>
                  ) : (
                    <p className="text-[13px] text-[var(--text-muted)] italic">No cover letter provided.</p>
                  )}
                </div>
                {/* CV */}
                {cand?.cv_file && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">CV / Resume</p>
                      <button
                        onClick={() => setCvUrl(`/v1/api/hr/documents/${cand.cv_file}`)}
                        className="flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"
                      >
                        <Briefcase size={12} /> Open Full Screen
                      </button>
                    </div>
                    <iframe
                      src={`/v1/api/hr/documents/${cand.cv_file}`}
                      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-hover)]"
                      style={{ height: 420 }}
                      title="Candidate CV"
                    />
                  </div>
                )}
                {!cand?.cv_file && (
                  <div>
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">CV / Resume</p>
                    <p className="text-[13px] text-[var(--text-muted)] italic">No CV on file.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── CV Full-Screen Modal ───────────────────────────────────────── */}
      {cvUrl && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-sm">
          <div className="flex items-center justify-between px-5 py-3 bg-[var(--surface)] border-b border-[var(--border)] shrink-0">
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">CV Preview</p>
            <button onClick={() => setCvUrl(null)} className="p-1.5 rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
              <X size={16} className="text-[var(--text-muted)]" />
            </button>
          </div>
          <iframe src={cvUrl} className="flex-1 w-full" title="CV Full Screen" />
        </div>
      )}
    </div>
  );
}
