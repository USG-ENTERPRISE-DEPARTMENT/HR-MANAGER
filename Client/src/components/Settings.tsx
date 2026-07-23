import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutGrid, CalendarRange, Bell, SlidersHorizontal,
  Building2, Users, ShieldCheck, Stethoscope, Banknote, Network, CalendarClock, FileText, Briefcase,
  Mail, Server, AtSign, Eye, EyeOff, Send, Loader2, GraduationCap,
  Clock, MapPin, Tablet, KeyRound, Copy, RefreshCw, Lock, Sparkles, CheckCircle2, XCircle, Plus, Trash2, Pencil,
  MessageSquare, RotateCcw, Search, Check, ArrowRightLeft,
} from 'lucide-react';
import { Modules } from './Modules';
import { PayrollApprovalFlow } from './PayrollApprovalFlow';
import { MedicalApprovalFlow } from './MedicalApprovalFlow';
import { LeaveApprovalFlow } from './LeaveApprovalFlow';
import { EmployeeApprovalFlow } from './EmployeeApprovalFlow';
import { EmployeeTransferApprovalFlow } from './EmployeeTransferApprovalFlow';
import {
  aiGetConfig, aiSaveConfig, aiHealth, aiReindex, type AiHealth,
  aiListKnowledge, aiSaveKnowledge, aiSetKnowledgeEnabled, aiDeleteKnowledge, type KnowledgeEntry,
} from '../../lib/aiClient';
import { getSettings, saveSetting } from '../../lib/settings';
import { listMessages, saveMessage, resetMessage, type MessageEntry } from '../../lib/messagesClient';
import {
  EMPLOYEE_FORM_FIELDS, EMPLOYEE_FORM_STEPS, EMPLOYEE_FORM_FIELDS_BY_KEY,
  defaultFieldConfig, defaultTransferFieldConfig, type EmployeeFieldConfig,
  type EmployeeTransferFieldConfig, type FieldFlags,
} from '../config/employeeFormFields';
import { ONBOARDING_FIELDS } from '@/lib/onboardingFields';
import {
  EMPLOYEE_ID_TOKENS, EMPLOYEE_ID_MAX_LENGTH, formatEmployeeId, patternIsValid,
} from '@/lib/employeeIdFormat';

// Fields the self-onboarding form builder can offer (its own catalog is a subset of the employee
// form). Used to flag, in the Employee Form controls, which fields don't surface in onboarding.
const ONBOARDING_FIELD_KEYS = new Set(ONBOARDING_FIELDS.map(f => f.key));
import { useCan } from '@/hooks/useCan';
import { inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect } from './ui/SearchSelect';
import { TablePagination } from './ui/TablePagination';
import api from '../../lib/api';
import { toast } from 'sonner';
import { PageHeader } from './ui/PageHeader';

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative shrink-0 inline-flex h-[22px] w-[40px] cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
      ].join(' ')}
    >
      <span className={[
        'pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm',
        'ring-0 transition duration-200 ease-in-out',
        checked ? 'translate-x-[18px]' : 'translate-x-0',
      ].join(' ')} />
    </button>
  );
}

function ControlRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-[var(--border-light)] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">{label}</p>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-relaxed">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// Settings → Controls → General → Employees: defines the structure auto-generated employee IDs follow.
// Edits a template string (e.g. EMP-{YYYY}-{SEQ4}); commits on blur and shows a live preview.
function EmployeeIdFormatEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === value) { setDraft(value); return; }
    // Refuse to persist a template that would break the rules (missing sequence token or a rendered
    // ID longer than the cap). The red warnings below explain why; the draft is kept so the admin
    // can fix it, but the saved setting is left untouched.
    if (!patternIsValid(next) || formatEmployeeId(next, 1234).length > EMPLOYEE_ID_MAX_LENGTH) return;
    onChange(next);
    saveSetting('employees', { idFormat: next });
  };

  const sample = formatEmployeeId(draft || '', 1234);
  const noSeq = !patternIsValid(draft);
  const tooLong = sample.length > EMPLOYEE_ID_MAX_LENGTH;

  return (
    <div className="px-5 py-4">
      <p className="text-[12px] font-semibold text-[var(--text-primary)] leading-snug">Employee ID Structure</p>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        spellCheck={false}
        placeholder="EP-{YY}-{SEQ4}"
        className="mt-1.5 w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[13px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      />
      <div className="mt-2 flex items-center gap-2 text-[12px]">
        <span className="text-[var(--text-muted)]">Preview</span>
        <span className="font-mono font-semibold text-[var(--text-primary)] px-2 py-0.5 rounded-md bg-[var(--surface-hover)] border border-[var(--border)]">{sample}</span>
      </div>
      {noSeq && (
        <p className="mt-2 text-[11px] font-medium text-[var(--danger)] leading-relaxed">
          The structure must include a sequence token (e.g. {'{SEQ4}'}) so every employee gets a unique ID.
        </p>
      )}
      {!noSeq && tooLong && (
        <p className="mt-2 text-[11px] font-medium text-[var(--danger)] leading-relaxed">
          This structure produces an ID longer than {EMPLOYEE_ID_MAX_LENGTH} characters — shorten the prefix or padding.
        </p>
      )}
      <div className="mt-3 pt-3 border-t border-[var(--border-light)]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Tokens</p>
        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
          {EMPLOYEE_ID_TOKENS.map(t => (
            <div key={t.token} className="flex items-baseline gap-1.5 text-[11px] leading-relaxed">
              <code className="font-mono font-semibold text-[var(--accent)]">{t.token}</code>
              <span className="text-[var(--text-muted)] truncate">{t.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)] leading-relaxed">
          Numbering is continuous and never resets. Any other characters (e.g. <code className="font-mono">EMP</code>, <code className="font-mono">-</code>, <code className="font-mono">/</code>) are kept as-is.
        </p>
      </div>
    </div>
  );
}

function SectionCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="border border-[var(--border)] rounded-[12px] overflow-visible">
      <div className="flex items-center gap-2.5 px-5 py-3 bg-[var(--bg)] border-b border-[var(--border)] rounded-t-[12px]">
        <span className="text-[var(--accent)]">{icon}</span>
        <span className="text-[11px] font-bold syne uppercase tracking-widest text-[var(--text-primary)]">{title}</span>
      </div>
      {children}
    </div>
  );
}

// A possibly-disabled toggle (locked / not-applicable fields are shown but greyed out).
function MaybeToggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={disabled ? 'opacity-40 pointer-events-none' : ''}>
      <Toggle checked={checked} onChange={(v) => { if (!disabled) onChange(v); }} />
    </div>
  );
}

// Settings → Controls → Employee Form: per-field visibility + required for the Add Employee form.
function EmployeeCreationFieldsSection() {
  const [fields, setFields] = useState<EmployeeFieldConfig>(() => getSettings().employeeForm.fields);

  const flag = (key: string): FieldFlags => fields[key] ?? {
    visible:  EMPLOYEE_FORM_FIELDS_BY_KEY[key]?.defaultVisible  ?? true,
    required: EMPLOYEE_FORM_FIELDS_BY_KEY[key]?.defaultRequired ?? false,
  };

  const update = (key: string, patch: Partial<FieldFlags>) => {
    setFields((prev) => {
      const cur = prev[key] ?? flag(key);
      let next: FieldFlags = { ...cur, ...patch };
      if (next.visible === false) next = { ...next, required: false }; // can't require a hidden field
      const merged = { ...prev, [key]: next };
      saveSetting('employeeForm', { fields: merged });
      return merged;
    });
  };

  const resetDefaults = () => {
    const d = defaultFieldConfig();
    setFields(d);
    saveSetting('employeeForm', { fields: d });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
          Choose which fields appear on the <strong className="text-[var(--text-secondary)]">Add Employee</strong> form and
          which are required. Core identity fields (First/Last name, Work Email) are always shown and required.
          Fields tagged <span className="font-semibold text-[var(--text-secondary)]">Not on self onboarding</span> aren’t
          part of the Self-Onboarding form builder, so changing them here won’t affect onboarding.
        </p>
        <button onClick={resetDefaults} className="secondary-btn shrink-0 text-[12px]">
          <RefreshCw size={13} /> Reset to defaults
        </button>
      </div>

      {EMPLOYEE_FORM_STEPS.map((stepDef) => {
        const stepFields = EMPLOYEE_FORM_FIELDS.filter((f) => f.step === stepDef.id);
        if (!stepFields.length) return null;
        return (
          <SectionCard key={stepDef.id} icon={<Users size={13} />} title={stepDef.label}>
            <div className="flex items-center gap-4 px-5 py-2 bg-[var(--bg)] border-b border-[var(--border-light)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <span className="flex-1">Field</span>
              <span className="w-[64px] text-center">Visible</span>
              <span className="w-[64px] text-center">Required</span>
            </div>
            {stepFields.map((f) => {
              const fl = flag(f.key);
              const locked = !!f.locked;
              return (
                <div key={f.key} className="flex items-center gap-4 px-5 py-3 border-b border-[var(--border-light)] last:border-0">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug shrink-0">{f.label}</p>
                    {locked && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[var(--accent-dim)] text-[var(--accent)] shrink-0">
                        Always required
                      </span>
                    )}
                    {!ONBOARDING_FIELD_KEYS.has(f.key) && (
                      <span
                        title="This field isn’t part of self-onboarding — it won’t appear in the Self-Onboarding form builder."
                        className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[var(--surface-hover)] text-[var(--text-muted)] border border-[var(--border)] whitespace-nowrap shrink-0"
                      >
                        Not on self onboarding
                      </span>
                    )}
                  </div>
                  <div className="w-[64px] flex justify-center">
                    <MaybeToggle checked={locked ? true : fl.visible} disabled={locked} onChange={(v) => update(f.key, { visible: v })} />
                  </div>
                  <div className="w-[64px] flex justify-center">
                    <MaybeToggle
                      checked={locked ? true : (fl.visible && fl.required)}
                      disabled={locked || !fl.visible}
                      onChange={(v) => update(f.key, { required: v })}
                    />
                  </div>
                </div>
              );
            })}
          </SectionCard>
        );
      })}
    </div>
  );
}

function EmployeeTransferFieldsSection() {
  const [transferFields, setTransferFields] = useState<EmployeeTransferFieldConfig>(() => getSettings().employeeForm.transferFields);

  const update = (key: string, enabled: boolean) => {
    setTransferFields((current) => {
      const next = { ...current, [key]: enabled };
      saveSetting('employeeForm', { transferFields: next });
      return next;
    });
  };

  const resetDefaults = () => {
    const defaults = defaultTransferFieldConfig();
    setTransferFields(defaults);
    saveSetting('employeeForm', { transferFields: defaults });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
          Fields switched on must be changed through <strong className="text-[var(--text-secondary)]">Employee Transfers</strong> for
          approved, active employees. Fields switched off remain personal or administrative details that can be changed through Edit Employee.
          New employees can still be fully completed before their initial approval.
        </p>
        <button onClick={resetDefaults} className="secondary-btn shrink-0 text-[12px]"><RefreshCw size={13} /> Reset to defaults</button>
      </div>

      {EMPLOYEE_FORM_STEPS.map((stepDef) => {
        const stepFields = EMPLOYEE_FORM_FIELDS.filter((field) => field.step === stepDef.id);
        if (!stepFields.length) return null;
        return (
          <SectionCard key={stepDef.id} icon={<ArrowRightLeft size={13} />} title={stepDef.label}>
            <div className="flex items-center gap-4 px-5 py-2 bg-[var(--bg)] border-b border-[var(--border-light)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <span className="flex-1">Employee field</span><span className="w-[100px] text-center">Use Transfer</span>
            </div>
            {stepFields.map((field) => {
              const unavailable = !!field.locked || field.type === 'file';
              return (
                <div key={field.key} className="flex items-center gap-4 px-5 py-3 border-b border-[var(--border-light)] last:border-0">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">{field.label}</p>
                    {unavailable && <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[var(--surface-hover)] text-[var(--text-muted)] border border-[var(--border)]">Personal / identity field</span>}
                  </div>
                  <div className="w-[100px] flex justify-center">
                    <MaybeToggle checked={!unavailable && !!transferFields[field.key]} disabled={unavailable} onChange={(enabled) => update(field.key, enabled)} />
                  </div>
                </div>
              );
            })}
          </SectionCard>
        );
      })}
    </div>
  );
}

function EmployeeFormFieldsSection() {
  const [tab, setTab] = useState<'Employee Details' | 'Employee Transfers'>('Employee Details');
  return <div className="space-y-5">
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
      {(['Employee Details', 'Employee Transfers'] as const).map((item) => (
        <button key={item} type="button" onClick={() => setTab(item)}
          className={`rounded-md px-4 py-2 text-[12px] font-semibold transition-colors ${tab === item ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'}`}>
          {item}
        </button>
      ))}
    </div>
    {tab === 'Employee Details' ? <EmployeeCreationFieldsSection /> : <EmployeeTransferFieldsSection />}
  </div>;
}

function GlInput({ label, desc, value, onChange, mono = true }: {
  label: string; desc: string; value: string; onChange: (v: string) => void; onBlur?: () => void; mono?: boolean;
}) {
  return (
    <div className="px-5 py-4 space-y-2 border-b border-[var(--border)] last:border-0">
      <div>
        <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">{label}</p>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{desc}</p>
      </div>
      <input
        className={`${inputClass} w-full ${mono ? 'font-mono text-[12px]' : ''}`}
        value={value}
        placeholder="Enter account code…"
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

interface CurrencyOption { id: string; code: string; label: string; }

function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [options, setOptions] = useState<CurrencyOption[]>([]);
  const [open, setOpen]       = useState(false);
  const [q, setQ]             = useState('');
  const [rect, setRect]       = useState<DOMRect | null>(null);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/system/code-lists/CUR/values').then(r => {
      const rows: any[] = r.data.data ?? r.data ?? [];
      setOptions(rows.map((v: any) => ({ id: String(v.id), code: v.code ?? v.label, label: v.label })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selected = options.find(o => o.code === value);
  const filtered = options.filter(o =>
    !q || o.code.toLowerCase().includes(q.toLowerCase()) || o.label.toLowerCase().includes(q.toLowerCase())
  );

  const dropdownHeight = Math.min(options.length * 36 + 56, 248);
  const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
  const openUpward = rect ? spaceBelow < dropdownHeight + 8 : false;

  const dropdown = open && rect ? createPortal(
    <AnimatePresence>
      <motion.div
        ref={dropRef}
        initial={{ opacity: 0, y: openUpward ? 4 : -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: openUpward ? 4 : -4 }}
        transition={{ duration: 0.12 }}
        style={{
          position: 'fixed',
          ...(openUpward
            ? { bottom: window.innerHeight - rect.top + 4 }
            : { top: rect.bottom + 4 }),
          left: rect.left,
          width: Math.max(rect.width, 220),
          zIndex: 9999,
        }}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden"
      >
        <div className="p-2 border-b border-[var(--border)]">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search currency…"
            className="w-full text-[12px] border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--bg)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]" />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filtered.length === 0
            ? <p className="text-[12px] text-[var(--text-muted)] px-3 py-2">No results</p>
            : filtered.map(o => (
              <button key={o.id} type="button"
                onClick={() => { onChange(o.code); setOpen(false); setQ(''); }}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--bg)] transition-colors ${o.code === value ? 'font-bold text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                <span className="font-mono font-semibold mr-2 text-[var(--accent)]">{o.code}</span>
                <span className="text-[var(--text-muted)]">{o.label}</span>
              </button>
            ))
          }
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  ) : null;

  return (
    <div className="relative w-52">
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!open) setRect(btnRef.current?.getBoundingClientRect() ?? null);
          setOpen(o => !o);
          setQ('');
        }}
        className="w-full flex items-center justify-between gap-2 text-left text-[13px] font-medium border border-[var(--border)] rounded-lg px-3 py-1.5 bg-[var(--surface)] text-[var(--text-primary)] hover:bg-[var(--bg)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        <span className={selected ? 'font-semibold' : 'text-[var(--text-muted)] font-normal'}>
          {selected ? `${selected.code} — ${selected.label}` : value || 'Select currency…'}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0 opacity-40"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg>
      </button>
      {dropdown}
    </div>
  );
}

// ─── Controls sub-tab sections ────────────────────────────────────────────────

function GeneralSection({
  autoGenCode, setAutoGenCode, autoGenEmpNum, setAutoGenEmpNum, empIdFormat, setEmpIdFormat,
  autoGenJobCode, setAutoGenJobCode,
  currency, setCurrency, allowDocumentDownload, setAllowDocumentDownload, saveDocumentSetting,
}: any) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <SectionCard icon={<Building2 size={13} />} title="Company Structure">
          <ControlRow
            label="Auto Generate Code"
            description="Automatically generate a 4-character code when creating structures. Branches are always entered manually."
            checked={autoGenCode}
            onChange={(v) => { setAutoGenCode(v); saveSetting('companyStructure', { autoGenerateCode: v }); }}
          />
        </SectionCard>

        <SectionCard icon={<Users size={13} />} title="Employees">
          <ControlRow
            label="Auto Generate Employee Number"
            description="Automatically assign an employee number on creation using the structure below. When off, you can enter the number manually."
            checked={autoGenEmpNum}
            onChange={(v) => { setAutoGenEmpNum(v); saveSetting('employees', { autoGenerateNumber: v }); }}
          />
          {autoGenEmpNum && (
            <EmployeeIdFormatEditor value={empIdFormat} onChange={setEmpIdFormat} />
          )}
        </SectionCard>

        <SectionCard icon={<Briefcase size={13} />} title="Recruitment">
          <ControlRow
            label="Auto Generate Job Code"
            description="Automatically generate a unique job code (e.g. JOB-A1B2) when creating a new job posting. When off, you can enter the code manually."
            checked={autoGenJobCode}
            onChange={(v) => { setAutoGenJobCode(v); saveSetting('recruitment', { autoGenerateCode: v }); }}
          />
        </SectionCard>

        <SectionCard icon={<FileText size={13} />} title="Documents">
          <ControlRow
            label="Allow Document Downloads"
            description="When enabled, employees can download documents from their Personal Documents view. When off, documents are view-only in the browser — no download prompt is shown."
            checked={allowDocumentDownload}
            onChange={(v) => { setAllowDocumentDownload(v); saveDocumentSetting(v ? 'Yes' : 'No'); }}
          />
        </SectionCard>
      </div>

      <SectionCard icon={<Banknote size={13} />} title="General">
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">App Currency</p>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Default currency shown on all amount fields, cost column headers, and medical limit forms throughout the app.
            </p>
          </div>
          <CurrencySelect value={currency} onChange={v => { setCurrency(v); saveSetting('general', { currency: v }); }} />
        </div>
      </SectionCard>
    </div>
  );
}

// Settings → Controls → Postings: master switches deciding whether each module posts to the GL /
// makes payments. When off, the module is record-only — no journal entries / payouts are generated.
function PostingsSection({
  payLeave, setPayLeave, payMedical, setPayMedical, payPayroll, setPayPayroll,
}: any) {
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[var(--text-muted)] leading-relaxed max-w-3xl">
        These switches decide whether a module posts to the general ledger (and triggers payments).
        Turn one <span className="font-semibold text-[var(--text-primary)]">off</span> to use that
        module for record-keeping only — requests and approvals still work, but nothing is posted to
        the GL or paid out.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-min">
        <SectionCard icon={<CalendarRange size={13} />} title="Leave">
          <ControlRow
            label="Post Leave Allowance Payments"
            description="When on, approved leave allowances are scheduled and posted to the general ledger. When off, leave is recorded only — no allowance is paid or posted."
            checked={payLeave}
            onChange={(v) => { setPayLeave(v); saveSetting('payments', { leave: v }); }}
          />
        </SectionCard>

        <SectionCard icon={<Stethoscope size={13} />} title="Medical">
          <ControlRow
            label="Post Medical Claim Payments"
            description="When on, approved hospital, staff and dependent medical claims post to the general ledger. When off, medical claims are recorded only — no GL entry or reimbursement is posted."
            checked={payMedical}
            onChange={(v) => { setPayMedical(v); saveSetting('payments', { medical: v }); }}
          />
        </SectionCard>

        <SectionCard icon={<Banknote size={13} />} title="Payroll">
          <ControlRow
            label="Post Payroll to General Ledger"
            description="When on, finalizing a payroll run posts the journal to the general ledger. When off, payroll runs are recorded and finalized only — no GL posting is attempted."
            checked={payPayroll}
            onChange={(v) => { setPayPayroll(v); saveSetting('payments', { payroll: v }); }}
          />
        </SectionCard>
      </div>
    </div>
  );
}

function ApprovalsSection({
  employeeApproval, setEmployeeApproval,
  employeeSelfApproval, setEmployeeSelfApproval,
  employeeUpdateApproval, setEmployeeUpdateApproval,
  payrollApproval, setPayrollApproval,
  selfApproval, setSelfApproval,
  medicalApproval, setMedicalApproval,
  medicalSelfApproval, setMedicalSelfApproval,
  supervisorApproval, setSupervisorApproval, saveFlowSettings,
  trainingApprovalFlow, setTrainingApprovalFlow, saveTrainingFlowSettings,
}: any) {
  const [showFlowEditor, setShowFlowEditor] = useState(false);
  const [showMedicalFlowEditor, setShowMedicalFlowEditor] = useState(false);
  const [showLeaveFlowEditor, setShowLeaveFlowEditor] = useState(false);
  const [showEmployeeFlowEditor, setShowEmployeeFlowEditor] = useState(false);
  const [showTransferFlowEditor, setShowTransferFlowEditor] = useState(false);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-min">
      <SectionCard icon={<ShieldCheck size={13} />} title="Employee Approval">
        <ControlRow
          label="Employee Approval Workflow"
          description="Require new employee records to be reviewed before becoming active. New employees start as Pending and must be approved or rejected in the employee view."
          checked={employeeApproval}
          onChange={(v) => {
            setEmployeeApproval(v);
            const updates: any = { employeeApproval: v };
            if (!v) { setEmployeeSelfApproval(false); updates.employeeSelfApproval = false; }
            saveSetting('approvals', updates);
          }}
        />
        <ControlRow
          label="Allow Self-Approval"
          description="Allow the same user who created an employee record to also approve it. When off, a different user must perform the approval."
          checked={employeeSelfApproval}
          onChange={(v) => { setEmployeeSelfApproval(v); saveSetting('approvals', { employeeSelfApproval: v }); }}
        />
        <ControlRow
          label="Require Approval on Edit"
          description="When on, editing an employee sends the record back through approval before it syncs to the external system — just like a new employee. When off, edits keep the employee's current status and sync immediately."
          checked={employeeUpdateApproval}
          onChange={(v) => { setEmployeeUpdateApproval(v); saveSetting('approvals', { employeeUpdateApproval: v }); }}
        />
        {employeeApproval && (
          <div className="px-5 py-3 border-t border-[var(--border)]">
            <p className="text-[12px] text-[var(--text-muted)] mb-2 leading-relaxed">
              New employee records and employee detail changes use this same ordered sign-off chain.
              With no configured stages, the existing Approve Employees permission provides one-step approval.
            </p>
            <button type="button" onClick={() => setShowEmployeeFlowEditor(true)} className="secondary-btn text-[13px]">
              <ShieldCheck size={14} /> Configure Approval Flow
            </button>
          </div>
        )}
      </SectionCard>
      {showEmployeeFlowEditor && <EmployeeApprovalFlow onClose={() => setShowEmployeeFlowEditor(false)} />}

      <SectionCard icon={<ArrowRightLeft size={13} />} title="Employee Transfer Approval">
        <div className="px-5 py-4">
          <p className="text-[12px] text-[var(--text-muted)] mb-3 leading-relaxed">
            Define the ordered role or user stages used when an employee transfer is submitted.
            With no configured stages, the existing transfer approval permission provides one-step approval.
          </p>
          <button type="button" onClick={() => setShowTransferFlowEditor(true)} className="secondary-btn text-[13px]">
            <ShieldCheck size={14} /> Configure Approval Flow
          </button>
        </div>
      </SectionCard>
      {showTransferFlowEditor && <EmployeeTransferApprovalFlow onClose={() => setShowTransferFlowEditor(false)} />}

      <SectionCard icon={<ShieldCheck size={13} />} title="Payroll Approval">
        <ControlRow
          label="Payroll Approval Workflow"
          description="Require payroll runs to be submitted and approved before they can be finalized. Adds a 'Submit for Approval' button after generation."
          checked={payrollApproval}
          onChange={(v) => {
            setPayrollApproval(v);
            const updates: any = { payrollApproval: v };
            if (!v) { setSelfApproval(false); updates.selfApproval = false; }
            saveSetting('approvals', updates);
          }}
        />
        <ControlRow
          label="Allow Self-Approval"
          description="Allow the same user who submitted a payroll run for approval to also approve it. When off, a different user must approve."
          checked={selfApproval}
          onChange={(v) => { setSelfApproval(v); saveSetting('approvals', { selfApproval: v }); }}
        />
        {payrollApproval && (
          <div className="px-5 py-3 border-t border-[var(--border)]">
            <p className="text-[12px] text-[var(--text-muted)] mb-2 leading-relaxed">
              Define the sign-off chain — the stages a submitted run passes through, and who approves each.
              With no stages, one approval (any user who can approve payroll) is enough.
            </p>
            <button
              type="button"
              onClick={() => setShowFlowEditor(true)}
              className="secondary-btn text-[13px]"
            >
              <ShieldCheck size={14} /> Configure Approval Flow
            </button>
          </div>
        )}
      </SectionCard>
      {showFlowEditor && <PayrollApprovalFlow onClose={() => setShowFlowEditor(false)} />}

      <SectionCard icon={<Stethoscope size={13} />} title="Medical Approval">
        <ControlRow
          label="Medical Approval Workflow"
          description="Require medical requests (staff, dependent, and hospital claims) to walk a configured sign-off chain before they are approved. With no stages, one approval (any user who can approve medical) is enough."
          checked={medicalApproval}
          onChange={(v) => {
            setMedicalApproval(v);
            const updates: any = { medicalApproval: v };
            if (!v) { setMedicalSelfApproval(false); updates.medicalSelfApproval = false; }
            saveSetting('approvals', updates);
          }}
        />
        <ControlRow
          label="Allow Self-Approval"
          description="Allow a user with both Create Medical and Approve Medical permissions to approve a medical request they originated themselves. When off, a different approver must review and approve the request."
          checked={medicalSelfApproval}
          onChange={(v) => { setMedicalSelfApproval(v); saveSetting('approvals', { medicalSelfApproval: v }); }}
        />
        {medicalApproval && (
          <div className="px-5 py-3 border-t border-[var(--border)]">
            <p className="text-[12px] text-[var(--text-muted)] mb-2 leading-relaxed">
              Define the sign-off chain — the stages a submitted medical request passes through, and who
              approves each. With no stages, one approval (any user who can approve medical) is enough.
            </p>
            <button type="button" onClick={() => setShowMedicalFlowEditor(true)} className="secondary-btn text-[13px]">
              <ShieldCheck size={14} /> Configure Approval Flow
            </button>
          </div>
        )}
      </SectionCard>
      {showMedicalFlowEditor && <MedicalApprovalFlow onClose={() => setShowMedicalFlowEditor(false)} />}

      <SectionCard icon={<CalendarClock size={13} />} title="Leave Approval Flow">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            HR admin is always the final approver. Toggle supervisor approval to add an extra sign-off tier before the leave reaches HR.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-primary)]">Config</span><span className="font-semibold text-[var(--text-primary)]">Behaviour</span>
            <span>Supervisor Off</span><span>Employee → HR → GL</span>
            <span>Supervisor On</span><span>Employee → Supervisor → HR → GL</span>
          </div>
        </div>
        <ControlRow
          label="Supervisor Approval"
          description="When enabled, a supervisor must approve the leave application first before it reaches HR. The leave moves to 'Pending HR Approval' after supervisor sign-off."
          checked={supervisorApproval}
          onChange={(v) => { setSupervisorApproval(v); saveFlowSettings(v); }}
        />
        <div className="px-5 py-3 border-t border-[var(--border)]">
          <p className="text-[12px] text-[var(--text-muted)] mb-2 leading-relaxed">
            Add amount-based financial sign-off <strong>after</strong> normal approval: define stages, each with an
            approver and an amount range. A leave's allowance is routed only through the stages whose range covers
            its payout; amounts below every range skip financial approval and go straight to GL.
          </p>
          <button type="button" onClick={() => setShowLeaveFlowEditor(true)} className="secondary-btn text-[13px]">
            <ShieldCheck size={14} /> Configure Approval Flow
          </button>
        </div>
      </SectionCard>
      {showLeaveFlowEditor && <LeaveApprovalFlow onClose={() => setShowLeaveFlowEditor(false)} />}

      <SectionCard icon={<GraduationCap size={13} />} title="Training Approval Flow">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            Controls how employee training nominations are routed after submission. HR/Admin is always the final approver.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-primary)]">Config</span><span className="font-semibold text-[var(--text-primary)]">Behaviour</span>
            <span>Supervisor Off</span><span>Employee → HR</span>
            <span>Supervisor On</span><span>Employee → Supervisor → HR</span>
          </div>
        </div>
        <ControlRow
          label="Supervisor Approval"
          description="When enabled, a supervisor must approve a training nomination first before it reaches HR. Nominations assigned by supervisors skip this step."
          checked={trainingApprovalFlow === 'supervisor_first'}
          onChange={(v) => {
            const flow = v ? 'supervisor_first' : 'direct';
            setTrainingApprovalFlow(flow);
            saveTrainingFlowSettings(flow);
          }}
        />
      </SectionCard>
    </div>
  );
}

function LeaveSection({
  allowSettings, setAllowSettings,
  saveAllowSetting,
  calendarShowAll, setCalendarShowAll, saveCalendarSetting,
}: any) {

  // Allowance input fields
  const glFields = [
    { key: 'leave_allow_tax_gl',        label: 'Tax Suspense GL',  desc: 'Credit account for withholding tax on the leave allowance.', mono: true },
    { key: 'leave_allow_debit_gl',      label: 'Debit GL',         desc: 'Fallback debit account when no GL is set on the leave type.', mono: true },
    { key: 'leave_allow_annual_factor', label: 'Annual Factor',    desc: 'Basic × 12 × factor = Gross Leave Allowance (e.g. 0.3).', mono: false },
    { key: 'leave_allow_tax_rate',      label: 'Tax Rate',         desc: 'Rate applied to the taxable portion of the allowance (e.g. 0.3 = 30%).', mono: false },
  ] as { key: string; label: string; desc: string; mono: boolean }[];

  return (
    <div className="space-y-4">
      <SectionCard icon={<CalendarRange size={13} />} title="Leave Calendar Visibility">
        <ControlRow
          label="Show all employees' leaves"
          description="When on, all employees can see everyone's approved leaves on the calendar. When off, each employee only sees their own leaves."
          checked={calendarShowAll}
          onChange={v => { setCalendarShowAll(v); saveCalendarSetting(v); }}
        />
      </SectionCard>

      {/* Leave allowance */}
      <SectionCard icon={<Banknote size={13} />} title="Leave Allowance">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <p className="text-[12px] text-[var(--text-muted)]">
            Paid out when a leave application with allowance requested is approved. Formula: <span className="font-mono">Gross = Basic × 12 × Factor</span>; tax deducted from taxable portion.
          </p>
        </div>
        <div className="flex items-center gap-4 px-5 py-4 border-b border-[var(--border)]">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">Enable Leave Allowance</p>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">When on, the allowance is calculated and GL entries are recorded on approval.</p>
          </div>
          <Toggle
            checked={allowSettings.leave_allow_enabled === 'Yes'}
            onChange={(v) => saveAllowSetting('leave_allow_enabled', v ? 'Yes' : 'No')}
          />
        </div>
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 border-b border-[var(--border)] last:border-0">
          {glFields.map(({ key, label, desc, mono }) => (
            <div key={key} className="space-y-1.5">
              <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">{label}</p>
              <p className="text-[12px] text-[var(--text-muted)]">{desc}</p>
              <input
                className={`${inputClass} w-full ${mono ? 'font-mono text-[12px]' : ''}`}
                value={allowSettings[key] ?? ''}
                onChange={e => setAllowSettings((p: any) => ({ ...p, [key]: e.target.value }))}
                onBlur={e => saveAllowSetting(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </SectionCard>

    </div>
  );
}

function AttendanceSection() {
  const [cfg, setCfg] = useState<any>(null);

  const load = () => api.get('/attendance/settings').then(r => setCfg(r.data?.data ?? {})).catch(() => {});
  useEffect(() => { load(); }, []);

  // Toggles save immediately; text/time inputs update locally and persist on blur
  const save = (key: string, value: string) => {
    setCfg((p: any) => ({ ...p, [key]: value }));
    api.put('/attendance/settings', { [key]: value }).catch(() => toast.error('Failed to save setting'));
  };
  const set     = (key: string, value: string) => setCfg((p: any) => ({ ...p, [key]: value }));
  const persist = (key: string) => api.put('/attendance/settings', { [key]: cfg[key] }).catch(() => toast.error('Failed to save setting'));

  const regenerate = async (target: 'device' | 'kiosk') => {
    try {
      const r = await api.post('/attendance/settings/regenerate-key', { target });
      const key = r.data?.data?.key;
      await navigator.clipboard.writeText(key).catch(() => {});
      toast.success(`New ${target === 'kiosk' ? 'kiosk link' : 'API key'} generated and copied`);
      load();
    } catch { toast.error('Failed to regenerate'); }
  };

  if (!cfg) {
    return <p className="text-[13px] text-[var(--text-muted)] text-center py-10">Loading…</p>;
  }

  const kioskUrl = cfg.attendance_kiosk_token ? `${window.location.origin}/kiosk/${cfg.attendance_kiosk_token}` : '';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 auto-rows-min">
        <SectionCard icon={<Clock size={13} />} title="Work Schedule">
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
              Lateness, early leave, and overtime are measured against these times. Changes apply to future punches.
            </p>
          </div>
          <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-4 border-b border-[var(--border-light)]">
            {([
              { key: 'attendance_work_start', label: 'Work Start Time', type: 'time' },
              { key: 'attendance_work_end',   label: 'Work End Time',   type: 'time' },
              { key: 'attendance_grace_minutes', label: 'Grace Period (min)', type: 'number' },
              { key: 'attendance_half_day_threshold_minutes', label: 'Half-Day Threshold (min)', type: 'number' },
            ] as { key: string; label: string; type: string }[]).map(f => (
              <div key={f.key} className="space-y-1.5">
                <p className="text-[12px] font-semibold text-[var(--text-primary)]">{f.label}</p>
                <input
                  type={f.type} min="0"
                  className={`${inputClass} w-full`}
                  value={cfg[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  onBlur={() => persist(f.key)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
              </div>
            ))}
          </div>
          <ControlRow
            label="Auto-mark Absentees"
            description="Once the closing time passes, anyone who has not clocked in is marked Absent (night workers are checked after the night closing time the next morning). Weekends, holidays, and approved leave are skipped; a late punch overrides the Absent mark."
            checked={cfg.attendance_auto_absent_enabled === '1'}
            onChange={v => save('attendance_auto_absent_enabled', v ? '1' : '0')}
          />
        </SectionCard>

        <SectionCard icon={<Clock size={13} />} title="Night Shift Hours">
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
              Schedule for employees assigned to the night shift (Manage Attendance → Night Shift). A shift that
              crosses midnight counts toward the day it started — a 02:00 clock-out belongs to the previous day's record.
            </p>
          </div>
          <div className="px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-4">
            {([
              { key: 'attendance_night_start', label: 'Night Start Time' },
              { key: 'attendance_night_end',   label: 'Night Closing Time' },
            ] as { key: string; label: string }[]).map(f => (
              <div key={f.key} className="space-y-1.5">
                <p className="text-[12px] font-semibold text-[var(--text-primary)]">{f.label}</p>
                <input
                  type="time"
                  className={`${inputClass} w-full`}
                  value={cfg[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value)}
                  onBlur={() => persist(f.key)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard icon={<MapPin size={13} />} title="Web Clock In/Out">
          <ControlRow
            label="Require Location"
            description="Employees cannot clock in/out from the app until the browser shares their location — punches without coordinates are rejected. When off, location is captured when available but never blocks."
            checked={cfg.attendance_web_require_location === '1'}
            onChange={v => save('attendance_web_require_location', v ? '1' : '0')}
          />
          <ControlRow
            label="Require Photo (In-App)"
            description="Captures a webcam photo with every clock in/out from the app, just like the kiosk. The photo appears in the Daily Log record details."
            checked={cfg.attendance_web_require_photo === '1'}
            onChange={v => save('attendance_web_require_photo', v ? '1' : '0')}
          />
        </SectionCard>

        <SectionCard icon={<Tablet size={13} />} title="Kiosk Mode">
          <ControlRow
            label="Kiosk Enabled"
            description="A shared tablet page where staff punch in/out with their staff ID or a badge scan. Takes effect immediately — the link below only works while enabled."
            checked={cfg.attendance_kiosk_enabled === '1'}
            onChange={v => save('attendance_kiosk_enabled', v ? '1' : '0')}
          />
          <ControlRow
            label="Require Photo at Kiosk"
            description="Captures a webcam photo with each kiosk punch — deters staff punching for absent colleagues."
            checked={cfg.attendance_kiosk_require_photo === '1'}
            onChange={v => save('attendance_kiosk_require_photo', v ? '1' : '0')}
          />
          <div className="px-5 py-4 space-y-2">
            <p className="text-[12px] font-semibold text-[var(--text-primary)]">Kiosk Link</p>
            <div className="flex items-center gap-2">
              <input className={`${inputClass} flex-1 font-mono text-[11px]`} readOnly value={kioskUrl} />
              <button className="secondary-btn shrink-0" onClick={() => { navigator.clipboard.writeText(kioskUrl); toast.success('Kiosk URL copied'); }}>
                <Copy size={13} />
              </button>
              <button className="secondary-btn shrink-0" title="Invalidate the old link and generate a new one" onClick={() => regenerate('kiosk')}>
                <RefreshCw size={13} />
              </button>
            </div>
            {cfg.attendance_kiosk_enabled !== '1' && (
              <p className="text-[11.5px] text-amber-600">Kiosk is disabled — this link returns "not available" until you enable it above.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard icon={<Network size={13} />} title="Biometric Device API">
          <div className="px-5 py-3 border-b border-[var(--border)]">
            <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
              Device integrations push punches to <span className="font-mono text-[11px]">POST /v1/api/hr/public/attendance/device-sync</span> with
              the <span className="font-mono text-[11px]">x-api-key</span> header. Punch logs can also be imported as CSV from Manage Attendance → Imports.
            </p>
          </div>
          <div className="px-5 py-4 space-y-2">
            <p className="text-[12px] font-semibold text-[var(--text-primary)]">API Key</p>
            <div className="flex items-center gap-2">
              <input className={`${inputClass} flex-1 font-mono text-[12px]`} readOnly value={cfg.attendance_device_api_key ?? ''} />
              <button className="secondary-btn shrink-0" onClick={() => regenerate('device')}>
                <KeyRound size={13} className="inline mr-1.5" />Regenerate
              </button>
            </div>
            <p className="text-[11.5px] text-[var(--text-muted)]">Regenerating revokes the old key immediately — the new key is copied to your clipboard once.</p>
          </div>
        </SectionCard>
      </div>

      <SectionCard icon={<Mail size={13} />} title="Daily Email Digest">
        <ControlRow
          label="Digest Enabled"
          description="Emails yesterday's attendance summary to the recipients below every morning at 08:00. Uses the SMTP configuration from the Email Setup tab."
          checked={cfg.attendance_digest_enabled === '1'}
          onChange={v => save('attendance_digest_enabled', v ? '1' : '0')}
        />
        <div className="px-5 py-4 space-y-1.5">
          <p className="text-[12px] font-semibold text-[var(--text-primary)]">Recipients</p>
          <input
            className={`${inputClass} w-full`}
            placeholder="hr@company.com, ops@company.com"
            value={cfg.attendance_digest_recipients ?? ''}
            onChange={e => set('attendance_digest_recipients', e.target.value)}
            onBlur={() => persist('attendance_digest_recipients')}
          />
          <p className="text-[11.5px] text-[var(--text-muted)]">Comma-separated email addresses.</p>
        </div>
      </SectionCard>
    </div>
  );
}

function MedicalGlSection({
  whtHosp, setWhtHosp, whtPharm, setWhtPharm, saveWhtRates,
  glExpense, setGlExpense, glWht, setGlWht, glBranch, setGlBranch, saveGlSettings,
}: any) {
  return (
    <div className="space-y-4">
      <SectionCard icon={<Stethoscope size={13} />} title="Medical Claims — Withholding Tax">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <p className="text-[12px] text-[var(--text-muted)]">
            Applied to hospital claims on save. Formula: <span className="font-mono">withholding_tax = total × (rate ÷ 100)</span>
          </p>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-6">
          {([
            { label: 'Hospital WHT Rate', val: whtHosp, set: setWhtHosp },
            { label: 'Pharmacy WHT Rate', val: whtPharm, set: setWhtPharm },
          ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
            <div key={label} className="space-y-1.5">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">{label}</p>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="100" step="0.01"
                  className={`${inputClass} flex-1 text-right`}
                  value={val}
                  onChange={e => set(e.target.value)}
                  onBlur={() => saveWhtRates(whtHosp, whtPharm)} />
                <span className="text-[13px] text-[var(--text-muted)] w-4 shrink-0">%</span>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<Network size={13} />} title="GL Posting — Medical">
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <p className="text-[12px] text-[var(--text-muted)]">
            GL accounts used when medical records are approved or finalised. Leave a field blank to skip that leg of the posting.
          </p>
        </div>
        <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {([
            { label: 'Medical Expense GL', desc: 'Debit — medical expense',        val: glExpense, set: setGlExpense, mono: true  },
            { label: 'WHT Payable GL',     desc: 'Credit — withheld tax',           val: glWht,     set: setGlWht,     mono: true  },
            { label: 'Posting Branch',     desc: 'Branch code (env default if blank)', val: glBranch, set: setGlBranch, mono: false },
          ] as { label: string; desc: string; val: string; set: (v: string) => void; mono: boolean }[]).map(({ label, desc, val, set, mono }) => (
            <div key={label} className="space-y-1.5">
              <div>
                <p className="text-[12px] font-semibold text-[var(--text-primary)] leading-snug">{label}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{desc}</p>
              </div>
              <input
                className={`${inputClass} w-full ${mono ? 'font-mono text-[12px]' : ''}`}
                value={val}
                placeholder="Enter account code…"
                onChange={e => set(e.target.value)}
                onBlur={saveGlSettings}
              />
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// ─── Integrations section ─────────────────────────────────────────────────────

function IntegrationsSection({ glUrl, setGlUrl, glApiKey, setGlApiKey, glApiSecret, setGlApiSecret,
  glBearerToken, setGlBearerToken, glBasicUser, setGlBasicUser, glBasicPass, setGlBasicPass,
  glTimeout, setGlTimeout, glExtra, setGlExtra,
  empSyncUrl, setEmpSyncUrl, empSyncTimeout, setEmpSyncTimeout,
  empSyncApiKey, setEmpSyncApiKey, empSyncApiSecret, setEmpSyncApiSecret,
  empSyncBearerToken, setEmpSyncBearerToken,
  empSyncBasicUser, setEmpSyncBasicUser, empSyncBasicPass, setEmpSyncBasicPass,
  empSyncExtra, setEmpSyncExtra,
  onSave, saving }: any) {
  const [showKey,        setShowKey]        = useState(false);
  const [showSecret,     setShowSecret]     = useState(false);
  const [showPass,       setShowPass]       = useState(false);
  const [showEmpKey,     setShowEmpKey]     = useState(false);
  const [showEmpSecret,  setShowEmpSecret]  = useState(false);
  const [showEmpPass,    setShowEmpPass]    = useState(false);

  const pw = (show: boolean, toggle: () => void, val: string, set: (v: string) => void, ph: string) => (
    <div className="relative">
      <input className={`${inputClass} w-full font-mono text-[12px] pr-9`} type={show ? 'text' : 'password'} value={val} onChange={e => set(e.target.value)} placeholder={ph} />
      <button type="button" onClick={toggle} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );

  const lbl = (text: string) => <p className="text-[13px] font-semibold text-[var(--text-primary)] mb-1.5">{text}</p>;
  const row  = (extra?: string) => `px-5 py-3.5 border-b border-[var(--border-light)] ${extra ?? ''}`;

  return (
    <div className="space-y-5">
      <SectionCard icon={<Network size={14} />} title="GL / Payments API">
        <p className="px-5 py-2 text-[11px] text-[var(--text-muted)] bg-[var(--bg)] border-b border-[var(--border-light)]">
          Used by: Medical Claims · Payroll · Leave Allowance
        </p>

        {/* URL + Timeout */}
        <div className={`${row()} flex gap-4 items-end`}>
          <div className="flex-1">
            {lbl('Endpoint URL')}
            <input className={`${inputClass} w-full font-mono text-[12px]`} value={glUrl} onChange={e => setGlUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="w-32 shrink-0">
            {lbl('Timeout (ms)')}
            <input className={`${inputClass} w-full font-mono text-[12px]`} type="number" min="0" value={glTimeout} onChange={e => setGlTimeout(e.target.value)} />
          </div>
        </div>

        {/* API Key + Secret */}
        <div className={`${row()} grid grid-cols-2 gap-4`}>
          <div>
            {lbl('API Key')}
            {pw(showKey, () => setShowKey(v => !v), glApiKey, setGlApiKey, 'Not configured')}
          </div>
          <div>
            {lbl('API Secret')}
            {pw(showSecret, () => setShowSecret(v => !v), glApiSecret, setGlApiSecret, 'Not configured')}
          </div>
        </div>

        {/* Bearer Token + Basic Auth side by side */}
        <div className={`${row()} grid grid-cols-2 gap-4`}>
          <div>
            {lbl('Bearer Token')}
            <input className={`${inputClass} w-full font-mono text-[12px]`} value={glBearerToken} onChange={e => setGlBearerToken(e.target.value)} placeholder="Not set" />
            <p className="text-[11px] text-[var(--text-muted)] mt-1">OAuth / JWT — overrides Key & Secret</p>
          </div>
          <div>
            {lbl('Basic Auth')}
            <div className="grid grid-cols-2 gap-2">
              <input className={`${inputClass} font-mono text-[12px]`} value={glBasicUser} onChange={e => setGlBasicUser(e.target.value)} placeholder="Username" />
              {pw(showPass, () => setShowPass(v => !v), glBasicPass, setGlBasicPass, 'Password')}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Used when Bearer Token is empty</p>
          </div>
        </div>

        {/* Extra Parameters */}
        <div className="px-5 py-3.5">
          {lbl('Extra Parameters')}
          <p className="text-[12px] text-[var(--text-muted)] mb-1.5">JSON object for provider-specific fields (channel code, transaction type, currency, branch, etc.).</p>
          <CountedTextarea className={`${inputClass} w-full font-mono text-[12px] resize-none`} rows={3} value={glExtra} onChange={e => setGlExtra(e.target.value)} placeholder="{}" />
        </div>
      </SectionCard>

      <SectionCard icon={<Users size={14} />} title="Employee Sync API">
        {/* URL + Timeout */}
        <div className={`${row()} flex gap-4 items-end`}>
          <div className="flex-1">
            {lbl('Endpoint URL')}
            <input className={`${inputClass} w-full font-mono text-[12px]`} value={empSyncUrl} onChange={e => setEmpSyncUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="w-32 shrink-0">
            {lbl('Timeout (ms)')}
            <input className={`${inputClass} w-full font-mono text-[12px]`} type="number" min="0" value={empSyncTimeout} onChange={e => setEmpSyncTimeout(e.target.value)} />
          </div>
        </div>

        {/* Credentials header */}
        <div className="flex items-center justify-between px-5 py-2 bg-[var(--bg)] border-b border-[var(--border-light)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-[var(--accent)] shrink-0" />
            <span className="text-[11px] font-bold syne uppercase tracking-widest text-[var(--text-muted)]">Credentials</span>
          </div>
          <span className="text-[11px] text-[var(--text-muted)] italic">Leave blank to use GL / Payments values</span>
        </div>

        {/* API Key + Secret */}
        <div className={`${row()} grid grid-cols-2 gap-4`}>
          <div>
            {lbl('API Key')}
            {pw(showEmpKey, () => setShowEmpKey(v => !v), empSyncApiKey, setEmpSyncApiKey, glApiKey ? 'Using GL / Payments value' : 'Not configured')}
          </div>
          <div>
            {lbl('API Secret')}
            {pw(showEmpSecret, () => setShowEmpSecret(v => !v), empSyncApiSecret, setEmpSyncApiSecret, glApiSecret ? 'Using GL / Payments value' : 'Not configured')}
          </div>
        </div>

        {/* Bearer Token + Basic Auth */}
        <div className="px-5 py-3.5 grid grid-cols-2 gap-4">
          <div>
            {lbl('Bearer Token')}
            <input className={`${inputClass} w-full font-mono text-[12px]`} value={empSyncBearerToken} onChange={e => setEmpSyncBearerToken(e.target.value)} placeholder={glBearerToken ? 'Using GL / Payments value' : 'Not set'} />
          </div>
          <div>
            {lbl('Basic Auth')}
            <div className="grid grid-cols-2 gap-2">
              <input className={`${inputClass} font-mono text-[12px]`} value={empSyncBasicUser} onChange={e => setEmpSyncBasicUser(e.target.value)} placeholder={glBasicUser ? 'Using GL value' : 'Username'} />
              {pw(showEmpPass, () => setShowEmpPass(v => !v), empSyncBasicPass, setEmpSyncBasicPass, glBasicPass ? 'Using GL value' : 'Password')}
            </div>
          </div>
        </div>
        <div className={row()}>
          {lbl('Extra Parameters')}
          <p className="text-[12px] text-[var(--text-muted)] mb-1.5">JSON object for provider-specific fields.</p>
          <CountedTextarea className={`${inputClass} w-full font-mono text-[12px] resize-none`} rows={3} value={empSyncExtra} onChange={e => setEmpSyncExtra(e.target.value)} placeholder="{}" />
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[13px] font-semibold text-white bg-[var(--accent)] hover:opacity-90 disabled:opacity-60 transition-opacity">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save Integrations'}
        </button>
      </div>
    </div>
  );
}

// ─── Controls tab ─────────────────────────────────────────────────────────────

type ControlsSubTab = 'General' | 'Approvals' | 'Postings' | 'Leave' | 'Attendance' | 'Medical & GL' | 'Employee Form' | 'Integrations';
const CONTROLS_SUBTABS: ControlsSubTab[] = ['General', 'Approvals', 'Postings', 'Leave', 'Attendance', 'Medical & GL', 'Employee Form', 'Integrations'];

function ControlsTab() {
  const { can } = useCan();
  const canManage = can('manage_settings');   // view_settings = read-only; manage_settings = edit
  const [subTab, setSubTab] = useState<ControlsSubTab>('General');

  // ── General / Approvals state (server-backed, in-memory cache) ────────────
  const [autoGenCode,          setAutoGenCode]          = useState(() => getSettings().companyStructure.autoGenerateCode);
  const [autoGenEmpNum,        setAutoGenEmpNum]        = useState(() => getSettings().employees.autoGenerateNumber);
  const [empIdFormat,          setEmpIdFormat]          = useState(() => getSettings().employees.idFormat);
  const [autoGenJobCode,       setAutoGenJobCode]       = useState(() => getSettings().recruitment.autoGenerateCode);
  const [payLeave,             setPayLeave]             = useState(() => getSettings().payments.leave);
  const [payMedical,           setPayMedical]           = useState(() => getSettings().payments.medical);
  const [payPayroll,           setPayPayroll]           = useState(() => getSettings().payments.payroll);
  const [employeeApproval,     setEmployeeApproval]     = useState(() => getSettings().approvals.employeeApproval);
  const [employeeSelfApproval, setEmployeeSelfApproval] = useState(() => getSettings().approvals.employeeSelfApproval);
  const [employeeUpdateApproval, setEmployeeUpdateApproval] = useState(() => getSettings().approvals.employeeUpdateApproval);
  const [payrollApproval,      setPayrollApproval]      = useState(() => getSettings().approvals.payrollApproval);
  const [selfApproval,         setSelfApproval]         = useState(() => getSettings().approvals.selfApproval);
  const [medicalApproval,      setMedicalApproval]      = useState(() => getSettings().approvals.medicalApproval);
  const [medicalSelfApproval,  setMedicalSelfApproval]  = useState(() => getSettings().approvals.medicalSelfApproval);
  const [currency,             setCurrency]             = useState(() => getSettings().general.currency);

  // ── Medical WHT state (backend) ───────────────────────────────────────────
  const [whtHosp,  setWhtHosp]  = useState<string>(() => String(getSettings().medicalClaims.hospitalWhtRate));
  const [whtPharm, setWhtPharm] = useState<string>(() => String(getSettings().medicalClaims.pharmacyWhtRate));
  const [glExpense, setGlExpense] = useState('');
  const [glWht,     setGlWht]     = useState('');
  const [glBranch,  setGlBranch]  = useState('');

  // ── Training approval flow state (backend) ───────────────────────────────
  const [trainingApprovalFlow, setTrainingApprovalFlow] = useState<'direct' | 'supervisor_first'>('direct');

  // ── Leave settings state (backend) ───────────────────────────────────────
  const [supervisorApproval, setSupervisorApproval] = useState(false);
  const [allowSettings, setAllowSettings]           = useState<Record<string, string>>({
    leave_allow_enabled: 'No',
    leave_allow_tax_gl: '',
    leave_allow_debit_gl: '',
    leave_allow_annual_factor: '0.3',
    leave_allow_tax_rate: '0.3',
  });


  // ── Calendar visibility state (backend) ──────────────────────────────────
  const [calendarShowAll, setCalendarShowAll] = useState(false);

  // ── Document settings state (backend) ────────────────────────────────────
  const [allowDocumentDownload, setAllowDocumentDownload] = useState(false);

  // ── API Integrations state (backend) ─────────────────────────────────────
  const [glUrl,          setGlUrl]          = useState('');
  const [glApiKey,       setGlApiKey]       = useState('');
  const [glApiSecret,    setGlApiSecret]    = useState('');
  const [glBearerToken,  setGlBearerToken]  = useState('');
  const [glBasicUser,    setGlBasicUser]    = useState('');
  const [glBasicPass,    setGlBasicPass]    = useState('');
  const [glTimeout,      setGlTimeout]      = useState('30000');
  const [glExtra,        setGlExtra]        = useState('{}');
  const [empSyncUrl,          setEmpSyncUrl]          = useState('');
  const [empSyncTimeout,      setEmpSyncTimeout]      = useState('10000');
  const [empSyncApiKey,       setEmpSyncApiKey]       = useState('');
  const [empSyncApiSecret,    setEmpSyncApiSecret]    = useState('');
  const [empSyncBearerToken,  setEmpSyncBearerToken]  = useState('');
  const [empSyncBasicUser,    setEmpSyncBasicUser]    = useState('');
  const [empSyncBasicPass,    setEmpSyncBasicPass]    = useState('');
  const [empSyncExtra,        setEmpSyncExtra]        = useState('{}');
  const [apiSaving,           setApiSaving]           = useState(false);

  // ── Load from backend on mount ────────────────────────────────────────────
  useEffect(() => {
    api.get('/medical/settings').then(r => {
      const d = r.data.data ?? {};
      setWhtHosp(d.wht_rate_hospital  ?? '0');
      setWhtPharm(d.wht_rate_pharmacy ?? '0');
      saveSetting('medicalClaims', {
        hospitalWhtRate: parseFloat(d.wht_rate_hospital  ?? 0),
        pharmacyWhtRate: parseFloat(d.wht_rate_pharmacy  ?? 0),
      });
    }).catch(() => {});

    api.get('/medical/gl-settings').then(r => {
      const d = r.data.data ?? {};
      setGlExpense(d.medical_expense_gl ?? '');
      setGlWht(d.medical_wht_gl        ?? '');
      setGlBranch(d.medical_gl_branch  ?? '');
    }).catch(() => {});

    api.get('/leave/approval-settings').then(r => {
      const d = r.data.data ?? {};
      setSupervisorApproval(d.leave_supervisor_approval === 'Yes');
    }).catch(() => {});

    api.get('/training/settings').then(r => {
      const d = r.data.data ?? {};
      setTrainingApprovalFlow(d.approval_flow === 'supervisor_first' ? 'supervisor_first' : 'direct');
    }).catch(() => {});

    api.get('/leave/allowance-settings').then(r => {
      const d = r.data.data ?? {};
      if (Object.keys(d).length) setAllowSettings(d);
    }).catch(() => {});

    api.get('/leave/calendar-settings').then(r => {
      const d = r.data.data ?? {};
      setCalendarShowAll(d.calendar_show_all === 'Yes');
    }).catch(() => {});

    api.get('/documents/settings').then(r => {
      const d = r.data.data ?? {};
      setAllowDocumentDownload(d.allow_document_download === 'Yes');
    }).catch(() => {});

    api.get('/settings/api-integrations').then(r => {
      const d = r.data.data ?? {};
      setGlUrl(d.gl_url                ?? '');
      setGlApiKey(d.gl_api_key         ?? '');
      setGlApiSecret(d.gl_api_secret   ?? '');
      setGlBearerToken(d.gl_bearer_token ?? '');
      setGlBasicUser(d.gl_basic_user   ?? '');
      setGlBasicPass(d.gl_basic_pass   ?? '');
      setGlTimeout(d.gl_timeout        ?? '30000');
      setGlExtra(d.gl_extra            ?? '{}');
      setEmpSyncUrl(d.employee_sync_url                 ?? '');
      setEmpSyncTimeout(d.employee_sync_timeout         ?? '10000');
      setEmpSyncApiKey(d.employee_sync_api_key          ?? '');
      setEmpSyncApiSecret(d.employee_sync_api_secret    ?? '');
      setEmpSyncBearerToken(d.employee_sync_bearer_token ?? '');
      setEmpSyncBasicUser(d.employee_sync_basic_user    ?? '');
      setEmpSyncBasicPass(d.employee_sync_basic_pass    ?? '');
      setEmpSyncExtra(d.employee_sync_extra              ?? '{}');
    }).catch(() => {});
  }, []);

  // ── Save helpers ──────────────────────────────────────────────────────────
  function saveWhtRates(hospVal: string, pharmVal: string) {
    api.put('/medical/settings', {
      wht_rate_hospital: hospVal,
      wht_rate_pharmacy: pharmVal,
    }).then(() => {
      saveSetting('medicalClaims', {
        hospitalWhtRate: parseFloat(hospVal),
        pharmacyWhtRate: parseFloat(pharmVal),
      });
    }).catch(() => {});
  }

  function saveGlSettings() {
    api.put('/medical/gl-settings', {
      medical_expense_gl: glExpense,
      medical_wht_gl:     glWht,
      medical_gl_branch:  glBranch,
    }).catch(() => {});
  }

  function saveFlowSettings(sv: boolean) {
    api.put('/leave/approval-settings', {
      leave_supervisor_approval: sv ? 'Yes' : 'No',
    }).catch(() => {});
  }

  function saveTrainingFlowSettings(flow: string) {
    api.put('/training/settings', { approval_flow: flow })
      .then(() => toast.success('Training approval flow saved'))
      .catch(() => toast.error('Failed to save training settings'));
  }

  function saveAllowSetting(key: string, val: string) {
    api.put('/leave/allowance-settings', { [key]: val }).catch(() => {});
    setAllowSettings(prev => ({ ...prev, [key]: val }));
  }

  function saveCalendarSetting(val: boolean) {
    api.put('/leave/calendar-settings', { calendar_show_all: val ? 'Yes' : 'No' })
      .then(() => toast.success('Calendar settings saved'))
      .catch(() => toast.error('Failed to save calendar settings'));
  }

  function saveDocumentSetting(val: string) {
    api.put('/documents/settings', { allow_document_download: val })
      .then(() => toast.success('Document settings saved'))
      .catch(() => toast.error('Failed to save document settings'));
  }

  async function saveApiIntegrations() {
    setApiSaving(true);
    try {
      await api.put('/settings/api-integrations', {
        gl_url: glUrl, gl_api_key: glApiKey, gl_api_secret: glApiSecret,
        gl_bearer_token: glBearerToken, gl_basic_user: glBasicUser, gl_basic_pass: glBasicPass,
        gl_timeout: glTimeout, gl_extra: glExtra,
        employee_sync_url: empSyncUrl, employee_sync_timeout: empSyncTimeout,
        employee_sync_api_key: empSyncApiKey, employee_sync_api_secret: empSyncApiSecret,
        employee_sync_bearer_token: empSyncBearerToken,
        employee_sync_basic_user: empSyncBasicUser, employee_sync_basic_pass: empSyncBasicPass,
        employee_sync_extra: empSyncExtra,
      });
      toast.success('Integration settings saved');
    } catch {
      toast.error('Failed to save integration settings');
    } finally {
      setApiSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab strip */}
      <div className="flex items-end gap-0.5 px-5 pt-3 border-b border-[var(--border)] shrink-0 flex-wrap">
        {CONTROLS_SUBTABS.map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={[
              'px-3.5 py-2 text-[12px] font-semibold rounded-t-lg transition-colors whitespace-nowrap',
              t === subTab
                ? 'bg-[var(--surface)] border border-b-[var(--surface)] border-[var(--border)] text-[var(--accent)] -mb-px z-10'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg)] rounded-t-lg',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content — disabled (read-only) without manage_settings */}
      <fieldset disabled={!canManage} className={`flex-1 overflow-y-auto p-5 min-w-0 border-0 m-0 ${!canManage ? 'readonly-section' : ''}`}>
        {subTab === 'General' && (
          <GeneralSection
            autoGenCode={autoGenCode} setAutoGenCode={setAutoGenCode}
            autoGenEmpNum={autoGenEmpNum} setAutoGenEmpNum={setAutoGenEmpNum}
            empIdFormat={empIdFormat} setEmpIdFormat={setEmpIdFormat}
            autoGenJobCode={autoGenJobCode} setAutoGenJobCode={setAutoGenJobCode}
            currency={currency} setCurrency={setCurrency}
            allowDocumentDownload={allowDocumentDownload} setAllowDocumentDownload={setAllowDocumentDownload}
            saveDocumentSetting={saveDocumentSetting}
          />
        )}
        {subTab === 'Approvals' && (
          <ApprovalsSection
            employeeApproval={employeeApproval}       setEmployeeApproval={setEmployeeApproval}
            employeeSelfApproval={employeeSelfApproval} setEmployeeSelfApproval={setEmployeeSelfApproval}
            employeeUpdateApproval={employeeUpdateApproval} setEmployeeUpdateApproval={setEmployeeUpdateApproval}
            payrollApproval={payrollApproval}         setPayrollApproval={setPayrollApproval}
            selfApproval={selfApproval}               setSelfApproval={setSelfApproval}
            medicalApproval={medicalApproval}         setMedicalApproval={setMedicalApproval}
            medicalSelfApproval={medicalSelfApproval} setMedicalSelfApproval={setMedicalSelfApproval}
            supervisorApproval={supervisorApproval}         setSupervisorApproval={setSupervisorApproval}
            saveFlowSettings={saveFlowSettings}
            trainingApprovalFlow={trainingApprovalFlow}   setTrainingApprovalFlow={setTrainingApprovalFlow}
            saveTrainingFlowSettings={saveTrainingFlowSettings}
          />
        )}
        {subTab === 'Postings' && (
          <PostingsSection
            payLeave={payLeave}     setPayLeave={setPayLeave}
            payMedical={payMedical} setPayMedical={setPayMedical}
            payPayroll={payPayroll} setPayPayroll={setPayPayroll}
          />
        )}
        {subTab === 'Leave' && (
          <LeaveSection
            allowSettings={allowSettings}           setAllowSettings={setAllowSettings}
            saveAllowSetting={saveAllowSetting}
            calendarShowAll={calendarShowAll} setCalendarShowAll={setCalendarShowAll}
            saveCalendarSetting={saveCalendarSetting}
          />
        )}
        {subTab === 'Attendance' && <AttendanceSection />}
        {subTab === 'Employee Form' && <EmployeeFormFieldsSection />}
        {subTab === 'Medical & GL' && (
          <MedicalGlSection
            whtHosp={whtHosp}   setWhtHosp={setWhtHosp}
            whtPharm={whtPharm} setWhtPharm={setWhtPharm}
            saveWhtRates={saveWhtRates}
            glExpense={glExpense} setGlExpense={setGlExpense}
            glWht={glWht}         setGlWht={setGlWht}
            glBranch={glBranch}   setGlBranch={setGlBranch}
            saveGlSettings={saveGlSettings}
          />
        )}
        {subTab === 'Integrations' && (
          <IntegrationsSection
            glUrl={glUrl} setGlUrl={setGlUrl}
            glApiKey={glApiKey} setGlApiKey={setGlApiKey}
            glApiSecret={glApiSecret} setGlApiSecret={setGlApiSecret}
            glBearerToken={glBearerToken} setGlBearerToken={setGlBearerToken}
            glBasicUser={glBasicUser} setGlBasicUser={setGlBasicUser}
            glBasicPass={glBasicPass} setGlBasicPass={setGlBasicPass}
            glTimeout={glTimeout} setGlTimeout={setGlTimeout}
            glExtra={glExtra} setGlExtra={setGlExtra}
            empSyncUrl={empSyncUrl} setEmpSyncUrl={setEmpSyncUrl}
            empSyncTimeout={empSyncTimeout} setEmpSyncTimeout={setEmpSyncTimeout}
            empSyncApiKey={empSyncApiKey} setEmpSyncApiKey={setEmpSyncApiKey}
            empSyncApiSecret={empSyncApiSecret} setEmpSyncApiSecret={setEmpSyncApiSecret}
            empSyncBearerToken={empSyncBearerToken} setEmpSyncBearerToken={setEmpSyncBearerToken}
            empSyncBasicUser={empSyncBasicUser} setEmpSyncBasicUser={setEmpSyncBasicUser}
            empSyncBasicPass={empSyncBasicPass} setEmpSyncBasicPass={setEmpSyncBasicPass}
            empSyncExtra={empSyncExtra} setEmpSyncExtra={setEmpSyncExtra}
            onSave={saveApiIntegrations} saving={apiSaving}
          />
        )}
      </fieldset>
    </div>
  );
}

// ─── Email Setup tab ──────────────────────────────────────────────────────────

const DEFAULT_EMAIL: Record<string, string> = {
  email_enabled:     '1',
  email_smtp_host:   '',
  email_smtp_port:   '587',
  email_smtp_secure: 'false',
  email_smtp_user:   '',
  email_smtp_pass:   '',
  email_from:        '',
};

function EmailSetupTab() {
  const [settings,  setSettings]  = useState<Record<string, string>>(DEFAULT_EMAIL);
  const [saving,    setSaving]    = useState(false);
  const [testTo,    setTestTo]    = useState('');
  const [testing,   setTesting]   = useState(false);
  const [showPass,  setShowPass]  = useState(false);

  useEffect(() => {
    api.get('/settings/email').then(r => {
      const d = r.data.data ?? {};
      setSettings(prev => ({ ...prev, ...d }));
    }).catch(() => {});
  }, []);

  const set = (key: string, val: string) =>
    setSettings(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/settings/email', settings);
      toast.success('Email settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTo.trim()) { toast.error('Enter a recipient email address'); return; }
    setTesting(true);
    try {
      await api.post('/settings/email/test', { to: testTo.trim() });
      toast.success(`Test email sent to ${testTo.trim()}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to send test email');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5 space-y-4">

        {/* Enable toggle */}
        <SectionCard icon={<Mail size={13} />} title="Email Notifications">
          <ControlRow
            label="Enable Outgoing Emails"
            description="When disabled, no emails (welcome messages, leave notifications, scheduling invites, calendar confirmations) will be sent from the system."
            checked={settings.email_enabled === '1'}
            onChange={v => set('email_enabled', v ? '1' : '0')}
          />
        </SectionCard>

        {/* SMTP Server */}
        <SectionCard icon={<Server size={13} />} title="SMTP Server">
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 border-b border-[var(--border)]">
            <div className="space-y-1.5">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">SMTP Host</p>
              <p className="text-[12px] text-[var(--text-muted)]">Hostname or IP address of your mail server.</p>
              <input
                type="text"
                className={`${inputClass} w-full`}
                value={settings.email_smtp_host}
                onChange={e => set('email_smtp_host', e.target.value)}
                placeholder="e.g. server.company.com"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">SMTP Port</p>
              <p className="text-[12px] text-[var(--text-muted)]">587 (STARTTLS) · 465 (SSL) · 25 (plain).</p>
              <input
                type="number"
                className={`${inputClass} w-full`}
                value={settings.email_smtp_port}
                onChange={e => set('email_smtp_port', e.target.value)}
                placeholder="587"
              />
            </div>
          </div>
          <ControlRow
            label="Use TLS / SSL"
            description="Enable for port 465 (implicit TLS). For port 587 with STARTTLS, leave this off."
            checked={settings.email_smtp_secure === 'true'}
            onChange={v => set('email_smtp_secure', v ? 'true' : 'false')}
          />
        </SectionCard>

        {/* Authentication */}
        <SectionCard icon={<AtSign size={13} />} title="Authentication">
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <div className="space-y-1.5">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">Username / Email</p>
              <p className="text-[12px] text-[var(--text-muted)]">The account used to authenticate with the SMTP server.</p>
              <input
                type="text"
                className={`${inputClass} w-full`}
                value={settings.email_smtp_user}
                onChange={e => set('email_smtp_user', e.target.value)}
                placeholder="hr@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">Password / App Password</p>
              <p className="text-[12px] text-[var(--text-muted)]">Use an app-specific password if 2FA is enabled.</p>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  className={`${inputClass} w-full pr-9`}
                  value={settings.email_smtp_pass}
                  onChange={e => set('email_smtp_pass', e.target.value)}
                  placeholder="Enter password…"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">From Address</p>
              <p className="text-[12px] text-[var(--text-muted)]">
                Displayed as the sender on all outgoing emails. Can include a display name:
                <span className="font-mono ml-1">HR System &lt;hr@company.com&gt;</span>
              </p>
              <input
                type="text"
                className={`${inputClass} w-full`}
                value={settings.email_from}
                onChange={e => set('email_from', e.target.value)}
                placeholder='HR System <hr@company.com>'
              />
            </div>
          </div>
        </SectionCard>

        {/* Save button */}
        <div className="flex justify-end">
          <button className="primary-btn" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            Save Settings
          </button>
        </div>

        {/* Test email */}
        <SectionCard icon={<Send size={13} />} title="Send Test Email">
          <div className="px-5 py-4">
            <p className="text-[12px] text-[var(--text-muted)] mb-3">
              Verify your SMTP configuration by sending a test email. Make sure to save settings first.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="email"
                className={`${inputClass} flex-1`}
                value={testTo}
                onChange={e => setTestTo(e.target.value)}
                placeholder="recipient@example.com"
                onKeyDown={e => { if (e.key === 'Enter') handleTest(); }}
              />
              <button className="primary-btn shrink-0" onClick={handleTest} disabled={testing}>
                {testing
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Send size={13} />
                }
                {testing ? 'Sending…' : 'Send Test'}
              </button>
            </div>
          </div>
        </SectionCard>

      </div>
    </div>
  );
}

// ─── Notification settings ──────────────────────────────────────────────────────

const NOTIFY_MODULES: { key: string; label: string; description: string }[] = [
  { key: 'users',       label: 'Account & User Access', description: 'Welcome email with login link and credentials when a user account is created.' },
  { key: 'employees',   label: 'Employees',             description: 'Lifecycle notices (suspension, resignation, termination, reinstatement) and disciplinary records.' },
  { key: 'leave',       label: 'Leave',                 description: 'Leave application, approval, rejection, and cancellation updates.' },
  { key: 'recruitment', label: 'Recruitment',           description: 'Candidate stage updates, interview invitations, and self-scheduling links.' },
  { key: 'performance', label: 'Performance',           description: 'Review cycle start, stage hand-offs, and completion notifications.' },
  { key: 'documents',   label: 'Documents',             description: 'Document expiry alerts sent to employees.' },
  { key: 'attendance',  label: 'Attendance',            description: 'Daily attendance summary digest email.' },
];

function NotificationSettingsTab() {
  const [state, setState] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/settings/notifications')
      .then(r => setState(r.data?.data ?? {}))
      .catch(() => {/* keep defaults (all on) */})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: string, value: boolean) => {
    setState(p => ({ ...p, [key]: value }));
    api.put('/settings/notifications', { [key]: value })
      .then(() => toast.success('Notification settings saved'))
      .catch(() => { setState(p => ({ ...p, [key]: !value })); toast.error('Failed to save'); });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
          Turn a module off to stop all of its automated emails. The module keeps working normally — only its email
          notifications are suppressed. Email must also be enabled under <span className="font-semibold text-[var(--text-secondary)]">Email Setup</span> for any of these to send.
        </p>

        {loading ? (
          <div className="py-16 text-center text-[var(--text-muted)]">
            <Loader2 className="animate-spin inline" size={18} />
          </div>
        ) : (
          <SectionCard icon={<Bell size={13} />} title="Email Notifications by Module">
            {NOTIFY_MODULES.map(m => (
              <ControlRow
                key={m.key}
                label={m.label}
                description={m.description}
                checked={state[m.key] !== false}
                onChange={v => toggle(m.key, v)}
              />
            ))}
          </SectionCard>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function AiSettingsTab() {
  const [cfg, setCfg]       = useState<any>(null);
  const [health, setHealth] = useState<AiHealth | null>(null);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const refresh = () => {
    aiGetConfig().then(setCfg).catch(() => {});
    aiHealth().then(setHealth).catch(() => setHealth({ ok: false, enabled: true, reason: 'Unavailable' }));
  };
  useEffect(refresh, []);

  if (!cfg) return <div className="p-6 text-[13px] text-[var(--text-muted)]">Loading…</div>;

  const setFeature = (k: string, v: boolean) => setCfg({ ...cfg, features: { ...cfg.features, [k]: v } });

  const save = async () => {
    setSaving(true);
    try {
      await aiSaveConfig({
        enabled: cfg.enabled, base_url: cfg.baseUrl, chat_model: cfg.chatModel,
        embed_model: cfg.embedModel, features: cfg.features,
      });
      toast.success('AI settings saved');
      refresh();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const reindex = async () => {
    setReindexing(true);
    try { const r = await aiReindex(); toast.success(`Reindexed ${r.chunks} knowledge chunks`); }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Reindex failed'); }
    finally { setReindexing(false); }
  };

  const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <button type="button" onClick={() => onChange(!on)}
      className="relative w-10 h-5 rounded-full transition-colors shrink-0"
      style={{ background: on ? 'var(--accent)' : 'var(--border)' }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: on ? '22px' : '2px' }} />
    </button>
  );

  return (
    <div className="p-5 sm:p-6 space-y-6 overflow-y-auto">
      {/* Status */}
      <div className="flex items-center gap-2 text-[13px] px-4 py-3 rounded-xl border border-[var(--border)]"
        style={{ background: health?.ok ? 'var(--success-dim)' : 'var(--warning-dim)' }}>
        {health?.ok
          ? <CheckCircle2 size={16} className="text-[var(--success)]" />
          : <XCircle size={16} className="text-[var(--warning)]" />}
        <span className="text-[var(--text-secondary)]">
          {health?.ok
            ? `Connected to local AI · models: ${(health.models || []).join(', ') || 'none pulled'}`
            : (health?.reason || 'AI service unavailable')}
        </span>
      </div>

      {/* Master enable */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[14px] font-semibold text-[var(--text-primary)]">Enable AI</p>
          <p className="text-[12px] text-[var(--text-muted)]">Master switch for all on-premise AI features.</p>
        </div>
        <Toggle on={!!cfg.enabled} onChange={v => setCfg({ ...cfg, enabled: v })} />
      </div>

      {/* Connection */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1">Ollama base URL</label>
          <input className={inputClass} value={cfg.baseUrl || ''} onChange={e => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder="http://localhost:11434" />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1">Chat model</label>
          <input className={inputClass} value={cfg.chatModel || ''} onChange={e => setCfg({ ...cfg, chatModel: e.target.value })} placeholder="llama3.2:3b" />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1">Embedding model</label>
          <input className={inputClass} value={cfg.embedModel || ''} onChange={e => setCfg({ ...cfg, embedModel: e.target.value })} placeholder="nomic-embed-text" />
        </div>
      </div>

      {/* Feature toggles */}
      <div>
        <p className="text-[13px] font-semibold text-[var(--text-primary)] mb-2">Features</p>
        <div className="space-y-2">
          {[
            { k: 'assistant', label: 'Assistant (Q&A chat)' },
            { k: 'drafting',  label: 'Drafting & writing' },
            { k: 'ocr',       label: 'Document understanding (OCR)' },
            { k: 'insights',  label: 'Predictions & insights' },
          ].map(f => (
            <div key={f.k} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <span className="text-[13px] text-[var(--text-secondary)]">{f.label}</span>
              <Toggle on={cfg.features?.[f.k] !== false} onChange={v => setFeature(f.k, v)} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button onClick={save} disabled={saving} className="primary-btn">
          {saving ? <Loader2 size={14} className="inline mr-1.5 animate-spin" /> : null}Save
        </button>
        <button onClick={reindex} disabled={reindexing} className="secondary-btn">
          <RefreshCw size={14} className={`inline mr-1.5 ${reindexing ? 'animate-spin' : ''}`} />Reindex knowledge
        </button>
        <span className="text-[11px] text-[var(--text-muted)]">Rebuilds the help/document search index used by the assistant.</span>
      </div>

      <KnowledgeManager />
    </div>
  );
}

// Admin-managed knowledge entries the assistant feeds on (alongside the help content, the
// server-side knowledge/ folder, and company documents). Changes apply after Reindex.
function KnowledgeManager() {
  const [items, setItems]   = useState<KnowledgeEntry[]>([]);
  const [loading, setLoad]  = useState(true);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [title, setTitle]   = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = () => { setLoad(true); aiListKnowledge().then(setItems).catch(() => {}).finally(() => setLoad(false)); };
  useEffect(refresh, []);

  const startAdd  = () => { setEditing({ id: '', title: '', content: '', enabled: true }); setTitle(''); setContent(''); };
  const startEdit = (e: KnowledgeEntry) => { setEditing(e); setTitle(e.title); setContent(e.content); };
  const cancel    = () => { setEditing(null); setTitle(''); setContent(''); };

  const save = async () => {
    if (!title.trim() || !content.trim()) { toast.error('Title and content are required'); return; }
    setSaving(true);
    try {
      await aiSaveKnowledge({ id: editing?.id || undefined, title: title.trim(), content: content.trim() });
      toast.success(editing?.id ? 'Entry updated — reindex to apply' : 'Entry added — reindex to apply');
      cancel(); refresh();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const toggle = async (e: KnowledgeEntry) => {
    try { await aiSetKnowledgeEnabled(e.id, !e.enabled); setItems(its => its.map(i => i.id === e.id ? { ...i, enabled: !i.enabled } : i)); }
    catch { toast.error('Could not update'); }
  };

  const remove = async (e: KnowledgeEntry) => {
    if (!window.confirm(`Delete "${e.title}"?`)) return;
    try { await aiDeleteKnowledge(e.id); toast.success('Deleted — reindex to apply'); refresh(); }
    catch { toast.error('Delete failed'); }
  };

  return (
    <div className="border-t border-[var(--border)] mt-6 pt-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div>
          <p className="text-[14px] font-semibold text-[var(--text-primary)]">Knowledge</p>
          <p className="text-[12px] text-[var(--text-muted)]">Facts and policies the assistant can use to answer questions. Click <b>Reindex knowledge</b> above after changes.</p>
        </div>
        {!editing && (
          <button onClick={startAdd} className="secondary-btn shrink-0"><Plus size={14} className="inline mr-1.5" />Add entry</button>
        )}
      </div>

      {editing && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2.5">
          <input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (e.g. Remote Work Policy)" />
          <textarea className={`${inputClass} min-h-[120px]`} value={content} onChange={e => setContent(e.target.value)} placeholder="Write the knowledge content the assistant should know…" />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="primary-btn">
              {saving ? <Loader2 size={14} className="inline mr-1.5 animate-spin" /> : null}{editing.id ? 'Update' : 'Add'}
            </button>
            <button onClick={cancel} className="secondary-btn">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-[12px] text-[var(--text-muted)]">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-[var(--text-muted)]">No knowledge entries yet. Add one above, or drop files into the server's <code>src/data/knowledge/</code> folder.</p>
        ) : items.map(e => (
          <div key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{e.title}</p>
              <p className="text-[12px] text-[var(--text-muted)] line-clamp-2">{e.content}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => toggle(e)} title={e.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                className="relative w-9 h-5 rounded-full transition-colors" style={{ background: e.enabled ? 'var(--accent)' : 'var(--border)' }}>
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: e.enabled ? '18px' : '2px' }} />
              </button>
              <button onClick={() => startEdit(e)} className="p-1.5 rounded-md hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"><Pencil size={14} /></button>
              <button onClick={() => remove(e)} className="p-1.5 rounded-md hover:bg-[var(--danger-dim)] text-[var(--danger)]"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[var(--text-muted)] mt-3">
        Power tip: for bulk or file-based content, drop <code>.md</code>, <code>.txt</code> or <code>.json</code> files into the server's <code>src/data/knowledge/</code> folder — they're indexed too.
      </p>
    </div>
  );
}

// Settings → Messages: edit the wording of any system response message without touching code.
function MessagesTab() {
  const [items, setItems] = useState<MessageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [customisedOnly, setCustomisedOnly] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const refresh = () => { setLoading(true); listMessages().then(setItems).catch(() => toast.error('Failed to load messages')).finally(() => setLoading(false)); };
  useEffect(() => { refresh(); }, []);
  // Reset to the first page whenever the filters change.
  useEffect(() => { setPage(1); }, [search, category, customisedOnly, pageSize]);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    return [{ id: '', label: `All categories (${items.length})` },
      ...[...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, n]) => ({ id: c, label: `${c} (${n})` }))];
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i =>
      (!category || i.category === category) &&
      (!customisedOnly || i.override != null) &&
      (!q || i.default.toLowerCase().includes(q) || (i.override ?? '').toLowerCase().includes(q) || i.key.toLowerCase().includes(q))
    );
  }, [items, search, category, customisedOnly]);

  const startEdit = (m: MessageEntry) => { setEditingKey(m.key); setDraft(m.override ?? m.default); };
  const save = async (m: MessageEntry) => {
    if (!draft.trim()) return toast.error('Message text is required');
    setBusyKey(m.key);
    try { await saveMessage(m.key, draft, true); toast.success('Message updated'); setEditingKey(null); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Save failed'); }
    finally { setBusyKey(null); }
  };
  const reset = async (m: MessageEntry) => {
    setBusyKey(m.key);
    try { await resetMessage(m.key); toast.success('Reset to default'); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Reset failed'); }
    finally { setBusyKey(null); }
  };

  const overriddenCount = items.filter(i => i.override != null).length;
  const paged = useMemo(() => visible.slice((page - 1) * pageSize, page * pageSize), [visible, page, pageSize]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold syne tracking-tight text-[var(--text-primary)]">Response Messages</h3>
            <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed mt-0.5 max-w-2xl">
              Edit the wording of any system message. Changes apply instantly. Keep any
              <code className="font-mono text-[11px] px-1 mx-0.5 rounded bg-[var(--surface-hover)] text-[var(--accent)]">{'{token}'}</code>
              — they insert live values.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="pill pill-neutral text-[11px]">{items.length} total</span>
            <span className="pill pill-accent text-[11px]">{overriddenCount} customised</span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5 mt-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages…"
              className={`${inputClass} w-full !pl-9`} />
          </div>
          <div className="w-56 shrink-0">
            <SearchSelect value={category} onChange={setCategory} options={categoryOptions} placeholder="All categories" />
          </div>
          <button onClick={() => setCustomisedOnly(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12.5px] font-medium border transition-colors ${customisedOnly ? 'bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent)]' : 'text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>
            <Check size={13} className={customisedOnly ? '' : 'opacity-30'} /> Customised only
          </button>
        </div>
      </div>

      {/* List */}
      <div className="overflow-y-auto flex-1">
        {loading ? (
          <div className="p-10 text-center text-[var(--text-muted)] text-sm">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-[var(--text-muted)] text-sm">No messages match your filters.</div>
        ) : (
          <div className="px-2 py-1">
            {paged.map(m => {
              const editing = editingKey === m.key;
              const overridden = m.override != null;
              return (
                <div key={m.key}
                  className={`group rounded-xl px-3.5 py-3 mb-1 border transition-colors ${editing ? 'border-[var(--accent)] bg-[var(--accent-dim)]' : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-hover)]'}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <span className="pill pill-neutral text-[10px]">{m.category}</span>
                        {m.kind === 'template' && <span className="pill pill-accent text-[10px]">template</span>}
                        {overridden && <span className="pill pill-warning text-[10px]">customised</span>}
                      </div>

                      {editing ? (
                        <>
                          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} autoFocus
                            className={`${inputClass} w-full resize-y`} />
                          {m.placeholders.length > 0 && (
                            <p className="mt-1.5 text-[11px] text-[var(--text-muted)] flex items-center gap-1 flex-wrap">
                              <span>Placeholders:</span>
                              {m.placeholders.map(p => <code key={p} className="font-mono px-1 rounded bg-[var(--surface-hover)] text-[var(--accent)]">{`{${p}}`}</code>)}
                            </p>
                          )}
                          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Default: {m.default}</p>
                          <div className="flex items-center gap-2 mt-2.5">
                            <button className="primary-btn !py-1.5 !px-4 !text-xs" disabled={busyKey === m.key} onClick={() => save(m)}>
                              {busyKey === m.key ? 'Saving…' : 'Save'}
                            </button>
                            <button className="secondary-btn !py-1.5 !px-4 !text-xs" onClick={() => setEditingKey(null)}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-[13px] text-[var(--text-primary)] leading-snug break-words">{m.override ?? m.default}</p>
                          {overridden && (
                            <p className="text-[11.5px] text-[var(--text-muted)] mt-1 leading-snug break-words">
                              <span className="opacity-70">Default:</span> {m.default}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    {!editing && (
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button title="Edit message" onClick={() => startEdit(m)} className="action-btn"><Pencil size={14} /></button>
                        {overridden && (
                          <button title="Reset to default" disabled={busyKey === m.key} onClick={() => reset(m)} className="action-btn"><RotateCcw size={14} /></button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading && visible.length > 0 && (
        <div className="shrink-0">
          <TablePagination total={items.length} filtered={visible.length} page={page} pageSize={pageSize}
            onPageChange={setPage} onPageSizeChange={setPageSize} />
        </div>
      )}
    </div>
  );
}

const TABS = ['Modules', 'Notification Settings', 'Controls', 'Email Setup', 'AI', 'Messages'] as const;
type Tab = (typeof TABS)[number];

export function Settings() {
  const { can } = useCan();
  const canManage = can('manage_settings');   // view_settings = read-only; manage_settings = edit
  const [activeTab, setActiveTab] = useState<Tab>('Modules');

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full max-w-[1400px] mx-auto flex flex-col h-full">
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <PageHeader title="System Settings" subtitle="Manage system-wide configuration, modules, and notifications." />
            
      </motion.div>

      {!canManage && (
        <div className="mb-4 px-4 py-2.5 rounded-xl text-[12.5px] font-medium flex items-center gap-2"
          style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)' }}>
          <Lock size={14} className="shrink-0" />
          View-only — you need the “Manage Settings” permission to make changes.
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`tab-btn flex flex-row items-center justify-center gap-2 ${tab === activeTab ? 'active' : ''}`}
          >
            {tab === 'Modules'               && <LayoutGrid          size={13} />}
            {tab === 'Notification Settings' && <Bell                size={13} />}
            {tab === 'Controls'              && <SlidersHorizontal   size={13} />}
            {tab === 'Email Setup'           && <Mail                size={13} />}
            {tab === 'AI'                    && <Sparkles            size={13} />}
            {tab === 'Messages'              && <MessageSquare       size={13} />}
            {tab}
          </button>
        ))}
      </div>

      {/* Content card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="flex flex-col flex-1 relative"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col flex-1 h-full"
          >
            {activeTab === 'Modules' && (
              <fieldset disabled={!canManage} className={`bg-[var(--bg)] -mx-4 sm:-mx-6 md:-mx-8 border-0 m-0 p-0 ${!canManage ? 'readonly-section' : ''}`}>
                <Modules isSettings />
              </fieldset>
            )}

            {activeTab !== 'Modules' && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] flex-1 overflow-hidden drop-shadow-sm h-full">
                {/* Notification & Email tabs are read-only without manage_settings; Controls self-gates (keeps its subtab nav). */}
                {activeTab === 'Notification Settings' && (
                  <fieldset disabled={!canManage} className={`border-0 m-0 p-0 h-full ${!canManage ? 'readonly-section' : ''}`}><NotificationSettingsTab /></fieldset>
                )}
                {activeTab === 'Controls'              && <ControlsTab />}
                {activeTab === 'Email Setup'           && (
                  <fieldset disabled={!canManage} className={`border-0 m-0 p-0 h-full ${!canManage ? 'readonly-section' : ''}`}><EmailSetupTab /></fieldset>
                )}
                {activeTab === 'AI'                    && (
                  <fieldset disabled={!canManage} className={`border-0 m-0 p-0 h-full ${!canManage ? 'readonly-section' : ''}`}><AiSettingsTab /></fieldset>
                )}
                {activeTab === 'Messages'              && (
                  <fieldset disabled={!canManage} className={`border-0 m-0 p-0 h-full ${!canManage ? 'readonly-section' : ''}`}><MessagesTab /></fieldset>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
