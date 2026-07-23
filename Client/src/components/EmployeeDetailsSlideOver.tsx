import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Phone, UploadCloud, Trash2, Edit, LogOut, Copy,
  Globe, CheckCircle, XCircle, AlertTriangle,
  User, MapPin, Briefcase, Building, CreditCard, GraduationCap,
  Award, Brain, Heart, Users, FileText, IdCard, ChevronRight,
  Eye, MoreHorizontal, Activity, Calendar, FileCheck, Loader2,
  Camera, Hash, Search, UserPlus, RefreshCw, Filter, ShieldAlert, TrendingUp, ArrowRightLeft, Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { useCan } from '@/hooks/useCan';
import { SearchSelect } from './ui/SearchSelect';
import { getSettings, employeeFieldVisible } from '../../lib/settings';
import { DocumentViewer } from './DocumentViewer';
import { severityPill, statusPillD, INCIDENT_TYPES, SEVERITIES, STATUSES } from './DisciplinaryTab';
import { MultiSearchSelect } from './ui/SearchSelect';
import { ReviewDetailSlideOver } from './ReviewDetailSlideOver';
import { CountedTextarea } from './ui/CountedTextarea';
import { EmployeeChangeComparison } from './ui/EmployeeChangeComparison';
import { TransferChangeComparison } from './ui/TransferChangeComparison';
import { downloadTransferPdf } from './ui/transferPdf';

interface EmployeeDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  employee: any;
  onRefresh?: () => void;
}

type TabId = 'Personal' | 'Employment' | 'Qualifications' | 'Relationships' | 'Documents' | 'Attendance' | 'Leave' | 'Transfers' | 'Activity' | 'Disciplinary' | 'Performance';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: any) => v || null;
const fmtDate = (v: string | null | undefined) => {
  if (!v) return null;
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return v; }
};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

// ─── Subcomponents ────────────────────────────────────────────────────────────

// `fieldKey` ties a row to a configurable employee field; when that field is hidden in
// Settings → Controls → Employee Form the row is omitted from the detail view too.
const InfoField: React.FC<{ label: string; value?: React.ReactNode; span2?: boolean; fieldKey?: string }> = ({
  label, value, span2 = false, fieldKey,
}) => {
  if (fieldKey && !employeeFieldVisible(fieldKey)) return null;
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <p className="text-[10.5px] font-semibold tracking-[0.08em] uppercase text-slate-400 mb-1">{label}</p>
      <p className="text-[13.5px] font-medium text-slate-800 leading-snug">
        {value ?? <span className="text-slate-300 font-normal italic">—</span>}
      </p>
    </div>
  );
};

const SectionCard: React.FC<{
  title: string;
  icon: React.ElementType;
  accent?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon: Icon, accent = '#0066b3', children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-slate-100 overflow-hidden ${className}`}>
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-50">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}14` }}>
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
      </div>
      <h3 className="text-[11.5px] font-bold tracking-[0.07em] uppercase" style={{ color: accent }}>{title}</h3>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const CopyButton: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
      className="p-0.5 rounded text-slate-300 hover:text-[#0066b3] transition-colors"
      title="Copy"
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied
          ? <motion.span key="c" initial={{ scale: 0.6 }} animate={{ scale: 1 }} exit={{ scale: 0.6 }}><CheckCircle className="w-3 h-3 text-emerald-500" /></motion.span>
          : <motion.span key="d" initial={{ scale: 0.6 }} animate={{ scale: 1 }} exit={{ scale: 0.6 }}><Copy className="w-3 h-3" /></motion.span>
        }
      </AnimatePresence>
    </button>
  );
};

const LifecycleBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { bg: string; text: string; dot: string }> = {
    ACTIVE:     { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    PENDING:    { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
    SUSPENDED:  { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500'  },
    TERMINATED: { bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-500'    },
    RESIGNED:   { bg: 'bg-slate-100',  text: 'text-slate-500',   dot: 'bg-slate-400'   },
  };
  const s = map[status] ?? map['PENDING'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
};

const EmptyState: React.FC<{ icon: React.ElementType; label: string }> = ({ icon: Icon, label }) => (
  <div className="flex flex-col items-center justify-center py-16 gap-3">
    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center">
      <Icon className="w-5 h-5 text-slate-300" />
    </div>
    <p className="text-sm text-slate-400 font-medium">{label}</p>
  </div>
);

const StatChipSlide: React.FC<{ icon: React.ElementType; label: string; value: string | null | undefined; accent?: string }> = ({
  icon: Icon, label, value, accent = '#0066b3',
}) => (
  <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--surface-hover)] rounded-xl border border-[var(--border)]">
    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}1a` }}>
      <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
    </div>
    <div className="min-w-0">
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className="text-[12.5px] font-semibold text-[var(--text-primary)] truncate leading-tight mt-0.5">
        {value || <span className="text-[var(--text-muted)] font-normal italic">—</span>}
      </p>
    </div>
  </div>
);

// ─── Clearance document row ───────────────────────────────────────────────────

const ClearanceDoc: React.FC<{
  label: string;
  value: string | null;
  onView: (document: any) => void;
}> = ({ label, value, onView }) => (
  <div className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${value ? 'bg-emerald-50' : 'bg-slate-50'}`}>
        {value ? <FileCheck className="w-4 h-4 text-emerald-500" /> : <FileText className="w-4 h-4 text-slate-300" />}
      </div>
      <div>
        <p className="text-[13px] font-semibold text-slate-800">{label}</p>
        <p className={`text-[11px] mt-0.5 ${value ? 'text-emerald-600' : 'text-slate-400 italic'}`}>
          {value ? 'Document on file' : 'Not uploaded'}
        </p>
      </div>
    </div>
    {value && (
      <button
        type="button"
        onClick={() => onView({
          name: label,
          documentType: label,
          attachmentName: value,
          sourceUrl: `/documents/${encodeURIComponent(value)}`,
        })}
        className="p-1.5 rounded-lg text-slate-400 hover:text-[#0066b3] hover:bg-blue-50 transition-colors"
        title="View document"
      >
        <Eye className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

// ─── Tab content components ───────────────────────────────────────────────────

const PersonalTab: React.FC<{ employee: any }> = ({ employee }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <SectionCard title="Basic Information" icon={User} accent="#7c3aed">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <InfoField label="Date of Birth"   value={fmtDate(employee.dateOfBirth)} fieldKey="dateOfBirth" />
        <InfoField label="Place of Birth"  value={fmt(employee.place_of_birth)} fieldKey="place_of_birth" />
        <InfoField label="Gender"          value={employee.gender?.label} fieldKey="genderId" />
        <InfoField label="Nationality"     value={employee.nationality?.label} fieldKey="nationalityId" />
        <InfoField label="Religion"        value={employee.religion?.label} fieldKey="religionId" />
        <InfoField label="Marital Status"  value={fmt(employee.marital_status)} fieldKey="marital_status" />
        {employee.marital_status === 'Married' && (
          <InfoField label="Spouse" value={fmt(employee.spouse_name)} fieldKey="spouse_name" />
        )}
        <InfoField label="Father's Name"  value={fmt(employee.father_name)} fieldKey="father_name" />
        <InfoField label="Mother's Name"  value={fmt(employee.mother_name)} fieldKey="mother_name" />
      </div>
    </SectionCard>

    <SectionCard title="Contact Details" icon={MapPin} accent="#0066b3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <InfoField label="Mobile"          value={fmt(employee.mobilePhone)} fieldKey="mobilePhone" />
        <InfoField label="Work Email"      value={fmt(employee.work_email ?? employee.email)} fieldKey="work_email" />
        <InfoField label="Personal Email"  value={fmt(employee.personal_email)} fieldKey="personal_email" />
        <InfoField label="Address"         value={[employee.address1, employee.city, employee.country].filter(Boolean).join(', ') || null} span2 fieldKey="address1" />
      </div>
    </SectionCard>

    <div className="lg:col-span-2">
      <SectionCard title="Identification" icon={IdCard} accent="#b45309">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
          <InfoField label="National ID"       value={fmt(employee.nationalIdNumber)} fieldKey="nationalIdNumber" />
          <InfoField label="NIN Expiry"        value={fmtDate(employee.nationalIdExpiry)} fieldKey="nationalIdExpiry" />
          <InfoField label="Passport"          value={fmt(employee.passportNumber)} fieldKey="passportNumber" />
          <InfoField label="Passport Expiry"   value={fmtDate(employee.passportExpiry)} fieldKey="passportExpiry" />
          <InfoField label="Driver's License"  value={fmt(employee.driverLicenseNum)} fieldKey="driverLicenseNum" />
          <InfoField label="License Expiry"    value={fmtDate(employee.driverLicenseExp)} fieldKey="driverLicenseExp" />
          <InfoField label="SSN"    value={fmt(employee.ssn_num)} fieldKey="ssn_num" />
        </div>
      </SectionCard>
    </div>
  </div>
);

// PC-code (position) card — shows the RM/RO tag + current position code, with Assign/Move/Vacate
// for users who hold `assign_pc_code`. Uses the existing /pc-codes endpoints.
const PcCodeCard: React.FC<{ employee: any; onRefresh?: () => void }> = ({ employee, onRefresh }) => {
  const { can } = useCan();
  const [mode, setMode] = useState<null | 'assign' | 'reparent'>(null);
  const [vacant, setVacant] = useState<{ id: string; label: string }[]>([]);
  const [parents, setParents] = useState<{ id: string; label: string }[]>([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const pc = employee.pcCode;

  const startAssign = async () => {
    setMode('assign'); setTarget('');
    try {
      const res = await api.get('/pc-codes?vacant=1');
      setVacant((res.data.data ?? []).map((c: any) => ({ id: String(c.id), label: `${c.code} — ${c.name}` })));
    } catch { toast.error('Failed to load vacant PC codes'); }
  };

  // Change reporting line: pick a new parent position (or top-level). Only RM-held codes can be
  // parents, so we offer those plus a "Top level" option; the employee's own code is excluded.
  const startReparent = async () => {
    setMode('reparent'); setTarget('');
    try {
      const res = await api.get('/pc-codes');
      const opts = (res.data.data ?? [])
        .filter((c: any) => String(c.id) !== String(pc?.id) && c.code !== '000000000000')
        .map((c: any) => ({ id: String(c.id), label: `${c.code} — ${c.name}${c.currentEmployee ? ` · ${c.currentEmployee}` : ' · (vacant)'}` }));
      setParents([{ id: '__ROOT__', label: 'Top level (reports to nobody)' }, ...opts]);
    } catch { toast.error('Failed to load positions'); }
  };

  const doAssign = async () => {
    if (!target) { toast.error('Select a PC code'); return; }
    setBusy(true);
    try {
      await api.post(`/pc-codes/${target}/assign`, { employeeId: String(employee.id) });
      toast.success('PC code assigned');
      setMode(null);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to assign');
    } finally { setBusy(false); }
  };

  const doReparent = async () => {
    if (!pc?.id) return;
    if (!target) { toast.error('Select where this position reports to'); return; }
    setBusy(true);
    try {
      await api.put(`/pc-codes/${pc.id}/reparent`, { reportsToId: target === '__ROOT__' ? null : target });
      toast.success('Reporting line updated');
      setMode(null);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to change reporting line');
    } finally { setBusy(false); }
  };

  const doVacate = async () => {
    if (!pc?.id) return;
    setBusy(true);
    try {
      await api.post(`/pc-codes/${pc.id}/vacate`, {});
      toast.success('PC code vacated');
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to vacate');
    } finally { setBusy(false); }
  };

  return (
    <SectionCard title="Position (PC Code)" icon={Hash} accent="#0891b2">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <InfoField label="RM / RO" value={fmt(employee.rmRoType)} />
        <InfoField label="PC Code" value={pc ? `${pc.code} — ${pc.name}` : null} span2 />
      </div>

      {can('assign_pc_code') && (
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          {mode === 'assign' ? (
            <div className="space-y-3">
              <SearchSelect
                value={target}
                onChange={setTarget}
                options={vacant}
                placeholder={vacant.length ? 'Select a vacant position…' : 'No vacant positions available'}
              />
              <div className="flex gap-2">
                <button onClick={doAssign} disabled={busy} className="primary-btn shrink-0">Assign</button>
                <button onClick={() => setMode(null)} disabled={busy} className="secondary-btn shrink-0">Cancel</button>
              </div>
            </div>
          ) : mode === 'reparent' ? (
            <div className="space-y-3">
              <SearchSelect
                value={target}
                onChange={setTarget}
                options={parents}
                placeholder="Report to… (or Top level)"
              />
              <div className="flex gap-2">
                <button onClick={doReparent} disabled={busy} className="primary-btn shrink-0">Update</button>
                <button onClick={() => setMode(null)} disabled={busy} className="secondary-btn shrink-0">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {pc && (
                <button onClick={startReparent} disabled={busy} className="secondary-btn shrink-0">
                  <Building className="w-[14px] h-[14px]" /> Change reporting line
                </button>
              )}
              <button onClick={startAssign} disabled={busy} className="secondary-btn shrink-0">
                <UserPlus className="w-[14px] h-[14px]" /> {pc ? 'Move to a vacant code' : 'Assign a code'}
              </button>
              {pc && (
                <button onClick={doVacate} disabled={busy} className="secondary-btn shrink-0">Vacate</button>
              )}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
};

const EmploymentTab: React.FC<{ employee: any; onRefresh?: () => void }> = ({ employee, onRefresh }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <SectionCard title="Job Details" icon={Briefcase} accent="#059669">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <InfoField label="Employee ID"        value={fmt(employee.employee_id)} />
        <InfoField label="Job Title"          value={employee.jobTitle?.label} fieldKey="jobTitleId" />
        <InfoField label="Employment Status"  value={employee.employmentStatus?.label} fieldKey="employmentStatusId" />
        <InfoField label="Staff Level"        value={employee.staffLevel?.label ?? fmt(employee.staff_level)} fieldKey="staff_level" />
        <InfoField label="Staff Role"         value={employee.staffRole?.label ?? fmt(employee.staff_role)} fieldKey="staff_role" />
        <InfoField label="Department"         value={employee.department?.title} fieldKey="departmentId" />
        <InfoField label="Branch"             value={employee.branch?.title} fieldKey="branchId" />
        <InfoField label="Unit"               value={employee.unit?.title} fieldKey="unitId" />
        <InfoField label="Outlet"             value={employee.outlet?.title} fieldKey="outletId" />
        <InfoField label="Supervisor"         value={employee.supervisor?.name} fieldKey="supervisorId" />
        <InfoField label="Hire Date"          value={fmtDate(employee.hireDate)} fieldKey="hireDate" />
        <InfoField label="Confirmation Date"  value={fmtDate(employee.confirmationDate)} fieldKey="confirmationDate" />
      </div>
    </SectionCard>

    <PcCodeCard employee={employee} onRefresh={onRefresh} />

    <SectionCard title="Financial" icon={CreditCard} accent="#0066b3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <InfoField label="Bank Account"  value={fmt(employee.bankAccount)} span2 fieldKey="bankAccount" />
        <InfoField label="Pay Grade"     value={fmt(employee.paygrade)} fieldKey="paygradeId" />
        <InfoField label="Salary Notch"  value={fmt(employee.notch)} fieldKey="notcheId" />
      </div>
    </SectionCard>
  </div>
);

function profLabel(key: string | null | undefined) {
  if (!key) return '—';
  return key.replace(/_/g, ' ');
}

function fmtDateLocal(d: string | null | undefined) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

function MiniTable({ cols, rows, empty }: { cols: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-[12px] text-slate-400 italic py-2">{empty}</p>;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12px]">
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c} className="text-left px-1 pb-2 text-[10.5px] font-bold tracking-wider uppercase text-slate-400 border-b border-slate-100 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-slate-50 last:border-0">
              {cells.map((cell, j) => (
                <td key={j} className="px-1 py-2 text-slate-700 align-top">{cell ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RelationshipsTab: React.FC<{ employee: any }> = ({ employee }) => {
  const empId = String(employee.id);
  const [dependents,   setDependents]   = useState<any[]>([]);
  const [contacts,     setContacts]     = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, cRes] = await Promise.all([
        import('../../lib/api').then(m => m.default.get('/dependents')),
        import('../../lib/api').then(m => m.default.get('/emergency-contacts')),
      ]);
      setDependents((dRes.data.data ?? []).filter((r: any) => r.employee?.id === empId));
      setContacts((cRes.data.data ?? []).filter((r: any) => r.employee?.id === empId));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <SectionCard title="Next of Kin" icon={Heart} accent="#e11d48">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <InfoField label="Full Name" value={fmt(employee.nxt_kin_fname)} span2 fieldKey="nxt_kin_fname" />
          <InfoField label="Phone"     value={fmt(employee.nxt_kin_phone)} fieldKey="nxt_kin_phone" />
          <InfoField label="Email"     value={fmt(employee.nxt_kin_email)} fieldKey="nxt_kin_email" />
          <InfoField label="Address"   value={fmt(employee.nxt_kin_address)} span2 fieldKey="nxt_kin_address" />
        </div>
      </SectionCard>

      <SectionCard title="Dependents" icon={Users} accent="#0284c7">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
        ) : (
          <MiniTable
            cols={['Name', 'Relationship', 'Gender', 'Date of Birth', 'Place of Birth']}
            rows={dependents.map(r => [r.name, r.relationshipLabel ?? r.relationship, r.genderLabel ?? r.gender, fmtDateLocal(r.dob), r.place_of_birth])}
            empty="No dependents on record"
          />
        )}
      </SectionCard>

      <SectionCard title="Emergency Contacts" icon={Phone} accent="#dc2626">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
        ) : (
          <MiniTable
            cols={['Name', 'Relationship', 'Home Phone', 'Work Phone', 'Mobile']}
            rows={contacts.map(r => [r.name, r.relationshipLabel ?? r.relationship, r.home_phone, r.work_phone, r.mobile_phone])}
            empty="No emergency contacts on record"
          />
        )}
      </SectionCard>
    </div>
  );
};

const QualificationsTab: React.FC<{ employee: any }> = ({ employee }) => {
  const empId = String(employee.id);
  const [skills,   setSkills]   = useState<any[]>([]);
  const [certs,    setCerts]    = useState<any[]>([]);
  const [edus,     setEdus]     = useState<any[]>([]);
  const [langs,    setLangs]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const apiMod = await import('../../lib/api');
      const api = apiMod.default;
      const [sRes, cRes, eRes, lRes] = await Promise.all([
        api.get('/skills'),
        api.get('/certifications'),
        api.get('/education'),
        api.get('/languages'),
      ]);
      setSkills((sRes.data.data ?? []).filter((r: any) => r.employee?.id === empId));
      setCerts((cRes.data.data ?? []).filter((r: any) => r.employee?.id === empId));
      setEdus((eRes.data.data ?? []).filter((r: any) => r.employee?.id === empId));
      setLangs((lRes.data.data ?? []).filter((r: any) => r.employee?.id === empId));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [empId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  );

  return (
    <div className="space-y-4">
      <SectionCard title="Skills" icon={Award} accent="#7c3aed">
        <MiniTable
          cols={['Skill', 'Details']}
          rows={skills.map(r => [r.skill?.label, r.details])}
          empty="No skills on record"
        />
      </SectionCard>

      <SectionCard title="Certifications" icon={GraduationCap} accent="#0066b3">
        <MiniTable
          cols={['Certification', 'Institute', 'Granted', 'Valid Thru']}
          rows={certs.map(r => [r.certification?.label, r.institute, fmtDateLocal(r.date_start), fmtDateLocal(r.date_end)])}
          empty="No certifications on record"
        />
      </SectionCard>

      <SectionCard title="Education" icon={Brain} accent="#059669">
        <MiniTable
          cols={['Institution Type', 'Institute / School', 'Start', 'Completed']}
          rows={edus.map(r => [r.institutionType?.label, r.institute, fmtDateLocal(r.date_start), fmtDateLocal(r.date_end)])}
          empty="No education records"
        />
      </SectionCard>

      <SectionCard title="Languages" icon={Globe} accent="#b45309">
        <MiniTable
          cols={['Language', 'Reading', 'Speaking', 'Writing', 'Understanding']}
          rows={langs.map(r => [r.language?.label, profLabel(r.reading), profLabel(r.speaking), profLabel(r.writing), profLabel(r.understanding)])}
          empty="No language records"
        />
      </SectionCard>
    </div>
  );
};

const DocumentsTab: React.FC<{ employee: any; onViewDocument: (document: any) => void }> = ({ employee, onViewDocument }) => (
  <div className="space-y-4">
    <SectionCard title="Clearance Documents" icon={FileText} accent="#475569">
      <div>
        {employeeFieldVisible('fit_and_proper')   && <ClearanceDoc label="Fit & Proper Form"   value={employee.fit_and_proper}  onView={onViewDocument} />}
        {employeeFieldVisible('policeClearance')  && <ClearanceDoc label="Police Clearance"    value={employee.policeClearance} onView={onViewDocument} />}
        {employeeFieldVisible('medicalClearance') && <ClearanceDoc label="Medical Clearance"   value={employee.medicalClearance} onView={onViewDocument} />}
        {employee.resignation_letter && (
          <ClearanceDoc label="Resignation Letter" value={employee.resignation_letter} onView={onViewDocument} />
        )}
      </div>
    </SectionCard>
  </div>
);

const statusPill = (status: string) => {
  const map: Record<string, string> = {
    'Approved':         'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Pending Approval': 'bg-amber-50 text-amber-700 border-amber-200',
    'Pending HR Approval': 'bg-blue-50 text-blue-700 border-blue-200',
    'Pending Financial Approval': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'Rejected':         'bg-rose-50 text-rose-700 border-rose-200',
    'Cancelled':        'bg-slate-100 text-slate-500 border-slate-200',
    'Draft':            'bg-slate-50 text-slate-500 border-slate-200',
  };
  const cls = map[status] ?? 'bg-slate-50 text-slate-500 border-slate-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${cls}`}>{status}</span>;
};

const LeaveTab: React.FC<{ employee: any }> = ({ employee }) => {
  const [leaves,  setLeaves]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/leave/leaves/all?employee=${employee.id}`)
      .then(r => setLeaves(r.data.data ?? []))
      .catch(() => setLeaves([]))
      .finally(() => setLoading(false));
  }, [employee.id]);

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  );

  return (
    <div className="space-y-4">
      <SectionCard title="Leave Records" icon={Calendar} accent="#7c3aed">
        {leaves.length === 0 ? (
          <EmptyState icon={Calendar} label="No leave records found" />
        ) : (
          <MiniTable
            cols={['Leave Type', 'Period', 'Start', 'End', 'Days', 'Status']}
            rows={leaves.map(l => [
              <span key="t" className="flex items-center gap-1.5">
                {l.leave_color && (
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 inline-block" style={{ background: l.leave_color }} />
                )}
                {l.leave_type_name ?? '—'}
              </span>,
              l.period_name ?? '—',
              fmtDateLocal(l.date_start),
              fmtDateLocal(l.date_end),
              l.day_count ?? '—',
              statusPill(l.status ?? 'Draft'),
            ])}
            empty="No leave records found"
          />
        )}
      </SectionCard>
    </div>
  );
};

// ─── Activity tab ─────────────────────────────────────────────────────────────

const transferStatusPill = (status: string) => {
  const map: Record<string, string> = {
    Effective: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
    'Pending Approval': 'bg-amber-50 text-amber-700 border-amber-200',
    Rejected: 'bg-rose-50 text-rose-700 border-rose-200',
    Cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
    Draft: 'bg-slate-50 text-slate-500 border-slate-200',
  };
  const cls = map[status] ?? 'bg-slate-50 text-slate-500 border-slate-200';
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${cls}`}>{status}</span>;
};

const TransferHistoryTab: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/employee-transfers?employee=${encodeURIComponent(employeeId)}`)
      .then(response => setTransfers(response.data?.data ?? []))
      .catch(() => {
        setTransfers([]);
        toast.error('Failed to load employee transfer history');
      })
      .finally(() => setLoading(false));
  }, [employeeId]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  return (
    <SectionCard title="Employee Transfer History" icon={ArrowRightLeft} accent="#2563eb">
      {transfers.length === 0 ? <EmptyState icon={ArrowRightLeft} label="No employee transfer records found" /> : (
        <div className="space-y-4">
          {transfers.map(transfer => {
            const approvedStages = (transfer.stages ?? []).filter((stage: any) => stage.status === 'Approved').length;
            return (
              <article key={transfer.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-bold text-slate-800">{transfer.transfer_number}</p>
                      {transferStatusPill(transfer.status)}
                    </div>
                    <p className="mt-1 text-[11.5px] text-slate-500">{transfer.transfer_type}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Effective date</p>
                    <p className="mt-0.5 text-[12.5px] font-semibold text-slate-700">{fmtDate(transfer.effective_date) ?? '—'}</p>
                    <button type="button" onClick={() => downloadTransferPdf(transfer)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700">
                      <Download className="h-3.5 w-3.5" /> PDF
                    </button>
                  </div>
                </div>
                <div className="space-y-3 p-4">
                  <TransferChangeComparison changes={transfer.changes ?? []} />
                  <div className="grid gap-2 text-[11.5px] text-slate-600 sm:grid-cols-2">
                    <p><span className="font-semibold text-slate-700">Created:</span> {fmtDate(transfer.created_at) ?? '—'}</p>
                    <p><span className="font-semibold text-slate-700">Approval progress:</span> {transfer.stages?.length ? `${approvedStages} of ${transfer.stages.length} stages approved` : 'Direct approval flow'}</p>
                  </div>
                  {transfer.reason && <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600"><span className="font-semibold text-slate-700">Reason:</span> {transfer.reason}</p>}
                  {(transfer.rejected_reason || transfer.cancelled_reason) && (
                    <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">
                      <span className="font-semibold">{transfer.rejected_reason ? 'Rejection reason:' : 'Cancellation reason:'}</span>{' '}
                      {transfer.rejected_reason || transfer.cancelled_reason}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
};

const ACTION_META: Record<string, { label: string; dot: string; Icon: React.ElementType; iconColor: string }> = {
  create:            { label: 'Employee Created',        dot: 'bg-blue-500',    Icon: UserPlus,      iconColor: 'text-blue-500'    },
  update:            { label: 'Profile Updated',         dot: 'bg-blue-400',    Icon: Edit,          iconColor: 'text-blue-400'    },
  approve:           { label: 'Employee Approved',       dot: 'bg-emerald-500', Icon: CheckCircle,   iconColor: 'text-emerald-500' },
  reinstate:         { label: 'Employee Reinstated',     dot: 'bg-emerald-400', Icon: RefreshCw,     iconColor: 'text-emerald-400' },
  suspended:         { label: 'Suspension Approved',     dot: 'bg-amber-500',   Icon: AlertTriangle, iconColor: 'text-amber-500'   },
  suspended_pending: { label: 'Suspension Requested',    dot: 'bg-amber-400',   Icon: AlertTriangle, iconColor: 'text-amber-400'   },
  terminated:        { label: 'Termination Approved',    dot: 'bg-red-600',     Icon: XCircle,       iconColor: 'text-red-600'     },
  terminated_pending:{ label: 'Termination Requested',   dot: 'bg-red-400',     Icon: XCircle,       iconColor: 'text-red-400'     },
  resigned:          { label: 'Resignation Approved',    dot: 'bg-slate-500',   Icon: LogOut,        iconColor: 'text-slate-500'   },
  resign_pending:    { label: 'Resignation Submitted',   dot: 'bg-rose-400',    Icon: LogOut,        iconColor: 'text-rose-400'    },
  reject:            { label: 'Application Rejected',    dot: 'bg-rose-600',    Icon: XCircle,       iconColor: 'text-rose-600'    },
  reject_lifecycle:  { label: 'Action Rejected',         dot: 'bg-rose-500',    Icon: XCircle,       iconColor: 'text-rose-500'    },
};

const fmtDateTime = (ts: string) => {
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ts; }
};

const ActivityTab: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [entries,  setEntries]  = useState<any[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 380);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debSearch, actionFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debSearch)    q.set('search', debSearch);
      if (actionFilter) q.set('action', actionFilter);
      const res = await api.get(`/employees/${employeeId}/activity?${q}`);
      const d = res.data.data ?? {};
      setEntries(d.logs ?? []);
      setTotal(Number(d.total ?? 0));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [employeeId, page, debSearch, actionFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const getMeta = (action: string) =>
    ACTION_META[action] ?? { label: action.replace(/_/g, ' '), dot: 'bg-slate-400', Icon: Activity, iconColor: 'text-slate-400' };

  const parseDetails = (raw: string | null | undefined) => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };

  return (
    <SectionCard title="Activity Log" icon={Activity} accent="#0066b3">
      {/* Query bar */}
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="search"
            autoComplete="off"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by action, user, or details…"
            className="w-full pl-8 pr-3 py-2 text-[12.5px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="pl-7 pr-8 py-2 text-[12px] border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all appearance-none cursor-pointer"
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Activity} label={search || actionFilter ? 'No matching activity' : 'No activity recorded yet'} />
      ) : (
        <div className="relative pl-6">
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-slate-100" />
          <div className="space-y-3">
            {entries.map((e: any) => {
              const meta = getMeta(e.action);
              const details = parseDetails(e.details);
              return (
                <div key={e.id} className="relative">
                  <div className={`absolute -left-[15px] top-[14px] w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm ${meta.dot}`} />
                  <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 hover:border-slate-200 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <meta.Icon className={`w-3.5 h-3.5 shrink-0 ${meta.iconColor}`} />
                        <p className="text-[12.5px] font-semibold text-slate-800 leading-snug">{meta.label}</p>
                      </div>
                      <p className="text-[10.5px] text-slate-400 whitespace-nowrap shrink-0 mt-0.5">{fmtDateTime(e.created_at)}</p>
                    </div>
                    {e.user_name && (
                      <p className="text-[11.5px] text-slate-500 mt-1 ml-5">
                        By <span className="font-medium text-slate-700">{e.user_name}</span>
                      </p>
                    )}
                    {details && (details.reason || details.effectiveDate || details.action) && (
                      <div className="mt-2 ml-5 space-y-0.5 text-[11.5px] text-slate-600 border-l-2 border-slate-200 pl-2.5">
                        {details.reason && (
                          <p><span className="font-medium">Reason:</span> {details.reason}</p>
                        )}
                        {details.effectiveDate && (
                          <p><span className="font-medium">Effective date:</span> {details.effectiveDate}</p>
                        )}
                        {details.action && (
                          <p><span className="font-medium">Action type:</span> {details.action}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-100">
          <p className="text-[11.5px] text-slate-400">
            {total} event{total !== 1 ? 's' : ''} · page {page} of {totalPages}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-[11.5px] font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-[11.5px] font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
};

// ─── Employee Disciplinary Tab ────────────────────────────────────────────────

const BLANK_FORM = {
  incident_date: '', incident_type: '', severity: 'Medium',
  description: '', action_taken: '',
  status: 'Open', resolution: '', resolved_date: '',
};

const EmployeeDisciplinaryTab: React.FC<{ employeeId: string }> = ({ employeeId }) => {
  const [records,  setRecords]  = useState<any[]>([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 25;

  const [showModal,  setShowModal]  = useState(false);
  const [editRecord, setEditRecord] = useState<any | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [witnessIds, setWitnessIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [employeeOptions, setEmployeeOptions] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    api.get('/employees').then(res => {
      const list: any[] = res.data.data ?? [];
      setEmployeeOptions(
        list
          .filter(e => String(e.id) !== employeeId)
          .map(e => ({ id: String(e.id), label: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() }))
      );
    }).catch(() => {});
  }, [employeeId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ employee_id: employeeId, page: String(page), limit: String(PAGE_SIZE) });
      const res = await api.get(`/disciplinary?${q}`);
      const d = res.data.data ?? {};
      setRecords(d.records ?? []);
      setTotal(Number(d.total ?? 0));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [employeeId, page]);

  useEffect(() => { load(); }, [load]);

  const parseWitnessIds = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* not JSON — legacy free text, ignore */ }
    return [];
  };

  const openAdd = () => { setEditRecord(null); setForm({ ...BLANK_FORM }); setWitnessIds([]); setShowModal(true); };
  const openEdit = (r: any) => {
    setEditRecord(r);
    setForm({
      incident_date:  r.incident_date?.slice(0, 10) ?? '',
      incident_type:  r.incident_type ?? '',
      severity:       r.severity ?? 'Medium',
      description:    r.description ?? '',
      action_taken:   r.action_taken ?? '',
      status:         r.status ?? 'Open',
      resolution:     r.resolution ?? '',
      resolved_date:  r.resolved_date?.slice(0, 10) ?? '',
    });
    setWitnessIds(parseWitnessIds(r.witnesses));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.incident_date) { toast.error('Incident date is required'); return; }
    if (!form.incident_type) { toast.error('Incident type is required'); return; }
    if (!form.description.trim()) { toast.error('Description is required'); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        employee_id: employeeId,
        description: form.description.trim(),
        action_taken:  form.action_taken.trim()  || null,
        witnesses:     witnessIds.length > 0 ? JSON.stringify(witnessIds) : null,
        resolution:    form.resolution.trim()    || null,
        resolved_date: form.resolved_date        || null,
      };
      if (editRecord) {
        await api.put(`/disciplinary/${editRecord.id}`, body);
        toast.success('Record updated');
      } else {
        await api.post('/disciplinary', body);
        toast.success('Disciplinary record created — employee notified by email');
      }
      setShowModal(false);
      setPage(1);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteId(id);
    try {
      await api.delete(`/disciplinary/${id}`);
      toast.success('Record deleted');
      load();
    } catch {
      toast.error('Failed to delete record');
    } finally {
      setDeleteId(null);
    }
  };

  const fmtD = (v: string | null | undefined) => {
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return v; }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const setF = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <SectionCard title="Disciplinary Records" icon={ShieldAlert} accent="#dc2626">
      <div className="flex justify-end mb-4">
        <button onClick={openAdd} className="primary-btn text-[12px]">
          <ShieldAlert className="w-3.5 h-3.5" /> Add Record
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : records.length === 0 ? (
        <EmptyState icon={ShieldAlert} label="No disciplinary records" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-100">
                {['Date', 'Type', 'Severity', 'Action Taken', 'Status', ''].map(h => (
                  <th key={h} className="text-left py-2 px-3 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{fmtD(r.incident_date)}</td>
                  <td className="py-2.5 px-3 font-medium text-slate-800">{r.incident_type}</td>
                  <td className="py-2.5 px-3">{severityPill(r.severity)}</td>
                  <td className="py-2.5 px-3 text-slate-500 max-w-[180px]">
                    <span className="truncate block">{r.action_taken || <span className="italic text-slate-300">—</span>}</span>
                  </td>
                  <td className="py-2.5 px-3">{statusPillD(r.status)}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="Edit">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(String(r.id))}
                        disabled={deleteId === String(r.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
          <p className="text-[11.5px] text-slate-400">{total} record{total !== 1 ? 's' : ''} · page {page} of {totalPages}</p>
          <div className="flex gap-1.5">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 text-[11.5px] font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Prev
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 text-[11.5px] font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h3 className="text-[14px] font-bold text-slate-800">{editRecord ? 'Edit Disciplinary Record' : 'Add Disciplinary Record'}</h3>
                <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Incident Date *</label>
                    <input type="date" value={form.incident_date} onChange={e => setF('incident_date', e.target.value)}
                      className="h-9 px-3 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Incident Type *</label>
                    <select value={form.incident_type} onChange={e => setF('incident_type', e.target.value)}
                      className="h-9 px-3 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white cursor-pointer">
                      <option value="">Select type…</option>
                      {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Severity</label>
                    <select value={form.severity} onChange={e => setF('severity', e.target.value)}
                      className="h-9 px-3 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white cursor-pointer">
                      {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</label>
                    <select value={form.status} onChange={e => setF('status', e.target.value)}
                      className="h-9 px-3 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white cursor-pointer">
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Description *</label>
                  <CountedTextarea rows={3} maxChars={2000} value={form.description} onChange={e => setF('description', e.target.value)}
                    placeholder="Describe the incident…"
                    className="px-3 py-2 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-none" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Action Taken</label>
                  <CountedTextarea rows={2} maxChars={1000} value={form.action_taken} onChange={e => setF('action_taken', e.target.value)}
                    placeholder="What action was taken…"
                    className="px-3 py-2 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-none" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Witnesses</label>
                  <MultiSearchSelect
                    value={witnessIds}
                    onChange={setWitnessIds}
                    options={employeeOptions}
                    placeholder="Select witnesses…"
                  />
                </div>
                {form.status !== 'Open' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Resolution</label>
                    <CountedTextarea rows={2} maxChars={1000} value={form.resolution} onChange={e => setF('resolution', e.target.value)}
                      placeholder="Outcome / resolution notes…"
                      className="px-3 py-2 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-none" />
                  </div>
                )}
                {form.status === 'Resolved' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Resolved Date</label>
                    <input type="date" value={form.resolved_date} onChange={e => setF('resolved_date', e.target.value)}
                      className="h-9 px-3 text-[12.5px] border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
                <button onClick={() => setShowModal(false)} className="secondary-btn text-[12.5px]">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="primary-btn text-[12.5px]">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (editRecord ? 'Save Changes' : 'Create Record')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SectionCard>
  );
};

// ─── Employee Performance Tab ─────────────────────────────────────────────────

function EmployeePerformanceTab({ employeeId }: { employeeId: string }) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [goals,   setGoals]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/performance/reviews', { params: { employee_id: employeeId } }),
      api.get('/performance/goals',   { params: { employee_id: employeeId } }),
    ]).then(([rr, rg]) => {
      const rd = rr.data.data ?? rr.data;
      setReviews(rd.records ?? rd);
      setGoals(rg.data.data ?? rg.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [employeeId]);

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;

  const STATUS_COLOR: Record<string, string> = {
    'Not Started':       'bg-slate-100 text-slate-500',
    'Self Assessment':   'bg-amber-50 text-amber-700',
    'Supervisor Review': 'bg-blue-50 text-blue-700',
    'HR Review':         'bg-violet-50 text-violet-700',
    Completed:           'bg-emerald-50 text-emerald-700',
  };

  return (
    <div className="flex flex-col gap-5 p-1">
      {/* Reviews */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Performance Reviews</h4>
        {reviews.length ? (
          <div className="flex flex-col gap-2">
            {reviews.map((r: any) => (
              <div key={r.id}
                className="flex items-center justify-between gap-3 border border-slate-100 rounded-[10px] px-4 py-2.5 hover:bg-slate-50 cursor-pointer"
                onClick={() => setOpenReviewId(String(r.id))}>
                <div>
                  <p className="text-[13px] font-semibold text-slate-700">{r.cycle_name ?? '—'}</p>
                  <p className="text-[11.5px] text-slate-400">
                    {r.self_score != null ? `Self: ${Number(r.self_score).toFixed(1)}` : 'Self: —'}
                    {r.overall_score != null ? `  ·  Overall: ${Number(r.overall_score).toFixed(1)} / 5` : ''}
                  </p>
                </div>
                <span className={`pill text-[11px] ${STATUS_COLOR[r.status] ?? 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-slate-400 italic">No reviews found.</p>
        )}
      </div>

      {/* Goals */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Goals</h4>
        {goals.length ? (
          <div className="flex flex-col gap-1.5">
            {goals.map((g: any) => (
              <div key={g.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-[8px] px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-slate-700 truncate">{g.title}</p>
                  {g.due_date && <p className="text-[11px] text-slate-400">Due: {fmtDate(g.due_date)}</p>}
                </div>
                <span className="pill text-[10.5px] bg-slate-100 text-slate-500 shrink-0">{g.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-slate-400 italic">No goals found.</p>
        )}
      </div>

      {openReviewId && (
        <ReviewDetailSlideOver reviewId={openReviewId} mode="hr"
          onClose={() => setOpenReviewId(null)} />
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EmployeeDetailsSlideOver({ isOpen, onClose, employee, onRefresh }: EmployeeDetailsProps) {
  const [activeTab, setActiveTab]     = useState<TabId>('Personal');
  const [isMoreOpen, setIsMoreOpen]   = useState(false);
  const [approving, setApproving]         = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason]   = useState('');
  const [rejecting, setRejecting]         = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [localPhoto, setLocalPhoto]   = useState<string | null>(employee?.profile_imagebase64 || null);
  const [documentToView, setDocumentToView] = useState<any | null>(null);

  const [showSuspendModal,   setShowSuspendModal]   = useState(false);
  const [showResignModal,    setShowResignModal]    = useState(false);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [actionReason,       setActionReason]       = useState('');
  const [resignDate,         setResignDate]         = useState('');
  const [resignLetterFile,   setResignLetterFile]   = useState<File | null>(null);
  const [actionLoading,      setActionLoading]      = useState(false);
  const [positionImpact,     setPositionImpact]     = useState<{ reportees: any[]; isThresholdApprover: boolean } | null>(null);

  const resignLetterInputRef = useRef<HTMLInputElement>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalPhoto(employee?.profile_imagebase64 || null);
  }, [employee?.id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!employee) return null;

  const fullName = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim();
  const initials = `${(employee.firstName?.[0] ?? '').toUpperCase()}${(employee.lastName?.[0] ?? '').toUpperCase()}`;
  const isPending  = employee.approvalStatus === 'PENDING';
  const isRejected = employee.approvalStatus === 'REJECTED';
  const pendingChanges: any[] = Array.isArray(employee.pendingChanges) ? employee.pendingChanges : [];

  // Self-approval guard + action permissions
  const currentUser = getCurrentUser();
  const can = (perm: string) => currentUser?.resolvedPermissions.has(perm) ?? false;
  const canChangeStatus = can('change_employee_status');
  const canEditEmp      = can('edit_employees');
  const selfApprovalAllowed = getSettings().approvals.employeeSelfApproval;
  const isOwnRecord = String(currentUser?.id) === String(employee.posted_by);
  const hasApprovalAuthority = can('approve_employees') || employee.canCurrentUserApprove === true;
  const canApprove  = hasApprovalAuthority && (selfApprovalAllowed || !isOwnRecord);
  const canViewTransfers = ['view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers'].some(can);

  const isApproved  = employee.approvalStatus === 'APPROVED';
  const isActive    = employee.lifecycleStatus === 'ACTIVE';
  const isSuspended = employee.lifecycleStatus === 'SUSPENDED';

  // ── Photo upload ────────────────────────────────────────────────────────────
  const resizeImage = (file: File, maxPx = 800, quality = 0.85): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width >= height) { height = Math.round((height / width) * maxPx); width = maxPx; }
          else                 { width  = Math.round((width / height) * maxPx); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = url;
    });

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setPhotoUploading(true);
    try {
      const base64 = await resizeImage(file);
      await api.put(`/employees/${employee.id}`, { profile_imagebase64: base64 });
      setLocalPhoto(base64);
      toast.success('Photo updated');
      onRefresh?.();
    } catch {
      toast.error('Failed to upload photo');
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const handlePhotoRemove = async () => {
    setPhotoUploading(true);
    try {
      await api.put(`/employees/${employee.id}`, { profile_imagebase64: null });
      setLocalPhoto(null);
      toast.success('Photo removed');
      onRefresh?.();
    } catch {
      toast.error('Failed to remove photo');
    } finally {
      setPhotoUploading(false);
    }
  };

  // ── Approve / Reject ────────────────────────────────────────────────────────
  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await api.put(`/employees/${employee.id}/approve`);
      toast.success(res.data?.message || `${fullName} approved successfully`);

      const sync = res.data?.syncResult;
      if (sync) {
        const body = sync.data != null ? JSON.stringify(sync.data, null, 2) : sync.message ?? '';
        if (sync.success) {
          toast.success(
            <div>
              <p className="font-semibold text-[13px] mb-1">External system synced</p>
              {body && <pre className="text-[11px] whitespace-pre-wrap opacity-80">{body}</pre>}
            </div>,
            { duration: 8000 }
          );
        } else {
          toast.error(
            <div>
              <p className="font-semibold text-[13px] mb-1">External sync failed {sync.httpStatus ? `(${sync.httpStatus})` : ''}</p>
              {body && <pre className="text-[11px] whitespace-pre-wrap opacity-80">{body}</pre>}
            </div>,
            { duration: 10000 }
          );
        }
      }

      onRefresh?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to approve');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await api.put(`/employees/${employee.id}/reject`, { reason: rejectReason });
      toast.success(`${fullName}'s application rejected`);
      setShowRejectModal(false);
      setRejectReason('');
      onRefresh?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to reject');
    } finally {
      setRejecting(false);
    }
  };

  const handleSuspend = async () => {
    setActionLoading(true);
    try {
      await api.put(`/employees/${employee.id}/status`, { status: 'SUSPENDED', reason: actionReason });
      toast.success(`Suspension request submitted for approval — ${fullName}`);
      setShowSuspendModal(false);
      setActionReason('');
      onRefresh?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to submit suspension');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResign = async () => {
    setActionLoading(true);
    try {
      let resignationLetter: string | undefined;
      if (resignLetterFile) {
        const fd = new FormData();
        fd.append('file', resignLetterFile);
        const uploadRes = await api.post('/employees/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        resignationLetter = uploadRes.data?.data?.filename;
      }
      await api.post(`/employees/${employee.id}/resign`, { reason: actionReason, effectiveDate: resignDate, resignationLetter });
      toast.success(`Resignation submitted for approval — ${fullName}`);
      setShowResignModal(false);
      setActionReason('');
      setResignDate('');
      setResignLetterFile(null);
      onRefresh?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to initiate resignation');
    } finally {
      setActionLoading(false);
    }
  };

  const openLifecycleModal = async (modal: 'suspend' | 'terminate') => {
    setIsMoreOpen(false);
    setActionReason('');
    setPositionImpact(null);
    try {
      const res = await api.get(`/employees/${employee.id}/position-impact`);
      setPositionImpact(res.data?.data ?? null);
    } catch { /* non-fatal — show modal anyway */ }
    if (modal === 'suspend')   setShowSuspendModal(true);
    if (modal === 'terminate') setShowTerminateModal(true);
  };

  const handleReinstate = async () => {
    setActionLoading(true);
    try {
      await api.put(`/employees/${employee.id}/status`, { status: 'ACTIVE' });
      toast.success(`${fullName} reinstated successfully`);
      onRefresh?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to reinstate employee');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTerminate = async () => {
    setActionLoading(true);
    try {
      await api.put(`/employees/${employee.id}/status`, { status: 'TERMINATED', reason: actionReason });
      toast.success(`Termination request submitted for approval — ${fullName}`);
      setShowTerminateModal(false);
      setActionReason('');
      onRefresh?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to submit termination');
    } finally {
      setActionLoading(false);
    }
  };

  const tabs = [
    { id: 'Personal'       as TabId, label: 'Personal',       icon: User          },
    { id: 'Employment'     as TabId, label: 'Employment',     icon: Briefcase     },
    { id: 'Relationships'  as TabId, label: 'Relationships',  icon: Heart         },
    { id: 'Documents'      as TabId, label: 'Documents',      icon: FileText      },
    { id: 'Qualifications' as TabId, label: 'Qualifications', icon: GraduationCap },
    { id: 'Attendance'     as TabId, label: 'Attendance',     icon: Activity      },
    { id: 'Leave'          as TabId, label: 'Leave',          icon: Calendar      },
    ...(canViewTransfers ? [{ id: 'Transfers' as TabId, label: 'Transfers', icon: ArrowRightLeft }] : []),
    { id: 'Activity'       as TabId, label: 'Activity',       icon: Filter        },
    { id: 'Disciplinary'   as TabId, label: 'Disciplinary',   icon: ShieldAlert   },
    { id: 'Performance'    as TabId, label: 'Performance',    icon: TrendingUp    },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'Personal':       return <PersonalTab       employee={employee} />;
      case 'Employment':     return <EmploymentTab     employee={employee} onRefresh={onRefresh} />;
      case 'Relationships':  return <RelationshipsTab  employee={employee} />;
      case 'Documents':      return <DocumentsTab      employee={employee} onViewDocument={setDocumentToView} />;
      case 'Qualifications': return <QualificationsTab employee={employee} />;
      case 'Attendance':     return <EmptyState icon={Activity} label="Attendance data not available yet" />;
      case 'Leave':          return <LeaveTab employee={employee} />;
      case 'Transfers':      return <TransferHistoryTab employeeId={String(employee.id)} />;
      case 'Activity':       return <ActivityTab employeeId={String(employee.id)} />;
      case 'Disciplinary':   return <EmployeeDisciplinaryTab employeeId={String(employee.id)} />;
      case 'Performance':    return <EmployeePerformanceTab  employeeId={String(employee.id)} />;
      default:               return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          className="w-full h-full bg-[var(--bg)] overflow-y-auto"
        >
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-8 py-6 space-y-4">
            {/* Hidden file inputs */}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFile} />
            <input ref={resignLetterInputRef} type="file" accept=".pdf,.doc,.docx,image/*" className="hidden"
              onChange={e => setResignLetterFile(e.target.files?.[0] ?? null)} />

            {/* ── Top bar: breadcrumb + actions ── */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 text-[12px] min-w-0">
                <span className="text-[var(--text-muted)] font-medium whitespace-nowrap">Employees</span>
                <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <span className="text-[var(--text-primary)] font-semibold truncate">{fullName}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isPending && canApprove && (
                  <>
                    <button
                      onClick={handleApprove}
                      disabled={approving || rejecting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[var(--success)] bg-[var(--success-dim)] hover:opacity-80 border border-[var(--success)]/20 transition-all disabled:opacity-50"
                    >
                      {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      Approve
                    </button>
                    <button
                      onClick={() => { setRejectReason(''); setShowRejectModal(true); }}
                      disabled={approving || rejecting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[var(--danger)] bg-[var(--danger-dim)] hover:opacity-80 border border-[var(--danger)]/20 transition-all disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </>
                )}
                {isPending && hasApprovalAuthority && !canApprove && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[var(--warning)] bg-[var(--warning-dim)] border border-[var(--warning)]/20">
                    <AlertTriangle className="w-3 h-3" />
                    Self-approval not permitted
                  </span>
                )}

                {/* More dropdown */}
                {(canChangeStatus || canEditEmp) && (
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsMoreOpen(v => !v)}
                    className="w-8 h-8 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <AnimatePresence>
                    {isMoreOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 6 }} transition={{ duration: 0.12 }}
                        className="absolute right-0 top-[calc(100%+6px)] w-52 bg-[var(--surface)] rounded-xl shadow-lg border border-[var(--border)] py-1.5 z-[100]"
                      >
                        {canChangeStatus && (<>
                        {/* Suspend */}
                        <button
                          disabled={!isApproved || !isActive}
                          title={!isApproved ? 'Employee must be approved first' : !isActive ? 'Employee is not currently active' : ''}
                          onClick={() => openLifecycleModal('suspend')}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <AlertTriangle className="w-4 h-4 text-amber-500" /> Suspend Employee
                        </button>
                        {/* Initiate Resignation */}
                        <button
                          disabled={!isApproved || !isActive}
                          title={!isApproved ? 'Employee must be approved first' : !isActive ? 'Employee is not currently active' : ''}
                          onClick={() => { setIsMoreOpen(false); setActionReason(''); setResignDate(''); setShowResignModal(true); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <LogOut className="w-4 h-4 text-rose-500" /> Initiate Resignation
                        </button>
                        {/* Terminate */}
                        <button
                          disabled={!isApproved || (!isActive && !isSuspended)}
                          title={!isApproved ? 'Employee must be approved first' : ''}
                          onClick={() => openLifecycleModal('terminate')}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <XCircle className="w-4 h-4 text-red-600" /> Terminate Employee
                        </button>
                        {/* Reinstate */}
                        <button
                          disabled={!isApproved || !isSuspended}
                          title={!isSuspended ? 'Only suspended employees can be reinstated' : ''}
                          onClick={() => { setIsMoreOpen(false); handleReinstate(); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <CheckCircle className="w-4 h-4 text-emerald-500" /> Reinstate Employee
                        </button>
                        </>)}
                        {canEditEmp && (<>
                        <div className="my-1 border-t border-[var(--border)]" />
                        <button
                          onClick={() => { setIsMoreOpen(false); fileInputRef.current?.click(); }}
                          disabled={photoUploading}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-left disabled:opacity-50"
                        >
                          {photoUploading ? <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" /> : <UploadCloud className="w-4 h-4 text-[var(--accent)]" />}
                          Upload Photo
                        </button>
                        {localPhoto && (
                          <button
                            onClick={() => { setIsMoreOpen(false); handlePhotoRemove(); }}
                            disabled={photoUploading}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors text-left disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4 text-[var(--danger)]" /> Remove Photo
                          </button>
                        )}
                        </>)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                )}

                {/* Close */}
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Hero card — matches PersonalInfo design ── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
            >
              {/* Gradient banner */}
              <div className="relative h-28 sm:h-36"
                style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #7c3aed 50%, #0891b2 100%)' }}
              >
                <div className="absolute inset-0 opacity-10"
                  style={{ backgroundImage: 'radial-gradient(circle at 25% 50%, white 1px, transparent 1px), radial-gradient(circle at 75% 50%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }}
                />
                {/* Status badge — top right only */}
                {!isRejected && employee.lifecycleStatus && (
                  <div className="absolute top-4 right-4">
                    <LifecycleBadge status={employee.lifecycleStatus} />
                  </div>
                )}
                {isRejected && (
                  <div className="absolute top-4 right-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-500/20 text-white border border-rose-400/40">
                      Application Rejected
                    </span>
                  </div>
                )}
              </div>

              {/* Profile content */}
              <div className="px-5 sm:px-7 pb-6">
                <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-4 sm:-mt-6 mb-5">
                  {/* Avatar */}
                  <div className="relative shrink-0 group">
                    <div
                      className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-4 border-[var(--surface)] overflow-hidden cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                      title="Click to upload photo"
                      style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}
                    >
                      {localPhoto ? (
                        <img src={localPhoto} alt={fullName} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white font-bold text-xl syne"
                          style={{ background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)' }}>
                          {initials || <User className="w-8 h-8" />}
                        </div>
                      )}
                      {photoUploading && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-2xl">
                          <Loader2 className="w-5 h-5 text-white animate-spin" />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-xl bg-[var(--accent)] text-white border-2 border-[var(--surface)] flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                      title="Change photo"
                    >
                      <Camera className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Name + role */}
                  <div className="flex-1 min-w-0 pb-1">
                    <h1 className="text-[20px] sm:text-[24px] font-bold text-[var(--text-primary)] syne leading-tight truncate">{fullName}</h1>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {employee.jobTitle?.label && (
                        <span className="text-[13px] text-[var(--text-secondary)] font-medium">{employee.jobTitle.label}</span>
                      )}
                      {employee.jobTitle?.label && employee.employee_id && (
                        <span className="text-[var(--text-muted)]">·</span>
                      )}
                      {employee.employee_id && (
                        <span className="font-mono text-[12px] text-[var(--text-muted)] flex items-center gap-1">
                          <Hash className="w-3 h-3" />{employee.employee_id}
                          <CopyButton value={employee.employee_id} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status badges — after flex row, before stat chips */}
                {isPending && (
                  <div className="mb-3">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--warning-dim)] text-[var(--warning)] border border-[var(--warning)]/20">
                      Awaiting Approval
                    </span>
                  </div>
                )}

                {isPending && pendingChanges.length > 0 && (
                  <div className="mb-4">
                    <EmployeeChangeComparison changes={pendingChanges} />
                  </div>
                )}

                {/* Rejection notice */}
                {isRejected && (
                  <div className="mb-4 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--danger-dim)] border border-[var(--danger)]/20">
                    <XCircle className="w-3.5 h-3.5 text-[var(--danger)] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[12px] font-semibold text-[var(--danger)]">
                        {employee.actionReason ? `Reason: ${employee.actionReason}` : 'This application was rejected. Edit the record to re-submit for approval.'}
                      </p>
                      {employee.actionReason && (
                        <p className="text-[11px] text-[var(--danger)] opacity-75 mt-0.5">Edit the record to correct and re-submit for approval.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Quick stat chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <StatChipSlide icon={Building}  label="Department" value={employee.department?.title} accent="#0066b3" />
                  <StatChipSlide icon={Briefcase} label="Job Title"  value={employee.jobTitle?.label}   accent="#059669" />
                  <StatChipSlide icon={Calendar}  label="Hire Date"  value={fmtDate(employee.hireDate)} accent="#7c3aed" />
                  <StatChipSlide icon={Phone}     label="Mobile"     value={employee.mobilePhone}       accent="#b45309" />
                </div>
              </div>
            </motion.div>

            {/* ── Tab bar ── */}
            <motion.div
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.06 }}
              className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] px-2 py-1.5 flex flex-wrap items-center gap-1"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
            >
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12.5px] font-medium whitespace-nowrap transition-all shrink-0"
                  style={{
                    background: activeTab === t.id ? 'var(--accent-dim)' : 'transparent',
                    color:      activeTab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: activeTab === t.id ? 700 : 500,
                    boxShadow:  activeTab === t.id ? '0 0 0 1px rgba(37,99,235,0.2) inset' : 'none',
                  }}
                >
                  <t.icon className="w-3.5 h-3.5 shrink-0" />
                  {t.label}
                </button>
              ))}
            </motion.div>

            {/* ── Tab content ── */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>
          <DocumentViewer document={documentToView} onClose={() => setDocumentToView(null)} />
        </motion.div>
      )}

      {/* ── Suspend modal ── */}
      <AnimatePresence>
        {showSuspendModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowSuspendModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.15 }}
              className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 z-10">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="text-[15px] font-bold text-slate-900 mb-1">Suspend Employee?</h3>
              <p className="text-[13px] text-slate-500 mb-4">
                Submit a suspension request for <span className="font-semibold text-slate-700">{fullName}</span>. The request will go to the approval queue before taking effect.
              </p>
              {positionImpact && (positionImpact.reportees.length > 0 || positionImpact.isThresholdApprover) && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1.5">
                  <p className="text-[12px] font-bold text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Position Impact
                  </p>
                  {positionImpact.reportees.length > 0 && (
                    <p className="text-[12px] text-amber-700 leading-snug">
                      <span className="font-semibold">{positionImpact.reportees.length} employee{positionImpact.reportees.length > 1 ? 's' : ''}</span> currently report{positionImpact.reportees.length === 1 ? 's' : ''} to this person as supervisor:{' '}
                      {positionImpact.reportees.slice(0, 3).map((r: any) => r.name).join(', ')}
                      {positionImpact.reportees.length > 3 ? ` and ${positionImpact.reportees.length - 3} more` : ''}.
                      Consider reassigning their supervisor.
                    </p>
                  )}
                  {positionImpact.isThresholdApprover && (
                    <p className="text-[12px] text-amber-700 leading-snug">
                      This employee is a <span className="font-semibold">designated financial approver</span> for leave allowance threshold sign-offs. Review the approver list in Settings → Controls → Leave.
                    </p>
                  )}
                </div>
              )}
              <div className="mb-5">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Reason <span className="font-normal normal-case text-red-500">*</span>
                </label>
                <CountedTextarea rows={3} maxChars={1000} value={actionReason} onChange={e => setActionReason(e.target.value)}
                  placeholder="Enter reason for suspension…"
                  className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300 transition-all resize-none" />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowSuspendModal(false)} disabled={actionLoading}
                  className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleSuspend} disabled={actionLoading || !actionReason.trim()}
                  className="px-4 py-2 text-[13px] font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {actionLoading ? 'Submitting…' : 'Submit for Approval'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Initiate Resignation modal ── */}
      <AnimatePresence>
        {showResignModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowResignModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.15 }}
              className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 z-10">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center mb-4">
                <LogOut className="w-5 h-5 text-rose-500" />
              </div>
              <h3 className="text-[15px] font-bold text-slate-900 mb-1">Initiate Resignation</h3>
              <p className="text-[13px] text-slate-500 mb-4">
                Submit a resignation request for <span className="font-semibold text-slate-700">{fullName}</span>. The request will go to the approval queue before taking effect.
              </p>
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Effective Date
                </label>
                <input type="date" value={resignDate} onChange={e => setResignDate(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-300 transition-all" />
              </div>
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Reason
                </label>
                <CountedTextarea rows={3} maxChars={1000} value={actionReason} onChange={e => setActionReason(e.target.value)}
                  placeholder="Enter reason for resignation…"
                  className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-300 transition-all resize-none" />
              </div>
              <div className="mb-5">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Resignation Letter <span className="font-normal normal-case text-slate-400">(optional)</span>
                </label>
                <button type="button"
                  onClick={() => resignLetterInputRef.current?.click()}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] bg-slate-50 border border-dashed border-slate-300 hover:border-rose-400 hover:bg-rose-50 rounded-xl transition-all text-slate-500 hover:text-rose-600">
                  <UploadCloud className="w-4 h-4 shrink-0" />
                  <span className="truncate">{resignLetterFile ? resignLetterFile.name : 'Click to upload resignation letter'}</span>
                </button>
                {resignLetterFile && (
                  <button type="button" onClick={() => setResignLetterFile(null)}
                    className="mt-1 text-[11px] text-rose-500 hover:underline">
                    Remove
                  </button>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => { setShowResignModal(false); setResignLetterFile(null); }} disabled={actionLoading}
                  className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleResign} disabled={actionLoading}
                  className="px-4 py-2 text-[13px] font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {actionLoading ? 'Submitting…' : 'Submit for Approval'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Terminate modal ── */}
      <AnimatePresence>
        {showTerminateModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowTerminateModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.15 }}
              className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 z-10">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center mb-4">
                <XCircle className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-[15px] font-bold text-slate-900 mb-1">Terminate Employee?</h3>
              <p className="text-[13px] text-slate-500 mb-4">
                Submit a termination request for <span className="font-semibold text-slate-700">{fullName}</span>. The request will go to the approval queue before taking effect.
              </p>
              {positionImpact && (positionImpact.reportees.length > 0 || positionImpact.isThresholdApprover) && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
                  <p className="text-[12px] font-bold text-red-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Position Impact
                  </p>
                  {positionImpact.reportees.length > 0 && (
                    <p className="text-[12px] text-red-700 leading-snug">
                      <span className="font-semibold">{positionImpact.reportees.length} employee{positionImpact.reportees.length > 1 ? 's' : ''}</span> currently report{positionImpact.reportees.length === 1 ? 's' : ''} to this person as supervisor:{' '}
                      {positionImpact.reportees.slice(0, 3).map((r: any) => r.name).join(', ')}
                      {positionImpact.reportees.length > 3 ? ` and ${positionImpact.reportees.length - 3} more` : ''}.
                      Consider reassigning their supervisor.
                    </p>
                  )}
                  {positionImpact.isThresholdApprover && (
                    <p className="text-[12px] text-red-700 leading-snug">
                      This employee is a <span className="font-semibold">designated financial approver</span> for leave allowance threshold sign-offs. Review the approver list in Settings → Controls → Leave.
                    </p>
                  )}
                </div>
              )}
              <div className="mb-5">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Reason <span className="font-normal normal-case text-red-500">*</span>
                </label>
                <CountedTextarea rows={3} maxChars={1000} value={actionReason} onChange={e => setActionReason(e.target.value)}
                  placeholder="Enter reason for termination…"
                  className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 transition-all resize-none" />
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowTerminateModal(false)} disabled={actionLoading}
                  className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleTerminate} disabled={actionLoading || !actionReason.trim()}
                  className="px-4 py-2 text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {actionLoading ? 'Submitting…' : 'Submit for Approval'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject reason modal */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          >
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowRejectModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.15 }}
              className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 z-10"
            >
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center mb-4">
                <XCircle className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="text-[15px] font-bold text-slate-900 mb-1">Reject Application?</h3>
              <p className="text-[13px] text-slate-500 mb-4">
                Reject the application for <span className="font-semibold text-slate-700">{fullName}</span>?
              </p>
              <div className="mb-5">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Reason <span className="font-normal normal-case">(optional)</span>
                </label>
                <CountedTextarea
                  rows={3}
                  maxChars={500}
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  placeholder="Enter reason for rejection…"
                  className="w-full px-3 py-2 text-[13px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-300 transition-all resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowRejectModal(false)}
                  disabled={rejecting}
                  className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejecting}
                  className="px-4 py-2 text-[13px] font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {rejecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {rejecting ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
