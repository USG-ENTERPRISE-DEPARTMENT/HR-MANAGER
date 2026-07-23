import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Check, Plus, Edit, Trash2, Layers, Eye, X, XCircle, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { LeaveTypeForm } from './LeaveTypeForm';
import { LeavePeriodForm } from './LeavePeriodForm';
import { HolidayForm } from './HolidayForm';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { RowActions } from './ui/RowActions';
import { money } from '../../lib/currency';
import { TablePagination } from './ui/TablePagination';
import { FormModal } from './ui/FormModal';
import { DetailSlideOver, DetailGrid, DetailField, DetailSection } from './ui/DetailSlideOver';
import { ConfirmModal } from './ui/ConfirmModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import api from '../../lib/api';
import { toast } from 'sonner';
import { getCurrentUser } from '../../lib/auth';
import { PERMISSIONS } from '../../lib/permissionKeys';

const ALL_TABS = ['Leave Types', 'Leave Period', 'Work Week', 'Holidays', 'Leave Rules', 'Leave Groups'] as const;
const TAB_PERMISSION: Record<string, string> = {
  'Leave Types':  PERMISSIONS.MANAGE_LEAVE_TYPES,
  'Leave Period': PERMISSIONS.MANAGE_LEAVE_PERIODS,
  'Work Week':    PERMISSIONS.MANAGE_WORK_WEEK,
  'Holidays':     PERMISSIONS.MANAGE_HOLIDAYS,
  'Leave Rules':  PERMISSIONS.MANAGE_LEAVE_RULES,
  'Leave Groups': PERMISSIONS.MANAGE_LEAVE_GROUPS,
};

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function LeaveSetup() {
  const currentUser = getCurrentUser();
  const can = (perm: string) => currentUser?.resolvedPermissions.has(perm) ?? false;
  // "View Manage Leave" (view_leave_setup) reveals every tab read-only; the action buttons
  // inside each tab stay gated by that tab's manage_* permission. Without view access, the
  // user only sees the specific tabs they can manage.
  const MAIN_TABS = can(PERMISSIONS.VIEW_LEAVE_SETUP)
    ? [...ALL_TABS]
    : ALL_TABS.filter(tab => can(TAB_PERMISSION[tab]));
  const canViewELL = can(PERMISSIONS.VIEW_LEAVE_SETUP);

  const [activeTab, setActiveTab]     = useState('Leave Types');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Confirm dialog ───────────────────────────────────────────────────────────
  const [confirmState, setConfirmState] = useState<{
    title: string; message?: string; confirmLabel: string;
    variant: 'danger' | 'warning'; onConfirm: () => void;
  } | null>(null);

  const askConfirm = (
    title: string, message: string, onConfirm: () => void,
    opts?: { label?: string; variant?: 'danger' | 'warning' }
  ) => setConfirmState({ title, message, confirmLabel: opts?.label ?? 'Confirm', variant: opts?.variant ?? 'danger', onConfirm });

  // ── Pagination state ─────────────────────────────────────────────────────────
  const [ltPage, setLtPage]       = useState(1);
  const [ltPageSize, setLtPageSize] = useState(10);
  const [lpPage, setLpPage]       = useState(1);
  const [lpPageSize, setLpPageSize] = useState(10);
  const [holPage, setHolPage]     = useState(1);
  const [holPageSize, setHolPageSize] = useState(10);
  const [rulePage, setRulePage]   = useState(1);
  const [rulePageSize, setRulePageSize] = useState(10);
  const [ellPage, setEllPage]     = useState(1);
  const [ellPageSize, setEllPageSize] = useState(10);

  // ── View state ───────────────────────────────────────────────────────────────
  const [viewType, setViewType]       = useState<any>(null);
  const [viewPeriod, setViewPeriod]   = useState<any>(null);
  const [viewHoliday, setViewHoliday] = useState<any>(null);
  const [viewRule, setViewRule]       = useState<any>(null);

  // Reset page to 1 when search changes
  useEffect(() => {
    if (activeTab === 'Leave Types')  setLtPage(1);
    if (activeTab === 'Leave Period') setLpPage(1);
    if (activeTab === 'Holidays')     setHolPage(1);
    if (activeTab === 'Leave Rules')  setRulePage(1);
  }, [searchQuery, activeTab]);

  // ── Leave Types ──────────────────────────────────────────────────────────────
  const [leaveTypes, setLeaveTypes]       = useState<any[]>([]);
  const [showTypeForm, setShowTypeForm]   = useState(false);
  const [editType, setEditType]           = useState<any>(null);

  const fetchLeaveTypes = useCallback(() => {
    api.get('/leave/types?all=1').then(r => setLeaveTypes(r.data.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => { if (activeTab === 'Leave Types') fetchLeaveTypes(); }, [activeTab, fetchLeaveTypes]);

  const saveLeaveType = async (data: any) => {
    const payload = {
      name:                               data.name,
      leave_gl:                           data.gl,
      default_per_year:                   data.leavesPerPeriod,
      supervisor_leave_assign:            data.adminCanAssign,
      apply_beyond_current:               data.applyBeyondBalance,
      leave_accrue:                       data.leaveAccrueEnabled,
      accrual_frequency:                  data.accrualFrequency || 'Monthly',
      accrual_rate:                       data.accrualRate || null,
      carried_forward:                    data.leaveCarriedForward,
      carried_forward_percentage:         data.percentageCarriedForward,
      max_carried_forward_amount:         data.maxCarriedForwardAmount,
      carried_forward_leave_availability: availabilityToDays(data.carriedForwardAvailability),
      propotionate_on_joined_date:        data.proportionateOnJoined,
      send_notification_emails:           data.sendNotificationEmails,
      leave_color:                        data.leaveColor,
      leave_allowance:                    data.leaveAllowance,
      leave_allowance_once:               data.leaveAllowanceOnce,
      gender:                             data.gender ?? 'All',
      group_ids:                          Array.isArray(data.leaveGroups) ? data.leaveGroups : [],
    };
    try {
      if (editType) {
        await api.put(`/leave/types/${editType.id}`, payload);
        toast.success('Leave type updated');
      } else {
        await api.post('/leave/types', payload);
        toast.success('Leave type created');
      }
      fetchLeaveTypes();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to save leave type');
    }
    setShowTypeForm(false);
    setEditType(null);
  };

  const deleteLeaveType = (id: string) => {
    askConfirm('Delete Leave Type', 'This leave type will be permanently removed. This cannot be undone.', async () => {
      try {
        await api.delete(`/leave/types/${id}`);
        toast.success('Deleted');
        fetchLeaveTypes();
      } catch { toast.error('Failed to delete'); }
    }, { label: 'Delete' });
  };

  // ── Leave Periods ────────────────────────────────────────────────────────────
  const [leavePeriods, setLeavePeriods]     = useState<any[]>([]);
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [editPeriod, setEditPeriod]         = useState<any>(null);

  const fetchPeriods = useCallback(async () => {
    try {
      const r = await api.get('/leave/periods');
      const periods: any[] = r.data.data ?? [];
      setLeavePeriods(periods);

      // Auto-create a period for the current year if none exists yet
      const year = new Date().getFullYear();
      const hasCurrentYear = periods.some((p: any) => {
        const s = String(p.date_start ?? '').slice(0, 4);
        const e = String(p.date_end   ?? '').slice(0, 4);
        return s === String(year) || e === String(year);
      });
      if (!hasCurrentYear) {
        await api.post('/leave/periods', {
          name:       `${year} Leave Period`,
          date_start: `${year}-01-01`,
          date_end:   `${year}-12-31`,
        });
        const r2 = await api.get('/leave/periods');
        setLeavePeriods(r2.data.data ?? []);
        toast.success(`${year} leave period created automatically`);
      }
    } catch {}
  }, []);

  useEffect(() => { if (activeTab === 'Leave Period') fetchPeriods(); }, [activeTab, fetchPeriods]);

  const savePeriod = async (data: any) => {
    const payload = { name: data.name, date_start: data.startDate, date_end: data.endDate };
    try {
      if (editPeriod) {
        await api.put(`/leave/periods/${editPeriod.id}`, payload);
        toast.success('Period updated');
      } else {
        await api.post('/leave/periods', payload);
        toast.success('Period created');
      }
      fetchPeriods();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to save period');
    }
    setShowPeriodForm(false);
    setEditPeriod(null);
  };

  const deletePeriod = (id: string) => {
    askConfirm('Delete Leave Period', 'This period and all associated records will be removed. This cannot be undone.', async () => {
      try {
        await api.delete(`/leave/periods/${id}`);
        toast.success('Deleted');
        fetchPeriods();
      } catch { toast.error('Failed to delete'); }
    }, { label: 'Delete' });
  };

  const activatePeriod = async (id: string) => {
    try {
      await api.post(`/leave/periods/${id}/activate`);
      toast.success('Period activated');
      fetchPeriods();
    } catch { toast.error('Failed to activate'); }
  };


  // ── Holidays ─────────────────────────────────────────────────────────────────
  const [holidays, setHolidays]         = useState<any[]>([]);
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [editHoliday, setEditHoliday]   = useState<any>(null);

  const fetchHolidays = useCallback(() => {
    api.get('/leave/holidays').then(r => setHolidays(r.data.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => { if (activeTab === 'Holidays') fetchHolidays(); }, [activeTab, fetchHolidays]);

  const saveHoliday = async (data: any) => {
    const payload = { name: data.name, dateh: data.date, status: data.status ?? 'Full_Day' };
    try {
      if (editHoliday) {
        await api.put(`/leave/holidays/${editHoliday.id}`, payload);
        toast.success('Holiday updated');
      } else {
        await api.post('/leave/holidays', payload);
        toast.success('Holiday created');
      }
      fetchHolidays();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to save holiday');
    }
    setShowHolidayForm(false);
    setEditHoliday(null);
  };

  const deleteHoliday = (id: string) => {
    askConfirm('Delete Holiday', 'This holiday will be permanently removed.', async () => {
      try {
        await api.delete(`/leave/holidays/${id}`);
        toast.success('Deleted');
        fetchHolidays();
      } catch { toast.error('Failed to delete'); }
    }, { label: 'Delete' });
  };

  // ── Work Week ────────────────────────────────────────────────────────────────
  const [workDays, setWorkDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(DAY_ORDER.map(d => [d, d === 'Saturday' || d === 'Sunday' ? 'Non_working_Day' : 'Full_Day']))
  );
  const [savingWorkWeek, setSavingWorkWeek] = useState(false);

  useEffect(() => {
    if (activeTab !== 'Work Week') return;
    api.get('/leave/workweek')
      .then(r => {
        const map: Record<string, string> = {};
        for (const row of (r.data.data ?? [])) map[row.name] = row.status;
        setWorkDays(prev => ({ ...prev, ...map }));
      })
      .catch(() => {});
  }, [activeTab]);

  const saveWorkWeek = async () => {
    setSavingWorkWeek(true);
    try {
      await api.put('/leave/workweek', DAY_ORDER.map(d => ({ name: d, status: workDays[d] ?? 'Full_Day' })));
      toast.success('Work week saved');
    } catch { toast.error('Failed to save'); }
    setSavingWorkWeek(false);
  };

  // ── Leave Groups (paygrades as groups) ──────────────────────────────────────
  const [lgPaygrades, setLgPaygrades]     = useState<any[]>([]);
  const [lgEmployees, setLgEmployees]     = useState<any[]>([]);
  const [selectedLgPg, setSelectedLgPg]  = useState<any>(null);
  const [lgGrpSearch, setLgGrpSearch]    = useState('');
  const [lgGrpPage, setLgGrpPage]        = useState(1);
  const [lgEmpSearch, setLgEmpSearch]    = useState('');

  const [leaveGroups, setLeaveGroups] = useState<any[]>([]);

  useEffect(() => {
    api.get('/salary/paygrades')
      .then(r => setLeaveGroups((r.data.data ?? []).map((p: any) => ({ id: String(p.id), name: p.name }))))
      .catch(() => {});
  }, []);

  const LG_PAGE_SIZE = 8;

  useEffect(() => {
    if (activeTab !== 'Leave Groups') return;
    Promise.all([
      api.get('/salary/paygrades').catch(() => ({ data: { data: [] } })),
      api.get('/employees').catch(() => ({ data: { data: [] } })),
    ]).then(([pgRes, empRes]) => {
      setLgPaygrades(pgRes.data.data ?? []);
      setLgEmployees(empRes.data.data ?? []);
    });
  }, [activeTab]);

  // ── Leave Rules ──────────────────────────────────────────────────────────────
  const [leaveRules, setLeaveRules]     = useState<any[]>([]);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editRule, setEditRule]         = useState<any>(null);
  const [ruleJobTitles, setRuleJobTitles]       = useState<any[]>([]);
  const [ruleDepartments, setRuleDepartments]   = useState<any[]>([]);
  const [ruleLeaveTypes, setRuleLeaveTypes]     = useState<any[]>([]);
  const [ruleEmpStatuses, setRuleEmpStatuses]   = useState<any[]>([]);

  const RULE_DEFAULTS = {
    leave_type: '', job_title: '', department: '', employment_status: '',
    leave_group: '', exp_days: '',
    default_per_year: '', carried_forward: 'No', carried_forward_percentage: '100',
    max_carried_forward_amount: '0',
    apply_beyond_current: 'No', leave_accrue: 'No', propotionate_on_joined_date: 'Yes',
    leave_allowance: 'No', leave_allowance_once: 'No',
    accrual_frequency: 'Monthly', accrual_rate: '',
  };
  const [ruleForm, setRuleForm] = useState<any>(RULE_DEFAULTS);

  const fetchRules = useCallback(() => {
    api.get('/leave/rules').then(r => setLeaveRules(r.data.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== 'Leave Rules') return;
    fetchRules();
    // Load reference data once
    if (!ruleLeaveTypes.length)  api.get('/leave/types?all=1').then(r => setRuleLeaveTypes(r.data.data ?? [])).catch(() => {});
    if (!ruleJobTitles.length)   api.get('/system/code-lists/JOBT/values').then(r => setRuleJobTitles(r.data.data ?? [])).catch(() => {});
    if (!ruleDepartments.length) api.get('/company/structures').then(r => setRuleDepartments((r.data.data ?? []).filter((s: any) => s.type === 'Department' || s.structureType === 'Department'))).catch(() => {});
    if (!ruleEmpStatuses.length) api.get('/system/code-lists/EMPS/values').then(r => setRuleEmpStatuses(r.data.data ?? [])).catch(() => {});
  }, [activeTab]);

  const saveRule = async () => {
    if (!ruleForm.leave_type) return toast.error('Leave type is required');
    try {
      if (editRule) {
        await api.put(`/leave/rules/${editRule.id}`, ruleForm);
        toast.success('Rule updated');
      } else {
        await api.post('/leave/rules', ruleForm);
        toast.success('Rule created');
      }
      fetchRules();
      setShowRuleForm(false);
      setEditRule(null);
      setRuleForm(RULE_DEFAULTS);
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Failed to save rule');
    }
  };

  const deleteRule = (id: string) => {
    askConfirm('Delete Leave Rule', 'This rule override will be permanently removed.', async () => {
      try {
        await api.delete(`/leave/rules/${id}`);
        toast.success('Deleted');
        fetchRules();
      } catch { toast.error('Failed to delete'); }
    }, { label: 'Delete' });
  };

  // ── Leave Approval List ──────────────────────────────────────────────────────
  const [ellLeaves, setEllLeaves]       = useState<any[]>([]);
  const [ellLoading, setEllLoading]     = useState(false);
  const [ellStatus, setEllStatus]       = useState('Pending Approval');
  const [ellSearch, setEllSearch]       = useState('');
  const [ellRejectId, setEllRejectId]   = useState<string | null>(null);
  const [ellRejectReason, setEllRejectReason] = useState('');
  const [ellViewRow, setEllViewRow]     = useState<any>(null);

  const fetchEllLeaves = useCallback((status: string) => {
    setEllLoading(true);
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    api.get(`/leave/leaves/all${qs}`)
      .then(r => setEllLeaves(r.data.data ?? []))
      .catch(() => toast.error('Failed to load leaves'))
      .finally(() => setEllLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab !== 'Leave Approval List') return;
    fetchEllLeaves(ellStatus);
  }, [activeTab]);

  const ellApprove = async (id: string) => {
    try {
      await api.post(`/leave/leaves/${id}/approve`);
      toast.success('Leave approved');
      fetchEllLeaves(ellStatus);
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to approve'); }
  };

  const ellConfirmReject = async () => {
    if (!ellRejectId) return;
    try {
      await api.post(`/leave/leaves/${ellRejectId}/reject`, { reason: ellRejectReason });
      toast.success('Leave rejected');
      setEllRejectId(null);
      fetchEllLeaves(ellStatus);
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to reject'); }
  };

  const ellCancel = (id: string) => {
    askConfirm('Cancel Leave', 'This will cancel the approved leave. The employee will be notified.', async () => {
      try {
        await api.post(`/leave/leaves/${id}/cancel`);
        toast.success('Leave cancelled');
        fetchEllLeaves(ellStatus);
      } catch (e: any) { toast.error(e.response?.data?.message ?? 'Failed to cancel'); }
    }, { label: 'Cancel Leave', variant: 'warning' });
  };

  const ellRetryGL = async (id: string) => {
    try {
      await api.post(`/leave/leaves/${id}/retry-gl`);
      toast.success('GL retry posted successfully');
      fetchEllLeaves(ellStatus);
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'GL retry failed'); }
  };

  useEffect(() => { setEllPage(1); }, [ellSearch, ellStatus]);

  const ELL_STATUSES = ['Pending Approval', 'Pending Financial Approval', 'Pending HR Approval', 'Approved', 'Draft', 'Rejected', 'Cancelled', 'GL Scheduled'];

  const STATUS_PILL: Record<string, string> = {
    'Pending':              'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]',
    'Pending Approval':     'bg-amber-500/10 text-amber-700 border border-amber-200/50',
    'Pending Financial Approval': 'bg-blue-500/10 text-blue-700 border border-blue-200/50',
    'Pending HR Approval':  'bg-purple-500/10 text-purple-700 border border-purple-200/50',
    'Approved':             'pill-success',
    'Rejected':             'pill-danger',
    'Cancelled':            'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-muted)]',
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const isKnownTab = [...MAIN_TABS, 'Leave Approval List'].includes(activeTab);

  const filtered = (arr: any[]) =>
    arr.filter(r => JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase()));

  function paginate<T>(arr: T[], page: number, size: number): T[] {
    return arr.slice((page - 1) * size, page * size);
  }

  const fmtDate = (v: string) => {
    if (!v) return '—';
    return v.substring(0, 10);
  };

  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Leave Setup" subtitle="Configure company leave policies and groups." />

      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4 border-b border-slate-200 pb-2">
        {MAIN_TABS.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`tab-btn ${activeTab === tab ? 'active' : ''}`}>
            {tab}
          </button>
        ))}
        {canViewELL ? (
          <button onClick={() => setActiveTab('Leave Approval List')} className={`tab-btn ${activeTab === 'Leave Approval List' ? 'active' : ''}`}>
            Leave Approval List
          </button>
        ) : null}
      </div>

      <div className={`bg-[var(--surface)] border border-[var(--border)] rounded-[16px] flex flex-col ${activeTab === 'Leave Groups' ? 'flex-1 min-h-0 overflow-hidden' : 'min-h-[500px] overflow-hidden'}`}>

        {/* ── Leave Types ── */}
        {activeTab === 'Leave Types' && (() => {
          const ltFiltered = filtered(leaveTypes);
          const ltRows = paginate(ltFiltered, ltPage, ltPageSize);
          return (
          <>
            <TableToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search leave types..."
              actions={can(PERMISSIONS.MANAGE_LEAVE_TYPES) ? (
                <button onClick={() => { setEditType(null); setShowTypeForm(true); }} className="primary-btn shrink-0">
                  <span className="hidden sm:inline">Add Leave Type</span>
                  <span className="sm:hidden">Add</span>
                  <Plus className="w-[14px] h-[14px]" />
                </button>
              ) : undefined}
            />
            <div className="overflow-x-auto flex-1">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th text-left">Name</th>
                    <th className="th text-center" style={{ width: '10%' }}>Days / Year</th>
                    <th className="th text-center" style={{ width: '14%' }}>Supervisor Assign</th>
                    <th className="th text-center" style={{ width: '12%' }}>Carry Forward</th>
                    <th className="th text-center" style={{ width: '12%' }}>Allowance</th>
                    <th className="th text-right" style={{ width: '9%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {ltRows.length === 0 ? (
                    <tr><td colSpan={6} className="td text-center text-[var(--text-muted)] py-8">No leave types found.</td></tr>
                  ) : ltRows.map((type, i) => (
                    <motion.tr key={type.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                      <td className="td font-medium text-[var(--text-primary)]">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: type.leave_color || '#94a3b8' }} />
                          {type.name}
                          {type.group_name && <span className="text-[10px] text-[var(--text-muted)] font-normal">({type.group_name})</span>}
                        </div>
                      </td>
                      <td className="td text-center">{type.default_per_year}</td>
                      <td className="td text-center">{type.supervisor_leave_assign}</td>
                      <td className="td text-center">
                        <span className={`pill ${type.carried_forward === 'Yes' ? 'pill-success' : ''}`} style={type.carried_forward !== 'Yes' ? { background: 'var(--surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' } : {}}>
                          {type.carried_forward}
                        </span>
                      </td>
                      <td className="td text-center">
                        {type.leave_allowance === 'Yes' ? (
                          <div className="flex flex-col gap-1">
                            <span className="pill pill-accent">Yes</span>
                            <span className="pill text-[9px]" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                              {type.leave_allowance_once === 'Yes' ? 'Once/period' : 'Every application'}
                            </span>
                          </div>
                        ) : (
                          <span className="pill" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>No</span>
                        )}
                      </td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View', icon: Eye, onClick: () => setViewType(type) },
                            { label: 'Edit', icon: Edit, onClick: () => { setEditType(type); setShowTypeForm(true); }, hidden: !can(PERMISSIONS.MANAGE_LEAVE_TYPES) },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteLeaveType(type.id), hidden: !can(PERMISSIONS.MANAGE_LEAVE_TYPES) },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              total={leaveTypes.length} filtered={ltFiltered.length}
              page={ltPage} pageSize={ltPageSize}
              onPageChange={setLtPage} onPageSizeChange={p => { setLtPageSize(p); setLtPage(1); }}
            />
          </>
          );
        })()}

        {/* ── Leave Period ── */}
        {activeTab === 'Leave Period' && (() => {
          const lpFiltered = filtered(leavePeriods);
          const lpRows = paginate(lpFiltered, lpPage, lpPageSize);
          return (
          <>
            <TableToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search leave periods..."
              actions={can(PERMISSIONS.MANAGE_LEAVE_PERIODS) ? (
                <button onClick={() => { setEditPeriod(null); setShowPeriodForm(true); }} className="primary-btn shrink-0">
                  <span className="hidden sm:inline">Add Leave Period</span>
                  <span className="sm:hidden">Add</span>
                  <Plus className="w-[14px] h-[14px]" />
                </button>
              ) : undefined}
            />
            <div className="overflow-x-auto flex-1">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th text-left">Name</th>
                    <th className="th text-left" style={{ width: '14%' }}>Start Date</th>
                    <th className="th text-left" style={{ width: '14%' }}>End Date</th>
                    <th className="th text-center" style={{ width: '12%' }}>Status</th>
                    <th className="th text-right" style={{ width: '12%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lpRows.length === 0 ? (
                    <tr><td colSpan={5} className="td text-center text-[var(--text-muted)] py-8">No leave periods found.</td></tr>
                  ) : lpRows.map((period, i) => (
                    <motion.tr key={period.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                      <td className="td font-medium text-[var(--text-primary)]">{period.name || '—'}</td>
                      <td className="td">{fmtDate(period.date_start)}</td>
                      <td className="td">{fmtDate(period.date_end)}</td>
                      <td className="td text-center">
                        <span className={`pill ${period.status === 'Active' ? 'pill-success' : ''}`} style={period.status !== 'Active' ? { background: 'var(--surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' } : {}}>
                          {period.status || 'Inactive'}
                        </span>
                      </td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'Set Active', icon: Check, onClick: () => activatePeriod(period.id), hidden: !(can(PERMISSIONS.MANAGE_LEAVE_PERIODS) && period.status !== 'Active') },
                            { label: 'View', icon: Eye, onClick: () => setViewPeriod(period) },
                            { label: 'Edit', icon: Edit, onClick: () => { setEditPeriod(period); setShowPeriodForm(true); }, hidden: !can(PERMISSIONS.MANAGE_LEAVE_PERIODS) },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deletePeriod(period.id), hidden: !can(PERMISSIONS.MANAGE_LEAVE_PERIODS) },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              total={leavePeriods.length} filtered={lpFiltered.length}
              page={lpPage} pageSize={lpPageSize}
              onPageChange={setLpPage} onPageSizeChange={p => { setLpPageSize(p); setLpPage(1); }}
            />
          </>
          );
        })()}

        {/* ── Work Week ── */}
        {activeTab === 'Work Week' && (
          <div className="flex flex-col">
            <div className="flex flex-col border-b border-[var(--border)]">
              <div className="p-4 sm:p-5">
                <h3 className="font-bold text-[var(--text-primary)]">Work Week Setup</h3>
              </div>
            </div>
            <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
              <div className="grid grid-cols-[120px_1fr] gap-y-4 items-center">
                {DAY_ORDER.map(day => (
                  <React.Fragment key={day}>
                    <div className="font-bold text-[var(--text-primary)] text-[13px]">{day}</div>
                    <select
                      value={workDays[day] ?? 'Full_Day'}
                      onChange={(e) => setWorkDays(prev => ({ ...prev, [day]: e.target.value }))}
                      className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm bg-[var(--surface)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] text-[var(--text-primary)] max-w-xs transition-colors"
                    >
                      <option value="Full_Day">Full Day</option>
                      <option value="Half_Day">Half Day</option>
                      <option value="Non_working_Day">Non-working Day</option>
                    </select>
                  </React.Fragment>
                ))}
              </div>
            </div>
            {can(PERMISSIONS.MANAGE_WORK_WEEK) && (
              <div className="px-4 py-4 border-t border-[var(--border)] flex items-center justify-start bg-[var(--surface-hover)]">
                <button className="primary-btn shrink-0" onClick={saveWorkWeek} disabled={savingWorkWeek}>
                  <Check size={14} /> {savingWorkWeek ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Holidays ── */}
        {activeTab === 'Holidays' && (() => {
          const holFiltered = filtered(holidays);
          const holRows = paginate(holFiltered, holPage, holPageSize);
          return (
          <>
            <TableToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search holidays..."
              actions={can(PERMISSIONS.MANAGE_HOLIDAYS) ? (
                <button onClick={() => { setEditHoliday(null); setShowHolidayForm(true); }} className="primary-btn shrink-0">
                  <span className="hidden sm:inline">Add Holiday</span>
                  <span className="sm:hidden">Add</span>
                  <Plus className="w-[14px] h-[14px]" />
                </button>
              ) : undefined}
            />
            <div className="overflow-x-auto flex-1">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th text-left">Name</th>
                    <th className="th text-left" style={{ width: '15%' }}>Date</th>
                    <th className="th text-left" style={{ width: '15%' }}>Day Type</th>
                    <th className="th text-right" style={{ width: '9%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {holRows.length === 0 ? (
                    <tr><td colSpan={4} className="td text-center text-[var(--text-muted)] py-8">No holidays found.</td></tr>
                  ) : holRows.map((holiday, i) => (
                    <motion.tr key={holiday.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                      <td className="td font-medium text-[var(--text-primary)]">{holiday.name}</td>
                      <td className="td">{fmtDate(holiday.dateh)}</td>
                      <td className="td">
                        <span className="pill" style={{ background: 'var(--surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                          {(holiday.status ?? 'Full_Day').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View', icon: Eye, onClick: () => setViewHoliday(holiday) },
                            { label: 'Edit', icon: Edit, onClick: () => { setEditHoliday(holiday); setShowHolidayForm(true); }, hidden: !can(PERMISSIONS.MANAGE_HOLIDAYS) },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteHoliday(holiday.id), hidden: !can(PERMISSIONS.MANAGE_HOLIDAYS) },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              total={holidays.length} filtered={holFiltered.length}
              page={holPage} pageSize={holPageSize}
              onPageChange={setHolPage} onPageSizeChange={p => { setHolPageSize(p); setHolPage(1); }}
            />
          </>
          );
        })()}

        {/* ── Leave Rules ── */}
        {activeTab === 'Leave Rules' && (() => {
          const ruleFiltered = filtered(leaveRules);
          const ruleRows = paginate(ruleFiltered, rulePage, rulePageSize);
          return (
          <>
            <TableToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search rules..."
              actions={can(PERMISSIONS.MANAGE_LEAVE_RULES) ? (
                <button onClick={() => { setEditRule(null); setRuleForm(RULE_DEFAULTS); setShowRuleForm(true); }} className="primary-btn shrink-0">
                  <span className="hidden sm:inline">Add Rule</span><span className="sm:hidden">Add</span>
                  <Plus className="w-[14px] h-[14px]" />
                </button>
              ) : undefined}
            />
            <div className="overflow-x-auto flex-1">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th text-left" style={{ width: '24%' }}>Leave Type</th>
                    <th className="th text-left">Criteria</th>
                    <th className="th text-center" style={{ width: '11%' }}>Days / Year</th>
                    <th className="th text-center" style={{ width: '12%' }}>Carry Forward</th>
                    <th className="th text-center" style={{ width: '11%' }}>Allowance</th>
                    <th className="th text-right" style={{ width: '9%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {ruleRows.length === 0 ? (
                    <tr><td colSpan={6} className="td text-center text-[var(--text-muted)] py-8">No leave rules configured.</td></tr>
                  ) : ruleRows.map((rule, i) => (
                    <motion.tr key={rule.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                      <td className="td font-medium text-[var(--text-primary)]">
                        <div className="flex items-center gap-2">
                          {rule.leave_color && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: rule.leave_color }} />}
                          {rule.leave_type_name ?? rule.leave_type}
                        </div>
                      </td>
                      <td className="td text-[var(--text-secondary)]">
                        {[rule.job_title_name, rule.department_name, rule.leave_group_name].filter(Boolean).join(' · ') || 'All'}
                      </td>
                      <td className="td text-center">{rule.default_per_year}</td>
                      <td className="td text-center">
                        <span className={`pill ${rule.carried_forward === 'Yes' ? 'pill-success' : ''}`} style={rule.carried_forward !== 'Yes' ? { background: 'var(--surface-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' } : {}}>
                          {rule.carried_forward}
                        </span>
                      </td>
                      <td className="td text-center">
                        <span className={`pill ${rule.leave_allowance === 'Yes' ? 'pill-accent' : ''}`} style={rule.leave_allowance !== 'Yes' ? { background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' } : {}}>
                          {rule.leave_allowance ?? 'No'}
                        </span>
                      </td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View', icon: Eye, onClick: () => setViewRule(rule) },
                            { label: 'Edit', icon: Edit, hidden: !can(PERMISSIONS.MANAGE_LEAVE_RULES), onClick: () => {
                              setEditRule(rule);
                              setRuleForm({
                                leave_type:                  String(rule.leave_type ?? ''),
                                job_title:                   String(rule.job_title ?? ''),
                                department:                  String(rule.department ?? ''),
                                employment_status:           String(rule.employment_status ?? ''),
                                leave_group:                 String(rule.leave_group ?? ''),
                                exp_days:                    String(rule.exp_days ?? ''),
                                default_per_year:            String(rule.default_per_year ?? ''),
                                carried_forward:             rule.carried_forward ?? 'No',
                                carried_forward_percentage:  String(rule.carried_forward_percentage ?? '100'),
                                max_carried_forward_amount:  String(rule.max_carried_forward_amount ?? '0'),
                                apply_beyond_current:        rule.apply_beyond_current ?? 'No',
                                leave_accrue:                rule.leave_accrue ?? 'No',
                                propotionate_on_joined_date: rule.propotionate_on_joined_date ?? 'Yes',
                                leave_allowance:             rule.leave_allowance ?? 'No',
                                leave_allowance_once:        rule.leave_allowance_once ?? 'No',
                                accrual_frequency:           rule.accrual_frequency ?? 'Monthly',
                                accrual_rate:                rule.accrual_rate != null ? String(rule.accrual_rate) : '',
                              });
                              setShowRuleForm(true);
                            } },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteRule(rule.id), hidden: !can(PERMISSIONS.MANAGE_LEAVE_RULES) },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              total={leaveRules.length} filtered={ruleFiltered.length}
              page={rulePage} pageSize={rulePageSize}
              onPageChange={setRulePage} onPageSizeChange={p => { setRulePageSize(p); setRulePage(1); }}
            />
          </>
          );
        })()}

        {/* ── Leave Groups — paygrades as groups ── */}
        {activeTab === 'Leave Groups' && (() => {
          const filteredPgs = lgPaygrades.filter(p =>
            p.name.toLowerCase().includes(lgGrpSearch.toLowerCase())
          );
          const pgPageCount  = Math.max(1, Math.ceil(filteredPgs.length / LG_PAGE_SIZE));
          const paginatedPgs = filteredPgs.slice((lgGrpPage - 1) * LG_PAGE_SIZE, lgGrpPage * LG_PAGE_SIZE);

          const pgEmployees = selectedLgPg
            ? lgEmployees.filter((e: any) => String(e.paygrade?.id ?? e.paygradeId) === String(selectedLgPg.id))
            : [];
          const filteredPgEmps = pgEmployees.filter((e: any) =>
            `${e.firstName} ${e.lastName} ${e.employee_id ?? ''}`.toLowerCase().includes(lgEmpSearch.toLowerCase())
          );

          return (
            <div className="flex gap-4 flex-1 min-h-0 p-4">
              {/* Left — paygrades list */}
              <div className="flex flex-col w-72 shrink-0 bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden drop-shadow-sm">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0">
                  <Layers size={14} className="text-[var(--accent)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Paygrades</span>
                  <span className="text-xs text-[var(--text-muted)]">({filteredPgs.length})</span>
                </div>
                <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
                  <input value={lgGrpSearch} onChange={(e) => { setLgGrpSearch(e.target.value); setLgGrpPage(1); }} placeholder="Search paygrades..." className="!text-xs !py-1.5 w-full" />
                </div>
                <div className="overflow-y-auto flex-1">
                  {paginatedPgs.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] text-center py-10">{lgGrpSearch ? 'No results.' : 'No paygrades found.'}</p>
                  ) : paginatedPgs.map((pg: any) => {
                    const active = selectedLgPg?.id === pg.id;
                    const empCount = lgEmployees.filter((e: any) => String(e.paygrade?.id ?? e.paygradeId) === String(pg.id)).length;
                    return (
                      <div
                        key={pg.id}
                        onClick={() => { setSelectedLgPg(active ? null : pg); setLgEmpSearch(''); }}
                        className="flex items-start justify-between px-4 py-3 cursor-pointer border-b border-[var(--border)] last:border-b-0 transition-colors"
                        style={{ background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{pg.name}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {pg.currency && <span className="font-medium">{pg.currency} · </span>}
                            {empCount} employee{empCount !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {pgPageCount > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] shrink-0">
                    <span className="text-xs text-[var(--text-muted)]">{lgGrpPage}/{pgPageCount}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setLgGrpPage(p => Math.max(1, p - 1))} disabled={lgGrpPage === 1} className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg)] transition-colors">‹</button>
                      <button onClick={() => setLgGrpPage(p => Math.min(pgPageCount, p + 1))} disabled={lgGrpPage === pgPageCount} className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg)] transition-colors">›</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right — employees in selected paygrade */}
              <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden drop-shadow-sm">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] shrink-0">
                  <Layers size={14} className="text-[var(--accent)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {selectedLgPg ? `Employees — ${selectedLgPg.name}` : 'Employees'}
                  </span>
                  {selectedLgPg && <span className="text-xs text-[var(--text-muted)]">({filteredPgEmps.length})</span>}
                </div>

                {!selectedLgPg ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2">
                    <Layers size={28} className="text-[var(--border)]" />
                    <p className="text-sm text-[var(--text-muted)]">Select a paygrade to view its employees</p>
                  </div>
                ) : (
                  <>
                    <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
                      <input value={lgEmpSearch} onChange={(e) => setLgEmpSearch(e.target.value)} placeholder="Search employees..." className="!text-xs !py-1.5 w-full" />
                    </div>
                    {filteredPgEmps.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-2">
                        <Layers size={28} className="text-[var(--border)]" />
                        <p className="text-sm text-[var(--text-muted)]">{lgEmpSearch ? 'No results.' : `No employees on ${selectedLgPg.name}.`}</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr>
                              <th className="th">Employee</th>
                              <th className="th">ID</th>
                              <th className="th">Department</th>
                              <th className="th">Job Title</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPgEmps.map((e: any, i: number) => (
                              <motion.tr key={e.id ?? i} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 + i * 0.03 }}>
                                <td className="td font-medium text-[var(--text-primary)]">{e.firstName} {e.lastName}</td>
                                <td className="td text-[var(--text-secondary)]">{e.employee_id ?? '—'}</td>
                                <td className="td text-[var(--text-secondary)]">{e.department?.title ?? '—'}</td>
                                <td className="td text-[var(--text-secondary)]">{e.jobTitle?.label ?? '—'}</td>
                              </motion.tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Leave Approval List ── */}
        {activeTab === 'Leave Approval List' && (() => {
          const ellFiltered = ellLeaves.filter(r =>
            JSON.stringify(r).toLowerCase().includes(ellSearch.toLowerCase())
          );
          return (
            <>
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
                <input
                  value={ellSearch}
                  onChange={e => setEllSearch(e.target.value)}
                  placeholder="Search employees, leave types…"
                  className={`${inputClass} max-w-xs`}
                />
                <div className="flex flex-wrap gap-1 ml-auto">
                  {ELL_STATUSES.map(s => (
                    <button
                      key={s}
                      onClick={() => { setEllStatus(s); fetchEllLeaves(s); }}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                        ellStatus === s
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                      }`}
                    >{s}</button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto flex-1">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="th text-left" style={{ width: '15%' }}>Employee</th>
                      <th className="th text-left" style={{ width: '13%' }}>Leave Type</th>
                      <th className="th text-left" style={{ width: '10%' }}>Period</th>
                      <th className="th text-left" style={{ width: '8%' }}>Start</th>
                      <th className="th text-left" style={{ width: '8%' }}>End</th>
                      <th className="th text-center" style={{ width: '5%' }}>Days</th>
                      <th className="th text-center" style={{ width: '11%' }}>Status</th>
                      <th className="th text-center" style={{ width: '13%' }}>Allowance</th>
                      <th className="th text-right" style={{ width: '10%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ellLoading ? (
                      <tr><td colSpan={9} className="td text-center text-[var(--text-muted)] py-10">Loading…</td></tr>
                    ) : ellFiltered.length === 0 ? (
                      <tr><td colSpan={9} className="td text-center text-[var(--text-muted)] py-10">No leaves found.</td></tr>
                    ) : paginate(ellFiltered, ellPage, ellPageSize).map((row: any, i: number) => (
                      <motion.tr key={row.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i }}>
                        <td className="td font-medium text-[var(--text-primary)]">{row.employee_name || row.employee}</td>
                        <td className="td">
                          <div className="flex items-center gap-1.5">
                            {row.leave_color && <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.leave_color }} />}
                            {row.leave_type_name || '—'}
                          </div>
                        </td>
                        <td className="td text-[var(--text-secondary)]">{row.period_name || '—'}</td>
                        <td className="td">{fmtDate(row.date_start)}</td>
                        <td className="td">{fmtDate(row.date_end)}</td>
                        <td className="td text-center">{Number(row.day_count ?? 0)}</td>
                        <td className="td text-center">
                          <span className={`pill ${STATUS_PILL[row.status] ?? ''}`}>{row.status}</span>
                        </td>
                        <td className="td text-center">
                          {(() => {
                            const as  = row.allowance_status;
                            const amt = parseFloat(row.amount);
                            const statusPill = !as || as === ''
                              ? null
                              : as === 'Paid'
                                ? <span className="pill pill-success text-[10px]">Paid</span>
                              : as === 'GL Scheduled'
                                ? <span className="pill bg-blue-500/10 text-blue-700 border border-blue-200/50 text-[10px]">Scheduled</span>
                              : as === 'Failed GL Posting'
                                ? <span className="pill bg-red-500/10 text-red-700 border border-red-200/50 text-[10px]">GL Failed</span>
                              : as === 'Pending Financial Approval'
                                ? <span className="pill bg-amber-500/10 text-amber-700 border border-amber-200/50 text-[10px]">Fin. Approval</span>
                              : as === 'Already Paid This Period'
                                ? <span className="pill bg-slate-100 text-slate-500 border border-slate-200 text-[10px]">Already Paid</span>
                              : as === 'Pre-enable Skip'
                                ? <span className="pill bg-slate-100 text-slate-500 border border-slate-200 text-[10px]">Pre-enable</span>
                              : <span className="text-[11px] text-[var(--text-muted)]">{as}</span>;
                            if (!amt && !statusPill) return <span className="text-[11px] text-[var(--text-muted)]">—</span>;
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                {amt > 0 && <span className="text-[11px] font-semibold text-[var(--text-primary)]">{money(amt)}</span>}
                                {statusPill}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="td text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button className="action-btn text-[var(--accent)]" title="View details" onClick={() => setEllViewRow(row)}>
                              <Eye size={14} />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination
                total={ellLeaves.length} filtered={ellFiltered.length}
                page={ellPage} pageSize={ellPageSize}
                onPageChange={setEllPage} onPageSizeChange={p => { setEllPageSize(p); setEllPage(1); }}
              />
            </>
          );
        })()}

        {!isKnownTab && (
          <div className="flex flex-col items-center justify-center text-center opacity-60 h-full my-auto p-8 flex-1">
            <Settings size={48} className="text-[var(--text-muted)] mb-4" />
            <h3 className="text-xl font-bold text-[var(--text-primary)] syne">{activeTab}</h3>
            <p className="text-sm text-[var(--text-secondary)] mt-2 max-w-md">Configuration options for {activeTab.toLowerCase()} will be displayed here.</p>
          </div>
        )}
      </div>

      {/* ── Forms ── */}
      {showTypeForm && (
        <LeaveTypeForm
          onClose={() => { setShowTypeForm(false); setEditType(null); }}
          onSave={saveLeaveType}
          initialData={editType ? typeToFormData(editType) : undefined}
          leaveGroups={leaveGroups}
        />
      )}
      {showPeriodForm && (
        <LeavePeriodForm
          onClose={() => { setShowPeriodForm(false); setEditPeriod(null); }}
          onSave={savePeriod}
          initialData={editPeriod ? { name: editPeriod.name, startDate: fmtDate(editPeriod.date_start), endDate: fmtDate(editPeriod.date_end) } : undefined}
        />
      )}
      {showHolidayForm && (
        <HolidayForm
          onClose={() => { setShowHolidayForm(false); setEditHoliday(null); }}
          onSave={saveHoliday}
          initialData={editHoliday ? { name: editHoliday.name, date: fmtDate(editHoliday.dateh), status: editHoliday.status } : undefined}
        />
      )}

      {/* ── ELL: View Leave ── */}
      <DetailSlideOver
        open={!!ellViewRow}
        title="Leave Details"
        subtitle={ellViewRow ? (ellViewRow.employee_name || ellViewRow.employee) : undefined}
        onClose={() => setEllViewRow(null)}
        footerActions={ellViewRow && (() => {
          const isPendingHR = ellViewRow.status === 'Pending HR Approval';
          const isApproved  = ellViewRow.status === 'Approved';
          // 'Pending Approval' is supervisor's queue — HR admins do not act on it here
          if (isPendingHR && can(PERMISSIONS.MANAGE_LEAVE_APPROVALS)) return (
            <>
              <button
                className="secondary-btn shadow-sm text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5"
                onClick={() => { setEllRejectId(ellViewRow.id); setEllRejectReason(''); setEllViewRow(null); }}
              >
                <X size={14} className="mr-1.5 inline" />Reject
              </button>
              <button
                className="primary-btn shadow-sm"
                onClick={() => { ellApprove(ellViewRow.id); setEllViewRow(null); }}
              >
                <Check size={14} className="mr-1.5 inline" />Approve
              </button>
            </>
          );
          if (isApproved && can(PERMISSIONS.MANAGE_LEAVE_APPROVALS)) return (
            <>
              <button
                className="secondary-btn shadow-sm text-[var(--warning)] border-[var(--warning)]/40 hover:bg-[var(--warning)]/5"
                onClick={() => { setEllViewRow(null); ellCancel(ellViewRow.id); }}
              >
                <XCircle size={14} className="mr-1.5 inline" />Cancel
              </button>
              {ellViewRow.allowance_status === 'Failed GL Posting' && (
                <button
                  className="primary-btn shadow-sm bg-red-600 hover:opacity-90"
                  onClick={() => { setEllViewRow(null); ellRetryGL(ellViewRow.id); }}
                >
                  <RefreshCw size={14} className="mr-1.5 inline" />Retry GL
                </button>
              )}
            </>
          );
          return undefined;
        })()}
      >
        {ellViewRow && (
          <div className="space-y-5">
            {/* Summary header */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-[var(--text-primary)] syne truncate">{ellViewRow.leave_type_name || 'Leave'}</p>
                  <p className="text-[12px] text-[var(--text-muted)] mt-0.5 truncate">{ellViewRow.employee_name || ellViewRow.employee}</p>
                </div>
                <span className={`pill text-[11px] shrink-0 ${STATUS_PILL[ellViewRow.status] ?? 'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]'}`}>
                  {ellViewRow.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4">
                {[
                  { label: 'Days',  value: ellViewRow.day_count ?? '—' },
                  { label: 'Start', value: fmtDate(ellViewRow.date_start) },
                  { label: 'End',   value: fmtDate(ellViewRow.date_end) },
                ].map(s => (
                  <div key={s.label} className="text-center rounded-xl bg-[var(--surface)] border border-[var(--border)] py-2.5">
                    <p
                      className="syne text-[var(--text-primary)] whitespace-nowrap"
                      style={{ fontSize: '14.5px', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.025em' }}
                    >
                      {s.value}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mt-1.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <DetailGrid>
              <DetailField label="Employee ID"      value={ellViewRow.employee_code} />
              <DetailField label="Period"           value={ellViewRow.period_name} />
              <DetailField label="Approval Level"   value={`Level ${ellViewRow.approval_level ?? 0}`} />
              <DetailField label="Allowance Status" value={ellViewRow.allowance_status} />
              <DetailField label="Allowance Amount" value={ellViewRow.amount ? money(ellViewRow.amount) : '—'} full />
              <DetailField label="Details"          value={ellViewRow.details} full />
              {ellViewRow.status === 'Rejected' && (
                <DetailField label="Rejection Reason" value={ellViewRow.rejection_reason || 'No reason was provided.'} full />
              )}
            </DetailGrid>

            {ellViewRow.leave_type_allowance_enabled === 'Yes' && Number(ellViewRow.allowance_basic) > 0 && (
              <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50 border-b border-emerald-100">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Leave Allowance</p>
                  {ellViewRow.allowance_status && (() => {
                    const status = ellViewRow.allowance_status;
                    const label = status === 'Pre-enable Skip' ? 'Not Eligible (pre-dates enablement)' : status;
                    const cls = status === 'Paid' || status === 'GL Scheduled'
                      ? 'pill-success'
                      : status === 'Financial Rejected'
                        ? 'pill-danger'
                        : status === 'Pre-enable Skip'
                          ? 'bg-slate-100 text-slate-500 border border-slate-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200';
                    return <span className={`pill text-[10px] ${cls}`}>{label}</span>;
                  })()}
                </div>
                <div className="px-4 py-3 bg-[var(--bg)] space-y-1.5">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-[var(--text-secondary)]">Basic Salary (monthly)</span>
                    <span className="font-semibold tabular-nums">{Number(ellViewRow.allowance_basic).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {ellViewRow.allowance_annual_factor && (
                    <div className="text-[11px] text-[var(--text-muted)] pl-2">
                      × 12 months × {(Number(ellViewRow.allowance_annual_factor) * 100).toFixed(0)}% annual factor
                    </div>
                  )}
                  {Number(ellViewRow.allowance_gross) > 0 && (
                    <div className="flex justify-between text-[12px] border-t border-[var(--border-light)] pt-1.5">
                      <span className="font-medium">Gross Allowance</span>
                      <span className="font-bold tabular-nums">{Number(ellViewRow.allowance_gross).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[11px]">
                    <span className="text-[var(--text-muted)]">Less: non-taxable (basic)</span>
                    <span className="tabular-nums text-[var(--text-muted)]">({Number(ellViewRow.allowance_basic).toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </div>
                  {Number(ellViewRow.allowance_tax) > 0 && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[var(--danger)]">Tax{ellViewRow.allowance_tax_rate ? ` (${(Number(ellViewRow.allowance_tax_rate) * 100).toFixed(0)}%)` : ''}</span>
                      <span className="font-semibold tabular-nums text-[var(--danger)]">({Number(ellViewRow.allowance_tax).toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[13px] font-bold border-t border-[var(--border)] pt-2 mt-0.5">
                    <span>Net Payout</span>
                    <span className="tabular-nums text-[var(--success)]">{Number(ellViewRow.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {ellViewRow.documentref && (
                    <div className="flex justify-between text-[11px] border-t border-[var(--border-light)] pt-1.5 text-[var(--text-muted)]">
                      <span>GL Reference</span>
                      <span className="font-mono tracking-wide">{ellViewRow.documentref}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DetailSlideOver>

      {/* ── ELL: Reject Modal ── */}
      {ellRejectId && (
        <FormModal
          title="Reject Leave"
          subtitle="Provide a reason for rejection (optional)."
          onClose={() => setEllRejectId(null)}
          onSave={ellConfirmReject}
          saveLabel="Reject"
          maxWidth="md"
          scrollable={false}
        >
          <FormField label="Rejection Reason">
            <CountedTextarea className={inputClass} rows={3} maxChars={500} value={ellRejectReason} onChange={e => setEllRejectReason(e.target.value)} placeholder="Reason for rejection…" />
          </FormField>
        </FormModal>
      )}

      {/* ── View: Leave Type ── */}
      <DetailSlideOver open={!!viewType} title="Leave Type Details" subtitle={viewType?.name} onClose={() => setViewType(null)}>
        {viewType && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="w-10 h-10 rounded-xl border border-[var(--border)] shrink-0" style={{ backgroundColor: viewType.leave_color || '#94a3b8' }} />
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-[var(--text-primary)] syne truncate">{viewType.name}</p>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5 truncate">
                  {viewType.default_per_year ?? '—'} days / period · {viewType.group_name || 'No group'}
                </p>
              </div>
            </div>

            <DetailSection title="General">
              <DetailGrid>
                <DetailField label="Days / Period"      value={viewType.default_per_year} />
                <DetailField label="Supervisor Assign"  value={viewType.supervisor_leave_assign} />
                <DetailField label="GL Account"         value={viewType.leave_gl} />
                <DetailField label="Leave Group"        value={viewType.group_name} />
                <DetailField label="Gender Restriction" value={!viewType.gender || viewType.gender === 'All' ? 'All' : viewType.gender === 'M' ? 'Male Only' : viewType.gender === 'F' ? 'Female Only' : `${viewType.gender} Only`} />
                <DetailField label="Proportionate"      value={viewType.propotionate_on_joined_date} />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Accrual">
              <DetailGrid>
                <DetailField label="Leave Accrue"     value={viewType.leave_accrue} />
                <DetailField label="Accrual Frequency" value={viewType.leave_accrue === 'Yes' ? (viewType.accrual_frequency ?? 'Monthly') : '—'} />
                <DetailField label="Accrual Rate"      value={viewType.leave_accrue === 'Yes' && viewType.accrual_rate ? `${viewType.accrual_rate} days/period` : (viewType.leave_accrue === 'Yes' ? 'Auto' : '—')} full />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Carry Forward">
              <DetailGrid>
                <DetailField label="Carry Forward"   value={viewType.carried_forward} />
                <DetailField label="Carry Forward %" value={viewType.carried_forward_percentage} />
                <DetailField label="Max CF Amount"   value={viewType.max_carried_forward_amount} full />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Allowance">
              <DetailGrid>
                <DetailField label="Leave Allowance"     value={viewType.leave_allowance ?? 'No'} />
                <DetailField label="Allowance Frequency" value={viewType.leave_allowance === 'Yes' ? (viewType.leave_allowance_once === 'Yes' ? 'Once Per Period' : 'Every Application') : '—'} />
              </DetailGrid>
            </DetailSection>
          </div>
        )}
      </DetailSlideOver>

      {/* ── View: Leave Period ── */}
      <DetailSlideOver open={!!viewPeriod} title="Leave Period Details" subtitle={viewPeriod?.name} onClose={() => setViewPeriod(null)}>
        {viewPeriod && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-[var(--text-primary)] syne truncate">{viewPeriod.name || '—'}</p>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{fmtDate(viewPeriod.date_start)} → {fmtDate(viewPeriod.date_end)}</p>
              </div>
              <span className={`pill text-[11px] shrink-0 ${viewPeriod.status === 'Active' ? 'pill-success' : 'bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-muted)]'}`}>
                {viewPeriod.status || 'Inactive'}
              </span>
            </div>
            <DetailGrid>
              <DetailField label="Start Date" value={fmtDate(viewPeriod.date_start)} />
              <DetailField label="End Date"   value={fmtDate(viewPeriod.date_end)} />
            </DetailGrid>
          </div>
        )}
      </DetailSlideOver>

      {/* ── View: Holiday ── */}
      <DetailSlideOver open={!!viewHoliday} title="Holiday Details" subtitle={viewHoliday?.name} onClose={() => setViewHoliday(null)}>
        {viewHoliday && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <p className="text-[15px] font-bold text-[var(--text-primary)] syne truncate">{viewHoliday.name}</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{fmtDate(viewHoliday.dateh)}</p>
            </div>
            <DetailGrid>
              <DetailField label="Date" value={fmtDate(viewHoliday.dateh)} />
              <DetailField label="Type" value={(viewHoliday.status ?? 'Full_Day').replace(/_/g, ' ')} />
            </DetailGrid>
          </div>
        )}
      </DetailSlideOver>

      {/* ── View: Leave Rule ── */}
      <DetailSlideOver open={!!viewRule} title="Leave Rule Details" subtitle={viewRule?.leave_type_name ?? viewRule?.leave_type} onClose={() => setViewRule(null)}>
        {viewRule && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <p className="text-[15px] font-bold text-[var(--text-primary)] syne truncate">{viewRule.leave_type_name ?? viewRule.leave_type ?? '—'}</p>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5 truncate">
                {[viewRule.job_title_name, viewRule.department_name].filter(Boolean).join(' · ') || 'Applies to all'}
              </p>
            </div>

            <DetailSection title="Scope">
              <DetailGrid>
                <DetailField label="Job Title"         value={viewRule.job_title_name} />
                <DetailField label="Department"        value={viewRule.department_name} />
                <DetailField label="Employment Status" value={viewRule.employment_status_name ?? viewRule.employment_status} />
                <DetailField label="Leave Group"       value={viewRule.leave_group_name} />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Entitlement">
              <DetailGrid>
                <DetailField label="Days / Year"        value={viewRule.default_per_year} />
                <DetailField label="Exp. Days Required" value={viewRule.exp_days} />
                <DetailField label="Apply Beyond Bal."  value={viewRule.apply_beyond_current} />
                <DetailField label="Proportionate"      value={viewRule.propotionate_on_joined_date} />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Accrual & Carry Forward">
              <DetailGrid>
                <DetailField label="Leave Accrue"      value={viewRule.leave_accrue} />
                <DetailField label="Accrual Frequency" value={viewRule.leave_accrue === 'Yes' ? (viewRule.accrual_frequency ?? 'Monthly') : '—'} />
                <DetailField label="Accrual Rate"      value={viewRule.leave_accrue === 'Yes' && viewRule.accrual_rate ? `${viewRule.accrual_rate} days/period` : (viewRule.leave_accrue === 'Yes' ? 'Auto' : '—')} />
                <DetailField label="Carry Forward"     value={viewRule.carried_forward} />
                <DetailField label="CF %"              value={viewRule.carried_forward_percentage} />
                <DetailField label="Max CF Days"       value={viewRule.max_carried_forward_amount} />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="Allowance">
              <DetailGrid>
                <DetailField label="Leave Allowance"     value={viewRule.leave_allowance ?? 'No'} />
                <DetailField label="Allowance Frequency" value={viewRule.leave_allowance === 'Yes' ? (viewRule.leave_allowance_once === 'Yes' ? 'Once Per Period' : 'Every Application') : '—'} />
              </DetailGrid>
            </DetailSection>
          </div>
        )}
      </DetailSlideOver>

      {/* ── Leave Rule Form ── */}
      {showRuleForm && (
        <FormModal
          title={editRule ? 'Edit Leave Rule' : 'Add Leave Rule'}
          subtitle="Override leave settings for a specific job title or department."
          onClose={() => { setShowRuleForm(false); setEditRule(null); setRuleForm(RULE_DEFAULTS); }}
          onSave={saveRule}
          maxWidth="2xl"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <FormField label="Leave Type" required hint="The leave type this rule applies to.">
              <select className={inputClass} value={ruleForm.leave_type} onChange={e => setRuleForm((p: any) => ({ ...p, leave_type: e.target.value }))}>
                <option value="">Select leave type…</option>
                {ruleLeaveTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </FormField>

            <FormField label="Job Title" hint="Restrict this rule to employees with a specific job title. Leave blank to apply to all titles.">
              <select className={inputClass} value={ruleForm.job_title} onChange={e => setRuleForm((p: any) => ({ ...p, job_title: e.target.value }))}>
                <option value="">All job titles</option>
                {ruleJobTitles.map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </FormField>

            <FormField label="Department" hint="Restrict this rule to a specific department. Leave blank to apply across all departments.">
              <select className={inputClass} value={ruleForm.department} onChange={e => setRuleForm((p: any) => ({ ...p, department: e.target.value }))}>
                <option value="">All departments</option>
                {ruleDepartments.map((d: any) => <option key={d.id} value={d.id}>{d.title ?? d.name}</option>)}
              </select>
            </FormField>

            <FormField label="Employment Status" hint="Restrict this rule to employees with a specific employment status, e.g. Permanent, Contract. Leave blank to apply to all.">
              <select className={inputClass} value={ruleForm.employment_status} onChange={e => setRuleForm((p: any) => ({ ...p, employment_status: e.target.value }))}>
                <option value="">All employment statuses</option>
                {ruleEmpStatuses.map((s: any) => <option key={s.id} value={s.id}>{s.label ?? s.value}</option>)}
              </select>
            </FormField>

            <FormField label="Leave Group" hint="Restrict this rule to employees belonging to a specific paygrade group. Leave blank to apply to all groups.">
              <select className={inputClass} value={ruleForm.leave_group} onChange={e => setRuleForm((p: any) => ({ ...p, leave_group: e.target.value }))}>
                <option value="">All leave groups</option>
                {leaveGroups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </FormField>

            <FormField label="Required Experience (Days)" hint="Minimum number of days an employee must have been employed before they are eligible for this leave type under this rule. Leave blank for no minimum.">
              <input type="number" min="0" className={inputClass} value={ruleForm.exp_days} onChange={e => setRuleForm((p: any) => ({ ...p, exp_days: e.target.value }))} onWheel={e => e.currentTarget.blur()} placeholder="e.g. 90" />
            </FormField>

            <FormField label="Default Days / Year" hint="Number of days this rule grants per leave period, overriding the leave type default.">
              <input type="number" className={inputClass} value={ruleForm.default_per_year} onChange={e => setRuleForm((p: any) => ({ ...p, default_per_year: e.target.value }))} onWheel={(e: any) => e.currentTarget.blur()} />
            </FormField>

            <FormField label="Apply Beyond Balance" hint="Allow employees matching this rule to apply even when their balance is zero or negative.">
              <select className={inputClass} value={ruleForm.apply_beyond_current} onChange={e => setRuleForm((p: any) => ({ ...p, apply_beyond_current: e.target.value }))}>
                <option value="No">No</option><option value="Yes">Yes</option>
              </select>
            </FormField>

            <FormField label="Leave Accrue" hint="Whether leave days are accrued gradually for employees under this rule.">
              <select className={inputClass} value={ruleForm.leave_accrue} onChange={e => setRuleForm((p: any) => ({ ...p, leave_accrue: e.target.value }))}>
                <option value="No">No</option><option value="Yes">Yes</option>
              </select>
            </FormField>

            {ruleForm.leave_accrue === 'Yes' && (
              <FormField label="Accrual Frequency" hint="How often days are granted — Monthly, Quarterly (every 3 months), or Bi-annually (every 6 months).">
                <select className={inputClass} value={ruleForm.accrual_frequency} onChange={(e: any) => setRuleForm((p: any) => ({ ...p, accrual_frequency: e.target.value }))}>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Bi-annually">Bi-annually</option>
                </select>
              </FormField>
            )}

            {ruleForm.leave_accrue === 'Yes' && (
              <FormField label="Accrual Rate (days per period)" hint="Optional. Days earned per accrual period. Leave blank to auto-divide the rule's annual allocation evenly.">
                <input type="number" className={inputClass} value={ruleForm.accrual_rate} onChange={(e: any) => setRuleForm((p: any) => ({ ...p, accrual_rate: e.target.value }))} min="0" step="0.01" placeholder="Auto" onWheel={(e: any) => e.currentTarget.blur()} />
                {(() => {
                  const rate        = parseFloat(ruleForm.accrual_rate);
                  const alloc       = parseFloat(ruleForm.default_per_year);
                  const periods     = ruleForm.accrual_frequency === 'Quarterly' ? 4 : ruleForm.accrual_frequency === 'Bi-annually' ? 2 : 12;
                  const periodLabel = ruleForm.accrual_frequency === 'Quarterly' ? 'quarter' : ruleForm.accrual_frequency === 'Bi-annually' ? 'half' : 'month';
                  if (!rate || !alloc) return null;
                  const annualAccrual = rate * periods;
                  const periodsToFull = Math.ceil(alloc / rate);
                  const low  = Math.floor(alloc / periods);
                  const high = Math.ceil(alloc / periods);
                  if (annualAccrual > alloc) return (
                    <p className="mt-1 text-[11px] text-amber-600">
                      At {rate} days/{periodLabel} the full {alloc} days accrue by {periodLabel} {periodsToFull} of {periods} — no new accrual for the remaining {periods - periodsToFull}.
                      {low > 0 && ` Use ${low} days/${periodLabel} to spread evenly (${low * periods} days total${low * periods < alloc ? `, ${alloc - low * periods} short` : ''}).`}
                    </p>
                  );
                  if (annualAccrual < alloc) return (
                    <p className="mt-1 text-[11px] text-amber-600">
                      At {rate} days/{periodLabel} only {annualAccrual} of {alloc} days accrue by year end — {alloc - annualAccrual} day(s) will never be granted.
                      {` Use ${high} days/${periodLabel} so all ${alloc} days are reached by year end (last ${periodLabel} may grant fewer).`}
                    </p>
                  );
                  return <p className="mt-1 text-[11px] text-green-600">✓ Rate spreads the full allocation evenly across all {periods} {periodLabel}s.</p>;
                })()}
              </FormField>
            )}

            <FormField label="Carry Forward" hint="Whether unused leave at period end is carried over for employees under this rule.">
              <select className={inputClass} value={ruleForm.carried_forward} onChange={e => setRuleForm((p: any) => ({ ...p, carried_forward: e.target.value }))}>
                <option value="No">No</option><option value="Yes">Yes</option>
              </select>
            </FormField>

            <FormField label="Carry Forward %" hint="Percentage of unused days that carry over. 100 = full balance.">
              <input type="number" className={inputClass} value={ruleForm.carried_forward_percentage} onChange={e => setRuleForm((p: any) => ({ ...p, carried_forward_percentage: e.target.value }))} onWheel={(e: any) => e.currentTarget.blur()} />
            </FormField>

            <FormField label="Max Carry Forward Days" hint="Maximum number of days that can carry over. 0 = no cap.">
              <input type="number" className={inputClass} value={ruleForm.max_carried_forward_amount} onChange={e => setRuleForm((p: any) => ({ ...p, max_carried_forward_amount: e.target.value }))} onWheel={(e: any) => e.currentTarget.blur()} />
            </FormField>

            <FormField label="Proportionate on Join Date" hint="When set to Yes, a new joiner's entitlement is reduced based on how much of the period remains. Formula: (months remaining from hire date ÷ total period months) × full allocation, rounded to the nearest whole day. Only applies if the employee's hire date falls within the active leave period.">
              <select className={inputClass} value={ruleForm.propotionate_on_joined_date} onChange={e => setRuleForm((p: any) => ({ ...p, propotionate_on_joined_date: e.target.value }))}>
                <option value="Yes">Yes</option><option value="No">No</option>
              </select>
            </FormField>

            <FormField label="Leave Allowance" hint="Whether employees matching this rule are eligible for a leave allowance payout. Overrides the leave type's allowance setting when this rule applies.">
              <select className={inputClass} value={ruleForm.leave_allowance} onChange={e => setRuleForm((p: any) => ({ ...p, leave_allowance: e.target.value }))}>
                <option value="No">No</option><option value="Yes">Yes</option>
              </select>
            </FormField>

            {ruleForm.leave_allowance === 'Yes' && (
              <FormField label="Allowance Frequency" hint="'Every Application' pays each time. 'Once Per Period' limits the payout to the first approved leave of this type per leave period.">
                <select className={inputClass} value={ruleForm.leave_allowance_once} onChange={e => setRuleForm((p: any) => ({ ...p, leave_allowance_once: e.target.value }))}>
                  <option value="No">Every Application</option>
                  <option value="Yes">Once Per Leave Period</option>
                </select>
              </FormField>
            )}
          </div>
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

// Map API leave type fields → form field names
function typeToFormData(t: any) {
  return {
    name:                      t.name ?? '',
    gl:                        t.leave_gl ?? '',
    leavesPerPeriod:           String(t.default_per_year ?? '0'),
    adminCanAssign:            t.supervisor_leave_assign ?? 'Yes',
    applyBeyondBalance:        t.apply_beyond_current ?? 'No',
    accrualFrequency:          t.accrual_frequency ?? 'Monthly',
    accrualRate:               t.accrual_rate != null ? String(t.accrual_rate) : '',
    leaveAccrueEnabled:        t.leave_accrue ?? 'No',
    leaveCarriedForward:       t.carried_forward ?? 'No',
    percentageCarriedForward:  String(t.carried_forward_percentage ?? '100'),
    maxCarriedForwardAmount:   String(t.max_carried_forward_amount ?? '0'),
    carriedForwardAvailability: daysToAvailability(t.carried_forward_leave_availability),
    proportionateOnJoined:     t.propotionate_on_joined_date ?? 'Yes',
    sendNotificationEmails:    t.send_notification_emails ?? 'Yes',
    leaveGroups:               Array.isArray(t.group_ids) ? t.group_ids.map(String) : [],
    leaveColor:                t.leave_color ?? '#3b82f6',
    leaveAllowance:            t.leave_allowance ?? 'No',
    leaveAllowanceOnce:        t.leave_allowance_once ?? 'No',
    gender:                    t.gender ?? 'All',
  };
}

function availabilityToDays(label: string): number {
  if (!label) return 365;
  if (label.includes('1 Month') || label === '1M') return 30;
  if (label.includes('3 Month') || label === '3M') return 90;
  if (label.includes('6 Month') || label === '6M') return 180;
  return 365;
}

function daysToAvailability(days: number | null): string {
  if (!days || days >= 300) return '1 Year';
  if (days >= 150) return '6 Months';
  if (days >= 60)  return '3 Months';
  return '1 Month';
}
