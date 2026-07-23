import { useState, useMemo, useEffect, useCallback } from 'react';
import { FileEdit, Ban, RotateCcw, Plus, UserCheck, UserX, Briefcase } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { RowActions } from './ui/RowActions';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { SearchSelect } from './ui/SearchSelect';
import api from '../../lib/api';
import { useCan } from '@/hooks/useCan';

interface PcCode {
  id: string;
  code: string;
  name: string;
  reportsToId: string | null;
  reportsToName: string | null;
  currentEmployee: string | null;
  currentEmployeeId: string | null;
  isActive: boolean;
}

export function PcCodes() {
  const { can } = useCan();
  const [codes, setCodes] = useState<PcCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // create/edit
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selected, setSelected] = useState<PcCode | null>(null);
  const [formName, setFormName] = useState('');
  const [formParent, setFormParent] = useState('');

  // assign
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<PcCode | null>(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState('');
  const [employees, setEmployees] = useState<{ id: string; label: string }[]>([]);

  const fetchCodes = useCallback(async () => {
    try {
      const res = await api.get('/pc-codes');
      setCodes(res.data.data ?? []);
    } catch {
      toast.error('Failed to load PC codes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);
  useEffect(() => { setPage(1); }, [searchQuery, codes]);

  // Load active employees for the Assign picker (lazy — only when first opened).
  const loadEmployees = useCallback(async () => {
    if (employees.length > 0) return;
    try {
      const res = await api.get('/employees/active');
      const list = (res.data.data ?? []).map((e: any) => {
        const name = (e.name ?? `${e.firstName ?? ''} ${e.lastName ?? ''}`).trim();
        return {
          id: String(e.id),
          label: (name || 'Employee') + (e.employee_id ? ` (${e.employee_id})` : ''),
        };
      });
      setEmployees(list);
    } catch {
      toast.error('Failed to load employees');
    }
  }, [employees.length]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return codes.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.currentEmployee ?? '').toLowerCase().includes(q)
    );
  }, [codes, searchQuery]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // Parent options = all codes except the one being edited (a code can't parent itself).
  const parentOptions = useMemo(
    () => [
      { id: '', label: 'Top level (under root)' },
      ...codes
        .filter(c => (!selected || c.id !== selected.id) && c.code !== '000000000000')
        .map(c => ({ id: c.id, label: `${c.code} — ${c.name}` })),
    ],
    [codes, selected]
  );

  const openCreate = () => {
    setSelected(null);
    setFormName('');
    setFormParent('');
    setIsFormOpen(true);
  };

  const openEdit = (row: PcCode) => {
    setSelected(row);
    setFormName(row.name);
    setFormParent(row.reportsToId ?? '');
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) { toast.error('Name is required'); return; }
    try {
      if (selected) {
        // v1: rename only (reparenting deferred — code is fixed once generated).
        await api.put(`/pc-codes/${selected.id}`, { name: formName.trim() });
        toast.success('PC code updated');
      } else {
        await api.post('/pc-codes', { name: formName.trim(), reportsToId: formParent || null });
        toast.success('PC code created');
      }
      await fetchCodes();
      setIsFormOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save PC code');
    }
  };

  const handleToggleActive = async (row: PcCode) => {
    const next = !row.isActive;
    try {
      await api.put(`/pc-codes/${row.id}/active`, { isActive: next });
      toast.success(next ? 'PC code reactivated' : 'PC code deactivated');
      await fetchCodes();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update PC code');
    }
  };

  const openAssign = (row: PcCode) => {
    setAssignTarget(row);
    setAssignEmployeeId('');
    setAssignOpen(true);
    loadEmployees();
  };

  const handleAssign = async () => {
    if (!assignTarget || !assignEmployeeId) { toast.error('Select an employee'); return; }
    try {
      await api.post(`/pc-codes/${assignTarget.id}/assign`, { employeeId: assignEmployeeId });
      toast.success('Employee assigned');
      await fetchCodes();
      setAssignOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to assign');
    }
  };

  const handleVacate = async (row: PcCode) => {
    try {
      await api.post(`/pc-codes/${row.id}/vacate`, {});
      toast.success('PC code vacated');
      await fetchCodes();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to vacate');
    }
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col">
      <div className="w-full px-3 sm:px-6 md:px-8 py-6 sm:py-8 flex-1 flex flex-col">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 sm:mb-7">
          <PageHeader title="PC Codes" subtitle="Performance codes — the positions/seats in the institution and who currently holds each." />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 drop-shadow-sm"
        >
          <TableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search code, name or holder…"
            actions={
              can('create_pc_code') ? (
                <button onClick={openCreate} className="primary-btn shrink-0">
                  <span className="hidden sm:inline">New PC Code</span>
                  <span className="sm:hidden">New</span>
                  <Plus className="w-[14px] h-[14px]" />
                </button>
              ) : undefined
            }
          />

          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Code</th>
                  <th className="th">Name</th>
                  <th className="th">Reports To</th>
                  <th className="th">Current Holder</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="td text-center text-[var(--text-muted)] py-10" colSpan={5}>Loading…</td></tr>
                ) : paged.length === 0 ? (
                  <tr><td className="td text-center text-[var(--text-muted)] py-10" colSpan={5}>No PC codes found.</td></tr>
                ) : paged.map(row => {
                  const isRoot = row.code === '000000000000';
                  return (
                  <tr key={row.id} className="tr">
                    <td className="td font-mono font-semibold">{row.code}</td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5">
                        <Briefcase size={13} className="text-[var(--text-muted)]" /> {isRoot ? 'Top Seat (MD / root)' : row.name}
                      </span>
                    </td>
                    <td className="td text-[var(--text-muted)]">{isRoot ? '—' : (row.reportsToName ?? '—')}</td>
                    <td className="td">
                      {row.isActive === false
                        ? <span className="pill">Inactive</span>
                        : row.currentEmployee
                          ? <span className="pill pill-success">{row.currentEmployee}</span>
                          : <span className="pill">Vacant</span>}
                    </td>
                    <td className="td">
                      <RowActions actions={[
                        { label: isRoot ? 'Assign top seat' : 'Assign / Move', icon: UserCheck, onClick: () => openAssign(row), hidden: !can('assign_pc_code') || row.isActive === false },
                        { label: 'Vacate', icon: UserX, onClick: () => handleVacate(row), hidden: !can('assign_pc_code') || !row.currentEmployee },
                        { label: 'Edit', icon: FileEdit, onClick: () => openEdit(row), hidden: !can('edit_pc_code') || isRoot },
                        { label: 'Deactivate', icon: Ban, danger: true, onClick: () => handleToggleActive(row), hidden: !can('delete_pc_code') || isRoot || row.isActive === false },
                        { label: 'Reactivate', icon: RotateCcw, onClick: () => handleToggleActive(row), hidden: !can('delete_pc_code') || row.isActive !== false },
                      ]} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={codes.length}
            filtered={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </motion.div>
      </div>

      {/* Create / Edit */}
      {isFormOpen && (
        <FormModal
          title={selected ? 'Edit PC Code' : 'New PC Code'}
          subtitle={selected ? `Code ${selected.code} (auto-generated, fixed)` : 'The 6-digit code is generated from the parent.'}
          onClose={() => setIsFormOpen(false)}
          onSave={handleSave}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <FormField label="Position Name" required>
              <input className={inputClass} value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Branch Manager — Kissy" />
            </FormField>
            <FormField label="Reports To" hint={selected ? 'Reparenting is not available in this version.' : 'Parent position — the code is generated under it.'}>
              <SearchSelect
                value={formParent}
                onChange={setFormParent}
                options={parentOptions}
                placeholder="Root (000000)"
                disabled={!!selected}
              />
            </FormField>
            {selected && (
              <FormField label="Code">
                <input className={inputClass} value={selected.code} disabled />
              </FormField>
            )}
          </div>
        </FormModal>
      )}

      {/* Assign / Move */}
      {assignOpen && assignTarget && (
        <FormModal
          title="Assign / Move Staff"
          subtitle={`${assignTarget.code} — ${assignTarget.name}`}
          onClose={() => setAssignOpen(false)}
          onSave={handleAssign}
          saveLabel="Assign"
          maxWidth="lg"
        >
          <FormField label="Employee" required hint="The employee's previous PC code (if any) is vacated automatically.">
            <SearchSelect
              value={assignEmployeeId}
              onChange={setAssignEmployeeId}
              options={employees}
              placeholder="Select employee…"
            />
          </FormField>
        </FormModal>
      )}
    </div>
  );
}
