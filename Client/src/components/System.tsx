import { useState, useMemo, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { codeLists, CodeList, CodeListValue } from '../../lib/codeLists';
import { TablePagination } from './ui/TablePagination';
import { SearchSelect } from './ui/SearchSelect';
import { RowActions } from './ui/RowActions';
import { Search, FileEdit, Trash2, Filter, Plus, Download, X, Building2, Tag, List, ChevronDown, RefreshCw, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ConfirmAlert } from './ConfirmAlert';
import { useCan } from '@/hooks/useCan';
import api from '../../lib/api';

const logoUrl = (name?: string) =>
  !name ? '' : name.startsWith('blob:') || name.startsWith('http') ? name : `${api.defaults.baseURL}/documents/${name}`;

/* ─────────────────────────────────────────────────────────────────────────────
   INITIAL DATA — App Setup (local only, no API yet)
───────────────────────────────────────────────────────────────────────────── */
const initialAppSetup = {
  id: 1,
  companyName: 'UNION SYSTEMS Global Solutions',
  logoName: 'usg_logo.png',
};

/* ─────────────────────────────────────────────────────────────────────────────
   SHARED MODAL
───────────────────────────────────────────────────────────────────────────── */
function Modal({ title, onClose, onSave, saveLabel = 'Save', saving = false, children }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[#111827]/45 backdrop-blur-[4px]"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] w-full max-w-[480px] relative z-10 shadow-[0_24px_80px_rgba(0,0,0,0.18)] max-h-[90vh] flex flex-col"
      >
        <div className="px-6 py-5 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="syne m-0 text-[16px] font-extrabold text-[var(--text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            className="bg-[var(--surface-hover)] border border-[var(--border)] rounded-lg w-[30px] h-[30px] flex items-center justify-center cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-[18px]">
          {children}
        </div>
        <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-2.5">
          <button className="secondary-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-btn" onClick={onSave} disabled={saving}>
            {saving ? 'Saving...' : saveLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export function System() {
  const { can } = useCan();
  const canManage = can('manage_app_settings');   // gates all App Settings actions
  /* ── Tab state ────────────────────────────────────────────────────────── */
  const [activeTab, setActiveTab]       = useState('App Setup');
  const tabs                            = ['App Setup', 'Parameter Creation'];

  /* ── Parameter sub-tab (dropdown) ────────────────────────────────────── */
  const [subTab, setSubTab]             = useState('Code Creation');
  const [isSubDropOpen, setIsSubDropOpen] = useState(false);
  const subTabs                         = ['Code Creation', 'Code Values'];

  /* ── Data ─────────────────────────────────────────────────────────────── */
  const [appSetup, setAppSetup]         = useState(initialAppSetup);
  const [codes, setCodes]               = useState<CodeList[]>([]);
  const [codeValues, setCodeValues]     = useState<CodeListValue[]>([]);
  const [loading, setLoading]           = useState(false);
  const [valuesLoaded, setValuesLoaded] = useState(false);

  /* ── Search / filter ─────────────────────────────────────────────────── */
  const [searchQuery, setSearchQuery]   = useState('');
  const [showFilters, setShowFilters]   = useState(false);
  const [codeFilter, setCodeFilter]     = useState('');

  /* ── Form / modal state ───────────────────────────────────────────────── */
  const [isFormOpen, setIsFormOpen]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [isAlertOpen, setIsAlertOpen]   = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  /* ── App Setup form state ─────────────────────────────────────────────── */
  const [setupForm, setSetupForm]       = useState({ companyName: '', logoName: '' });
  const [logoPreview, setLogoPreview]   = useState<string>('');   // object URL of the chosen logo file
  const [logoUploading, setLogoUploading] = useState(false);

  // Load persisted App Setup (company name + logo) so edits survive reloads.
  useEffect(() => {
    api.get('/settings/app-setup')
      .then(r => {
        const d = r.data?.data ?? {};
        setAppSetup(prev => ({
          ...prev,
          companyName: d.company_name || prev.companyName,
          logoName:    d.company_logo || '',
        }));
      })
      .catch(() => {});
  }, []);

  /* ── Code Creation form state ─────────────────────────────────────────── */
  const [codeForm, setCodeForm]         = useState({ name: '', code: '', description: '' });

  /* ── Code Values form state ───────────────────────────────────────────── */
  const [valForm, setValForm]           = useState({ codeListId: '', label: '', description: '' });

  /* ── Pagination ───────────────────────────────────────────────────────── */
  const [codesPage, setCodesPage]       = useState(1);
  const [codesPageSize, setCodesPageSize] = useState(10);
  const [valuesPage, setValuesPage]     = useState(1);
  const [valuesPageSize, setValuesPageSize] = useState(10);

  /* ─────────────────────────────────────────────────────────────────────────
     DATA FETCHING
  ───────────────────────────────────────────────────────────────────────── */
  const fetchCodes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await codeLists.getAll();
      setCodes(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load code lists');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllValues = useCallback(async (currentCodes: CodeList[]) => {
    if (currentCodes.length === 0) return;
    try {
      const results = await Promise.all(
        currentCodes.map((c) => codeLists.getById(c.id))
      );
      const all: CodeListValue[] = results.flatMap(
        (r) => r.data?.data?.values ?? []
      );
      setCodeValues(all);
      setValuesLoaded(true);
    } catch {
      toast.error('Failed to load code values');
    }
  }, []);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  useEffect(() => {
    if (activeTab === 'Parameter Creation' && subTab === 'Code Values' && !valuesLoaded && codes.length > 0) {
      fetchAllValues(codes);
    }
  }, [activeTab, subTab, valuesLoaded, codes, fetchAllValues]);

  /* ─────────────────────────────────────────────────────────────────────────
     DERIVED / FILTERED DATA
  ───────────────────────────────────────────────────────────────────────── */
  const codeMap = useMemo(
    () => Object.fromEntries(codes.map((c) => [c.id, c.code])),
    [codes]
  );

  const filteredCodes = useMemo(() =>
    codes.filter((c) =>
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.description ?? '').toLowerCase().includes(searchQuery.toLowerCase())
    ), [codes, searchQuery]);

  const filteredCodeValues = useMemo(() =>
    codeValues.filter((v) => {
      const matchesSearch =
        v.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (codeMap[v.codeListId] ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = codeFilter ? String(v.codeListId) === codeFilter : true;
      return matchesSearch && matchesFilter;
    }), [codeValues, searchQuery, codeFilter, codeMap]);

  // Reset pages when filters or tab changes
  useEffect(() => { setCodesPage(1); }, [searchQuery, codes]);
  useEffect(() => { setValuesPage(1); }, [searchQuery, codeFilter, codeValues]);

  const pagedCodes = useMemo(() => {
    const start = (codesPage - 1) * codesPageSize;
    return filteredCodes.slice(start, start + codesPageSize);
  }, [filteredCodes, codesPage, codesPageSize]);

  const pagedValues = useMemo(() => {
    const start = (valuesPage - 1) * valuesPageSize;
    return filteredCodeValues.slice(start, start + valuesPageSize);
  }, [filteredCodeValues, valuesPage, valuesPageSize]);

  /* ─────────────────────────────────────────────────────────────────────────
     HANDLERS — App Setup
  ───────────────────────────────────────────────────────────────────────── */
  const openEditSetup = () => {
    setSetupForm({ companyName: appSetup.companyName, logoName: appSetup.logoName });
    setLogoPreview(logoUrl(appSetup.logoName));   // show the saved logo when editing
    setIsFormOpen(true);
  };

  const uploadLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setLogoUploading(true);
    setLogoPreview(URL.createObjectURL(file));   // instant local preview
    try {
      const res = await api.post('/employees/documents/upload', fd, { headers: { 'Content-Type': undefined } });
      const filename = res.data?.data?.filename ?? res.data?.filename;
      if (filename) setSetupForm(f => ({ ...f, logoName: filename }));
      else toast.error('Upload succeeded but no file reference returned');
    } catch { toast.error('Logo upload failed'); }
    finally { setLogoUploading(false); }
  };

  const handleSaveSetup = async () => {
    try {
      await api.put('/settings/app-setup', { company_name: setupForm.companyName, company_logo: setupForm.logoName });
      setAppSetup((prev) => ({ ...prev, ...setupForm }));
      setIsFormOpen(false);
      toast.success('App setup updated');
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save app setup'); }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     HANDLERS — Code Creation
  ───────────────────────────────────────────────────────────────────────── */
  const handleAddCode = () => {
    setSelectedItem(null);
    setCodeForm({ name: '', code: '', description: '' });
    setIsFormOpen(true);
  };

  const handleEditCode = (item: CodeList) => {
    setSelectedItem(item);
    setCodeForm({ name: item.name, code: item.code, description: item.description ?? '' });
    setIsFormOpen(true);
  };

  const handleSaveCode = async () => {
    if (!codeForm.code.trim() || !codeForm.name.trim()) {
      toast.error('Name and Code are required');
      return;
    }
    setSaving(true);
    try {
      if (selectedItem) {
        const res = await codeLists.update(selectedItem.id, {
          name: codeForm.name,
          description: codeForm.description || undefined,
        });
        const updated = res.data?.data;
        if (updated) {
          setCodes((prev) => prev.map((c) => (c.id === selectedItem.id ? updated : c)));
        }
        toast.success('Code list updated');
      } else {
        const res = await codeLists.create({
          name: codeForm.name,
          code: codeForm.code,
          description: codeForm.description || undefined,
        });
        const created = res.data?.data;
        if (created) {
          setCodes((prev) => [...prev, created]);
        }
        toast.success('Code list created');
      }
      setIsFormOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to save code list';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     HANDLERS — Code Values
  ───────────────────────────────────────────────────────────────────────── */
  const handleAddValue = () => {
    setSelectedItem(null);
    setValForm({ codeListId: codes[0]?.id != null ? String(codes[0].id) : '', label: '', description: '' });
    setIsFormOpen(true);
  };

  const handleEditValue = (item: CodeListValue) => {
    setSelectedItem(item);
    setValForm({ codeListId: String(item.codeListId), label: item.label, description: item.description ?? '' });
    setIsFormOpen(true);
  };

  const handleToggleValueClick = (item: CodeListValue) => {
    setSelectedItem(item);
    setIsAlertOpen(true);
  };

  const handleSaveValue = async () => {
    if (!valForm.label.trim() || !valForm.codeListId) {
      toast.error('Code list and label are required');
      return;
    }
    setSaving(true);
    try {
      if (selectedItem) {
        const res = await codeLists.updateValue(
          selectedItem.codeListId,
          selectedItem.id,
          { label: valForm.label, description: valForm.description || undefined }
        );
        const updated = res.data?.data;
        if (updated) {
          setCodeValues((prev) => prev.map((v) => (v.id === selectedItem.id ? updated : v)));
        }
        toast.success('Value updated');
      } else {
        const parentCode = codes.find((c) => String(c.id) === valForm.codeListId);
        if (!parentCode) { toast.error('Code list not found'); setSaving(false); return; }
        const res = await codeLists.createValue(parentCode.code, {
          label: valForm.label,
          description: valForm.description || undefined,
        });
        const created = res.data?.data;
        if (created) {
          setCodeValues((prev) => [...prev, created]);
        }
        toast.success('Value added');
      }
      setIsFormOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to save value';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmToggleValue = async () => {
    if (!selectedItem) return;
    const deactivating = selectedItem.isActive;
    try {
      const res = deactivating
        ? await codeLists.deactivateValue(selectedItem.codeListId, selectedItem.id)
        : await codeLists.activateValue(selectedItem.codeListId, selectedItem.id);
      const updated = res.data?.data;
      // Keep the row visible and flip its status in place, so it can be toggled back.
      setCodeValues((prev) => prev.map((v) =>
        v.id === selectedItem.id ? { ...v, ...(updated ?? {}), isActive: !deactivating } : v
      ));
      toast.success(`"${selectedItem.label}" ${deactivating ? 'deactivated' : 'activated'}`);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? `Failed to ${deactivating ? 'deactivate' : 'activate'} value`;
      toast.error(msg);
    } finally {
      setIsAlertOpen(false);
      setSelectedItem(null);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     TAB SWITCH
  ───────────────────────────────────────────────────────────────────────── */
  const switchTab = (tab: string) => {
    setActiveTab(tab);
    setSearchQuery('');
    setCodeFilter('');
    setShowFilters(false);
    setIsFormOpen(false);
    setIsSubDropOpen(false);
  };

  const switchSubTab = (tab: string) => {
    setSubTab(tab);
    setSearchQuery('');
    setCodeFilter('');
    setShowFilters(false);
    setIsFormOpen(false);
    setIsSubDropOpen(false);
    if (tab === 'Code Values' && !valuesLoaded) {
      fetchAllValues(codes);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     DERIVED DISPLAY STATE
  ───────────────────────────────────────────────────────────────────────── */
  const currentSave = activeTab === 'App Setup'
    ? handleSaveSetup
    : subTab === 'Code Creation'
      ? handleSaveCode
      : handleSaveValue;

  const modalTitle = activeTab === 'App Setup'
    ? 'Edit App Setup'
    : subTab === 'Code Creation'
      ? (selectedItem ? 'Edit Code List' : 'Add Code List')
      : (selectedItem ? 'Edit Code Value' : 'Add Code Value');

  // The confirm alert is dual-purpose — it deactivates an active value or reactivates an inactive one,
  // driven by the selected row's current status.
  const isDeactivating = selectedItem?.isActive ?? true;
  const toggleTitle   = isDeactivating ? 'Deactivate Code Value' : 'Activate Code Value';
  const toggleMessage = isDeactivating
    ? 'This will deactivate the value. It will no longer appear in selection lists but existing records are preserved.'
    : 'This will reactivate the value so it appears in selection lists again.';

  const hasActiveFilter = codeFilter !== '';

  /* ─────────────────────────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">

      {/* Page header */}
      <div className="mb-6">
        <h2 className="text-lg sm:text-[22px] font-bold syne text-[var(--text-primary)] tracking-tight">
          System Administration
        </h2>
        <p className="text-xs sm:text-[13px] text-[var(--text-muted)] mt-1 font-medium">
          Configure application settings and manage parameter codes.
        </p>
      </div>

      {/* Top-level tabs */}
      <div className="flex flex-wrap items-center gap-2 mt-2 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={`tab-btn ${tab === activeTab ? 'active' : ''}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 min-h-0 drop-shadow-sm">

        {/* ── Toolbar area ─────────────────────────────────────────────────── */}
        <div className="flex flex-col border-b border-[var(--border)]">
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row lg:items-center justify-between gap-4">

            {/* Left side — action buttons */}
            <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">

              {activeTab === 'App Setup' && canManage && (
                <button onClick={openEditSetup} className="primary-btn shrink-0">
                  <FileEdit className="w-[14px] h-[14px]" />
                  <span className="hidden sm:inline">Edit Setup</span>
                  <span className="sm:hidden">Edit</span>
                </button>
              )}

              {activeTab === 'Parameter Creation' && (
                <>
                  {canManage && <button
                    onClick={subTab === 'Code Creation' ? handleAddCode : handleAddValue}
                    className="primary-btn shrink-0"
                  >
                    <span className="hidden sm:inline">Add New</span>
                    <span className="sm:hidden">Add</span>
                    <Plus className="w-[14px] h-[14px]" />
                  </button>}

                  {subTab === 'Code Values' && (
                    <button
                      onClick={() => setShowFilters(!showFilters)}
                      className={`secondary-btn shrink-0 ${showFilters ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
                    >
                      Filter
                      <Filter className="w-[14px] h-[14px] fill-current opacity-80" />
                    </button>
                  )}

                  <button className="secondary-btn shrink-0">
                    <span className="hidden sm:inline">Download (Excel)</span>
                    <span className="sm:hidden">Export</span>
                    <Download className="w-[14px] h-[14px]" />
                  </button>

                  {/* Refresh button */}
                  <button
                    onClick={() => {
                      setValuesLoaded(false);
                      fetchCodes().then(() => {
                        if (subTab === 'Code Values') setValuesLoaded(false);
                      });
                    }}
                    className="secondary-btn shrink-0"
                    title="Refresh"
                  >
                    <RefreshCw className="w-[14px] h-[14px]" />
                  </button>

                  {/* Sub-tab dropdown */}
                  <div className="relative sm:ml-2">
                    <button
                      onClick={() => setIsSubDropOpen(!isSubDropOpen)}
                      className="secondary-btn gap-2 shrink-0"
                    >
                      {subTab === 'Code Creation' ? <Tag size={13} /> : <List size={13} />}
                      <span className="hidden sm:inline">{subTab}</span>
                      <ChevronDown
                        size={13}
                        style={{
                          transition: 'transform .2s ease',
                          transform: isSubDropOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      />
                    </button>

                    <AnimatePresence>
                      {isSubDropOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.97 }}
                          transition={{ duration: 0.15 }}
                          className="absolute top-[calc(100%+6px)] left-0 bg-[var(--surface)] border border-[var(--border)] rounded-[12px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.16)] z-50 min-w-[180px]"
                        >
                          {subTabs.map((t) => (
                            <button
                              key={t}
                              onClick={() => switchSubTab(t)}
                              className="w-full text-left px-4 py-2.5 text-[13px] font-medium flex items-center gap-2.5 transition-colors hover:bg-[var(--surface-hover)]"
                              style={{
                                background: t === subTab ? 'var(--accent-dim)' : undefined,
                                color: t === subTab ? 'var(--accent)' : 'var(--text-secondary)',
                              }}
                            >
                              {t === 'Code Creation' ? <Tag size={13} /> : <List size={13} />}
                              {t}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>

            {/* Right side — search */}
            {activeTab === 'Parameter Creation' && (
              <div className="search-wrap w-full sm:w-auto sm:min-w-[240px]">
                <Search size={14} />
                <input
                  type="text"
                  placeholder={subTab === 'Code Creation' ? 'Search codes...' : 'Search values...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Filter panel — Code Values only */}
          {showFilters && activeTab === 'Parameter Creation' && subTab === 'Code Values' && (
            <div className="px-5 py-3 bg-[var(--surface-hover)] border-t border-[var(--border)] flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide syne">
                  Code:
                </label>
                <div className="w-[220px]">
                  <SearchSelect
                    value={codeFilter}
                    onChange={setCodeFilter}
                    options={codes.map((c) => ({ id: String(c.id), label: `${c.code} — ${c.name}` }))}
                    placeholder="All Codes"
                  />
                </div>
              </div>
              {hasActiveFilter && (
                <button
                  onClick={() => setCodeFilter('')}
                  className="text-[12px] font-bold text-[var(--accent)] hover:text-blue-800 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear Filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Table area ───────────────────────────────────────────────────── */}
        <div className="overflow-auto flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-sm">
              Loading...
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {activeTab === 'App Setup' && (
                    <>
                      <th scope="col" className="th">#</th>
                      <th scope="col" className="th">Company Name</th>
                      <th scope="col" className="th">Logo File</th>
                    </>
                  )}

                  {activeTab === 'Parameter Creation' && subTab === 'Code Creation' && (
                    <>
                      <th scope="col" className="th">#</th>
                      <th scope="col" className="th">Code</th>
                      <th scope="col" className="th">Name</th>
                      <th scope="col" className="th">Description</th>
                      <th scope="col" className="th text-center">Values</th>
                    </>
                  )}

                  {activeTab === 'Parameter Creation' && subTab === 'Code Values' && (
                    <>
                      <th scope="col" className="th">#</th>
                      <th scope="col" className="th">Code</th>
                      <th scope="col" className="th">Label</th>
                      <th scope="col" className="th">Description</th>
                      <th scope="col" className="th">Status</th>
                    </>
                  )}

                  <th scope="col" className="th text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* ── App Setup ─────────────────────────────────────────────── */}
                {activeTab === 'App Setup' && (
                  <motion.tr
                    className="tr"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    <td className="td text-[var(--text-muted)] text-[12px]">1</td>
                    <td className="td font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-[32px] h-[32px] rounded-[9px] bg-[var(--accent-dim)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0">
                          <Building2 size={15} strokeWidth={1.8} />
                        </div>
                        {appSetup.companyName}
                      </div>
                    </td>
                    <td className="td">
                      {appSetup.logoName ? (
                        <img src={logoUrl(appSetup.logoName)} alt="Company logo"
                          className="w-10 h-10 rounded-lg object-contain border border-[var(--border)] bg-[var(--bg)]" />
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">No logo</span>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex items-center justify-end gap-1">
                        {canManage
                          ? <button onClick={openEditSetup} className="action-btn text-[var(--warning)]" title="Edit"><FileEdit size={14} /></button>
                          : <span className="text-[var(--text-muted)]">—</span>}
                      </div>
                    </td>
                  </motion.tr>
                )}

                {/* ── Code Creation rows ─────────────────────────────────────── */}
                {activeTab === 'Parameter Creation' && subTab === 'Code Creation' && (
                  pagedCodes.length > 0 ? (
                    pagedCodes.map((row, i) => (
                      <motion.tr
                        key={row.id} className="tr"
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.05 + i * 0.04 }}
                      >
                        <td className="td text-[var(--text-muted)] text-[12px]">{i + 1}</td>
                        <td className="td font-medium text-[var(--text-primary)]">
                          <div className="flex items-center gap-2.5">
                            <div className="w-[28px] h-[28px] rounded-[8px] bg-[var(--accent-dim)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shrink-0">
                              <Tag size={12} strokeWidth={1.8} />
                            </div>
                            <span className="font-mono text-[12px] font-bold text-[var(--text-primary)] bg-[var(--bg)] px-2 py-0.5 rounded border border-[var(--border)]">
                              {row.code}
                            </span>
                          </div>
                        </td>
                        <td className="td font-medium text-[var(--text-primary)]">{row.name}</td>
                        <td className="td text-[var(--text-secondary)]">{row.description ?? '—'}</td>
                        <td className="td text-center">
                          <span className="inline-flex items-center justify-center min-w-[24px] h-[20px] px-2 rounded-full text-[11px] font-bold bg-[var(--accent-dim)] text-[var(--accent)]">
                            {row._count?.values ?? 0}
                          </span>
                        </td>
                        <td className="td">
                          <div className="flex items-center justify-end gap-1">
                            {canManage
                              ? <button onClick={() => handleEditCode(row)} className="action-btn text-[var(--warning)]" title="Edit"><FileEdit size={14} /></button>
                              : <span className="text-[var(--text-muted)]">—</span>}
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="td text-center py-10 text-[var(--text-muted)]">
                        No code lists found.
                      </td>
                    </tr>
                  )
                )}

                {/* ── Code Values rows ───────────────────────────────────────── */}
                {activeTab === 'Parameter Creation' && subTab === 'Code Values' && (
                  pagedValues.length > 0 ? (
                    pagedValues.map((row, i) => (
                      <motion.tr
                        key={row.id} className="tr"
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.05 + i * 0.04 }}
                      >
                        <td className="td text-[var(--text-muted)] text-[12px]">{i + 1}</td>
                        <td className="td">
                          <span className="font-mono text-[11px] font-bold text-[var(--accent)] bg-[var(--accent-dim)] px-2 py-0.5 rounded border border-[var(--border)]">
                            {codeMap[row.codeListId] ?? '—'}
                          </span>
                        </td>
                        <td className="td font-medium text-[var(--text-primary)]">
                          <span className="font-mono text-[12px] bg-[var(--bg)] px-2 py-0.5 rounded border border-[var(--border)]">
                            {row.label}
                          </span>
                        </td>
                        <td className="td text-[var(--text-secondary)]">{row.description ?? '—'}</td>
                        <td className="td">
                          {row.isActive
                            ? <span className="pill pill-success text-[11px]">Active</span>
                            : <span className="pill text-[11px]" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid var(--danger)' }}>Inactive</span>}
                        </td>
                        <td className="td">
                          <div className="flex justify-end">
                            {canManage
                              ? <RowActions actions={[
                                  { label: 'Edit', icon: FileEdit, onClick: () => handleEditValue(row) },
                                  row.isActive
                                    ? { label: 'Deactivate', icon: Trash2, danger: true, onClick: () => handleToggleValueClick(row) }
                                    : { label: 'Activate', icon: CheckCircle, onClick: () => handleToggleValueClick(row) },
                                ]} />
                              : <span className="text-[var(--text-muted)]">—</span>}
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="td text-center py-10 text-[var(--text-muted)]">
                        No code values found.
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination footer ────────────────────────────────────────────── */}
        {activeTab === 'App Setup' && (
          <TablePagination total={1} filtered={1} />
        )}
        {activeTab === 'Parameter Creation' && subTab === 'Code Creation' && (
          <TablePagination
            total={codes.length}
            filtered={filteredCodes.length}
            page={codesPage}
            pageSize={codesPageSize}
            onPageChange={setCodesPage}
            onPageSizeChange={(s) => { setCodesPageSize(s); setCodesPage(1); }}
          />
        )}
        {activeTab === 'Parameter Creation' && subTab === 'Code Values' && (
          <TablePagination
            total={codeValues.length}
            filtered={filteredCodeValues.length}
            page={valuesPage}
            pageSize={valuesPageSize}
            onPageChange={setValuesPage}
            onPageSizeChange={(s) => { setValuesPageSize(s); setValuesPage(1); }}
          />
        )}
      </div>

      {/* ── MODALS ───────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {/* App Setup edit modal */}
        {isFormOpen && activeTab === 'App Setup' && (
          <Modal title={modalTitle} onClose={() => setIsFormOpen(false)} onSave={currentSave}>
            <div>
              <label className="label">Company Name</label>
              <input
                type="text"
                value={setupForm.companyName}
                onChange={(e) => setSetupForm({ ...setupForm, companyName: e.target.value })}
                placeholder="Enter company name"
              />
            </div>
            <div>
              <label className="label">Company Logo</label>
              <div className="flex items-center gap-3">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview"
                    className="w-14 h-14 rounded-lg object-contain border border-[var(--border)] bg-[var(--bg)] shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] flex items-center justify-center shrink-0 text-[var(--text-muted)]">
                    <Building2 size={18} />
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo(file); }}
                />
              </div>
              {logoUploading && (
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">Uploading…</p>
              )}
            </div>
          </Modal>
        )}

        {/* Code Creation form modal */}
        {isFormOpen && activeTab === 'Parameter Creation' && subTab === 'Code Creation' && (
          <Modal title={modalTitle} onClose={() => setIsFormOpen(false)} onSave={currentSave} saving={saving}>
            <div>
              <label className="label">Code <span className="text-[var(--danger)]">*</span></label>
              {selectedItem ? (
                <div className="flex items-center gap-2 h-[38px] px-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-hover)] cursor-not-allowed">
                  <Tag size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span className="font-mono text-[13px] font-bold" style={{ color: 'var(--text-muted)' }}>
                    {codeForm.code}
                  </span>
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-[.06em]" style={{ color: 'var(--text-muted)' }}>
                    locked
                  </span>
                </div>
              ) : (
                <input
                  type="text"
                  value={codeForm.code}
                  onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. DEPT"
                  className="font-mono"
                />
              )}
            </div>
            <div>
              <label className="label">Name <span className="text-[var(--danger)]">*</span></label>
              <input
                type="text"
                value={codeForm.name}
                onChange={(e) => setCodeForm({ ...codeForm, name: e.target.value })}
                placeholder="e.g. Department"
              />
            </div>
            <div>
              <label className="label">Description</label>
              <input
                type="text"
                value={codeForm.description}
                onChange={(e) => setCodeForm({ ...codeForm, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
          </Modal>
        )}

        {/* Code Values form modal */}
        {isFormOpen && activeTab === 'Parameter Creation' && subTab === 'Code Values' && (
          <Modal title={modalTitle} onClose={() => setIsFormOpen(false)} onSave={currentSave} saving={saving}>
            <div>
              <label className="label">Code List <span className="text-[var(--danger)]">*</span></label>
              <select
                value={valForm.codeListId}
                onChange={(e) => setValForm({ ...valForm, codeListId: e.target.value })}
                disabled={!!selectedItem}
              >
                <option value="">Select a code list</option>
                {codes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Label <span className="text-[var(--danger)]">*</span></label>
              <input
                type="text"
                value={valForm.label}
                onChange={(e) => setValForm({ ...valForm, label: e.target.value })}
                placeholder="e.g. Engineering Department"
              />
            </div>
            <div>
              <label className="label">Description</label>
              <input
                type="text"
                value={valForm.description}
                onChange={(e) => setValForm({ ...valForm, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Confirm activate / deactivate alert */}
      <ConfirmAlert
        isOpen={isAlertOpen}
        title={toggleTitle}
        message={toggleMessage}
        confirmText={isDeactivating ? 'Yes, Deactivate' : 'Yes, Activate'}
        onConfirm={handleConfirmToggleValue}
        onCancel={() => { setIsAlertOpen(false); setSelectedItem(null); }}
        variant={isDeactivating ? 'danger' : 'info'}
      />
    </div>
  );
}
