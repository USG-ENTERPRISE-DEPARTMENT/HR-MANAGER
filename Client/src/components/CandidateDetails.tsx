import { useState, useEffect, useCallback } from 'react';
import {
  UserCheck, Loader2, CalendarClock, Send, CheckCircle2,
  Mail, Phone, MapPin, Briefcase, Star, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { DetailSlideOver } from './ui/DetailSlideOver';
import api from '../../lib/api';
import { useCan } from '@/hooks/useCan';

// ── Stage helpers ─────────────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return (
    <div className="w-16 h-16 rounded-full flex items-center justify-center shrink-0"
      style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}>
      <span className="text-[22px] font-bold text-[var(--accent)]">{initials}</span>
    </div>
  );
}

function InfoChip({ icon: Icon, value }: { icon: any; value?: string | null }) {
  if (!value) return null;
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] px-2.5 py-1 rounded-full bg-[var(--surface-hover)] border border-[var(--border)]">
      <Icon size={11} className="shrink-0 text-[var(--text-muted)]" />
      {value}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">{children}</p>
  );
}

function ProfileRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
      <span className="text-[13px] text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

const DETAIL_TABS = ['Profile', 'Applications', 'Interviews', 'Notes'];

interface Props {
  candidateId: string | number;
  onClose: () => void;
  onHired?: () => void;
  onRefresh?: () => void;
}

export function CandidateDetails({ candidateId, onClose, onHired, onRefresh }: Props) {
  const { can } = useCan();
  const canManage = can('manage_candidates');
  const [data, setData]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState('Profile');
  const [movingStage,   setMovingStage]   = useState<string | null>(null);
  const [hiring,        setHiring]        = useState(false);
  const [sendingLink,   setSendingLink]   = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState<string | null>(null);
  const [cvUrl,         setCvUrl]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/recruitment/candidates/${candidateId}`);
      setData(res.data.data ?? res.data);
    } catch {
      toast.error('Failed to load candidate');
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { load(); }, [load]);

  const moveToStage = async (stageId: string) => {
    setMovingStage(stageId);
    try {
      await api.put(`/recruitment/candidates/${candidateId}/stage`, { stageId });
      toast.success('Stage updated');
      await load();
      onRefresh?.();
    } catch {
      toast.error('Failed to update stage');
    } finally {
      setMovingStage(null);
    }
  };

  const handleHire = async () => {
    setHiring(true);
    try {
      await api.post(`/recruitment/candidates/${candidateId}/hire`);
      toast.success('Employee record created');
      await load();
      onRefresh?.();
      onHired?.();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to create employee record');
    } finally {
      setHiring(false);
    }
  };

  const handleSendScheduleLink = async (interviewId: any) => {
    setSendingLink(String(interviewId));
    try {
      await api.post(`/recruitment/interviews/${interviewId}/send-schedule-link`);
      toast.success('Scheduling link sent to candidate');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to send link');
    } finally {
      setSendingLink(null);
    }
  };

  const handleSendInvite = async (interviewId: any) => {
    setSendingInvite(String(interviewId));
    try {
      await api.post(`/recruitment/interviews/${interviewId}/send-invite`);
      toast.success('Interview invite sent to all parties');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to send invite');
    } finally {
      setSendingInvite(null);
    }
  };

  const currentStage = data?.pipeline?.find((p: any) => String(p.id) === String(data?.hiringStage));
  const name = data ? `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() : 'Loading…';

  return (
    <>
    {cvUrl && (
      <div className="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-5 py-3 bg-[var(--surface)] border-b border-[var(--border)] shrink-0">
          <p className="text-[13px] font-semibold text-[var(--text-primary)]">CV Preview</p>
          <button onClick={() => setCvUrl(null)} className="p-1.5 rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>
        <iframe src={cvUrl} className="flex-1 w-full" title="CV Preview" />
      </div>
    )}
    <DetailSlideOver
      open
      title=""
      onClose={onClose}
      maxWidth="2xl"
      footerActions={
        currentStage?.type === 'Hired' ? (
          data?.hired_employee_id ? (
            <span className="text-[13px] text-emerald-600 font-semibold flex items-center gap-1.5">
              <UserCheck size={14} /> Employee record created
            </span>
          ) : canManage ? (
            <button onClick={handleHire} disabled={hiring} className="primary-btn">
              {hiring ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
              Convert to Employee
            </button>
          ) : undefined
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
        </div>
      ) : (
        <div className="space-y-5">

          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-start gap-4">
            <Avatar name={name} />
            <div className="flex-1 min-w-0">
              <h2 className="text-[18px] font-bold text-[var(--text-primary)] leading-tight">{name}</h2>
              {data?.cv_title && (
                <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{data.cv_title}</p>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <InfoChip icon={Mail}  value={data?.email} />
                <InfoChip icon={Phone} value={data?.mobile_phone} />
                {data?.city && <InfoChip icon={MapPin} value={[data.city, data.country].filter(Boolean).join(', ')} />}
              </div>
              {data?.cv_file && (
                <button
                  onClick={() => setCvUrl(`/v1/api/hr/documents/${data.cv_file}`)}
                  className="inline-flex items-center gap-1.5 mt-2 text-[12px] font-semibold text-[var(--accent)] hover:underline"
                >
                  <Briefcase size={12} /> View CV
                </button>
              )}
            </div>
            {currentStage && (
              <span className={`pill text-[11px] shrink-0 mt-1 ${STAGE_COLORS[currentStage.type ?? ''] ?? ''}`}>
                {STAGE_LABEL[currentStage.type ?? ''] ?? currentStage.name}
              </span>
            )}
          </div>

          {/* ── Pipeline track ───────────────────────────────────────────── */}
          <div className="rounded-[12px] border border-[var(--border)] p-4 bg-[var(--surface-hover)]">
            <SectionLabel>Pipeline Stage</SectionLabel>
            {(currentStage?.type === 'Hired' || !canManage) ? (
              <div className="flex flex-wrap gap-1.5">
                {(data?.pipeline ?? []).map((stage: any) => {
                  const isActive = String(stage.id) === String(data?.hiringStage);
                  return (
                    <span
                      key={stage.id}
                      className={[
                        'text-[11px] font-semibold px-3 py-1.5 rounded-full border',
                        isActive
                          ? `${STAGE_COLORS[stage.type ?? ''] ?? 'bg-blue-50 text-blue-700 border-blue-200'} ring-2 ring-[var(--accent)] ring-offset-1`
                          : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] opacity-40',
                      ].join(' ')}
                    >
                      {STAGE_LABEL[stage.type ?? ''] ?? stage.name}
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(data?.pipeline ?? []).map((stage: any) => {
                  const isActive  = String(stage.id) === String(data?.hiringStage);
                  const isMoving  = movingStage === String(stage.id);
                  return (
                    <button
                      key={stage.id}
                      onClick={() => moveToStage(String(stage.id))}
                      disabled={!!movingStage || hiring}
                      className={[
                        'text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-all',
                        isActive
                          ? `${STAGE_COLORS[stage.type ?? ''] ?? 'bg-blue-50 text-blue-700 border-blue-200'} ring-2 ring-[var(--accent)] ring-offset-1`
                          : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      ].join(' ')}
                    >
                      {isMoving
                        ? <Loader2 size={11} className="animate-spin inline" />
                        : (STAGE_LABEL[stage.type ?? ''] ?? stage.name)
                      }
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Tabs ────────────────────────────────────────────────────── */}
          <div className="flex border-b border-[var(--border)]">
            {DETAIL_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  'px-4 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap border-b-2 -mb-px',
                  activeTab === tab
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                ].join(' ')}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* ── Profile ─────────────────────────────────────────────────── */}
          {activeTab === 'Profile' && (() => {
            const hasPersonal = data?.gender || data?.marital_status || data?.birthday || data?.country || data?.city || data?.address1;
            const hasStats    = data?.totalYearsOfExperience != null || data?.expectedSalary != null;
            if (!hasPersonal && !hasStats) {
              return <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">No profile details recorded.</div>;
            }
            return (
              <div className="rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
                {hasPersonal && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
                    <ProfileRow label="Gender"         value={data?.gender} />
                    <ProfileRow label="Marital Status" value={data?.marital_status} />
                    <ProfileRow label="Date of Birth"  value={data?.birthday ? new Date(data.birthday).toLocaleDateString() : null} />
                    <ProfileRow label="Country"        value={data?.country} />
                    <ProfileRow label="City"           value={data?.city} />
                    <ProfileRow label="Address"        value={data?.address1} />
                  </div>
                )}
                {hasStats && (
                  <div className={`grid gap-4 p-4 bg-[var(--surface-hover)] ${data?.totalYearsOfExperience != null && data?.expectedSalary != null ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {data?.totalYearsOfExperience != null && (
                      <div className="flex flex-col items-center gap-1 text-center">
                        <Briefcase size={16} className="text-[var(--accent)]" />
                        <span className="text-[15px] font-bold text-[var(--text-primary)]">
                          {data.totalYearsOfExperience}y {data.totalMonthsOfExperience ?? 0}m
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Experience</span>
                      </div>
                    )}
                    {data?.expectedSalary != null && (
                      <div className="flex flex-col items-center gap-1 text-center">
                        <Star size={16} className="text-[var(--accent)]" />
                        <span className="text-[15px] font-bold text-[var(--text-primary)]">
                          {Number(data.expectedSalary).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Expected Salary</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Applications ─────────────────────────────────────────────── */}
          {activeTab === 'Applications' && (
            <div className="space-y-2">
              {(data?.applications ?? []).length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">No applications on file.</div>
              ) : (data.applications ?? []).map((app: any) => (
                <div key={app.id} className="flex items-center justify-between gap-3 p-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-hover)]">
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">Application #{String(app.id)}</p>
                    {app.notes && <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{app.notes}</p>}
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)] shrink-0">
                    {app.created ? new Date(app.created).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── Interviews ───────────────────────────────────────────────── */}
          {activeTab === 'Interviews' && (
            <div className="space-y-3">
              {(data?.interviews ?? []).length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">No interviews scheduled.</div>
              ) : (data.interviews ?? []).map((iv: any) => {
                const statusColor =
                  iv.status === 'Completed' ? '#22c55e' :
                  iv.status === 'Cancelled' ? '#ef4444' : '#f59e0b';
                return (
                  <div key={iv.id} className="rounded-[12px] border border-[var(--border)] overflow-hidden">
                    {/* Coloured top bar */}
                    <div className="h-1" style={{ background: statusColor }} />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <p className="text-[14px] font-bold text-[var(--text-primary)]">{iv.level ?? 'Interview'}</p>
                          {iv.location && (
                            <p className="flex items-center gap-1 text-[12px] text-[var(--text-muted)] mt-0.5">
                              <MapPin size={11} /> {iv.location}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide font-semibold">Status</span>
                            <span className={`pill text-[11px] ${iv.status === 'Completed' ? 'pill-success' : iv.status === 'Cancelled' ? 'pill-danger' : 'pill-warning'}`}>
                              {iv.status ?? 'Scheduled'}
                            </span>
                          </div>
                          {iv.outcome && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide font-semibold">Outcome</span>
                              <span className={`pill text-[11px] ${iv.outcome === 'Passed' ? 'pill-success' : iv.outcome === 'Failed' ? 'pill-danger' : 'pill-warning'}`}>
                                {iv.outcome}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {iv.scheduled && (
                        <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] mb-2">
                          <CalendarClock size={12} className="text-[var(--accent)]" />
                          {new Date(iv.scheduled).toLocaleString()}
                        </p>
                      )}

                      {iv.feedback && (
                        <p className="text-[12px] text-[var(--text-secondary)] italic border-t border-[var(--border)] pt-2 mt-2">
                          {iv.feedback}
                        </p>
                      )}

                      {/* Scheduling / invite actions — hidden once candidate is hired */}
                      {(() => {
                        if (currentStage?.type === 'Hired') return null;
                        const hasSlots = (() => { try { return JSON.parse(iv.schedule_options || '[]').length > 0; } catch { return false; } })();
                        const isConfirmed = iv.scheduleUpdated === 1 || iv.scheduleUpdated === '1';

                        if (hasSlots && !iv.scheduled) {
                          // Slots defined but candidate hasn't picked yet
                          return (
                            <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex flex-col gap-1.5">
                              <button
                                onClick={() => handleSendScheduleLink(iv.id)}
                                disabled={sendingLink === String(iv.id)}
                                className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-50"
                              >
                                {sendingLink === String(iv.id) ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                Send Scheduling Link
                              </button>
                              <span className="flex items-center gap-1 text-[11px] text-amber-600">
                                <Mail size={11} /> Emails the candidate
                              </span>
                            </div>
                          );
                        }

                        if (iv.scheduled) {
                          // Date is confirmed — show invite button (+ badge if self-scheduled)
                          return (
                            <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex flex-col gap-1.5">
                              {isConfirmed && (
                                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 mb-1">
                                  <CheckCircle2 size={12} /> Slot confirmed by candidate
                                </span>
                              )}
                              <button
                                onClick={() => handleSendInvite(iv.id)}
                                disabled={sendingInvite === String(iv.id)}
                                className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-50"
                              >
                                {sendingInvite === String(iv.id) ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                Send Interview Invite
                              </button>
                              <span className="flex items-center gap-1 text-[11px] text-amber-600">
                                <Mail size={11} /> Candidate, hiring manager & interviewers
                              </span>
                            </div>
                          );
                        }

                        return null;
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Notes ───────────────────────────────────────────────────── */}
          {activeTab === 'Notes' && (
            data?.notes
              ? (
                <div className="rounded-[12px] border border-[var(--border)] p-4 bg-[var(--surface-hover)]">
                  <p className="text-[13px] text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">{data.notes}</p>
                </div>
              )
              : <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">No notes recorded.</div>
          )}
        </div>
      )}
    </DetailSlideOver>
    </>
  );
}
