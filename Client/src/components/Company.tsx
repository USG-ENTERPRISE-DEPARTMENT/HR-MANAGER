import { useState, useMemo, useEffect, useCallback } from 'react';
import { FileEdit, Trash2, Filter, Plus, Download, X, Building2, Network } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ConfirmAlert } from './ConfirmAlert';
import { CompanyStructureForm } from './CompanyStructureForm';
import { Organogram } from './Organogram';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FilterSelect } from './ui/FilterSelect';
import { RowActions } from './ui/RowActions';
import api from '../../lib/api';
import { useCan } from '@/hooks/useCan';

export function Company() {
  const { can } = useCan();
  const [activeTab, setActiveTab] = useState('Company Structure');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [structures, setStructures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [selectedStructure, setSelectedStructure] = useState<any>(null);

  const fetchStructures = useCallback(async () => {
    try {
      const res = await api.get('/company/structures');
      setStructures(res.data.data ?? []);
    } catch {
      toast.error('Failed to load structures');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStructures(); }, [fetchStructures]);

  useEffect(() => { setPage(1); }, [searchQuery, typeFilter, structures]);

  const filtered = useMemo(
    () =>
      structures.filter((s) => {
        const q = searchQuery.toLowerCase();
        return (
          (s.title?.toLowerCase().includes(q) || s.comp_code?.toLowerCase().includes(q)) &&
          (!typeFilter || s.typeLabel === typeFilter)
        );
      }),
    [structures, searchQuery, typeFilter]
  );

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const typeOptions = useMemo(() => {
    const seen = new Set<string>();
    structures.forEach(s => { if (s.typeLabel) seen.add(s.typeLabel); });
    return Array.from(seen).sort();
  }, [structures]);

  // Adapt shape so Organogram's name/parent/manager/type fields work
  const organogramData = useMemo(() =>
    structures.map(s => ({
      ...s,
      name:    s.title,
      parent:  s.parentTitle ?? 'None',
      manager: s.managerName ?? null,
      type:    s.typeLabel,
    })),
    [structures]
  );

  const handleAddClick = () => {
    setSelectedStructure(null);
    setIsFormOpen(true);
  };

  const handleEditClick = (row: any) => {
    setSelectedStructure(row);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (row: any) => {
    setSelectedStructure(row);
    setIsAlertOpen(true);
  };

  const handleSave = async (formData: any, id?: string) => {
    try {
      if (id) {
        await api.put(`/company/structures/${id}`, formData);
        toast.success('Structure updated');
      } else {
        await api.post('/company/structures', formData);
        toast.success('Structure created');
      }
      await fetchStructures();
      setIsFormOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save structure');
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedStructure) return;
    try {
      await api.delete(`/company/structures/${selectedStructure.id}`);
      toast.success('Structure deleted');
      await fetchStructures();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to delete structure');
    } finally {
      setIsAlertOpen(false);
    }
  };

  const filterBar = (
    <>
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide syne">Type:</label>
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          options={[{ value: '', label: 'All Types' }, ...typeOptions.map(t => ({ value: t, label: t }))]}
          placeholder="All Types"
          minWidth={160}
        />
      </div>
      {typeFilter && (
        <button onClick={() => setTypeFilter('')} className="text-[12px] font-bold text-[var(--accent)] hover:text-blue-800 flex items-center gap-1">
          <X className="w-3 h-3" /> Clear Filters
        </button>
      )}
    </>
  );

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Organization Structure" subtitle="Manage your company hierarchy, departments, and units." />

      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4">
        <button onClick={() => setActiveTab('Company Structure')} className={`tab-btn flex items-center gap-2 ${activeTab === 'Company Structure' ? 'active' : ''}`}>
          <Building2 size={13} /> Company Structure
        </button>
        <button onClick={() => setActiveTab('Organogram')} className={`tab-btn flex items-center gap-2 ${activeTab === 'Organogram' ? 'active' : ''}`}>
          <Network size={13} /> Organogram
        </button>
      </div>

      {activeTab === 'Company Structure' ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col min-h-0">
          <TableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search structures..."
            showFilters={showFilters}
            filterBar={filterBar}
            actions={
              <>
                {can('create_company_structure') && (
                  <button onClick={handleAddClick} className="primary-btn shrink-0">
                    <span className="hidden sm:inline">Add New</span>
                    <span className="sm:hidden">Add</span>
                    <Plus className="w-[14px] h-[14px]" />
                  </button>
                )}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`secondary-btn shrink-0 ${showFilters ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
                >
                  Filter
                  <Filter className="w-[14px] h-[14px] fill-current opacity-80" />
                </button>
                <button className="secondary-btn shrink-0">
                  <span className="hidden sm:inline">Download (Excel)</span>
                  <span className="sm:hidden">Export</span>
                  <Download className="w-[14px] h-[14px]" />
                </button>
              </>
            }
          />

          <div className="overflow-y-auto overflow-x-hidden flex-1 min-h-0">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Code</th>
                  <th className="th">Type</th>
                  <th className="th">Parent</th>
                  <th className="th">Manager</th>
                  <th className="th">Address</th>
                  <th className="th text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="td text-center py-10 text-[var(--text-muted)]">Loading...</td>
                  </tr>
                ) : paged.length > 0 ? (
                  paged.map((row, i) => (
                    <motion.tr
                      key={row.id}
                      className="tr"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 + i * 0.04 }}
                    >
                      <td className="td font-medium text-[var(--text-primary)] whitespace-normal break-words min-w-[160px]">{row.title}</td>
                      <td className="td">{row.comp_code || '—'}</td>
                      <td className="td">{row.typeLabel || '—'}</td>
                      <td className="td whitespace-normal break-words">{row.parentTitle || '—'}</td>
                      <td className="td whitespace-normal break-words">{row.managerName || '—'}</td>
                      <td className="td whitespace-normal break-words min-w-[200px]">{row.address || '—'}</td>
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'Edit', icon: FileEdit, onClick: () => handleEditClick(row), hidden: !can('edit_company_structure') },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDeleteClick(row), hidden: !can('delete_company_structure') },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="td text-center py-10">No structures found matching your criteria.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <TablePagination
            total={structures.length}
            filtered={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
      ) : (
        <Organogram data={organogramData} />
      )}

      {isFormOpen && (
        <CompanyStructureForm
          onClose={() => setIsFormOpen(false)}
          initialData={selectedStructure}
          onSave={handleSave}
          currentStructures={structures}
        />
      )}

      <ConfirmAlert
        isOpen={isAlertOpen}
        title="Delete Structure"
        message={`Are you sure you want to delete "${selectedStructure?.title}"? This action cannot be undone.`}
        confirmText="Yes, Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsAlertOpen(false)}
        variant="danger"
      />
    </div>
  );
}
