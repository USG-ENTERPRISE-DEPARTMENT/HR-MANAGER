import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FilePlus, Users, UserCheck, Receipt, Building2,
  MessageCircle, SlidersHorizontal,
  Plus, Edit, Trash2, CheckCircle2, XCircle, RefreshCw,
  FileText, X, UploadCloud, Send, Eye, ChevronLeft, Download, Upload,
  Calendar, Stethoscope, Pill, Landmark, UserCircle2, DollarSign, Paperclip,
  Clock, ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PageHeader } from './ui/PageHeader';
import { RowActions } from './ui/RowActions';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormModal } from './ui/FormModal';
import { ConfirmAlert } from './ConfirmAlert';
import { inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect } from './ui/SearchSelect';
import { OcrScanButton, type OcrFields } from './ai/OcrScanButton';
import { toast } from 'sonner';
import api from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { getSettings } from '../../lib/settings';
import { currencyCode } from '../../lib/currency';
import { useCan } from '@/hooks/useCan';

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMISSION_TYPES    = ['Outpatient', 'Inpatient', 'Emergency', 'Day Case'];

// ── Shared UI ─────────────────────────────────────────────────────────────────

interface TabDef { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; }

function MedTabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mb-5">
      {tabs.map(tab => {
        const Icon = tab.icon;
        return (
          <button key={tab.label} onClick={() => onChange(tab.label)}
            className={`tab-btn flex items-center gap-1.5 ${active === tab.label ? 'active' : ''}`}>
            <Icon size={13} />{tab.label}
          </button>
        );
      })}
    </div>
  );
}

function F({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="label">{label}{required && <span className="text-[var(--danger)]"> *</span>}</label>
      {children}
    </div>
  );
}

function EmptyTable({ cols }: { cols: number }) {
  return (
    <tr><td colSpan={cols} className="td text-center py-10 text-[13px] text-[var(--text-muted)]">No data available in table</td></tr>
  );
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const cls: Record<string, string> = {
    Draft:             'pill pill-neutral',
    Pending:           'pill pill-warning',
    'Pending Approval':'pill pill-warning',
    Submitted:         'pill pill-accent',
    Approved:          'pill pill-success',
    Rejected:          'pill pill-danger',
    'GL Failed':       'pill pill-danger',
    Cancelled:         'pill pill-neutral',
    Processing:        'pill pill-accent',
  };
  return <span className={cls[status] ?? 'pill pill-neutral'}>{status}</span>;
}

function medicalGlError(record: any): string {
  try {
    const log = typeof record?.payment_log === 'string'
      ? JSON.parse(record.payment_log || '{}')
      : (record?.payment_log ?? {});
    const error = log?.error;
    if (error && typeof error === 'object') {
      return error.responseCode
        ? `[${error.responseCode}] ${error.message || ''}`.trim()
        : (error.message || JSON.stringify(error));
    }
    if (typeof error === 'string') return error;
  } catch {}
  return '';
}


// ── Document preview modal ────────────────────────────────────────────────────

function DocPreviewModal({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(filename ?? '');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative z-10 bg-[var(--surface)] rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh] overflow-hidden border border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0 bg-slate-50/60">
          <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate max-w-[80%]">{filename}</p>
          <div className="flex items-center gap-1">
            <a href={url} download={filename}
              className="action-btn text-[var(--accent)]" title="Download">
              <Download size={14} />
            </a>
            <button onClick={onClose} className="action-btn"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center" style={{ minHeight: 400 }}>
          {isImg
            ? <img src={url} alt={filename} className="max-w-full max-h-full object-contain p-2" />
            : <iframe src={url} title={filename} className="w-full border-0" style={{ height: 600 }} />
          }
        </div>
      </motion.div>
    </div>
  );
}

// ── Document upload field ──────────────────────────────────────────────────────

function DocUploadField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [localBlob, setLocalBlob] = useState<string | null>(null);
  const [preview, setPreview]     = useState(false);

  const isImg = (name: string) => /\.(png|jpg|jpeg|gif|webp)$/i.test(name ?? '');

  useEffect(() => { if (!value) setLocalBlob(null); }, [value]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.type.startsWith('image/')) setLocalBlob(URL.createObjectURL(file));
    else setLocalBlob(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/employees/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const filename = res.data.data?.filename ?? res.data?.filename;
      if (filename) onChange(filename);
      else toast.error('Upload failed — no filename returned');
    } catch { toast.error('Failed to upload document'); setLocalBlob(null); }
    finally { setUploading(false); }
  }

  const docUrl  = localBlob ?? (value ? `/v1/api/hr/documents/${value}` : null);
  const thumbSrc = localBlob ?? (value && isImg(value) ? `/v1/api/hr/documents/${value}` : null);

  return (
    <div className="w-full min-w-0 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <label className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg border cursor-pointer transition-colors
          ${uploading ? 'opacity-50 cursor-wait border-[var(--border)] bg-[var(--bg)]' : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]'}`}>
          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
            disabled={uploading} onChange={e => handleFile(e.target.files?.[0])} />
          <UploadCloud size={13} className={uploading ? 'animate-pulse text-[var(--accent)]' : ''} />
          {uploading ? 'Uploading…' : value ? 'Replace' : 'Choose File'}
        </label>

        {value && !uploading && <>
          <span className="text-[12px] text-[var(--text-secondary)] truncate min-w-0 flex-1">{value}</span>
          <button type="button" onClick={() => setPreview(true)}
            className="shrink-0 action-btn text-[var(--accent)]" title="View document">
            <Eye size={13} />
          </button>
          <button type="button" onClick={() => { onChange(''); setLocalBlob(null); }}
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors">
            <X size={13} />
          </button>
        </>}
        {!value && !uploading && <span className="text-[12px] text-[var(--text-muted)]">No file chosen</span>}
      </div>

      {/* Thumbnail for images */}
      {thumbSrc && (
        <button type="button" onClick={() => setPreview(true)}
          className="block w-full rounded-lg overflow-hidden border border-[var(--border)] bg-slate-50 hover:opacity-90 transition-opacity">
          <img src={thumbSrc} alt="preview" className="w-full max-h-32 object-contain"
            onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
        </button>
      )}

      {/* PDF / non-image indicator */}
      {value && !isImg(value) && !uploading && (
        <button type="button" onClick={() => setPreview(true)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)] hover:underline">
          <FileText size={12} /> View attached document
        </button>
      )}

      <AnimatePresence>
        {preview && docUrl && (
          <DocPreviewModal url={docUrl} filename={value} onClose={() => setPreview(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Data hooks ────────────────────────────────────────────────────────────────

interface EmpOption { id: string; label: string; paygradId?: string; empId?: string; }

function useEmployees() {
  const [list, setList] = useState<EmpOption[]>([]);
  useEffect(() => {
    // Only active employees can have new medical requests/claims — exclude suspended,
    // terminated and resigned staff from the picker.
    api.get('/employees?approval=APPROVED&lifecycle=ACTIVE').then(r => {
      const rows: any[] = r.data.data ?? r.data ?? [];
      setList(rows.map((e: any) => ({
        id:        String(e.id),
        label:     `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || e.employee_id,
        paygradId: e.paygrade?.id ? String(e.paygrade.id) : undefined,
        empId:     e.employee_id ?? '',
      })));
    }).catch(() => {});
  }, []);
  return list;
}

function usePayGrades() {
  const [list, setList] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/salary/paygrades').then(r => {
      const rows: any[] = r.data.data ?? r.data ?? [];
      setList(rows.map((g: any) => ({ id: String(g.id), label: g.name ?? g.label ?? String(g.id) })));
    }).catch(() => {});
  }, []);
  return list;
}

// Fetch active values for the CUR code list
function useCurrencies() {
  const [list, setList] = useState<{ id: string; label: string; code: string }[]>([]);
  useEffect(() => {
    api.get('/system/code-lists/CUR/values').then(r => {
      const rows: any[] = r.data.data ?? r.data ?? [];
      setList(rows.map((v: any) => ({ id: String(v.id), label: v.label, code: v.code ?? v.label })));
    }).catch(() => {});
  }, []);
  return list;
}

// Map paygradId → currency from medical limits
function useLimitCurrencyMap() {
  const [map, setMap] = useState<Record<string, string>>({});
  const reload = () => {
    api.get('/medical/limits').then(r => {
      const rows: any[] = r.data.data ?? r.data ?? [];
      const m: Record<string, string> = {};
      rows.forEach((row: any) => { if (row.paygrade_id) m[String(row.paygrade_id)] = row.currency; });
      setMap(m);
    }).catch(() => {});
  };
  useEffect(reload, []);
  return { limitCurrencyMap: map, reloadLimitMap: reload };
}

// All employee dependents (from the employee module)
function useAllDependents() {
  const [all, setAll] = useState<any[]>([]);
  useEffect(() => {
    api.get('/dependents').then(r => setAll(r.data.data ?? r.data ?? [])).catch(() => {});
  }, []);
  return all;
}

function useHospitalList() {
  const [list, setList] = useState<{ id: string; label: string; type: string }[]>([]);
  const reload = () => {
    api.get('/medical/hospitals').then(r => {
      const rows: any[] = r.data.data ?? r.data ?? [];
      setList(rows.map((h: any) => ({ id: String(h.id), label: h.name, type: h.type ?? 'Hospital' })));
    }).catch(() => {});
  };
  useEffect(reload, []);
  return { hospitalOptions: list, reloadHospitals: reload };
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows]
    .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${filename}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Generic table shell ───────────────────────────────────────────────────────

interface ExportConfig {
  filename: string;
  title: string;
  headers: string[];
  getRow: (row: any) => (string | number)[];
}

function MedTable({
  search, onSearch, onAdd, addLabel = 'Add New',
  headers, headerAligns, rows, renderRow, emptyColSpan, total, filtered,
}: {
  search: string; onSearch: (q: string) => void; onAdd?: () => void; addLabel?: string;
  headers: string[]; headerAligns?: ('left' | 'right' | 'center')[];
  rows: any[]; renderRow: (row: any, i: number) => React.ReactNode;
  emptyColSpan: number; total: number; filtered: number;
}) {
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => { setPage(1); }, [filtered]);
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <TableToolbar searchQuery={search} onSearchChange={onSearch}
        actions={onAdd ? <button className="primary-btn" onClick={onAdd}><Plus size={14} />{addLabel}</button> : undefined}
      />
      <div className="overflow-x-auto flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr>{headers.map((h, i) => {
              const align = headerAligns?.[i];
              const cls = align === 'right' ? '!text-right' : align === 'center' ? '!text-center' : h === 'Actions' ? '!text-right' : '';
              return <th key={h} className={`th ${cls}`}>{h}</th>;
            })}</tr>
          </thead>
          <tbody>{paged.length > 0 ? paged.map(renderRow) : <EmptyTable cols={emptyColSpan} />}</tbody>
        </table>
      </div>
      <TablePagination
        total={total} filtered={filtered}
        page={page} pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />
    </motion.div>
  );
}

// ── Medical Detail Panel (slide-over) ─────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">{label}</p>
      <div className="text-[13px] text-[var(--text-primary)] font-medium">{children ?? <span className="text-[var(--text-muted)] font-normal">—</span>}</div>
    </div>
  );
}

function MedicalDetailPanel({ record: initialRecord, type, adminMode, onClose, onRefresh }: {
  record: any; type: 'staff' | 'dependent'; adminMode: boolean;
  onClose: () => void; onRefresh: () => void;
}) {
  const [record, setRecord]       = useState(initialRecord);
  const [acting, setActing]         = useState(false);
  const [docPreview, setDocPreview] = useState(false);
  const [rejecting, setRejecting]   = useState(false);
  const [reason, setReason]         = useState('');
  const medicalSelfApproval = getSettings().approvals.medicalSelfApproval;
  const appCurrency = getSettings().general.currency;
  const currentUserId = getCurrentUser()?.id;
  const currentUserRoles = (getCurrentUser()?.allRoles ?? []).map(r => r.name);
  const attachment = record.attachment1;
  const isImage = (name: string) => /\.(png|jpg|jpeg|gif|webp)$/i.test(name ?? '');

  useEffect(() => { setRecord(initialRecord); }, [initialRecord]);

  // Multi-stage approval snapshot for this record (empty ⇒ single-stage / no flow).
  const [stages, setStages] = useState<any[]>([]);
  useEffect(() => {
    if (record.status === 'Pending Approval' || record.status === 'Approved' || record.status === 'Rejected') {
      api.get(`/medical/requests/${type}/${record.id}/stages`)
        .then(r => setStages(r.data?.data ?? []))
        .catch(() => setStages([]));
    } else { setStages([]); }
  }, [record.id, record.status, type]);
  const hasFlow = stages.length > 0;
  const currentStage = stages.find(s => s.status === 'Pending') ?? null;
  const isCurrentApprover = !currentStage ? true : (currentStage.approver_type === 'user'
    ? String(currentUserId ?? '') === String(currentStage.approver_id)
    : currentUserRoles.includes(String(currentStage.approver_label)) || currentUserRoles.includes(String(currentStage.approver_id)));

  const { can } = useCan();
  // In admin mode, processing actions require medical permissions. In personal mode a user can
  // only act on a request they originated — admin-originated requests are view-only.
  const isOwnRecord = String(record.posted_by ?? '') === String(currentUserId ?? '');
  const canProcess = !adminMode || can('approve_medical');
  const canCreate  = adminMode ? can('create_medical') : isOwnRecord;

  const base = type === 'staff'
    ? `/medical/staff/${record.id}`
    : `/medical/dependents-requests/${record.id}`;

  async function callAction(endpoint: string, body: object, successMsg: string) {
    setActing(true);
    try {
      const r = await api.post(endpoint, body);
      const updated = r.data?.data;
      console.log(`[medical GL] ${endpoint} response:`, updated);
      if (updated?.gl_payload) console.log('[medical GL] sent to GL API:', updated.gl_payload);
      if (updated) setRecord((current: any) => ({ ...current, ...updated }));
      onRefresh();
      if (updated?.status === 'GL Failed') {
        const glError = medicalGlError(updated);
        toast.error(
          `Medical request approved, but GL posting failed${glError ? ': ' + glError : ''}. Use Retry GL Posting below.`,
          { duration: 8000 },
        );
        return;
      }
      if (endpoint.endsWith('/retry-gl') && updated?.document_ref) {
        toast.success(`GL posted — Ref: ${updated.document_ref}`, { duration: 6000 });
      } else {
        toast.success(r.data?.message || successMsg);
        if (updated?.document_ref && endpoint.endsWith('/approve')) {
          toast.success(`GL posted — Ref: ${updated.document_ref}`, { duration: 6000 });
        }
      }
      onClose();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Action failed'); }
    finally { setActing(false); }
  }

  const submitRecord   = () => callAction(`${base}/submit`,   {},        'Submitted for approval');
  const approveRecord  = () => callAction(`${base}/approve`,  {},        'Request approved');
  const rejectRecord   = () => callAction(`${base}/reject`,   { reason }, 'Request rejected');

  return (
    <div className="fixed inset-0 z-[110] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative z-10 w-full max-w-md bg-[var(--surface)] shadow-2xl flex flex-col h-full border-l border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)] syne">
              {type === 'staff' ? 'Staff Medical Request' : 'Dependent Medical Request'}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Record #{record.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={record.status} />
            <button onClick={onClose} className="p-1.5 hover:bg-[var(--bg)] rounded-full text-[var(--text-muted)] transition-colors"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {type === 'dependent' ? (
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Employee">{record.employee_name}</DetailRow>
              <DetailRow label="Dependent">{record.dependent_name}</DetailRow>
              <DetailRow label="Relationship">{record.relationship}</DetailRow>
              <DetailRow label="Date of Birth">{record.dob ? String(record.dob).slice(0, 10) : undefined}</DetailRow>
            </div>
          ) : (
            <DetailRow label="Employee">{record.employee_name}</DetailRow>
          )}

          <div className="grid grid-cols-2 gap-3">
            <DetailRow label={type === 'staff' ? 'Admission Date' : 'Date Attended'}>
              {(type === 'staff' ? record.admission_date : record.date_attended)?.slice(0, 10)}
            </DetailRow>
            <DetailRow label={type === 'staff' ? 'Discharged Date' : 'Date Discharged'}>
              {(type === 'staff' ? record.discharged_date : record.date_discharged)?.slice(0, 10)}
            </DetailRow>
          </div>

          {record.admission_type && <DetailRow label="Admission Type">{record.admission_type}</DetailRow>}

          <div className="grid grid-cols-2 gap-3">
            <DetailRow label="Illness Type">{record.illness_type}</DetailRow>
            <DetailRow label="Medication">{record.medication}</DetailRow>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DetailRow label="Hospital / Facility">{record.hospital}</DetailRow>
            <DetailRow label="Physician">{record.physician}</DetailRow>
          </div>

          <DetailRow label="Cost">
            <span className="font-bold text-[var(--accent)]">
              {appCurrency && <span className="font-normal text-[var(--text-muted)] mr-1">{appCurrency}</span>}
              {parseFloat(String(record.cost ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </DetailRow>

          {attachment ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Attachment</p>
              {isImage(attachment) && (
                <button type="button" onClick={() => setDocPreview(true)}
                  className="block w-full rounded-lg overflow-hidden border border-[var(--border)] bg-slate-50 hover:opacity-90 transition-opacity">
                  <img src={`/v1/api/hr/documents/${attachment}`} alt="attachment"
                    className="w-full max-h-48 object-contain"
                    onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
                </button>
              )}
              <button type="button" onClick={() => setDocPreview(true)}
                className="w-full inline-flex items-center gap-2 px-3 py-2 text-[12px] font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] transition-colors">
                <Paperclip size={13} className="text-[var(--accent)]" />
                <span className="truncate flex-1 text-left">{attachment}</span>
                <Eye size={12} className="shrink-0 opacity-60" />
              </button>
            </div>
          ) : (
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Attachment</p>
              <span className="text-[12px] text-[var(--text-muted)]">No document attached</span>
            </div>
          )}

          {/* Audit trail */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)]">
            <DetailRow label="Posted By">{record.posted_by_name || '—'}</DetailRow>
            <DetailRow label={record.status === 'Rejected' ? 'Rejected By' : 'Approved By'}>
              {record.approved_by_name || '—'}
            </DetailRow>
          </div>

          {/* GL posting result */}
          {record.document_ref && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-[8px] border border-[var(--success,#10b981)] bg-[color-mix(in_srgb,var(--success,#10b981)_8%,transparent)]">
              <CheckCircle2 size={13} className="text-[var(--success,#10b981)] shrink-0" />
              <span className="text-[12px] font-semibold text-[var(--success,#10b981)]">GL Posted</span>
              <span className="text-[12px] text-[var(--text-muted)] ml-1">Ref:</span>
              <code className="text-[11px] font-mono text-[var(--text-primary)] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded">{record.document_ref}</code>
            </div>
          )}
          {record.status === 'GL Failed' && (() => {
            const errMsg = medicalGlError(record);
            return (
              <div className="space-y-2 px-3 py-2.5 rounded-[8px] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]">
                <div className="flex items-center gap-2">
                  <XCircle size={13} className="text-[var(--danger)] shrink-0" />
                  <span className="text-[12px] font-semibold text-[var(--danger)]">GL Posting Failed</span>
                </div>
                {errMsg && <p className="text-[11px] font-mono text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] px-2 py-1 rounded">{errMsg}</p>}
              </div>
            );
          })()}

          {(record.status === 'Rejected') && (
            <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Rejection Reason</p>
              <p className="text-[12px] text-red-700">{record.rejection_reason || 'No reason provided.'}</p>
            </div>
          )}

          {/* ── Approval flow progress ── */}
          {hasFlow && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                <ShieldCheck size={12} /> Approval flow
              </div>
              <div className="space-y-1.5">
                {stages.map((st: any) => {
                  const done = st.status === 'Approved';
                  const rejected = st.status === 'Rejected';
                  const isCurrent = !done && !rejected && currentStage?.id === st.id;
                  const color = rejected ? 'var(--danger)' : done ? 'var(--success)' : isCurrent ? 'var(--warning)' : 'var(--text-muted)';
                  return (
                    <div key={st.id} className="flex items-center gap-2 text-[12px]">
                      <span className="shrink-0" style={{ color }}>
                        {done ? <CheckCircle2 size={13} /> : rejected ? <XCircle size={13} /> : <Clock size={13} />}
                      </span>
                      <span className="font-medium text-[var(--text-primary)]">{st.stage_name}</span>
                      <span className="text-[var(--text-muted)]">
                        · {st.approver_type === 'user' ? '' : 'Role: '}{st.approver_label || st.approver_type}
                        {st.status !== 'Pending' && ` · ${st.status}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rejection reason input */}
          {rejecting && (
            <div className="space-y-1.5">
              <label className="label text-[var(--danger)]">Rejection Reason <span className="text-[var(--danger)]">*</span></label>
              <CountedTextarea
                className={`${inputClass} resize-none`}
                rows={3}
                maxChars={500}
                placeholder="Enter reason for rejection…"
                value={reason}
                onChange={e => setReason(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <AnimatePresence>
            {docPreview && (
              <DocPreviewModal
                url={`/v1/api/hr/documents/${attachment}`}
                filename={attachment}
                onClose={() => setDocPreview(false)}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)] shrink-0 flex flex-wrap gap-2">

          {/* ── Submit: any Draft record goes through the approval workflow ── */}
          {record.status === 'Draft' && canCreate && (
            <button disabled={acting} onClick={submitRecord}
              className="secondary-btn flex items-center gap-1.5 flex-1"
              style={{ borderColor: '#f59e0b', color: '#b45309' }}>
              <Send size={14} /> {acting ? 'Submitting…' : 'Submit for Approval'}
            </button>
          )}

          {/* ── Approve / Reject: admin, Pending Approval ── */}
          {adminMode && record.status === 'Pending Approval' && !rejecting && canProcess && (() => {
            const isSelf = currentUserId != null && record.posted_by != null
              && String(record.posted_by) === String(currentUserId);
            const selfOk = medicalSelfApproval || !isSelf;
            const stageOk = !hasFlow || isCurrentApprover; // multi-stage: only the current stage's approver
            const canAct = selfOk && stageOk;

            if (!canAct) {
              const who = hasFlow && currentStage
                ? (currentStage.approver_label || (currentStage.approver_type === 'user' ? 'the assigned approver' : 'the assigned role'))
                : 'a different approver';
              return (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium flex-1"
                  style={{ background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning)' }}>
                  <Clock size={13} className="shrink-0" />
                  {hasFlow && currentStage ? `Awaiting ${who} — "${currentStage.stage_name}"` : `Awaiting ${who}`}
                </div>
              );
            }
            return (
              <>
                <button disabled={acting} onClick={approveRecord}
                  className="success-btn flex items-center gap-1.5 flex-1">
                  <CheckCircle2 size={14} /> {acting ? 'Approving…' : 'Approve'}
                </button>
                <button disabled={acting} onClick={() => setRejecting(true)}
                  className="secondary-btn !text-[var(--danger)] flex items-center gap-1.5 flex-1">
                  <XCircle size={14} /> Reject
                </button>
              </>
            );
          })()}

          {/* ── Rejection reason input + confirm ── */}
          {rejecting && (
            <>
              <button disabled={acting} onClick={() => setRejecting(false)} className="secondary-btn">Back</button>
              <button disabled={acting || !reason.trim()} onClick={rejectRecord}
                className="primary-btn !bg-red-600 hover:!bg-red-700 flex items-center gap-1.5 flex-1">
                <XCircle size={14} /> {acting ? 'Rejecting…' : 'Confirm Reject'}
              </button>
            </>
          )}

          {/* ── Retry GL: admin, GL Failed ── */}
          {adminMode && record.status === 'GL Failed' && !rejecting && canProcess && (
            <button disabled={acting}
              onClick={() => callAction(`${base}/retry-gl`, {}, 'GL posted successfully')}
              className="secondary-btn flex items-center gap-1.5 flex-1">
              <RefreshCw size={13} className={acting ? 'animate-spin' : ''} />
              {acting ? 'Retrying…' : 'Retry GL Posting'}
            </button>
          )}

          {!rejecting && <button onClick={onClose} className="secondary-btn">Close</button>}
        </div>
      </motion.div>
    </div>
  );
}

// ── Staff Medical tab ─────────────────────────────────────────────────────────

function StaffMedicalTab({ adminMode, currentEmpId }: { adminMode?: boolean; currentEmpId?: string }) {
  const { can } = useCan();
  const currentUserId = getCurrentUser()?.id;
  // Admin actions need medical permissions. In personal mode a user can only act on
  // requests they originated themselves — admin-originated requests are view-only.
  const allowCreate  = !adminMode || can('create_medical');   // "Add Request" (own new request)
  const ownsRow   = (row: any) => String(row.posted_by ?? '') === String(currentUserId ?? '');
  const rowSubmit = (row: any) => adminMode ? can('create_medical') : ownsRow(row);
  const rowEdit   = (row: any) => adminMode ? can('edit_medical')   : ownsRow(row);
  const rowDelete = (row: any) => adminMode ? can('delete_medical') : ownsRow(row);
  const employees = useEmployees();
  const { limitCurrencyMap } = useLimitCurrencyMap();
  const appCurrency = getSettings().general.currency;
  const [rows, setRows]         = useState<any[]>([]);
  const [search, setSearch]     = useState('');
  const [open, setOpen]         = useState(false);
  const [saving, setSaving]     = useState(false);
  const [pending, setPending]   = useState<any>(null);
  const [sel, setSel]           = useState<any>(null);
  const [viewRec, setViewRec]   = useState<any>(null);
  const [limitOver, setLimitOver] = useState<{ over: number; cur: string } | null>(null);
  const blank = { employee: '', admission_date: '', discharged_date: '', admission_type: '', illness_type: '', medication: '', hospital: '', physician: '', cost: '', attachment1: '' };
  const [f, setF] = useState(blank);
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));

  // Derive currency from selected employee's paygrade limit, falling back to app currency
  const costCurrency = useMemo(() => {
    if (!f.employee) return appCurrency;
    const emp = employees.find(e => e.id === f.employee);
    return emp?.paygradId ? (limitCurrencyMap[emp.paygradId] ?? appCurrency) : appCurrency;
  }, [f.employee, employees, limitCurrencyMap, appCurrency]);

  function load() { api.get('/medical/staff').then(r => setRows(r.data.data ?? r.data ?? [])).catch(() => {}); }
  useEffect(load, []);

  function openAdd() { setSel(null); setF({ ...blank, ...(currentEmpId ? { employee: currentEmpId } : {}) }); setOpen(true); }
  function openEdit(row: any) {
    setSel(row);
    setF({
      ...blank,
      employee:       String(row.employee ?? ''),
      admission_date: row.admission_date?.slice(0, 10) ?? '',
      discharged_date:row.discharged_date?.slice(0, 10) ?? '',
      admission_type: row.admission_type ?? '',
      illness_type:   row.illness_type   ?? '',
      medication:     row.medication     ?? '',
      hospital:       row.hospital       ?? '',
      physician:      row.physician      ?? '',
      cost:           String(row.cost    ?? ''),
      attachment1:    row.attachment1    ?? '',
    });
    setOpen(true);
  }

  async function doSave() {
    setSaving(true);
    try {
      if (sel) await api.put(`/medical/staff/${sel.id}`, f); else await api.post('/medical/staff', f);
      toast.success(sel ? 'Record updated' : 'Record saved as draft');
      setOpen(false); load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleSave() {
    if (!f.employee || !f.admission_date || !f.discharged_date || !f.illness_type || !f.medication || !f.cost)
      return toast.error('Please fill all required fields');
    if (f.admission_date && f.discharged_date && new Date(f.discharged_date) < new Date(f.admission_date))
      return toast.error('Discharged date cannot be before admission date');
    if (f.admission_date && new Date(f.admission_date) > new Date())
      return toast.error('Admission date cannot be in the future');

    // Medical limit check
    try {
      const enq = (await api.get(`/medical/enquiry/${f.employee}`)).data.data;
      if (enq && enq.medical_limit !== null) {
        const oldApproved = sel?.status === 'Approved' ? parseFloat(String(sel.cost ?? 0)) : 0;
        const projected   = (enq.total_utilized ?? 0) - oldApproved + parseFloat(f.cost || '0');
        if (projected > enq.medical_limit) {
          if (!adminMode) {
            return toast.error('You have exceeded your medical limit. Please contact the HR department.');
          }
          setLimitOver({ over: projected - enq.medical_limit, cur: enq.currency || '' });
          return;
        }
      }
    } catch {}

    await doSave();
  }

  async function handleDelete() {
    if (!pending) return;
    try { await api.delete(`/medical/staff/${pending.id}`); toast.success('Deleted'); load(); } catch { toast.error('Failed'); }
    setPending(null);
  }

  const filtered = rows.filter(r =>
    (!currentEmpId || String(r.employee) === currentEmpId) &&
    (!search || (r.employee_name ?? '').toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <MedTable search={search} onSearch={setSearch} onAdd={allowCreate ? openAdd : undefined} addLabel="Add Request"
        headers={['Employee', 'Admission Date', 'Discharged Date', 'Illness Type', `Cost${appCurrency ? ` (${appCurrency})` : ''}`, 'Status', 'Actions']}
        rows={filtered} emptyColSpan={7} total={rows.length} filtered={filtered.length}
        renderRow={(row, i) => (
          <tr key={i} className="tr">
            <td className="td">{row.employee_name}</td>
            <td className="td">{row.admission_date?.slice(0, 10)}</td>
            <td className="td">{row.discharged_date?.slice(0, 10)}</td>
            <td className="td">{row.illness_type}</td>
            <td className="td">{parseFloat(String(row.cost ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            <td className="td"><StatusPill status={row.status} /></td>
            <td className="td text-right">
              <div className="inline-flex justify-end">
                <RowActions actions={[
                  { label: 'View Details', icon: Eye, onClick: () => setViewRec(row) },
                  {
                    label: 'Submit for Approval', icon: Send,
                    hidden: !(row.status === 'Draft' && rowSubmit(row)),
                    onClick: async () => {
                      try { await api.post(`/medical/staff/${row.id}/submit`, {}); toast.success('Submitted for approval'); load(); }
                      catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to submit'); }
                    },
                  },
                  { label: 'Edit', icon: Edit, onClick: () => openEdit(row), hidden: !(rowEdit(row) && (row.status === 'Draft' || row.status === 'Rejected')) },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPending(row), hidden: !(rowDelete(row) && row.status === 'Draft') },
                ]} />
              </div>
            </td>
          </tr>
        )}
      />

      <AnimatePresence>
        {open && (
          <FormModal title={sel ? 'Edit Staff Medical' : 'Add Staff Medical'} maxWidth="3xl" scrollable
            onClose={() => setOpen(false)}
            onSave={handleSave}
            saveLabel={saving ? 'Saving…' : 'Save'}>
            <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-lg bg-[var(--purple-dim)] border border-[var(--border)]">
              <span className="text-[11.5px] text-[var(--text-secondary)]">Have a receipt? Let AI read it and fill the fields.</span>
              <OcrScanButton onExtract={(x: OcrFields) => setF(p => ({
                ...p,
                ...(x.amount != null ? { cost: String(x.amount) } : {}),
                ...(x.date ? { admission_date: String(x.date) } : {}),
                ...(x.hospital ? { hospital: String(x.hospital) } : {}),
                ...(x.description && !p.illness_type ? { illness_type: String(x.description) } : {}),
              }))} />
            </div>
            <F label="Employee" required>
              <SearchSelect value={f.employee} onChange={v => set('employee', v)}
                options={employees} placeholder="Select employee…" disabled={!adminMode || !!currentEmpId} />
            </F>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <F label="Admission Date" required>
                <input type="date" className={inputClass} value={f.admission_date} onChange={e => set('admission_date', e.target.value)} />
              </F>
              <F label="Discharged Date" required>
                <input type="date" className={inputClass} value={f.discharged_date} onChange={e => set('discharged_date', e.target.value)} />
              </F>
              <F label="Admission Type">
                <select className={inputClass} value={f.admission_type} onChange={e => set('admission_type', e.target.value)}>
                  <option value="">Select</option>
                  {ADMISSION_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Illness Type" required>
                <input className={inputClass} value={f.illness_type} onChange={e => set('illness_type', e.target.value)} />
              </F>
              <F label="Medication" required>
                <input className={inputClass} value={f.medication} onChange={e => set('medication', e.target.value)} />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Hospital/Facility Name">
                <input className={inputClass} value={f.hospital} onChange={e => set('hospital', e.target.value)} placeholder="Enter hospital or facility name" />
              </F>
              <F label="Physician/Attendant">
                <input className={inputClass} value={f.physician} onChange={e => set('physician', e.target.value)} />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label={`Cost${costCurrency ? ` (${costCurrency})` : ''}`} required>
                <input type="number" min="0" step="0.01" className={inputClass} value={f.cost}
                  onChange={e => set('cost', e.target.value)}
                  onWheel={e => e.currentTarget.blur()} />
              </F>
              <F label="Attach Document">
                <DocUploadField value={f.attachment1} onChange={v => set('attachment1', v)} />
              </F>
            </div>
          </FormModal>
        )}
      </AnimatePresence>

      {pending && (
        <ConfirmAlert isOpen={!!pending} title="Delete record?" message={`Remove ${pending.employee_name ?? 'this record'}?`}
          onConfirm={handleDelete} onCancel={() => setPending(null)} />
      )}

      {limitOver && (
        <ConfirmAlert
          isOpen={true}
          title="Medical limit exceeded"
          message={`This employee has exceeded their medical limit by ${limitOver.cur} ${limitOver.over.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Proceed anyway?`}
          onConfirm={() => { setLimitOver(null); doSave(); }}
          onCancel={() => setLimitOver(null)}
        />
      )}

      <AnimatePresence>
        {viewRec && (
          <MedicalDetailPanel record={viewRec} type="staff" adminMode={!!adminMode}
            onClose={() => setViewRec(null)} onRefresh={load} />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Dependent Medical tab ─────────────────────────────────────────────────────

function DependentMedicalTab({ adminMode, currentEmpId }: { adminMode?: boolean; currentEmpId?: string }) {
  const { can } = useCan();
  const currentUserId = getCurrentUser()?.id;
  const allowCreate  = !adminMode || can('create_medical');
  const ownsRow   = (row: any) => String(row.posted_by ?? '') === String(currentUserId ?? '');
  const rowSubmit = (row: any) => adminMode ? can('create_medical') : ownsRow(row);
  const rowEdit   = (row: any) => adminMode ? can('edit_medical')   : ownsRow(row);
  const rowDelete = (row: any) => adminMode ? can('delete_medical') : ownsRow(row);
  const employees    = useEmployees();
  const allDependents = useAllDependents();
  const { limitCurrencyMap } = useLimitCurrencyMap();
  const appCurrency = getSettings().general.currency;
  const [rows, setRows]         = useState<any[]>([]);
  const [search, setSearch]     = useState('');
  const [open, setOpen]         = useState(false);
  const [saving, setSaving]     = useState(false);
  const [pending, setPending]   = useState<any>(null);
  const [sel, setSel]           = useState<any>(null);
  const [viewRec, setViewRec]   = useState<any>(null);
  const [limitOver, setLimitOver] = useState<{ over: number; cur: string } | null>(null);
  const blank = { employee: '', dependent_id: '', relationship: '', dob: '', date_attended: '', date_discharged: '', admission_type: '', illness_type: '', medication: '', hospital: '', physician: '', cost: '', attachment1: '' };
  const [f, setF] = useState(blank);
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));

  // Dependents for the selected employee (from the employee module)
  const empDependents = useMemo(() => {
    if (!f.employee) return [];
    return allDependents
      .filter((d: any) => String(d.employee?.id ?? d.employee) === f.employee)
      .map((d: any) => ({
        id:           String(d.id),
        label:        d.name,
        relationship: d.relationshipLabel ?? d.relationship ?? '',
        dob:          d.dob ? String(d.dob).slice(0, 10) : '',
      }));
  }, [allDependents, f.employee]);

  // Auto-fill relationship & DOB when dependent is selected
  function selectDependent(depId: string) {
    const dep = empDependents.find(d => d.id === depId);
    setF(p => ({
      ...p,
      dependent_id: depId,
      relationship: dep?.relationship ?? p.relationship,
      dob:          dep?.dob          ?? p.dob,
    }));
  }

  // Derive cost currency from employee's paygrade medical limit, falling back to app currency
  const costCurrency = useMemo(() => {
    if (!f.employee) return appCurrency;
    const emp = employees.find(e => e.id === f.employee);
    return emp?.paygradId ? (limitCurrencyMap[emp.paygradId] ?? appCurrency) : appCurrency;
  }, [f.employee, employees, limitCurrencyMap, appCurrency]);

  function load() { api.get('/medical/dependents-requests').then(r => setRows(r.data.data ?? r.data ?? [])).catch(() => {}); }
  useEffect(load, []);

  function openAdd() { setSel(null); setF({ ...blank, ...(currentEmpId ? { employee: currentEmpId } : {}) }); setOpen(true); }
  function openEdit(row: any) {
    setSel(row);
    setF({
      ...blank,
      employee:       String(row.employee     ?? ''),
      dependent_id:   String(row.dependent_id ?? ''),
      relationship:   row.relationship        ?? row.relation_to_dependent ?? '',
      dob:            row.dob                 ? String(row.dob).slice(0, 10) : '',
      date_attended:  row.date_attended       ? String(row.date_attended).slice(0, 10) : '',
      date_discharged:row.date_discharged     ? String(row.date_discharged).slice(0, 10) : '',
      admission_type: row.admission_type      ?? '',
      illness_type:   row.illness_type        ?? '',
      medication:     row.medication          ?? '',
      hospital:       row.hospital            ?? '',
      physician:      row.physician           ?? '',
      cost:           String(row.cost         ?? ''),
      attachment1:    row.attachment1         ?? '',
    });
    setOpen(true);
  }

  async function doSave() {
    setSaving(true);
    try {
      if (sel) await api.put(`/medical/dependents-requests/${sel.id}`, f); else await api.post('/medical/dependents-requests', f);
      toast.success(sel ? 'Record updated' : 'Record saved as draft');
      setOpen(false); load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleSave() {
    if (!f.employee || !f.dependent_id || !f.date_attended || !f.date_discharged || !f.illness_type || !f.medication || !f.cost)
      return toast.error('Please fill all required fields');
    if (f.date_attended && f.date_discharged && new Date(f.date_discharged) < new Date(f.date_attended))
      return toast.error('Discharged date cannot be before date attended');
    if (f.date_attended && new Date(f.date_attended) > new Date())
      return toast.error('Date attended cannot be in the future');

    // Medical limit check
    try {
      const enq = (await api.get(`/medical/enquiry/${f.employee}`)).data.data;
      if (enq && enq.medical_limit !== null) {
        const oldApproved = sel?.status === 'Approved' ? parseFloat(String(sel.cost ?? 0)) : 0;
        const projected   = (enq.total_utilized ?? 0) - oldApproved + parseFloat(f.cost || '0');
        if (projected > enq.medical_limit) {
          if (!adminMode) {
            return toast.error('You have exceeded your medical limit. Please contact the HR department.');
          }
          setLimitOver({ over: projected - enq.medical_limit, cur: enq.currency || '' });
          return;
        }
      }
    } catch {}

    await doSave();
  }

  async function handleDelete() {
    if (!pending) return;
    try { await api.delete(`/medical/dependents-requests/${pending.id}`); toast.success('Deleted'); load(); } catch { toast.error('Failed'); }
    setPending(null);
  }

  const filtered = rows.filter(r =>
    (!currentEmpId || String(r.employee) === currentEmpId) &&
    (!search || (r.employee_name ?? '').toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <MedTable search={search} onSearch={setSearch} onAdd={allowCreate ? openAdd : undefined} addLabel="Add Request"
        headers={['Employee', 'Dependent', 'Relationship', 'Date Attended', 'Illness Type', `Cost${appCurrency ? ` (${appCurrency})` : ''}`, 'Status', 'Actions']}
        rows={filtered} emptyColSpan={8} total={rows.length} filtered={filtered.length}
        renderRow={(row, i) => (
          <tr key={i} className="tr">
            <td className="td">{row.employee_name}</td>
            <td className="td">{row.dependent_name}</td>
            <td className="td">{row.relationship}</td>
            <td className="td">{row.date_attended?.slice(0, 10)}</td>
            <td className="td">{row.illness_type}</td>
            <td className="td">{parseFloat(String(row.cost ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            <td className="td"><StatusPill status={row.status} /></td>
            <td className="td text-right">
              <div className="inline-flex justify-end">
                <RowActions actions={[
                  { label: 'View Details', icon: Eye, onClick: () => setViewRec(row) },
                  {
                    label: 'Submit for Approval', icon: Send,
                    hidden: !(row.status === 'Draft' && rowSubmit(row)),
                    onClick: async () => {
                      try { await api.post(`/medical/dependents-requests/${row.id}/submit`, {}); toast.success('Submitted for approval'); load(); }
                      catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to submit'); }
                    },
                  },
                  { label: 'Edit', icon: Edit, onClick: () => openEdit(row), hidden: !(rowEdit(row) && (row.status === 'Draft' || row.status === 'Rejected')) },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPending(row), hidden: !(rowDelete(row) && row.status === 'Draft') },
                ]} />
              </div>
            </td>
          </tr>
        )}
      />

      <AnimatePresence>
        {open && (
          <FormModal title={sel ? 'Edit Dependent Medical' : 'Add Dependent Medical'} maxWidth="3xl" scrollable
            onClose={() => setOpen(false)}
            onSave={handleSave}
            saveLabel={saving ? 'Saving…' : 'Save'}>
            <div className="grid grid-cols-2 gap-4">
              <F label="Employee Name" required>
                <SearchSelect value={f.employee}
                  onChange={v => setF(_p => ({ ...blank, employee: v }))}
                  options={employees} placeholder="Select employee…" disabled={!adminMode || !!currentEmpId} />
              </F>
              <F label="Dependent Name" required>
                <SearchSelect value={f.dependent_id} onChange={selectDependent}
                  options={empDependents}
                  placeholder={!f.employee ? 'Select employee first…' : empDependents.length === 0 ? 'No dependents registered' : 'Select dependent…'}
                  disabled={!f.employee || empDependents.length === 0}
                />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Relationship">
                <input className={`${inputClass} bg-[var(--surface-hover)] opacity-70 cursor-not-allowed`}
                  value={f.relationship} readOnly placeholder="Auto-filled when dependent is selected" />
              </F>
              <F label="Date of Birth">
                <input type="date" className={`${inputClass} bg-[var(--surface-hover)] opacity-70 cursor-not-allowed`}
                  value={f.dob} readOnly />
              </F>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <F label="Date Attended" required>
                <input type="date" className={inputClass} value={f.date_attended} onChange={e => set('date_attended', e.target.value)} />
              </F>
              <F label="Date Discharged" required>
                <input type="date" className={inputClass} value={f.date_discharged} onChange={e => set('date_discharged', e.target.value)} />
              </F>
              <F label="Admission Type">
                <select className={inputClass} value={f.admission_type} onChange={e => set('admission_type', e.target.value)}>
                  <option value="">Select</option>
                  {ADMISSION_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Illness Type" required>
                <input className={inputClass} value={f.illness_type} onChange={e => set('illness_type', e.target.value)} />
              </F>
              <F label="Medication" required>
                <input className={inputClass} value={f.medication} onChange={e => set('medication', e.target.value)} />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Hospital/Facility Name">
                <input className={inputClass} value={f.hospital} onChange={e => set('hospital', e.target.value)} placeholder="Enter hospital or facility name" />
              </F>
              <F label="Physician/Attendant">
                <input className={inputClass} value={f.physician} onChange={e => set('physician', e.target.value)} />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label={`Cost${costCurrency ? ` (${costCurrency})` : ''}`} required>
                <input type="number" min="0" step="0.01" className={inputClass} value={f.cost}
                  onChange={e => set('cost', e.target.value)}
                  onWheel={e => e.currentTarget.blur()} />
              </F>
              <F label="Attach Document">
                <DocUploadField value={f.attachment1} onChange={v => set('attachment1', v)} />
              </F>
            </div>
          </FormModal>
        )}
      </AnimatePresence>

      {pending && (
        <ConfirmAlert isOpen={!!pending} title="Delete record?" message={`Remove ${pending.employee_name ?? 'this record'}?`}
          onConfirm={handleDelete} onCancel={() => setPending(null)} />
      )}

      {limitOver && (
        <ConfirmAlert
          isOpen={true}
          title="Medical limit exceeded"
          message={`This employee has exceeded their medical limit by ${limitOver.cur} ${limitOver.over.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Proceed anyway?`}
          onConfirm={() => { setLimitOver(null); doSave(); }}
          onCancel={() => setLimitOver(null)}
        />
      )}

      <AnimatePresence>
        {viewRec && (
          <MedicalDetailPanel record={viewRec} type="dependent" adminMode={!!adminMode}
            onClose={() => setViewRec(null)} onRefresh={load} />
        )}
      </AnimatePresence>
    </>
  );
}

// ── Medical Limits Setup tab ──────────────────────────────────────────────────

function MedicalLimitsTab() {
  const { can } = useCan();
  const canManage = can('manage_medical_limits');
  const grades     = usePayGrades();
  const currencies = useCurrencies();
  const { reloadLimitMap } = useLimitCurrencyMap();
  const appCurrency = getSettings().general.currency;
  const [rows, setRows]       = useState<any[]>([]);
  const [search, setSearch]   = useState('');
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [pending, setPending] = useState<any>(null);
  const [sel, setSel]         = useState<any>(null);
  const blank = { paygrade: '', currency: '', amount: '' };
  const [f, setF] = useState(blank);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  // Default currency to app currency (or first option) when list loads
  useEffect(() => {
    if (currencies.length > 0 && !f.currency) {
      const match = currencies.find(c => c.code === appCurrency);
      setF(p => ({ ...p, currency: match?.code ?? currencies[0].code }));
    }
  }, [currencies]);

  function load() { api.get('/medical/limits').then(r => setRows(r.data.data ?? r.data ?? [])).catch(() => {}); }
  useEffect(load, []);

  function openAdd() {
    const match = currencies.find(c => c.code === appCurrency);
    setSel(null);
    setF({ ...blank, currency: match?.code ?? currencies[0]?.code ?? appCurrency });
    setOpen(true);
  }
  function openEdit(row: any) { setSel(row); setF({ paygrade: String(row.paygrade_id ?? row.paygrade ?? ''), currency: row.currency || '', amount: String(row.amount) }); setOpen(true); }

  async function handleSave() {
    if (!f.paygrade || !f.currency || !f.amount) return toast.error('All fields are required');
    setSaving(true);
    try {
      if (sel) await api.put(`/medical/limits/${sel.id}`, f); else await api.post('/medical/limits', f);
      toast.success(sel ? 'Limit updated' : 'Limit saved');
      setOpen(false); load(); reloadLimitMap();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!pending) return;
    try { await api.delete(`/medical/limits/${pending.id}`); toast.success('Deleted'); load(); reloadLimitMap(); } catch { toast.error('Failed'); }
    setPending(null);
  }

  const filtered = rows.filter(r => !search || (r.grade_name ?? '').toLowerCase().includes(search.toLowerCase()));

  // A pay grade (band) that already has a limit shouldn't appear again when adding a new one.
  // When editing, keep the row's own grade selectable.
  const gradeOptions = useMemo(() => {
    const used = new Set(rows.map(r => String(r.paygrade_id ?? r.paygrade ?? '')));
    const currentId = sel ? String(sel.paygrade_id ?? sel.paygrade ?? '') : null;
    return grades.filter(g => !used.has(String(g.id)) || String(g.id) === currentId);
  }, [grades, rows, sel]);

  return (
    <>
      <MedTable search={search} onSearch={setSearch} onAdd={canManage ? openAdd : undefined} addLabel="Add Limit"
        headers={['Pay Grade', 'Currency', 'Limit Amount', 'Actions']}
        rows={filtered} emptyColSpan={4} total={rows.length} filtered={filtered.length}
        renderRow={(row, i) => (
          <tr key={i} className="tr">
            <td className="td">{row.grade_name ?? row.paygrade}</td>
            <td className="td">{row.currency}</td>
            <td className="td">{parseFloat(String(row.amount ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            <td className="td text-right">
              <div className="flex justify-end">
                <RowActions actions={[
                  { label: 'Edit', icon: Edit, onClick: () => openEdit(row), hidden: !canManage },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPending(row), hidden: !canManage },
                ]} />
              </div>
            </td>
          </tr>
        )}
      />

      <AnimatePresence>
        {open && (
          <FormModal title={sel ? 'Edit Medical Limit' : 'Add Medical Limit'} maxWidth="md"
            onClose={() => setOpen(false)} onSave={handleSave} saveLabel={saving ? 'Saving…' : 'Save'}>
            <F label="Pay Grade" required>
              <SearchSelect value={f.paygrade} onChange={v => set('paygrade', v)} options={gradeOptions} placeholder="Select pay grade…" />
            </F>
            <F label="Currency" required>
              <select className={inputClass} value={f.currency} onChange={e => set('currency', e.target.value)}>
                <option value="">Select currency…</option>
                {currencies.map(c => <option key={c.id} value={c.code}>{c.label}</option>)}
              </select>
            </F>
            <F label="Limit Amount" required>
              <input type="number" min="0" step="0.01" className={inputClass} value={f.amount}
                onChange={e => set('amount', e.target.value)} placeholder="0.00"
                onWheel={e => e.currentTarget.blur()} />
            </F>
          </FormModal>
        )}
      </AnimatePresence>

      {pending && (
        <ConfirmAlert isOpen={!!pending} title="Delete limit?" message={`Remove limit for ${pending.grade_name ?? 'this grade'}?`}
          onConfirm={handleDelete} onCancel={() => setPending(null)} />
      )}
    </>
  );
}

// ── Utilisation progress bar ──────────────────────────────────────────────────

function UtilBar({ used, limit }: { used: number; limit: number | null }) {
  if (!limit || limit <= 0) return <span className="text-[var(--text-muted)] text-[11px]">—</span>;
  const p     = Math.round((used / limit) * 100);
  const color = p >= 100 ? 'var(--danger)' : p >= 80 ? '#f59e0b' : 'var(--success)';
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(p, 100)}%`, background: color }} />
      </div>
      <span className="text-[11px] font-semibold" style={{ color }}>{p}%</span>
    </div>
  );
}

// ── Medical Enquiry Detail slide-over ─────────────────────────────────────────

function MedicalEnquiryDetail({ row, onClose }: { row: any; onClose: () => void }) {
  const [detail, setDetail]   = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const appCurrency = getSettings().general.currency;

  useEffect(() => {
    setLoading(true);
    api.get(`/medical/enquiry/${row.employee_id}`)
      .then(r => setDetail(r.data.data ?? null))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [row.employee_id]);

  const currency = row.currency || appCurrency;
  const fmt = (n: number) =>
    `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const limit    = row.medical_limit as number | null;
  const used     = (row.total_utilized ?? 0) as number;
  const balColor = (row.limit_balance ?? 0) < 0 ? 'var(--danger)' : 'var(--success)';
  const toStr    = (v: any) => (v ? String(v).slice(0, 10) : '—');

  return (
    <div className="fixed inset-0 z-[110] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative z-10 w-full max-w-2xl bg-[var(--surface)] shadow-2xl flex flex-col h-full border-l border-[var(--border)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)] syne">{row.employee_name}</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {row.employee_empid ? `ID: ${row.employee_empid} · ` : ''}{row.grade}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--bg)] rounded-full text-[var(--text-muted)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Summary strip */}
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-[var(--border)] shrink-0">
          {[
            { label: 'Limit',      value: limit !== null ? fmt(limit) : '—',                     color: undefined },
            { label: 'Staff Used', value: fmt(row.staff_utilized ?? 0),                           color: undefined },
            { label: 'Dep Used',   value: fmt(row.dep_utilized   ?? 0),                           color: undefined },
            { label: 'Balance',    value: row.limit_balance !== null ? fmt(row.limit_balance) : '—', color: balColor },
          ].map(c => (
            <div key={c.label} className="text-center">
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">{c.label}</p>
              <p className="text-[13px] font-bold" style={{ color: c.color ?? 'var(--text-primary)' }}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Utilisation bar */}
        <div className="px-5 py-3 border-b border-[var(--border)] shrink-0 flex items-center gap-3">
          <p className="text-[11px] font-semibold text-[var(--text-muted)] shrink-0">Utilisation</p>
          <UtilBar used={used} limit={limit} />
        </div>

        {/* Records */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-[13px] text-[var(--text-muted)]">Loading records…</div>
          ) : (
            <>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
                  <p className="text-[10px] font-bold syne uppercase tracking-widest text-[var(--text-primary)]">Staff Medical Records</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead><tr>
                      <th className="th">Date</th><th className="th">Hospital</th>
                      <th className="th">Illness</th><th className="th !text-right">Cost</th><th className="th">Status</th>
                    </tr></thead>
                    <tbody>
                      {(detail?.staff_records ?? []).length === 0
                        ? <tr><td colSpan={5} className="td text-center py-5 text-[var(--text-muted)] text-[12px]">No approved staff records</td></tr>
                        : (detail?.staff_records ?? []).map((r: any, i: number) => (
                          <tr key={i} className="tr">
                            <td className="td">{toStr(r.admission_date)}</td>
                            <td className="td">{r.hospital || '—'}</td>
                            <td className="td">{r.illness_type || '—'}</td>
                            <td className="td text-right font-medium">{fmt(parseFloat(String(r.cost ?? 0)))}</td>
                            <td className="td"><StatusPill status={r.status} /></td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[12px] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
                  <p className="text-[10px] font-bold syne uppercase tracking-widest text-[var(--text-primary)]">Dependent Medical Records</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead><tr>
                      <th className="th">Dependent</th><th className="th">Date</th>
                      <th className="th">Hospital</th><th className="th">Illness</th>
                      <th className="th !text-right">Cost</th><th className="th">Status</th>
                    </tr></thead>
                    <tbody>
                      {(detail?.dependent_records ?? []).length === 0
                        ? <tr><td colSpan={6} className="td text-center py-5 text-[var(--text-muted)] text-[12px]">No approved dependent records</td></tr>
                        : (detail?.dependent_records ?? []).map((r: any, i: number) => (
                          <tr key={i} className="tr">
                            <td className="td">{r.dependent_name || '—'}</td>
                            <td className="td">{toStr(r.date_attended)}</td>
                            <td className="td">{r.hospital || '—'}</td>
                            <td className="td">{r.illness_type || '—'}</td>
                            <td className="td text-right font-medium">{fmt(parseFloat(String(r.cost ?? 0)))}</td>
                            <td className="td"><StatusPill status={r.status} /></td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Staff Medical Enquiry tab ─────────────────────────────────────────────────

function StaffMedicalEnquiryTab() {
  const { can } = useCan();
  const canReset = can('reset_medical_utilization');
  const [rows, setRows]         = useState<any[]>([]);
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detail, setDetail]     = useState<any | null>(null);
  const [resetOpen, setResetOpen]     = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const appCurrency = getSettings().general.currency;

  const loadRows = () => { api.get('/medical/enquiry').then(r => setRows(r.data.data ?? r.data ?? [])).catch(() => {}); };
  useEffect(() => { loadRows(); }, []);

  const filtered = rows.filter(r => !search || (r.employee_name ?? '').toLowerCase().includes(search.toLowerCase()));
  useEffect(() => { setPage(1); }, [search]);
  const paged: any[] = filtered.slice((page - 1) * pageSize, page * pageSize);

  const fmt = (n: number, c: string) => {
    const cur = c || appCurrency;
    return `${cur ? cur + ' ' : ''}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const enqHeaders = ['Employee', 'ID', 'Pay Grade', 'Limit', 'Staff Used', 'Dependent Used', 'Total Used', 'Balance', 'Utilisation %'];
  const enqRow = (r: any) => {
    const pct = r.medical_limit ? Math.round(((r.total_utilized ?? 0) / r.medical_limit) * 100) : null;
    return [
      r.employee_name ?? '',
      r.employee_empid ?? '',
      r.grade ?? '',
      r.medical_limit !== null ? fmt(r.medical_limit, r.currency) : '—',
      fmt(r.staff_utilized ?? 0, r.currency),
      fmt(r.dep_utilized ?? 0, r.currency),
      fmt(r.total_utilized ?? 0, r.currency),
      r.limit_balance !== null ? fmt(r.limit_balance, r.currency) : '—',
      pct !== null ? `${pct}%` : '—',
    ];
  };

  const rowBg = (row: any) => {
    if (!row.medical_limit || row.medical_limit <= 0) return '';
    const p = Math.round(((row.total_utilized ?? 0) / row.medical_limit) * 100);
    if (p >= 100) return 'bg-[color-mix(in_srgb,var(--danger)_6%,transparent)]';
    if (p >= 80)  return 'bg-[color-mix(in_srgb,var(--warning)_6%,transparent)]';
    return '';
  };

  const exportEnquiry = () => {
    if (!filtered.length) { toast.error('Nothing to export'); return; }
    const ws = XLSX.utils.aoa_to_sheet([enqHeaders, ...filtered.map(enqRow)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Medical Enquiry');
    XLSX.writeFile(wb, `staff_medical_enquiry_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
        <TableToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search employees…"
          actions={
            <>
              <button className="secondary-btn shrink-0" onClick={() => setHistoryOpen(true)}>
                <Clock size={14} className="inline mr-1.5" />History
              </button>
              <button className="secondary-btn shrink-0" onClick={exportEnquiry}>
                <Download size={14} className="inline mr-1.5" />Export
              </button>
              {canReset && (
                <button className="primary-btn shrink-0" onClick={() => setResetOpen(true)}>
                  <Calendar size={14} className="inline mr-1.5" />Start New Medical Year
                </button>
              )}
            </>
          }
        />
        <div className="overflow-x-auto flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th">Employee</th>
                <th className="th">Pay Grade</th>
                <th className="th !text-right">Limit</th>
                <th className="th !text-right">Staff Used</th>
                <th className="th !text-right">Dependent Used</th>
                <th className="th !text-right">Total Used</th>
                <th className="th !text-right">Balance</th>
                <th className="th">Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {paged.length > 0 ? paged.map((row, i) => (
                <tr key={i} className={`tr cursor-pointer ${rowBg(row)}`} onClick={() => setDetail(row)}>
                  <td className="td">
                    <p className="font-semibold text-[var(--text-primary)] text-[13px]">{row.employee_name}</p>
                    {row.employee_empid && <p className="text-[11px] text-[var(--text-muted)]">{row.employee_empid}</p>}
                  </td>
                  <td className="td">{row.grade}</td>
                  <td className="td text-right">{row.medical_limit !== null ? fmt(row.medical_limit, row.currency) : '—'}</td>
                  <td className="td text-right">{fmt(row.staff_utilized ?? 0, row.currency)}</td>
                  <td className="td text-right">{fmt(row.dep_utilized   ?? 0, row.currency)}</td>
                  <td className="td text-right font-semibold">{fmt(row.total_utilized ?? 0, row.currency)}</td>
                  <td className="td text-right font-semibold" style={{
                    color: (row.limit_balance ?? 0) < 0 ? 'var(--danger)' : 'var(--success)',
                  }}>
                    {row.limit_balance !== null ? fmt(row.limit_balance, row.currency) : '—'}
                  </td>
                  <td className="td"><UtilBar used={row.total_utilized ?? 0} limit={row.medical_limit} /></td>
                </tr>
              )) : <EmptyTable cols={8} />}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={rows.length} filtered={filtered.length}
          page={page} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      </motion.div>

      <AnimatePresence>
        {detail && <MedicalEnquiryDetail row={detail} onClose={() => setDetail(null)} />}
      </AnimatePresence>

      {resetOpen && (
        <ResetMedicalYearModal
          employeeCount={rows.length}
          onClose={() => setResetOpen(false)}
          onDone={() => { setResetOpen(false); loadRows(); }}
        />
      )}
      {historyOpen && <UtilizationHistoryModal onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

// ── Start New Medical Year (utilization reset) ────────────────────────────────

function ResetMedicalYearModal({ employeeCount, onClose, onDone }: {
  employeeCount: number; onClose: () => void; onDone: () => void;
}) {
  const [periodLabel, setPeriodLabel] = useState(String(new Date().getFullYear()));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const label = periodLabel.trim();
    if (!label) { toast.error('Enter a year label for the closing snapshot'); return; }
    setSaving(true);
    try {
      const res = await api.post('/medical/utilization/reset', { period_label: label });
      toast.success(res.data?.message || 'New medical year started');
      onDone();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Reset failed');
    } finally { setSaving(false); }
  };

  return (
    <FormModal title="Start New Medical Year" onClose={onClose} onSave={submit}
      saveLabel={saving ? 'Resetting…' : 'Reset Utilization'} maxWidth="md">
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
          This resets <b>every employee's</b> medical utilization back to 0 for a fresh year.
          The current year's totals are first saved to history, and per-grade medical limits are
          left unchanged. Existing medical records, costs and GL postings are <b>not</b> deleted —
          they simply stop counting toward the new year.
        </p>
        <div className="rounded-[10px] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] border border-[var(--border)] px-3 py-2.5 text-[12px] text-[var(--text-secondary)]">
          A closing snapshot will be saved for <b>{employeeCount}</b> employee(s).
        </div>
        <div>
          <label className="label">Closing Year Label</label>
          <input className={inputClass} value={periodLabel} onChange={e => setPeriodLabel(e.target.value)}
            placeholder="e.g. 2025" />
          <p className="text-[11px] text-[var(--text-muted)] mt-1">
            Labels the saved snapshot (the year you are closing). Must be unique.
          </p>
        </div>
      </div>
    </FormModal>
  );
}

// ── Utilization history (past closed years) ───────────────────────────────────

function UtilizationHistoryModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows]       = useState<any[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [period, setPeriod]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/medical/utilization/history').then(r => {
      const data = r.data.data ?? r.data ?? [];
      setRows(data);
      setPeriods([...new Set(data.map((x: any) => String(x.period_label)))] as string[]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = period ? rows.filter(r => String(r.period_label) === period) : rows;

  return (
    <div className="fixed inset-0 z-[110] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative z-10 w-full max-w-3xl bg-[var(--surface)] shadow-2xl flex flex-col h-full border-l border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)] syne">Medical Utilization History</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Closing snapshots from past medical years</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--bg)] rounded-full text-[var(--text-muted)] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[var(--border)] shrink-0">
          <div className="w-full sm:w-64">
            <SearchSelect
              value={period}
              onChange={setPeriod}
              options={[{ id: '', label: 'All years' }, ...periods.map(p => ({ id: p, label: p }))]}
              placeholder="Filter by year…"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse min-w-[640px]">
            <thead className="sticky top-0 bg-[var(--surface)] z-10">
              <tr>
                <th className="th">Year</th>
                <th className="th">Employee</th>
                <th className="th">Pay Grade</th>
                <th className="th !text-right">Limit</th>
                <th className="th !text-right">Total Used</th>
                <th className="th !text-right">Balance</th>
                <th className="th">Closed</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="td text-center text-[var(--text-muted)] py-6" colSpan={7}>Loading…</td></tr>
              ) : filtered.length ? filtered.map((r, i) => (
                <tr key={i} className="tr">
                  <td className="td font-semibold">{r.period_label}</td>
                  <td className="td">
                    <p className="font-medium text-[var(--text-primary)] text-[13px]">{r.employee_name}</p>
                  </td>
                  <td className="td">{r.grade ?? '—'}</td>
                  <td className="td text-right">{r.medical_limit != null ? histMoney(r.medical_limit, r.currency) : '—'}</td>
                  <td className="td text-right font-semibold">{histMoney(r.total_utilized ?? 0, r.currency)}</td>
                  <td className="td text-right">{r.limit_balance != null ? histMoney(r.limit_balance, r.currency) : '—'}</td>
                  <td className="td text-[12px] text-[var(--text-muted)]">
                    {r.closed_at ? String(r.closed_at).slice(0, 10) : '—'}
                  </td>
                </tr>
              )) : (
                <tr><td className="td text-center text-[var(--text-muted)] py-6" colSpan={7}>No closed years yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

// Money formatter for history rows — uses the snapshot's own currency, falling back to the default.
function histMoney(amount: any, currency?: string): string {
  const n = parseFloat(String(amount ?? 0));
  const v = Number.isFinite(n) ? n : 0;
  const cur = currency || currencyCode();
  return `${cur ? cur + ' ' : ''}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Registered Hospitals tab ──────────────────────────────────────────────────

function RegisteredHospitalsTab() {
  const { can } = useCan();
  const canManage = can('manage_hospitals');
  const [rows, setRows]       = useState<any[]>([]);
  const [search, setSearch]   = useState('');
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [pending, setPending] = useState<any>(null);
  const [sel, setSel]         = useState<any>(null);
  const blank = { name: '', account: '', type: 'Hospital' };
  const [f, setF] = useState(blank);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  function load() { api.get('/medical/hospitals').then(r => setRows(r.data.data ?? r.data ?? [])).catch(() => {}); }
  useEffect(load, []);

  function openAdd() { setSel(null); setF(blank); setOpen(true); }
  function openEdit(row: any) { setSel(row); setF({ name: row.name, account: row.account, type: row.type ?? 'Hospital' }); setOpen(true); }

  async function handleSave() {
    if (!f.name || !f.account) return toast.error('Name and Account are required');
    setSaving(true);
    try {
      if (sel) await api.put(`/medical/hospitals/${sel.id}`, f); else await api.post('/medical/hospitals', f);
      toast.success(sel ? 'Hospital updated' : 'Hospital registered');
      setOpen(false); load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!pending) return;
    try { await api.delete(`/medical/hospitals/${pending.id}`); toast.success('Removed'); load(); } catch { toast.error('Failed'); }
    setPending(null);
  }

  const filtered = rows.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <MedTable search={search} onSearch={setSearch} onAdd={canManage ? openAdd : undefined} addLabel="Register Hospital"
        headers={['Name', 'Type', 'Account', 'Actions']}
        rows={filtered} emptyColSpan={4} total={rows.length} filtered={filtered.length}
        renderRow={(row, i) => (
          <tr key={i} className="tr">
            <td className="td">{row.name}</td>
            <td className="td">
              <span className={`pill ${row.type === 'Pharmacy' ? 'pill-accent' : 'pill-neutral'}`}>{row.type ?? 'Hospital'}</span>
            </td>
            <td className="td">{row.account}</td>
            <td className="td text-right">
              <div className="flex justify-end">
                <RowActions actions={[
                  { label: 'Edit', icon: Edit, onClick: () => openEdit(row), hidden: !canManage },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPending(row), hidden: !canManage },
                ]} />
              </div>
            </td>
          </tr>
        )}
      />

      <AnimatePresence>
        {open && (
          <FormModal title={sel ? 'Edit Hospital' : 'Register Hospital'} maxWidth="md"
            onClose={() => setOpen(false)} onSave={handleSave} saveLabel={saving ? 'Saving…' : 'Save'}>
            <F label="Name" required><input className={inputClass} value={f.name} onChange={e => set('name', e.target.value)} /></F>
            <F label="Type" required>
              <select className={inputClass} value={f.type} onChange={e => set('type', e.target.value)}>
                <option value="Hospital">Hospital</option>
                <option value="Pharmacy">Pharmacy</option>
              </select>
            </F>
            <F label="Account" required><input className={inputClass} value={f.account} onChange={e => set('account', e.target.value)} /></F>
          </FormModal>
        )}
      </AnimatePresence>

      {pending && (
        <ConfirmAlert isOpen={!!pending} title="Remove hospital?" message={`Remove "${pending.name}"?`}
          onConfirm={handleDelete} onCancel={() => setPending(null)} />
      )}
    </>
  );
}

// ── Hospital Claim detail slide-over ─────────────────────────────────────────

function HospitalClaimDetailPanel({ row: initialRow, onClose, onRefresh }: { row: any; onClose: () => void; onRefresh: () => void }) {
  const { can } = useCan();
  const canApprove = can('approve_medical');
  const [row, setRow]             = useState(initialRow);
  const [acting, setActing]     = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]     = useState('');
  const appCurrency = getSettings().general.currency;
  const medicalSelfApproval = getSettings().approvals.medicalSelfApproval;
  const currentUserId = getCurrentUser()?.id;
  useEffect(() => { setRow(initialRow); }, [initialRow]);
  // Self-approval guard: the originator can only approve their own claim when self-approval is on.
  const isSelf = currentUserId != null && row.posted_by != null
    && String(row.posted_by) === String(currentUserId);
  const canSelfAct = medicalSelfApproval || !isSelf;

  const fmtN = (n: any) => parseFloat(String(n ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const items: any[] = Array.isArray(row.items) ? row.items : [];

  async function callAction(url: string, body: object, msg: string) {
    setActing(true);
    try {
      const response = await api.post(url, body);
      const updated = response.data?.data;
      if (updated) setRow((current: any) => ({ ...current, ...updated }));
      onRefresh();
      if (updated?.status === 'GL Failed') {
        const glError = medicalGlError(updated);
        toast.error(
          `Medical claim approved, but GL posting failed${glError ? ': ' + glError : ''}. Use Retry GL Posting below.`,
          { duration: 8000 },
        );
        return;
      }
      if (url.endsWith('/retry-gl') && updated?.document_ref) {
        toast.success(`GL posted — Ref: ${updated.document_ref}`, { duration: 6000 });
      } else {
        toast.success(response.data?.message || msg);
        if (updated?.document_ref && url.endsWith('/approve')) {
          toast.success(`GL posted — Ref: ${updated.document_ref}`, { duration: 6000 });
        }
      }
      onClose();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Action failed'); }
    finally { setActing(false); }
  }

  return (
    <div className="fixed inset-0 z-[110] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="relative z-10 w-full max-w-lg bg-[var(--surface)] shadow-2xl flex flex-col h-full border-l border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)] syne">Hospital Claim</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Claim #{row.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={claimPillClass(row.status)}>{row.status}</span>
            <button onClick={onClose} className="p-1.5 hover:bg-[var(--bg)] rounded-full text-[var(--text-muted)] transition-colors"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <DetailRow label="Hospital">{row.hospital_name}</DetailRow>
            <DetailRow label="Type">{row.hospital_type ?? '—'}</DetailRow>
          </div>
          {row.date && <DetailRow label="Date">{row.date}</DetailRow>}

          {items.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Claim Items</p>
              <div className="overflow-x-auto rounded-[8px] border border-[var(--border)]">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr>
                      <th className="th text-[11px]">Employee</th>
                      <th className="th text-[11px]">For</th>
                      <th className="th text-[11px]">Narration</th>
                      <th className="th text-[11px] !text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any, i: number) => (
                      <tr key={i} className="tr">
                        <td className="td">{item.employee_name}</td>
                        <td className="td">{item.type === 'dependent' ? `Dep: ${item.dependent_name}` : 'Self'}</td>
                        <td className="td text-[var(--text-muted)]">{item.narration || '—'}</td>
                        <td className="td text-right">{parseFloat(String(item.amount ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {row.comment && <DetailRow label="Comment">{row.comment}</DetailRow>}

          <div className="rounded-[10px] border border-[var(--border)] p-3 bg-[var(--bg)] space-y-1.5">
            {[
              { label: 'Total Amount',        val: row.total_amount },
              { label: 'Withholding Tax',     val: row.withholding_tax },
              { label: 'Total Credit Amount', val: row.total_credit_amount },
            ].map(({ label, val }) => (
              <div key={label} className="flex justify-between text-[13px]">
                <span className="text-[var(--text-muted)]">{label}</span>
                <span className="font-semibold">{appCurrency && <span className="font-normal text-[var(--text-muted)] mr-1">{appCurrency}</span>}{fmtN(val)}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--border)]">
            <DetailRow label="Posted By">{row.posted_by_name || '—'}</DetailRow>
            <DetailRow label={row.status === 'Rejected' ? 'Rejected By' : 'Approved By'}>{row.approved_by_name || '—'}</DetailRow>
          </div>

          {/* GL posting result */}
          {row.document_ref && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-[8px] border border-[var(--success,#10b981)] bg-[color-mix(in_srgb,var(--success,#10b981)_8%,transparent)]">
              <CheckCircle2 size={13} className="text-[var(--success,#10b981)] shrink-0" />
              <span className="text-[12px] font-semibold text-[var(--success,#10b981)]">GL Posted</span>
              <span className="text-[12px] text-[var(--text-muted)] ml-1">Ref:</span>
              <code className="text-[11px] font-mono text-[var(--text-primary)] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded">{row.document_ref}</code>
            </div>
          )}
          {row.status === 'GL Failed' && (() => {
            const errMsg = medicalGlError(row);
            return (
              <div className="space-y-2 px-3 py-2.5 rounded-[8px] border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]">
                <div className="flex items-center gap-2">
                  <XCircle size={13} className="text-[var(--danger)] shrink-0" />
                  <span className="text-[12px] font-semibold text-[var(--danger)]">GL Posting Failed</span>
                </div>
                {errMsg && <p className="text-[11px] font-mono text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] px-2 py-1 rounded">{errMsg}</p>}
              </div>
            );
          })()}

          {row.status === 'Rejected' && (
            <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Rejection Reason</p>
              <p className="text-[12px] text-red-700">{row.response || 'No reason provided.'}</p>
            </div>
          )}

          {rejecting && (
            <div className="space-y-1.5">
              <label className="label text-[var(--danger)]">Rejection Reason</label>
              <CountedTextarea className={`${inputClass} resize-none`} rows={3} maxChars={500}
                placeholder="Enter reason for rejection…"
                value={reason} onChange={e => setReason(e.target.value)} autoFocus />
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)] shrink-0 flex flex-wrap gap-2">
          {row.status === 'Pending Approval' && !rejecting && canApprove && (canSelfAct ? (
            <>
              <button disabled={acting}
                onClick={() => callAction(`/medical/claims/${row.id}/approve`, {}, 'Claim approved')}
                className="success-btn flex items-center gap-1.5 flex-1">
                <CheckCircle2 size={14} />{acting ? 'Approving…' : 'Approve'}
              </button>
              <button disabled={acting} onClick={() => setRejecting(true)}
                className="secondary-btn !text-[var(--danger)] flex items-center gap-1.5 flex-1">
                <XCircle size={14} />Reject
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium flex-1"
              style={{ background: 'rgba(245,158,11,0.1)', color: '#b45309', border: '1px solid #f59e0b' }}>
              <Clock size={13} className="shrink-0" />
              Awaiting a different approver
            </div>
          ))}
          {row.status === 'GL Failed' && !rejecting && canApprove && (
            <button disabled={acting}
              onClick={() => callAction(`/medical/claims/${row.id}/retry-gl`, {}, 'GL posted successfully')}
              className="secondary-btn flex items-center gap-1.5 flex-1">
              <RefreshCw size={13} className={acting ? 'animate-spin' : ''} />
              {acting ? 'Retrying…' : 'Retry GL Posting'}
            </button>
          )}
          {rejecting && (
            <>
              <button onClick={() => setRejecting(false)} className="secondary-btn">Back</button>
              <button disabled={acting || !reason.trim()}
                onClick={() => callAction(`/medical/claims/${row.id}/reject`, { reason }, 'Claim rejected')}
                className="primary-btn !bg-red-600 hover:!bg-red-700 flex items-center gap-1.5 flex-1">
                <XCircle size={14} />{acting ? 'Rejecting…' : 'Confirm Reject'}
              </button>
            </>
          )}
          {!rejecting && <button onClick={onClose} className="secondary-btn">Close</button>}
        </div>
      </motion.div>
    </div>
  );
}

// ── Hospital Claims tab ───────────────────────────────────────────────────────

interface ClaimItem {
  employee_id:    string;
  employee_name:  string;
  type:           'self' | 'dependent';
  dependent_id:   string | null;
  dependent_name: string | null;
  narration:      string;
  amount:         number;
}

function claimPillClass(status: string) {
  if (status === 'Approved')         return 'pill pill-success';
  if (status === 'Rejected')         return 'pill bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]';
  if (status === 'GL Failed')        return 'pill bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]';
  if (status === 'Pending Approval') return 'pill pill-accent';
  return 'pill pill-neutral'; // Draft
}

function HospitalClaimsTab() {
  const { can } = useCan();
  const allowCreate = can('create_medical');
  const allowEdit   = can('edit_medical');
  const allowDelete = can('delete_medical');
  const { hospitalOptions } = useHospitalList();
  const employees    = useEmployees();
  const allDependents = useAllDependents();
  const appCurrency  = getSettings().general.currency;
  const currentUser  = getCurrentUser();

  // WHT settings
  const [whtHospital, setWhtHospital] = useState(0);
  const [whtPharmacy, setWhtPharmacy] = useState(0);

  // List view
  const [rows, setRows]         = useState<any[]>([]);
  const [search, setSearch]     = useState('');
  const [pending, setPending]   = useState<any>(null);
  const [viewDetail, setViewDetail] = useState<any>(null);

  // Form open/state
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [sel, setSel]       = useState<any>(null);

  // Form fields
  const [hospital, setHospital]       = useState('');
  const [hospitalType, setHospitalType] = useState('Hospital');
  const [comment, setComment]         = useState('');
  const [claimItems, setClaimItems]   = useState<ClaimItem[]>([]);
  const [itemLimits, setItemLimits]   = useState<Record<string, any>>({});
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  // Item builder sub-form
  const [iEmp,  setIEmp]  = useState('');
  const [iType, setIType] = useState<'self' | 'dependent'>('self');
  const [iDepId, setIDepId] = useState('');
  const [iNarr, setINarr] = useState('');
  const [iAmt,  setIAmt]  = useState('');

  useEffect(() => {
    api.get('/medical/settings').then(r => {
      const d = r.data.data ?? {};
      setWhtHospital(parseFloat(d.wht_rate_hospital ?? '0'));
      setWhtPharmacy(parseFloat(d.wht_rate_pharmacy ?? '0'));
    }).catch(() => {});
  }, []);

  function load() {
    api.get('/medical/claims').then(r => setRows(r.data.data ?? r.data ?? [])).catch(() => {});
  }
  useEffect(load, []);

  // Sync hospitalType when hospital selection changes
  useEffect(() => {
    const hosp = hospitalOptions.find(h => h.id === hospital);
    setHospitalType(hosp?.type ?? 'Hospital');
  }, [hospital, hospitalOptions]);

  // Derived totals
  const activeRate  = hospitalType === 'Pharmacy' ? whtPharmacy : whtHospital;
  const totalAmount = claimItems.reduce((s, i) => s + i.amount, 0);
  const whtAmount   = parseFloat((totalAmount * activeRate / 100).toFixed(2));
  const creditAmt   = parseFloat((totalAmount - whtAmount).toFixed(2));

  // Fetch limit enquiry per employee (cached)
  useEffect(() => {
    if (!iEmp || itemLimits[iEmp] !== undefined) return;
    api.get(`/medical/enquiry/${iEmp}`)
      .then(r => setItemLimits(prev => ({ ...prev, [iEmp]: r.data.data ?? null })))
      .catch(() => setItemLimits(prev => ({ ...prev, [iEmp]: null })));
  }, [iEmp]);

  function fetchLimitForEmp(empId: string) {
    if (!empId || itemLimits[empId] !== undefined) return;
    api.get(`/medical/enquiry/${empId}`)
      .then(r => setItemLimits(prev => ({ ...prev, [empId]: r.data.data ?? null })))
      .catch(() => setItemLimits(prev => ({ ...prev, [empId]: null })));
  }

  function limitStatus(empId: string) {
    const enq = itemLimits[empId];
    if (!enq || enq.medical_limit === null || enq.medical_limit === undefined) return null;
    const balance = parseFloat(String(enq.limit_balance ?? 0));
    return balance <= 0
      ? { exceeded: true,  label: `Limit exhausted (${enq.currency || appCurrency} ${Math.abs(balance).toLocaleString(undefined, { minimumFractionDigits: 2 })})` }
      : { exceeded: false, label: `Balance: ${enq.currency || appCurrency} ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}` };
  }

  // Dependents for the employee currently being added as item
  const iEmpDeps = useMemo(() =>
    allDependents.filter((d: any) => String(d.employee?.id ?? d.employee) === iEmp),
    [allDependents, iEmp]
  );
  const iDepDetail = useMemo(() =>
    iDepId ? allDependents.find((d: any) => String(d.id) === iDepId) : null,
    [allDependents, iDepId]
  );

  function resetItemBuilder() { setIEmp(''); setIType('self'); setIDepId(''); setINarr(''); setIAmt(''); }

  function addItem() {
    if (!iEmp || !iAmt) return toast.error('Employee and amount are required');
    const amt = parseFloat(iAmt);
    if (isNaN(amt) || amt <= 0) return toast.error('Enter a valid amount');
    if (iType === 'dependent' && !iDepId) return toast.error('Select a dependent');
    const emp = employees.find(e => e.id === iEmp);
    const dep = iDepId ? allDependents.find((d: any) => String(d.id) === iDepId) : null;
    setClaimItems(prev => [...prev, {
      employee_id:    iEmp,
      employee_name:  emp?.label ?? iEmp,
      type:           iType,
      dependent_id:   dep ? String(dep.id) : null,
      dependent_name: dep?.name ?? null,
      narration:      iNarr.trim(),
      amount:         amt,
    }]);
    resetItemBuilder();
  }

  function openAdd() {
    setSel(null); setHospital(''); setHospitalType('Hospital'); setComment('');
    setClaimItems([]); setItemLimits({}); setUploadErrors([]); resetItemBuilder(); setOpen(true);
  }

  function openEdit(row: any) {
    setSel(row);
    setHospital(String(row.hospital ?? ''));
    setHospitalType(row.hospital_type ?? 'Hospital');
    setComment(row.comment ?? '');
    setClaimItems(Array.isArray(row.items) ? row.items : []);
    setItemLimits({});
    setUploadErrors([]);
    resetItemBuilder();
    setOpen(true);
    // pre-fetch limits for existing items
    (Array.isArray(row.items) ? row.items : []).forEach((item: ClaimItem) => fetchLimitForEmp(item.employee_id));
  }

  async function handleSave() {
    if (!hospital) return toast.error('Select a hospital');
    if (claimItems.length === 0) return toast.error('Add at least one claim item');
    setSaving(true);
    try {
      const payload = { hospital, items: claimItems, comment };
      if (sel) await api.put(`/medical/claims/${sel.id}`, payload);
      else     await api.post('/medical/claims', payload);
      toast.success(sel ? 'Claim updated' : 'Claim saved');
      setOpen(false); load();
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!pending) return;
    try { await api.delete(`/medical/claims/${pending.id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Failed to delete'); }
    setPending(null);
  }

  async function handleSubmit(row: any) {
    try { await api.post(`/medical/claims/${row.id}/submit`); toast.success('Claim submitted'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed'); }
  }

  function downloadTemplate() {
    exportCSV('hospital-claim-template',
      ['Employee ID', 'Employee Name', 'Type', 'Dependent Name', 'Narration', 'Amount'],
      [['EMP001', 'John Smith', 'self', '', 'Consultation', '250.00'],
       ['EMP002', 'Jane Doe',   'dependent', 'Jane Child',   'Medication', '120.50']]
    );
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErrors([]);
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (data.length < 2) return toast.error('File is empty or has no data rows');

    const errors: string[] = [];
    const newItems: ClaimItem[] = [];

    data.slice(1).forEach((row, idx) => {
      const [empIdRaw, , typeRaw, depNameRaw, narration, amtRaw] = row.map(String);
      const lineNum = idx + 2;
      const empIdStr = (empIdRaw ?? '').trim();
      const emp = employees.find(e =>
        e.empId === empIdStr || e.label.toLowerCase() === empIdStr.toLowerCase()
      );
      if (!emp) { errors.push(`Row ${lineNum}: employee "${empIdStr}" not found`); return; }
      const type = (typeRaw ?? '').trim().toLowerCase() as 'self' | 'dependent';
      if (type !== 'self' && type !== 'dependent') {
        errors.push(`Row ${lineNum}: type must be "self" or "dependent"`); return;
      }
      let dep: any = null;
      if (type === 'dependent') {
        const depName = (depNameRaw ?? '').trim().toLowerCase();
        dep = allDependents.find((d: any) =>
          String(d.employee?.id ?? d.employee) === emp.id && (d.name ?? '').toLowerCase() === depName
        );
        if (!dep) { errors.push(`Row ${lineNum}: dependent "${depNameRaw}" not found for ${emp.label}`); return; }
      }
      const amount = parseFloat(amtRaw);
      if (isNaN(amount) || amount <= 0) { errors.push(`Row ${lineNum}: invalid amount "${amtRaw}"`); return; }
      newItems.push({
        employee_id:    emp.id,
        employee_name:  emp.label,
        type,
        dependent_id:   dep ? String(dep.id) : null,
        dependent_name: dep?.name ?? null,
        narration:      (narration ?? '').trim(),
        amount,
      });
    });

    if (errors.length) {
      setUploadErrors(errors);
      toast.error(`${errors.length} row(s) skipped — see details below`, { duration: 5000 });
    }
    if (newItems.length) {
      setClaimItems(prev => [...prev, ...newItems]);
      newItems.forEach(item => fetchLimitForEmp(item.employee_id));
      toast.success(`${newItems.length} item(s) imported`);
    }
    e.target.value = '';
  }

  const filtered = rows.filter(r =>
    !search ||
    (r.hospital_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (r.status ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const fmtN = (n: any) => `${currencyCode() ? currencyCode() + ' ' : ''}${parseFloat(String(n ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <MedTable search={search} onSearch={setSearch} onAdd={allowCreate ? openAdd : undefined} addLabel="Add Claim"
        headers={['Hospital', 'Type', 'Items', `Total${appCurrency ? ` (${appCurrency})` : ''}`, 'WHT', 'Credit', 'Status', 'Actions']}
        headerAligns={['left', 'left', 'center', 'right', 'right', 'right', 'left', 'right']}
        rows={filtered} emptyColSpan={8} total={rows.length} filtered={filtered.length}
        renderRow={(row, i) => (
          <tr key={i} className="tr">
            <td className="td font-medium">{row.hospital_name}</td>
            <td className="td text-[var(--text-muted)]">{row.hospital_type ?? '—'}</td>
            <td className="td text-center">{row.item_count ?? (Array.isArray(row.items) ? row.items.length : 0)}</td>
            <td className="td text-right">{fmtN(row.total_amount)}</td>
            <td className="td text-right text-[var(--text-muted)]">{fmtN(row.withholding_tax)}</td>
            <td className="td text-right">{fmtN(row.total_credit_amount)}</td>
            <td className="td"><span className={claimPillClass(row.status)}>{row.status}</span></td>
            <td className="td text-right">
              <div className="flex justify-end">
                <RowActions actions={[
                  { label: 'View Details', icon: Eye, onClick: () => setViewDetail(row) },
                  { label: 'Edit', icon: Edit, onClick: () => openEdit(row), hidden: !(row.status === 'Draft' && allowEdit) },
                  { label: 'Submit', icon: Send, onClick: () => handleSubmit(row), hidden: !(row.status === 'Draft' && allowCreate) },
                  { label: 'Delete', icon: Trash2, danger: true, onClick: () => setPending(row), hidden: !(row.status === 'Draft' && allowDelete) },
                ]} />
              </div>
            </td>
          </tr>
        )}
      />

      {/* Add/Edit form */}
      <AnimatePresence>
        {open && (
          <FormModal title={sel ? 'Edit Hospital Claim' : 'Add Hospital Claim'} maxWidth="3xl" scrollable
            onClose={() => setOpen(false)} onSave={handleSave} saveLabel={saving ? 'Saving…' : 'Save'}>

            {/* Hospital selector */}
            <F label="Hospital" required>
              <SearchSelect value={hospital} onChange={setHospital} options={hospitalOptions} placeholder="Select hospital…" />
            </F>
            {hospital && (
              <div className="mb-4 flex items-center gap-2 text-[12px]">
                <span className="pill pill-accent">{hospitalType}</span>
                <span className="text-[var(--text-muted)]">WHT: {activeRate}%</span>
              </div>
            )}

            {/* Item builder */}
            <div className="border border-[var(--border)] rounded-[12px] p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">Medical Claims</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={downloadTemplate}
                    className="secondary-btn text-[12px] flex items-center gap-1.5 py-1 px-2.5">
                    <Download size={13} />Template
                  </button>
                  <label className="secondary-btn text-[12px] flex items-center gap-1.5 py-1 px-2.5 cursor-pointer">
                    <Upload size={13} />Upload Excel/CSV
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={handleExcelUpload} />
                  </label>
                </div>
              </div>

              {/* Upload error details — shows exactly which rows were skipped and why */}
              {uploadErrors.length > 0 && (
                <div className="mb-3 rounded-[10px] border border-[var(--danger)]/30 bg-[var(--danger)]/5 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--danger)]/20">
                    <span className="text-[12px] font-semibold text-[var(--danger)]">
                      {uploadErrors.length} row{uploadErrors.length !== 1 ? 's' : ''} skipped
                    </span>
                    <button type="button" onClick={() => setUploadErrors([])}
                      className="text-[var(--danger)] hover:opacity-70" title="Dismiss">
                      <X size={13} />
                    </button>
                  </div>
                  <ul className="max-h-[140px] overflow-y-auto px-3 py-2 space-y-1">
                    {uploadErrors.map((err, i) => (
                      <li key={i} className="text-[12px] text-[var(--text-secondary)] leading-snug">• {err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sub-form: add one item */}
              <div className="bg-[var(--bg)] rounded-[10px] p-3 mb-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Employee</label>
                    <SearchSelect value={iEmp} onChange={v => { setIEmp(v); setIDepId(''); }}
                      options={employees} placeholder="Select employee…" />
                  </div>
                  <div>
                    <label className="label">For</label>
                    <select className={inputClass} value={iType} onChange={e => { setIType(e.target.value as 'self' | 'dependent'); setIDepId(''); }}>
                      <option value="self">Self</option>
                      <option value="dependent">Dependent</option>
                    </select>
                  </div>
                </div>

                {iType === 'dependent' && iEmp && (
                  <div>
                    <label className="label">Dependent</label>
                    <SearchSelect value={iDepId} onChange={setIDepId}
                      options={iEmpDeps.map((d: any) => ({ id: String(d.id), label: d.name ?? String(d.id) }))}
                      placeholder="Select dependent…" />
                    {iDepDetail && (
                      <div className="mt-2 text-[12px] text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] rounded-[8px] px-3 py-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <span><span className="font-medium text-[var(--text-primary)]">Name:</span> {iDepDetail.name}</span>
                        <span><span className="font-medium text-[var(--text-primary)]">Rel:</span> {iDepDetail.relationshipLabel ?? iDepDetail.relationship ?? '—'}</span>
                        <span><span className="font-medium text-[var(--text-primary)]">DOB:</span> {iDepDetail.dob ? String(iDepDetail.dob).slice(0, 10) : '—'}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Limit status banner */}
                {iEmp && (() => {
                  const ls = limitStatus(iEmp);
                  if (!ls) return null;
                  return (
                    <div className={`text-[12px] px-3 py-1.5 rounded-[8px] ${ls.exceeded
                      ? 'bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] text-[var(--danger)]'
                      : 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[color-mix(in_srgb,var(--success)_150%,#000)]'
                    }`}>
                      {ls.exceeded ? '⚠ ' : ''}{ls.label}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Narration <span className="text-[var(--text-muted)]">(optional)</span></label>
                    <input className={inputClass} value={iNarr} onChange={e => setINarr(e.target.value)} placeholder="e.g. Consultation" />
                  </div>
                  <div>
                    <label className="label">Amount <span className="text-[var(--danger)]">*</span></label>
                    <input type="number" min="0" step="0.01" className={inputClass} value={iAmt}
                      onChange={e => setIAmt(e.target.value)}
                      onWheel={e => e.currentTarget.blur()}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addItem())}
                      placeholder="0.00" />
                  </div>
                </div>
                <button type="button" onClick={addItem}
                  className="primary-btn text-[12px] py-1.5 px-3 flex items-center gap-1.5">
                  <Plus size={13} />Add Item
                </button>
              </div>

              {/* Items table */}
              {claimItems.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr>
                        {['#', 'Employee', 'For', 'Narration', 'Amount', ''].map(h => (
                          <th key={h} className="th text-[11px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {claimItems.map((item, i) => {
                        const ls = limitStatus(item.employee_id);
                        return (
                          <tr key={i} className={`tr ${ls?.exceeded ? 'bg-[color-mix(in_srgb,var(--danger)_4%,transparent)]' : ''}`}>
                            <td className="td">{i + 1}</td>
                            <td className="td">
                              {item.employee_name}
                              {ls?.exceeded && (
                                <span className="ml-1.5 text-[10px] font-bold text-[var(--danger)] uppercase">Limit exceeded</span>
                              )}
                            </td>
                            <td className="td">{item.type === 'dependent' ? `Dep: ${item.dependent_name}` : 'Self'}</td>
                            <td className="td text-[var(--text-muted)]">{item.narration || '—'}</td>
                            <td className="td text-right">{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="td text-right">
                              <button onClick={() => setClaimItems(prev => prev.filter((_, j) => j !== i))}
                                className="action-btn text-[var(--danger)]" title="Remove item">
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Comment */}
            <F label="Comment">
              <CountedTextarea className={inputClass + ' resize-none'} rows={2} maxChars={300} value={comment}
                onChange={e => setComment(e.target.value)} placeholder="Optional comment…" />
            </F>

            {/* Calculated totals */}
            {claimItems.length > 0 && (
              <div className="border border-[var(--border)] rounded-[12px] p-4 space-y-2 bg-[var(--bg)]">
                <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Totals</p>
                {[
                  { label: 'Total Amount',        val: totalAmount },
                  { label: `Withholding Tax (${activeRate}%)`, val: whtAmount  },
                  { label: 'Total Credit Amount', val: creditAmt   },
                ].map(({ label, val }) => (
                  <div key={label} className="flex justify-between text-[13px]">
                    <span className="text-[var(--text-muted)]">{label}</span>
                    <span className="font-semibold">{appCurrency} {val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            )}
          </FormModal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewDetail && (
          <HospitalClaimDetailPanel row={viewDetail} onClose={() => setViewDetail(null)} onRefresh={load} />
        )}
      </AnimatePresence>

      {pending && (
        <ConfirmAlert isOpen={!!pending} title="Delete claim?" message={`Delete this hospital claim?`}
          onConfirm={handleDelete} onCancel={() => setPending(null)} />
      )}
    </>
  );
}

// ── My Medical Enquiry tab (personal balance + history) ──────────────────────

function MyMedicalEnquiryTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [viewRec, setViewRec]   = useState<any>(null);
  const [viewType, setViewType] = useState<'staff' | 'dependent'>('staff');

  const load = () => api.get('/medical/my-enquiry')
    .then(r => setData(r.data.data ?? null))
    .catch(() => {})
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--text-muted)]">Loading…</div>;
  if (!data)   return <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--text-muted)]">No employee record linked to your account.</div>;

  const currency = data.currency || currencyCode();
  const fmt = (v: any) => v != null ? `${currency ? currency + ' ' : ''}${parseFloat(String(v)).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—';

  const exportEnquiry = () => {
    const aoa: any[][] = [
      ['My Medical Enquiry'],
      ['Medical Limit',     data.medical_limit != null ? `${currency} ${fmt(data.medical_limit)}` : '—'],
      ['Amount Utilised',   `${currency} ${fmt(data.amount_utilized)}`],
      ['Remaining Balance', data.limit_balance != null ? `${currency} ${fmt(data.limit_balance)}` : '—'],
    ];
    if (data.staff_records?.length) {
      aoa.push([], ['My Medical Records'], ['Admission Date', 'Illness', 'Hospital', 'Cost', 'Status']);
      data.staff_records.forEach((r: any) => aoa.push([r.admission_date?.slice(0, 10), r.illness_type, r.hospital, r.cost, r.status]));
    }
    if (data.dependent_records?.length) {
      aoa.push([], ['Dependent Medical Records'], ['Dependent', 'Date Attended', 'Illness', 'Cost', 'Status']);
      data.dependent_records.forEach((r: any) => aoa.push([r.dependent_name, r.date_attended?.slice(0, 10), r.illness_type, r.cost, r.status]));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'My Medical Enquiry');
    XLSX.writeFile(wb, `my_medical_enquiry_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex justify-end">
        <button className="secondary-btn" onClick={exportEnquiry}>
          <Download size={14} className="inline mr-1.5" />Download
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Medical Limit',    value: data.medical_limit != null   ? `${currency} ${fmt(data.medical_limit)}`    : '—', accent: false },
          { label: 'Amount Utilised',  value: `${currency} ${fmt(data.amount_utilized)}`,                                       accent: true  },
          { label: 'Remaining Balance',value: data.limit_balance != null   ? `${currency} ${fmt(data.limit_balance)}`   : '—', accent: false },
        ].map(c => (
          <div key={c.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] px-5 py-4 drop-shadow-sm">
            <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">{c.label}</p>
            <p className={`text-[18px] font-extrabold syne ${c.accent ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Staff records */}
      {data.staff_records?.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] overflow-hidden drop-shadow-sm">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
            <p className="text-[11px] font-bold syne uppercase tracking-widest text-[var(--text-primary)]">My Medical Records</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="th">Admission Date</th><th className="th">Illness</th>
                <th className="th">Hospital</th><th className="th">Cost</th><th className="th">Status</th>
                <th className="th text-right"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{data.staff_records.map((r: any, i: number) => (
                <tr key={i} className="tr">
                  <td className="td">{r.admission_date?.slice(0, 10)}</td>
                  <td className="td">{r.illness_type}</td>
                  <td className="td">{r.hospital}</td>
                  <td className="td">{fmt(r.cost)}</td>
                  <td className="td"><StatusPill status={r.status} /></td>
                  <td className="td text-right">
                    <button onClick={() => { setViewRec({ ...r, employee_name: data.employee_name }); setViewType('staff'); }} className="action-btn text-[var(--text-muted)]" title="View Details"><Eye size={13} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dependent records */}
      {data.dependent_records?.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] overflow-hidden drop-shadow-sm">
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
            <p className="text-[11px] font-bold syne uppercase tracking-widest text-[var(--text-primary)]">Dependent Medical Records</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className="th">Dependent</th><th className="th">Date Attended</th>
                <th className="th">Illness</th><th className="th">Cost</th><th className="th">Status</th>
                <th className="th text-right"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>{data.dependent_records.map((r: any, i: number) => (
                <tr key={i} className="tr">
                  <td className="td">{r.dependent_name}</td>
                  <td className="td">{r.date_attended?.slice(0, 10)}</td>
                  <td className="td">{r.illness_type}</td>
                  <td className="td">{fmt(r.cost)}</td>
                  <td className="td"><StatusPill status={r.status} /></td>
                  <td className="td text-right">
                    <button onClick={() => { setViewRec({ ...r, employee_name: data.employee_name }); setViewType('dependent'); }} className="action-btn text-[var(--text-muted)]" title="View Details"><Eye size={13} /></button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {!data.staff_records?.length && !data.dependent_records?.length && (
        <p className="text-center text-[13px] text-[var(--text-muted)] py-10">No medical records on file.</p>
      )}

      <AnimatePresence>
        {viewRec && (
          <MedicalDetailPanel record={viewRec} type={viewType} adminMode={false}
            onClose={() => setViewRec(null)} onRefresh={load} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Personal Medical ──────────────────────────────────────────────────────────

const PERSONAL_TABS: TabDef[] = [
  { label: 'My Medicals',               icon: FilePlus },
  { label: 'Dependent Medical Request', icon: Users    },
  { label: 'My Medical Enquiry',        icon: Stethoscope },
];

export function PersonalMedical() {
  const [tab, setTab] = useState(PERSONAL_TABS[0].label);
  const currentUser = getCurrentUser();
  const currentEmpId = currentUser?.employeeId ? String(currentUser.employeeId) : '';
  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Personal Medical" subtitle="Submit and view your personal and dependent medical requests." />
      <MedTabs tabs={PERSONAL_TABS} active={tab} onChange={setTab} />
      {tab === 'My Medicals'               && <StaffMedicalTab adminMode={false} currentEmpId={currentEmpId} />}
      {tab === 'Dependent Medical Request' && <DependentMedicalTab adminMode={false} currentEmpId={currentEmpId} />}
      {tab === 'My Medical Enquiry'        && <MyMedicalEnquiryTab />}
    </div>
  );
}

// ── Admin Medical ─────────────────────────────────────────────────────────────

const ADMIN_TABS: TabDef[] = [
  { label: 'Staff Medical',             icon: UserCheck         },
  { label: 'Dependent Medical',         icon: Users             },
  { label: 'Medical Limits Setup',       icon: SlidersHorizontal },
  { label: 'Staff Medical Enquiry',      icon: MessageCircle     },
  { label: 'Registered Hospitals',       icon: Building2         },
  { label: 'Hospital Claims',            icon: Receipt           },
];

export function AdminMedical() {
  const [tab, setTab] = useState(ADMIN_TABS[0].label);
  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="Admin Medical" subtitle="Manage employee medical requests, limits, hospitals, and claims." />
      <MedTabs tabs={ADMIN_TABS} active={tab} onChange={setTab} />
      {tab === 'Staff Medical'              && <StaffMedicalTab adminMode />}
      {tab === 'Dependent Medical'          && <DependentMedicalTab adminMode />}
      {tab === 'Medical Limits Setup'       && <MedicalLimitsTab />}
      {tab === 'Staff Medical Enquiry'      && <StaffMedicalEnquiryTab />}
      {tab === 'Registered Hospitals'       && <RegisteredHospitalsTab />}
      {tab === 'Hospital Claims'            && <HospitalClaimsTab />}
    </div>
  );
}
