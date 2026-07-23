import { useState, useMemo, useEffect, useCallback } from 'react';
import { Eye, Download, FileText, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { DocumentViewer } from './DocumentViewer';
import { PageHeader } from './ui/PageHeader';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { RowActions } from './ui/RowActions';
import api from '../../lib/api';
import { toast } from 'sonner';

type PersonalTab = 'Shared with Me' | 'My Documents';
const TABS: PersonalTab[] = ['Shared with Me', 'My Documents'];

const fmtDate = (v: string | null | undefined) => v ? String(v).substring(0, 10) : '—';

export function PersonalDocuments() {
  const [activeTab, setActiveTab]       = useState<PersonalTab>('Shared with Me');
  const [sharedDocs, setSharedDocs]     = useState<any[]>([]);
  const [personalDocs, setPersonalDocs] = useState<any[]>([]);
  const [search, setSearch]             = useState('');
  const [loading, setLoading]           = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [documentToView, setDocumentToView] = useState<any>(null);

  useEffect(() => {
    api.get('/documents/settings')
      .then(r => setAllowDownload((r.data.data?.allow_document_download ?? 'No') === 'Yes'))
      .catch(() => {});
  }, []);

  const fetchShared = useCallback(() => {
    setLoading(true);
    api.get('/documents/my-shared')
      .then(r => setSharedDocs(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchPersonal = useCallback(() => {
    setLoading(true);
    api.get('/documents/my-personal')
      .then(r => setPersonalDocs(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab === 'Shared with Me') fetchShared();
    else fetchPersonal();
  }, [activeTab, fetchShared, fetchPersonal]);

  const filteredShared = useMemo(
    () => sharedDocs.filter(d => JSON.stringify(d).toLowerCase().includes(search.toLowerCase())),
    [sharedDocs, search]
  );
  const filteredPersonal = useMemo(
    () => personalDocs.filter(d => JSON.stringify(d).toLowerCase().includes(search.toLowerCase())),
    [personalDocs, search]
  );

  const handleDownload = async (filename: string, label?: string) => {
    if (!allowDownload) return;
    try {
      const res = await api.get(`/documents/${filename}?download=1`, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([res.data]));
      const link = Object.assign(document.createElement('a'), { href: url, download: label || filename });
      link.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  };

  const isShared = activeTab === 'Shared with Me';
  const rows     = isShared ? filteredShared : filteredPersonal;
  const total    = isShared ? sharedDocs.length : personalDocs.length;

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full max-w-[1400px] mx-auto flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Personal Documents"
        subtitle="View documents shared with you and your personal documents on file."
      />

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 drop-shadow-sm">
        {/* Tabs */}
        <div className="flex items-end gap-0.5 px-4 pt-3 border-b border-[var(--border)] shrink-0">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSearch(''); }}
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

        <TableToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search documents…"
        />

        <div className="overflow-x-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading…
            </div>
          ) : isShared ? (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">Document Name</th>
                  <th className="th">Details</th>
                  <th className="th">Valid Until</th>
                  <th className="th text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={4} className="td text-center py-12 text-[var(--text-muted)]">No shared documents.</td></tr>
                ) : rows.map((doc: any, i) => (
                  <motion.tr key={doc.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                    <td className="td font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        <FileText size={13} className="text-[var(--accent)] shrink-0" />
                        {doc.name}
                      </div>
                    </td>
                    <td className="td truncate max-w-[260px] text-[var(--text-secondary)]">{doc.details || '—'}</td>
                    <td className="td">{fmtDate(doc.valid_until)}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActions actions={[
                          { label: 'View', icon: Eye, onClick: () => setDocumentToView({ ...doc, attachmentName: doc.attachment, sourceUrl: doc.attachment ? `/documents/${doc.attachment}` : null }), hidden: !doc.attachment },
                          { label: 'Download', icon: Download, onClick: () => handleDownload(doc.attachment, doc.name), hidden: !(allowDownload && doc.attachment) },
                        ]} />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th">Document Type</th>
                  <th className="th">Date Added</th>
                  <th className="th">Valid Until</th>
                  <th className="th">Place of Issue</th>
                  <th className="th">Status</th>
                  <th className="th text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="td text-center py-12 text-[var(--text-muted)]">No personal documents on file.</td></tr>
                ) : rows.map((doc: any, i) => (
                  <motion.tr key={doc.id} className="tr" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
                    <td className="td font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        <FileText size={13} className="text-[var(--accent)] shrink-0" />
                        {doc.document_type_name || doc.name || '—'}
                      </div>
                    </td>
                    <td className="td">{fmtDate(doc.date_added)}</td>
                    <td className="td">{fmtDate(doc.valid_until)}</td>
                    <td className="td">{doc.place_of_issue || '—'}</td>
                    <td className="td">
                      <span
                        className={`pill ${doc.status === 'Active' ? 'pill-success' : ''}`}
                        style={doc.status !== 'Active' ? { background: 'var(--surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border)' } : {}}
                      >
                        {doc.status || 'Active'}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActions actions={[
                          { label: 'View', icon: Eye, onClick: () => setDocumentToView({ ...doc, attachmentName: doc.attachment, sourceUrl: doc.attachment ? `/documents/${doc.attachment}` : null }), hidden: !doc.attachment },
                          { label: 'Download', icon: Download, onClick: () => handleDownload(doc.attachment, doc.document_type_name || 'document'), hidden: !(allowDownload && doc.attachment) },
                        ]} />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <TablePagination total={total} filtered={rows.length} />
      </div>

      <DocumentViewer document={documentToView} onClose={() => setDocumentToView(null)} allowDownload={allowDownload} />
    </div>
  );
}
