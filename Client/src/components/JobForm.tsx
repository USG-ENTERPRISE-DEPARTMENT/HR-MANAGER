import { useRef, useState, useEffect } from 'react';
import { ImagePlus, X, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect } from './ui/SearchSelect';
import { DraftWithAI } from './ai/DraftWithAI';
import api from '../../lib/api';
import { getSettings } from '../../lib/settings';

const EXPERIENCE_LEVELS = ['Entry Level', 'Mid Level', 'Senior Level', 'Lead', 'Executive'];
const EDUCATION_LEVELS  = ['High School', 'Diploma', "Bachelor's Degree", "Master's Degree", 'PhD'];

function genJobCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `JOB-${rand}`;
}

export function JobForm({ onClose, initialData, onSave, isDuplicate = false }: any) {
  const autoGenCode = getSettings().recruitment.autoGenerateCode;

  const { formData, handleChange, setFormData } = useFormState(
    {
      title: '', code: '', status: 'Active',
      department: '', jobFunction: '', experienceLevel: '', educationLevel: '',
      country: '', location: '', postalCode: '',
      employementType: '', hiringManager: '', showHiringManager: 'No',
      currency: '', salaryMin: '', salaryMax: '', showSalary: 'No',
      closingDate: '', keywords: '', positionReason: '',
      shortDescription: '', description: '', requirements: '', benefits: '',
      attachment: '',
    },
    initialData ? {
      ...initialData,
      attachment:  initialData.attachment  ?? '',
      closingDate: initialData.closingDate
        ? new Date(initialData.closingDate).toISOString().split('T')[0]
        : '',
    } : undefined
  );

  // Reference data
  const [jobTitles,    setJobTitles]    = useState<{ id: string; label: string }[]>([]);
  const [empTypes,     setEmpTypes]     = useState<{ id: string; label: string }[]>([]);
  const [currencies,   setCurrencies]   = useState<{ id: string; label: string }[]>([]);
  const [countries,    setCountries]    = useState<{ id: string; label: string }[]>([]);
  const [departments,  setDepartments]  = useState<{ id: string; label: string }[]>([]);
  const [employees,    setEmployees]    = useState<{ id: string; label: string }[]>([]);
  const [companyName,  setCompanyName]  = useState('');
  const [loadingRefs,  setLoadingRefs]  = useState(true);

  // Image upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  const previewUrl = localPreview
    ?? (formData.attachment ? `${api.defaults.baseURL}/documents/${formData.attachment}` : null);

  useEffect(() => {
    // Always generate a fresh code for duplicates; generate on create if setting is on
    if (isDuplicate || (!initialData && autoGenCode)) {
      setFormData((prev: any) => ({ ...prev, code: genJobCode() }));
    }

    Promise.all([
      api.get('/system/code-lists/JOBT/values'),
      api.get('/system/code-lists/EMPS/values'),
      api.get('/system/code-lists/CUR/values'),
      api.get('/system/code-lists/CT/values'),
      api.get('/company/structures'),
      api.get('/employees/active'),
      api.get('/payroll/payslip-templates').catch(() => ({ data: { data: [] } })),
    ]).then(([jobtRes, empsRes, curRes, ctRes, structRes, empRes, psRes]) => {
      const toOpts = (rows: any[], labelKey = 'label') =>
        (rows ?? []).map((r: any) => ({ id: r[labelKey] ?? r.label, label: r[labelKey] ?? r.label }));

      setJobTitles(toOpts(jobtRes.data.data ?? []));
      setEmpTypes(toOpts(empsRes.data.data ?? []));
      setCountries(toOpts(ctRes.data.data ?? []));

      // For currencies store the code (e.g. USD), label = "USD — US Dollar"
      const curRows: any[] = curRes.data.data ?? [];
      setCurrencies(curRows.map((r: any) => ({
        id:    r.code ?? r.label,
        label: r.code ? `${r.code} — ${r.label}` : r.label,
      })));

      // Departments: all structures with type 'Department', fallback to all
      const structs: any[] = structRes.data.data ?? [];
      const depts = structs.filter((s: any) => s.typeLabel === 'Department');
      const deptOpts = (depts.length ? depts : structs).map((s: any) => ({
        id: s.title, label: s.title,
      }));
      setDepartments(deptOpts);

      // Active employees for hiring manager
      const emps: any[] = empRes.data.data ?? [];
      setEmployees(emps.map((e: any) => ({
        id:    e.name,
        label: e.jobTitle ? `${e.name} — ${e.jobTitle}` : e.name,
      })));

      // Company name from payslip settings
      const templates: any[] = psRes.data.data ?? [];
      if (templates.length && templates[0].company_name) {
        setCompanyName(templates[0].company_name);
      }
    }).catch(() => {}).finally(() => setLoadingRefs(false));
  }, []);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/employees/documents/upload', fd, {
        headers: { 'Content-Type': undefined },
      });
      setFormData((prev: any) => ({ ...prev, attachment: res.data.data?.filename ?? '' }));
    } catch {
      toast.error('Image upload failed');
      setLocalPreview(null);
    } finally {
      setUploading(false);
      URL.revokeObjectURL(objectUrl);
      setLocalPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const clearImage = () => {
    setFormData((prev: any) => ({ ...prev, attachment: '' }));
    setLocalPreview(null);
  };

  const set = (field: string, val: string) =>
    setFormData((prev: any) => ({ ...prev, [field]: val }));

  return (
    <FormModal
      title={isDuplicate ? 'Duplicate Job Posting' : initialData ? 'Edit Job Posting' : 'Add Job Posting'}
      subtitle="Configure the details for this job opening."
      onClose={onClose}
      onSave={() => onSave(formData)}
      maxWidth="3xl"
    >
      <div className="space-y-8">

        {/* ── Banner image ── */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Job Banner Image</p>
          {previewUrl ? (
            <div className="relative w-full h-36 rounded-[12px] overflow-hidden border border-[var(--border)] group">
              <img src={previewUrl} alt="Job banner" className="w-full h-full object-cover" />
              {uploading && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1.5 text-white">
                  <Loader2 size={22} className="animate-spin" />
                  <span className="text-[12px] font-medium">Uploading…</span>
                </div>
              )}
              {!uploading && (
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-2 right-2 p-1 rounded-full bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full h-28 rounded-[12px] border-2 border-dashed border-[var(--border)] flex flex-col items-center justify-center gap-1.5 text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
            >
              <ImagePlus size={20} />
              <span className="text-[12px]">Click to upload banner image</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
        </div>

        {/* ── Basic info ── */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Basic Information</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">

            <FormField label="Job Title" required>
              <SearchSelect
                value={formData.title}
                onChange={v => set('title', v)}
                options={jobTitles}
                placeholder={loadingRefs ? 'Loading…' : 'Select job title…'}
                disabled={loadingRefs}
              />
            </FormField>

            <FormField label="Job Code">
              <div className="flex gap-2">
                <input
                  type="text"
                  name="code"
                  value={formData.code}
                  onChange={handleChange}
                  className={`${inputClass} flex-1`}
                  placeholder="e.g. JOB-A1B2"
                />
                <button
                  type="button"
                  title="Auto-generate code"
                  onClick={() => set('code', genJobCode())}
                  className="shrink-0 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
                >
                  <Wand2 size={14} />
                </button>
              </div>
            </FormField>

            {/* Company name — read-only from app setup */}
            <FormField label="Company">
              <div className={`${inputClass} bg-[var(--bg)] text-[var(--text-muted)] cursor-default select-none`}>
                {companyName || <span className="italic text-[var(--text-muted)] opacity-60">Set in App Setup → Payroll → Report Templates</span>}
              </div>
            </FormField>

            <FormField label="Status" required>
              <SearchSelect
                value={formData.status}
                onChange={v => set('status', v)}
                options={['Active', 'On Hold', 'Closed'].map(s => ({ id: s, label: s }))}
              />
            </FormField>

            <FormField label="Department">
              <SearchSelect
                value={formData.department}
                onChange={v => set('department', v)}
                options={departments}
                placeholder={loadingRefs ? 'Loading…' : 'Select department…'}
                disabled={loadingRefs}
              />
            </FormField>

            <FormField label="Job Function">
              <input type="text" name="jobFunction" value={formData.jobFunction} onChange={handleChange} className={inputClass} placeholder="e.g. Engineering, Finance" />
            </FormField>

            <FormField label="Position Reason">
              <input type="text" name="positionReason" value={formData.positionReason} onChange={handleChange} className={inputClass} placeholder="e.g. New headcount, Replacement" />
            </FormField>

            <FormField label="Closing Date">
              <input type="date" name="closingDate" value={formData.closingDate} onChange={handleChange} className={inputClass} />
            </FormField>
          </div>
        </div>

        {/* ── Location ── */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Location</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
            <FormField label="Country">
              <SearchSelect
                value={formData.country}
                onChange={v => set('country', v)}
                options={countries}
                placeholder={loadingRefs ? 'Loading…' : 'Select country…'}
                disabled={loadingRefs}
              />
            </FormField>
            <FormField label="City">
              <input type="text" name="location" value={formData.location} onChange={handleChange} className={inputClass} />
            </FormField>
            <FormField label="Postal Code">
              <input type="text" name="postalCode" value={formData.postalCode} onChange={handleChange} className={inputClass} />
            </FormField>
          </div>
        </div>

        {/* ── Requirements ── */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Candidate Requirements</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">

            <FormField label="Employment Type">
              <SearchSelect
                value={formData.employementType}
                onChange={v => set('employementType', v)}
                options={empTypes}
                placeholder={loadingRefs ? 'Loading…' : 'Select type…'}
                disabled={loadingRefs}
              />
            </FormField>

            <FormField label="Experience Level">
              <SearchSelect
                value={formData.experienceLevel}
                onChange={v => set('experienceLevel', v)}
                options={EXPERIENCE_LEVELS.map(l => ({ id: l, label: l }))}
                placeholder="Select level"
              />
            </FormField>

            <FormField label="Education Level">
              <SearchSelect
                value={formData.educationLevel}
                onChange={v => set('educationLevel', v)}
                options={EDUCATION_LEVELS.map(l => ({ id: l, label: l }))}
                placeholder="Select education"
              />
            </FormField>

            <FormField label="Keywords" hint="Comma-separated skills or terms.">
              <input type="text" name="keywords" value={formData.keywords} onChange={handleChange} className={inputClass} placeholder="e.g. React, TypeScript, Remote" />
            </FormField>
          </div>
        </div>

        {/* ── Compensation ── */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Compensation</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">

            <FormField label="Currency">
              <SearchSelect
                value={formData.currency}
                onChange={v => set('currency', v)}
                options={currencies}
                placeholder={loadingRefs ? 'Loading…' : 'Select currency…'}
                disabled={loadingRefs}
              />
            </FormField>

            <FormField label="Show Salary on Listing">
              <SearchSelect
                value={formData.showSalary}
                onChange={v => set('showSalary', v)}
                options={['Yes', 'No'].map(s => ({ id: s, label: s }))}
              />
            </FormField>

            <FormField label="Salary Min">
              <input type="number" name="salaryMin" value={formData.salaryMin} onChange={handleChange} className={inputClass} min="0" />
            </FormField>

            <FormField label="Salary Max">
              <input type="number" name="salaryMax" value={formData.salaryMax} onChange={handleChange} className={inputClass} min="0" />
            </FormField>
          </div>
        </div>

        {/* ── Hiring ── */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Hiring</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">

            <FormField label="Hiring Manager">
              <SearchSelect
                value={formData.hiringManager}
                onChange={v => set('hiringManager', v)}
                options={employees}
                placeholder={loadingRefs ? 'Loading…' : 'Select employee…'}
                disabled={loadingRefs}
              />
            </FormField>

            <FormField label="Show Hiring Manager Name">
              <SearchSelect
                value={formData.showHiringManager}
                onChange={v => set('showHiringManager', v)}
                options={['Yes', 'No'].map(s => ({ id: s, label: s }))}
              />
            </FormField>
          </div>
        </div>

        {/* ── Content ── */}
        <div>
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-4">Job Content</p>
          <div className="space-y-5">
            <FormField label="Short Description">
              <CountedTextarea name="shortDescription" value={formData.shortDescription} onChange={handleChange} rows={2} maxChars={300} className={inputClass} />
            </FormField>
            <FormField label="Full Description">
              <div className="flex justify-end mb-1.5">
                <DraftWithAI
                  kind="job_description"
                  maxChars={5000}
                  getContext={() => [formData.title, formData.department, formData.experienceLevel].filter(Boolean).join(', ')}
                  onText={(t) => handleChange({ target: { name: 'description', value: t } } as any)}
                />
              </div>
              <CountedTextarea name="description" value={formData.description} onChange={handleChange} rows={5} maxChars={5000} className={inputClass} />
            </FormField>
            <FormField label="Requirements">
              <CountedTextarea name="requirements" value={formData.requirements} onChange={handleChange} rows={4} maxChars={5000} className={inputClass} />
            </FormField>
            <FormField label="Benefits">
              <CountedTextarea name="benefits" value={formData.benefits} onChange={handleChange} rows={3} maxChars={2000} className={inputClass} />
            </FormField>
          </div>
        </div>

      </div>
    </FormModal>
  );
}
