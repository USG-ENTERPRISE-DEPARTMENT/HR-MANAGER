import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Eye, FileEdit, Trash2, ArrowUpDown, Check, X, SendHorizonal, XCircle, RefreshCw, Loader2, CalendarDays, Clock4, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ConfirmModal } from './ui/ConfirmModal';
import { RowActions } from './ui/RowActions';
import { SearchSelect } from './ui/SearchSelect';
import { PageHeader } from './ui/PageHeader';
import { TabBar } from './ui/TabBar';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormModal } from './ui/FormModal';
import { DetailSlideOver } from './ui/DetailSlideOver';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import api from '../../lib/api';
import { money } from '../../lib/currency';
import { toast } from 'sonner';
import { getCurrentUser } from '../../lib/auth';

const ALL_TABS = ['All my Leave', 'Leave Entitlement', 'Approved Leave', 'Pending Leave', 'Subordinate Leave', 'Cancellation Request'] as const;

const SortableHeader = ({ children }: { children: ReactNode }) => (
  <th scope="col" className="th">
    <button className="flex items-center gap-1 hover:text-[var(--text-primary)] group">
      {children}
      <ArrowUpDown size={12} className="text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" />
    </button>
  </th>
);

const STATUS_PILL: Record<string, string> = {
  Draft:             'bg-slate-100 border border-slate-200 text-slate-500',
  Pending:           'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]',
  'Pending Approval': 'bg-amber-500/10 text-amber-700 border border-amber-200/50',
  'Pending Financial Approval': 'bg-blue-500/10 text-blue-700 border border-blue-200/50',
  'Pending HR Approval': 'bg-purple-500/10 text-purple-700 border border-purple-200/50',
  Approved:          'pill pill-success',
  Rejected:          'pill pill-danger',
  Cancelled:         'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-muted)]',
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_PILL[status] ?? 'pill';
  return <span className={`pill ${cls}`}>{status}</span>;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  return String(v).substring(0, 10);
}

export function LeaveManagement() {
  const [activeTab, setActiveTab]   = useState('All my Leave');
  const [searchQuery, setSearchQuery] = useState('');
  const [leaves, setLeaves]         = useState<any[]>([]);
  const [balance, setBalance]       = useState<any[]>([]);
  const [balanceDetail, setBalanceDetail] = useState<any>(null);
  const [loading, setLoading]       = useState(false);

  // Apply leave form
  const [showApply, setShowApply]   = useState(false);
  const [applyForm, setApplyForm]   = useState({ leave_type: '', date_start: '', date_end: '', details: '' });
  const [saving, setSaving]         = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [leavePeriods, setLeavePeriods] = useState<any[]>([]);
  const [holidays, setHolidays]     = useState<any[]>([]);
  const [workWeek, setWorkWeek]     = useState<Record<string, string>>({});

  // Live preview state
  const [previewDays, setPreviewDays]         = useState<number | null>(null);
  const [previewHolidays, setPreviewHolidays] = useState<any[]>([]);
  const [previewPeriod, setPreviewPeriod]     = useState<any>(null);

  // Confirmation step
  const [showConfirm, setShowConfirm]       = useState(false);
  const [confirmBreakdown, setConfirmBreakdown] = useState<{ dateStr: string; dayName: string; type: string; holidayName?: string }[]>([]);

  // View/reject panel
  const [viewRow, setViewRow]       = useState<any>(null);
  const [rejectId, setRejectId]     = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Edit leave
  const [showEdit, setShowEdit]   = useState(false);
  const [editId, setEditId]       = useState<string>('');
  const [editForm, setEditForm]   = useState({ leave_type: '', date_start: '', date_end: '', details: '' });

  // Subordinate assign
  const [subordinates, setSubordinates] = useState<any[]>([]);
  const [showAssign, setShowAssign]   = useState(false);
  const [assignForm, setAssignForm]   = useState({ employee: '', leave_type: '', date_start: '', date_end: '', details: '' });

  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.allRoles?.some(r => ['admin', 'super-admin', 'hr'].includes(r.name));
  // Personal leave (incl. subordinate / approval-request tabs and approving) is open to all by default
  const TABS = [...ALL_TABS];

  // ── Confirm dialog ────────────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<{
    title: string; message?: string; confirmLabel: string;
    variant: 'danger' | 'warning'; onConfirm: () => void;
  } | null>(null);

  const askConfirm = (
    title: string, message: string, onConfirm: () => void,
    opts?: { label?: string; variant?: 'danger' | 'warning' }
  ) => setConfirmState({ title, message, confirmLabel: opts?.label ?? 'Confirm', variant: opts?.variant ?? 'danger', onConfirm });

  const fetchLeaves = useCallback((statusFilter?: string) => {
    setLoading(true);
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    api.get(`/leave/leaves${qs}`)
      .then(r => setLeaves(r.data.data ?? []))
      .catch(() => toast.error('Failed to load leaves'))
      .finally(() => setLoading(false));
  }, []);

  const fetchSubordinate = useCallback((statusFilter?: string) => {
    setLoading(true);
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    api.get(`/leave/leaves/subordinates${qs}`)
      .then(r => setLeaves(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

const fetchSubordinateEmployees = useCallback(() => {
    api.get('/leave/subordinates')
      .then(r => setSubordinates(r.data.data ?? []))
      .catch(() => {});
  }, []);

  const fetchBalance = useCallback(() => {
    if (!currentUser?.employeeId) return;
    setLoading(true);
    api.get(`/leave/balance/${currentUser.employeeId}`)
      .then(r => setBalance(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser?.employeeId]);

  useEffect(() => {
    if (activeTab === 'All my Leave')       fetchLeaves();
    if (activeTab === 'Approved Leave')     fetchLeaves('Approved');
    if (activeTab === 'Pending Leave')      fetchLeaves('Draft');
    if (activeTab === 'Subordinate Leave')    { fetchSubordinate(); fetchSubordinateEmployees(); }
    if (activeTab === 'Cancellation Request') fetchSubordinate('Cancelled');
    if (activeTab === 'Leave Entitlement')  fetchBalance();
  }, [activeTab, fetchLeaves, fetchSubordinate, fetchBalance]);

  // Workweek + holidays are static — fetch once on mount so they're always ready
  useEffect(() => {
    Promise.all([api.get('/leave/workweek'), api.get('/leave/holidays')]).then(([w, h]) => {
      const wkMap: Record<string, string> = {};
      for (const row of (w.data.data ?? [])) wkMap[row.name] = row.status;
      setWorkWeek(wkMap);
      setHolidays(h.data.data ?? []);
    }).catch(() => {});
  }, []);

  // Load leave types, active periods, balance when a form opens
  useEffect(() => {
    if (!showApply && !showAssign && !showEdit) return;
    const fetches: Promise<any>[] = [
      api.get(showAssign ? '/leave/types?all=1' : '/leave/types'),
      api.get('/leave/periods'),
      currentUser?.employeeId ? api.get(`/leave/balance/${currentUser.employeeId}`) : Promise.resolve({ data: { data: [] } }),
    ];
    Promise.all(fetches).then(([t, p, b]) => {
      setLeaveTypes(t.data.data ?? []);
      setLeavePeriods((p.data.data ?? []).filter((x: any) => x.status === 'Active'));
      if (b?.data?.data) setBalance(b.data.data);
    }).catch(() => {});
  }, [showApply, showAssign, showEdit]);

  // Recalculate preview whenever dates change (works for both apply and assign forms)
  const activeDateStart = showAssign ? assignForm.date_start : showEdit ? editForm.date_start : applyForm.date_start;
  const activeDateEnd   = showAssign ? assignForm.date_end   : showEdit ? editForm.date_end   : applyForm.date_end;

  useEffect(() => {
    if (!activeDateStart || !activeDateEnd) {
      setPreviewDays(null); setPreviewHolidays([]); setPreviewPeriod(null);
      return;
    }
    const start = new Date(activeDateStart + 'T00:00:00');
    const end   = new Date(activeDateEnd   + 'T00:00:00');
    if (end < start) {
      setPreviewDays(null); setPreviewHolidays([]); setPreviewPeriod(null);
      return;
    }

    // Auto-detect matching active period
    const matched = leavePeriods.find((p: any) => {
      const ps = new Date(String(p.date_start).substring(0, 10) + 'T00:00:00');
      const pe = new Date(String(p.date_end  ).substring(0, 10) + 'T00:00:00');
      return start >= ps && end <= pe;
    });
    setPreviewPeriod(matched ?? null);

    // Build holiday lookup
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const holidayMap = new Map<string, any>();
    for (const h of holidays) {
      const d = String(h.dateh ?? '').substring(0, 10);
      if (d) holidayMap.set(d, h);
    }

    let days = 0;
    const hitHolidays: any[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const wkStatus = workWeek[dayNames[d.getDay()]] ?? 'Full_Day';
      if (wkStatus === 'Non_working_Day') continue;
      const dateStr = d.toISOString().substring(0, 10);
      const holiday = holidayMap.get(dateStr);
      if (holiday) { hitHolidays.push({ ...holiday, _date: dateStr }); continue; }
      days += wkStatus === 'Half_Day' ? 0.5 : 1;
    }
    setPreviewDays(days);
    setPreviewHolidays(hitHolidays);
  }, [activeDateStart, activeDateEnd, leavePeriods, holidays, workWeek]);

  const openConfirmation = () => {
    if (!applyForm.leave_type || !applyForm.date_start || !applyForm.date_end)
      return toast.error('Leave type, start and end dates are required');
    if (!previewPeriod)
      return toast.error('No active leave period covers the selected dates. Contact HR.');
    const start = new Date(applyForm.date_start + 'T00:00:00');
    const end   = new Date(applyForm.date_end   + 'T00:00:00');
    if (end < start) return toast.error('End date must be on or after start date');

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const holidayMap = new Map<string, string>();
    for (const h of holidays) {
      const d = String(h.dateh ?? '').substring(0, 10);
      if (d) holidayMap.set(d, h.name ?? 'Public Holiday');
    }
    const breakdown: typeof confirmBreakdown = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dn      = DAY_NAMES[d.getDay()];
      const wk      = workWeek[dn] ?? 'Full_Day';
      const dateStr = d.toISOString().substring(0, 10);
      const hName   = holidayMap.get(dateStr);
      let type: string;
      if (wk === 'Non_working_Day') type = 'Non working day';
      else if (hName)               type = 'Holiday';
      else if (wk === 'Half_Day')   type = 'Half Day';
      else                          type = 'Full Day';
      breakdown.push({ dateStr, dayName: dn, type, holidayName: hName });
    }
    setConfirmBreakdown(breakdown);
    setShowApply(false);
    setShowConfirm(true);
  };

  const applyLeave = async () => {
    if (!applyForm.leave_type || !applyForm.date_start || !applyForm.date_end)
      return toast.error('Leave type, start and end dates are required');
    if (!previewPeriod)
      return toast.error('No active leave period covers the selected dates. Contact HR.');
    setSaving(true);
    try {
      await api.post('/leave/leaves', {
        employee:     currentUser?.employeeId,
        leave_type:   applyForm.leave_type,
        leave_period: previewPeriod.id,
        date_start:   applyForm.date_start,
        date_end:     applyForm.date_end,
        details:      applyForm.details,
      });
      toast.success('Leave application submitted');
      setShowApply(false);
      setShowConfirm(false);
      setApplyForm({ leave_type: '', date_start: '', date_end: '', details: '' });
      setConfirmBreakdown([]);
      fetchLeaves();
      fetchBalance();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to submit leave');
    }
    setSaving(false);
  };

  const openEdit = (row: any) => {
    setEditId(String(row.id));
    setEditForm({
      leave_type: String(row.leave_type ?? ''),
      date_start: String(row.date_start ?? '').substring(0, 10),
      date_end:   String(row.date_end   ?? '').substring(0, 10),
      details:    row.details ?? '',
    });
    setShowEdit(true);
  };

  const updateLeave = async () => {
    if (!editForm.leave_type || !editForm.date_start || !editForm.date_end)
      return toast.error('Leave type, start and end dates are required');
    if (!previewPeriod)
      return toast.error('No active leave period covers the selected dates. Contact HR.');
    setSaving(true);
    try {
      await api.put(`/leave/leaves/${editId}`, {
        leave_type:   editForm.leave_type,
        leave_period: previewPeriod.id,
        date_start:   editForm.date_start,
        date_end:     editForm.date_end,
        details:      editForm.details,
      });
      toast.success('Leave updated');
      setShowEdit(false);
      fetchLeaves();
      fetchBalance();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to update leave');
    }
    setSaving(false);
  };

  const assignLeave = async () => {
    if (!assignForm.employee || !assignForm.leave_type || !assignForm.date_start || !assignForm.date_end)
      return toast.error('Employee, leave type, start and end dates are required');
    if (!previewPeriod)
      return toast.error('No active leave period covers the selected dates. Contact HR.');
    setSaving(true);
    try {
      await api.post('/leave/leaves', {
        employee:     assignForm.employee,
        leave_type:   assignForm.leave_type,
        leave_period: previewPeriod.id,
        date_start:   assignForm.date_start,
        date_end:     assignForm.date_end,
        details:      assignForm.details,
      });
      toast.success('Leave assigned successfully');
      setShowAssign(false);
      setAssignForm({ employee: '', leave_type: '', date_start: '', date_end: '', details: '' });
      fetchSubordinate();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to assign leave');
    }
    setSaving(false);
  };

  const submitLeave = async (id: string) => {
    try {
      await api.post(`/leave/leaves/${id}/submit`);
      toast.success('Leave submitted for approval');
      fetchLeaves();
      fetchBalance();
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to submit'); }
  };

  const approveLeave = async (id: string) => {
    try {
      await api.post(`/leave/leaves/${id}/approve`);
      toast.success('Leave approved');
      setViewRow(null);
      fetchBalance();
      if (activeTab === 'Subordinate Leave') fetchSubordinate();
      else fetchLeaves();
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to approve'); }
  };

  const openReject = (id: string) => { setRejectId(id); setRejectReason(''); setViewRow(null); };
  const confirmReject = async () => {
    if (!rejectId) return;
    try {
      await api.post(`/leave/leaves/${rejectId}/reject`, { reason: rejectReason });
      toast.success('Leave rejected');
      setRejectId(null);
      fetchBalance();
      if (activeTab === 'Subordinate Leave') fetchSubordinate();
      else fetchLeaves();
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to reject'); }
  };

  const cancelLeave = (id: string) => {
    askConfirm('Cancel Leave', 'This will cancel the approved leave. The employee will be notified.', async () => {
      try {
        await api.post(`/leave/leaves/${id}/cancel`);
        toast.success('Leave cancelled');
        fetchLeaves();
        fetchBalance();
      } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to cancel'); }
    }, { label: 'Cancel Leave', variant: 'warning' });
  };

  const deleteLeave = (id: string) => {
    askConfirm('Delete Leave Application', 'This leave record will be permanently removed. This cannot be undone.', async () => {
      try {
        await api.delete(`/leave/leaves/${id}`);
        toast.success('Deleted');
        fetchLeaves();
        fetchBalance();
      } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to delete'); }
    }, { label: 'Delete' });
  };

  const retryLeaveGL = async (id: string) => {
    try {
      const res = await api.post(`/leave/leaves/${id}/retry-gl`);
      const status = res.data?.data?.allowance_status;
      if (status === 'Failed GL Posting') {
        toast.error('GL posting failed again — check server logs');
      } else {
        toast.success('GL posted successfully');
      }
      fetchLeaves();
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to retry GL'); }
  };

  const filtered = leaves.filter(r =>
    JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full">
      <PageHeader title="Leave" subtitle="Manage leave requests and approvals." />

      <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {/* ── Leave Entitlement ── */}
      {activeTab === 'Leave Entitlement' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[var(--border)] shrink-0">
            <h3 className="font-bold text-[var(--text-primary)]">Leave Entitlement</h3>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">Your leave balance for the current active period.</p>
          </div>
          {balance.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-[var(--text-muted)]">No leave balance data. Ensure an active leave period is set.</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {balance.map((b: any, i: number) => {
                const color = b.leave_color || '#185FA5';
                const allocated = Number(b.allocated ?? 0);
                const used = Number(b.used ?? 0);
                const pending = Number(b.pending ?? 0);
                const remaining = Number(b.balance ?? 0);
                const consumed = Math.max(0, used + pending);
                const consumedPct = allocated > 0 ? Math.min(100, (consumed / allocated) * 100) : 0;
                const usedPct    = allocated > 0 ? Math.min(100, (used / allocated) * 100) : 0;
                const progressLabel = `${consumedPct.toFixed(consumedPct % 1 ? 1 : 0)}%`;
                const radius = 46;
                const circumference = 2 * Math.PI * radius;
                const dashOffset     = circumference - (consumedPct / 100) * circumference;
                const usedDashOffset = circumference - (usedPct    / 100) * circumference;
                const isNeg = remaining < 0;
                const dayLabel = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}d`;
                const chips = [
                  b.leave_accrue === 'Yes' ? 'Accrual' : null,
                  b.carried_forward === 'Yes'
                    ? `CF ${b.carried_forward_percentage ?? 100}%${Number(b.max_carried_forward_amount ?? 0) > 0 ? ` / max ${b.max_carried_forward_amount}d` : ''}`
                    : null,
                  b.propotionate_on_joined_date === 'Yes' ? 'Prorated' : null,
                  b.apply_beyond_current === 'Yes' ? 'Beyond balance' : null,
                  b.supervisor_leave_assign === 'Yes' ? 'Supervisor assign' : null,
                  b.has_rule ? 'Rule applied' : null,
                ].filter(Boolean);

                return (
                  <motion.div
                    key={i}
                    className="relative flex flex-col rounded-[14px] border p-4 shadow-sm cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--accent)]/30"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: i * 0.06 }}
                    onClick={() => setBalanceDetail(b)}
                  >
                    {/* Decorative accents in the leave type color — kept subtle for a professional look */}
                    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[14px]">
                      {/* Faint diagonal wash from the top-right corner */}
                      <span className="absolute inset-0" style={{ background: `linear-gradient(225deg, color-mix(in srgb, ${color} 7%, transparent), transparent 45%)` }} />
                      {/* Fine concentric hairline arcs in the top-right corner */}
                      <svg className="absolute -top-12 -right-12 h-36 w-36" viewBox="0 0 144 144">
                        <circle cx="72" cy="72" r="52" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${color} 22%, transparent)` }} />
                        <circle cx="72" cy="72" r="64" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${color} 14%, transparent)` }} />
                      </svg>
                    </div>

                    {/* 1. Header row */}
                    <div className="flex items-center gap-2 min-w-0 mb-0.5">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                      <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{b.name}</p>
                    </div>

                    {/* 2. Sub-header — always reserves space */}
                    <div className="mb-3 min-h-[16px]">
                      {b.period_name && (
                        <p className="truncate text-[11px] text-[var(--text-muted)] ml-4">{b.period_name}</p>
                      )}
                    </div>

                    {/* 3. Chart zone — fixed height */}
                    <div className="flex justify-center mb-3">
                      <div className="relative h-[116px] w-[116px]">
                        <svg className="-rotate-90" width="116" height="116" viewBox="0 0 116 116" aria-hidden="true">
                          {/* Layer 1 — full circle in light gray = remaining/unused */}
                          <circle cx="58" cy="58" r={radius} fill="none" stroke="#cbd5e1" strokeWidth="10" />
                          {/* Layer 2 — arc (0 → consumed) in lighter tint of leave color = pending zone */}
                          {consumedPct > 0 && (
                            <motion.circle
                              cx="58" cy="58" r={radius} fill="none"
                              stroke={`color-mix(in srgb, ${color} 35%, #ffffff)`}
                              strokeWidth="10" strokeLinecap="round"
                              strokeDasharray={circumference}
                              initial={{ strokeDashoffset: circumference }}
                              animate={{ strokeDashoffset: dashOffset }}
                              transition={{ duration: 1.1, ease: [0.4, 0, 0.2, 1], delay: i * 0.06 }}
                            />
                          )}
                          {/* Layer 3 — arc (0 → used) in full leave type color = used/approved zone */}
                          {usedPct > 0 && (
                            <motion.circle
                              cx="58" cy="58" r={radius} fill="none"
                              stroke={color}
                              strokeWidth="10" strokeLinecap="round"
                              strokeDasharray={circumference}
                              initial={{ strokeDashoffset: circumference }}
                              animate={{ strokeDashoffset: usedDashOffset }}
                              transition={{ duration: 1.1, ease: [0.4, 0, 0.2, 1], delay: i * 0.06 }}
                            />
                          )}
                        </svg>
                        <motion.div
                          className="absolute inset-0 flex flex-col items-center justify-center"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.35, delay: i * 0.06 + 0.25 }}
                        >
                          <span className="text-[19px] font-semibold tabular-nums leading-none" style={{ color: isNeg ? 'var(--danger)' : color }}>
                            {dayLabel(remaining)}
                          </span>
                          <span className="mt-1 text-[10px] text-[var(--text-muted)]">{progressLabel} used</span>
                        </motion.div>
                      </div>
                    </div>

                    {/* 4. Stats row */}
                    <div className="w-full grid grid-cols-2 sm:grid-cols-4 overflow-hidden rounded-[10px] border border-[var(--border)]">
                      {[
                        { label: 'Left',      value: dayLabel(remaining), tint: isNeg ? 'var(--danger)' : color },
                        { label: 'Allocated', value: dayLabel(allocated),  tint: 'var(--text-primary)' },
                        { label: 'Approved',  value: dayLabel(used),       tint: 'var(--text-primary)' },
                        { label: 'Pending',   value: dayLabel(pending),    tint: pending > 0 ? `color-mix(in srgb, ${color} 65%, #92400e)` : 'var(--text-muted)' },
                      ].map((stat, si) => (
                        <div key={stat.label} className={`min-w-0 overflow-hidden px-2.5 py-2${si > 0 ? ' border-l border-[var(--border)]' : ''}`}>
                          <p className="text-[13px] font-semibold tabular-nums leading-none truncate" style={{ color: stat.tint }}>{stat.value}</p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] truncate">{stat.label}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
            </div>
          )}
        </div>
      )}

      {/* ── Leave Entitlement Detail ── */}
      <DetailSlideOver
        open={!!balanceDetail}
        title={balanceDetail?.name ?? ''}
        subtitle={balanceDetail?.period_name}
        onClose={() => setBalanceDetail(null)}
      >
        {balanceDetail && (() => {
          const b = balanceDetail;
          const color = b.leave_color || '#185FA5';
          const allocated = Number(b.allocated ?? 0);
          const used = Number(b.used ?? 0);
          const pending = Number(b.pending ?? 0);
          const remaining = Number(b.balance ?? 0);
          const consumed = Math.max(0, used + pending);
          const consumedPct = allocated > 0 ? Math.min(100, (consumed / allocated) * 100) : 0;
          const usedPct     = allocated > 0 ? Math.min(100, (used    / allocated) * 100) : 0;
          const isNeg = remaining < 0;
          const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
          const row = (label: string, value: React.ReactNode) => (
            <div key={label} className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-0 text-[13px]">
              <span className="text-[var(--text-muted)]">{label}</span>
              <span className="font-medium text-[var(--text-primary)] text-right">{value}</span>
            </div>
          );
          return (
            <div className="space-y-5">
              {/* Progress bar — three zones matching the donut */}
              <div>
                <div className="flex items-center justify-between mb-1.5 text-[12px]">
                  <span className="text-[var(--text-muted)]">Usage</span>
                  <span className="font-semibold" style={{ color }}>{consumedPct.toFixed(consumedPct % 1 ? 1 : 0)}% used</span>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: '#cbd5e1' }}>
                  {/* Used/approved — full leave color */}
                  {usedPct > 0 && (
                    <div className="h-full rounded-l-full" style={{ width: `${usedPct}%`, background: color, flexShrink: 0 }} />
                  )}
                  {/* Pending — lighter tint */}
                  {(consumedPct - usedPct) > 0 && (
                    <div className="h-full" style={{ width: `${consumedPct - usedPct}%`, background: `color-mix(in srgb, ${color} 35%, #ffffff)`, flexShrink: 0 }} />
                  )}
                  {/* Remaining — gray background shows through */}
                </div>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-[var(--text-muted)]">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />Approved</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: `color-mix(in srgb, ${color} 35%, #ffffff)` }} />Pending</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#cbd5e1]" />Remaining</span>
                </div>
              </div>

              {/* Balance stats */}
              <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
                <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Balance</p>
                </div>
                <div className="px-4 divide-y divide-[var(--border)]">
                  {row('Allocated', `${fmt(allocated)} days`)}
                  {row('Approved', `${fmt(used)} days`)}
                  {row('Pending', `${fmt(pending)} days`)}
                  {row('Remaining', <span style={{ color: isNeg ? 'var(--danger)' : color, fontWeight: 600 }}>{fmt(remaining)} days</span>)}
                  {Number(b.carry_forward_days ?? 0) > 0 && row('Carried forward', `${fmt(Number(b.carry_forward_days))} days`)}
                </div>
              </div>

              {/* Tags / feature pills */}
              {(() => {
                const tags = [
                  b.leave_accrue === 'Yes' ? 'Accrual' : null,
                  b.carried_forward === 'Yes'
                    ? `CF ${b.carried_forward_percentage ?? 100}%${Number(b.max_carried_forward_amount ?? 0) > 0 ? ` / max ${b.max_carried_forward_amount}d` : ''}`
                    : null,
                  b.propotionate_on_joined_date === 'Yes' ? 'Prorated' : null,
                  b.apply_beyond_current === 'Yes' ? 'Beyond balance' : null,
                  b.supervisor_leave_assign === 'Yes' ? 'Supervisor assign' : null,
                  b.has_rule ? 'Rule applied' : null,
                ].filter(Boolean);
                if (!tags.length) return null;
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map(tag => (
                      <span
                        key={String(tag)}
                        className="rounded-full px-2.5 py-[3px] text-[11px] font-medium"
                        style={{ border: `2px solid color-mix(in srgb, ${color} 40%, transparent)`, color }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                );
              })()}

              {/* Policy */}
              <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
                <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Policy</p>
                </div>
                <div className="px-4 divide-y divide-[var(--border)]">
                  {row('Carry-forward', b.carried_forward === 'Yes'
                    ? `${b.carried_forward_percentage ?? 100}%${Number(b.max_carried_forward_amount ?? 0) > 0 ? ` / max ${b.max_carried_forward_amount}d` : ''}`
                    : 'No')}
                  {row('Accrual', b.leave_accrue === 'Yes' ? 'Yes' : 'No')}
                  {row('Prorated on join date', b.propotionate_on_joined_date === 'Yes' ? 'Yes' : 'No')}
                  {row('Can go beyond balance', b.apply_beyond_current === 'Yes' ? 'Yes' : 'No')}
                  {row('Supervisor can assign', b.supervisor_leave_assign === 'Yes' ? 'Yes' : 'No')}
                  {b.has_rule && row('Rule applied', 'Yes')}
                </div>
              </div>

              {/* Allowance */}
              {b.allowance_enabled && (
                <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
                  <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Leave Allowance</p>
                  </div>
                  <div className="px-4 divide-y divide-[var(--border)]">
                    {row('Gross', Number(b.allowance_gross ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 }))}
                    {Number(b.allowance_tax ?? 0) > 0 && row('Tax deducted', `(${Number(b.allowance_tax).toLocaleString(undefined, { minimumFractionDigits: 2 })})`)}
                    {row('Net payout', <span style={{ fontWeight: 600 }}>{Number(b.allowance_amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>)}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </DetailSlideOver>

      {/* ── All other tabs (leave list) ── */}
      {activeTab !== 'Leave Entitlement' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden min-h-[500px] flex flex-col">
          <TableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search leaves..."
            searchWidth="sm:w-[280px]"
            actions={
              activeTab === 'Subordinate Leave' ? (
                <button className="primary-btn shrink-0" onClick={() => { setShowAssign(true); setAssignForm({ employee: '', leave_type: '', date_start: '', date_end: '', details: '' }); }}>
                  Assign Leave
                </button>
              ) : (activeTab === 'All my Leave' || activeTab === 'Pending Leave') ? (
                <button className="primary-btn shrink-0" onClick={() => setShowApply(true)}>
                  Apply Leave
                </button>
              ) : undefined
            }
          />

          <div className="overflow-x-auto flex-1">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <SortableHeader>Employee</SortableHeader>
                  <SortableHeader>Leave Type</SortableHeader>
                  <SortableHeader>Start</SortableHeader>
                  <SortableHeader>End</SortableHeader>
                  <th className="th text-center" style={{ width: '6%' }}>Days</th>
                  <th className="th" style={{ width: '14%', textAlign: 'right' }}>Allowance</th>
                  <SortableHeader>Status</SortableHeader>
                  <th scope="col" className="th" style={{ textAlign: 'right' }}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="td text-center text-[var(--text-muted)] py-10">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="td text-center text-[var(--text-muted)] py-10">No leaves found.</td></tr>
                ) : filtered.map((row) => (
                  <tr key={row.id} className="tr">
                    <td className="td text-[var(--text-primary)] font-medium">{row.employee_name || row.employee}</td>
                    <td className="td">
                      <div className="flex items-center gap-1.5">
                        {row.leave_color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.leave_color }} />}
                        <span>{row.leave_type_name || '—'}</span>
                      </div>
                    </td>
                    <td className="td">{fmtDate(row.date_start)}</td>
                    <td className="td">{fmtDate(row.date_end)}</td>
                    <td className="td text-center">{Number(row.day_count ?? 0)}</td>
                    <td className="td text-right">
                      {row.allowance_status === 'Failed GL Posting' ? (
                        <span className="pill bg-red-500/10 text-red-700 border border-red-200/50 text-[11px]">GL Failed</span>
                      ) : row.leave_type_allowance_enabled === 'Yes' && Number(row.amount) > 0 ? (
                        <>
                          <p className="font-semibold tabular-nums text-[var(--success)] text-[13px] leading-snug">
                            {money(row.amount)}
                          </p>
                          {Number(row.allowance_tax) > 0 && (
                            <p className="text-[11px] tabular-nums text-[var(--text-muted)] leading-snug mt-0.5">
                              Tax: {Number(row.allowance_tax).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="td"><StatusPill status={row.status} /></td>
                    <td className="td text-right">
                      <div className="flex justify-end">
                        <RowActions actions={[
                          { label: 'View', icon: Eye, onClick: () => setViewRow(row) },
                          { label: 'Retry GL Posting', icon: RefreshCw, danger: true, onClick: () => retryLeaveGL(row.id), hidden: !(isAdmin && row.allowance_status === 'Failed GL Posting') },
                          { label: 'Submit for Approval', icon: SendHorizonal, onClick: () => submitLeave(row.id), hidden: !['Draft', 'Pending'].includes(row.status) },
                          { label: 'Edit', icon: FileEdit, onClick: () => openEdit(row), hidden: !['Pending', 'Draft'].includes(row.status) },
                          { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteLeave(row.id), hidden: !['Pending', 'Draft'].includes(row.status) },
                          { label: 'Cancel Leave', icon: XCircle, danger: true, onClick: () => cancelLeave(row.id), hidden: row.status !== 'Approved' },
                        ]} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePagination total={leaves.length} filtered={filtered.length} />
        </div>
      )}

      {/* ── Apply Leave Modal ── */}
      {showApply && (
        <FormModal
          title="Apply for Leave"
          subtitle="Submit a new leave request."
          onClose={() => { setShowApply(false); setApplyForm({ leave_type: '', date_start: '', date_end: '', details: '' }); }}
          onSave={openConfirmation}
          saveLabel="Review →"
          maxWidth="lg"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <FormField label="Leave Type" required className="col-span-full">
              <SearchSelect
                value={applyForm.leave_type}
                onChange={v => setApplyForm(p => ({ ...p, leave_type: v }))}
                options={leaveTypes.map((t: any) => ({ id: String(t.id), label: t.name }))}
                placeholder="Search leave type…"
              />
            </FormField>

            {(() => {
              const activePeriod = leavePeriods[0];
              const minDate = activePeriod ? String(activePeriod.date_start).substring(0, 10) : undefined;
              const maxDate = activePeriod ? String(activePeriod.date_end  ).substring(0, 10) : undefined;
              return (<>
                <FormField label="Start Date" required hint={activePeriod ? `Within ${activePeriod.name}` : 'No active leave period'}>
                  <input
                    type="date" className={inputClass}
                    value={applyForm.date_start}
                    min={minDate} max={maxDate}
                    onChange={e => setApplyForm(p => ({ ...p, date_start: e.target.value, date_end: p.date_end && e.target.value > p.date_end ? e.target.value : p.date_end }))}
                  />
                </FormField>
                <FormField label="End Date" required hint={activePeriod ? `Within ${activePeriod.name}` : undefined}>
                  <input
                    type="date" className={inputClass}
                    value={applyForm.date_end}
                    min={applyForm.date_start || minDate} max={maxDate}
                    onChange={e => setApplyForm(p => ({ ...p, date_end: e.target.value }))}
                  />
                </FormField>
              </>);
            })()}

            {applyForm.date_start && applyForm.date_end && (() => {
              const start = new Date(applyForm.date_start + 'T00:00:00');
              const end   = new Date(applyForm.date_end   + 'T00:00:00');
              if (end < start) return (
                <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">
                  End date must be on or after start date.
                </div>
              );
              return (
                <div className="col-span-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                        {previewDays !== null ? `${previewDays} working day${previewDays !== 1 ? 's' : ''}` : '—'}
                      </span>
                      {previewHolidays.length > 0 && (
                        <span className="text-[11px] text-amber-600 font-medium">
                          (+ {previewHolidays.length} public holiday{previewHolidays.length !== 1 ? 's' : ''} excluded)
                        </span>
                      )}
                    </div>
                    {previewPeriod && <span className="pill pill-success text-[11px]">{previewPeriod.name}</span>}
                  </div>
                  {previewHolidays.length > 0 && (
                    <div className="pt-1 border-t border-[var(--border-light)]">
                      <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-1.5">Public holidays in this range</p>
                      <div className="flex flex-col gap-1">
                        {previewHolidays.map((h, i) => (
                          <div key={i} className="flex items-center justify-between text-[12px]">
                            <span className="text-[var(--text-primary)] font-medium">{h.name}</span>
                            <span className="text-[var(--text-muted)]">{h._date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <FormField label="Details" className="col-span-full">
              <textarea className={inputClass} rows={3} value={applyForm.details}
                onChange={e => setApplyForm(p => ({ ...p, details: e.target.value }))}
                placeholder="Reason for leave (optional)" />
            </FormField>
          </div>
        </FormModal>
      )}

      {/* ── Leave Confirmation Modal ── */}
      <AnimatePresence>
        {showConfirm && (() => {
          const selType    = leaveTypes.find((t: any) => String(t.id) === String(applyForm.leave_type));
          const selBalance = balance.find((b: any) => String(b.leave_type_id ?? b.id) === String(applyForm.leave_type));
          const accent     = selType?.leave_color || '#2563eb';
          const nonWorkingCount = confirmBreakdown.filter(d => d.type === 'Non working day' || d.type === 'Holiday').length;

          const closeConfirm = () => { setShowConfirm(false); setShowApply(true); };

          return (
            <motion.div
              key="confirm-overlay"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[300] flex items-center justify-center p-4"
            >
              {/* Backdrop */}
              <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={closeConfirm} />

              {/* Modal */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }} transition={{ duration: 0.22, ease: 'easeOut' }}
                className="relative z-10 w-full max-w-2xl max-h-[92vh] flex flex-col bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden"
                style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.2)' }}
              >
                {/* Top accent bar */}
                <div className="h-1 w-full shrink-0" style={{ background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 60%, #7c3aed))` }} />

                {/* Header */}
                <div className="px-6 pt-5 pb-4 border-b border-[var(--border)] flex items-start justify-between gap-4 shrink-0">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)` }}>
                      <CalendarDays className="w-5 h-5" style={{ color: accent }} />
                    </div>
                    <div>
                      <h2 className="text-[16px] font-bold text-[var(--text-primary)]">Review Leave Application</h2>
                      <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                        Please review the details below before confirming your submission.
                      </p>
                    </div>
                  </div>
                  <button onClick={closeConfirm}
                    className="w-8 h-8 rounded-xl bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all shrink-0">
                    <X size={14} />
                  </button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                  {/* Leave type + date range banner */}
                  <div className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
                    style={{ background: `color-mix(in srgb, ${accent} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)` }}>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accent }} />
                        <span className="text-[14px] font-bold text-[var(--text-primary)]">{selType?.name ?? 'Leave'}</span>
                      </div>
                      <p className="text-[12px] text-[var(--text-muted)] ml-[18px]">
                        {fmtDate(applyForm.date_start)} → {fmtDate(applyForm.date_end)}
                        {previewPeriod && <span className="ml-2 font-medium" style={{ color: accent }}>· {previewPeriod.name}</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[28px] font-bold tabular-nums leading-none" style={{ color: accent }}>{previewDays ?? 0}</p>
                      <p className="text-[11px] font-semibold mt-0.5" style={{ color: accent }}>working day{previewDays !== 1 ? 's' : ''}</p>
                      {nonWorkingCount > 0 && (
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{nonWorkingCount} excluded</p>
                      )}
                    </div>
                  </div>

                  {/* Balance summary */}
                  {selBalance && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2.5">Leave Summary</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {[
                          { label: 'Approved', value: selBalance.used ?? 0,    icon: CheckCircle2, clr: '#64748b', bg: 'var(--surface-hover)', bdr: 'var(--border)' },
                          { label: 'Pending',  value: selBalance.pending ?? 0, icon: Clock4,       clr: '#d97706', bg: '#fffbeb',              bdr: '#fde68a'       },
                          { label: 'Available',value: selBalance.balance ?? 0, icon: CalendarDays, clr: '#059669', bg: '#f0fdf4',              bdr: '#a7f3d0'       },
                        ].map(({ label, value, icon: Icon, clr, bg, bdr }) => (
                          <div key={label} className="rounded-xl px-4 py-3" style={{ background: bg, border: `1px solid ${bdr}` }}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: clr }} />
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: clr }}>{label}</span>
                            </div>
                            <p className="text-[22px] font-bold tabular-nums leading-none" style={{ color: clr }}>{value}</p>
                            <p className="text-[10px] mt-0.5" style={{ color: clr }}>day{value !== 1 ? 's' : ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Per-day table */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2.5">Leave Dates</p>
                    <div className="rounded-xl border border-[var(--border)] overflow-hidden">
                      <table className="w-full text-[12.5px]">
                        <thead>
                          <tr className="bg-[var(--bg)]">
                            <th className="text-left px-4 py-2.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">Date</th>
                            <th className="text-left px-4 py-2.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">Day</th>
                            <th className="text-left px-4 py-2.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">Leave Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {confirmBreakdown.map((row, i) => {
                            const isOff = row.type === 'Non working day' || row.type === 'Holiday';
                            return (
                              <tr key={i} className="border-b border-[var(--border)] last:border-0"
                                style={{ background: isOff ? 'color-mix(in srgb, var(--danger) 4%, transparent)' : undefined }}>
                                <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">
                                  {new Date(row.dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </td>
                                <td className="px-4 py-2.5 text-[var(--text-secondary)]">{row.dayName}</td>
                                <td className="px-4 py-2.5">
                                  {row.type === 'Non working day' ? (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-cyan-100 text-cyan-700 border border-cyan-200">Non working day</span>
                                  ) : row.type === 'Holiday' ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
                                      {row.holidayName ?? 'Public Holiday'}
                                    </span>
                                  ) : row.type === 'Half Day' ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold bg-purple-100 text-purple-700 border border-purple-200">Half Day</span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
                                      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: accent }} />
                                      Full Day
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Notes */}
                  {applyForm.details && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Leave Notes</p>
                      <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                        {applyForm.details}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
                  <button onClick={closeConfirm}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-[var(--text-secondary)] bg-[var(--surface-hover)] hover:bg-[var(--bg)] border border-[var(--border)] transition-all">
                    ← Back
                  </button>
                  <button onClick={applyLeave} disabled={saving}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-bold text-white transition-all disabled:opacity-60 shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 70%, #7c3aed))`, boxShadow: `0 4px 14px color-mix(in srgb, ${accent} 35%, transparent)` }}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {saving ? 'Submitting…' : 'Confirm & Submit'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Edit Leave Modal ── */}
      {showEdit && (
        <FormModal
          title="Edit Leave"
          subtitle="Update your leave request. Only Pending leaves can be edited."
          onClose={() => setShowEdit(false)}
          onSave={updateLeave}
          saveLabel={saving ? 'Saving…' : 'Save Changes'}
          maxWidth="lg"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <FormField label="Leave Type" required className="col-span-full">
              <SearchSelect
                value={editForm.leave_type}
                onChange={v => setEditForm(p => ({ ...p, leave_type: v }))}
                options={leaveTypes.map((t: any) => ({ id: String(t.id), label: t.name }))}
                placeholder="Search leave type…"
              />
            </FormField>

            {(() => {
              const activePeriod = leavePeriods[0];
              const minDate = activePeriod ? String(activePeriod.date_start).substring(0, 10) : undefined;
              const maxDate = activePeriod ? String(activePeriod.date_end  ).substring(0, 10) : undefined;
              return (<>
                <FormField label="Start Date" required hint={activePeriod ? `Within ${activePeriod.name}` : 'No active leave period'}>
                  <input
                    type="date" className={inputClass}
                    value={editForm.date_start}
                    min={minDate} max={maxDate}
                    onChange={e => setEditForm(p => ({ ...p, date_start: e.target.value, date_end: p.date_end && e.target.value > p.date_end ? e.target.value : p.date_end }))}
                  />
                </FormField>
                <FormField label="End Date" required hint={activePeriod ? `Within ${activePeriod.name}` : undefined}>
                  <input
                    type="date" className={inputClass}
                    value={editForm.date_end}
                    min={editForm.date_start || minDate} max={maxDate}
                    onChange={e => setEditForm(p => ({ ...p, date_end: e.target.value }))}
                  />
                </FormField>
              </>);
            })()}

            {/* Live duration preview */}
            {editForm.date_start && editForm.date_end && (() => {
              const start = new Date(editForm.date_start + 'T00:00:00');
              const end   = new Date(editForm.date_end   + 'T00:00:00');
              if (end < start) return (
                <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">
                  End date must be on or after start date.
                </div>
              );
              return (
                <div className="col-span-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                        {previewDays !== null ? `${previewDays} working day${previewDays !== 1 ? 's' : ''}` : '—'}
                      </span>
                      {previewHolidays.length > 0 && (
                        <span className="text-[11px] text-amber-600 font-medium">
                          (+ {previewHolidays.length} public holiday{previewHolidays.length !== 1 ? 's' : ''} excluded)
                        </span>
                      )}
                    </div>
                    {previewPeriod && <span className="pill pill-success text-[11px]">{previewPeriod.name}</span>}
                  </div>
                  {previewHolidays.length > 0 && (
                    <div className="pt-1 border-t border-[var(--border-light)]">
                      <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-1.5">Public holidays in this range</p>
                      <div className="flex flex-col gap-1">
                        {previewHolidays.map((h, i) => (
                          <div key={i} className="flex items-center justify-between text-[12px]">
                            <span className="text-[var(--text-primary)] font-medium">{h.name}</span>
                            <span className="text-[var(--text-muted)]">{h._date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <FormField label="Details" className="col-span-full">
              <CountedTextarea className={inputClass} rows={3} maxChars={1000} value={editForm.details}
                onChange={e => setEditForm(p => ({ ...p, details: e.target.value }))}
                placeholder="Reason for leave (optional)" />
            </FormField>
          </div>
        </FormModal>
      )}

      {/* ── Assign Leave Modal (supervisor → subordinate) ── */}
      {showAssign && (
        <FormModal
          title="Assign Leave"
          subtitle="Apply leave on behalf of a direct report."
          onClose={() => { setShowAssign(false); setAssignForm({ employee: '', leave_type: '', date_start: '', date_end: '', details: '' }); }}
          onSave={assignLeave}
          saveLabel={saving ? 'Assigning…' : 'Assign Leave'}
          maxWidth="lg"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <FormField label="Employee" required className="col-span-full">
              <SearchSelect
                value={assignForm.employee}
                onChange={v => setAssignForm(p => ({ ...p, employee: v }))}
                options={subordinates.map((s: any) => ({ id: String(s.id), label: s.name || `${s.employee_code || ''}`.trim() || String(s.id) }))}
                placeholder="Search subordinate…"
              />
            </FormField>

            <FormField label="Leave Type" required className="col-span-full">
              <SearchSelect
                value={assignForm.leave_type}
                onChange={v => setAssignForm(p => ({ ...p, leave_type: v }))}
                options={leaveTypes.filter((t: any) => t.supervisor_leave_assign === 'Yes').map((t: any) => ({ id: String(t.id), label: t.name }))}
                placeholder="Search leave type…"
              />
            </FormField>

            {(() => {
              const activePeriod = leavePeriods[0];
              const minDate = activePeriod ? String(activePeriod.date_start).substring(0, 10) : undefined;
              const maxDate = activePeriod ? String(activePeriod.date_end  ).substring(0, 10) : undefined;
              return (<>
                <FormField label="Start Date" required hint={activePeriod ? `Within ${activePeriod.name}` : 'No active leave period'}>
                  <input type="date" className={inputClass} value={assignForm.date_start}
                    min={minDate} max={maxDate}
                    onChange={e => setAssignForm(p => ({ ...p, date_start: e.target.value, date_end: p.date_end && e.target.value > p.date_end ? e.target.value : p.date_end }))}
                  />
                </FormField>
                <FormField label="End Date" required hint={activePeriod ? `Within ${activePeriod.name}` : undefined}>
                  <input type="date" className={inputClass} value={assignForm.date_end}
                    min={assignForm.date_start || minDate} max={maxDate}
                    onChange={e => setAssignForm(p => ({ ...p, date_end: e.target.value }))}
                  />
                </FormField>
              </>);
            })()}

            {/* Live duration preview shared with apply form */}
            {assignForm.date_start && assignForm.date_end && (() => {
              const start = new Date(assignForm.date_start + 'T00:00:00');
              const end   = new Date(assignForm.date_end   + 'T00:00:00');
              if (end < start) return (
                <div className="col-span-full rounded-[10px] border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[12px] text-[var(--danger)]">
                  End date must be on or after start date.
                </div>
              );
              return (
                <div className="col-span-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                      {previewDays !== null ? `${previewDays} working day${previewDays !== 1 ? 's' : ''}` : '—'}
                    </span>
                    {previewPeriod && <span className="pill pill-success text-[11px]">{previewPeriod.name}</span>}
                  </div>
                </div>
              );
            })()}

            <FormField label="Details" className="col-span-full">
              <CountedTextarea className={inputClass} rows={3} maxChars={1000} value={assignForm.details}
                onChange={e => setAssignForm(p => ({ ...p, details: e.target.value }))}
                placeholder="Reason / notes (optional)" />
            </FormField>
          </div>
        </FormModal>
      )}

      {/* ── View Leave Detail ── */}
      <DetailSlideOver
        open={!!viewRow}
        title="Leave Details"
        subtitle={viewRow ? (viewRow.employee_name || 'Employee') : undefined}
        onClose={() => setViewRow(null)}
        footerActions={viewRow ? (
          viewRow.allowance_status === 'Failed GL Posting' && isAdmin ? (
            <button
              className="primary-btn shadow-sm bg-red-600 hover:opacity-90"
              onClick={() => { retryLeaveGL(viewRow.id); setViewRow(null); }}
            >
              <RefreshCw size={14} className="mr-1.5 inline" />Retry GL Posting
            </button>
          ) : viewRow.status === 'Pending Approval' && String(viewRow?.employee) !== String(currentUser?.employeeId) ? (
            <>
              <button
                className="secondary-btn shadow-sm text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5"
                onClick={() => openReject(viewRow.id)}
              >
                <X size={14} className="mr-1.5 inline" />Reject
              </button>
              <button
                className="primary-btn shadow-sm bg-[var(--success)] hover:opacity-90"
                onClick={() => approveLeave(viewRow.id)}
              >
                <Check size={14} className="mr-1.5 inline" />Approve
              </button>
            </>
          ) : undefined
        ) : undefined}
      >
        {viewRow && (() => {
          const accent = viewRow.leave_color || '#185FA5';
          const dayCount = Number(viewRow.day_count ?? 0);
          return (
          <div className="space-y-5">

            {/* Banner — leave type + date range + day count */}
            <div className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
              style={{ background: `color-mix(in srgb, ${accent} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: accent }} />
                  <span className="text-[14px] font-bold text-[var(--text-primary)] truncate">
                    {viewRow.leave_type_name || viewRow.leave_type || 'Leave'}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--text-muted)] ml-[18px]">
                  {fmtDate(viewRow.date_start)} → {fmtDate(viewRow.date_end)}
                  {viewRow.period_name && <span className="ml-2 font-medium" style={{ color: accent }}>· {viewRow.period_name}</span>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[28px] font-bold tabular-nums leading-none" style={{ color: accent }}>{dayCount}</p>
                <p className="text-[11px] font-semibold mt-0.5" style={{ color: accent }}>working day{dayCount !== 1 ? 's' : ''}</p>
              </div>
            </div>

            {/* Status + Employee */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[12px] border border-[var(--border)] px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Status</p>
                <StatusPill status={viewRow.status} />
              </div>
              <div className="rounded-[12px] border border-[var(--border)] px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Employee</p>
                <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{viewRow.employee_name || viewRow.employee || '—'}</p>
              </div>
            </div>

            {/* Leave details card */}
            <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Details</p>
              </div>
              <div className="px-4 divide-y divide-[var(--border)]">
                {([
                  ['Start Date',    fmtDate(viewRow.date_start)],
                  ['End Date',      fmtDate(viewRow.date_end)],
                  ['Working Days',  `${dayCount} day${dayCount !== 1 ? 's' : ''}`],
                  ['Period',        viewRow.period_name || '—'],
                ] as [string, string][]).map(([label, val]) => (
                  <div key={label} className="flex items-start justify-between py-2.5 text-[13px] gap-4">
                    <span className="text-[var(--text-muted)] shrink-0">{label}</span>
                    <span className="font-medium text-[var(--text-primary)] text-right">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            {viewRow.details && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Notes</p>
                <div className="rounded-xl bg-[var(--bg)] border border-[var(--border)] px-4 py-3 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  {viewRow.details}
                </div>
              </div>
            )}

            {/* Rejection reason */}
            {viewRow.status === 'Rejected' && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--danger)] mb-2">Rejection Reason</p>
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700 leading-relaxed whitespace-pre-wrap">
                  {viewRow.rejection_reason || 'No reason was provided.'}
                </div>
              </div>
            )}

            {/* Allowance breakdown */}
            {!['Subordinate Leave', 'Cancellation Request'].includes(activeTab) &&
              viewRow.leave_type_allowance_enabled === 'Yes' && Number(viewRow.allowance_basic) > 0 && (
              <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50 border-b border-emerald-100">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Leave Allowance</p>
                  {viewRow.allowance_status && (() => {
                    const s = viewRow.allowance_status;
                    const label = s === 'Pre-enable Skip' ? 'Not Eligible (pre-dates enablement)' : s;
                    const cls   = s === 'Paid' ? 'pill-success'
                                : s === 'Pre-enable Skip' ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200';
                    return <span className={`pill text-[10px] ${cls}`}>{label}</span>;
                  })()}
                </div>
                <div className="px-4 py-3 bg-[var(--bg)] space-y-1.5">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-[var(--text-secondary)]">Basic Salary (monthly)</span>
                    <span className="font-semibold tabular-nums">{Number(viewRow.allowance_basic).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {viewRow.allowance_annual_factor && (
                    <div className="text-[11px] text-[var(--text-muted)] pl-2">
                      × 12 months × {(Number(viewRow.allowance_annual_factor) * 100).toFixed(0)}% annual factor
                    </div>
                  )}
                  {Number(viewRow.allowance_gross) > 0 && (
                    <div className="flex justify-between text-[12px] border-t border-[var(--border-light)] pt-1.5">
                      <span className="font-medium">Gross Allowance</span>
                      <span className="font-bold tabular-nums">{Number(viewRow.allowance_gross).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-muted)]">Less: non-taxable (basic)</span>
                    <span className="tabular-nums text-[var(--text-muted)]">({Number(viewRow.allowance_basic).toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </div>
                  {Number(viewRow.allowance_tax) > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[var(--danger)]">Tax{viewRow.allowance_tax_rate ? ` (${(Number(viewRow.allowance_tax_rate) * 100).toFixed(0)}%)` : ''}</span>
                      <span className="font-semibold tabular-nums text-[var(--danger)]">({Number(viewRow.allowance_tax).toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[13px] font-bold border-t border-[var(--border)] pt-2 mt-0.5">
                    <span>Net Payout</span>
                    <span className="tabular-nums text-[var(--success)]">{Number(viewRow.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {viewRow.documentref && (
                    <div className="flex justify-between text-[11px] border-t border-[var(--border-light)] pt-1.5 text-[var(--text-muted)]">
                      <span>GL Reference</span>
                      <span className="font-mono tracking-wide">{viewRow.documentref}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          );
        })()}
      </DetailSlideOver>

      {/* ── Reject Modal ── */}
      {rejectId && (
        <FormModal
          title="Reject Leave"
          subtitle="Provide a reason for rejection."
          onClose={() => setRejectId(null)}
          onSave={confirmReject}
          saveLabel="Reject"
          maxWidth="md"
          scrollable={false}
        >
          <FormField label="Rejection Reason">
            <CountedTextarea className={inputClass} rows={3} maxChars={500} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Optional reason…" />
          </FormField>
        </FormModal>
      )}

      {/* ── Confirm dialog ── */}
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          variant={confirmState.variant}
          onConfirm={() => { confirmState.onConfirm(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
