import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CalendarClock, CheckCircle2, Download, Eye, FileEdit, Plus, RefreshCw, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { PageHeader } from './ui/PageHeader';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect } from './ui/SearchSelect';
import { TransferChangeComparison } from './ui/TransferChangeComparison';
import { RowActions } from './ui/RowActions';
import { getSettings } from '../../lib/settings';
import { EMPLOYEE_FORM_FIELDS, EMPLOYEE_FORM_FIELDS_BY_KEY } from '../config/employeeFormFields';
import { downloadTransferPdf } from './ui/transferPdf';

type Transfer = {
  id: string; transfer_number: string; employee: string; employee_name: string; employee_code?: string;
  transfer_type: string; effective_date: string; status: string; reason?: string; supporting_document?: string;
  rejected_reason?: string; cancelled_reason?: string; changes: any[]; stages: any[];
  current_values?: string; proposed_values?: string;
};
type Option = { id: string; label: string };
type Form = Record<string, string>;

const EMPTY_FORM: Form = {
  employee: '', transfer_type: 'Permanent Transfer', effective_date: '', reason: '', supporting_document: '',
};
const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];
const parseValues = (value?: string) => { try { return value ? JSON.parse(value) : {}; } catch { return {}; } };
const statuses = ['All', 'Draft', 'Pending Approval', 'Scheduled', 'Effective', 'Rejected', 'Cancelled'];

function statusClass(status: string) {
  if (status === 'Effective') return 'pill-success';
  if (status === 'Rejected' || status === 'Cancelled') return 'pill-danger';
  if (status === 'Scheduled') return 'pill-accent';
  return 'pill-warning';
}

function TransferForm({ initial, onClose, onSaved }: { initial?: Transfer | null; onClose: () => void; onSaved: () => void }) {
  const parsedInitialProposed = initial ? parseValues(initial.proposed_values) : {};
  const initialProposed = Object.keys(parsedInitialProposed).length
    ? parsedInitialProposed
    : Object.fromEntries((initial?.changes || []).map(change => [change.field, change.proposedId]));
  const [form, setForm] = useState<Form>(() => initial ? {
    ...EMPTY_FORM,
    employee: String(initial.employee), transfer_type: initial.transfer_type,
    effective_date: String(initial.effective_date).slice(0, 10), reason: initial.reason || '',
    supporting_document: initial.supporting_document || '',
    ...Object.fromEntries(Object.entries(initialProposed).map(([key, value]) => [`field:${key}`, value == null ? '' : String(value)])),
  } : { ...EMPTY_FORM });
  const [refs, setRefs] = useState<Record<string, any[]>>({});
  const [saving, setSaving] = useState(false);
  const configuredKeys = useMemo(() => {
    const snapshotted = initial ? Object.keys(parseValues(initial.current_values)) : [];
    if (snapshotted.length) return snapshotted;
    if (initial?.changes?.length) return initial.changes.map(change => change.field);
    const config = getSettings().employeeForm.transferFields;
    return EMPLOYEE_FORM_FIELDS.filter(field => config[field.key] && !field.locked && field.type !== 'file').map(field => field.key);
  }, [initial]);
  const transferFields = configuredKeys.map(key => EMPLOYEE_FORM_FIELDS_BY_KEY[key]).filter(Boolean);

  useEffect(() => {
    Promise.all([
      api.get('/employees/active'), api.get('/company/structures'),
      ...['TIT', 'GEN', 'NAT', 'REG', 'EMPS', 'JOBT', 'STAFL', 'STAFR', 'CT'].map(code => api.get(`/system/code-lists/${code}/values`)),
      api.get('/employees/paygrades'), api.get('/employees/notches'),
    ]).then(([employees, structures, titles, genders, nationalities, religions, employmentStatuses, jobs, staffLevels, staffRoles, countries, paygrades, notches]) => setRefs({
      employees: employees.data?.data || [], structures: structures.data?.data || [],
      titles: titles.data?.data || [], genders: genders.data?.data || [], nationalities: nationalities.data?.data || [],
      religions: religions.data?.data || [], employmentStatuses: employmentStatuses.data?.data || [], jobs: jobs.data?.data || [],
      staffLevels: staffLevels.data?.data || [], staffRoles: staffRoles.data?.data || [], countries: countries.data?.data || [],
      paygrades: paygrades.data?.data || [], notches: notches.data?.data || [],
    })).catch(() => toast.error('Failed to load transfer form options'));
  }, []);

  const set = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  const options = (items: any[] = [], label: (item: any) => string): Option[] => items.map(item => ({ id: String(item.id), label: label(item) }));
  const structures = (types: string[]) => options((refs.structures || []).filter(item => types.includes(item.typeLabel)), item => item.title);
  const codeOptions = (key: string) => options(refs[key] || [], item => item.label);
  const fieldOptions = (key: string): Option[] => {
    if (key === 'departmentId') return structures(['Department']);
    if (key === 'branchId') return structures(['Branch', 'Head Office']);
    if (key === 'unitId') return structures(['Unit']);
    if (key === 'outletId') return structures(['Outlet']);
    if (key === 'supervisorId') return options(refs.employees || [], item => item.name || `${item.firstName || ''} ${item.lastName || ''}`.trim() || item.employee_id);
    if (key === 'paygradeId') return options(refs.paygrades || [], item => item.name || `Pay grade ${item.id}`);
    if (key === 'notcheId') {
      const grade = form['field:paygradeId'];
      return options((refs.notches || []).filter(item => !grade || String(item.paygradeId) === grade), item => item.name || `Notch ${item.id}`);
    }
    if (key === 'marital_status') return MARITAL_STATUSES.map(value => ({ id: value, label: value }));
    const map: Record<string, string> = {
      titleId: 'titles', genderId: 'genders', nationalityId: 'nationalities', religionId: 'religions',
      employmentStatusId: 'employmentStatuses', jobTitleId: 'jobs', staff_level: 'staffLevels', staff_role: 'staffRoles', country: 'countries',
    };
    if (key === 'country') return (refs.countries || []).map(item => ({ id: String(item.label), label: item.label }));
    return map[key] ? codeOptions(map[key]) : [];
  };

  const save = async () => {
    if (!form.employee) return toast.error('Employee is required');
    if (!form.effective_date) return toast.error('Effective date is required');
    setSaving(true);
    try {
      const payload: Record<string, any> = Object.fromEntries(Object.entries(form).filter(([key, value]) => !key.startsWith('field:') && value !== ''));
      payload.proposed_values = Object.fromEntries(configuredKeys
        .filter(key => initial || form[`field:${key}`] !== '')
        .map(key => [key, form[`field:${key}`] === '' ? null : form[`field:${key}`]]));
      if (initial) await api.put(`/employee-transfers/${initial.id}`, payload);
      else await api.post('/employee-transfers', payload);
      toast.success(initial ? 'Transfer draft updated' : 'Transfer draft created');
      onSaved(); onClose();
    } catch (error: any) { toast.error(error.response?.data?.message || 'Failed to save employee transfer'); }
    finally { setSaving(false); }
  };

  return (
    <FormModal title={initial ? 'Edit Employee Transfer' : 'New Employee Transfer'} subtitle="Changes are applied only after approval and on the effective date." onClose={onClose} onSave={save} saveLabel={saving ? 'Saving…' : 'Save Draft'} maxWidth="4xl" scrollable>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Employee" required><SearchSelect value={form.employee} onChange={value => set('employee', value)} options={options(refs.employees, item => item.name || `${item.firstName || ''} ${item.lastName || ''}`.trim() || item.employee_id)} placeholder="Select employee…" disabled={!!initial} /></FormField>
        <FormField label="Transfer Type" required><select className={inputClass} value={form.transfer_type} onChange={event => set('transfer_type', event.target.value)}><option>Permanent Transfer</option><option>Temporary Transfer</option><option>Secondment</option><option>Promotion Transfer</option><option>Demotion Transfer</option></select></FormField>
        <FormField label="Effective Date" required><input type="date" className={inputClass} value={form.effective_date} onChange={event => set('effective_date', event.target.value)} /></FormField>
        <FormField label="Supporting Document Reference"><input className={inputClass} value={form.supporting_document} onChange={event => set('supporting_document', event.target.value)} placeholder="Filename, document ID, or reference" /></FormField>
      </div>
      <div className="my-5 border-t border-[var(--border)] pt-4">
        <h4 className="mb-3 text-sm font-bold text-[var(--text-primary)]">Proposed employee changes</h4>
        <p className="mb-4 text-xs text-[var(--text-muted)]">Select only the fields that should change. Unselected fields remain as they are.</p>
        {!transferFields.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No transfer fields are enabled in Control Setup.</div> : (
          <div className="grid gap-4 sm:grid-cols-2">{transferFields.map(field => {
            const key = `field:${field.key}`;
            const opts = fieldOptions(field.key);
            return <FormField key={field.key} label={field.label}>
              {field.type === 'select' ? (
                <SearchSelect value={form[key] || ''} onChange={value => set(key, value)} options={opts} placeholder={`Keep current ${field.label.toLowerCase()}`} />
              ) : (
                <input type={field.type === 'date' ? 'date' : 'text'} className={inputClass} value={form[key] || ''} onChange={event => set(key, event.target.value)} placeholder={`Keep current ${field.label.toLowerCase()}`} />
              )}
            </FormField>;
          })}</div>
        )}
      </div>
      <FormField label="Reason"><CountedTextarea className={`${inputClass} resize-none`} rows={3} maxChars={1000} value={form.reason} onChange={event => set('reason', event.target.value)} placeholder="Why is this transfer required?" /></FormField>
    </FormModal>
  );
}

function TransferDetails({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  return <FormModal title={transfer.transfer_number} subtitle={`${transfer.employee_name} · ${transfer.transfer_type}`} onClose={onClose} onSave={() => {}} readOnly maxWidth="3xl" scrollable>
    <div className="space-y-5">
      <div className="flex justify-end">
        <button type="button" className="secondary-btn" onClick={() => downloadTransferPdf(transfer)}><Download size={14} /> Download PDF</button>
      </div>
      <div className="grid grid-cols-2 gap-4 rounded-xl bg-[var(--bg)] p-4 sm:grid-cols-4">
        {[['Employee ID', transfer.employee_code || '—'], ['Effective date', String(transfer.effective_date).slice(0, 10)], ['Status', transfer.status], ['Transfer type', transfer.transfer_type]].map(([label, value]) => <div key={label}><p className="text-[10px] font-bold uppercase text-[var(--text-muted)]">{label}</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{value}</p></div>)}
      </div>
      <div><h4 className="mb-2 text-sm font-bold">Assignment changes</h4><TransferChangeComparison changes={transfer.changes || []} /></div>
      {transfer.reason && <div><h4 className="mb-1 text-xs font-bold uppercase text-[var(--text-muted)]">Reason</h4><p className="text-sm">{transfer.reason}</p></div>}
      {(transfer.rejected_reason || transfer.cancelled_reason) && <div className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-bold uppercase text-red-600">{transfer.rejected_reason ? 'Rejection reason' : 'Cancellation reason'}</p><p className="mt-1 text-sm text-red-800">{transfer.rejected_reason || transfer.cancelled_reason}</p></div>}
      {!!transfer.stages?.length && <div><h4 className="mb-2 text-sm font-bold">Approval progress</h4><div className="space-y-2">{transfer.stages.map((stage: any) => <div key={stage.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2"><div><p className="text-sm font-semibold">{Number(stage.stage_order) + 1}. {stage.stage_name}</p><p className="text-xs text-[var(--text-muted)]">{stage.approver_label || 'Assigned approver'}{stage.comment ? ` · ${stage.comment}` : ''}</p></div><span className={`pill text-[11px] ${statusClass(stage.status)}`}>{stage.status}</span></div>)}</div></div>}
    </div>
  </FormModal>;
}

export function EmployeeTransfers() {
  const user = getCurrentUser();
  const can = (permission: string) => user?.resolvedPermissions?.has(permission) || false;
  const [rows, setRows] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Transfer | null | undefined>(undefined);
  const [detail, setDetail] = useState<Transfer | null>(null);

  const load = () => {
    setLoading(true);
    api.get('/employee-transfers').then(response => setRows(response.data?.data || []))
      .catch(() => toast.error('Failed to load employee transfers')).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const filtered = useMemo(() => rows.filter(row => (status === 'All' || row.status === status) && `${row.transfer_number} ${row.employee_name} ${row.transfer_type}`.toLowerCase().includes(search.toLowerCase())), [rows, status, search]);

  const action = async (path: string, body: any, success: string) => {
    try { await api.post(path, body); toast.success(success); load(); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Action failed'); }
  };
  const reschedule = async (row: Transfer) => {
    const effectiveDate = window.prompt('New effective date (YYYY-MM-DD)', String(row.effective_date).slice(0, 10));
    if (!effectiveDate) return;
    try { await api.put(`/employee-transfers/${row.id}/reschedule`, { effective_date: effectiveDate }); toast.success('Transfer rescheduled'); load(); }
    catch (error: any) { toast.error(error.response?.data?.message || 'Failed to reschedule transfer'); }
  };

  return <div className="p-4 sm:p-6 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><PageHeader title="Employee Transfers" subtitle="Plan, approve, schedule, and audit employee assignment changes." /><div className="flex gap-2">{can('create_employee_transfers') && <button className="primary-btn" onClick={() => setForm(null)}><Plus size={15} />New Transfer</button>}</div></div>
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4"><div className="flex flex-wrap gap-2">{statuses.map(item => <button key={item} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === item ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border)] text-[var(--text-muted)]'}`} onClick={() => setStatus(item)}>{item}</button>)}</div><div className="flex gap-2"><input className={`${inputClass} w-56`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transfers…" /><button className="secondary-btn" onClick={load}><RefreshCw size={15} /></button></div></div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {['Transfer', 'Employee', 'Type', 'Effective Date', 'Changes', 'Status'].map(label => <th key={label} className="th">{label}</th>)}
              <th className="th text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading ? <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">Loading transfers…</td></tr>
              : !filtered.length ? <tr><td colSpan={7} className="px-4 py-12 text-center"><ArrowRightLeft className="mx-auto mb-2 text-[var(--text-muted)]" /><p className="text-sm text-[var(--text-muted)]">No employee transfers found.</p></td></tr>
                : filtered.map(row => <tr key={row.id} className="hover:bg-[var(--surface-hover)]">
                  <td className="px-4 py-3 text-sm font-bold text-[var(--accent)]">{row.transfer_number}</td>
                  <td className="px-4 py-3"><p className="text-sm font-semibold">{row.employee_name}</p><p className="text-xs text-[var(--text-muted)]">{row.employee_code || '—'}</p></td>
                  <td className="px-4 py-3 text-sm">{row.transfer_type}</td>
                  <td className="px-4 py-3 text-sm">{String(row.effective_date).slice(0, 10)}</td>
                  <td className="px-4 py-3 text-sm">{row.changes?.length || 0}</td>
                  <td className="px-4 py-3"><span className={`pill text-[11px] ${statusClass(row.status)}`}>{row.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <RowActions actions={[
                        { label: 'View Details', icon: Eye, onClick: () => setDetail(row) },
                        { label: 'Download PDF', icon: Download, onClick: () => downloadTransferPdf(row) },
                        { label: 'Edit', icon: FileEdit, onClick: () => setForm(row), hidden: row.status !== 'Draft' || !can('create_employee_transfers') },
                        { label: 'Submit for Approval', icon: Send, onClick: () => action(`/employee-transfers/${row.id}/submit`, {}, 'Transfer submitted for approval'), hidden: row.status !== 'Draft' || !can('create_employee_transfers') },
                        { label: 'Reschedule', icon: CalendarClock, onClick: () => reschedule(row), hidden: row.status !== 'Scheduled' || !can('manage_employee_transfers') },
                        { label: 'Activate Transfer', icon: CheckCircle2, onClick: () => action(`/employee-transfers/${row.id}/activate`, {}, 'Transfer activated'), hidden: row.status !== 'Scheduled' || !can('manage_employee_transfers') || String(row.effective_date).slice(0, 10) > new Date().toISOString().slice(0, 10) },
                        { label: 'Cancel Transfer', icon: XCircle, danger: true, onClick: () => { const reason = window.prompt('Cancellation reason'); if (reason) action(`/employee-transfers/${row.id}/cancel`, { reason }, 'Transfer cancelled'); }, hidden: !['Draft', 'Pending Approval', 'Scheduled'].includes(row.status) || !can('manage_employee_transfers') },
                      ]} />
                    </div>
                  </td>
                </tr>)}
          </tbody>
        </table>
      </div>
    </div>
    {form !== undefined && <TransferForm initial={form} onClose={() => setForm(undefined)} onSaved={load} />}
    {detail && <TransferDetails transfer={detail} onClose={() => setDetail(null)} />}
  </div>;
}
