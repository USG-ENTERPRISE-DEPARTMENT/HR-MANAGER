import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, X, Eye, Users, Banknote, RefreshCw, Check, XCircle, Stethoscope, FileText, Download, CalendarClock, Clock, ArrowRightLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import api from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { canAccessNav } from '../../lib/permissions';
import { PayrollReviewModal } from './PayrollReviewModal';
import { PageHeader } from './ui/PageHeader';
import { EmployeeChangeComparison } from './ui/EmployeeChangeComparison';
import { TransferChangeComparison } from './ui/TransferChangeComparison';

type ApprovalModule = 'Employee' | 'Employee Transfer' | 'Payroll' | 'Medical' | 'Leave';

// Safely extract a display string from a value that may be a plain string,
// a code-list-value object {label}, or a structure object {name}.
function toStr(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.label ?? v.name ?? '';
  return String(v);
}

interface ApprovalItem {
  id: string;
  module: ApprovalModule;
  title: string;
  subtitle: string;
  submittedAt: string | null;
  status: string;
  raw: any;
}

function StatusChip({ status }: { status: string }) {
  const s = status ?? '';
  let cls = 'pill text-[11px]';
  if (/pending/i.test(s))  cls += ' pill-warning';
  else if (/approved/i.test(s)) cls += ' pill-success';
  else if (/rejected/i.test(s)) cls += ' pill-danger';
  const label = s === 'PENDING' ? 'Pending' : s === 'APPROVED' ? 'Approved' : s === 'REJECTED' ? 'Rejected' : s;
  return <span className={cls}>{label}</span>;
}

function medicalGlError(record: any): string {
  try {
    const log = typeof record?.payment_log === 'string'
      ? JSON.parse(record.payment_log || '{}')
      : (record?.payment_log ?? {});
    const error = log?.error;
    if (error && typeof error === 'object') {
      return error.responseCode
        ? `[${error.responseCode}] ${error.message || ''}`.trim()
        : (error.message || JSON.stringify(error));
    }
    if (typeof error === 'string') return error;
  } catch {}
  return '';
}

function ModulePill({ module }: { module: ApprovalModule }) {
  if (module === 'Employee') return <span className="pill pill-accent text-[11px]"><Users size={10} className="inline mr-1" />Employee</span>;
  if (module === 'Payroll')  return <span className="pill pill-warning text-[11px]"><Banknote size={10} className="inline mr-1" />Payroll</span>;
  if (module === 'Leave')    return <span className="pill text-[11px] bg-purple-500/10 text-purple-700 border border-purple-200/50"><CalendarClock size={10} className="inline mr-1" />Leave</span>;
  if (module === 'Employee Transfer') return <span className="pill text-[11px] bg-blue-500/10 text-blue-700 border border-blue-200/50"><ArrowRightLeft size={10} className="inline mr-1" />Transfer</span>;
  return <span className="pill pill-success text-[11px]"><Stethoscope size={10} className="inline mr-1" />Medical</span>;
}

// ── Employee detail panel ─────────────────────────────────────────────────────
function EmployeeDetail({ emp, onApprove, onReject, onClose, busy }: { emp: any; onApprove: () => void; onReject: (reason: string) => void; onClose: () => void; busy: boolean }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');
  const pendingChanges: any[] = Array.isArray(emp.pendingChanges) ? emp.pendingChanges : [];
  const approvalStages: any[] = Array.isArray(emp.approvalStages) ? emp.approvalStages : [];

  const pendingAction = emp.pending_lifecycle_action as string | null | undefined;
  const actionLabels: Record<string, { subtitle: string; btnLabel: string; btnClass: string; iconColor: string }> = {
    SUSPENDED:  { subtitle: 'Suspension pending approval',  btnLabel: 'Approve Suspension',  btnClass: '!bg-amber-500 hover:!bg-amber-600', iconColor: 'text-amber-500' },
    TERMINATED: { subtitle: 'Termination pending approval', btnLabel: 'Approve Termination', btnClass: '!bg-red-600 hover:!bg-red-700',    iconColor: 'text-red-600'   },
    RESIGNED:   { subtitle: 'Resignation pending approval', btnLabel: 'Approve Resignation', btnClass: '!bg-rose-600 hover:!bg-rose-700',  iconColor: 'text-rose-600'  },
  };
  const actionMeta = pendingAction ? (actionLabels[pendingAction] ?? null) : null;

  const rows = [
    ['Employee ID', emp.employee_id || emp.employeeId || '—'],
    ['Department',  toStr(emp.department)  || '—'],
    ['Job Title',   toStr(emp.jobTitle)    || toStr(emp.designation) || '—'],
    ['Email',       emp.email       || '—'],
    ['Phone',       emp.phone       || '—'],
    ['Employment',  toStr(emp.employmentStatus) || emp.employmentType || emp.employment_type || '—'],
    ['Approval',    emp.approvalStatus || '—'],
    ['Lifecycle',   emp.lifecycleStatus || emp.lifecycle_status || '—'],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
        <div className="w-10 h-10 rounded-full bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] flex items-center justify-center">
          <Users size={18} className={actionMeta?.iconColor ?? 'text-[var(--accent)]'} />
        </div>
        <div>
          <p className="font-bold text-[var(--text-primary)]">{emp.firstName} {emp.lastName}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {actionMeta?.subtitle ?? (pendingChanges.length
              ? `Employee update pending approval · ${pendingChanges.length} change${pendingChanges.length === 1 ? '' : 's'}`
              : 'New employee pending approval')}
          </p>
        </div>
      </div>

      <EmployeeChangeComparison changes={pendingChanges} />

      {!!approvalStages.length && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Approval flow</p>
          <div className="space-y-1.5">
            {approvalStages.map((stage: any) => (
              <div key={stage.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-[var(--text-primary)]">{Number(stage.stage_order) + 1}. {stage.stage_name}</span>
                <span className="text-[var(--text-muted)]">{stage.approver_label || 'Assigned approver'} · {stage.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {emp.actionReason && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Reason</p>
          <p className="text-[12px] text-[var(--text-primary)]">{emp.actionReason}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-[var(--text-muted)] font-medium">{label}</dt>
            <dd className="text-[13px] text-[var(--text-primary)] font-semibold mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      {rejecting && (
        <FormField label="Rejection Reason">
          <CountedTextarea className={inputClass + ' resize-none'} rows={3} maxChars={500}
            placeholder="Enter reason for rejection…"
            value={reason} onChange={e => setReason(e.target.value)} />
        </FormField>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border)]">
        <button className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button>
        {rejecting ? (
          <>
            <button className="secondary-btn" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
            <button className="primary-btn !bg-red-600 hover:!bg-red-700"
              onClick={() => onReject(reason)} disabled={busy || !reason.trim()}>
              <XCircle size={14} /><span>{busy ? 'Rejecting…' : 'Confirm Reject'}</span>
            </button>
          </>
        ) : (
          <>
            {actionMeta && (
              <button className="secondary-btn !border-red-500 !text-red-600 hover:!bg-red-50"
                onClick={() => setRejecting(true)} disabled={busy}>
                <XCircle size={14} /><span>Reject</span>
              </button>
            )}
            <button className={`primary-btn ${actionMeta?.btnClass ?? '!bg-green-600 hover:!bg-green-700'}`} onClick={onApprove} disabled={busy}>
              <Check size={14} />
              <span>{busy ? 'Approving…' : (actionMeta?.btnLabel ?? 'Approve Employee')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Payroll run detail panel ──────────────────────────────────────────────────
function PayrollDetail({ run, onApprove, onReject, onClose, busy }: { run: any; onApprove: () => void; onReject: (reason: string) => void; onClose: () => void; busy: boolean }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');

  const rows = [
    ['Run Name',     run.name         || '—'],
    ['Period',       run.date_start   ? `${String(run.date_start).slice(0,10)} → ${String(run.date_end||'').slice(0,10)}` : '—'],
    ['Pay Frequency',run.freq_name    || '—'],
    ['Status',       run.status       || '—'],
    ['Deduction Group', run.group_name || '—'],
    ['Submitted By', run.submitted_by_name || run.submitted_by || '—'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
        <div className="w-10 h-10 rounded-full bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] flex items-center justify-center">
          <Banknote size={18} className="text-[var(--warning)]" />
        </div>
        <div>
          <p className="font-bold text-[var(--text-primary)]">{run.name}</p>
          <p className="text-xs text-[var(--text-muted)]">Payroll run pending approval</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-[var(--text-muted)] font-medium">{label}</dt>
            <dd className="text-[13px] text-[var(--text-primary)] font-semibold mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      {rejecting && (
        <div>
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
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border)]">
        <button className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button>
        {rejecting ? (
          <>
            <button className="secondary-btn" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
            <button
              className="primary-btn !bg-red-600 hover:!bg-red-700"
              onClick={() => onReject(reason)}
              disabled={busy || !reason.trim()}
            >
              <XCircle size={14} />
              <span>{busy ? 'Rejecting…' : 'Confirm Reject'}</span>
            </button>
          </>
        ) : (
          <>
            <button className="secondary-btn !border-red-500 !text-red-600 hover:!bg-red-50" onClick={() => setRejecting(true)} disabled={busy}>
              <XCircle size={14} />
              <span>Reject</span>
            </button>
            <button className="primary-btn !bg-green-600 hover:!bg-green-700" onClick={onApprove} disabled={busy}>
              <Check size={14} />
              <span>{busy ? 'Approving…' : 'Approve'}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Document preview modal ────────────────────────────────────────────────────
function DocModal({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(filename ?? '');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative z-10 bg-[var(--surface)] rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh] overflow-hidden border border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0 bg-slate-50/60">
          <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate max-w-[80%]">{filename}</p>
          <div className="flex items-center gap-1">
            <a href={url} download={filename} className="action-btn text-[var(--accent)]" title="Download"><Download size={14} /></a>
            <button onClick={onClose} className="action-btn"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center" style={{ minHeight: 400 }}>
          {isImg
            ? <img src={url} alt={filename} className="max-w-full max-h-full object-contain p-2" />
            : <iframe src={url} title={filename} className="w-full border-0" style={{ height: 600 }} />}
        </div>
      </motion.div>
    </div>
  );
}

// ── Medical detail panel ──────────────────────────────────────────────────────
function MedicalDetail({ rec, onApprove, onReject, onClose, busy }: {
  rec: any; onApprove: () => void; onReject: (reason: string) => void; onClose: () => void; busy: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');
  const [docOpen, setDocOpen]     = useState(false);
  const isDependent = !!rec.dependent_name;

  const rows = [
    ['Employee',        rec.employee_name  || '—'],
    ...(isDependent ? [['Dependent', rec.dependent_name || '—'], ['Relationship', rec.relationship || '—']] : []),
    ['Admission Date',  (isDependent ? rec.date_attended : rec.admission_date)  || '—'],
    ['Discharged Date', (isDependent ? rec.date_discharged : rec.discharged_date) || '—'],
    ['Admission Type',  rec.admission_type || '—'],
    ['Illness Type',    rec.illness_type   || '—'],
    ['Medication',      rec.medication     || '—'],
    ['Hospital',        rec.hospital       || '—'],
    ['Physician',       rec.physician      || '—'],
    ['Cost',            parseFloat(String(rec.cost ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
        <div className="w-10 h-10 rounded-full bg-[color-mix(in_srgb,var(--success)_15%,transparent)] flex items-center justify-center">
          <Stethoscope size={18} className="text-[var(--success)]" />
        </div>
        <div>
          <p className="font-bold text-[var(--text-primary)]">{rec.employee_name}</p>
          <p className="text-xs text-[var(--text-muted)]">{isDependent ? 'Dependent medical request' : 'Staff medical request'}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-[var(--text-muted)] font-medium">{label}</dt>
            <dd className="text-[13px] text-[var(--text-primary)] font-semibold mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Audit trail */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 pt-3 border-t border-[var(--border)]">
        <div>
          <dt className="text-[11px] text-[var(--text-muted)] font-medium">Posted By</dt>
          <dd className="text-[13px] text-[var(--text-primary)] font-semibold mt-0.5">{rec.posted_by_name || '—'}</dd>
        </div>
        {rec.approved_by_name && (
          <div>
            <dt className="text-[11px] text-[var(--text-muted)] font-medium">
              {rec.status === 'Rejected' ? 'Rejected By' : 'Approved By'}
            </dt>
            <dd className="text-[13px] text-[var(--text-primary)] font-semibold mt-0.5">{rec.approved_by_name}</dd>
          </div>
        )}
      </div>

      {rec.rejection_reason && (
        <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3">
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Rejection Reason</p>
          <p className="text-[12px] text-red-700">{rec.rejection_reason}</p>
        </div>
      )}

      {rec.attachment1 && (
        <div>
          <p className="text-[11px] text-[var(--text-muted)] font-medium mb-1">Attachment</p>
          <button type="button" onClick={() => setDocOpen(true)}
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] hover:underline">
            <FileText size={12} /> {rec.attachment1}
          </button>
        </div>
      )}

      {rejecting && (
        <FormField label="Rejection Reason">
          <CountedTextarea className={inputClass + ' resize-none'} rows={3} maxChars={500}
            placeholder="Enter reason for rejection…"
            value={reason} onChange={e => setReason(e.target.value)} />
        </FormField>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border)]">
        <button className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button>
        {rejecting ? (
          <>
            <button className="secondary-btn" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
            <button className="primary-btn !bg-red-600 hover:!bg-red-700"
              onClick={() => onReject(reason)} disabled={busy || !reason.trim()}>
              <XCircle size={14} /><span>{busy ? 'Rejecting…' : 'Confirm Reject'}</span>
            </button>
          </>
        ) : (
          <>
            <button className="secondary-btn !border-red-500 !text-red-600 hover:!bg-red-50"
              onClick={() => setRejecting(true)} disabled={busy}>
              <XCircle size={14} /><span>Reject</span>
            </button>
            <button className="primary-btn !bg-green-600 hover:!bg-green-700"
              onClick={onApprove} disabled={busy}>
              <Check size={14} /><span>{busy ? 'Approving…' : 'Approve'}</span>
            </button>
          </>
        )}
      </div>

      <AnimatePresence>
        {docOpen && (
          <DocModal
            url={`/v1/api/hr/documents/${rec.attachment1}`}
            filename={rec.attachment1}
            onClose={() => setDocOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Leave detail panel ────────────────────────────────────────────────────────
function LeaveApprovalDetail({ item, onApprove, onReject, onApproveAllowance, onRejectAllowance, onClose, busy }: {
  item: ApprovalItem;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onApproveAllowance: () => void;
  onRejectAllowance: (reason: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');
  const [stages, setStages]       = useState<any[]>([]);
  const l = item.raw;
  const isPendingFinancial = l._isPendingFinancial as boolean;
  const canAct = l._canActAllowance !== false; // undefined (non-financial) or true → allowed
  const amount    = parseFloat(l.amount    ?? 0) || 0;
  const taxAmount = parseFloat(l.leave_tax ?? 0) || 0;

  // Load the financial-approval stage chain for a pending-financial leave.
  useEffect(() => {
    if (isPendingFinancial) {
      api.get(`/leave/leaves/${item.id}/stages`).then(r => setStages(r.data?.data ?? [])).catch(() => setStages([]));
    }
  }, [isPendingFinancial, item.id]);
  const currentStage = stages.find(s => s.status === 'Pending') ?? null;

  const rows = [
    ['Employee',    l.employee_name    || '—'],
    ['Employee ID', l.employee_code    || '—'],
    ['Department',  l.department_name  || '—'],
    ['Leave Type',  l.leave_type_name  || '—'],
    ['Period',      l.period_name      || '—'],
    ['From',        l.date_start ? String(l.date_start).slice(0, 10) : '—'],
    ['To',          l.date_end   ? String(l.date_end).slice(0, 10)   : '—'],
    ['Days',        String(l.day_count ?? '—')],
    ['Status',      l.status           || '—'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
        <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
          <CalendarClock size={18} className="text-purple-600" />
        </div>
        <div>
          <p className="font-bold text-[var(--text-primary)]">{l.employee_name}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {isPendingFinancial ? 'Leave allowance pending financial approval' : 'Leave application pending approval'}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-[var(--text-muted)] font-medium">{label}</dt>
            <dd className="text-[13px] text-[var(--text-primary)] font-semibold mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      {isPendingFinancial && amount > 0 && (
        <div className="rounded-lg bg-purple-50 border border-purple-100 px-4 py-3 space-y-1">
          <p className="text-[10px] font-bold text-purple-600 uppercase tracking-wider mb-2">Allowance Summary</p>
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--text-muted)]">Gross Allowance</span>
            <span className="font-semibold text-[var(--text-primary)]">{amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--text-muted)]">Tax</span>
            <span className="font-semibold text-red-600">-{taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-[13px] border-t border-purple-100 pt-1 mt-1">
            <span className="font-semibold text-[var(--text-primary)]">Net Payout</span>
            <span className="font-bold text-purple-700">{(amount - taxAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}

      {isPendingFinancial && stages.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Approval flow</p>
          <div className="space-y-1.5">
            {stages.map((st: any) => {
              const done = st.status === 'Approved';
              const rej  = st.status === 'Rejected';
              const cur  = !done && !rej && currentStage?.id === st.id;
              const color = rej ? 'var(--danger)' : done ? 'var(--success)' : cur ? 'var(--warning)' : 'var(--text-muted)';
              return (
                <div key={st.id} className="flex items-center gap-2 text-[12px]">
                  <span className="shrink-0" style={{ color }}>
                    {done ? <Check size={13} /> : rej ? <XCircle size={13} /> : <Clock size={13} />}
                  </span>
                  <span className="font-medium text-[var(--text-primary)]">{st.stage_name}</span>
                  <span className="text-[var(--text-muted)]">
                    · {st.approver_type === 'user' ? '' : 'Role: '}{st.approver_label || st.approver_type}
                    {st.status !== 'Pending' && ` · ${st.status}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {l.details && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Leave Request Details / Reason</p>
          <p className="text-[12px] text-[var(--text-primary)] whitespace-pre-wrap">{l.details}</p>
        </div>
      )}

      {rejecting && (
        <FormField label="Rejection Reason">
          <CountedTextarea className={inputClass + ' resize-none'} rows={3} maxChars={500}
            placeholder="Enter reason for rejection…"
            value={reason} onChange={e => setReason(e.target.value)} />
        </FormField>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-[var(--border)]">
        <button className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button>
        {isPendingFinancial ? (
          !canAct ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning)' }}>
              <Clock size={13} className="shrink-0" />
              {currentStage ? `Awaiting ${currentStage.approver_label || currentStage.approver_type} — "${currentStage.stage_name}"` : 'Awaiting a different approver'}
            </div>
          ) : rejecting ? (
            <>
              <button className="secondary-btn" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
              <button className="primary-btn !bg-red-600 hover:!bg-red-700"
                onClick={() => onRejectAllowance(reason)} disabled={busy || !reason.trim()}>
                <XCircle size={14} /><span>{busy ? 'Rejecting…' : 'Confirm Reject'}</span>
              </button>
            </>
          ) : (
            <>
              <button className="secondary-btn !border-red-500 !text-red-600 hover:!bg-red-50"
                onClick={() => setRejecting(true)} disabled={busy}>
                <XCircle size={14} /><span>Reject</span>
              </button>
              <button className="primary-btn !bg-purple-600 hover:!bg-purple-700" onClick={onApproveAllowance} disabled={busy}>
                <Check size={14} />
                <span>{busy ? 'Approving…' : 'Approve Allowance'}</span>
              </button>
            </>
          )
        ) : rejecting ? (
          <>
            <button className="secondary-btn" onClick={() => setRejecting(false)} disabled={busy}>Back</button>
            <button className="primary-btn !bg-red-600 hover:!bg-red-700"
              onClick={() => onReject(reason)} disabled={busy || !reason.trim()}>
              <XCircle size={14} /><span>{busy ? 'Rejecting…' : 'Confirm Reject'}</span>
            </button>
          </>
        ) : (
          <>
            <button className="secondary-btn !border-red-500 !text-red-600 hover:!bg-red-50"
              onClick={() => setRejecting(true)} disabled={busy}>
              <XCircle size={14} /><span>Reject</span>
            </button>
            <button className="primary-btn !bg-green-600 hover:!bg-green-700" onClick={onApprove} disabled={busy}>
              <Check size={14} /><span>{busy ? 'Approving…' : 'Approve'}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Slide-over panel wrapper ──────────────────────────────────────────────────
function EmployeeTransferDetail({ transfer, onApprove, onReject, onClose, busy }: {
  transfer: any; onApprove: (comment: string) => void; onReject: (reason: string) => void; onClose: () => void; busy: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const currentStage = (transfer.stages || []).find((stage: any) => stage.status === 'Pending');
  return <div className="space-y-5">
    <div className="flex items-center gap-3 border-b border-[var(--border)] pb-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10"><ArrowRightLeft size={18} className="text-blue-600" /></div>
      <div><p className="font-bold text-[var(--text-primary)]">{transfer.employee_name}</p><p className="text-xs text-[var(--text-muted)]">{transfer.transfer_number} · {transfer.transfer_type}</p></div>
    </div>
    <dl className="grid grid-cols-2 gap-4">
      <div><dt className="text-[11px] font-medium text-[var(--text-muted)]">Employee ID</dt><dd className="mt-0.5 text-sm font-semibold">{transfer.employee_code || '—'}</dd></div>
      <div><dt className="text-[11px] font-medium text-[var(--text-muted)]">Effective Date</dt><dd className="mt-0.5 text-sm font-semibold">{String(transfer.effective_date || '').slice(0, 10)}</dd></div>
      <div className="col-span-2"><dt className="text-[11px] font-medium text-[var(--text-muted)]">Current Approval Stage</dt><dd className="mt-0.5 text-sm font-semibold">{currentStage?.stage_name || 'Direct HR approval'}</dd></div>
    </dl>
    <div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Proposed changes</p><TransferChangeComparison changes={transfer.changes || []} /></div>
    {transfer.reason && <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><p className="text-[10px] font-bold uppercase text-[var(--text-muted)]">Transfer reason</p><p className="mt-1 text-sm">{transfer.reason}</p></div>}
    {rejecting ? <FormField label="Rejection Reason"><CountedTextarea className={`${inputClass} resize-none`} rows={3} maxChars={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason for rejecting this transfer…" /></FormField>
      : <FormField label="Approval Comment (Optional)"><CountedTextarea className={`${inputClass} resize-none`} rows={2} maxChars={500} value={comment} onChange={event => setComment(event.target.value)} placeholder="Add a note for this approval stage…" /></FormField>}
    <div className="flex justify-end gap-3 border-t border-[var(--border)] pt-3">
      <button className="secondary-btn" onClick={onClose} disabled={busy}>Cancel</button>
      {rejecting ? <><button className="secondary-btn" onClick={() => setRejecting(false)} disabled={busy}>Back</button><button className="primary-btn !bg-red-600 hover:!bg-red-700" onClick={() => onReject(reason)} disabled={busy || !reason.trim()}><XCircle size={14} />{busy ? 'Rejecting…' : 'Confirm Reject'}</button></>
        : <><button className="secondary-btn !border-red-500 !text-red-600 hover:!bg-red-50" onClick={() => setRejecting(true)} disabled={busy}><XCircle size={14} />Reject</button><button className="primary-btn !bg-green-600 hover:!bg-green-700" onClick={() => onApprove(comment)} disabled={busy}><Check size={14} />{busy ? 'Approving…' : 'Approve Stage'}</button></>}
    </div>
  </div>;
}

function SlideOver({ item, onClose, onDone }: { item: ApprovalItem; onClose: () => void; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);

  async function approveEmployee() {
    setBusy(true);
    try {
      const response = await api.put(`/employees/${item.id}/approve`);
      toast.success(response.data?.message || (item.raw.pending_lifecycle_action
        ? `${item.raw.pending_lifecycle_action.toLowerCase()} approved`
        : 'Employee approved'));
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(false); }
  }

  async function rejectEmployee(reason: string) {
    setBusy(true);
    try {
      await api.put(`/employees/${item.id}/reject`, { reason });
      toast.success(item.raw.pending_lifecycle_action
        ? `${item.raw.pending_lifecycle_action.toLowerCase()} request rejected`
        : 'Employee application rejected');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally { setBusy(false); }
  }

  async function approvePayroll() {
    setBusy(true);
    try {
      await api.post(`/payroll/runs/${item.id}/approve`);
      toast.success('Payroll run approved');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(false); }
  }

  async function rejectPayroll(reason: string) {
    setBusy(true);
    try {
      await api.post(`/payroll/runs/${item.id}/reject`, { reason });
      toast.success('Payroll run rejected');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally { setBusy(false); }
  }

  // Route segment per medical record type. Use the dedicated /approve|/reject endpoints so the multi-stage
  // approval engine runs (the legacy PUT {status} path bypasses it).
  const medBase = () => {
    const t = item.raw._medType;
    return t === 'dependent' ? `/medical/dependents-requests/${item.id}`
      : t === 'claim' ? `/medical/claims/${item.id}`
      : `/medical/staff/${item.id}`;
  };

  async function approveMedical() {
    setBusy(true);
    try {
      const response = await api.post(`${medBase()}/approve`);
      const updated = response.data?.data;
      if (updated?.status === 'GL Failed') {
        const glError = medicalGlError(updated);
        toast.error(
          `Medical request approved, but GL posting failed${glError ? ': ' + glError : ''}. Retry it from Manage Medical.`,
          { duration: 8000 },
        );
      } else {
        toast.success(response.data?.message || 'Medical request approved');
        if (updated?.document_ref) {
          toast.success(`GL posted — Ref: ${updated.document_ref}`, { duration: 6000 });
        }
      }
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(false); }
  }

  async function rejectMedical(reason: string) {
    setBusy(true);
    try {
      await api.post(`${medBase()}/reject`, { reason });
      toast.success('Medical request rejected');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally { setBusy(false); }
  }

  async function approveTransfer(comment: string) {
    setBusy(true);
    try {
      await api.post(`/employee-transfers/${item.id}/approve`, { comment });
      toast.success('Employee transfer approval recorded');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(false); }
  }

  async function rejectTransfer(reason: string) {
    setBusy(true);
    try {
      await api.post(`/employee-transfers/${item.id}/reject`, { reason });
      toast.success('Employee transfer rejected');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally { setBusy(false); }
  }

  async function approveLeave() {
    setBusy(true);
    try {
      await api.post(`/leave/leaves/${item.id}/approve`);
      toast.success('Leave approved');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(false); }
  }

  async function rejectLeave(reason: string) {
    setBusy(true);
    try {
      await api.post(`/leave/leaves/${item.id}/reject`, { reason });
      toast.success('Leave rejected');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally { setBusy(false); }
  }

  async function approveLeaveAllowance() {
    setBusy(true);
    try {
      await api.post(`/leave/leaves/${item.id}/approve-allowance`);
      toast.success('Financial approval recorded');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(false); }
  }

  async function rejectLeaveAllowance(reason: string) {
    setBusy(true);
    try {
      await api.post(`/leave/leaves/${item.id}/reject-allowance`, { reason });
      toast.success('Financial approval rejected — leave rejected');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/30 z-40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h3 className="font-bold text-[var(--text-primary)] syne text-[16px]">Review & Approve</h3>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5"><ModulePill module={item.module} /></p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-200 text-slate-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {item.module === 'Employee' ? (
            <EmployeeDetail emp={item.raw} onApprove={approveEmployee} onReject={rejectEmployee} onClose={onClose} busy={busy} />
          ) : item.module === 'Payroll' ? (
            <PayrollDetail run={item.raw} onApprove={approvePayroll} onReject={rejectPayroll} onClose={onClose} busy={busy} />
          ) : item.module === 'Leave' ? (
            <LeaveApprovalDetail
              item={item}
              onApprove={approveLeave}
              onReject={rejectLeave}
              onApproveAllowance={approveLeaveAllowance}
              onRejectAllowance={rejectLeaveAllowance}
              onClose={onClose}
              busy={busy}
            />
          ) : item.module === 'Employee Transfer' ? (
            <EmployeeTransferDetail transfer={item.raw} onApprove={approveTransfer} onReject={rejectTransfer} onClose={onClose} busy={busy} />
          ) : (
            <MedicalDetail rec={item.raw} onApprove={approveMedical} onReject={rejectMedical} onClose={onClose} busy={busy} />
          )}
        </div>
      </motion.div>
    </>
  );
}

// ── Payroll review modal wrapper (owns busy state + approve/reject calls) ──────
function PayrollReviewController({ item, onClose, onDone }: { item: ApprovalItem; onClose: () => void; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      await api.post(`/payroll/runs/${item.id}/approve`);
      toast.success('Payroll run approved');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Approval failed');
    } finally { setBusy(false); }
  }

  async function reject(reason: string) {
    setBusy(true);
    try {
      await api.post(`/payroll/runs/${item.id}/reject`, { reason });
      toast.success('Payroll run rejected');
      onDone(item.id);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Rejection failed');
    } finally { setBusy(false); }
  }

  return (
    <PayrollReviewModal run={item.raw} onApprove={approve} onReject={reject} onClose={onClose} busy={busy} />
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function CentralApproval({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [items, setItems]           = useState<ApprovalItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<ApprovalItem | null>(null);
  const [reviewItem, setReviewItem]   = useState<ApprovalItem | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const currentUser = getCurrentUser();
      const isAdmin = currentUser?.allRoles?.some(r => ['admin', 'super-admin', 'hr'].includes(r.name)) ?? false;
      // A payroll/medical stage approver reaches this screen without an admin/hr role — they still need the
      // relevant queue (the server only lets them action items where they're the current stage's approver).
      const isStageApprover = currentUser?.isStageApprover === true;
      const canSeePayroll = isAdmin || isStageApprover;
      const canSeeMedical = isAdmin || isStageApprover;

      const noop = Promise.resolve({ data: { data: [] } });
      // The employee endpoint returns only requests the caller may action at the current stage.
      const adminFetches = [
        api.get('/employees/approvals'),
        canSeePayroll ? api.get('/payroll/runs')                     : noop,
        canSeeMedical ? api.get('/medical/staff')                    : noop,
        canSeeMedical ? api.get('/medical/dependents-requests')      : noop,
        canSeeMedical ? api.get('/medical/claims')                   : noop,
      ];

      const [empRes, runRes, staffMedRes, depMedRes, claimRes, leaveRes, transferRes] = await Promise.allSettled([
        ...adminFetches,
        api.get('/leave/central-approval'),
        api.get('/employee-transfers/approvals'),
      ]);

      const pending: ApprovalItem[] = [];

      if (empRes.status === 'fulfilled') {
        const emps: any[] = empRes.value.data.data ?? [];
        emps
          .filter((e: any) => e.approvalStatus === 'PENDING' || e.approvalStatus === 'Pending')
          .forEach((e: any) => {
            const lifecycleLabels: Record<string, string> = {
              SUSPENDED: 'Suspension pending approval', TERMINATED: 'Termination pending approval',
              RESIGNED:  'Resignation pending approval',
            };
            const pendingChangeCount = Array.isArray(e.pendingChanges) ? e.pendingChanges.length : 0;
            const subtitle = e.pending_lifecycle_action
              ? (lifecycleLabels[e.pending_lifecycle_action] ?? e.pending_lifecycle_action)
              : pendingChangeCount
                ? `Employee update · ${pendingChangeCount} change${pendingChangeCount === 1 ? '' : 's'}`
                : (toStr(e.jobTitle) || toStr(e.department) || String(e.email || ''));
            pending.push({
              id:          String(e.id),
              module:      'Employee',
              title:       `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Unknown Employee',
              subtitle,
              submittedAt: e.updatedAt || e.updated_at || e.createdAt || e.created_at || null,
              status:      e.approvalStatus === 'PENDING' ? 'Pending' : (e.approvalStatus || 'Pending'),
              raw:         e,
            });
          });
      }

      if (runRes.status === 'fulfilled') {
        const runs: any[] = runRes.value.data.data ?? [];
        // Non-admin stage approvers only see runs whose CURRENT stage is theirs (by user id or role name);
        // admins/HR see every pending run. Matches the server's per-stage approve authority.
        const myId = currentUser?.id != null ? String(currentUser.id) : '';
        const myRoles = new Set((currentUser?.allRoles ?? []).map(r => r.name));
        const isMyStage = (r: any) => r.cur_approver_type === 'user'
          ? String(r.cur_approver_id) === myId
          : (myRoles.has(String(r.cur_approver_label)) || myRoles.has(String(r.cur_approver_id)));
        runs
          .filter((r: any) => r.status === 'Pending Approval')
          .filter((r: any) => isAdmin || isMyStage(r))
          .forEach((r: any) => {
            pending.push({
              id:          String(r.id),
              module:      'Payroll',
              title:       r.name || 'Unnamed Run',
              subtitle:    r.freq_name || r.date_start ? `${String(r.date_start || '').slice(0,10)}` : '',
              submittedAt: r.updated_at || r.created_at || null,
              status:      r.status || 'Pending Approval',
              raw:         r,
            });
          });
      }

      // Collect pending medical items across all three record types, then (for a non-admin stage approver)
      // keep only the ones whose CURRENT stage is theirs — the server enforces the same on action.
      const medItems: ApprovalItem[] = [];
      if (staffMedRes.status === 'fulfilled') {
        (staffMedRes.value.data.data ?? []).filter((r: any) => r.status === 'Pending Approval').forEach((r: any) => {
          medItems.push({ id: String(r.id), module: 'Medical', title: r.employee_name || 'Unknown Employee',
            subtitle: `Staff — ${r.illness_type || ''}`, submittedAt: r.admission_date || null,
            status: r.status || 'Pending Approval', raw: { ...r, _medType: 'staff' } });
        });
      }
      if (depMedRes.status === 'fulfilled') {
        (depMedRes.value.data.data ?? []).filter((r: any) => r.status === 'Pending Approval').forEach((r: any) => {
          medItems.push({ id: String(r.id), module: 'Medical', title: r.employee_name || 'Unknown Employee',
            subtitle: `Dependent (${r.dependent_name || ''}) — ${r.illness_type || ''}`, submittedAt: r.date_attended || null,
            status: r.status || 'Pending Approval', raw: { ...r, _medType: 'dependent' } });
        });
      }
      if (claimRes.status === 'fulfilled') {
        (claimRes.value.data.data ?? []).filter((r: any) => r.status === 'Pending Approval').forEach((r: any) => {
          medItems.push({ id: String(r.id), module: 'Medical', title: r.hospital_name || r.employee_name || 'Hospital Claim',
            subtitle: `Claim — ${r.total_amount != null ? Number(r.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : ''}`,
            submittedAt: r.posted_date || r.createdAt || null, status: r.status || 'Pending Approval', raw: { ...r, _medType: 'claim' } });
        });
      }

      if (isAdmin) {
        pending.push(...medItems);
      } else {
        // Non-admin stage approver: filter to items where the current pending stage matches this user.
        const myId = currentUser?.id != null ? String(currentUser.id) : '';
        const myRoles = new Set((currentUser?.allRoles ?? []).map(r => r.name));
        const kept = await Promise.all(medItems.map(async (it) => {
          try {
            const sres = await api.get(`/medical/requests/${it.raw._medType}/${it.id}/stages`);
            const stages: any[] = sres.data?.data ?? [];
            const cur = stages.find(x => x.status === 'Pending');
            if (!cur) return null; // no flow (single-stage) → non-admins can't act; hide
            const mine = cur.approver_type === 'user'
              ? String(cur.approver_id) === myId
              : (myRoles.has(String(cur.approver_label)) || myRoles.has(String(cur.approver_id)));
            return mine ? it : null;
          } catch { return null; }
        }));
        pending.push(...kept.filter((x): x is ApprovalItem => x !== null));
      }

      if (leaveRes.status === 'fulfilled') {
        const leaves: any[] = (leaveRes as any).value.data.data ?? [];
        leaves.forEach((l: any) => {
          const isPendingFinancial = l.allowance_status === 'Pending Financial Approval';
          const allowanceNote = isPendingFinancial && l.amount
            ? ` — Allowance: ${parseFloat(l.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            : '';
          pending.push({
            id:          String(l.id),
            module:      'Leave',
            title:       l.employee_name ?? 'Employee',
            subtitle:    `${l.leave_type_name ?? ''} — ${l.day_count ?? 0} day(s)${allowanceNote}`,
            submittedAt: l.posted_date ?? null,
            status:      isPendingFinancial ? 'Pending Financial Approval' : (l.status ?? ''),
            raw:         { ...l, _isPendingFinancial: isPendingFinancial },
          });
        });
      }

      if (transferRes.status === 'fulfilled') {
        const transfers: any[] = transferRes.value.data?.data ?? [];
        transfers.forEach((transfer: any) => pending.push({
          id: String(transfer.id),
          module: 'Employee Transfer',
          title: transfer.employee_name || 'Employee',
          subtitle: `${transfer.transfer_type || 'Transfer'} · ${transfer.changes?.length || 0} change(s) · effective ${String(transfer.effective_date || '').slice(0, 10)}`,
          submittedAt: transfer.submitted_at || transfer.created_at || null,
          status: transfer.status || 'Pending Approval',
          raw: transfer,
        }));
      }

      pending.sort((a, b) => {
        const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : Number.NaN;
        const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : Number.NaN;
        const aValid = Number.isFinite(aTime);
        const bValid = Number.isFinite(bTime);
        if (aValid && bValid) return bTime - aTime;
        if (aValid) return -1;
        if (bValid) return 1;
        return 0;
      });
      setItems(pending);
    } catch {
      toast.error('Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function handleDone(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedItem(null);
    setReviewItem(null);
  }

  function handleView(item: ApprovalItem) {
    if (item.module === 'Employee') {
      const user = getCurrentUser();
      if (onNavigate && user && canAccessNav(user, 'Employees')) {
        sessionStorage.setItem('centralApproval.employeeId', item.id);
        onNavigate('Employees');
      } else setSelectedItem(item);
      return;
    }
    if (item.module === 'Payroll') {
      // Stage approvers reach this screen without access to the full Payroll module — sending them there
      // renders Access Denied. Only jump to the module when they can actually open it; otherwise show the
      // read-only run detail (with Approve/Reject) in the slide-over.
      const user = getCurrentUser();
      const canOpenPayroll = user ? canAccessNav(user, 'Payroll') : false;
      if (onNavigate && canOpenPayroll) {
        sessionStorage.setItem('centralApproval.payrollRunId', item.id);
        onNavigate('Payroll');
      } else {
        // Stage approver without the full module — open the read-only review with the figures + actions.
        setReviewItem(item);
      }
      return;
    }
    // Medical and Leave — always handled in-panel
    setSelectedItem(item);
  }

  const filtered = items.filter(i =>
    i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
    i.module.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 w-full relative h-full flex flex-col">
      <div className="max-w-[1300px] w-full mx-auto px-6 py-8 flex-1 flex flex-col">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <PageHeader title="Central Approval" subtitle="Review and action all pending approvals across employees and payroll." />
          
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm"
        >
          <TableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search approvals…"
            searchWidth="sm:min-w-[300px]"
            actions={
              <button className="secondary-btn" onClick={fetchAll}>
                <RefreshCw size={14} />
                <span>Refresh</span>
              </button>
            }
          />

          <div className="overflow-x-auto flex-1">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className="th">Module</th>
                  <th scope="col" className="th">Name</th>
                  <th scope="col" className="th">Details</th>
                  <th scope="col" className="th">Status</th>
                  <th scope="col" className="th">Submitted</th>
                  <th scope="col" className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="td text-center py-12">
                      <p className="text-[var(--text-muted)] text-[13px]">Loading pending approvals…</p>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="td text-center py-12">
                      {items.length === 0
                        ? <div>
                            <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
                            <p className="text-[var(--text-muted)] text-[13px]">No pending approvals — all caught up!</p>
                          </div>
                        : <p className="text-[var(--text-muted)] text-[13px]">No approvals match your search.</p>
                      }
                    </td>
                  </tr>
                ) : (
                  filtered.map((item, i) => (
                    <motion.tr
                      key={`${item.module}-${item.id}`}
                      className="tr"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 + i * 0.04 }}
                    >
                      <td className="td"><ModulePill module={item.module} /></td>
                      <td className="td font-medium text-[var(--text-primary)]">{item.title}</td>
                      <td className="td text-[var(--text-muted)] text-[13px]">{item.subtitle || '—'}</td>
                      <td className="td"><StatusChip status={item.status} /></td>
                      <td className="td text-[var(--text-muted)] text-[12px]">
                        {item.submittedAt ? String(item.submittedAt).slice(0, 10) : '—'}
                      </td>
                      <td className="td text-right">
                        <button
                          className="primary-btn"
                          onClick={() => handleView(item)}
                        >
                          <Eye size={14} />
                          <span>{item.module === 'Payroll' ? 'View Report' : 'View Details'}</span>
                        </button>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <TablePagination total={items.length} filtered={filtered.length} />
        </motion.div>
      </div>

      <AnimatePresence>
        {selectedItem && (
          <SlideOver
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onDone={handleDone}
          />
        )}
        {reviewItem && (
          <PayrollReviewController
            item={reviewItem}
            onClose={() => setReviewItem(null)}
            onDone={handleDone}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
