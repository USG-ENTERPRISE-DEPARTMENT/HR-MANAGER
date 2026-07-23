import { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronDown, Eye, FileEdit, Filter, Plus, Upload, X, Users, Award, FileBadge, Globe, Baby, HeartPulse, RefreshCw, WifiOff, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ConfirmAlert } from './ConfirmAlert';
import { EmployeeFormFull } from './EmployeeFormFull';
import { EmployeeImport } from './EmployeeImport';
import { EmployeeDetailsSlideOver } from './EmployeeDetailsSlideOver';
import { RelationalTab } from './EmployeeTabs';
import { DisciplinaryTab } from './DisciplinaryTab';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { RowActions } from './ui/RowActions';
import { FilterSelect as UIFilterSelect } from './ui/FilterSelect';
import api from '../../lib/api';
import { useCan } from '@/hooks/useCan';

const ICON_TABS = [
  { label: 'Employees',          icon: Users      },
  { label: 'Skills',             icon: Award      },
  // { label: 'Education',          icon: BookOpen   },
  { label: 'Certifications',     icon: FileBadge  },
  { label: 'Languages',          icon: Globe      },
  { label: 'Dependents',         icon: Baby       },
  { label: 'Emergency Contacts', icon: HeartPulse },
  { label: 'Disciplinary',       icon: ShieldAlert },
];

const DEACTIVATED_TABS = ['Suspended Employees', 'Terminated Employees'];

// Status pill helpers
function LifecyclePill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING:    'pill pill-warning',
    ACTIVE:     'pill pill-success',
    SUSPENDED:  'pill pill-warning',
    TERMINATED: 'pill pill-danger',
    RESIGNED:   'pill pill-accent',
  };
  return <span className={styles[status] ?? 'pill'}>{status}</span>;
}

function ApprovalPill({ status }: { status: string }) {
  if (status !== 'REJECTED') return null;
  return <span className="pill pill-danger">REJECTED</span>;
}

function PendingActionPill({ action }: { action: string | null | undefined }) {
  if (!action) return null;
  const map: Record<string, { label: string; cls: string }> = {
    RESIGNED:   { label: 'Resignation Pending', cls: 'bg-rose-50 text-rose-700 border border-rose-200'   },
    SUSPENDED:  { label: 'Suspension Pending',  cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
    TERMINATED: { label: 'Termination Pending', cls: 'bg-red-50 text-red-700 border border-red-200'       },
  };
  const s = map[action];
  if (!s) return null;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${s.cls}`}>{s.label}</span>;
}

export function Employees() {
  const [activeTab, setActiveTab]     = useState('Employees');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage]               = useState(1);
  const [pageSize, setPageSize]       = useState(10);
  const [filters, setFilters] = useState({
    department: '', branch: '', unit: '', jobTitle: '',
    employmentStatus: '', staffLevel: '', lifecycleStatus: '',
    approvalStatus: '', hireFrom: '', hireTo: '',
  });

  const [employees, setEmployees]         = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);
  const [isFormOpen, setIsFormOpen]       = useState(false);
  const [importOpen, setImportOpen]       = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen]     = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await api.get('/employees');
      setEmployees(res.data.data ?? []);
    } catch {
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);
  useEffect(() => { setPage(1); }, [searchQuery, activeTab, filters]);
  useEffect(() => {
    if (loading || isDetailsOpen) return;
    const targetId = sessionStorage.getItem('centralApproval.employeeId');
    if (!targetId) return;
    const target = employees.find((emp: any) => String(emp.id) === String(targetId));
    if (!target) return;
    sessionStorage.removeItem('centralApproval.employeeId');
    setActiveTab('Employees');
    setSelectedEmployee(target);
    setIsDetailsOpen(true);
  }, [employees, loading, isDetailsOpen]);

  // ── Filter by active tab ─────────────────────────────────────────────────
  const visibleEmployees = useMemo(() => {
    let list = employees;
    if (activeTab === 'Suspended Employees')       list = employees.filter(e => e.lifecycleStatus === 'SUSPENDED');
    else if (activeTab === 'Terminated Employees') list = employees.filter(e => ['TERMINATED', 'RESIGNED'].includes(e.lifecycleStatus));
    else if (activeTab === 'Employees')            list = employees.filter(e => !['SUSPENDED','TERMINATED','RESIGNED'].includes(e.lifecycleStatus));
    return list;
  }, [employees, activeTab]);

  const filtered = useMemo(() => {
    let list = visibleEmployees;

    // ── Text search — name, ID, emails, mobile, department, job title, branch ──
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((e: any) =>
      `${e.firstName ?? ''} ${e.middleName ?? ''} ${e.lastName ?? ''}`.toLowerCase().includes(q) ||
      (e.employee_id   ?? '').toLowerCase().includes(q) ||
      (e.email         ?? '').toLowerCase().includes(q) ||
      (e.work_email    ?? '').toLowerCase().includes(q) ||
      (e.mobilePhone   ?? '').toLowerCase().includes(q) ||
      (e.department?.title ?? '').toLowerCase().includes(q) ||
      (e.jobTitle?.label   ?? '').toLowerCase().includes(q) ||
      (e.branch?.title     ?? '').toLowerCase().includes(q) ||
      (e.supervisor?.name  ?? '').toLowerCase().includes(q)
    );

    // ── Dropdown filters ──────────────────────────────────────────────────────
    if (filters.department)       list = list.filter((e: any) => e.department?.title        === filters.department);
    if (filters.branch)           list = list.filter((e: any) => e.branch?.title            === filters.branch);
    if (filters.unit)             list = list.filter((e: any) => e.unit?.title              === filters.unit);
    if (filters.jobTitle)         list = list.filter((e: any) => e.jobTitle?.label          === filters.jobTitle);
    if (filters.employmentStatus) list = list.filter((e: any) => e.employmentStatus?.label  === filters.employmentStatus);
    if (filters.staffLevel)       list = list.filter((e: any) => e.staffLevel?.label        === filters.staffLevel);
    if (filters.lifecycleStatus)  list = list.filter((e: any) => e.lifecycleStatus          === filters.lifecycleStatus);
    if (filters.approvalStatus)   list = list.filter((e: any) => e.approvalStatus           === filters.approvalStatus);

    // ── Hire date range ───────────────────────────────────────────────────────
    if (filters.hireFrom) list = list.filter((e: any) => e.hireDate && e.hireDate >= filters.hireFrom);
    if (filters.hireTo)   list = list.filter((e: any) => e.hireDate && e.hireDate <= filters.hireTo);

    return list;
  }, [visibleEmployees, searchQuery, filters]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const { can } = useCan();

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleAddClick  = () => { setSelectedEmployee(null); setIsFormOpen(true); };
  const handleEditClick = (emp: any) => { setSelectedEmployee(emp); setIsFormOpen(true); };
  const handleViewClick = (emp: any) => { setSelectedEmployee(emp); setIsDetailsOpen(true); };


  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSync = async (emp: any) => {
    setSyncingId(emp.id);
    try {
      await api.post(`/employees/${emp.id}/sync`);
      toast.success(`${emp.firstName} ${emp.lastName} synced successfully`);
      await fetchEmployees();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Sync failed');
      await fetchEmployees();
    } finally {
      setSyncingId(null);
    }
  };

  const handleSave = async (data: any, id?: string) => {
    try {
      if (id) {
        const res = await api.put(`/employees/${id}`, data);
        toast.success(res.data?.message ?? 'Employee updated');
      } else {
        const res = await api.post('/employees', data);
        toast.success(res.data?.message ?? 'Employee created');
      }
      await fetchEmployees();
      setIsFormOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save employee');
    }
  };

  // ── Filters ──────────────────────────────────────────────────────────────
  const setFilter = (k: keyof typeof filters, v: string) => { setFilters((p: typeof filters) => ({ ...p, [k]: v })); setPage(1); };
  const clearFilters = () => {
    setFilters({ department: '', branch: '', unit: '', jobTitle: '', employmentStatus: '', staffLevel: '', lifecycleStatus: '', approvalStatus: '', hireFrom: '', hireTo: '' });
    setPage(1);
  };
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const uniq = (arr: any[]) => [...new Set(arr.filter(Boolean))].sort() as string[];
  const deptOptions    = useMemo(() => uniq(employees.map((e: any) => e.department?.title)),        [employees]);
  const branchOptions  = useMemo(() => uniq(employees.map((e: any) => e.branch?.title)),            [employees]);
  const unitOptions    = useMemo(() => uniq(employees.map((e: any) => e.unit?.title)),              [employees]);
  const jtOptions      = useMemo(() => uniq(employees.map((e: any) => e.jobTitle?.label)),          [employees]);
  const empStOptions   = useMemo(() => uniq(employees.map((e: any) => e.employmentStatus?.label)),  [employees]);
  const slOptions      = useMemo(() => uniq(employees.map((e: any) => e.staffLevel?.label)),        [employees]);

  const FilterSelect = ({ field, label, options }: { field: keyof typeof filters; label: string; options: string[] }) => (
    <UIFilterSelect
      label={label}
      value={filters[field]}
      onChange={v => setFilter(field, v)}
      options={[{ value: '', label: 'All' }, ...options.map(o => ({ value: o, label: o }))]}
      placeholder="All"
      minWidth={140}
    />
  );

  const filterBar = (
    <div className="flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect field="department"       label="Department"        options={deptOptions}   />
        <FilterSelect field="branch"           label="Branch"            options={branchOptions} />
        <FilterSelect field="unit"             label="Unit"              options={unitOptions}   />
        <FilterSelect field="jobTitle"         label="Job Title"         options={jtOptions}     />
        <FilterSelect field="employmentStatus" label="Employment Status" options={empStOptions}  />
        <FilterSelect field="staffLevel"       label="Staff Level"       options={slOptions}     />
        <FilterSelect field="lifecycleStatus"  label="Lifecycle"         options={['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED']} />
        <FilterSelect field="approvalStatus"   label="Approval"          options={['PENDING', 'APPROVED', 'REJECTED']} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Hired From</label>
          <input type="date" value={filters.hireFrom} onChange={e => setFilter('hireFrom', e.target.value)}
            className="text-[12px] h-8 px-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Hired To</label>
          <input type="date" value={filters.hireTo} onChange={e => setFilter('hireTo', e.target.value)}
            className="text-[12px] h-8 px-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
        </div>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
            <X size={12} /> Clear all ({activeFilterCount})
          </button>
        )}
      </div>
    </div>
  );

  const isTableTab = activeTab === 'Employees' || DEACTIVATED_TABS.includes(activeTab);

  if (isDetailsOpen && selectedEmployee) {
    return (
      <EmployeeDetailsSlideOver
        isOpen
        onClose={() => setIsDetailsOpen(false)}
        employee={selectedEmployee}
        onRefresh={fetchEmployees}
      />
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Employee Directory" subtitle="Manage and view all employee records and details." />

      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4">
        {ICON_TABS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            onClick={() => setActiveTab(label)}
            className={`tab-btn flex items-center gap-2 ${activeTab === label ? 'active' : ''}`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 200)}
            className={`tab-btn flex items-center gap-1 ${DEACTIVATED_TABS.includes(activeTab) ? 'active' : ''}`}
          >
            Deactivated <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </button>
          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-52 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-lg z-50 py-1.5 flex flex-col">
              {DEACTIVATED_TABS.map(tab => (
                <button
                  key={tab}
                  onMouseDown={e => { e.preventDefault(); setActiveTab(tab); setDropdownOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-[13px] hover:bg-[var(--surface-hover)] transition-colors ${activeTab === tab ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-secondary)] font-medium'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {isTableTab ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col min-h-0">
          <TableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search by name, ID or email..."
            showFilters={showFilters}
            filterBar={showFilters ? filterBar : undefined}
            actions={
              <>
                {activeTab === 'Employees' && can('create_employees') && (
                  <>
                    <button onClick={() => setImportOpen(true)} className="secondary-btn shrink-0">
                      <span className="hidden sm:inline">Import</span>
                      <Upload className="w-[14px] h-[14px]" />
                    </button>
                    <button onClick={handleAddClick} className="primary-btn shrink-0">
                      <span className="hidden sm:inline">Add New</span>
                      <span className="sm:hidden">Add</span>
                      <Plus className="w-[14px] h-[14px]" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`secondary-btn shrink-0 relative ${showFilters || activeFilterCount > 0 ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
                >
                  Filter <Filter className="w-[14px] h-[14px] fill-current opacity-80" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </>
            }
          />

          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th w-10"><span className="sr-only">Avatar</span></th>
                  <th className="th">ID</th>
                  <th className="th">Name</th>
                  <th className="th">Mobile</th>
                  <th className="th">Job Title</th>
                  <th className="th">Emp. Status</th>
                  <th className="th">Status</th>
                  <th className="th text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="td text-center py-10 text-[var(--text-muted)]">Loading...</td></tr>
                ) : paged.length > 0 ? (
                  paged.map((row, i) => (
                    <motion.tr key={row.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 + i * 0.03 }}>
                      <td className="td">
                        <div className="w-8 h-8 rounded-lg overflow-hidden border border-[var(--border)] shrink-0">
                          {row.profile_imagebase64 ? (
                            <img src={row.profile_imagebase64} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-[var(--accent-dim)] flex items-center justify-center">
                              <span className="font-bold text-[13px] text-[var(--accent)]">
                                {row.firstName?.charAt(0)?.toUpperCase()}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="td font-medium text-[var(--text-primary)]">{row.employee_id ?? '—'}</td>
                      <td className="td">
                        <span className="font-medium text-[var(--text-primary)]">
                          {[row.title?.label, row.firstName, row.middleName, row.lastName].filter(Boolean).join(' ')}
                        </span>
                      </td>
                      <td className="td">{row.mobilePhone || '—'}</td>
                      <td className="td">{row.jobTitle?.label || '—'}</td>
                      <td className="td">{row.employmentStatus?.label || '—'}</td>
                      <td className="td">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {row.approvalStatus !== 'REJECTED' && <LifecyclePill status={row.lifecycleStatus} />}
                          <ApprovalPill status={row.approvalStatus} />
                          <PendingActionPill action={row.pending_lifecycle_action} />
                          {row.sync_status === 'failed' && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 border border-red-200"
                              title={row.sync_error || 'External sync failed'}
                            >
                              <WifiOff size={9} /> Sync Failed
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View Details', icon: Eye, onClick: () => handleViewClick(row) },
                            {
                              label: 'Edit', icon: FileEdit, onClick: () => handleEditClick(row),
                              hidden: !can('edit_employees'),
                              disabled: ['TERMINATED', 'RESIGNED'].includes(row.lifecycleStatus),
                              title: ['TERMINATED', 'RESIGNED'].includes(row.lifecycleStatus) ? 'Cannot edit a terminated or resigned employee' : undefined,
                            },
                            {
                              label: 'Retry External Sync', icon: RefreshCw, onClick: () => handleSync(row),
                              hidden: row.sync_status !== 'failed',
                              disabled: syncingId === row.id, spin: syncingId === row.id, danger: true,
                            },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="td text-center py-10">No employees found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={visibleEmployees.length}
            filtered={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={p => { setPage(p); }}
            onPageSizeChange={s => { setPageSize(s); setPage(1); }}
          />
        </div>
      ) : activeTab === 'Disciplinary' ? (
        <DisciplinaryTab onViewEmployee={handleViewClick} />
      ) : (
        <RelationalTab activeTab={activeTab} mockEmployees={employees} />
      )}

      {isFormOpen && (
        <EmployeeFormFull
          onClose={() => setIsFormOpen(false)}
          initialData={selectedEmployee}
          onSave={handleSave}
        />
      )}

      {importOpen && (
        <EmployeeImport
          onClose={() => setImportOpen(false)}
          onImported={fetchEmployees}
        />
      )}

    </div>
  );
}
