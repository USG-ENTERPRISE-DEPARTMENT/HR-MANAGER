import React, { useState, useEffect, useMemo, useRef } from 'react';
import { UserPlus, X, UploadCloud, FileCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { getSettings } from '../../lib/settings';
import { formatEmployeeId, EMPLOYEE_ID_MAX_LENGTH } from '../../lib/employeeIdFormat';
import { Combobox } from './EmployeeTabs';
import { EMPLOYEE_FORM_FIELDS, EMPLOYEE_FORM_FIELDS_BY_KEY } from '../config/employeeFormFields';

interface Props {
  onClose: () => void;
  onSave: (data: any, id?: string) => void;
  initialData?: any | null;
}

const STEPS = [
  { id: 'personal',   label: 'Personal'    },
  { id: 'employment', label: 'Employment'  },
  { id: 'nextofkin',  label: 'Next of Kin' },
  { id: 'financial',  label: 'Financial'   },
  { id: 'documents',  label: 'Documents'   },
];

const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'];

const SectionHeader = ({ title }: { title: string }) => (
  <h3 className="syne font-extrabold text-[var(--accent)] uppercase tracking-wider mb-6 text-[12px]">{title}</h3>
);

function Field({ label, required, className, children }: {
  label: string; required?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={`col-span-1 ${className ?? ''}`}>
      <label className="label">{label}{required && <span className="text-[var(--danger)]"> *</span>}</label>
      {children}
    </div>
  );
}

export function EmployeeFormFull({ onClose, onSave, initialData }: Props) {
  // Edit vs create is keyed on a real id, so a prefilled-but-new record (e.g. an
  // onboarding submission being converted) is still created via POST.
  const isEdit = !!initialData?.id;

  const [step, setStep] = useState(0);
  const autoGenEmpNum = getSettings().employees.autoGenerateNumber;

  const [form, setForm] = useState<any>(() => ({
    // Employment number (manual entry when auto-gen is off)
    employee_id:      '',
    // Personal
    titleId:          '',
    firstName:        '',
    middleName:       '',
    lastName:         '',
    genderId:         '',
    dateOfBirth:      '',
    place_of_birth:   '',
    nationalityId:    '',
    religionId:       '',
    marital_status:   '',
    spouse_name:      '',
    father_name:      '',
    mother_name:      '',
    address1:         '',
    city:             '',
    country:          '',
    // Contact
    work_email:       '',
    personal_email:   '',
    mobilePhone:      '',
    // Employment
    jobTitleId:         '',
    employmentStatusId: '',
    staff_level:        '',
    staff_role:         '',
    rmRoType:           '',
    ssn_num:            '',
    departmentId:       '',
    branchId:           '',
    unitId:             '',
    outletId:           '',
    supervisorId:       '',
    // PC code (positions) — set at creation only
    pcMode:             'existing', // 'existing' | 'inline'
    pcCodeId:           '',
    pcCodeName:         '',
    hireDate:           '',
    confirmationDate:   '',
    // Next of Kin
    nxt_kin_fname:    '',
    nxt_kin_phone:    '',
    nxt_kin_email:    '',
    nxt_kin_address:  '',
    // Financial
    bankAccount:      '',
    paygradeId:       '',
    notcheId:         '',
    // Documents
    nationalIdNumber: '',
    nationalIdExpiry: '',
    passportNumber:   '',
    passportExpiry:   '',
    driverLicenseNum: '',
    driverLicenseExp: '',
    ...(initialData ? {
      employee_id:      initialData.employee_id        ?? '',
      titleId:          initialData.title?.id         ?? '',
      firstName:        initialData.firstName          ?? '',
      middleName:       initialData.middleName         ?? '',
      lastName:         initialData.lastName           ?? '',
      genderId:         initialData.gender?.id         ?? '',
      dateOfBirth:      initialData.dateOfBirth  ? initialData.dateOfBirth.slice(0, 10)  : '',
      place_of_birth:   initialData.place_of_birth     ?? '',
      nationalityId:    initialData.nationality?.id    ?? '',
      religionId:       initialData.religion?.id       ?? '',
      marital_status:   initialData.marital_status     ?? '',
      spouse_name:      initialData.spouse_name        ?? '',
      father_name:      initialData.father_name        ?? '',
      mother_name:      initialData.mother_name        ?? '',
      address1:         initialData.address1           ?? '',
      city:             initialData.city               ?? '',
      country:          initialData.country            ?? '',
      work_email:       initialData.work_email         ?? initialData.email ?? '',
      personal_email:   initialData.personal_email     ?? '',
      mobilePhone:      initialData.mobilePhone        ?? '',
      jobTitleId:         initialData.jobTitle?.id       ?? '',
      employmentStatusId: initialData.employmentStatus?.id ?? '',
      staff_level:        initialData.staff_level        ?? '',
      staff_role:         initialData.staff_role         ?? '',
      rmRoType:           initialData.rmRoType           ?? '',
      ssn_num:            initialData.ssn_num            ?? '',
      departmentId:       initialData.department?.id     ?? '',
      branchId:           initialData.branch?.id         ?? '',
      unitId:             initialData.unit?.id            ?? '',
      outletId:           initialData.outlet?.id          ?? '',
      supervisorId:       initialData.supervisor?.id      ?? '',
      hireDate:           initialData.hireDate       ? initialData.hireDate.slice(0, 10)       : '',
      confirmationDate:   initialData.confirmationDate ? initialData.confirmationDate.slice(0, 10) : '',
      nxt_kin_fname:    initialData.nxt_kin_fname    ?? '',
      nxt_kin_phone:    initialData.nxt_kin_phone    ?? '',
      nxt_kin_email:    initialData.nxt_kin_email    ?? '',
      nxt_kin_address:  initialData.nxt_kin_address  ?? '',
      bankAccount:      initialData.bankAccount      ?? '',
      paygradeId:       initialData.paygradeId?.toString()  ?? '',
      notcheId:         initialData.notcheId?.toString()    ?? '',
      nationalIdNumber: initialData.nationalIdNumber ?? '',
      nationalIdExpiry: initialData.nationalIdExpiry ? initialData.nationalIdExpiry.slice(0, 10) : '',
      passportNumber:   initialData.passportNumber   ?? '',
      passportExpiry:   initialData.passportExpiry   ? initialData.passportExpiry.slice(0, 10)   : '',
      driverLicenseNum: initialData.driverLicenseNum ?? '',
      driverLicenseExp: initialData.driverLicenseExp ? initialData.driverLicenseExp.slice(0, 10) : '',
    } : {}),
  }));

  // ── Document upload state ─────────────────────────────────────────────────
  const [docNames, setDocNames] = useState({
    fit_and_proper:   initialData?.fit_and_proper   ? 'Uploaded' : '',
    policeClearance:  initialData?.policeClearance  ? 'Uploaded' : '',
    medicalClearance: initialData?.medicalClearance ? 'Uploaded' : '',
  });
  const [docUploading, setDocUploading] = useState<Record<string, boolean>>({});

  const handleDocUpload = async (field: string, file: File | null) => {
    if (!file) {
      set(field, '');
      setDocNames(p => ({ ...p, [field]: '' }));
      return;
    }
    setDocUploading(p => ({ ...p, [field]: true }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/employees/documents/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const filename = res.data.data?.filename;
      set(field, filename);
      setDocNames(p => ({ ...p, [field]: file.name }));
    } catch {
      toast.error(`Failed to upload ${file.name}`);
    } finally {
      setDocUploading(p => ({ ...p, [field]: false }));
    }
  };

  // ── Code lists & structure data ────────────────────────────────────────────
  const [cl, setCl] = useState({
    titles: [] as any[], genders: [] as any[], nationalities: [] as any[],
    religions: [] as any[], empStatuses: [] as any[], jobTitles: [] as any[],
    staffLevels: [] as any[], staffRoles: [] as any[], countries: [] as any[],
  });
  const [structures, setStructures]   = useState<any[]>([]);
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [paygrades, setPaygrades]     = useState<any[]>([]);
  const [notches, setNotches]         = useState<any[]>([]);
  const [vacantPcCodes, setVacantPcCodes] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api.get('/system/code-lists/TIT/values'),
      api.get('/system/code-lists/GEN/values'),
      api.get('/system/code-lists/NAT/values'),
      api.get('/system/code-lists/REG/values'),
      api.get('/system/code-lists/EMPS/values'),
      api.get('/system/code-lists/JOBT/values'),
      api.get('/system/code-lists/STAFL/values'),
      api.get('/system/code-lists/STAFR/values'),
      api.get('/company/structures'),
      api.get('/employees/active'),
      api.get('/employees/paygrades'),
      api.get('/employees/notches'),
      api.get('/system/code-lists/CT/values'),
      api.get('/pc-codes?vacant=1').catch(() => ({ data: { data: [] } })),
    ]).then(([t, g, n, r, e, j, sl, sr, s, sup, pg, nc, ct, pc]) => {
      setCl({
        titles:       t.data.data  ?? [],
        genders:      g.data.data  ?? [],
        nationalities: n.data.data ?? [],
        religions:    r.data.data  ?? [],
        empStatuses:  e.data.data  ?? [],
        jobTitles:    j.data.data  ?? [],
        staffLevels:  sl.data.data ?? [],
        staffRoles:   sr.data.data ?? [],
        countries:    ct.data.data ?? [],
      });
      setStructures(s.data.data    ?? []);
      setSupervisors(sup.data.data ?? []);
      setPaygrades(pg.data.data    ?? []);
      setNotches(nc.data.data      ?? []);
      setVacantPcCodes(pc.data.data ?? []);
    }).catch(() => {});
  }, []);

  const departments = useMemo(() => structures.filter(s => s.typeLabel === 'Department'), [structures]);
  const branches    = useMemo(() => structures.filter(s => ['Branch', 'Head Office'].includes(s.typeLabel)), [structures]);
  const units       = useMemo(() => structures.filter(s => s.typeLabel === 'Unit'),   [structures]);
  const outlets     = useMemo(() => structures.filter(s => s.typeLabel === 'Outlet'), [structures]);

  const filteredNotches    = useMemo(() =>
    form.paygradeId
      ? notches.filter(n => String(n.paygradeId) === String(form.paygradeId))
      : [],
  [notches, form.paygradeId]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const set = (name: string, value: string) => setForm((p: any) => ({ ...p, [name]: value }));
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    set(e.target.name, e.target.value);

  const clSelect = (name: string, options: any[], placeholder: string, required?: boolean, label?: string) => (
    <Field label={label ?? placeholder} required={required}>
      <Combobox
        options={options.map(o => ({ id: String(o.id), label: o.label }))}
        value={form[name] != null ? String(form[name]) : ''}
        onChange={v => set(name, v)}
        placeholder={placeholder}
      />
    </Field>
  );

  const structSelect = (name: string, list: any[], placeholder: string, required?: boolean, label?: string) => (
    <Field label={label ?? placeholder} required={required}>
      <Combobox
        options={list.map(s => ({ id: String(s.id), label: s.title }))}
        value={form[name] != null ? String(form[name]) : ''}
        onChange={v => set(name, v)}
        placeholder={placeholder}
      />
    </Field>
  );

  // ── Configurable visibility / required (Settings → Controls → Employee Form) ──
  // Read once per open; defaults mirror the form's original behaviour.
  const fieldsCfg = useMemo(() => getSettings().employeeForm.fields, []);
  const transferFieldsCfg = useMemo(() => getSettings().employeeForm.transferFields, []);
  const approvedActiveEdit = isEdit
    && String(initialData?.approvalStatus || '').toUpperCase() === 'APPROVED'
    && String(initialData?.lifecycleStatus || '').toUpperCase() === 'ACTIVE';
  const transferProtected = (key: string) => approvedActiveEdit && !!transferFieldsCfg[key];
  const protectedLabels = EMPLOYEE_FORM_FIELDS.filter((field) => transferProtected(field.key)).map((field) => field.label);
  const fcfg = (key: string) =>
    fieldsCfg[key] ?? {
      visible:  EMPLOYEE_FORM_FIELDS_BY_KEY[key]?.defaultVisible ?? true,
      required: EMPLOYEE_FORM_FIELDS_BY_KEY[key]?.defaultRequired ?? false,
    };
  const isLocked   = (key: string) => !!EMPLOYEE_FORM_FIELDS_BY_KEY[key]?.locked;
  const isRequired = (key: string) => isLocked(key) || (fcfg(key).visible && fcfg(key).required);
  // A field shows when config-visible (locked always) — plus the spouse-name marriage rule.
  const fieldShown = (key: string) => {
    if (transferProtected(key)) return false;
    if (!(isLocked(key) || fcfg(key).visible)) return false;
    if (key === 'spouse_name') return form.marital_status === 'Married';
    return true;
  };
  const sectionShown = (keys: string[]) => keys.some(k => fieldShown(k));
  // Steps with no visible fields are skipped (Employment always keeps the Employee ID field).
  const stepHasContent = (stepId: string) =>
    stepId === 'employment' ||
    EMPLOYEE_FORM_FIELDS.some(f => f.step === stepId && fieldShown(f.key));
  const visibleSteps = STEPS.filter(s => stepHasContent(s.id));
  const currentId = visibleSteps[Math.min(step, visibleSteps.length - 1)]?.id ?? 'personal';

  // ── Per-step validation (config-driven) ──────────────────────────────────────
  const validateStep = (stepId: string): string | null => {
    // Employee ID is a special case (auto-generate logic, not in the field registry).
    if (stepId === 'employment' && !isEdit && !autoGenEmpNum && !form.employee_id?.trim())
      return 'Employee number is required when auto-generate is off';
    if (stepId === 'employment' && form.employee_id?.trim().length > EMPLOYEE_ID_MAX_LENGTH)
      return `Staff ID cannot exceed ${EMPLOYEE_ID_MAX_LENGTH} characters`;

    for (const f of EMPLOYEE_FORM_FIELDS) {
      if (f.step !== stepId || !fieldShown(f.key) || !isRequired(f.key)) continue;
      if (String(form[f.key] ?? '').trim() === '') return `${f.label} is required`;
    }

    // Identity documents: a number and its expiry must come as a pair (when both fields are shown).
    if (stepId === 'documents') {
      const pair = (numK: string, expK: string, numMsg: string, expMsg: string): string | null => {
        if (!fieldShown(numK) || !fieldShown(expK)) return null;
        if (form[numK] && !form[expK]) return expMsg;
        if (form[expK] && !form[numK]) return numMsg;
        return null;
      };
      return pair('nationalIdNumber', 'nationalIdExpiry',
          'National ID number is required when an expiry date is provided',
          'National ID expiry date is required when an ID number is provided')
        ?? pair('passportNumber', 'passportExpiry',
          'Passport number is required when an expiry date is provided',
          'Passport expiry date is required when a passport number is provided')
        ?? pair('driverLicenseNum', 'driverLicenseExp',
          "Driver's license number is required when an expiry date is provided",
          "Driver's license expiry date is required when a license number is provided");
    }
    return null;
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleFinish = () => {
    // Validate every visible step; jump to the first one with an error.
    for (let i = 0; i < visibleSteps.length; i++) {
      const err = validateStep(visibleSteps[i].id);
      if (err) { setStep(i); toast.error(err); return; }
    }

    const payload: any = { ...form };
    if (approvedActiveEdit) {
      for (const field of EMPLOYEE_FORM_FIELDS) if (transferFieldsCfg[field.key]) delete payload[field.key];
    }
    ['titleId', 'genderId', 'nationalityId', 'religionId', 'staff_level', 'staff_role',
     'departmentId', 'branchId', 'unitId', 'outletId', 'supervisorId'].forEach(k => {
      if (!payload[k]) payload[k] = null;
    });
    ['dateOfBirth', 'hireDate', 'confirmationDate',
     'nationalIdExpiry', 'passportExpiry', 'driverLicenseExp'].forEach(k => {
      if (!payload[k]) payload[k] = null;
    });

    // PC code — translate the UI's mode fields into what the API expects, then drop the internals.
    if (!isEdit) {
      if (payload.pcMode === 'inline' && payload.pcCodeName?.trim()) {
        payload.pcCode = { name: payload.pcCodeName.trim() };
        payload.pcCodeId = null;
      } else if (payload.pcMode === 'existing' && payload.pcCodeId) {
        // pcCodeId already set
      } else {
        payload.pcCodeId = null;
      }
    }
    delete payload.pcMode;
    delete payload.pcCodeName;

    onSave(payload, initialData?.id?.toString());
  };

  // ── Step navigation ────────────────────────────────────────────────────────
  const goNext = () => {
    const err = validateStep(currentId);
    if (err) { toast.error(err); return; }
    if (step >= visibleSteps.length - 1) handleFinish();
    else setStep(s => s + 1);
  };
  const goPrev = () => setStep(s => Math.max(0, s - 1));

  // ── Step content ───────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (currentId) {
      case 'personal': return (
        <div className="space-y-8">
          {sectionShown(['titleId','firstName','middleName','lastName','genderId','dateOfBirth','place_of_birth','nationalityId','religionId','marital_status','spouse_name','father_name','mother_name']) && (
          <div>
            <SectionHeader title="Personal Information" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {fieldShown('titleId') && clSelect('titleId', cl.titles, 'Select Title', isRequired('titleId'), 'Title')}
              {fieldShown('firstName') && (
              <Field label="First Name" required={isRequired('firstName')}>
                <input name="firstName" value={form.firstName} onChange={handleChange} placeholder="First name" />
              </Field>)}
              {fieldShown('middleName') && (
              <Field label="Middle Name" required={isRequired('middleName')}>
                <input name="middleName" value={form.middleName} onChange={handleChange} placeholder="Middle name (optional)" />
              </Field>)}
              {fieldShown('lastName') && (
              <Field label="Last Name" required={isRequired('lastName')}>
                <input name="lastName" value={form.lastName} onChange={handleChange} placeholder="Last name" />
              </Field>)}
              {fieldShown('genderId') && clSelect('genderId', cl.genders, 'Select Gender', isRequired('genderId'), 'Gender')}
              {fieldShown('dateOfBirth') && (
              <Field label="Date of Birth" required={isRequired('dateOfBirth')}>
                <input type="date" name="dateOfBirth" value={form.dateOfBirth} onChange={handleChange} />
              </Field>)}
              {fieldShown('place_of_birth') && (
              <Field label="Place of Birth" required={isRequired('place_of_birth')}>
                <input name="place_of_birth" value={form.place_of_birth} onChange={handleChange} placeholder="City or town of birth" />
              </Field>)}
              {fieldShown('nationalityId') && clSelect('nationalityId', cl.nationalities, 'Select Nationality', isRequired('nationalityId'), 'Nationality')}
              {fieldShown('religionId') && clSelect('religionId', cl.religions, 'Select Religion', isRequired('religionId'), 'Religion')}
              {fieldShown('marital_status') && (
              <Field label="Marital Status" required={isRequired('marital_status')}>
                <Combobox
                  options={MARITAL_STATUSES.map(s => ({ id: s, label: s }))}
                  value={form.marital_status || ''}
                  onChange={v => set('marital_status', v)}
                  placeholder="Select status"
                />
              </Field>)}
              {fieldShown('spouse_name') && (
                <Field label="Spouse Name" required={isRequired('spouse_name')}>
                  <input name="spouse_name" value={form.spouse_name} onChange={handleChange} placeholder="Spouse full name" />
                </Field>
              )}
              {fieldShown('father_name') && (
              <Field label="Father's Name" required={isRequired('father_name')}>
                <input name="father_name" value={form.father_name} onChange={handleChange} placeholder="Father's full name" />
              </Field>)}
              {fieldShown('mother_name') && (
              <Field label="Mother's Name" required={isRequired('mother_name')}>
                <input name="mother_name" value={form.mother_name} onChange={handleChange} placeholder="Mother's full name" />
              </Field>)}
            </div>
          </div>)}

          {sectionShown(['work_email','personal_email','mobilePhone','address1','city','country']) && (
          <div>
            <SectionHeader title="Contact & Address" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {fieldShown('work_email') && (
              <Field label="Work Email" required={isRequired('work_email')}>
                <input type="email" name="work_email" value={form.work_email} onChange={handleChange} placeholder="Company email address" />
              </Field>)}
              {fieldShown('personal_email') && (
              <Field label="Personal Email" required={isRequired('personal_email')}>
                <input type="email" name="personal_email" value={form.personal_email} onChange={handleChange} placeholder="Personal email address" />
              </Field>)}
              {fieldShown('mobilePhone') && (
              <Field label="Mobile Phone" required={isRequired('mobilePhone')}>
                <input type="tel" name="mobilePhone" value={form.mobilePhone} onChange={handleChange} placeholder="Mobile number" />
              </Field>)}
              {fieldShown('address1') && (
              <Field label="Address" required={isRequired('address1')} className="md:col-span-2">
                <input name="address1" value={form.address1} onChange={handleChange} placeholder="Street address" />
              </Field>)}
              {fieldShown('city') && (
              <Field label="City" required={isRequired('city')}>
                <input name="city" value={form.city} onChange={handleChange} placeholder="City" />
              </Field>)}
              {fieldShown('country') && (
              <Field label="Country" required={isRequired('country')}>
                <Combobox
                  options={cl.countries.map(o => ({ id: o.label, label: o.label }))}
                  value={form.country || ''}
                  onChange={v => set('country', v)}
                  placeholder="Select country"
                />
              </Field>)}
            </div>
          </div>)}
        </div>
      );

      case 'employment': return (
        <div>
          <SectionHeader title="Employment Details" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            {/* Employee ID — editable when auto-gen is off, read-only when on */}
            {autoGenEmpNum && !isEdit ? (
              <Field label="Employee ID">
                <input value="" disabled placeholder={`Auto-generated • ${formatEmployeeId(getSettings().employees.idFormat, '0001')}`} />
              </Field>
            ) : (
              <Field label="Employee ID" required={!isEdit && !autoGenEmpNum}>
                <input
                  name="employee_id"
                  value={form.employee_id}
                  onChange={handleChange}
                  placeholder="e.g. EP-26-0001"
                  maxLength={EMPLOYEE_ID_MAX_LENGTH}
                  disabled={autoGenEmpNum && isEdit}
                />
              </Field>
            )}
            {fieldShown('employmentStatusId') && clSelect('employmentStatusId', cl.empStatuses, 'Select Status', isRequired('employmentStatusId'), 'Employment Status')}
            {fieldShown('jobTitleId') && clSelect('jobTitleId', cl.jobTitles, 'Select Job Title', isRequired('jobTitleId'), 'Job Title')}
            {fieldShown('staff_level') && clSelect('staff_level', cl.staffLevels, 'Select Staff Level', isRequired('staff_level'), 'Staff Level')}
            {fieldShown('staff_role') && clSelect('staff_role', cl.staffRoles, 'Select Staff Role', isRequired('staff_role'), 'Staff Role')}
            {fieldShown('rmRoType') && (
            <Field label="RM / RO" required={isRequired('rmRoType')}>
              <Combobox
                options={[{ id: 'RM', label: 'RM — Relationship Manager' }, { id: 'RO', label: 'RO — Relationship Officer' }]}
                value={form.rmRoType}
                onChange={v => set('rmRoType', v)}
                placeholder="Select RM or RO"
              />
            </Field>)}
            {fieldShown('branchId') && structSelect('branchId', branches, 'Select Branch', isRequired('branchId'), 'Branch')}
            {fieldShown('departmentId') && structSelect('departmentId', departments, 'Select Department', isRequired('departmentId'), 'Department')}
            {fieldShown('unitId') && structSelect('unitId', units, 'Select Unit', isRequired('unitId'), 'Unit')}
            {fieldShown('outletId') && structSelect('outletId', outlets, 'Select Outlet', isRequired('outletId'), 'Outlet')}
            {fieldShown('supervisorId') && (
            <Field label="Supervisor" required={isRequired('supervisorId')}>
              <Combobox
                options={supervisors
                  .filter(s => !initialData || s.id !== initialData.id?.toString())
                  .map(s => {
                    const name = (s.name ?? `${s.firstName ?? ''} ${s.lastName ?? ''}`).trim();
                    return { id: String(s.id), label: (name || 'Employee') + (s.employee_id ? ` (${s.employee_id})` : '') };
                  })}
                value={form.supervisorId}
                onChange={id => set('supervisorId', id)}
                placeholder="Search supervisor..."
              />
            </Field>)}
            {/* PC code (positions) — set only when creating a new employee */}
            {!isEdit && (
              <div className="md:col-span-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-bold text-[var(--text-primary)] syne">PC Code (Position)</p>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button type="button" onClick={() => set('pcMode', 'existing')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${form.pcMode === 'existing' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500'}`}>
                      Pick existing
                    </button>
                    <button type="button" onClick={() => set('pcMode', 'inline')}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${form.pcMode === 'inline' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500'}`}>
                      Create new
                    </button>
                  </div>
                </div>
                {form.pcMode === 'existing' ? (
                  <Field label="Vacant PC Code">
                    <Combobox
                      options={vacantPcCodes.map((c: any) => ({ id: String(c.id), label: `${c.code} — ${c.name}` }))}
                      value={form.pcCodeId}
                      onChange={v => set('pcCodeId', v)}
                      placeholder={vacantPcCodes.length ? 'Select a vacant position…' : 'No vacant positions available'}
                    />
                  </Field>
                ) : (
                  <Field label="New Position Name">
                    <input value={form.pcCodeName} onChange={e => set('pcCodeName', e.target.value)} placeholder="e.g. Branch Officer — Kissy" />
                    <p className="text-[11px] text-[var(--text-muted)] mt-1.5">The 6-digit code is generated automatically and reports to the position held by the selected supervisor.</p>
                  </Field>
                )}
              </div>
            )}
            {fieldShown('ssn_num') && (
            <Field label="SSN" required={isRequired('ssn_num')}>
              <input name="ssn_num" value={form.ssn_num} onChange={handleChange} placeholder="Social security number" />
            </Field>)}
            {fieldShown('hireDate') && (
            <Field label="Hire Date" required={isRequired('hireDate')}>
              <input type="date" name="hireDate" value={form.hireDate} onChange={handleChange} />
            </Field>)}
            {fieldShown('confirmationDate') && (
            <Field label="Confirmation Date" required={isRequired('confirmationDate')}>
              <input type="date" name="confirmationDate" value={form.confirmationDate} onChange={handleChange} />
            </Field>)}
          </div>
        </div>
      );

      case 'nextofkin': return (
        <div>
          <SectionHeader title="Next of Kin" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            {fieldShown('nxt_kin_fname') && (
            <Field label="Full Name" required={isRequired('nxt_kin_fname')}>
              <input name="nxt_kin_fname" value={form.nxt_kin_fname} onChange={handleChange} placeholder="Next of kin full name" />
            </Field>)}
            {fieldShown('nxt_kin_phone') && (
            <Field label="Phone Number" required={isRequired('nxt_kin_phone')}>
              <input type="tel" name="nxt_kin_phone" value={form.nxt_kin_phone} onChange={handleChange} placeholder="Phone number" />
            </Field>)}
            {fieldShown('nxt_kin_email') && (
            <Field label="Email Address" required={isRequired('nxt_kin_email')}>
              <input type="email" name="nxt_kin_email" value={form.nxt_kin_email} onChange={handleChange} placeholder="Email address" />
            </Field>)}
            {fieldShown('nxt_kin_address') && (
            <Field label="Address" required={isRequired('nxt_kin_address')} className="md:col-span-2">
              <input name="nxt_kin_address" value={form.nxt_kin_address} onChange={handleChange} placeholder="Residential address" />
            </Field>)}
          </div>
        </div>
      );

      case 'financial': return (
        <div>
          <SectionHeader title="Financial Information" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            {fieldShown('bankAccount') && (
            <Field label="Bank Account Number" required={isRequired('bankAccount')} className="md:col-span-2">
              <input name="bankAccount" value={form.bankAccount} onChange={handleChange} placeholder="Bank account number" />
            </Field>)}
            {fieldShown('paygradeId') && (
            <Field label="Pay Grade" required={isRequired('paygradeId')}>
              <Combobox
                options={paygrades.map(p => ({
                  id: String(p.id),
                  label: p.name + (p.currency ? ` (${p.currency})` : ''),
                }))}
                value={form.paygradeId}
                onChange={id => { set('paygradeId', id); set('notcheId', ''); }}
                placeholder="Search paygrade..."
              />
            </Field>)}
            {fieldShown('notcheId') && (
            <Field label="Salary Notch" required={isRequired('notcheId')}>
              <Combobox
                options={filteredNotches.map(n => ({
                  id: String(n.id),
                  label: n.name + (n.amount ? ` — ${n.currency ?? ''} ${Number(n.amount).toLocaleString()}` : ''),
                }))}
                value={form.notcheId}
                onChange={id => set('notcheId', id)}
                placeholder={form.paygradeId ? 'Search notch...' : 'Select a paygrade first...'}
              />
            </Field>)}
          </div>
        </div>
      );

      case 'documents': return (
        <div className="space-y-8">
          {sectionShown(['nationalIdNumber','nationalIdExpiry','passportNumber','passportExpiry','driverLicenseNum','driverLicenseExp']) && (
          <div>
            <SectionHeader title="Identity Documents" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {fieldShown('nationalIdNumber') && (
              <Field label="National ID Number" required={isRequired('nationalIdNumber')}>
                <input name="nationalIdNumber" value={form.nationalIdNumber} onChange={handleChange} placeholder="NIN / National ID" />
              </Field>)}
              {fieldShown('nationalIdExpiry') && (
              <Field label="National ID Expiry" required={isRequired('nationalIdExpiry')}>
                <input type="date" name="nationalIdExpiry" value={form.nationalIdExpiry} onChange={handleChange} />
              </Field>)}
              {fieldShown('passportNumber') && (
              <Field label="Passport Number" required={isRequired('passportNumber')}>
                <input name="passportNumber" value={form.passportNumber} onChange={handleChange} placeholder="Passport number" />
              </Field>)}
              {fieldShown('passportExpiry') && (
              <Field label="Passport Expiry" required={isRequired('passportExpiry')}>
                <input type="date" name="passportExpiry" value={form.passportExpiry} onChange={handleChange} />
              </Field>)}
              {fieldShown('driverLicenseNum') && (
              <Field label="Driver's License Number" required={isRequired('driverLicenseNum')}>
                <input name="driverLicenseNum" value={form.driverLicenseNum} onChange={handleChange} placeholder="License number" />
              </Field>)}
              {fieldShown('driverLicenseExp') && (
              <Field label="Driver's License Expiry" required={isRequired('driverLicenseExp')}>
                <input type="date" name="driverLicenseExp" value={form.driverLicenseExp} onChange={handleChange} />
              </Field>)}
            </div>
          </div>)}

          {sectionShown(['fit_and_proper','policeClearance','medicalClearance']) && (
          <div>
            <SectionHeader title="Clearance Documents" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
              {(['fit_and_proper', 'policeClearance', 'medicalClearance'] as const).filter(field => fieldShown(field)).map(field => {
                const labels: Record<string, string> = {
                  fit_and_proper:   'Fit & Proper Form',
                  policeClearance:  'Police Clearance',
                  medicalClearance: 'Medical Clearance',
                };
                const fileName = docNames[field];
                return (
                  <div key={field} className="col-span-1">
                    <label className="label">{labels[field]}</label>
                    <label className={`flex items-center gap-3 border rounded-lg px-4 py-3 cursor-pointer transition-colors ${
                      docUploading[field]
                        ? 'border-[var(--border)] bg-[var(--surface-hover)] opacity-60 cursor-wait'
                        : fileName
                          ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                          : 'border-[var(--border)] bg-[var(--surface-hover)] hover:border-[var(--accent)]'
                    }`}>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        disabled={!!docUploading[field]}
                        onChange={e => handleDocUpload(field, e.target.files?.[0] ?? null)}
                      />
                      {docUploading[field] ? (
                        <>
                          <UploadCloud size={15} className="text-[var(--accent)] shrink-0 animate-pulse" />
                          <span className="text-[13px] text-[var(--accent)]">Uploading…</span>
                        </>
                      ) : fileName ? (
                        <>
                          <FileCheck size={15} className="text-[var(--accent)] shrink-0" />
                          <span className="text-[13px] font-medium text-[var(--accent)] truncate flex-1">{fileName}</span>
                          <button
                            type="button"
                            onClick={e => { e.preventDefault(); handleDocUpload(field, null); }}
                            className="p-0.5 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <UploadCloud size={15} className="text-[var(--text-muted)] shrink-0" />
                          <span className="text-[13px] text-[var(--text-muted)]">Upload file (PDF / image)</span>
                        </>
                      )}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>)}

        </div>
      );

      default: return null;
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] shadow-2xl w-full max-w-[800px] flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-8 py-5 border-b border-[var(--border)] bg-[var(--surface-hover)] shrink-0 rounded-t-[16px]">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-[var(--surface)] rounded-xl border border-[var(--border)]">
              <UserPlus className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-primary)] syne">
                {isEdit ? 'Edit Employee' : 'Add New Employee'}
              </h2>
              <p className="text-[13px] text-[var(--text-muted)] mt-0.5 font-medium">
                {isEdit ? 'Update personnel record' : 'New employee will be created as pending approval'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-4 flex items-center justify-between shrink-0 border-b border-[var(--border)] overflow-x-auto">
          {visibleSteps.map((s, i) => {
            const active    = i === step;
            const completed = i < step;
            return (
              <div key={s.id} className={`flex items-center ${i < visibleSteps.length - 1 ? 'flex-1' : ''}`}>
                <button
                  onClick={() => i <= step && setStep(i)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors shrink-0 ${
                    active    ? 'bg-[var(--accent)] text-white' :
                    completed ? 'text-[var(--accent)] bg-[var(--accent-dim)] hover:bg-[var(--accent)] hover:text-white' :
                                'text-[var(--text-muted)]'
                  }`}
                >
                  <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-extrabold shrink-0 ${
                    active    ? 'bg-white/20' :
                    completed ? 'opacity-70' :
                                'bg-[var(--surface-hover)] border border-[var(--border)]'
                  }`}>{i + 1}</span>
                  <span className="hidden sm:inline whitespace-nowrap">{s.label}</span>
                </button>
                {i < visibleSteps.length - 1 && (
                  <div className={`h-[2px] mx-2 flex-1 min-w-[12px] ${completed ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {approvedActiveEdit && protectedLabels.length > 0 && (
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] leading-relaxed text-blue-800">
              <strong>Transfer-controlled fields are hidden here.</strong> Use Employee Transfers to change: {protectedLabels.join(', ')}.
            </div>
          )}
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--surface-hover)] rounded-b-[16px]">
          <button onClick={onClose} className="secondary-btn">Cancel</button>
          <div className="flex items-center gap-3">
            {step > 0 && (
              <button onClick={goPrev} className="secondary-btn">Back</button>
            )}
            <button
              onClick={goNext}
              disabled={Object.values(docUploading).some(Boolean)}
              className="primary-btn disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {Object.values(docUploading).some(Boolean)
                ? 'Uploading…'
                : step < visibleSteps.length - 1 ? 'Next' : (isEdit ? 'Save Changes' : 'Create Employee')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
