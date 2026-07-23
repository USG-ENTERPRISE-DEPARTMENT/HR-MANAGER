import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Eye, FileEdit, Trash2, Filter, Plus, Download, X, Loader2, Mail,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ConfirmAlert } from './ConfirmAlert';
import { CompanyDocumentForm } from './CompanyDocumentForm';
import { EmployeeDocumentForm } from './EmployeeDocumentForm';
import { DocumentViewer } from './DocumentViewer';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FilterSelect } from './ui/FilterSelect';
import { RowActions } from './ui/RowActions';
import api from '../../lib/api';
import { toast } from 'sonner';
import { useCan } from '@/hooks/useCan';

// share_departments / share_employees are stored as comma-joined IDs.
// Resolve them to names so the column reads "Emps: John Doe" rather than "Emps: 8".
const fmtSharing = (doc: any, empMap: Record<string, string> = {}, deptMap: Record<string, string> = {}) => {
  if (doc.share_userlevel === 'All') return 'All';
  const resolve = (csv: string, map: Record<string, string>) =>
    csv.split(',').map(x => x.trim()).filter(Boolean).map(id => map[id] ?? `#${id}`);
  const parts: string[] = [];
  if (doc.share_departments) parts.push(`Depts: ${resolve(doc.share_departments, deptMap).join(', ')}`);
  if (doc.share_employees)   parts.push(`Emps: ${resolve(doc.share_employees, empMap).join(', ')}`);
  return parts.join(' | ') || '—';
};

const fmtDate = (d: any) => d ? String(d).substring(0, 10) : '—';

type DocTab = 'Company Documents' | 'Employee Documents';
const TABS: DocTab[] = ['Company Documents', 'Employee Documents'];

export function Documents() {
  const { can } = useCan();
  const [activeTab, setActiveTab]         = useState<DocTab>('Company Documents');
  const [companyDocs, setCompanyDocs]     = useState<any[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [employeeDocs, setEmployeeDocs]   = useState<any[]>([]);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [search, setSearch]               = useState('');
  const [showFilters, setShowFilters]     = useState(false);
  const [docTypeFilter, setDocTypeFilter] = useState('');
  const [isFormOpen, setIsFormOpen]       = useState(false);
  const [isAlertOpen, setIsAlertOpen]     = useState(false);
  const [selectedDoc, setSelectedDoc]     = useState<any>(null);
  const [documentToView, setDocumentToView] = useState<any>(null);
  const [notifying, setNotifying]         = useState(false);
  const [empMap, setEmpMap]               = useState<Record<string, string>>({});
  const [deptMap, setDeptMap]             = useState<Record<string, string>>({});

  const isEmployee = activeTab === 'Employee Documents';

  const fetchCompanyDocs = useCallback(() => {
    setCompanyLoading(true);
    api.get('/documents/company')
      .then(r => setCompanyDocs(r.data.data ?? []))
      .catch(() => toast.error('Failed to load company documents'))
      .finally(() => setCompanyLoading(false));
  }, []);

  const fetchEmployeeDocs = useCallback(() => {
    setEmployeeLoading(true);
    api.get('/documents/employee')
      .then(r => setEmployeeDocs(r.data.data ?? []))
      .catch(() => toast.error('Failed to load employee documents'))
      .finally(() => setEmployeeLoading(false));
  }, []);

  useEffect(() => { fetchCompanyDocs();  }, [fetchCompanyDocs]);
  useEffect(() => { fetchEmployeeDocs(); }, [fetchEmployeeDocs]);

  // Lookup maps to resolve shared employee/department IDs to names in the table
  useEffect(() => {
    api.get('/employees/active')
      .then(r => setEmpMap(Object.fromEntries((r.data.data ?? []).map((e: any) => [String(e.id), e.name]))))
      .catch(() => {});
    api.get('/company/structures')
      .then(r => setDeptMap(Object.fromEntries((r.data.data ?? []).map((s: any) => [String(s.id), s.title]))))
      .catch(() => {});
  }, []);

  const filteredCompany = useMemo(
    () => companyDocs.filter(d => (d.name ?? '').toLowerCase().includes(search.toLowerCase())),
    [companyDocs, search]
  );

  const filteredEmployee = useMemo(
    () => employeeDocs.filter(d => {
      const q = search.toLowerCase();
      const nameMatch = (d.employee_name ?? '').toLowerCase().includes(q);
      const typeMatch = (d.document_type_name ?? '').toLowerCase().includes(q);
      const filterMatch = !docTypeFilter || d.document_type_name === docTypeFilter;
      return (nameMatch || typeMatch) && filterMatch;
    }),
    [employeeDocs, search, docTypeFilter]
  );

  const handleSave = () => {
    if (isEmployee) fetchEmployeeDocs();
    else fetchCompanyDocs();
    toast.success('Document saved');
  };

  const handleDelete = async () => {
    if (!selectedDoc) return;
    try {
      if (isEmployee) {
        await api.delete(`/documents/employee/${selectedDoc.id}`);
      } else {
        await api.delete(`/documents/company/${selectedDoc.id}`);
      }
      toast.success('Document deleted');
      isEmployee ? fetchEmployeeDocs() : fetchCompanyDocs();
    } catch {
      toast.error('Delete failed');
    }
    setIsAlertOpen(false);
    setSelectedDoc(null);
  };

  const handleNotifyExpired = async () => {
    setNotifying(true);
    try {
      const r = await api.post('/documents/employee/notify-expired');
      const { notified, total } = r.data.data ?? {};
      if (total === 0) toast.info('No expired documents found that need notification.');
      else toast.success(`Email sent for ${notified} of ${total} expired document(s).`);
      fetchEmployeeDocs();
    } catch {
      toast.error('Failed to send notifications');
    } finally {
      setNotifying(false);
    }
  };

  // Normalise a row from the API into the shape EmployeeDocumentForm expects
  const toEditData = (row: any) => ({
    id:           row.id,
    employee:     String(row.employee),
    documentType: row.document_type_name ?? '',
    dateOfIssue:  fmtDate(row.date_added)  === '—' ? '' : fmtDate(row.date_added),
    placeOfIssue: row.place_of_issue ?? '',
    expiryDate:   fmtDate(row.valid_until) === '—' ? '' : fmtDate(row.valid_until),
    details:      row.details ?? '',
    attachment:   row.attachment ?? null,
  });

  const loading = isEmployee ? employeeLoading : companyLoading;
  const rows    = isEmployee ? filteredEmployee : filteredCompany;

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full max-w-[1400px] mx-auto flex flex-col h-full overflow-hidden">
      <PageHeader title="Documents" subtitle="Manage company-wide and employee documents." />

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 drop-shadow-sm">
        {/* Tabs */}
        <div className="flex items-end gap-0.5 px-4 pt-3 border-b border-[var(--border)] shrink-0">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSearch(''); setDocTypeFilter(''); setShowFilters(false); }}
              className={[
                'px-3.5 py-2 text-[12px] font-semibold rounded-t-lg transition-colors whitespace-nowrap',
                tab === activeTab
                  ? 'bg-[var(--surface)] border border-b-[var(--surface)] border-[var(--border)] text-[var(--accent)] -mb-px z-10'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg)]',
              ].join(' ')}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <TableToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder={isEmployee ? 'Search employee or type…' : 'Search company documents…'}
          showFilters={showFilters && isEmployee}
          filterBar={isEmployee ? (
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide syne">Doc Type:</label>
              <FilterSelect
                value={docTypeFilter}
                onChange={setDocTypeFilter}
                placeholder="All Types"
                minWidth={140}
                options={[
                  { value: '', label: 'All Types' },
                  { value: 'National ID', label: 'National ID' },
                  { value: 'Passport', label: 'Passport' },
                  { value: "Driver's License", label: "Driver's License" },
                  { value: 'Tax Certificate', label: 'Tax Certificate' },
                  { value: 'SSNIT Card', label: 'SSNIT Card' },
                ]}
              />
              {docTypeFilter && (
                <button onClick={() => setDocTypeFilter('')} className="text-[12px] font-bold text-[var(--accent)] hover:text-blue-800 flex items-center gap-1">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
          ) : null}
          actions={
            <>
              {can('create_documents') && (
                <button onClick={() => { setSelectedDoc(null); setIsFormOpen(true); }} className="primary-btn shrink-0">
                  <span className="hidden sm:inline">Add New</span><span className="sm:hidden">Add</span>
                  <Plus className="w-[14px] h-[14px]" />
                </button>
              )}
              {isEmployee && (
                <>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`secondary-btn shrink-0 ${showFilters ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
                  >
                    Filter <Filter className="w-[14px] h-[14px] fill-current opacity-80" />
                  </button>
                  <button
                    onClick={handleNotifyExpired}
                    disabled={notifying}
                    className="secondary-btn shrink-0 flex items-center gap-1.5"
                    title="Send emails for all expired documents that haven't been notified yet"
                  >
                    {notifying ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Mail className="w-[14px] h-[14px]" />}
                    <span className="hidden sm:inline">Notify Expired</span>
                  </button>
                </>
              )}
              <button className="secondary-btn shrink-0">
                <span className="hidden sm:inline">Download (Excel)</span>
                <span className="sm:hidden">Export</span>
                <Download className="w-[14px] h-[14px]" />
              </button>
            </>
          }
        />

        {/* Table */}
        <div className="overflow-x-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading…
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {isEmployee ? (
                    <>
                      <th className="th">Employee</th>
                      <th className="th">Document Type</th>
                      <th className="th">Date of Issue</th>
                      <th className="th">Expiry Date</th>
                      <th className="th">Place of Issue</th>
                    </>
                  ) : (
                    <>
                      <th className="th">Name</th>
                      <th className="th">Shared With</th>
                      <th className="th">Details</th>
                      <th className="th">Valid Until</th>
                    </>
                  )}
                  <th className="th text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? (
                  rows.map((row: any, i: number) => (
                    <motion.tr key={row.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                      {isEmployee ? (
                        <>
                          <td className="td font-medium text-[var(--text-primary)]">{row.employee_name ?? '—'}</td>
                          <td className="td">{row.document_type_name ?? '—'}</td>
                          <td className="td">{fmtDate(row.date_added)}</td>
                          <td className="td">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={row.valid_until && new Date(row.valid_until) < new Date() ? 'text-rose-600 font-semibold' : ''}>
                                {fmtDate(row.valid_until)}
                              </span>
                              {row.expire_notification_last && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 whitespace-nowrap">
                                  <Mail size={9} /> Email Sent
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="td">{row.place_of_issue ?? '—'}</td>
                        </>
                      ) : (
                        <>
                          <td className="td font-medium text-[var(--text-primary)]">{row.name}</td>
                          <td className="td text-[var(--text-muted)] text-[12px]">{fmtSharing(row, empMap, deptMap)}</td>
                          <td className="td truncate max-w-[220px]">{row.details || '—'}</td>
                          <td className="td">{row.valid_until ? fmtDate(row.valid_until) : '—'}</td>
                        </>
                      )}
                      <td className="td">
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View', icon: Eye, onClick: () => setDocumentToView({ ...row, attachmentName: row.attachment, sourceUrl: row.attachment ? `/documents/${row.attachment}` : null }) },
                            { label: 'Edit', icon: FileEdit, onClick: () => { setSelectedDoc(isEmployee ? toEditData(row) : row); setIsFormOpen(true); }, hidden: !can('edit_documents') },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => { setSelectedDoc(row); setIsAlertOpen(true); }, hidden: !can('delete_documents') },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={isEmployee ? 6 : 5} className="td text-center py-10 text-[var(--text-muted)]">
                      No {isEmployee ? 'employee' : 'company'} documents found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <TablePagination
          total={isEmployee ? employeeDocs.length : companyDocs.length}
          filtered={rows.length}
        />
      </div>

      {isFormOpen && isEmployee  && <EmployeeDocumentForm onClose={() => setIsFormOpen(false)} initialData={selectedDoc} onSave={handleSave} />}
      {isFormOpen && !isEmployee && <CompanyDocumentForm  onClose={() => setIsFormOpen(false)} initialData={selectedDoc} onSave={handleSave} />}
      <DocumentViewer document={documentToView} onClose={() => setDocumentToView(null)} allowDownload />
      <ConfirmAlert
        isOpen={isAlertOpen}
        title="Delete Document"
        message="Are you sure you want to delete this document? This action cannot be undone."
        confirmText="Yes, Delete"
        onConfirm={handleDelete}
        onCancel={() => setIsAlertOpen(false)}
        variant="danger"
      />
    </div>
  );
}
