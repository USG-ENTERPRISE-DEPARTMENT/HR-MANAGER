import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect, ReactNode, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CountedTextarea } from './ui/CountedTextarea';
import { RowActions as KebabActions } from './ui/RowActions';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, X, Search, Trash2, ChevronDown, Check, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { ConfirmAlert } from './ConfirmAlert';
import { useCan } from '@/hooks/useCan';

type Option = { id: string; label: string };

// ── CLV hook ──────────────────────────────────────────────────────────────────
function useClv(code: string) {
  const [opts, setOpts] = useState<Option[]>([]);
  useEffect(() => {
    api.get(`/system/code-lists/${code}/values`)
      .then(r => setOpts((r.data.data ?? []).map((v: any) => ({ id: v.id, label: v.label }))))
      .catch(() => {});
  }, [code]);
  return opts;
}

// ── Searchable Combobox ───────────────────────────────────────────────────────
export type ComboboxOption = Option;

export function Combobox({ options, value, onChange, placeholder = 'Select...', disabled = false }: {
  options: Option[]; value: string; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const selected = options.find(o => o.id === value);

  const updateDropdownPosition = useCallback(() => {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const gap = 6;
    const maxMenuHeight = 260;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(140, Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow));

    setDropdownStyle({
      position: 'fixed',
      left: rect.left,
      top: openUp ? Math.max(gap, rect.top - availableHeight - gap) : rect.bottom + gap,
      width: rect.width,
      maxHeight: availableHeight,
      zIndex: 300,
    });
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);

    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [open, updateDropdownPosition]);

  const filtered = useMemo(() =>
    q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options,
    [options, q]
  );

  const dropdown = open ? createPortal(
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
    >
      <div className="p-2 border-b border-slate-100">
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search..."
          className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-[var(--accent)]"
        />
      </div>
      <div className="overflow-y-auto py-1" style={{ maxHeight: `calc(${dropdownStyle.maxHeight ?? 260}px - 53px)` }}>
        {filtered.length === 0
          ? <p className="px-3 py-2 text-sm text-slate-400">No options</p>
          : filtered.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onChange(o.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--accent-dim)] flex items-center justify-between gap-2 ${value === o.id ? 'text-[var(--accent)] font-semibold' : 'text-slate-700'}`}
            >
              <span>{o.label}</span>
              {value === o.id && <Check size={12} className="shrink-0" />}
            </button>
          ))
        }
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(o => !o); setQ(''); }}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-[var(--surface)] border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[var(--accent)] transition-all font-medium text-left disabled:opacity-60"
      >
        <span className={selected ? 'text-slate-800' : 'text-slate-400'}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} className="text-slate-400 shrink-0 ml-1" />
      </button>
      {dropdown}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, onSave, saving, children }: {
  title: string; onClose: () => void; onSave: () => void;
  saving?: boolean; children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[var(--surface)] w-full max-w-lg rounded-2xl shadow-xl z-10 flex flex-col max-h-[90vh] border border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-[17px] font-bold text-slate-800 syne">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">{children}</div>
        </div>
        <div className="px-6 py-4 border-t border-[var(--border)] flex items-center justify-end gap-3">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <button onClick={onSave} disabled={saving} className="primary-btn flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save Record
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function FL({ children }: { children: ReactNode }) {
  return <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">{children}</label>;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

function profLabel(key: string | null | undefined) {
  if (!key) return '—';
  return key.replace(/_/g, ' ');
}

const PROFICIENCY: Option[] = [
  { id: 'Elementary_Proficiency',           label: 'Elementary Proficiency' },
  { id: 'Limited_Working_Proficiency',      label: 'Limited Working Proficiency' },
  { id: 'Professional_Working_Proficiency', label: 'Professional Working Proficiency' },
  { id: 'Full_Professional_Proficiency',    label: 'Full Professional Proficiency' },
  { id: 'Native_or_Bilingual_Proficiency',  label: 'Native or Bilingual Proficiency' },
];

function inputCls() {
  return 'w-full px-3 py-2.5 bg-[var(--surface)] border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[var(--accent)] font-medium';
}

// ── Delete confirmation hook ──────────────────────────────────────────────────
function useDeleteConfirm() {
  const [pending, setPending] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const ask = (title: string, message: string, onConfirm: () => void) => {
    setPending({ title, message, onConfirm });
  };

  const dialog = (
    <ConfirmAlert
      isOpen={!!pending}
      title={pending?.title ?? ''}
      message={pending?.message ?? ''}
      confirmText="Delete"
      onConfirm={() => { pending?.onConfirm(); setPending(null); }}
      onCancel={() => setPending(null)}
    />
  );

  return { ask, dialog };
}

// ── Tab Shell ─────────────────────────────────────────────────────────────────
function TabShell({ label, onAdd, canManage = true, search, onSearch, children, loading, isEmpty }: {
  label: string; onAdd: () => void; canManage?: boolean; search: string; onSearch: (v: string) => void;
  children: ReactNode; loading: boolean; isEmpty: boolean;
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col min-h-[500px]">
      <div className="p-4 sm:p-5 border-b border-[var(--border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {canManage ? (
          <button onClick={onAdd} className="primary-btn shrink-0">
            <Plus className="w-[14px] h-[14px]" /> Add {label}
          </button>
        ) : <span />}
        <div className="search-wrap w-full sm:w-auto sm:min-w-[240px]">
          <Search size={14} />
          <input type="text" value={search} onChange={e => onSearch(e.target.value)} placeholder={`Search ${label.toLowerCase()}s...`} />
        </div>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : isEmpty ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-3 text-slate-400 p-10">
          <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
            <Search size={24} className="text-slate-300" />
          </div>
          <p className="text-sm font-medium">No {label.toLowerCase()} records found.</p>
          {canManage && <button onClick={onAdd} className="text-[var(--accent)] text-sm font-semibold hover:underline">Create the first record</button>}
        </div>
      ) : (
        <div className="overflow-y-auto flex-1 overflow-x-auto">{children}</div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toEmpOpts(employees: any[]): Option[] {
  return employees.map(e => ({
    id: String(e.id),
    label: `${e.firstName} ${e.lastName}${e.employee_id ? ` (${e.employee_id})` : ''}`,
  }));
}

function EmpCell({ emp }: { emp: any }) {
  return (
    <td className="td">
      <span className="font-medium text-[var(--text-primary)] text-[13px]">{emp?.name ?? '—'}</span>
      {emp?.employee_id && <span className="ml-1 text-[11px] text-[var(--text-muted)]">({emp.employee_id})</span>}
    </td>
  );
}

function RowActions({ onEdit, onDelete, canManage = true }: { onEdit: () => void; onDelete: () => void; canManage?: boolean }) {
  if (!canManage) return <td className="td text-right text-[var(--text-muted)]">—</td>;
  return (
    <td className="td text-right">
      <div className="flex justify-end">
        <KebabActions actions={[
          { label: 'Edit', icon: Pencil, onClick: onEdit },
          { label: 'Remove', icon: Trash2, danger: true, onClick: onDelete },
        ]} />
      </div>
    </td>
  );
}

// ── 1. Skills ─────────────────────────────────────────────────────────────────
const SKILL_BLANK = { employee_id: '', skill_id: '', details: '' };

function SkillsTab({ employees, canManage = true }: { employees: any[]; canManage?: boolean }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm]     = useState({ ...SKILL_BLANK });

  const skillOpts = useClv('SKL');
  const empOpts   = useMemo(() => toEmpOpts(employees), [employees]);
  const { ask: askDelete, dialog: deleteDialog } = useDeleteConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/skills'); setRows(r.data.data ?? []); }
    catch { toast.error('Failed to load skills'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? rows : rows.filter(r =>
      r.employee?.name?.toLowerCase().includes(q) ||
      r.skill?.label?.toLowerCase().includes(q) ||
      r.details?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const openAdd = () => { setEditId(null); setForm({ ...SKILL_BLANK }); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ employee_id: r.employee?.id ?? '', skill_id: r.skill_id ?? '', details: r.details ?? '' }); setOpen(true); };

  const handleSave = async () => {
    if (!editId && !form.employee_id) return toast.error('Employee is required');
    if (!form.skill_id) return toast.error('Skill is required');
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/skills/${editId}`, { skill_id: form.skill_id, details: form.details });
        toast.success('Skill updated');
      } else {
        await api.post('/skills', form);
        toast.success('Skill added');
      }
      setOpen(false);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save skill'); }
    finally { setSaving(false); }
  };

  const handleDelete = (row: any) => {
    askDelete(
      'Remove Skill',
      `Remove "${row.skill?.label ?? 'this skill'}" for ${row.employee?.name ?? 'this employee'}? This cannot be undone.`,
      async () => {
        try { await api.delete(`/skills/${row.id}`); toast.success('Skill removed'); setRows(r => r.filter(x => x.id !== row.id)); }
        catch { toast.error('Failed to remove skill'); }
      }
    );
  };

  return (
    <>
      <TabShell label="Skill" onAdd={openAdd} canManage={canManage} search={search} onSearch={setSearch} loading={loading} isEmpty={filtered.length === 0}>
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="th">Employee</th><th className="th">Skill</th><th className="th">Details</th>
            <th className="th text-right"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <motion.tr key={r.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                <EmpCell emp={r.employee} />
                <td className="td text-[13px]">{r.skill?.label ?? '—'}</td>
                <td className="td text-[13px] max-w-[200px] truncate">{r.details ?? '—'}</td>
                <RowActions onEdit={() => openEdit(r)} onDelete={() => handleDelete(r)} canManage={canManage} />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </TabShell>
      <AnimatePresence>
        {open && (
          <Modal title={editId ? 'Edit Skill' : 'Add Skill'} onClose={() => setOpen(false)} onSave={handleSave} saving={saving}>
            {!editId && (
              <div className="md:col-span-2">
                <FL>Employee</FL>
                <Combobox options={empOpts} value={form.employee_id} onChange={v => setForm(f => ({ ...f, employee_id: v }))} placeholder="Select employee..." />
              </div>
            )}
            <div className="md:col-span-2">
              <FL>Skill</FL>
              <Combobox options={skillOpts} value={form.skill_id} onChange={v => setForm(f => ({ ...f, skill_id: v }))} placeholder="Select skill..." />
            </div>
            <div className="md:col-span-2">
              <FL>Details</FL>
              <CountedTextarea value={form.details} onChange={e => setForm(f => ({ ...f, details: e.target.value }))} rows={3} maxChars={500} placeholder="Add details..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-[var(--surface)] focus:outline-none focus:border-[var(--accent)] font-medium resize-none" />
            </div>
          </Modal>
        )}
      </AnimatePresence>
      {deleteDialog}
    </>
  );
}

// ── 2. Certifications ─────────────────────────────────────────────────────────
const CERT_BLANK = { employee_id: '', certification_id: '', institute_id: '', date_start: '', date_end: '' };

function CertificationsTab({ employees, canManage = true }: { employees: any[]; canManage?: boolean }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm]     = useState({ ...CERT_BLANK });

  const certOpts = useClv('CERT');
  const instOpts = useClv('INST');
  const empOpts  = useMemo(() => toEmpOpts(employees), [employees]);
  const { ask: askDelete, dialog: deleteDialog } = useDeleteConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/certifications'); setRows(r.data.data ?? []); }
    catch { toast.error('Failed to load certifications'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? rows : rows.filter(r =>
      r.employee?.name?.toLowerCase().includes(q) ||
      r.certification?.label?.toLowerCase().includes(q) ||
      r.institute?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const toDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    try { return new Date(iso).toISOString().split('T')[0]; } catch { return ''; }
  };

  const openAdd  = () => { setEditId(null); setForm({ ...CERT_BLANK }); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ employee_id: r.employee?.id ?? '', certification_id: r.certification_id ?? '', institute_id: r.institute ?? '', date_start: toDate(r.date_start), date_end: toDate(r.date_end) }); setOpen(true); };

  const handleSave = async () => {
    if (!editId && !form.employee_id) return toast.error('Employee is required');
    if (!form.certification_id)       return toast.error('Certification is required');
    setSaving(true);
    try {
      const payload = { certification_id: form.certification_id, institute: form.institute_id, date_start: form.date_start, date_end: form.date_end };
      if (editId) {
        await api.put(`/certifications/${editId}`, payload);
        toast.success('Certification updated');
      } else {
        await api.post('/certifications', { ...payload, employee_id: form.employee_id });
        toast.success('Certification added');
      }
      setOpen(false);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save certification'); }
    finally { setSaving(false); }
  };

  const handleDelete = (row: any) => {
    askDelete(
      'Remove Certification',
      `Remove "${row.certification?.label ?? 'this certification'}" for ${row.employee?.name ?? 'this employee'}? This cannot be undone.`,
      async () => {
        try { await api.delete(`/certifications/${row.id}`); toast.success('Certification removed'); setRows(r => r.filter(x => x.id !== row.id)); }
        catch { toast.error('Failed to remove certification'); }
      }
    );
  };

  return (
    <>
      <TabShell label="Certification" onAdd={openAdd} canManage={canManage} search={search} onSearch={setSearch} loading={loading} isEmpty={filtered.length === 0}>
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="th">Employee</th><th className="th">Certification</th>
            <th className="th">Institute</th><th className="th">Granted</th><th className="th">Valid Thru</th>
            <th className="th text-right"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <motion.tr key={r.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                <EmpCell emp={r.employee} />
                <td className="td text-[13px]">{r.certification?.label ?? '—'}</td>
                <td className="td text-[13px]">{instOpts.find(o => o.id === r.institute)?.label ?? r.institute ?? '—'}</td>
                <td className="td text-[13px]">{fmtDate(r.date_start)}</td>
                <td className="td text-[13px]">{fmtDate(r.date_end)}</td>
                <RowActions onEdit={() => openEdit(r)} onDelete={() => handleDelete(r)} canManage={canManage} />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </TabShell>
      <AnimatePresence>
        {open && (
          <Modal title={editId ? 'Edit Certification' : 'Add Certification'} onClose={() => setOpen(false)} onSave={handleSave} saving={saving}>
            {!editId && (
              <div className="md:col-span-2">
                <FL>Employee</FL>
                <Combobox options={empOpts} value={form.employee_id} onChange={v => setForm(f => ({ ...f, employee_id: v }))} placeholder="Select employee..." />
              </div>
            )}
            <div className="md:col-span-2">
              <FL>Certification</FL>
              <Combobox options={certOpts} value={form.certification_id} onChange={v => setForm(f => ({ ...f, certification_id: v }))} placeholder="Select certification..." />
            </div>
            <div className="md:col-span-2">
              <FL>Institute</FL>
              <Combobox options={instOpts} value={form.institute_id} onChange={v => setForm(f => ({ ...f, institute_id: v }))} placeholder="Select institute..." />
            </div>
            <div>
              <FL>Granted On</FL>
              <input type="date" value={form.date_start} onChange={e => setForm(f => ({ ...f, date_start: e.target.value }))} className={inputCls()} />
            </div>
            <div>
              <FL>Valid Thru</FL>
              <input type="date" value={form.date_end} onChange={e => setForm(f => ({ ...f, date_end: e.target.value }))} className={inputCls()} />
            </div>
          </Modal>
        )}
      </AnimatePresence>
      {deleteDialog}
    </>
  );
}

// ── 3. Education ──────────────────────────────────────────────────────────────
const EDU_BLANK = { employee_id: '', education_id: '', institute: '', date_start: '', date_end: '' };

function EducationTab({ employees, canManage = true }: { employees: any[]; canManage?: boolean }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm]     = useState({ ...EDU_BLANK });

  const instOpts = useClv('INST');
  const empOpts  = useMemo(() => toEmpOpts(employees), [employees]);
  const { ask: askDelete, dialog: deleteDialog } = useDeleteConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/education'); setRows(r.data.data ?? []); }
    catch { toast.error('Failed to load education records'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? rows : rows.filter(r =>
      r.employee?.name?.toLowerCase().includes(q) ||
      r.institutionType?.label?.toLowerCase().includes(q) ||
      r.institute?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const toDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    try { return new Date(iso).toISOString().split('T')[0]; } catch { return ''; }
  };

  const openAdd  = () => { setEditId(null); setForm({ ...EDU_BLANK }); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ employee_id: r.employee?.id ?? '', education_id: r.education_id ?? '', institute: r.institute ?? '', date_start: toDate(r.date_start), date_end: toDate(r.date_end) }); setOpen(true); };

  const handleSave = async () => {
    if (!editId && !form.employee_id) return toast.error('Employee is required');
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/education/${editId}`, { education_id: form.education_id, institute: form.institute, date_start: form.date_start, date_end: form.date_end });
        toast.success('Education record updated');
      } else {
        await api.post('/education', form);
        toast.success('Education record added');
      }
      setOpen(false);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save education record'); }
    finally { setSaving(false); }
  };

  const handleDelete = (row: any) => {
    askDelete(
      'Remove Education Record',
      `Remove the ${row.institutionType?.label ?? 'education'} record for ${row.employee?.name ?? 'this employee'}? This cannot be undone.`,
      async () => {
        try { await api.delete(`/education/${row.id}`); toast.success('Education record removed'); setRows(r => r.filter(x => x.id !== row.id)); }
        catch { toast.error('Failed to remove education record'); }
      }
    );
  };

  return (
    <>
      <TabShell label="Education" onAdd={openAdd} canManage={canManage} search={search} onSearch={setSearch} loading={loading} isEmpty={filtered.length === 0}>
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="th">Employee</th><th className="th">Institution Type</th>
            <th className="th">Institute / School</th><th className="th">Start</th><th className="th">Completed</th>
            <th className="th text-right"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <motion.tr key={r.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                <EmpCell emp={r.employee} />
                <td className="td text-[13px]">{r.institutionType?.label ?? '—'}</td>
                <td className="td text-[13px]">{r.institute ?? '—'}</td>
                <td className="td text-[13px]">{fmtDate(r.date_start)}</td>
                <td className="td text-[13px]">{fmtDate(r.date_end)}</td>
                <RowActions onEdit={() => openEdit(r)} onDelete={() => handleDelete(r)} canManage={canManage} />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </TabShell>
      <AnimatePresence>
        {open && (
          <Modal title={editId ? 'Edit Education Record' : 'Add Education Record'} onClose={() => setOpen(false)} onSave={handleSave} saving={saving}>
            {!editId && (
              <div className="md:col-span-2">
                <FL>Employee</FL>
                <Combobox options={empOpts} value={form.employee_id} onChange={v => setForm(f => ({ ...f, employee_id: v }))} placeholder="Select employee..." />
              </div>
            )}
            <div className="md:col-span-2">
              <FL>Institution Type</FL>
              <Combobox options={instOpts} value={form.education_id} onChange={v => setForm(f => ({ ...f, education_id: v }))} placeholder="Select institution type..." />
            </div>
            <div className="md:col-span-2">
              <FL>Institute / School Name</FL>
              <input value={form.institute} onChange={e => setForm(f => ({ ...f, institute: e.target.value }))} placeholder="Enter institute name..." className={inputCls()} />
            </div>
            <div>
              <FL>Start Date</FL>
              <input type="date" value={form.date_start} onChange={e => setForm(f => ({ ...f, date_start: e.target.value }))} className={inputCls()} />
            </div>
            <div>
              <FL>Completed On</FL>
              <input type="date" value={form.date_end} onChange={e => setForm(f => ({ ...f, date_end: e.target.value }))} className={inputCls()} />
            </div>
          </Modal>
        )}
      </AnimatePresence>
      {deleteDialog}
    </>
  );
}

// ── 4. Languages ──────────────────────────────────────────────────────────────
const LANG_BLANK = { employee_id: '', language_id: '', reading: '', speaking: '', writing: '', understanding: '' };

function LanguagesTab({ employees, canManage = true }: { employees: any[]; canManage?: boolean }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm]     = useState({ ...LANG_BLANK });

  const langOpts = useClv('LANG');
  const empOpts  = useMemo(() => toEmpOpts(employees), [employees]);
  const { ask: askDelete, dialog: deleteDialog } = useDeleteConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/languages'); setRows(r.data.data ?? []); }
    catch { toast.error('Failed to load languages'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? rows : rows.filter(r =>
      r.employee?.name?.toLowerCase().includes(q) ||
      r.language?.label?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const openAdd  = () => { setEditId(null); setForm({ ...LANG_BLANK }); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ employee_id: r.employee?.id ?? '', language_id: r.language_id ?? '', reading: r.reading ?? '', speaking: r.speaking ?? '', writing: r.writing ?? '', understanding: r.understanding ?? '' }); setOpen(true); };

  const handleSave = async () => {
    if (!editId && !form.employee_id) return toast.error('Employee is required');
    if (!form.language_id)            return toast.error('Language is required');
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/languages/${editId}`, { language_id: form.language_id, reading: form.reading, speaking: form.speaking, writing: form.writing, understanding: form.understanding });
        toast.success('Language updated');
      } else {
        await api.post('/languages', form);
        toast.success('Language added');
      }
      setOpen(false);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save language'); }
    finally { setSaving(false); }
  };

  const handleDelete = (row: any) => {
    askDelete(
      'Remove Language',
      `Remove "${row.language?.label ?? 'this language'}" for ${row.employee?.name ?? 'this employee'}? This cannot be undone.`,
      async () => {
        try { await api.delete(`/languages/${row.id}`); toast.success('Language removed'); setRows(r => r.filter(x => x.id !== row.id)); }
        catch { toast.error('Failed to remove language'); }
      }
    );
  };

  return (
    <>
      <TabShell label="Language" onAdd={openAdd} canManage={canManage} search={search} onSearch={setSearch} loading={loading} isEmpty={filtered.length === 0}>
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="th">Employee</th><th className="th">Language</th>
            <th className="th">Reading</th><th className="th">Speaking</th>
            <th className="th">Writing</th><th className="th">Understanding</th>
            <th className="th text-right"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <motion.tr key={r.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                <EmpCell emp={r.employee} />
                <td className="td text-[13px]">{r.language?.label ?? '—'}</td>
                <td className="td text-[13px]">{profLabel(r.reading)}</td>
                <td className="td text-[13px]">{profLabel(r.speaking)}</td>
                <td className="td text-[13px]">{profLabel(r.writing)}</td>
                <td className="td text-[13px]">{profLabel(r.understanding)}</td>
                <RowActions onEdit={() => openEdit(r)} onDelete={() => handleDelete(r)} canManage={canManage} />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </TabShell>
      <AnimatePresence>
        {open && (
          <Modal title={editId ? 'Edit Language' : 'Add Language'} onClose={() => setOpen(false)} onSave={handleSave} saving={saving}>
            {!editId && (
              <div className="md:col-span-2">
                <FL>Employee</FL>
                <Combobox options={empOpts} value={form.employee_id} onChange={v => setForm(f => ({ ...f, employee_id: v }))} placeholder="Select employee..." />
              </div>
            )}
            <div className="md:col-span-2">
              <FL>Language</FL>
              <Combobox options={langOpts} value={form.language_id} onChange={v => setForm(f => ({ ...f, language_id: v }))} placeholder="Select language..." />
            </div>
            {(['reading', 'speaking', 'writing', 'understanding'] as const).map(field => (
              <div key={field}>
                <FL>{field.charAt(0).toUpperCase() + field.slice(1)}</FL>
                <Combobox options={PROFICIENCY} value={form[field]} onChange={v => setForm(f => ({ ...f, [field]: v }))} placeholder="Select level..." />
              </div>
            ))}
          </Modal>
        )}
      </AnimatePresence>
      {deleteDialog}
    </>
  );
}

// ── 5. Dependents ─────────────────────────────────────────────────────────────
const DEP_BLANK = { employee_id: '', name: '', gender: '', relationship: '', dob: '', place_of_birth: '', id_number: '' };

function DependentsTab({ employees, canManage = true }: { employees: any[]; canManage?: boolean }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm]     = useState({ ...DEP_BLANK });

  const genderOpts = useClv('GEN');
  const relOpts    = useClv('REL');
  const empOpts    = useMemo(() => toEmpOpts(employees), [employees]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/dependents'); setRows(r.data.data ?? []); }
    catch { toast.error('Failed to load dependents'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? rows : rows.filter(r =>
      r.employee?.name?.toLowerCase().includes(q) ||
      r.name?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const toDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    try { return new Date(iso).toISOString().split('T')[0]; } catch { return ''; }
  };

  const getLabel = (opts: Option[], id: string | null | undefined) =>
    opts.find(o => o.id === id)?.label ?? id ?? '—';

  const openAdd  = () => { setEditId(null); setForm({ ...DEP_BLANK }); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ employee_id: r.employee?.id ?? '', name: r.name ?? '', gender: r.gender ?? '', relationship: r.relationship ?? '', dob: toDate(r.dob), place_of_birth: r.place_of_birth ?? '', id_number: r.id_number ?? '' }); setOpen(true); };

  const handleSave = async () => {
    if (!editId && !form.employee_id) return toast.error('Employee is required');
    if (!form.name?.trim())           return toast.error('Name is required');
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/dependents/${editId}`, { name: form.name, gender: form.gender, relationship: form.relationship, dob: form.dob, place_of_birth: form.place_of_birth, id_number: form.id_number });
        toast.success('Dependent updated');
      } else {
        await api.post('/dependents', form);
        toast.success('Dependent added');
      }
      setOpen(false);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save dependent'); }
    finally { setSaving(false); }
  };

  const { ask: askDelete, dialog: deleteDialog } = useDeleteConfirm();

  const handleDelete = (row: any) => {
    askDelete(
      'Remove Dependent',
      `Remove "${row.name ?? 'this dependent'}" for ${row.employee?.name ?? 'this employee'}? This cannot be undone.`,
      async () => {
        try { await api.delete(`/dependents/${row.id}`); toast.success('Dependent removed'); setRows(r => r.filter(x => x.id !== row.id)); }
        catch { toast.error('Failed to remove dependent'); }
      }
    );
  };

  return (
    <>
      <TabShell label="Dependent" onAdd={openAdd} canManage={canManage} search={search} onSearch={setSearch} loading={loading} isEmpty={filtered.length === 0}>
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="th">Employee</th><th className="th">Name</th><th className="th">Gender</th>
            <th className="th">Relationship</th><th className="th">Date of Birth</th><th className="th">Place of Birth</th>
            <th className="th text-right"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <motion.tr key={r.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                <EmpCell emp={r.employee} />
                <td className="td text-[13px] font-medium">{r.name ?? '—'}</td>
                <td className="td text-[13px]">{getLabel(genderOpts, r.gender)}</td>
                <td className="td text-[13px]">{getLabel(relOpts, r.relationship)}</td>
                <td className="td text-[13px]">{fmtDate(r.dob)}</td>
                <td className="td text-[13px]">{r.place_of_birth ?? '—'}</td>
                <RowActions onEdit={() => openEdit(r)} onDelete={() => handleDelete(r)} canManage={canManage} />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </TabShell>
      <AnimatePresence>
        {open && (
          <Modal title={editId ? 'Edit Dependent' : 'Add Dependent'} onClose={() => setOpen(false)} onSave={handleSave} saving={saving}>
            {!editId && (
              <div className="md:col-span-2">
                <FL>Employee</FL>
                <Combobox options={empOpts} value={form.employee_id} onChange={v => setForm(f => ({ ...f, employee_id: v }))} placeholder="Select employee..." />
              </div>
            )}
            <div className="md:col-span-2">
              <FL>Full Name</FL>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Dependent's full name..." className={inputCls()} />
            </div>
            <div>
              <FL>Gender</FL>
              <Combobox options={genderOpts} value={form.gender} onChange={v => setForm(f => ({ ...f, gender: v }))} placeholder="Select gender..." />
            </div>
            <div>
              <FL>Relationship</FL>
              <Combobox options={relOpts} value={form.relationship} onChange={v => setForm(f => ({ ...f, relationship: v }))} placeholder="Select relationship..." />
            </div>
            <div>
              <FL>Date of Birth</FL>
              <input type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} className={inputCls()} />
            </div>
            <div>
              <FL>Place of Birth</FL>
              <input value={form.place_of_birth} onChange={e => setForm(f => ({ ...f, place_of_birth: e.target.value }))} placeholder="City, country..." className={inputCls()} />
            </div>
            <div className="md:col-span-2">
              <FL>ID Number</FL>
              <input value={form.id_number} onChange={e => setForm(f => ({ ...f, id_number: e.target.value }))} placeholder="National ID or Passport number..." className={inputCls()} />
            </div>
          </Modal>
        )}
      </AnimatePresence>
      {deleteDialog}
    </>
  );
}

// ── 6. Emergency Contacts ─────────────────────────────────────────────────────
const EC_BLANK = { employee_id: '', name: '', relationship: '', home_phone: '', work_phone: '', mobile_phone: '' };

function EmergencyContactsTab({ employees, canManage = true }: { employees: any[]; canManage?: boolean }) {
  const [rows, setRows]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm]     = useState({ ...EC_BLANK });

  const relOpts = useClv('REL');
  const empOpts = useMemo(() => toEmpOpts(employees), [employees]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/emergency-contacts'); setRows(r.data.data ?? []); }
    catch { toast.error('Failed to load emergency contacts'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return !q ? rows : rows.filter(r =>
      r.employee?.name?.toLowerCase().includes(q) ||
      r.name?.toLowerCase().includes(q) ||
      r.relationshipLabel?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const openAdd  = () => { setEditId(null); setForm({ ...EC_BLANK }); setOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setForm({ employee_id: r.employee?.id ?? '', name: r.name ?? '', relationship: r.relationship ?? '', home_phone: r.home_phone ?? '', work_phone: r.work_phone ?? '', mobile_phone: r.mobile_phone ?? '' }); setOpen(true); };

  const handleSave = async () => {
    if (!editId && !form.employee_id) return toast.error('Employee is required');
    if (!form.name?.trim())           return toast.error('Name is required');
    setSaving(true);
    try {
      if (editId) {
        await api.put(`/emergency-contacts/${editId}`, { name: form.name, relationship: form.relationship, home_phone: form.home_phone, work_phone: form.work_phone, mobile_phone: form.mobile_phone });
        toast.success('Emergency contact updated');
      } else {
        await api.post('/emergency-contacts', form);
        toast.success('Emergency contact added');
      }
      setOpen(false);
      await load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save emergency contact'); }
    finally { setSaving(false); }
  };

  const { ask: askDelete, dialog: deleteDialog } = useDeleteConfirm();

  const handleDelete = (row: any) => {
    askDelete(
      'Remove Emergency Contact',
      `Remove "${row.name ?? 'this contact'}" for ${row.employee?.name ?? 'this employee'}? This cannot be undone.`,
      async () => {
        try { await api.delete(`/emergency-contacts/${row.id}`); toast.success('Emergency contact removed'); setRows(r => r.filter(x => x.id !== row.id)); }
        catch { toast.error('Failed to remove emergency contact'); }
      }
    );
  };

  return (
    <>
      <TabShell label="Emergency Contact" onAdd={openAdd} canManage={canManage} search={search} onSearch={setSearch} loading={loading} isEmpty={filtered.length === 0}>
        <table className="w-full border-collapse">
          <thead><tr>
            <th className="th">Employee</th><th className="th">Contact Name</th><th className="th">Relationship</th>
            <th className="th">Home Phone</th><th className="th">Work Phone</th><th className="th">Mobile</th>
            <th className="th text-right"><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => (
              <motion.tr key={r.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                <EmpCell emp={r.employee} />
                <td className="td text-[13px] font-medium">{r.name ?? '—'}</td>
                <td className="td text-[13px]">{r.relationshipLabel ?? r.relationship ?? '—'}</td>
                <td className="td text-[13px]">{r.home_phone ?? '—'}</td>
                <td className="td text-[13px]">{r.work_phone ?? '—'}</td>
                <td className="td text-[13px]">{r.mobile_phone ?? '—'}</td>
                <RowActions onEdit={() => openEdit(r)} onDelete={() => handleDelete(r)} canManage={canManage} />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </TabShell>
      <AnimatePresence>
        {open && (
          <Modal title={editId ? 'Edit Emergency Contact' : 'Add Emergency Contact'} onClose={() => setOpen(false)} onSave={handleSave} saving={saving}>
            {!editId && (
              <div className="md:col-span-2">
                <FL>Employee</FL>
                <Combobox options={empOpts} value={form.employee_id} onChange={v => setForm(f => ({ ...f, employee_id: v }))} placeholder="Select employee..." />
              </div>
            )}
            <div className="md:col-span-2">
              <FL>Contact Name</FL>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name..." className={inputCls()} />
            </div>
            <div className="md:col-span-2">
              <FL>Relationship</FL>
              <Combobox options={relOpts} value={form.relationship} onChange={v => setForm(f => ({ ...f, relationship: v }))} placeholder="Select relationship..." />
            </div>
            <div>
              <FL>Home Phone</FL>
              <input type="tel" value={form.home_phone} onChange={e => setForm(f => ({ ...f, home_phone: e.target.value }))} placeholder="+1 555 000 0000" className={inputCls()} />
            </div>
            <div>
              <FL>Work Phone</FL>
              <input type="tel" value={form.work_phone} onChange={e => setForm(f => ({ ...f, work_phone: e.target.value }))} placeholder="+1 555 000 0000" className={inputCls()} />
            </div>
            <div className="md:col-span-2">
              <FL>Mobile Phone</FL>
              <input type="tel" value={form.mobile_phone} onChange={e => setForm(f => ({ ...f, mobile_phone: e.target.value }))} placeholder="+1 555 000 0000" className={inputCls()} />
            </div>
          </Modal>
        )}
      </AnimatePresence>
      {deleteDialog}
    </>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export function RelationalTab({ activeTab, mockEmployees }: { activeTab: string; mockEmployees: any[] }) {
  const { can } = useCan();
  if (activeTab === 'Skills')             return <SkillsTab employees={mockEmployees} canManage={can('manage_skills')} />;
  if (activeTab === 'Certifications')     return <CertificationsTab employees={mockEmployees} canManage={can('manage_certifications')} />;
  if (activeTab === 'Education')          return <EducationTab employees={mockEmployees} canManage={can('manage_education')} />;
  if (activeTab === 'Languages')          return <LanguagesTab employees={mockEmployees} canManage={can('manage_languages')} />;
  if (activeTab === 'Dependents')         return <DependentsTab employees={mockEmployees} canManage={can('manage_dependents')} />;
  if (activeTab === 'Emergency Contacts') return <EmergencyContactsTab employees={mockEmployees} canManage={can('manage_emergency_contacts')} />;
  return null;
}
