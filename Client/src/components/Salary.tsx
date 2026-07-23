import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Edit, Trash2, DollarSign, Users, BarChart2, GitBranch, CreditCard, TrendingUp, Clock, X, AlertTriangle, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { currencyCode } from '../../lib/currency';
import { Combobox } from './EmployeeTabs';
import { ConfirmAlert } from './ConfirmAlert';
import { FormModal } from './ui/FormModal';
import { RowActions } from './ui/RowActions';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FilterSelect } from './ui/FilterSelect';
import { CountedTextarea } from './ui/CountedTextarea';
import { useCan } from '@/hooks/useCan';

// Action permission required to manage each salary tab
const SALARY_TAB_PERM: Record<string, string> = {
  'Components':           'manage_salary_components',
  'Component Assignment': 'manage_notch_setup',
  'Exceptions':           'manage_employee_salary_components',
  'Paygrades & Notches':  'manage_notch_setup',
  'Payment Types':        'manage_payment_types',
  'Increment/Decrement':  'manage_notch_movements',
};

const SALARY_TABS = [
  { label: 'Components',          icon: DollarSign },
  { label: 'Component Assignment', icon: Layers    },
  { label: 'Exceptions',          icon: Users      },
  { label: 'Paygrades & Notches', icon: BarChart2  },
  { label: 'Payment Types',       icon: CreditCard },
  { label: 'Increment/Decrement', icon: TrendingUp },
];

const ENDPOINTS: Record<string, string> = {
  'Components':          '/salary/components',
  'Exceptions': '/salary/employee-components',
  'Payment Types':       '/salary/payment-types',
  'Increment/Decrement': '/salary/notch-movements',
};

const blankForm = (tab: string) => {
  switch (tab) {
    case 'Components':          return { name: '', details: '', is_notch_linked: 0 };
    case 'Exceptions': return { employees: [], component: '', working_days: '', amount: '', excluded: false };
    case 'Payment Types':       return { name: '', description: '', generate_payslip: 1 };
    case 'Increment/Decrement': return { notchIds: [], operation: 'Increment', percentage: '', date: new Date().toISOString().slice(0, 10) };
    default:                    return {};
  }
};

function fmtMoney(value: any, currency?: string | null) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const cur = currency || currencyCode();   // fall back to the Controls → General currency
  return `${cur ? `${cur} ` : ''}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function optionId(value: any) {
  return value === null || value === undefined ? '' : String(value);
}

function MultiSelectEmployeeField({ selected, options, onChange }: { selected: string[]; options: any[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedSet = new Set(selected);
  const filtered = options.filter(o => !search || o.label.toLowerCase().includes(search.toLowerCase()));
  const selectedOptions = options.filter(o => selectedSet.has(optionId(o.id)));
  const toggle = (id: string) => onChange(selectedSet.has(id) ? selected.filter(s => s !== id) : [...selected, id]);
  const allFiltered = filtered.length > 0 && filtered.every(o => selectedSet.has(optionId(o.id)));
  const toggleAll = () => {
    const ids = filtered.map(o => optionId(o.id));
    onChange(allFiltered
      ? selected.filter(id => !ids.includes(id))
      : [...new Set([...selected, ...ids])]);
  };

  return (
    <div className="mb-4 relative" ref={ref}>
      <label className="label">Employee <span className="text-[var(--danger)]">*</span></label>
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedOptions.map(o => (
            <span key={o.id} className="pill pill-accent flex items-center gap-1 text-xs">
              {o.label}
              <button type="button" onClick={() => toggle(optionId(o.id))} className="ml-1 leading-none">×</button>
            </span>
          ))}
        </div>
      )}
      <input value={search} onChange={(e: { target: HTMLInputElement }) => { setSearch(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search and select employees..." />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 bg-[var(--surface)] border border-[var(--border)] rounded-lg mt-1 max-h-48 overflow-y-auto shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg)] sticky top-0">
            <span className="text-xs text-[var(--text-muted)]">{selected.length} selected</span>
            <button type="button" onClick={toggleAll} className="text-xs font-semibold text-[var(--accent)] hover:underline">
              {allFiltered ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          {filtered.map(o => {
            const id = optionId(o.id);
            return (
              <label key={o.id} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg)] cursor-pointer text-sm">
                <input type="checkbox" checked={selectedSet.has(id)} onChange={() => toggle(id)} className="accent-[var(--accent)]" />
                {o.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MultiSelectNotchField({
  selectedIds, notches, paygrades, onChange,
}: { selectedIds: string[]; notches: any[]; paygrades: any[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch]     = useState('');
  const [filterPg, setFilterPg] = useState('');
  const selectedSet = new Set(selectedIds);

  const visible = useMemo(() => {
    let list = notches;
    if (filterPg) list = list.filter((n: any) => String(n.paygradeId) === filterPg);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((n: any) => (n.label ?? n.name ?? '').toLowerCase().includes(q));
    return list;
  }, [notches, filterPg, search]);

  const allSelected = visible.length > 0 && visible.every((n: any) => selectedSet.has(String(n.id)));

  const toggle = (id: string) =>
    onChange(selectedSet.has(id) ? selectedIds.filter(s => s !== id) : [...selectedIds, id]);

  const toggleAll = () => {
    const ids = visible.map((n: any) => String(n.id));
    onChange(allSelected
      ? selectedIds.filter(id => !ids.includes(id))
      : [...new Set([...selectedIds, ...ids])]);
  };

  const selectedItems = notches.filter((n: any) => selectedSet.has(String(n.id)));

  return (
    <div className="mb-4">
      <label className="label">Notch(es) <span className="text-[var(--danger)]">*</span></label>

      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {selectedItems.map((n: any) => (
            <span key={n.id} className="pill pill-accent flex items-center gap-1 text-xs">
              {n.label ?? n.name}
              <button type="button" onClick={() => toggle(String(n.id))} className="ml-1 leading-none">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-2">
        <select value={filterPg} onChange={(e: any) => setFilterPg(e.target.value)} className="flex-1 text-xs !py-1.5">
          <option value="">All paygrades</option>
          {paygrades.map((p: any) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
        <input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search notches..." className="flex-1 text-xs !py-1.5" />
      </div>

      <div className="border border-[var(--border)] rounded-lg overflow-hidden" style={{ maxHeight: 200, overflowY: 'auto' }}>
        {visible.length > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg)]">
            <span className="text-xs text-[var(--text-muted)]">{selectedIds.length} selected</span>
            <button type="button" onClick={toggleAll} className="text-xs font-semibold text-[var(--accent)] hover:underline">
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        )}
        {visible.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">No notches found.</p>
        ) : visible.map((n: any) => {
          const id = String(n.id);
          return (
            <label key={n.id} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg)] cursor-pointer border-b border-[var(--border)] last:border-b-0">
              <input type="checkbox" checked={selectedSet.has(id)} onChange={() => toggle(id)} className="accent-[var(--accent)] shrink-0" />
              <span className="flex-1 min-w-0 truncate text-sm">{n.label ?? n.name}</span>
              {n.paygrade_name && <span className="text-xs text-[var(--text-muted)] shrink-0">{n.paygrade_name}</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function TabBar({ activeTab, setActiveTab }: { activeTab: string; setActiveTab: (t: string) => void }) {
  return (
    <div className="flex gap-1.5 mt-2 mb-4 shrink-0" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
      {SALARY_TABS.map(({ label, icon: Icon }) => (
        <button key={label} onClick={() => setActiveTab(label)} className={`tab-btn flex items-center gap-1.5 shrink-0 whitespace-nowrap ${activeTab === label ? 'active' : ''}`}>
          <Icon size={13} className={activeTab === label ? '' : 'text-[var(--text-muted)]'} />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Component Assignment tab — assign salary components to a paygrade or notch ───────────────────
function ComponentAssignmentTab({ refs, canManage, activeTab, setActiveTab }: {
  refs: any; canManage: boolean; activeTab: string; setActiveTab: (t: string) => void;
}) {
  const [targetType, setTargetType] = useState<'paygrade' | 'notch'>('paygrade');
  const [targetId, setTargetId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ component: '', amount: '', working_days: '' });
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<any>(null);

  const endpoint = targetType === 'paygrade' ? '/salary/paygrade-components' : '/salary/notch-components';
  const targets = (targetType === 'paygrade' ? refs.paygrades : refs.notches) ?? [];
  // The "grade-linked" component gets its value from the notch amount automatically — flag it so users
  // know assigning it here overrides that notch amount.
  const gradeLinked = (refs.components ?? []).find((c: any) => c.is_notch_linked);
  const selectedIsGradeLinked = gradeLinked && String(form.component) === String(gradeLinked.id);

  const load = async () => {
    if (!targetId) { setRows([]); return; }
    setLoading(true);
    try { const r = await api.get(`${endpoint}?target_id=${targetId}`); setRows(r.data.data ?? []); }
    catch { toast.error('Failed to load assignments'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [targetType, targetId]);
  // Reset the selected target when switching paygrade/notch
  useEffect(() => { setTargetId(''); setRows([]); }, [targetType]);

  const openAdd = () => { setEditing(null); setForm({ component: '', amount: '', working_days: '' }); setModalOpen(true); };
  const openEdit = (row: any) => { setEditing(row); setForm({ component: String(row.component_id), amount: row.amount ?? '', working_days: row.working_days ?? '' }); setModalOpen(true); };

  const save = async () => {
    if (!targetId) return toast.error(`Select a ${targetType} first`);
    if (!editing && !form.component) return toast.error('Component is required');
    setSaving(true);
    try {
      if (editing) await api.put(`${endpoint}/${editing.id}`, { amount: form.amount, working_days: form.working_days });
      else await api.post(endpoint, { target_id: targetId, component: form.component, amount: form.amount, working_days: form.working_days });
      toast.success(editing ? 'Updated' : 'Component assigned');
      setModalOpen(false);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Save failed'); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    const row = pendingDelete; setPendingDelete(null);
    try { await api.delete(`${endpoint}/${row.id}`); toast.success('Removed'); await load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Delete failed'); }
  };

  const targetLabel = (t: any) => t.label ?? t.name ?? `#${t.id}`;

  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Payroll Management" subtitle="Manage salary components, increments, and payment setups." />
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

      <p className="mb-3 max-w-3xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
        Assign components to a <span className="font-semibold text-[var(--text-primary)]">paygrade</span> or
        <span className="font-semibold text-[var(--text-primary)]"> notch</span> — every employee on it inherits them
        (a notch overrides its paygrade). Use <span className="font-semibold text-[var(--text-primary)]">Exceptions</span> for
        per-employee changes.
      </p>
      {gradeLinked && (
        <div className="mb-4 max-w-3xl flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5"
          style={{ background: 'var(--warning-dim)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}>
          <AlertTriangle size={15} className="shrink-0" style={{ color: 'var(--warning)' }} />
          <span className="text-[12.5px] leading-snug text-[var(--text-secondary)]">
            Basic pay is automatic — the <span className="font-semibold text-[var(--text-primary)]">notch amount</span> fills
            <span className="font-semibold text-[var(--text-primary)]"> {gradeLinked.label}</span>, so you don't need to assign it here.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden">
          {(['paygrade', 'notch'] as const).map(t => (
            <button key={t} onClick={() => setTargetType(t)}
              className={`px-4 py-2 text-[13px] font-semibold capitalize transition-colors ${targetType === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg)]'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="w-72">
          <Combobox
            options={targets.map((t: any) => ({ id: String(t.id), label: targetLabel(t) }))}
            value={targetId}
            onChange={(id: string) => setTargetId(id)}
            placeholder={`Select a ${targetType}…`}
          />
        </div>
        {targetId && canManage && (
          <button onClick={openAdd} className="primary-btn shrink-0"><Plus className="w-[14px] h-[14px]" /> Assign Component</button>
        )}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 min-h-0 drop-shadow-sm">
        <div className="overflow-x-auto flex-1">
          {!targetId ? (
            <div className="p-10 text-center text-[var(--text-muted)] text-sm">Select a {targetType} to view and assign its components.</div>
          ) : loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Loading...</div>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>
                {['Component', 'Working Days', 'Amount'].map(h => <th key={h} scope="col" className="th">{h}</th>)}
                {canManage && <th className="th text-right"><span className="sr-only">Actions</span></th>}
              </tr></thead>
              <tbody>
                {rows.length ? rows.map((row, i) => (
                  <motion.tr key={row.id ?? i} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 + i * 0.03 }}>
                    <td className="td font-medium text-[var(--text-primary)]">{row.componentName ?? '-'}</td>
                    <td className="td">{row.working_days ?? '-'}</td>
                    <td className="td">{fmtMoney(row.amount)}</td>
                    {canManage && (
                      <td className="td"><div className="flex justify-end">
                        <RowActions actions={[
                          { label: 'Edit', icon: Edit, onClick: () => openEdit(row) },
                          { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPendingDelete(row) },
                        ]} />
                      </div></td>
                    )}
                  </motion.tr>
                )) : (
                  <tr><td colSpan={4} className="td text-center py-10 text-[var(--text-muted)]">No components assigned to this {targetType} yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modalOpen && (
        <FormModal title={editing ? 'Edit Assigned Component' : 'Assign Component'} onClose={() => setModalOpen(false)} onSave={save} saveLabel={saving ? 'Saving…' : 'Save'}>
          <div className="mb-4">
            <label className="label">Component <span className="text-[var(--danger)]">*</span></label>
            <Combobox
              options={(refs.components ?? []).map((c: any) => ({ id: String(c.id), label: c.is_notch_linked ? `${c.label} — basic pay, from notch amount` : c.label }))}
              value={form.component ? String(form.component) : ''}
              onChange={(id: string) => setForm((f: any) => ({ ...f, component: id }))}
              placeholder="Search component…"
              disabled={!!editing}
            />
          </div>
          {selectedIsGradeLinked && (
            <div className="mb-4 flex items-start gap-2.5 rounded-[10px] px-3.5 py-2.5"
              style={{ background: 'var(--warning-dim)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}>
              <AlertTriangle size={15} className="mt-[1px] shrink-0" style={{ color: 'var(--warning)' }} />
              <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">{gradeLinked.label}</span> is the notched-linked component (basic salary)
                — its value normally comes from the <span className="font-semibold text-[var(--text-primary)]">notch amount</span> in
                Paygrades &amp; Notches. Assigning it here <span className="font-semibold text-[var(--text-primary)]">overrides</span> that for
                everyone on this {targetType}.
              </p>
            </div>
          )}
          <div className="mb-4"><label className="label">No. of working days</label><input type="number" value={form.working_days} onChange={(e) => setForm((f: any) => ({ ...f, working_days: e.target.value }))} placeholder="e.g. 20" /></div>
          <div className="mb-4"><label className="label">Amount</label><input type="number" value={form.amount} onChange={(e) => setForm((f: any) => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
        </FormModal>
      )}
      <ConfirmAlert isOpen={!!pendingDelete} title="Remove Component" message={`Remove "${pendingDelete?.componentName}" from this ${targetType}?`} confirmText="Remove" onConfirm={confirmDelete} onCancel={() => setPendingDelete(null)} />
    </div>
  );
}

export function Salary() {
  const { can } = useCan();
  const [activeTab, setActiveTab] = useState(SALARY_TABS[0].label);
  const canManageTab = () => can(SALARY_TAB_PERM[activeTab] ?? '');

  // ── Standard tabs state ──────────────────────────────────
  const [rows, setRows] = useState<any[]>([]);
  const [refs, setRefs] = useState<any>({ employees: [], components: [], componentTypes: [], notches: [], paygrades: [], currencies: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [form, setForm] = useState<any>(() => blankForm(activeTab));
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<any>({});
  const [pendingDelete, setPendingDelete] = useState<{ row: any; label: string } | null>(null);

  // ── Paygrades & Notches combined tab state ───────────────
  const [pgRows, setPgRows] = useState<any[]>([]);
  const [notchRows, setNotchRows] = useState<any[]>([]);
  const [selectedPg, setSelectedPg] = useState<any>(null);
  const [pgLoading, setPgLoading] = useState(false);
  const [pgModalOpen, setPgModalOpen] = useState(false);
  const [notchModalOpen, setNotchModalOpen] = useState(false);
  const [editingPg, setEditingPg] = useState<any>(null);
  const [editingNotch, setEditingNotch] = useState<any>(null);
  const [pgForm, setPgForm] = useState<any>({ name: '', currency: '', min_salary: '', max_salary: '' });
  const [notchForm, setNotchForm] = useState<any>({ name: '', paygradeId: '', paygradeName: '', currency: '', amount: '' });
  const [pgSaving, setPgSaving] = useState(false);
  const [notchSaving, setNotchSaving] = useState(false);
  const [pgDeleting, setPgDeleting] = useState<any>(null);
  const [notchDeleting, setNotchDeleting] = useState<any>(null);
  const [pgSearch, setPgSearch]         = useState('');
  const [pgPage, setPgPage]             = useState(1);
  const [notchSearch, setNotchSearch]   = useState('');
  const [notchPage, setNotchPage]       = useState(1);
  const PG_PAGE_SIZE    = 8;
  const NOTCH_PAGE_SIZE = 6;

  const [tablePage, setTablePage]         = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);

  const [historyEmployee, setHistoryEmployee] = useState<{ id: string; name: string } | null>(null);
  const [historyRows, setHistoryRows]         = useState<any[]>([]);
  const [historyLoading, setHistoryLoading]   = useState(false);

  async function openHistory(row: any) {
    const empId   = String(row.employee);
    const empName = row.employeeName ?? empId;
    setHistoryEmployee({ id: empId, name: empName });
    setHistoryRows([]);
    setHistoryLoading(true);
    try {
      const res = await api.get(`/salary/history/${empId}`);
      setHistoryRows(res.data.data ?? []);
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  }

  // ── Data loading ─────────────────────────────────────────
  const loadRefs = async () => {
    const [refsRes, curRes] = await Promise.all([
      api.get('/salary/refs'),
      api.get('/system/code-lists/CUR/values').catch(() => ({ data: { data: [] } })),
    ]);
    setRefs({ ...(refsRes.data.data ?? {}), currencies: curRes.data.data ?? [] });
  };

  const loadRows = async (tab = activeTab) => {
    setLoading(true);
    try {
      const res = await api.get(ENDPOINTS[tab]);
      setRows(res.data.data ?? []);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? `Failed to load ${tab}`);
    } finally {
      setLoading(false);
    }
  };

  const loadPgNotch = async () => {
    setPgLoading(true);
    try {
      const [pgRes, notchRes] = await Promise.all([
        api.get('/salary/paygrades'),
        api.get('/salary/notches'),
      ]);
      const pgs = pgRes.data.data ?? [];
      setPgRows(pgs);
      setNotchRows(notchRes.data.data ?? []);
      setSelectedPg((prev: any) => prev ? (pgs.find((p: any) => p.id === prev.id) ?? null) : null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to load paygrades/notches');
    } finally {
      setPgLoading(false);
    }
  };

  useEffect(() => {
    loadRefs().catch(() => toast.error('Failed to load salary reference data'));
  }, []);

  useEffect(() => {
    if (activeTab === 'Paygrades & Notches') {
      loadPgNotch();
    } else if (ENDPOINTS[activeTab]) {
      // Generic CRUD tabs. Tabs with their own data handling (e.g. Component Assignment) are skipped.
      setRows([]);
      setSearchQuery('');
      setFilter({});
      loadRows(activeTab);
    } else {
      setRows([]);
    }
  }, [activeTab]);

  // ── Paygrade handlers ────────────────────────────────────
  const openAddPg = () => { setEditingPg(null); setPgForm({ name: '', currency: '', min_salary: '', max_salary: '' }); setPgModalOpen(true); };
  const openEditPg = (row: any) => { setEditingPg(row); setPgForm({ name: row.name ?? '', currency: row.currency ?? '', min_salary: row.min_salary ?? '', max_salary: row.max_salary ?? '' }); setPgModalOpen(true); };

  const handleSavePg = async () => {
    if (!pgForm.name?.trim()) return toast.error('Paygrade name is required');
    if (!pgForm.currency?.trim()) return toast.error('Currency is required');
    setPgSaving(true);
    try {
      editingPg ? await api.put(`/salary/paygrades/${editingPg.id}`, pgForm) : await api.post('/salary/paygrades', pgForm);
      toast.success(editingPg ? 'Paygrade updated' : 'Paygrade created');
      setPgModalOpen(false);
      await Promise.all([loadPgNotch(), loadRefs()]);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save paygrade');
    } finally { setPgSaving(false); }
  };

  const handleDeletePg = async () => {
    if (!pgDeleting) return;
    const row = pgDeleting; setPgDeleting(null);
    try {
      await api.delete(`/salary/paygrades/${row.id}`);
      toast.success('Paygrade deleted');
      if (selectedPg?.id === row.id) setSelectedPg(null);
      await Promise.all([loadPgNotch(), loadRefs()]);
    } catch (err: any) { toast.error(err?.response?.data?.message ?? 'Failed to delete paygrade'); }
  };

  // ── Notch handlers ───────────────────────────────────────
  const openAddNotch = () => { setEditingNotch(null); setNotchForm({ name: '', paygradeId: selectedPg?.id ?? '', paygradeName: selectedPg?.name ?? '', currency: selectedPg?.currency ?? '', amount: '' }); setNotchModalOpen(true); };
  const openEditNotch = (row: any) => { setEditingNotch(row); setNotchForm({ name: row.name ?? '', paygradeId: row.paygradeId ?? selectedPg?.id ?? '', paygradeName: row.paygrade_name ?? selectedPg?.name ?? '', currency: row.currency ?? '', amount: row.amount ?? '' }); setNotchModalOpen(true); };

  const handleSaveNotch = async () => {
    if (!notchForm.name?.trim()) return toast.error('Notch name is required');
    if (!notchForm.paygradeId) return toast.error('Paygrade is required');
    setNotchSaving(true);
    try {
      editingNotch ? await api.put(`/salary/notches/${editingNotch.id}`, notchForm) : await api.post('/salary/notches', notchForm);
      toast.success(editingNotch ? 'Notch updated' : 'Notch created');
      setNotchModalOpen(false);
      await Promise.all([loadPgNotch(), loadRefs()]);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save notch');
    } finally { setNotchSaving(false); }
  };

  const handleDeleteNotch = async () => {
    if (!notchDeleting) return;
    const row = notchDeleting; setNotchDeleting(null);
    try {
      await api.delete(`/salary/notches/${row.id}`);
      toast.success('Notch deleted');
      await Promise.all([loadPgNotch(), loadRefs()]);
    } catch (err: any) { toast.error(err?.response?.data?.message ?? 'Failed to delete notch'); }
  };

  // Reset notch search/page when paygrade selection changes
  useEffect(() => { setNotchSearch(''); setNotchPage(1); }, [selectedPg?.id]);

  const filteredPgs = useMemo(() => {
    const q = pgSearch.trim().toLowerCase();
    if (!q) return pgRows;
    return pgRows.filter((p: any) => p.name.toLowerCase().includes(q) || (p.currency ?? '').toLowerCase().includes(q));
  }, [pgRows, pgSearch]);
  const pgPageCount  = Math.max(1, Math.ceil(filteredPgs.length / PG_PAGE_SIZE));
  const paginatedPgs = filteredPgs.slice((pgPage - 1) * PG_PAGE_SIZE, pgPage * PG_PAGE_SIZE);

  const filteredNotches = useMemo(() => {
    const base = selectedPg ? notchRows.filter((n: any) => String(n.paygradeId) === String(selectedPg.id)) : [];
    const q = notchSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((n: any) => n.name.toLowerCase().includes(q) || String(n.amount ?? '').includes(q));
  }, [notchRows, selectedPg, notchSearch]);
  const notchPageCount  = Math.max(1, Math.ceil(filteredNotches.length / NOTCH_PAGE_SIZE));
  const paginatedNotches = filteredNotches.slice((notchPage - 1) * NOTCH_PAGE_SIZE, notchPage * NOTCH_PAGE_SIZE);

  // ── Standard tab logic ───────────────────────────────────
  const filteredRows = useMemo(() => {
    let result = rows;
    const q = searchQuery.trim().toLowerCase();
    if (q) result = result.filter((row: any) => JSON.stringify(row).toLowerCase().includes(q));
    if (activeTab === 'Exceptions') {
      if (filter.employee) result = result.filter((row: any) => String(row.employee) === filter.employee);
      if (filter.component) result = result.filter((row: any) => String(row.component) === filter.component);
    }
    return result;
  }, [rows, searchQuery, filter, activeTab]);

  useEffect(() => { setTablePage(1); }, [activeTab, searchQuery, filter]);

  const pagedRows: any[] = filteredRows.slice((tablePage - 1) * tablePageSize, tablePage * tablePageSize);

  const openAdd = () => { setSelectedRow(null); setForm(blankForm(activeTab)); setIsModalOpen(true); };
  const openEdit = (row: any) => {
    setSelectedRow(row);
    if (activeTab === 'Exceptions') {
      setForm({ employees: [optionId(row.employee)], component: optionId(row.component), working_days: row.working_days ?? '', amount: row.amount ?? '', excluded: row.excluded === 1 || row.excluded === true });
    } else {
      setForm({ ...blankForm(activeTab), ...row });
    }
    setIsModalOpen(true);
  };

  const validate = () => {
    if (activeTab === 'Components' && !form.name?.trim()) return 'Component name is required';
    if (activeTab === 'Exceptions' && (!form.employees?.length || !form.component)) return 'Employee and component are required';
    if (activeTab === 'Exceptions') {
      const duplicates = rows.filter((row: any) =>
        String(row.component) === String(form.component) &&
        form.employees.map(String).includes(String(row.employee)) &&
        (!selectedRow || String(row.id) !== String(selectedRow.id))
      );
      if (duplicates.length) {
        const names = duplicates.map((row: any) => row.employeeName ?? row.employee).join(', ');
        return `Component already assigned to: ${names}`;
      }
    }
    if (activeTab === 'Payment Types' && !form.name?.trim()) return 'Payment type is required';
    if (activeTab === 'Increment/Decrement' && (!form.notchIds?.length || !form.percentage)) return 'Select at least one notch and provide a percentage';
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) return toast.error(error);
    setSaving(true);
    try {
      const endpoint = ENDPOINTS[activeTab];
      if (activeTab === 'Exceptions') {
        const { employees, ...rest } = form;
        if (selectedRow) {
          await api.put(`${endpoint}/${selectedRow.id}`, { ...rest, employee: employees[0] });
          toast.success('Record updated');
        } else {
          await Promise.all(employees.map((empId: string) => api.post(endpoint, { ...rest, employee: empId })));
          toast.success(employees.length > 1 ? `${employees.length} records created` : 'Record created');
        }
      } else if (selectedRow && activeTab !== 'Increment/Decrement') {
        await api.put(`${endpoint}/${selectedRow.id}`, form);
        toast.success('Record updated');
      } else if (activeTab === 'Increment/Decrement') {
        const { notchIds, ...rest } = form;
        await Promise.all((notchIds as string[]).map((notchId: string) =>
          api.post(endpoint, { ...rest, notchId })
        ));
        toast.success(`Salary change applied to ${notchIds.length} notch${notchIds.length > 1 ? 'es' : ''}`);
      } else {
        await api.post(endpoint, form);
        toast.success('Record created');
      }
      setIsModalOpen(false);
      await Promise.all([loadRows(activeTab), loadRefs()]);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save record');
    } finally { setSaving(false); }
  };

  const handleDelete = (row: any) => setPendingDelete({ row, label: row.name ?? row.code ?? 'this record' });
  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const { row } = pendingDelete; setPendingDelete(null);
    try {
      await api.delete(`${ENDPOINTS[activeTab]}/${row.id}`);
      toast.success('Record deleted');
      await Promise.all([loadRows(activeTab), loadRefs()]);
    } catch (err: any) { toast.error(err?.response?.data?.message ?? 'Failed to delete record'); }
  };

  const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));
  const setF = (key: string, value: string) => setFilter((prev: any) => ({ ...prev, [key]: value }));

  const renderFilterBar = () => {
    if (activeTab !== 'Exceptions') return null;
    const hasFilter = filter.employee || filter.component;
    return (
      <>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)] shrink-0">Employee</span>
          <FilterSelect
            value={filter.employee ?? ''}
            onChange={v => setF('employee', v)}
            placeholder="All"
            minWidth={170}
            options={[{ value: '', label: 'All' }, ...(refs.employees ?? []).map((e: any) => ({ value: String(e.id), label: e.label }))]}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-secondary)] shrink-0">Component</span>
          <FilterSelect
            value={filter.component ?? ''}
            onChange={v => setF('component', v)}
            placeholder="All"
            minWidth={170}
            options={[{ value: '', label: 'All' }, ...(refs.components ?? []).map((c: any) => ({ value: String(c.id), label: c.label }))]}
          />
        </div>
        {hasFilter && <button onClick={() => setFilter({})} className="text-xs text-[var(--accent)] hover:underline shrink-0">Clear</button>}
      </>
    );
  };

  const renderModalContent = () => {
    switch (activeTab) {
      case 'Components': {
        const linkedComp = rows.find((c: any) => c.is_notch_linked);
        const isCurrentlyLinked = selectedRow ? String(linkedComp?.id) === String(selectedRow.id) : false;
        const otherIsLinked = !!linkedComp && !isCurrentlyLinked;
        return (
          <>
            <div className="mb-4"><label className="label">Name <span className="text-[var(--danger)]">*</span></label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Enter component name" /></div>
            <div className="mb-4"><label className="label">Details</label><CountedTextarea rows={3} maxChars={500} value={form.details} onChange={(e) => set('details', e.target.value)} placeholder="Enter details" /></div>
            <div className="mb-4">
              <label className="label">Grade Scale</label>
              <label className={`flex items-center gap-2 ${otherIsLinked ? 'opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={!!form.is_notch_linked}
                  onChange={(e: any) => set('is_notch_linked', e.target.checked ? 1 : 0)}
                  disabled={otherIsLinked}
                  className="accent-[var(--accent)]"
                />
                <span className="text-[13px] text-[var(--text-primary)]">Links this component to the employee's notches</span>
              </label>
              {otherIsLinked && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  <strong>{linkedComp.name}</strong> is currently linked. Unlink it first to link this one.
                </p>
              )}
            </div>
          </>
        );
      }
      case 'Exceptions':
        return (
          <>
            <p className="mb-4 text-[12px] text-[var(--text-muted)] leading-relaxed">
              Exceptions override the components an employee inherits from their paygrade/notch. Use them to
              change an amount, exclude an inherited component, or add an extra one.
            </p>
            <MultiSelectEmployeeField selected={form.employees} options={refs.employees ?? []} onChange={(employees: string[]) => setForm((p: any) => ({ ...p, employees }))} />
            <div className="mb-4">
              <label className="label">Component <span className="text-[var(--danger)]">*</span></label>
              <Combobox
                options={(refs.components ?? []).map((c: any) => ({ id: String(c.id), label: c.label }))}
                value={form.component ? String(form.component) : ''}
                onChange={(id: string) => set('component', id)}
                placeholder="Search component…"
              />
            </div>
            <label className="mb-4 flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]" checked={!!form.excluded}
                onChange={(e) => set('excluded', e.target.checked)} />
              <span className="text-[13px] text-[var(--text-primary)]">Exclude this component for the selected employee(s)</span>
            </label>
            {!form.excluded && <>
              <div className="mb-4"><label className="label">No. of working days</label><input type="number" value={form.working_days} onChange={(e) => set('working_days', e.target.value)} placeholder="e.g. 20" /></div>
              <div className="mb-4"><label className="label">Amount</label><input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" /></div>
            </>}
          </>
        );
      case 'Payment Types':
        return (
          <>
            <div className="mb-4"><label className="label">Payment Type <span className="text-[var(--danger)]">*</span></label><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Enter payment type" /></div>
            <div className="mb-4"><label className="label">Description</label><CountedTextarea rows={3} maxChars={500} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Enter description" /></div>
            <div className="mb-4">
              <label className="label">Payslip Generation</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.generate_payslip}
                  onChange={(e: any) => set('generate_payslip', e.target.checked ? 1 : 0)}
                  className="accent-[var(--accent)]"
                />
                <span className="text-[13px] text-[var(--text-primary)]">Generate employee payslips for runs of this type</span>
              </label>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Disable for allowances, 13th month, or other payments that don't need individual payslips.</p>
            </div>
          </>
        );
      case 'Increment/Decrement':
        return (
          <>
            <MultiSelectNotchField
              selectedIds={form.notchIds ?? []}
              notches={refs.notches ?? []}
              paygrades={refs.paygrades ?? []}
              onChange={(notchIds: string[]) => setForm((p: any) => ({ ...p, notchIds }))}
            />
            <div className="mb-4"><label className="label">Operation</label><select value={form.operation} onChange={(e) => set('operation', e.target.value)}><option>Increment</option><option>Decrement</option></select></div>
            <div className="mb-4"><label className="label">Change % <span className="text-[var(--danger)]">*</span></label><input type="number" value={form.percentage} onChange={(e) => set('percentage', e.target.value)} placeholder="0.00" /></div>
            <div className="mb-4"><label className="label">Date</label><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          </>
        );
      default: return null;
    }
  };

  const renderHead = () => {
    if (activeTab === 'Components')          return ['Name', 'Details'];
    if (activeTab === 'Exceptions') return ['Employee', 'Component', 'Working Days', 'Amount / Effect'];
    if (activeTab === 'Payment Types')       return ['Payment Type', 'Description'];
    return ['Date', 'Notch', 'Change'];
  };

  const renderCells = (row: any) => {
    if (activeTab === 'Components')          return [
      <span key="name" className="flex items-center gap-1.5">
        {row.name}
        {row.is_notch_linked ? <span className="pill pill-accent text-[10px]">Grade-Linked</span> : null}
      </span>,
      row.details ?? '-',
    ];
    if (activeTab === 'Exceptions') return [
      row.employeeName ?? '-', row.componentName ?? '-',
      (row.excluded === 1 || row.excluded === true) ? '-' : (row.working_days ?? '-'),
      (row.excluded === 1 || row.excluded === true)
        ? <span key="ex" className="pill text-[10px]" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>Excluded</span>
        : fmtMoney(row.amount),
    ];
    if (activeTab === 'Payment Types')       return [
      <span key="name" className="flex items-center gap-1.5">
        {row.name}
        {!row.generate_payslip ? <span className="pill text-[10px]">No Payslip</span> : null}
      </span>,
      row.description ?? '-',
    ];
    return [row.date ? new Date(row.date).toLocaleDateString() : '-', row.employees, row.no_notches];
  };

  const canEditDelete = activeTab !== 'Increment/Decrement';

  const currencyOpts = (refs.currencies ?? []).map((c: any) => ({
    id: c.code ?? c.label,
    label: c.code ? `${c.code} — ${c.label}` : c.label,
  }));

  // ── Component Assignment — assign components to a paygrade/notch ──
  if (activeTab === 'Component Assignment') {
    return <ComponentAssignmentTab refs={refs} canManage={canManageTab()} activeTab={activeTab} setActiveTab={setActiveTab} />;
  }

  // ── Paygrades & Notches — two-panel view ─────────────────
  if (activeTab === 'Paygrades & Notches') {
    const setPg = (key: string, val: any) => setPgForm((p: any) => ({ ...p, [key]: val }));
    const setN  = (key: string, val: any) => setNotchForm((p: any) => ({ ...p, [key]: val }));

    return (
      <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto flex flex-col h-full relative overflow-x-hidden">
        <PageHeader title="Payroll Management" subtitle="Manage salary components, increments, and payment setups." />
        <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

        {pgLoading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)]">Loading...</div>
        ) : (
          <div className="flex gap-4 flex-1 min-h-0">
            {/* Left — Paygrades list */}
            <div className="flex flex-col w-72 shrink-0 bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden drop-shadow-sm">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-2">
                  <BarChart2 size={14} className="text-[var(--accent)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Paygrades</span>
                  <span className="text-xs text-[var(--text-muted)]">({filteredPgs.length})</span>
                </div>
                {canManageTab() && <button onClick={openAddPg} className="primary-btn !px-3 !py-1 !text-xs flex items-center gap-1"><Plus size={11} />Add</button>}
              </div>
              {/* Search */}
              <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
                <input value={pgSearch} onChange={(e: any) => { setPgSearch(e.target.value); setPgPage(1); }} placeholder="Search paygrades..." className="!text-xs !py-1.5 w-full" />
              </div>
              {/* List */}
              <div className="overflow-y-auto flex-1">
                {filteredPgs.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] text-center py-10">{pgSearch ? 'No results.' : 'No paygrades yet.'}</p>
                ) : paginatedPgs.map((pg: any) => {
                  const active = selectedPg?.id === pg.id;
                  return (
                    <div
                      key={pg.id}
                      onClick={() => setSelectedPg(active ? null : pg)}
                      className="flex items-start justify-between px-4 py-3 cursor-pointer border-b border-[var(--border)] last:border-b-0 transition-colors"
                      style={{ background: active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{pg.name}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                          <span className="font-medium">{pg.currency}</span>
                          {(pg.min_salary || pg.max_salary) && <span> · {fmtMoney(pg.min_salary)} – {fmtMoney(pg.max_salary)}</span>}
                        </p>
                      </div>
                      <div className="flex shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                        <RowActions actions={[
                          { label: 'Edit', icon: Edit, onClick: () => openEditPg(pg), hidden: !canManageTab() },
                          { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPgDeleting(pg), hidden: !canManageTab() },
                        ]} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Pagination */}
              {pgPageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] shrink-0">
                  <span className="text-xs text-[var(--text-muted)]">{pgPage}/{pgPageCount}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setPgPage(p => Math.max(1, p - 1))} disabled={pgPage === 1} className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg)] transition-colors">‹</button>
                    <button onClick={() => setPgPage(p => Math.min(pgPageCount, p + 1))} disabled={pgPage === pgPageCount} className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg)] transition-colors">›</button>
                  </div>
                </div>
              )}
            </div>

            {/* Right — Notches for selected paygrade */}
            <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden drop-shadow-sm">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-2">
                  <GitBranch size={14} className="text-[var(--accent)]" />
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {selectedPg ? `Notches — ${selectedPg.name}` : 'Notches'}
                  </span>
                  {selectedPg && <span className="text-xs text-[var(--text-muted)]">({filteredNotches.length})</span>}
                </div>
                {selectedPg && canManageTab() && (
                  <button onClick={openAddNotch} className="primary-btn !px-3 !py-1 !text-xs flex items-center gap-1"><Plus size={11} />Add Notch</button>
                )}
              </div>
              {/* Search (only when paygrade selected) */}
              {selectedPg && (
                <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
                  <input value={notchSearch} onChange={(e: any) => { setNotchSearch(e.target.value); setNotchPage(1); }} placeholder="Search notches..." className="!text-xs !py-1.5 w-full" />
                </div>
              )}

              {!selectedPg ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <GitBranch size={28} className="text-[var(--border)]" />
                  <p className="text-sm text-[var(--text-muted)]">Select a paygrade to view its notches</p>
                </div>
              ) : filteredNotches.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <GitBranch size={28} className="text-[var(--border)]" />
                  <p className="text-sm text-[var(--text-muted)]">{notchSearch ? 'No results.' : `No notches for ${selectedPg.name} yet.`}</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {['Notch', 'Currency', 'Amount', ''].map(h => <th key={h} scope="col" className="th">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedNotches.map((n: any, i: number) => (
                          <motion.tr key={n.id ?? i} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 + i * 0.03 }}>
                            <td className="td font-medium text-[var(--text-primary)]">{n.name}</td>
                            <td className="td">{n.currency ?? '-'}</td>
                            <td className="td">{fmtMoney(n.amount, n.currency)}</td>
                            <td className="td">
                              <div className="flex justify-end">
                                <RowActions actions={[
                                  { label: 'Edit', icon: Edit, onClick: () => openEditNotch(n), hidden: !canManageTab() },
                                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => setNotchDeleting(n), hidden: !canManageTab() },
                                ]} />
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination */}
                  <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] shrink-0">
                    <span className="text-xs text-[var(--text-muted)]">
                      {filteredNotches.length} notch{filteredNotches.length !== 1 ? 'es' : ''} · page {notchPage}/{notchPageCount}
                    </span>
                    <div className="flex gap-1">
                      <button onClick={() => setNotchPage((p: number) => Math.max(1, p - 1))} disabled={notchPage === 1} className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg)] transition-colors">‹</button>
                      <button onClick={() => setNotchPage((p: number) => Math.min(notchPageCount, p + 1))} disabled={notchPage === notchPageCount} className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg)] transition-colors">›</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Paygrade modal */}
        {pgModalOpen && (
          <FormModal title={editingPg ? 'Edit Paygrade' : 'Add Paygrade'} onClose={() => setPgModalOpen(false)} onSave={handleSavePg} saveLabel={pgSaving ? 'Saving...' : 'Save Paygrade'} maxWidth="md" scrollable>
            <div className="mb-4"><label className="label">Name <span className="text-[var(--danger)]">*</span></label><input value={pgForm.name} onChange={(e) => setPg('name', e.target.value)} placeholder="e.g. Grade A" /></div>
            <div className="mb-4">
              <label className="label">Currency <span className="text-[var(--danger)]">*</span></label>
              <Combobox options={currencyOpts} value={pgForm.currency} onChange={(id) => setPg('currency', id)} placeholder="Search currency..." />
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><label className="label">Min Salary</label><input type="number" value={pgForm.min_salary} onChange={(e) => setPg('min_salary', e.target.value)} placeholder="0.00" /></div>
              <div><label className="label">Max Salary</label><input type="number" value={pgForm.max_salary} onChange={(e) => setPg('max_salary', e.target.value)} placeholder="0.00" /></div>
            </div>
          </FormModal>
        )}

        {/* Notch modal */}
        {notchModalOpen && (
          <FormModal title={editingNotch ? 'Edit Notch' : 'Add Notch'} onClose={() => setNotchModalOpen(false)} onSave={handleSaveNotch} saveLabel={notchSaving ? 'Saving...' : 'Save Notch'} maxWidth="sm" scrollable>
            <div className="mb-4"><label className="label">Notch Name <span className="text-[var(--danger)]">*</span></label><input value={notchForm.name} onChange={(e) => setN('name', e.target.value)} placeholder="Enter notch name" /></div>
            <div className="mb-4">
              <label className="label">Paygrade</label>
              <input value={notchForm.paygradeName} readOnly style={{ opacity: 0.7, cursor: 'default' }} />
              {selectedPg?.currency && <p className="mt-1 text-xs text-[var(--text-muted)]">Currency: <span className="font-semibold text-[var(--text-secondary)]">{selectedPg.currency}</span></p>}
            </div>
            <div className="mb-4"><label className="label">Amount</label><input type="number" value={notchForm.amount} onChange={(e) => setN('amount', e.target.value)} placeholder="0.00" /></div>
          </FormModal>
        )}

        <ConfirmAlert isOpen={!!pgDeleting} title="Delete Paygrade" message={`Delete "${pgDeleting?.name}"? This cannot be undone.`} confirmText="Delete" onConfirm={handleDeletePg} onCancel={() => setPgDeleting(null)} />
        <ConfirmAlert isOpen={!!notchDeleting} title="Delete Notch" message={`Delete "${notchDeleting?.name}"? This cannot be undone.`} confirmText="Delete" onConfirm={handleDeleteNotch} onCancel={() => setNotchDeleting(null)} />
      </div>
    );
  }

  // ── All other tabs ───────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Payroll Management" subtitle="Manage salary components, increments, and payment setups." />
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === 'Components' && rows.length > 0 && !rows.some((r: any) => r.is_notch_linked) && (
        <div className="mb-4 flex items-start gap-2 rounded-[10px] border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 text-[13px] text-amber-800 dark:text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            No salary component is linked to the grade scale. Employees paid via grade notches may show incorrect amounts on payroll reports.{' '}
            <button className="underline font-medium" onClick={openAdd}>Link one now</button>
          </span>
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 min-h-0 drop-shadow-sm">
        <TableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={`Search ${activeTab.toLowerCase()}...`}
          showFilters={activeTab === 'Exceptions'}
          filterBar={renderFilterBar()}
          actions={
            canManageTab() ? (
            <button onClick={openAdd} className="primary-btn shrink-0">
              <span className="hidden sm:inline">{activeTab === 'Increment/Decrement' ? 'Apply Change' : 'Add New'}</span>
              <span className="sm:hidden">Add</span>
              <Plus className="w-[14px] h-[14px]" />
            </button>
            ) : undefined
          }
        />

        <div className="overflow-x-auto flex-1">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">Loading...</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {renderHead().map(h => <th key={h} scope="col" className="th">{h}</th>)}
                  {canEditDelete && <th scope="col" className="th text-right"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length ? pagedRows.map((row, i) => (
                  <motion.tr key={row.id ?? i} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 + i * 0.03 }}>
                    {renderCells(row).map((cell, idx) => <td key={idx} className={`td ${idx === 0 ? 'font-medium text-[var(--text-primary)]' : ''}`}>{cell}</td>)}
                    {canEditDelete && (
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'Salary History', icon: Clock, onClick: () => openHistory(row), hidden: activeTab !== 'Exceptions' },
                            { label: 'Edit', icon: Edit, onClick: () => openEdit(row), hidden: !canManageTab() },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDelete(row), hidden: !canManageTab() },
                          ]} />
                        </div>
                      </td>
                    )}
                  </motion.tr>
                )) : (
                  <tr><td colSpan={renderHead().length + (canEditDelete ? 1 : 0)} className="td text-center py-10">No data available for {activeTab}.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <TablePagination
          total={rows.length} filtered={filteredRows.length}
          page={tablePage} pageSize={tablePageSize}
          onPageChange={setTablePage}
          onPageSizeChange={(s) => { setTablePageSize(s); setTablePage(1); }}
        />
      </div>

      {isModalOpen && (
        <FormModal
          title={`${selectedRow ? 'Edit' : activeTab === 'Increment/Decrement' ? 'Apply' : 'Add New'} ${activeTab}`}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
          saveLabel={saving ? 'Saving...' : 'Save Record'}
          maxWidth="md"
          scrollable
        >
          {renderModalContent()}
        </FormModal>
      )}
      <ConfirmAlert
        isOpen={!!pendingDelete}
        title="Delete Record"
        message={`Delete "${pendingDelete?.label}"? This cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Salary history slide-over */}
      <AnimatePresence>
        {historyEmployee && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setHistoryEmployee(null)}
            />
            <motion.div
              className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--surface)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Salary History</p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{historyEmployee.name}</p>
                </div>
                <button onClick={() => setHistoryEmployee(null)} className="action-btn text-[var(--text-muted)]"><X size={16} /></button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {historyLoading ? (
                  <p className="text-sm text-[var(--text-muted)] text-center py-10">Loading...</p>
                ) : historyRows.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] text-center py-10">No history recorded yet.</p>
                ) : (
                  <ol className="relative border-l border-[var(--border)] ml-2">
                    {historyRows.map((h: any) => {
                      const actionColor = h.action === 'created' ? 'var(--success)' : h.action === 'deleted' ? 'var(--danger)' : 'var(--accent)';
                      return (
                        <li key={h.id} className="mb-6 ml-4">
                          <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-[var(--surface)]" style={{ background: actionColor }} />
                          <p className="text-xs font-semibold capitalize" style={{ color: actionColor }}>{h.action}</p>
                          <p className="text-sm font-medium text-[var(--text-primary)] mt-0.5">{h.component_name ?? '—'}</p>
                          {h.action !== 'created' && h.old_amount && (
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Before: <span className="font-medium text-[var(--text-secondary)]">{fmtMoney(h.old_amount)}</span>
                            </p>
                          )}
                          {h.new_amount && (
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              After: <span className="font-medium text-[var(--text-secondary)]">{fmtMoney(h.new_amount)}</span>
                            </p>
                          )}
                          <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            {h.changed_by ? `By ${h.changed_by} · ` : ''}{new Date(h.created_at).toLocaleString()}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
