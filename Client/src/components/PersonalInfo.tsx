import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  User, Briefcase, Heart, GraduationCap, FileText, Phone, Mail,
  MapPin, IdCard, CreditCard, Building2, Calendar, Award, Globe,
  Brain, Users, Loader2, CheckCircle, Copy, Camera, FileCheck,
  Baby, HeartPulse, AlertCircle, Hash, Star, Shield, Landmark, Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { employeeFieldVisible } from '../../lib/settings';

// ── Types ─────────────────────────────────────────────────────────────────────
type TabId = 'Personal' | 'Employment' | 'Relationships' | 'Qualifications' | 'Documents' | 'Leave' | 'Attendance';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: any): string | null => (v != null && v !== '' ? String(v) : null);

const fmtDate = (v: string | null | undefined): string | null => {
  if (!v) return null;
  try { return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return null; }
};

function profLabel(k: string | null | undefined) {
  if (!k) return '—';
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Sub-components ────────────────────────────────────────────────────────────

const CopyBtn: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button onClick={copy} title="Copy" className="ml-1.5 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors shrink-0">
      <AnimatePresence mode="wait" initial={false}>
        {copied
          ? <motion.span key="y" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}><CheckCircle className="w-3 h-3 text-[var(--success)]" /></motion.span>
          : <motion.span key="n" initial={{ scale: 0.5 }} animate={{ scale: 1 }} exit={{ scale: 0.5 }}><Copy className="w-3 h-3" /></motion.span>
        }
      </AnimatePresence>
    </button>
  );
};

const Field: React.FC<{ label: string; value?: React.ReactNode; copiable?: string; span2?: boolean; monospace?: boolean; fieldKey?: string }> = ({
  label, value, copiable, span2 = false, monospace = false, fieldKey,
}) => {
  // Rows tied to a configurable field hide when that field is turned off in Controls → Employee Form.
  if (fieldKey && !employeeFieldVisible(fieldKey)) return null;
  const isEmpty = value == null || value === '' || value === '—';
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <p className="text-[10px] font-bold tracking-[0.1em] uppercase text-[var(--text-muted)] mb-1">{label}</p>
      <div className="flex items-center gap-0.5">
        <p className={`text-[13px] font-medium leading-snug break-words ${monospace ? 'font-mono' : ''} ${isEmpty ? 'text-[var(--text-muted)] italic font-normal' : 'text-[var(--text-primary)]'}`}>
          {isEmpty ? '—' : value}
        </p>
        {copiable && !isEmpty && <CopyBtn value={copiable} />}
      </div>
    </div>
  );
};

const Card: React.FC<{
  title: string; icon: React.ElementType; accent?: string; children: React.ReactNode; className?: string;
}> = ({ title, icon: Icon, accent = 'var(--accent)', children, className = '' }) => (
  <div className={`bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden ${className}`} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--border)]">
      <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)` }}>
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
      </div>
      <h3 className="text-[11px] font-bold tracking-[0.07em] uppercase" style={{ color: accent }}>{title}</h3>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const map: Record<string, { bg: string; text: string; dot: string }> = {
    ACTIVE:     { bg: 'var(--success-dim)', text: 'var(--success)', dot: 'var(--success)' },
    PENDING:    { bg: 'var(--warning-dim)', text: 'var(--warning)', dot: 'var(--warning)' },
    SUSPENDED:  { bg: 'var(--warning-dim)', text: 'var(--warning)', dot: 'var(--warning)' },
    TERMINATED: { bg: 'var(--danger-dim)',  text: 'var(--danger)',  dot: 'var(--danger)'  },
    RESIGNED:   { bg: 'var(--surface-hover)', text: 'var(--text-secondary)', dot: 'var(--text-muted)' },
  };
  const s = map[status] ?? map['PENDING'];
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold"
      style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: s.dot }} />
      {status}
    </span>
  );
};

function MiniTable({ cols, rows, empty }: { cols: string[]; rows: (React.ReactNode | null)[][]; empty: string }) {
  if (rows.length === 0) return (
    <div className="flex flex-col items-center py-8 gap-2">
      <div className="w-10 h-10 rounded-full bg-[var(--surface-hover)] flex items-center justify-center">
        <AlertCircle className="w-4 h-4 text-[var(--text-muted)]" />
      </div>
      <p className="text-[12px] text-[var(--text-muted)] italic">{empty}</p>
    </div>
  );
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c} className="text-left px-2 pb-2.5 text-[10px] font-bold tracking-[0.08em] uppercase text-[var(--text-muted)] border-b border-[var(--border)] whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-[var(--border-light)] last:border-0 hover:bg-[var(--surface-hover)] transition-colors">
              {cells.map((cell, j) => (
                <td key={j} className="px-2 py-2.5 text-[var(--text-secondary)] align-top">{cell ?? <span className="text-[var(--text-muted)] italic">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────
function Skeleton({ className = '' }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-[var(--border)] rounded-lg animate-pulse ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="p-4 sm:p-6 max-w-[1100px] mx-auto space-y-4">
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-[var(--accent-dim)] to-[var(--purple-dim)]" />
        <div className="px-6 pb-6">
          <div className="flex items-end gap-4 -mt-8 mb-4">
            <Skeleton className="w-20 h-20 rounded-2xl shrink-0" />
            <div className="space-y-2 pb-1 flex-1">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center gap-3">
              <Skeleton className="w-7 h-7 rounded-xl" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="p-5 grid grid-cols-2 gap-4">
              {[...Array(4)].map((_, j) => (
                <div key={j} className="space-y-1.5">
                  <Skeleton className="h-2 w-16" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── No profile state ──────────────────────────────────────────────────────────
function NoProfile() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center">
        <User className="w-7 h-7 text-[var(--text-muted)]" />
      </div>
      <div className="text-center">
        <p className="text-[15px] font-semibold text-[var(--text-primary)]">No employee profile linked</p>
        <p className="text-[13px] text-[var(--text-muted)] mt-1">Contact HR to link your account to an employee record.</p>
      </div>
    </div>
  );
}

// ── Tab panels ────────────────────────────────────────────────────────────────

const PersonalPanel: React.FC<{ emp: any }> = ({ emp }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <Card title="Basic Information" icon={User} accent="#7c3aed">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Field label="Date of Birth"  value={fmtDate(emp.dateOfBirth)}   fieldKey="dateOfBirth" />
        <Field label="Place of Birth" value={fmt(emp.place_of_birth)}     fieldKey="place_of_birth" />
        <Field label="Gender"         value={emp.gender?.label}           fieldKey="genderId" />
        <Field label="Nationality"    value={emp.nationality?.label}      fieldKey="nationalityId" />
        <Field label="Religion"       value={emp.religion?.label}         fieldKey="religionId" />
        <Field label="Marital Status" value={fmt(emp.marital_status)}     fieldKey="marital_status" />
        {emp.marital_status === 'Married' && (
          <Field label="Spouse" value={fmt(emp.spouse_name)} fieldKey="spouse_name" />
        )}
        <Field label="Father's Name"  value={fmt(emp.father_name)}        fieldKey="father_name" />
        <Field label="Mother's Name"  value={fmt(emp.mother_name)}        fieldKey="mother_name" />
      </div>
    </Card>

    <Card title="Contact Details" icon={MapPin} accent="#0284c7">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Field label="Mobile"         value={fmt(emp.mobilePhone)}                 copiable={emp.mobilePhone ?? undefined} fieldKey="mobilePhone" />
        <Field label="Work Phone"     value={fmt(emp.phone)}                       copiable={emp.phone ?? undefined} />
        <Field label="Work Email"     value={fmt(emp.work_email ?? emp.email)}     copiable={emp.work_email ?? emp.email ?? undefined} fieldKey="work_email" />
        <Field label="Personal Email" value={fmt(emp.personal_email)}              copiable={emp.personal_email ?? undefined} fieldKey="personal_email" />
        <Field label="Address" value={[emp.address1, emp.city, emp.country].filter(Boolean).join(', ') || null} span2 fieldKey="address1" />
      </div>
    </Card>

    <div className="lg:col-span-2">
      <Card title="Identification Documents" icon={IdCard} accent="#b45309">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
          <Field label="National ID"      value={fmt(emp.nationalIdNumber)}   copiable={emp.nationalIdNumber ?? undefined} monospace fieldKey="nationalIdNumber" />
          <Field label="NIN Expiry"       value={fmtDate(emp.nationalIdExpiry)} fieldKey="nationalIdExpiry" />
          <Field label="SSN"   value={fmt(emp.ssn_num)}            copiable={emp.ssn_num ?? undefined} monospace fieldKey="ssn_num" />
          <Field label="Passport No."     value={fmt(emp.passportNumber)}     copiable={emp.passportNumber ?? undefined} monospace fieldKey="passportNumber" />
          <Field label="Passport Expiry"  value={fmtDate(emp.passportExpiry)} fieldKey="passportExpiry" />
          <Field label="Driver's License" value={fmt(emp.driverLicenseNum)}   copiable={emp.driverLicenseNum ?? undefined} monospace fieldKey="driverLicenseNum" />
          <Field label="License Expiry"   value={fmtDate(emp.driverLicenseExp)} fieldKey="driverLicenseExp" />
        </div>
      </Card>
    </div>
  </div>
);

const EmploymentPanel: React.FC<{ emp: any }> = ({ emp }) => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <Card title="Job Details" icon={Briefcase} accent="#059669">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Field label="Employee ID"       value={fmt(emp.employee_id)}              copiable={emp.employee_id ?? undefined} monospace />
        <Field label="Job Title"         value={emp.jobTitle?.label}               fieldKey="jobTitleId" />
        <Field label="Employment Status" value={emp.employmentStatus?.label}       fieldKey="employmentStatusId" />
        <Field label="Staff Level"       value={emp.staffLevel?.label ?? fmt(emp.staff_level)} fieldKey="staff_level" />
        <Field label="Staff Role"        value={emp.staffRole?.label  ?? fmt(emp.staff_role)}  fieldKey="staff_role" />
        <Field label="Hire Date"         value={fmtDate(emp.hireDate)}             fieldKey="hireDate" />
        <Field label="Confirmation Date" value={fmtDate(emp.confirmationDate)}     fieldKey="confirmationDate" />
        <Field label="Retirement Date"   value={fmtDate(emp.retirement_date)}      />
      </div>
    </Card>

    <Card title="Organisation" icon={Building2} accent="#0066b3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5">
        <Field label="Department"  value={emp.department?.title}  fieldKey="departmentId" />
        <Field label="Branch"      value={emp.branch?.title}      fieldKey="branchId" />
        <Field label="Unit"        value={emp.unit?.title}        fieldKey="unitId" />
        <Field label="Outlet"      value={emp.outlet?.title}      fieldKey="outletId" />
        <Field label="Supervisor"  value={emp.supervisor?.name}   span2 fieldKey="supervisorId" />
      </div>
    </Card>

    <div className="lg:col-span-2">
      <Card title="Payroll & Financial" icon={CreditCard} accent="#7c3aed">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
          <Field label="Paygrade"    value={fmt(emp.paygrade)} fieldKey="paygradeId" />
          <Field label="Notch"       value={fmt(emp.notch)} fieldKey="notcheId" />
          <Field label="Bank Account" value={fmt(emp.bankAccount)} copiable={emp.bankAccount ?? undefined} monospace fieldKey="bankAccount" />
        </div>
      </Card>
    </div>
  </div>
);

const RelationshipsPanel: React.FC<{ emp: any }> = ({ emp }) => {
  const empId = String(emp.id);
  const [dependents, setDependents]   = useState<any[]>([]);
  const [contacts, setContacts]       = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/dependents'),
      api.get('/emergency-contacts'),
    ]).then(([d, c]) => {
      setDependents((d.data.data ?? []).filter((r: any) => String(r.employee?.id) === empId || String(r.employeeId) === empId));
      setContacts((c.data.data ?? []).filter((r: any) => String(r.employee?.id) === empId || String(r.employeeId) === empId));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [empId]);

  return (
    <div className="space-y-4">
      <Card title="Next of Kin" icon={Heart} accent="#e11d48">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Field label="Full Name" value={fmt(emp.nxt_kin_fname)} span2 fieldKey="nxt_kin_fname" />
          <Field label="Phone"     value={fmt(emp.nxt_kin_phone)} copiable={emp.nxt_kin_phone ?? undefined} fieldKey="nxt_kin_phone" />
          <Field label="Email"     value={fmt(emp.nxt_kin_email)} copiable={emp.nxt_kin_email ?? undefined} fieldKey="nxt_kin_email" />
          <Field label="Address"   value={fmt(emp.nxt_kin_address)} span2 fieldKey="nxt_kin_address" />
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" /></div>
      ) : (
        <>
          <Card title="Dependents" icon={Baby} accent="#0284c7">
            <MiniTable
              cols={['Name', 'Relationship', 'Gender', 'Date of Birth', 'Place of Birth']}
              rows={dependents.map(r => [r.name, r.relationshipLabel ?? r.relationship, r.genderLabel ?? r.gender, fmtDate(r.dob), r.place_of_birth])}
              empty="No dependents on record"
            />
          </Card>

          <Card title="Emergency Contacts" icon={HeartPulse} accent="#dc2626">
            <MiniTable
              cols={['Name', 'Relationship', 'Home Phone', 'Work Phone', 'Mobile']}
              rows={contacts.map(r => [r.name, r.relationshipLabel ?? r.relationship, r.home_phone, r.work_phone, r.mobile_phone])}
              empty="No emergency contacts on record"
            />
          </Card>
        </>
      )}
    </div>
  );
};

const QualificationsPanel: React.FC<{ emp: any }> = ({ emp }) => {
  const empId = String(emp.id);
  const [skills, setSkills]   = useState<any[]>([]);
  const [certs, setCerts]     = useState<any[]>([]);
  const [edus, setEdus]       = useState<any[]>([]);
  const [langs, setLangs]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/skills'),
      api.get('/certifications'),
      api.get('/education'),
      api.get('/languages'),
    ]).then(([s, c, e, l]) => {
      const byEmp = (arr: any[]) => arr.filter((r: any) => String(r.employee?.id) === empId || String(r.employeeId) === empId);
      setSkills(byEmp(s.data.data ?? []));
      setCerts(byEmp(c.data.data ?? []));
      setEdus(byEmp(e.data.data ?? []));
      setLangs(byEmp(l.data.data ?? []));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [empId]);

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
  );

  return (
    <div className="space-y-4">
      <Card title="Skills" icon={Award} accent="#7c3aed">
        <MiniTable
          cols={['Skill', 'Details']}
          rows={skills.map(r => [r.skill?.label, r.details])}
          empty="No skills on record"
        />
      </Card>

      <Card title="Certifications" icon={GraduationCap} accent="#0066b3">
        <MiniTable
          cols={['Certification', 'Institute', 'Granted', 'Valid Thru']}
          rows={certs.map(r => [r.certification?.label, r.institute, fmtDate(r.date_start), fmtDate(r.date_end)])}
          empty="No certifications on record"
        />
      </Card>

      <Card title="Education" icon={Brain} accent="#059669">
        <MiniTable
          cols={['Type', 'Institution', 'From', 'To']}
          rows={edus.map(r => [r.institutionType?.label, r.institute, fmtDate(r.date_start), fmtDate(r.date_end)])}
          empty="No education records"
        />
      </Card>

      <Card title="Languages" icon={Globe} accent="#b45309">
        <MiniTable
          cols={['Language', 'Reading', 'Speaking', 'Writing', 'Understanding']}
          rows={langs.map(r => [r.language?.label, profLabel(r.reading), profLabel(r.speaking), profLabel(r.writing), profLabel(r.understanding)])}
          empty="No language records"
        />
      </Card>
    </div>
  );
};

const DocumentsPanel: React.FC<{ emp: any }> = ({ emp }) => {
  const docs = [
    { label: 'Fit & Proper Form',   value: emp.fit_and_proper,   key: 'fit_and_proper'   },
    { label: 'Police Clearance',    value: emp.policeClearance,  key: 'policeClearance'  },
    { label: 'Medical Clearance',   value: emp.medicalClearance, key: 'medicalClearance' },
  ].filter(d => employeeFieldVisible(d.key));

  return (
    <Card title="Clearance Documents" icon={FileText} accent="#475569">
      <div className="space-y-1">
        {docs.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-3.5 border-b border-[var(--border-light)] last:border-0">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${value ? 'bg-[var(--success-dim)]' : 'bg-[var(--surface-hover)]'}`}>
                {value
                  ? <FileCheck className="w-4 h-4 text-[var(--success)]" />
                  : <FileText className="w-4 h-4 text-[var(--text-muted)]" />}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</p>
                <p className={`text-[11px] mt-0.5 ${value ? 'text-[var(--success)]' : 'text-[var(--text-muted)] italic'}`}>
                  {value ? 'Document on file' : 'Not uploaded'}
                </p>
              </div>
            </div>
            {value && (
              <a
                href={`/v1/api/hr/documents/${encodeURIComponent(value)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-colors"
                title="View document"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </a>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

// ── Leave status pill ─────────────────────────────────────────────────────────
function leaveStatusPill(status: string) {
  const map: Record<string, string> = {
    'Approved':            'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Pending Approval':    'bg-amber-50 text-amber-700 border-amber-200',
    'Pending HR Approval': 'bg-blue-50 text-blue-700 border-blue-200',
    'Pending Financial Approval': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'Rejected':            'bg-rose-50 text-rose-700 border-rose-200',
    'Cancelled':           'bg-slate-100 text-slate-500 border-slate-200',
    'Draft':               'bg-slate-50 text-slate-500 border-slate-200',
  };
  const cls = map[status] ?? 'bg-slate-50 text-slate-500 border-slate-200';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border ${cls}`}>{status}</span>;
}

const LeavePanel: React.FC<{ emp: any }> = ({ emp }) => {
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/leave/leaves/all?employee=${emp.id}`)
      .then(r => setLeaves(r.data.data ?? []))
      .catch(() => setLeaves([]))
      .finally(() => setLoading(false));
  }, [emp.id]);

  if (loading) return (
    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
  );

  return (
    <Card title="Leave Records" icon={Calendar} accent="#7c3aed">
      <MiniTable
        cols={['Leave Type', 'Period', 'Start', 'End', 'Days', 'Status']}
        rows={leaves.map(l => [
          <span key="t" className="flex items-center gap-1.5">
            {l.leave_color && <span className="w-2.5 h-2.5 rounded-full shrink-0 inline-block" style={{ background: l.leave_color }} />}
            {l.leave_type_name ?? '—'}
          </span>,
          l.period_name ?? '—',
          fmtDate(l.date_start),
          fmtDate(l.date_end),
          l.day_count ?? '—',
          leaveStatusPill(l.status ?? 'Draft'),
        ])}
        empty="No leave records found"
      />
    </Card>
  );
};

const AttendancePanel: React.FC = () => (
  <Card title="Attendance" icon={Activity} accent="#0284c7">
    <div className="flex flex-col items-center py-10 gap-3">
      <div className="w-12 h-12 rounded-full bg-[var(--surface-hover)] flex items-center justify-center">
        <Activity className="w-5 h-5 text-[var(--text-muted)]" />
      </div>
      <p className="text-[13px] font-medium text-[var(--text-muted)]">Attendance records coming soon</p>
    </div>
  </Card>
);

// ── Quick stat chip ───────────────────────────────────────────────────────────
const StatChip: React.FC<{ icon: React.ElementType; label: string; value: string | null | undefined; accent?: string }> = ({
  icon: Icon, label, value, accent = 'var(--accent)',
}) => (
  <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--surface-hover)] rounded-xl border border-[var(--border)]">
    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${accent} 10%, transparent)` }}>
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

// ── Main component ────────────────────────────────────────────────────────────
export function PersonalInfo() {
  const currentUser = getCurrentUser();
  const [emp, setEmp]           = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('Personal');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!currentUser?.employeeId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/employees/${currentUser.employeeId}`)
      .then(r => {
        const data = r.data.data;
        setEmp(data);
        setLocalPhoto(data?.profile_imagebase64 ?? null);
      })
      .catch(() => toast.error('Failed to load your profile'))
      .finally(() => setLoading(false));
  }, [currentUser?.employeeId]);

  useEffect(() => { load(); }, [load]);

  const resizeImage = (file: File, maxPx = 800, quality = 0.85): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width >= height) { height = Math.round((height / width) * maxPx); width = maxPx; }
          else { width = Math.round((width / height) * maxPx); height = maxPx; }
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
      const b64 = await resizeImage(file);
      await api.put(`/employees/${emp.id}`, { profile_imagebase64: b64 });
      setLocalPhoto(b64);
      toast.success('Photo updated');
    } catch { toast.error('Failed to upload photo'); }
    finally { setPhotoUploading(false); e.target.value = ''; }
  };

  if (loading) return <LoadingSkeleton />;
  if (!currentUser?.employeeId || !emp) return <NoProfile />;

  const fullName = `${emp.firstName ?? ''} ${emp.middleName ? emp.middleName + ' ' : ''}${emp.lastName ?? ''}`.trim();
  const initials = `${(emp.firstName?.[0] ?? '').toUpperCase()}${(emp.lastName?.[0] ?? '').toUpperCase()}`;

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'Personal',       label: 'Personal',       icon: User          },
    { id: 'Employment',     label: 'Employment',     icon: Briefcase     },
    { id: 'Relationships',  label: 'Relationships',  icon: Heart         },
    { id: 'Qualifications', label: 'Qualifications', icon: GraduationCap },
    { id: 'Documents',      label: 'Documents',      icon: FileText      },
    { id: 'Leave',          label: 'Leave',          icon: Calendar      },
    { id: 'Attendance',     label: 'Attendance',     icon: Activity      },
  ];

  const renderPanel = () => {
    switch (activeTab) {
      case 'Personal':       return <PersonalPanel       emp={emp} />;
      case 'Employment':     return <EmploymentPanel     emp={emp} />;
      case 'Relationships':  return <RelationshipsPanel  emp={emp} />;
      case 'Qualifications': return <QualificationsPanel emp={emp} />;
      case 'Documents':      return <DocumentsPanel      emp={emp} />;
      case 'Leave':          return <LeavePanel          emp={emp} />;
      case 'Attendance':     return <AttendancePanel />;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFile} />

      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* ── Hero card ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden"
          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
        >
          {/* Gradient banner */}
          <div className="relative h-28 sm:h-36"
            style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #7c3aed 50%, #0891b2 100%)' }}
          >
            {/* Decorative pattern */}
            <div className="absolute inset-0 opacity-10"
              style={{ backgroundImage: 'radial-gradient(circle at 25% 50%, white 1px, transparent 1px), radial-gradient(circle at 75% 50%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }}
            />
            {/* Lifecycle status — top right */}
            {emp.lifecycleStatus && (
              <div className="absolute top-4 right-4">
                <StatusBadge status={emp.lifecycleStatus} />
              </div>
            )}
          </div>

          {/* Profile section */}
          <div className="px-5 sm:px-7 pb-6">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-4 sm:-mt-6 mb-5">
              {/* Avatar */}
              <div className="relative shrink-0 group">
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-4 border-[var(--surface)] overflow-hidden shadow-lg"
                  style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
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
                  onClick={() => fileRef.current?.click()}
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
                  {emp.jobTitle?.label && (
                    <span className="text-[13px] text-[var(--text-secondary)] font-medium">{emp.jobTitle.label}</span>
                  )}
                  {emp.jobTitle?.label && emp.employee_id && (
                    <span className="text-[var(--text-muted)]">·</span>
                  )}
                  {emp.employee_id && (
                    <span className="font-mono text-[12px] text-[var(--text-muted)] flex items-center gap-1">
                      <Hash className="w-3 h-3" />{emp.employee_id}
                      <CopyBtn value={emp.employee_id} />
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick stat chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <StatChip icon={Building2}  label="Department"    value={emp.department?.title}             accent="#0066b3" />
              <StatChip icon={Briefcase}  label="Job Title"     value={emp.jobTitle?.label}               accent="#059669" />
              <StatChip icon={Calendar}   label="Hire Date"     value={fmtDate(emp.hireDate)}             accent="#7c3aed" />
              <StatChip icon={Shield}     label="Status"        value={emp.employmentStatus?.label}       accent="#b45309" />
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
                background:  activeTab === t.id ? 'var(--accent-dim)' : 'transparent',
                color:       activeTab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight:  activeTab === t.id ? 700 : 500,
                boxShadow:   activeTab === t.id ? '0 0 0 1px rgba(37,99,235,0.2) inset' : 'none',
              }}
            >
              <t.icon className="w-3.5 h-3.5 shrink-0" />
              {t.label}
            </button>
          ))}
        </motion.div>

        {/* ── Panel ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {renderPanel()}
          </motion.div>
        </AnimatePresence>

      </div>
    </div>
  );
}
