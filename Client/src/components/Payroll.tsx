import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search, Plus, Edit, Trash2, FileText, Eye, CheckCircle, XCircle,
  TrendingUp, Users, DollarSign, ArrowLeft, ChevronDown,
  ChevronsRight, RefreshCw, Lock, Send, ThumbsUp, ThumbsDown,
  ClipboardList, GitCompare, Clock, AlertTriangle, CheckSquare, Square, Copy,
  Palette, AlignLeft, LayoutGrid, User, ShieldCheck,
  X, Columns2, Tag, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FormModal } from './ui/FormModal';
import { RowActions } from './ui/RowActions';
import { DetailSlideOver, DetailGrid, DetailField, DetailSection } from './ui/DetailSlideOver';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { Combobox } from './EmployeeTabs';
import api from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import { useCan } from '@/hooks/useCan';
import { toast } from 'sonner';
import { getSettings } from '../../lib/settings';
import { PageHeader } from './ui/PageHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalcGroup  { id: string; name: string; details: string | null; }
interface RefItem    { id: string; name: string; }
interface ProcessItem {
  lower_limit_condition: string;
  lower_limit: string;
  upper_limit_condition: string;
  upper_limit: string;
  value: string;
}
interface SavedCalc {
  id: string; name: string;
  target_type: string; target_id: string | null; target_name: string | null;
  calculation_group_id: string | null; group_name: string | null;
  items?: ProcessItem[];
}
interface PayrollCol {
  id: string; name: string; function_type: string; enabled: string; editable: string;
  colorder: number | null; default_value: string | null; payment_deduction: string | null;
  salarycomponent_gl: string | null; posting_column: string | null; posting_branch: string | null;
  deduction_groups?: string[]; component_ids?: string[];
  add_column_ids?: string[]; sub_column_ids?: string[]; calculation_function: string | null;
  calculation_rule: string | null; visible: number; include_in_net: number;
  payslip_label: string | null;
}
interface PayFreq {
  id: string; name: string; description: string | null; sort_order: number; is_active: number;
}
interface PayrollEmp {
  id: string; employee: string; emp_name: string;
  pay_frequency: string | null; freq_name: string | null;
  currency: string | null; deduction_group: string | null; group_name: string | null;
  deduction_exemptions: string | null;
}
interface PaymentType { id: string; name: string; generate_payslip?: number; }
interface PayrollRun {
  id: string; name: string;
  pay_frequency: string | null; freq_name: string | null;
  date_start: string | null; date_end: string | null;
  deduction_group: string | null; group_name: string | null;
  payment_type_id: string | null; type_name: string | null;
  status: 'Draft' | 'Processing' | 'Pending Approval' | 'Rejected' | 'Approved' | 'Completed' | 'GL Failed';
  created_at: string;
  submitted_by: string | null; approved_by: string | null;
  approved_at: string | null; rejection_reason: string | null;
  document_ref: string | null; finalized_at: string | null;
  payment_log: string | null;
}
// One stage of a run's snapshotted multi-stage approval flow.
interface RunStage {
  id: string; stage_order: number; stage_name: string;
  approver_type: 'role' | 'user'; approver_id: string; approver_label: string | null;
  status: 'Pending' | 'Approved' | 'Rejected';
  acted_by: string | null; acted_at: string | null; comment: string | null;
}
interface AuditEntry {
  id: string; run_id: string;
  action: string; user_id: string | null; user_name: string | null;
  details: string | null; created_at: string;
}
interface GridCell {
  id: string; employee: string; emp_name: string;
  payroll_item: string; column_name: string;
  payment_deduction: string | null; amount: string | null;
  colorder: number | null; visible: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOWER_CONDITIONS = [
  { value: 'NO_LOWER_LIMIT',        label: 'No Lower Limit' },
  { value: 'GREATER_THAN',          label: 'Greater Than' },
  { value: 'GREATER_THAN_OR_EQUAL', label: 'Greater Than or Equal' },
];
const UPPER_CONDITIONS = [
  { value: 'NO_UPPER_LIMIT',       label: 'No Upper Limit' },
  { value: 'LESS_THAN',            label: 'Less Than' },
  { value: 'LESS_THAN_OR_EQUAL',   label: 'Less Than or Equal' },
];

const BLANK_CG      = { name: '', details: '' };
const BLANK_PROCESS: ProcessItem = {
  lower_limit_condition: 'NO_LOWER_LIMIT', lower_limit: '',
  upper_limit_condition: 'NO_UPPER_LIMIT', upper_limit: '', value: '',
};

/** Normalize a stored limit (e.g. "0.0000", "600.0000") to exactly 2 decimal places for display/edit. */
const limit2dp = (v: any): string => {
  if (v === null || v === undefined || v === '') return '';
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n.toFixed(2) : '';
};

// Visual payslip mockup for a report template — shared by the designer's live preview
// and the read-only View slide-over. `template.visible_columns` must be an array of column ids.
function PayslipTemplatePreview({ template, paymentCols, deductionCols }: {
  template: any; paymentCols: PayrollCol[]; deductionCols: PayrollCol[];
}) {
  const accent = template.accent_color || '#3B82F6';
  const vis = Array.isArray(template.visible_columns) ? template.visible_columns.map(String) : [];
  const visE = vis.length ? paymentCols.filter(c => vis.includes(String(c.id)))   : paymentCols;
  const visD = vis.length ? deductionCols.filter(c => vis.includes(String(c.id))) : deductionCols;
  return (
    <div className="bg-white rounded-[14px] shadow-xl border border-gray-200 overflow-hidden font-sans">
      <div className="px-5 py-3 flex items-center gap-3" style={{ background: accent }}>
        {template.company_logo_url && <img src={template.company_logo_url.startsWith('http') ? template.company_logo_url : `${api.defaults.baseURL}/documents/${template.company_logo_url}`} alt="" className="h-8 w-8 rounded object-contain bg-white/20 shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-[13px] truncate">{template.company_name || 'Company Name'}</p>
          {template.company_address && <p className="text-white/75 text-[10px] mt-0.5 truncate">{template.company_address}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-white/90 font-semibold text-[11px]">PAYSLIP</p>
          <p className="text-white/60 text-[10px]">May 2026</p>
        </div>
      </div>
      <div className="px-5 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-b border-gray-100 bg-gray-50/60">
        <div><span className="text-gray-400 text-[9px] uppercase tracking-wide block">Name</span><p className="font-semibold text-gray-700 text-[10px]">John Doe</p></div>
        {template.show_emp_id && <div><span className="text-gray-400 text-[9px] uppercase tracking-wide block">Employee ID</span><p className="font-semibold text-gray-700 text-[10px]">EMP-001</p></div>}
        {template.show_department && <div><span className="text-gray-400 text-[9px] uppercase tracking-wide block">Department</span><p className="font-semibold text-gray-700 text-[10px]">Finance</p></div>}
        {template.show_position && <div><span className="text-gray-400 text-[9px] uppercase tracking-wide block">Position</span><p className="font-semibold text-gray-700 text-[10px]">Accountant</p></div>}
        {template.show_bank_account && <div><span className="text-gray-400 text-[9px] uppercase tracking-wide block">Bank</span><p className="font-semibold text-gray-700 text-[10px]">****-4567</p></div>}
      </div>
      {template.header_note && <div className="px-5 py-2 text-[10px] text-gray-500 italic bg-gray-50 border-b border-gray-100">{template.header_note}</div>}
      <div className="grid grid-cols-2 divide-x divide-gray-100">
        <div className="px-4 py-3">
          <p className="font-bold text-[10px] uppercase mb-2" style={{ color: accent }}>Earnings</p>
          {visE.length > 0
            ? visE.map(c => (
                <div key={c.id} className="flex justify-between py-0.5 text-[10px]">
                  <span className="text-gray-500 truncate max-w-[80px]">{c.name}</span>
                  <span className="text-gray-700">0.00</span>
                </div>
              ))
            : paymentCols.length === 0
              ? <div className="flex justify-between py-0.5 text-[10px]"><span className="text-gray-400">Basic Salary</span><span>5,000</span></div>
              : <p className="text-[9px] text-gray-300 italic">No columns selected</p>}
        </div>
        <div className="px-4 py-3">
          <p className="font-bold text-[10px] uppercase mb-2" style={{ color: accent }}>Deductions</p>
          {visD.length > 0
            ? visD.map(c => (
                <div key={c.id} className="flex justify-between py-0.5 text-[10px]">
                  <span className="text-gray-500 truncate max-w-[80px]">{c.name}</span>
                  <span className="text-gray-700">0.00</span>
                </div>
              ))
            : deductionCols.length === 0
              ? <div className="flex justify-between py-0.5 text-[10px]"><span className="text-gray-400">Tax</span><span>450</span></div>
              : <p className="text-[9px] text-gray-300 italic">No columns selected</p>}
        </div>
      </div>
      <div className="px-5 py-3 flex items-center justify-between" style={{ background: `${accent}18` }}>
        <span className="font-semibold text-[11px]" style={{ color: accent }}>Net Pay</span>
        <span className="font-bold text-[13px]" style={{ color: accent }}>—</span>
      </div>
      {template.footer_note && <div className="px-5 py-2 text-[10px] text-gray-400 italic border-t border-gray-100 bg-gray-50">{template.footer_note}</div>}
    </div>
  );
}

const BLANK_PC = {
  name: '', function_type: 'Simple', enabled: 'Yes', editable: 'Yes', colorder: '',
  default_value: '', payment_deduction: '', salarycomponent_gl: '', posting_column: 'Yes', posting_branch: '',
  deduction_groups: [] as string[], component_ids: [] as string[],
  add_column_ids: [] as string[], sub_column_ids: [] as string[],
  calculation_function: '', calculation_rule: '', visible: '1', include_in_net: '1',
  payslip_label: '',
};

const BLANK_PE  = { employee: '', pay_frequency: '', currency: '', deduction_group: '', deduction_exemptions: '' };
const BLANK_PF  = { name: '', description: '', sort_order: '' };
const BLANK_RUN = { name: '', pay_frequency: '', date_start: '', date_end: '', deduction_group: '', payment_type: '' };

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABS = ['Payroll Runs', 'Payroll Employees', 'Payroll Columns', 'Deduction Groups', 'Calculation Rules', 'Report Templates'];

const TAB_ICONS: Record<string, (p: { size?: number; className?: string }) => ReturnType<typeof Clock>> = {
  'Payroll Runs':      Clock,
  'Payroll Employees': Users,
  'Payroll Columns':   Columns2,
  'Deduction Groups':  Tag,
  'Calculation Rules': Zap,
  'Report Templates':  Palette,
};

// ─── Initials avatar ──────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  { bg: 'bg-blue-50   dark:bg-blue-950',   text: 'text-blue-700   dark:text-blue-300'   },
  { bg: 'bg-violet-50 dark:bg-violet-950', text: 'text-violet-700 dark:text-violet-300' },
  { bg: 'bg-emerald-50 dark:bg-emerald-950', text: 'text-emerald-700 dark:text-emerald-300' },
  { bg: 'bg-amber-50  dark:bg-amber-950',  text: 'text-amber-700  dark:text-amber-300'  },
  { bg: 'bg-rose-50   dark:bg-rose-950',   text: 'text-rose-700   dark:text-rose-300'   },
];

function Initials({ name, index }: { name: string; index: number }) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`
    : name.slice(0, 2);
  const c = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold shrink-0 ${c.bg} ${c.text}`}>
      {letters.toUpperCase()}
    </span>
  );
}

// ─── Searchable multi-select checkbox ─────────────────────────────────────────

function SearchableCheckList({
  options, selected, onChange, placeholder = 'Search…',
}: {
  options: { id: string; label: string; sub?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.sub ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every(o => selected.includes(o.id));

  const toggleAll = () => {
    if (allFilteredSelected) {
      const s = new Set(filtered.map(o => o.id));
      onChange(selected.filter(id => !s.has(id)));
    } else {
      onChange([...new Set([...selected, ...filtered.map(o => o.id)])]);
    }
  };

  return (
    <div>
      <div
        onClick={() => setOpen(o => !o)}
        className={`min-h-[40px] px-3 py-1.5 bg-[var(--surface)] border cursor-pointer flex flex-wrap gap-1.5 items-center justify-between transition-all duration-150 ${
          open
            ? 'border-[var(--accent)] ring-[3px] ring-[var(--accent-dim)] rounded-t-lg border-b-transparent'
            : 'border-[var(--border)] rounded-lg'
        }`}
      >
        {selected.length === 0 ? (
          <span className="text-[13px] text-[var(--text-muted)]">None selected</span>
        ) : (
          <div className="flex flex-wrap gap-1.5 flex-1">
            {selected.map(id => {
              const opt = options.find(o => o.id === id);
              return opt
                ? <span key={id} className="pill pill-accent text-[11px] px-2 py-0.5">{opt.label}</span>
                : <span key={id} title={`"${id}" was renamed or removed — click to open and remove it`}
                    className="pill text-[11px] px-2 py-0.5 opacity-60 border border-dashed border-[var(--warning)] text-[var(--warning)]">
                    {id} ⚠
                  </span>;
            })}
          </div>
        )}
        <ChevronDown size={14} className={`text-[var(--text-muted)] shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border border-t-0 border-[var(--accent)] rounded-b-lg ring-[3px] ring-[var(--accent-dim)]"
          >
            <div className="p-2 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2">
              <div className="search-wrap flex-1">
                <Search size={13} />
                <input
                  autoFocus type="text" placeholder={placeholder}
                  value={search} onChange={e => setSearch(e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
              </div>
              {filtered.length > 0 && (
                <button type="button" onClick={e => { e.stopPropagation(); toggleAll(); }}
                  className="text-[11px] text-[var(--accent)] hover:underline bg-transparent border-none cursor-pointer whitespace-nowrap shrink-0 px-1">
                  {allFilteredSelected ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
            <div className="max-h-[200px] overflow-y-auto bg-[var(--surface)]">
              {filtered.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-[var(--text-muted)]">No results</div>
              ) : filtered.map(opt => (
                <label key={opt.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[var(--bg)] transition-colors">
                  <input type="checkbox" checked={selected.includes(opt.id)} onChange={() => toggle(opt.id)}
                    className="accent-[var(--accent)] w-3.5 h-3.5 shrink-0" />
                  <span className="text-[13px] text-[var(--text-primary)] flex-1">{opt.label}</span>
                  {opt.sub && <span className="text-[11px] text-[var(--text-muted)]">{opt.sub}</span>}
                </label>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between">
              <span className="text-[11px] text-[var(--text-muted)]">
                {selected.length > 0 ? `${selected.length} of ${options.length} selected` : 'None selected'}
              </span>
              {selected.length > 0 && (
                <button type="button" onClick={() => onChange([])}
                  className="text-[11px] text-[var(--danger)] hover:underline bg-transparent border-none cursor-pointer">
                  Clear all
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Formula input ────────────────────────────────────────────────────────────

interface FormulaVariable { name: string; label?: string; description?: string; }

function validateFormula(formula: string, varNames: string[]): 'valid' | 'invalid' | 'empty' {
  if (!formula.trim()) return 'empty';
  let expr = formula;
  const sorted = [...varNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expr = expr.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '1');
  }
  return /^[\d\s+\-*/().]+$/.test(expr.trim()) ? 'valid' : 'invalid';
}

function FormulaInput({
  value, onChange, variables, colVariables, placeholder = 'e.g. BASIC * 0.3', rows = 3,
}: {
  value: string; onChange: (v: string) => void;
  variables: FormulaVariable[];
  colVariables?: FormulaVariable[];
  placeholder?: string; rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const allVarNames = [...variables, ...(colVariables ?? [])].map(v => v.name);
  const validity = validateFormula(value, allVarNames);

  function insertAtCursor(text: string) {
    const el = ref.current;
    if (!el) { onChange(value + text); return; }
    const start = el.selectionStart ?? value.length;
    const end   = el.selectionEnd   ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div>
      <textarea
        ref={ref} rows={rows} value={value}
        onChange={e => onChange(e.target.value)}
        className={`${inputClass} font-mono tracking-wide resize-none`}
        placeholder={placeholder} spellCheck={false} autoComplete="off"
      />
      {/* Formula validity indicator */}
      {validity !== 'empty' && (
        <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
          validity === 'valid' ? 'text-[var(--success)]' : 'text-[var(--danger)]'
        }`}>
          {validity === 'valid'
            ? <><CheckCircle size={11} /> Valid formula</>
            : <><AlertTriangle size={11} /> Invalid formula — check operators and variable names</>
          }
        </div>
      )}
      {/* Salary component chips */}
      {variables.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {variables.map(v => (
            <button key={v.name} type="button" title={v.description}
              onClick={() => insertAtCursor(v.name)}
              className="pill pill-accent text-[11px] cursor-pointer hover:opacity-80 transition-opacity border-none">
              {v.label ?? v.name}
            </button>
          ))}
        </div>
      )}
      {/* Column chips (N) */}
      {colVariables && colVariables.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <span className="text-[10px] text-[var(--text-muted)] self-center">columns:</span>
          {colVariables.map(v => (
            <button key={v.name} type="button" title={v.description}
              onClick={() => insertAtCursor(v.name)}
              className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--success)] bg-[var(--success-dim,rgba(16,185,129,0.08))] text-[var(--success)] cursor-pointer hover:opacity-80 transition-opacity">
              {v.label ?? v.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {['+', '-', '*', '/', '(', ')'].map(op => (
          <button key={op} type="button"
            onClick={() => insertAtCursor(op === '(' || op === ')' ? op : ` ${op} `)}
            className="text-[12px] font-mono w-7 h-7 flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors cursor-pointer">
            {op}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Payroll Grid ─────────────────────────────────────────────────────────────

function PayslipSlideOver({
  empId, empName, empIndex, gridData, hiddenColIds, netExcludedIds,
  runName, runPeriod, colLabelMap, settings, onClose,
}: {
  empId: string; empName: string; empIndex: number;
  gridData: GridCell[]; hiddenColIds: Set<string>; netExcludedIds: Set<string>;
  runName: string; runPeriod: string; colLabelMap: Map<string, string>;
  settings: any | null; onClose: () => void;
}) {
  // The company logo/name come from the report template if set, otherwise fall back to the
  // global App Setup (Settings → System → App Setup), so an uploaded company logo shows by default.
  const [appSetup, setAppSetup] = useState<{ company_name?: string; company_logo?: string } | null>(null);
  useEffect(() => {
    api.get('/settings/app-setup').then(r => setAppSetup(r.data?.data ?? r.data)).catch(() => {});
  }, []);

  const cells = gridData.filter(c => c.employee === empId);
  const visible = cells.filter(c => !hiddenColIds.has(String(c.payroll_item)))
    .sort((a, b) => (a.colorder ?? 99999) - (b.colorder ?? 99999));
  const earnings   = visible.filter(c => c.payment_deduction !== 'Deduction');
  const deductions = visible.filter(c => c.payment_deduction === 'Deduction');
  const grossPay   = earnings.reduce((s, c) => s + (parseFloat(c.amount ?? '0') || 0), 0);
  const totalDed   = deductions.reduce((s, c) => s + (parseFloat(c.amount ?? '0') || 0), 0);
  const netPay     = cells
    .filter(c => !netExcludedIds.has(String(c.payroll_item)))
    .reduce((s, c) => s + (c.payment_deduction === 'Deduction' ? -1 : 1) * (parseFloat(c.amount ?? '0') || 0), 0);

  const accent  = settings?.accent_color || '#3B82F6';
  const company = settings?.company_name || appSetup?.company_name || '';
  const address = settings?.company_address || '';
  const rawLogo = settings?.company_logo_url || appSetup?.company_logo || '';
  const logo    = rawLogo
    ? (/^(https?:|data:|blob:)/.test(rawLogo) ? rawLogo : `${api.defaults.baseURL}/documents/${rawLogo}`)
    : '';
  const headerNote = settings?.header_note || '';
  const footerNote = settings?.footer_note || '';

  const netBg = `${accent}18`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex justify-end"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="w-full max-w-[460px] h-full bg-[var(--bg)] shadow-2xl flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* ── Accent header bar ── */}
          <div className="px-5 py-4 flex items-start justify-between gap-3" style={{ background: accent }}>
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {logo && (
                <img
                  src={logo}
                  alt="logo"
                  className="h-10 w-10 rounded object-contain shrink-0"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white text-[15px] leading-tight truncate">{company || 'Payslip'}</p>
                {address && <p className="text-white/70 text-[10px] mt-0.5 leading-snug line-clamp-2">{address}</p>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-white/90 font-bold text-[11px] uppercase tracking-widest">PAYSLIP</p>
              <p className="text-white/65 text-[10px] mt-0.5">{runPeriod}</p>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors ml-1 mt-0.5 shrink-0">
              <X size={16} />
            </button>
          </div>

          {/* ── Employee info ── */}
          <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center gap-3">
              <Initials name={empName} index={empIndex} />
              <div>
                <p className="font-bold text-[14px] text-[var(--text-primary)] leading-tight">{empName}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{runName}</p>
              </div>
            </div>
          </div>

          {/* ── Header note ── */}
          {headerNote && (
            <div className="px-5 py-2 bg-[var(--surface)] border-b border-[var(--border)]">
              <p className="text-[11px] text-[var(--text-muted)] italic">{headerNote}</p>
            </div>
          )}

          {/* ── Earnings & Deductions ── */}
          <div className="flex-1 overflow-y-auto bg-[var(--bg)]">

            {/* Earnings */}
            <div className="px-5 pt-4 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: accent }}>Earnings</p>
              <div className="rounded-[10px] border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                {earnings.length === 0
                  ? <p className="py-4 text-center text-[12px] text-[var(--text-muted)]">No earnings</p>
                  : earnings.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] last:border-0">
                      <span className="text-[12px] text-[var(--text-secondary)]">{colLabelMap.get(c.payroll_item) ?? c.column_name}</span>
                      <span className="text-[12px] font-semibold text-[var(--text-primary)] tabular-nums">
                        {fmt(parseFloat(c.amount ?? '0') || 0)}
                      </span>
                    </div>
                  ))
                }
                <div className="flex items-center justify-between px-4 py-2.5 border-t-2" style={{ borderColor: accent, background: `${accent}10` }}>
                  <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: accent }}>Gross Pay</span>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: accent }}>{fmt(grossPay)}</span>
                </div>
              </div>
            </div>

            {/* Deductions */}
            {deductions.length > 0 && (
              <div className="px-5 pt-2 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-2 text-[var(--danger)]">Deductions</p>
                <div className="rounded-[10px] border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                  {deductions.map(c => (
                    <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] last:border-0">
                      <span className="text-[12px] text-[var(--text-secondary)]">{colLabelMap.get(c.payroll_item) ?? c.column_name}</span>
                      <span className="text-[12px] font-semibold text-[var(--danger)] tabular-nums">
                        ({fmt(parseFloat(c.amount ?? '0') || 0)})
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-2.5 border-t-2 border-[var(--danger)] bg-[var(--danger-dim,rgba(239,68,68,0.07))]">
                    <span className="text-[11px] font-bold text-[var(--danger)] uppercase tracking-wide">Total Deductions</span>
                    <span className="text-[13px] font-bold text-[var(--danger)] tabular-nums">({fmt(totalDed)})</span>
                  </div>
                </div>
              </div>
            )}

            {/* Footer note */}
            {footerNote && (
              <div className="px-5 py-3">
                <p className="text-[11px] text-[var(--text-muted)] italic">{footerNote}</p>
              </div>
            )}
          </div>

          {/* ── Net Pay footer ── */}
          <div className="px-5 py-4 border-t border-[var(--border)]" style={{ background: netBg }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold uppercase tracking-widest" style={{ color: accent }}>Net Pay</span>
              <span className="syne text-[26px] font-extrabold tabular-nums" style={{ color: accent }}>{fmt(netPay)}</span>
            </div>
          </div>

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function PayrollGrid({
  gridData, activeRun, editMode, generating, finalizing, retryingGL, submitting, approving, rejecting,
  staleColumnCount, hiddenColIds, netExcludedIds, approvalSettings, currentUserId, currentUserRoles, runStages,
  auditLog, auditLoading, payslipEnabled, colLabelMap, payslipSettings,
  onBack, onGenerate, onFinalize, onRetryGL, onExport, onToggleEdit, onCellUpdate, onReorderCols,
  onSubmit, onApprove, onReject, onLoadAudit,
}: {
  gridData: GridCell[];
  activeRun: PayrollRun;
  editMode: boolean;
  generating: boolean;
  finalizing: boolean;
  retryingGL: boolean;
  submitting: boolean;
  approving: boolean;
  rejecting: boolean;
  staleColumnCount: number;
  hiddenColIds: Set<string>;
  netExcludedIds: Set<string>;
  approvalSettings: { payrollApproval: boolean; selfApproval: boolean };
  currentUserId: string | null;
  currentUserRoles: string[];
  runStages: RunStage[];
  auditLog: AuditEntry[];
  auditLoading: boolean;
  payslipEnabled: boolean;
  colLabelMap: Map<string, string>;
  payslipSettings: any | null;
  onBack: () => void;
  onGenerate: () => void;
  onFinalize: () => void;
  onRetryGL: () => void;
  onExport: () => void;
  onToggleEdit: () => void;
  onCellUpdate: (itemId: string, amount: string) => void;
  onReorderCols: (updates: Array<{ id: string; colorder: number }>) => void;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onLoadAudit: () => void;
}) {
  const { can } = useCan();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pinShadow, setPinShadow] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [dragSrc,   setDragSrc]  = useState<string | null>(null);
  const [dragOver,  setDragOver] = useState<string | null>(null);
  const [payslipId, setPayslipId] = useState<string | null>(null);

  const isLocked          = activeRun.status === 'Completed' || activeRun.status === 'GL Failed';
  const isPendingApproval = activeRun.status === 'Pending Approval';
  const isApproved        = activeRun.status === 'Approved';
  const isRejected        = activeRun.status === 'Rejected';
  const canEdit           = !isLocked && !isPendingApproval && !isApproved;

  // ── Multi-stage approval flow ──
  const hasFlow      = runStages.length > 0;
  const currentStage = runStages.find(s => s.status === 'Pending') ?? null;
  const matchesStage = (st: RunStage) => st.approver_type === 'user'
    ? String(currentUserId ?? '') === String(st.approver_id)
    : (currentUserRoles || []).includes(String(st.approver_label));
  const isCurrentApprover = currentStage ? matchesStage(currentStage) : true; // no flow → any approver

  const [showAudit, setShowAudit] = useState(false);

  // Derive unique employees and columns (sorted by colorder)
  const empIds = useMemo(() => [...new Set(gridData.map(c => c.employee))], [gridData]);

  const empNames = useMemo(
    () => Object.fromEntries(gridData.map(c => [c.employee, c.emp_name])),
    [gridData],
  );

  type ColEntry = [string, { name: string; pd: string | null; order: number | null }];

  const cols = useMemo(() => {
    const map = new Map<string, { name: string; pd: string | null; order: number | null }>();
    gridData.forEach(c => {
      if (!map.has(c.payroll_item)) {
        map.set(c.payroll_item, { name: c.column_name, pd: c.payment_deduction, order: c.colorder });
      }
    });
    return ([...map.entries()] as ColEntry[])
      .sort((a, b) => (a[1].order ?? 99999) - (b[1].order ?? 99999) || Number(a[0]) - Number(b[0]));
  }, [gridData]);

  // Local column sequence state — allows drag-reorder without refetching
  const [colSeq, setColSeq] = useState<ColEntry[]>(cols);
  useEffect(() => { setColSeq(cols); }, [cols]);

  const earningCols   = colSeq.filter(([pid, c]) => c.pd !== 'Deduction' && !hiddenColIds.has(String(pid)));
  const deductionCols = colSeq.filter(([pid, c]) => c.pd === 'Deduction'  && !hiddenColIds.has(String(pid)));
  // pid from gridData is INT (number at runtime); hiddenColIds keys are strings — coerce for correct Set lookup.
  const displayCols   = colSeq.filter(([pid])     => !hiddenColIds.has(String(pid)));

  function handleDragStart(pid: string) {
    setDragSrc(pid);
  }
  function handleDragOver(pid: string) {
    if (pid !== dragSrc) setDragOver(pid);
  }
  function handleDrop(targetPid: string) {
    if (!dragSrc || dragSrc === targetPid) { setDragSrc(null); setDragOver(null); return; }
    setColSeq(prev => {
      const next = [...prev];
      const srcIdx = next.findIndex(([p]) => p === dragSrc);
      const tgtIdx = next.findIndex(([p]) => p === targetPid);
      if (srcIdx < 0 || tgtIdx < 0) return prev;
      const [removed] = next.splice(srcIdx, 1);
      next.splice(tgtIdx, 0, removed);
      const updates = next.map(([pid], i) => ({ id: pid, colorder: i + 1 }));
      onReorderCols(updates);
      return next.map(([pid, meta], i) => [pid, { ...meta, order: i + 1 }] as ColEntry);
    });
    setDragSrc(null);
    setDragOver(null);
  }
  function handleDragEnd() { setDragSrc(null); setDragOver(null); }

  const cellOf = useCallback(
    (eid: string, pid: string) => gridData.find(c => c.employee === eid && c.payroll_item === pid),
    [gridData],
  );

  const netPay = useCallback((eid: string) =>
    gridData
      .filter(c => c.employee === eid && !netExcludedIds.has(String(c.payroll_item)))
      .reduce((s, c) => s + (c.payment_deduction === 'Deduction' ? -1 : 1) * (parseFloat(c.amount ?? '0') || 0), 0),
    [gridData, netExcludedIds],
  );

  const colTotal = useCallback((pid: string) =>
    gridData.filter(c => c.payroll_item === pid).reduce((s, c) => s + (parseFloat(c.amount ?? '0') || 0), 0),
    [gridData],
  );

  const totalNet   = useMemo(() => empIds.reduce((s, eid) => s + netPay(eid), 0), [empIds, netPay]);
  const totalGross = useMemo(() =>
    gridData.filter(c => c.payment_deduction !== 'Deduction' && !netExcludedIds.has(String(c.payroll_item))).reduce((s, c) => s + (parseFloat(c.amount ?? '0') || 0), 0),
    [gridData, netExcludedIds],
  );
  const totalDed = useMemo(() =>
    gridData.filter(c => c.payment_deduction === 'Deduction' && !netExcludedIds.has(String(c.payroll_item))).reduce((s, c) => s + (parseFloat(c.amount ?? '0') || 0), 0),
    [gridData, netExcludedIds],
  );

  // Scroll shadow + progress
  function onScroll() {
    const el = wrapRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setPinShadow(el.scrollLeft > 4);
    setScrollPct(maxScroll > 0 ? Math.round((el.scrollLeft / maxScroll) * 100) : 100);
  }

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [gridData]);

  // Status pill
  const statusCls: Record<string, string> = {
    Draft:              'pill',
    Processing:         'pill pill-accent',
    'Pending Approval': 'pill',
    Rejected:           'pill',
    Approved:           'pill',
    Completed:          'pill pill-success',
  };
  const statusStyle: Record<string, Record<string, string>> = {
    'Pending Approval': { background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning)' },
    Rejected:           { background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid var(--danger)' },
    Approved:           { background: 'rgba(16,185,129,0.10)', color: '#059669', border: '1px solid #10b981' },
  };

  // Sticky cell base style
  const stickyCell = (extraClass = '') =>
    `sticky left-0 z-10 bg-[var(--surface)] transition-shadow duration-150 ${
      pinShadow ? 'shadow-[3px_0_8px_-2px_rgba(0,0,0,0.12)]' : ''
    } ${extraClass}`;

  const stickyHead = (extraClass = '') =>
    `sticky left-0 z-20 bg-[var(--surface)] transition-shadow duration-150 ${
      pinShadow ? 'shadow-[3px_0_8px_-2px_rgba(0,0,0,0.12)]' : ''
    } ${extraClass}`;

  return (
    <>
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

      {/* ── Run header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="action-btn text-[var(--accent)]" aria-label="Back to runs">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="syne text-[18px] font-extrabold text-[var(--text-primary)] m-0 flex items-center gap-2.5">
              {activeRun.name}
              <span className={statusCls[activeRun.status] ?? 'pill'} style={statusStyle[activeRun.status] ?? {}}>{activeRun.status}</span>
            </h2>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              {activeRun.freq_name ?? '—'}
              {activeRun.date_start && ` · ${activeRun.date_start.slice(0, 10)} → ${activeRun.date_end?.slice(0, 10) ?? '—'}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Generate / Recalculate — only when the run can still be edited */}
          {canEdit && can('process_payroll') && (
            <button className="secondary-btn" onClick={onGenerate} disabled={generating}>
              <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
              {generating ? 'Generating…' : gridData.length ? 'Recalculate' : 'Generate Payroll'}
            </button>
          )}

          {/* Edit amounts — only when editable and data exists */}
          {canEdit && gridData.length > 0 && can('process_payroll') && (
            <button className={editMode ? 'primary-btn' : 'secondary-btn'} onClick={onToggleEdit}>
              <Edit size={14} /> {editMode ? 'Done Editing' : 'Edit Amounts'}
            </button>
          )}

          {/* Submit for Approval — Processing, approval workflow on, data exists */}
          {activeRun.status === 'Processing' && approvalSettings.payrollApproval && gridData.length > 0 && can('process_payroll') && (
            <button className="secondary-btn" onClick={onSubmit} disabled={submitting}
              style={{ borderColor: 'var(--warning)', color: 'var(--warning)', background: 'var(--warning-dim)' }}>
              <Send size={14} /> {submitting ? 'Submitting…' : 'Submit for Approval'}
            </button>
          )}

          {/* Approve / Reject — only when Pending Approval */}
          {isPendingApproval && can('approve_payroll') && (() => {
            const isSelf = currentUserId != null && activeRun.submitted_by != null
              && String(activeRun.submitted_by) === String(currentUserId);
            const selfOk = approvalSettings.selfApproval || !isSelf;
            const stageOk = !hasFlow || isCurrentApprover; // multi-stage: only the current stage's approver
            const canAct = selfOk && stageOk;

            if (!canAct) {
              const who = hasFlow && currentStage
                ? (currentStage.approver_label || (currentStage.approver_type === 'user' ? 'the assigned approver' : 'the assigned role'))
                : 'a different approver';
              return (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
                  style={{ background: 'var(--warning-dim)', color: 'var(--warning)', border: '1px solid var(--warning)' }}>
                  <Clock size={13} className="shrink-0" />
                  {hasFlow && currentStage ? `Awaiting ${who} — "${currentStage.stage_name}"` : `Awaiting ${who}`}
                </div>
              );
            }
            return (
              <>
                <button className="success-btn" onClick={onApprove} disabled={approving}>
                  <ThumbsUp size={14} /> {approving ? 'Approving…' : 'Approve'}
                </button>
                <button className="secondary-btn" onClick={onReject} disabled={rejecting}
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                  <ThumbsDown size={14} /> {rejecting ? 'Rejecting…' : 'Reject'}
                </button>
              </>
            );
          })()}

          {/* Finalize — either Approved (went through workflow) or Processing (no workflow) */}
          {(isApproved || (activeRun.status === 'Processing' && !approvalSettings.payrollApproval)) && can('approve_payroll') && (
            <button className="success-btn" onClick={onFinalize} disabled={finalizing}>
              <Lock size={14} /> {finalizing ? 'Finalizing…' : 'Finalize & Lock'}
            </button>
          )}

          {gridData.length > 0 && can('export_payroll_reports') && (
            <button className="secondary-btn" onClick={onExport}>
              <FileText size={14} /> Export CSV
            </button>
          )}

          <button className={`action-btn ${showAudit ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} title="Audit log"
            onClick={() => { setShowAudit(s => !s); if (!showAudit) onLoadAudit(); }}>
            <ClipboardList size={15} />
          </button>
        </div>
      </div>

      {/* ── Approval flow progress ── */}
      {runStages.length > 0 && (isPendingApproval || isApproved || isRejected) && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex items-center gap-1.5 mb-2 text-[12px] font-semibold text-[var(--text-muted)]">
            <ShieldCheck size={13} /> Approval flow
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {runStages.map((st, i) => {
              const done = st.status === 'Approved';
              const rejected = st.status === 'Rejected';
              const isCurrent = !done && !rejected && currentStage?.id === st.id;
              const tone = rejected ? { bg: 'rgba(239,68,68,0.1)', bd: '#ef4444', fg: 'var(--danger)' }
                : done ? { bg: 'rgba(34,197,94,0.1)', bd: '#22c55e', fg: 'var(--success)' }
                : isCurrent ? { bg: 'var(--warning-dim)', bd: 'var(--warning)', fg: 'var(--warning)' }
                : { bg: 'transparent', bd: 'var(--border)', fg: 'var(--text-muted)' };
              return (
                <div key={st.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-[var(--text-muted)]">→</span>}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px]"
                    style={{ background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg }}>
                    {done ? <CheckCircle size={13} /> : rejected ? <ThumbsDown size={13} /> : <Clock size={13} />}
                    <div className="leading-tight">
                      <div className="font-semibold">{st.stage_name}</div>
                      <div className="opacity-75">
                        {st.approver_type === 'user' ? '' : 'Role: '}{st.approver_label || (st.approver_type === 'user' ? 'user' : 'role')}
                        {st.status !== 'Pending' && ` · ${st.status}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Summary cards ── */}
      {gridData.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {[
            { label: 'Gross Pay',  value: fmt(totalGross),       color: 'text-[var(--accent)]',   bg: 'bg-[var(--accent-dim)]',   icon: <DollarSign size={15} /> },
            { label: 'Deductions', value: fmt(totalDed),         color: 'text-[var(--danger)]',   bg: 'bg-[var(--danger-dim)]',   icon: <TrendingUp size={15} /> },
            { label: 'Net Pay',    value: fmt(totalNet),         color: 'text-[var(--success)]',  bg: 'bg-[var(--success-dim)]',  icon: <CheckCircle size={15} /> },
            { label: 'Employees',  value: String(empIds.length), color: 'text-[var(--purple)]',   bg: 'bg-[var(--purple-dim)]',   icon: <Users size={15} /> },
          ].map((s, i) => (
            <div key={i} className="stat-card">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${s.bg} ${s.color}`}>{s.icon}</div>
                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide syne">{s.label}</span>
              </div>
              <div className={`syne text-[22px] font-bold tracking-tight ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Stale columns banner ── */}
      {staleColumnCount > 0 && gridData.length > 0 && canEdit && (
        <div className="px-4 py-3 border border-[var(--warning,#f59e0b)] bg-[var(--warning-dim,rgba(245,158,11,0.08))] rounded-[12px] flex items-center justify-between gap-3 text-[13px]">
          <span className="text-[var(--warning,#f59e0b)] font-semibold">
            {staleColumnCount} column{staleColumnCount !== 1 ? 's' : ''} added since last run — recalculate to include them.
          </span>
          <button className="secondary-btn text-[12px] shrink-0" onClick={onGenerate} disabled={generating}>
            <RefreshCw size={12} className={generating ? 'animate-spin' : ''} /> Recalculate
          </button>
        </div>
      )}

      {/* ── Pending approval banner ── */}
      {isPendingApproval && (
        <div className="px-4 py-3 border rounded-[12px] flex items-center gap-3 text-[13px]"
          style={{ borderColor: 'var(--warning)', background: 'var(--warning-dim)' }}>
          <Clock size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Awaiting approval — this run is locked until approved or rejected.</span>
        </div>
      )}

      {/* ── Rejection banner ── */}
      {isRejected && (
        <div className="px-4 py-3 border border-[var(--danger)] bg-[var(--danger-dim,rgba(239,68,68,0.08))] rounded-[12px] flex items-start gap-3 text-[13px]">
          <AlertTriangle size={15} className="text-[var(--danger)] shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-[var(--danger)]">Payroll Rejected</span>
            {activeRun.rejection_reason && (
              <span className="text-[var(--text-muted)] ml-2">— {activeRun.rejection_reason}</span>
            )}
          </div>
          <button className="secondary-btn text-[12px] shrink-0" onClick={onGenerate} disabled={generating}>
            <RefreshCw size={12} className={generating ? 'animate-spin' : ''} /> Re-generate
          </button>
        </div>
      )}

      {/* ── GL document reference banner (shown after finalization) ── */}
      {isLocked && (
        activeRun.document_ref ? (
          <div className="px-4 py-3 border border-[var(--success,#10b981)] bg-[rgba(16,185,129,0.07)] rounded-[12px] flex items-center gap-3 text-[13px]">
            <CheckCircle size={15} className="text-[var(--success,#10b981)] shrink-0" />
            <span className="font-semibold text-[var(--success,#10b981)]">GL Posted</span>
            <span className="text-[var(--text-muted)]">Document Ref:</span>
            <code className="font-mono text-[var(--text-primary)] bg-[var(--surface-hover,rgba(0,0,0,0.04))] px-2 py-0.5 rounded text-[12px]">{activeRun.document_ref}</code>
            {activeRun.finalized_at && (
              <span className="text-[var(--text-muted)] ml-auto text-[11px]">
                {new Date(activeRun.finalized_at).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12: false })}
              </span>
            )}
          </div>
        ) : (() => {
          let glErrMsg = '';
          try {
            const log = JSON.parse(activeRun.payment_log ?? '{}');
            const e = log?.error;
            if (e && typeof e === 'object') glErrMsg = e.responseCode ? `[${e.responseCode}] ${e.message || ''}`.trim() : e.message || JSON.stringify(e);
            else if (typeof e === 'string') glErrMsg = e;
          } catch {}
          return (
            <div className="px-4 py-3 border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] rounded-[12px] text-[13px] space-y-2">
              <div className="flex items-center gap-3">
                <XCircle size={15} className="text-[var(--danger)] shrink-0" />
                <span className="font-semibold text-[var(--danger)]">GL Posting Failed</span>
                {activeRun.finalized_at && (
                  <span className="text-[var(--text-muted)] ml-auto text-[11px]">
                    {new Date(activeRun.finalized_at).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12: false })}
                  </span>
                )}
              </div>
              {glErrMsg && (
                <p className="text-[var(--danger)] text-[12px] font-mono bg-[color-mix(in_srgb,var(--danger)_6%,transparent)] px-3 py-1.5 rounded-lg">
                  {glErrMsg}
                </p>
              )}
              {can('approve_payroll') && (
              <div>
                <button className="secondary-btn text-[12px]" onClick={onRetryGL} disabled={retryingGL}>
                  <RefreshCw size={13} className={retryingGL ? 'animate-spin' : ''} />
                  {retryingGL ? 'Retrying…' : 'Retry GL Posting'}
                </button>
              </div>
              )}
            </div>
          );
        })()
      )}

      {/* ── Empty state ── */}
      {gridData.length === 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] p-12 text-center space-y-3">
          {canEdit && can('process_payroll') ? (
            <>
              <p className="text-[var(--text-muted)] text-[13px]">No payroll data yet. Generate to populate the grid.</p>
              <button className="primary-btn" onClick={onGenerate} disabled={generating}>
                <TrendingUp size={14} /> {generating ? 'Generating…' : 'Generate Payroll'}
              </button>
            </>
          ) : (
            <p className="text-[var(--text-muted)] text-[13px]">
              {isPendingApproval && 'Payroll data is locked pending approval.'}
              {isApproved        && 'Payroll has been approved and is ready to finalize.'}
              {isLocked          && 'This payroll run has been finalized.'}
              {isRejected        && 'This run was rejected. Regenerate to restart.'}
            </p>
          )}
        </div>
      )}

      {/* ── Grid ── */}
      {gridData.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px]">

          {/* Toolbar: legend + scroll hint */}
          <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between gap-4 bg-[var(--bg)] rounded-t-[16px]">
            <div className="flex items-center gap-4 text-[11px] text-[var(--text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)] inline-block" /> Earnings
              </span>
              {deductionCols.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--danger)] inline-block" /> Deductions
                </span>
              )}
              <span className="text-[var(--border)]">|</span>
              <span>{cols.length} columns · {empIds.length} employees</span>
              {payslipEnabled
                ? <span className="text-[var(--border)]">|</span>
                : null}
              {payslipEnabled
                ? <span className="text-[var(--accent)] opacity-70">Click employee name to view payslip</span>
                : <span className="text-[var(--text-muted)] italic">Payslips not generated for this payment type</span>}

            </div>
            {/* Scroll progress bar */}
            <div className="flex items-center gap-2 shrink-0">
              <ChevronsRight size={13} className="text-[var(--text-muted)]" />
              <div className="w-24 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all duration-150"
                  style={{ width: `${scrollPct}%` }}
                />
              </div>
              <span className="text-[11px] text-[var(--text-muted)] w-8 text-right">{scrollPct}%</span>
            </div>
          </div>

          {/* Scrollable table wrapper */}
          <div
            ref={wrapRef}
            className="overflow-x-auto overflow-y-auto"
            style={{ maxHeight: 480 }}
          >
            <table
              className="border-collapse text-[12px]"
              style={{ minWidth: '100%' }}
            >
              <thead>
                {/* ── Single header row — no forced grouping; each column carries its own type colour ── */}
                <tr>
                  <th
                    className={`${stickyHead()} th text-left`}
                    style={{ minWidth: 180, zIndex: 21 }}
                  >
                    Employee
                  </th>

                  {displayCols.map(([pid, c]: ColEntry) => {
                    const isDeduction = c.pd === 'Deduction';
                    const stripe = isDeduction ? 'var(--danger)' : 'var(--accent)';
                    return (
                      <th
                        key={pid}
                        draggable
                        onDragStart={() => handleDragStart(pid)}
                        onDragOver={(e: { preventDefault(): void }) => { e.preventDefault(); handleDragOver(pid); }}
                        onDrop={() => handleDrop(pid)}
                        onDragEnd={handleDragEnd}
                        className={`th text-right py-2 px-3 font-medium whitespace-nowrap select-none cursor-grab active:cursor-grabbing transition-opacity ${
                          isDeduction ? 'text-[var(--danger)]' : 'text-[var(--accent)]'
                        } ${dragSrc === pid ? 'opacity-40' : ''} ${dragOver === pid ? 'border-l-2 border-l-[var(--accent)]' : ''}`}
                        style={{ minWidth: 110, borderBottom: `2px solid ${stripe}` }}
                      >
                        {c.name}
                      </th>
                    );
                  })}

                  <th
                    className="th text-right py-2 px-3 font-bold text-[var(--success)] whitespace-nowrap"
                    style={{ minWidth: 120, borderBottom: '2px solid var(--success)' }}
                  >
                    Net Pay
                  </th>
                </tr>
              </thead>

              <tbody>
                {empIds.map((eid, empIdx) => {
                  const net = netPay(eid);
                  return (
                    <motion.tr
                      key={eid}
                      className="tr"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: empIdx * 0.03 }}
                    >
                      {/* Pinned employee name — click to open payslip (only when payslips are enabled) */}
                      <td
                        className={`${stickyCell()} td ${payslipEnabled ? 'cursor-pointer group' : ''}`}
                        style={{ minWidth: 180 }}
                        onClick={() => payslipEnabled && setPayslipId(eid)}
                      >
                        <div className="flex items-center gap-2.5">
                          <Initials name={empNames[eid] ?? eid} index={empIdx} />
                          <span className={`font-medium text-[var(--text-primary)] whitespace-nowrap transition-colors ${payslipEnabled ? 'group-hover:text-[var(--accent)]' : ''}`}>
                            {empNames[eid] ?? eid}
                          </span>
                        </div>
                      </td>

                      {/* Data cells */}
                      {displayCols.map(([pid, c]) => {
                        const cell = cellOf(eid, pid);
                        const val  = parseFloat(cell?.amount ?? '0') || 0;
                        const isDeduction = c.pd === 'Deduction';
                        const isZero = val === 0;

                        return (
                          <td key={pid} className="td text-right" style={{ minWidth: 110 }}>
                            {editMode && canEdit && cell ? (
                              <input
                                type="text"
                                defaultValue={fmt(val)}
                                onFocus={e => { e.target.value = String(val); }}
                                onBlur={e => {
                                  const n = parseFloat(e.target.value.replace(/,/g, '')) || 0;
                                  e.target.value = fmt(n);
                                  onCellUpdate(cell.id, String(n));
                                }}
                                className="w-full text-right bg-[var(--accent-dim)] border border-[var(--accent)] rounded outline-none focus:ring-1 focus:ring-[var(--accent)] px-1.5 py-0.5 text-[11px] font-mono"
                              />
                            ) : (
                              <span className={`tabular-nums ${
                                isZero
                                  ? 'text-[var(--text-muted)] opacity-50'
                                  : isDeduction
                                    ? 'text-[var(--danger)]'
                                    : 'text-[var(--text-primary)]'
                              }`}>
                                {fmt(val)}
                              </span>
                            )}
                          </td>
                        );
                      })}

                      {/* Net pay */}
                      <td className="td text-right font-bold whitespace-nowrap" style={{ minWidth: 120 }}>
                        <span className={`tabular-nums ${net < 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
                          {fmt(net)}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>

              {/* ── Sticky totals footer ── */}
              <tfoot>
                <tr className="border-t-2 border-[var(--border)]" style={{ position: 'sticky', bottom: 0, zIndex: 10 }}>
                  <td
                    className={`${stickyCell()} td font-bold text-[10px] uppercase tracking-widest text-[var(--text-muted)] whitespace-nowrap`}
                    style={{ background: 'var(--bg)', zIndex: 11 }}
                  >
                    Totals
                  </td>
                  {displayCols.map(([pid, c]) => {
                    const total = colTotal(pid);
                    const isZero = total === 0;
                    return (
                      <td
                        key={pid}
                        className="td text-right font-semibold tabular-nums"
                        style={{ background: 'var(--bg)', minWidth: 110 }}
                      >
                        <span className={
                          isZero
                            ? 'text-[var(--text-muted)] opacity-40'
                            : c.pd === 'Deduction'
                              ? 'text-[var(--danger)]'
                              : 'text-[var(--text-secondary)]'
                        }>
                          {fmt(total)}
                        </span>
                      </td>
                    );
                  })}
                  <td
                    className="td text-right font-bold text-[var(--success)] whitespace-nowrap tabular-nums"
                    style={{ background: 'var(--bg)', minWidth: 120 }}
                  >
                    {fmt(totalNet)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </motion.div>

    {payslipEnabled && payslipId && (
      <PayslipSlideOver
        empId={payslipId}
        empName={empNames[payslipId] ?? payslipId}
        empIndex={empIds.indexOf(payslipId)}
        gridData={gridData}
        hiddenColIds={hiddenColIds}
        netExcludedIds={netExcludedIds}
        colLabelMap={colLabelMap}
        runName={activeRun.name}
        runPeriod={activeRun.date_start
          ? `${activeRun.date_start.slice(0, 10)} → ${(activeRun.date_end ?? '').slice(0, 10)}`
          : activeRun.name}
        settings={payslipSettings}
        onClose={() => setPayslipId(null)}
      />
    )}

    {/* ── Audit log slide-over ── */}
    <AnimatePresence>
      {showAudit && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setShowAudit(false)}>
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="w-full max-w-[380px] h-full bg-[var(--surface)] shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-[var(--accent)]" />
                <h3 className="font-bold text-[15px] text-[var(--text-primary)]">Audit Log</h3>
              </div>
              <button onClick={() => setShowAudit(false)} className="action-btn text-[var(--text-muted)]">
                <span className="text-[18px] leading-none">×</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {auditLoading ? (
                <p className="text-center text-[var(--text-muted)] text-[13px] py-8">Loading…</p>
              ) : auditLog.length === 0 ? (
                <p className="text-center text-[var(--text-muted)] text-[13px] py-8">No audit entries yet.</p>
              ) : auditLog.map((entry, i) => {
                const meta: Record<string, { label: string; color: string }> = {
                  generate: { label: 'Payroll Generated',        color: 'text-[var(--accent)]'   },
                  finalize: { label: 'Finalized & Locked',       color: 'text-[var(--success)]'  },
                  submit:   { label: 'Submitted for Approval',   color: 'text-[var(--warning)]'  },
                  approve:  { label: 'Approved',                 color: 'text-[var(--success)]'  },
                  reject:   { label: 'Rejected',                 color: 'text-[var(--danger)]'   },
                };
                const m = meta[entry.action] ?? { label: entry.action, color: 'text-[var(--text-muted)]' };
                let details: Record<string, string> | null = null;
                try { if (entry.details) details = JSON.parse(entry.details); } catch {}
                return (
                  <div key={entry.id} className="flex gap-3 pb-5">
                    <div className="flex flex-col items-center shrink-0">
                      <div className={`w-2.5 h-2.5 rounded-full mt-0.5 ${m.color.replace('text-', 'bg-')}`} />
                      {i < auditLog.length - 1 && <div className="w-px flex-1 bg-[var(--border-light)] mt-1.5" />}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[13px] font-semibold leading-tight ${m.color}`}>{m.label}</p>
                      {entry.user_name && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">by {entry.user_name}</p>}
                      <p className="text-[11px] text-[var(--text-muted)]">{new Date(entry.created_at).toLocaleString()}</p>
                      {details?.reason && <p className="text-[11px] text-[var(--danger)] mt-0.5 italic">"{details.reason}"</p>}
                      {details?.employees != null && (
                        <p className="text-[11px] text-[var(--text-muted)]">{details.employees} employees × {details.columns} columns</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function Payroll() {
  const { can } = useCan();
  const [activeTab,   setActiveTab]   = useState('Payroll Runs');
  const [viewRow,     setViewRow]     = useState<{ type: string; data: any } | null>(null);  // read-only detail slide-over

  // ── Calculation Groups ──────────────────────────────────────────────────────
  const [cgRows,      setCgRows]      = useState<CalcGroup[]>([]);
  const [cgLoading,   setCgLoading]   = useState(false);
  const [cgModalOpen, setCgModalOpen] = useState(false);
  const [editingCg,   setEditingCg]   = useState<CalcGroup | null>(null);
  const [cgForm,      setCgForm]      = useState(BLANK_CG);
  const [cgSaving,    setCgSaving]    = useState(false);
  const [cgDeleting,  setCgDeleting]  = useState<string | null>(null);
  const [cgSearch,    setCgSearch]    = useState('');

  // ── Saved Calculations ──────────────────────────────────────────────────────
  const [scRows,      setScRows]      = useState<SavedCalc[]>([]);
  const [scLoading,   setScLoading]   = useState(false);
  const [scModalOpen, setScModalOpen] = useState(false);
  const [editingSc,   setEditingSc]   = useState<SavedCalc | null>(null);
  const [scForm,      setScForm]      = useState<{
    name: string; target_type: string; target_id: string;
    calculation_group_id: string; items: ProcessItem[];
  }>({ name: '', target_type: 'component', target_id: '', calculation_group_id: '', items: [] });
  const [scSaving,    setScSaving]    = useState(false);
  const [scDeleting,  setScDeleting]  = useState<string | null>(null);
  const [scSearch,    setScSearch]    = useState('');

  // ── Payroll Columns ─────────────────────────────────────────────────────────
  const [pcRows,      setPcRows]      = useState<PayrollCol[]>([]);
  const [pcLoading,   setPcLoading]   = useState(false);
  const [pcModalOpen, setPcModalOpen] = useState(false);
  const [editingPc,   setEditingPc]   = useState<PayrollCol | null>(null);
  const [pcForm,      setPcForm]      = useState(BLANK_PC);
  const [pcSaving,    setPcSaving]    = useState(false);
  const [pcDeleting,  setPcDeleting]  = useState<string | null>(null);
  const [pcSearch,     setPcSearch]     = useState('');
  const [pcTypeFilter, setPcTypeFilter] = useState<'all' | 'payment' | 'deduction' | 'hidden' | 'excluded'>('all');

  // ── Pay Frequencies ─────────────────────────────────────────────────────────
  const [pfRows,      setPfRows]      = useState<PayFreq[]>([]);
  const [pfSetupOpen, setPfSetupOpen] = useState(false);
  const [editingPf,   setEditingPf]   = useState<PayFreq | null>(null);
  const [pfForm,      setPfForm]      = useState(BLANK_PF);
  const [pfSaving,    setPfSaving]    = useState(false);
  const [pfDeleting,  setPfDeleting]  = useState<string | null>(null);

  // ── Payroll Employees ────────────────────────────────────────────────────────
  const [peRows,         setPeRows]         = useState<PayrollEmp[]>([]);
  const [peLoading,      setPeLoading]      = useState(false);
  const [peModalOpen,    setPeModalOpen]    = useState(false);
  const [editingPe,      setEditingPe]      = useState<PayrollEmp | null>(null);
  const [peForm,         setPeForm]         = useState(BLANK_PE);
  const [peSaving,       setPeSaving]       = useState(false);
  const [peDeleting,     setPeDeleting]     = useState<string | null>(null);
  const [peSelectedEmpIds, setPeSelectedEmpIds] = useState<string[]>([]);
  const [peSearch,       setPeSearch]       = useState('');
  const [peFreqFilter,   setPeFreqFilter]   = useState('');
  const [employeesList,  setEmployeesList]  = useState<RefItem[]>([]);
  const [currencies,     setCurrencies]     = useState<RefItem[]>([]);

  // ── Process sub-modal ───────────────────────────────────────────────────────
  const [processModalOpen,  setProcessModalOpen]  = useState(false);
  const [editingProcessIdx, setEditingProcessIdx] = useState<number | null>(null);
  const [processForm,       setProcessForm]       = useState<ProcessItem>({ ...BLANK_PROCESS });

  // ── Ref data ────────────────────────────────────────────────────────────────
  const [components, setComponents] = useState<RefItem[]>([]);
  const [columns,    setColumns]    = useState<RefItem[]>([]);

  // ── Payroll Runs ────────────────────────────────────────────────────────────
  const [runRows,      setRunRows]      = useState<PayrollRun[]>([]);
  const [runLoading,   setRunLoading]   = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [editingRun,   setEditingRun]   = useState<PayrollRun | null>(null);
  const [runForm,      setRunForm]      = useState(BLANK_RUN);
  const [runSaving,    setRunSaving]    = useState(false);
  const [runDeleting,    setRunDeleting]    = useState<string | null>(null);
  const [runSearch,    setRunSearch]    = useState('');
  const [ptRows,       setPtRows]       = useState<PaymentType[]>([]);

  // ── Grid state ──────────────────────────────────────────────────────────────
  const [activeRunId,       setActiveRunId]       = useState<string | null>(null);
  const [activeRun,         setActiveRun]         = useState<PayrollRun | null>(null);
  const activeRunPaymentType = ptRows.find((pt: PaymentType) => String(pt.id) === String(activeRun?.payment_type_id));
  const payslipEnabled = !activeRun?.payment_type_id || !!activeRunPaymentType?.generate_payslip;
  const [gridData,          setGridData]          = useState<GridCell[]>([]);
  const [staleColumnCount,  setStaleColumnCount]  = useState(0);
  const [editMode,          setEditMode]          = useState(false);
  const [gridLoading,       setGridLoading]       = useState(false);
  const [generating,        setGenerating]        = useState(false);
  const [finalizing,        setFinalizing]        = useState(false);
  const [retryingGL,        setRetryingGL]        = useState(false);

  // ── Approval ────────────────────────────────────────────────────────────────
  const [approvalSettings]                        = useState(() => getSettings().approvals);
  const [submitting,        setSubmitting]        = useState(false);
  const [approving,         setApproving]         = useState(false);
  const [rejecting,         setRejecting]         = useState(false);
  const [rejectOpen,        setRejectOpen]        = useState(false);
  const [rejectReason,      setRejectReason]      = useState('');
  const [currentUserId]                           = useState<string | null>(() => {
    const u = getCurrentUser();
    return u?.id != null ? String(u.id) : null;
  });
  const [currentUserRoles]                        = useState<string[]>(() => (getCurrentUser()?.allRoles ?? []).map(r => r.name));
  // Snapshot of the active run's multi-stage approval progress (empty when no flow / not submitted).
  const [runStages, setRunStages]                 = useState<RunStage[]>([]);
  async function loadRunStages(runId: string) {
    try { const r = await api.get(`/payroll/runs/${runId}/stages`); setRunStages(Array.isArray(r.data?.data) ? r.data.data : []); }
    catch { setRunStages([]); }
  }
  // Load the stage snapshot whenever a run in an approval state is opened.
  useEffect(() => {
    if (activeRun && ['Pending Approval', 'Approved', 'Rejected'].includes(activeRun.status)) loadRunStages(String(activeRun.id));
    else setRunStages([]);
  }, [activeRun?.id, activeRun?.status]);

  // ── Audit log ────────────────────────────────────────────────────────────────
  const [auditLog,     setAuditLog]     = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // ── Bulk pay frequency edit ──────────────────────────────────────────────────
  const [peBulkSelected,  setPeBulkSelected]  = useState<string[]>([]);
  const [peBulkFreqOpen,  setPeBulkFreqOpen]  = useState(false);
  const [peBulkFreq,      setPeBulkFreq]      = useState('');
  const [peBulkSaving,    setPeBulkSaving]    = useState(false);

  // ── Run comparison ───────────────────────────────────────────────────────────
  const [compareOpen,    setCompareOpen]    = useState(false);
  const [compareRunA,    setCompareRunA]    = useState('');
  const [compareRunB,    setCompareRunB]    = useState('');
  const [compareDataA,   setCompareDataA]   = useState<GridCell[]>([]);
  const [compareDataB,   setCompareDataB]   = useState<GridCell[]>([]);
  const [comparing,      setComparing]      = useState(false);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const [runPage,     setRunPage]     = useState(1); const [runPageSize,  setRunPageSize]  = useState(10);
  const [cgPage,      setCgPage]      = useState(1); const [cgPageSize,   setCgPageSize]   = useState(10);
  const [scPage,      setScPage]      = useState(1); const [scPageSize,   setScPageSize]   = useState(10);
  const [pcPage,      setPcPage]      = useState(1); const [pcPageSize,   setPcPageSize]   = useState(10);
  const [pePage,      setPePage]      = useState(1); const [pePageSize,   setPePageSize]   = useState(10);
  const [psPage,      setPsPage]      = useState(1); const [psPageSize,   setPsPageSize]   = useState(10);

  const BLANK_PS = { template_name: '', deduction_group_id: '', payment_type_id: '', company_name: '', company_address: '', company_logo_url: '', header_note: '', footer_note: '', accent_color: '#3B82F6', show_emp_id: true, show_department: true, show_position: true, show_bank_account: false, visible_columns: [] as string[], net_columns: [] as string[] };
  const [psTemplates,  setPsTemplates]  = useState<any[]>([]);
  const [psSelected,   setPsSelected]   = useState<any | null>(null);
  const [psForm,       setPsForm]       = useState<any>(BLANK_PS);
  const [psSaving,        setPsSaving]        = useState(false);
  const [psLoading,       setPsLoading]       = useState(false);
  const [psModalOpen,     setPsModalOpen]     = useState(false);
  const [psDeleting,      setPsDeleting]      = useState<string | null>(null);
  const [psLogoUploading, setPsLogoUploading] = useState(false);
  const psLogoInputRef = useRef<HTMLInputElement>(null);

  async function uploadPsLogo(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    setPsLogoUploading(true);
    try {
      const res = await api.post('/employees/documents/upload', fd, { headers: { 'Content-Type': undefined } });
      const filename = res.data?.data?.filename ?? res.data?.filename;
      if (filename) setPsForm((f: any) => ({ ...f, company_logo_url: filename }));
      else toast.error('Upload succeeded but no file reference returned');
    } catch { toast.error('Logo upload failed'); }
    finally { setPsLogoUploading(false); }
  }

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => { if (activeTab === 'Payroll Runs')      loadRuns();          }, [activeTab]);
  useEffect(() => { if (activeTab === 'Deduction Groups')  loadCgData();        }, [activeTab]);
  useEffect(() => { if (activeTab === 'Calculation Rules') loadScAll();         }, [activeTab]);
  useEffect(() => { if (activeTab === 'Payroll Columns')   loadPcData();        }, [activeTab]);
  useEffect(() => { if (activeTab === 'Payroll Employees') loadPeAll();         }, [activeTab]);
  useEffect(() => { if (activeTab === 'Report Templates')  loadPayslipSettings(); }, [activeTab]);
  useEffect(() => {
    if (runLoading || activeRunId) return;
    const targetId = sessionStorage.getItem('centralApproval.payrollRunId');
    if (!targetId) return;
    const target = runRows.find((run: PayrollRun) => String(run.id) === String(targetId));
    if (!target) return;
    sessionStorage.removeItem('centralApproval.payrollRunId');
    setActiveTab('Payroll Runs');
    openRun(target);
  }, [runRows, runLoading, activeRunId]);
  // Load columns on mount so hiddenColIds is ready for the grid view without needing to visit the Columns tab first.
  useEffect(() => {
    api.get('/payroll/columns').then(r => setPcRows(r.data.data || [])).catch(() => {});
  }, []);

  // Pagination resets when search/filter changes
  useEffect(() => { setRunPage(1); }, [runSearch]);
  useEffect(() => { setCgPage(1);  }, [cgSearch]);
  useEffect(() => { setScPage(1);  }, [scSearch]);
  useEffect(() => { setPcPage(1);  }, [pcSearch, pcTypeFilter]);
  useEffect(() => { setPePage(1);  }, [peSearch, peFreqFilter]);

  async function loadPayslipSettings() {
    setPsLoading(true);
    try {
      const [tplRes, cgRes, ptRes, colRes] = await Promise.all([
        api.get('/payroll/payslip-templates'),
        api.get('/payroll/calc-groups').catch(() => ({ data: { data: [] } })),
        api.get('/salary/payment-types').catch(() => ({ data: { data: [] } })),
        api.get('/payroll/columns').catch(() => ({ data: { data: [] } })),
      ]);
      setPsTemplates(tplRes.data.data ?? []);
      setCgRows(cgRes.data.data || []);
      setPtRows(ptRes.data.data || []);
      setPcRows(colRes.data.data || []);
    } catch { /* silent */ }
    finally { setPsLoading(false); }
  }

  function openPsAdd() {
    setPsForm(BLANK_PS);
    setPsSelected(null);
    setPsModalOpen(true);
  }

  function openPsEdit(t: any) {
    let cols: string[] = [];
    let netCols: string[] = [];
    try { cols = t.visible_columns ? JSON.parse(t.visible_columns) : []; } catch { cols = []; }
    try { netCols = t.net_columns ? JSON.parse(t.net_columns) : []; } catch { netCols = []; }
    setPsForm({
      template_name:     t.template_name ?? '',
      deduction_group_id: t.deduction_group_id ? String(t.deduction_group_id) : '',
      payment_type_id:   t.payment_type_id ? String(t.payment_type_id) : '',
      company_name:     t.company_name     ?? '',
      company_address:  t.company_address  ?? '',
      company_logo_url: t.company_logo_url ?? '',
      header_note:      t.header_note      ?? '',
      footer_note:      t.footer_note      ?? '',
      accent_color:     t.accent_color     ?? '#3B82F6',
      show_emp_id:      !!t.show_emp_id,
      show_department:  !!t.show_department,
      show_position:    !!t.show_position,
      show_bank_account: !!t.show_bank_account,
      visible_columns:  cols,
      net_columns:      netCols,
    });
    setPsSelected(t);
    setPsModalOpen(true);
  }

  // View (read-only): parse the stored column arrays so the slide-over can render the payslip preview.
  function openPsView(t: any) {
    let cols: string[] = [];
    try { cols = t.visible_columns ? JSON.parse(t.visible_columns) : []; } catch { cols = []; }
    setViewRow({ type: 'ps', data: { ...t, visible_columns: cols } });
  }

  async function savePayslipSettings() {
    if (!psForm.template_name?.trim()) return toast.error('Template name is required');
    setPsSaving(true);
    try {
      const payload = {
        ...psForm,
        deduction_group_id: psForm.deduction_group_id || null,
        payment_type_id: psForm.payment_type_id || null,
        visible_columns: psForm.visible_columns,
        net_columns: psForm.net_columns,
      };
      if (psSelected) {
        const res = await api.put(`/payroll/payslip-templates/${psSelected.id}`, payload);
        setPsTemplates((ts: any[]) => ts.map(t => t.id === psSelected.id ? res.data.data : t));
      } else {
        const res = await api.post('/payroll/payslip-templates', payload);
        setPsTemplates((ts: any[]) => [...ts, res.data.data]);
      }
      setPsModalOpen(false);
      toast.success(psSelected ? 'Template updated' : 'Template created');
    } catch (e: any) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setPsSaving(false); }
  }

  async function deletePsTemplate(id: string) {
    setPsDeleting(id);
    try {
      await api.delete(`/payroll/payslip-templates/${id}`);
      setPsTemplates((ts: any[]) => ts.filter(t => t.id !== id));
      toast.success('Template deleted');
    } catch (e: any) { toast.error(e.response?.data?.message || 'Delete failed'); }
    finally { setPsDeleting(null); }
  }

  async function loadCgData() {
    setCgLoading(true);
    try { const res = await api.get('/payroll/calc-groups'); setCgRows(res.data.data || []); }
    catch { toast.error('Failed to load calculation groups'); }
    finally { setCgLoading(false); }
  }

  async function loadScAll() {
    setScLoading(true);
    try {
      const [scRes, compRes, colRes, cgRes] = await Promise.all([
        api.get('/payroll/saved-calculations'),
        api.get('/salary/components'),
        api.get('/payroll/columns').catch(() => ({ data: { data: [] } })),
        api.get('/payroll/calc-groups'),
      ]);
      setScRows(scRes.data.data || []);
      setComponents((compRes.data.data || []).map((c: any) => ({ id: String(c.id), name: c.name })));
      setColumns((colRes.data.data || []).map((c: any) => ({ id: String(c.id), name: c.name })));
      setCgRows(cgRes.data.data || []);
    } catch { toast.error('Failed to load saved calculations'); }
    finally { setScLoading(false); }
  }

  async function loadPeAll() {
    setPeLoading(true);
    try {
      const [peRes, empRes, curRes, pfRes, cgRes, scRes] = await Promise.all([
        api.get('/payroll/employees'),
        api.get('/employees/active'),
        api.get('/system/code-lists/CUR/values').catch(() => ({ data: { data: [] } })),
        api.get('/payroll/pay-frequencies'),
        api.get('/payroll/calc-groups'),
        api.get('/payroll/saved-calculations'),
      ]);
      setPeRows(peRes.data.data || []);
      setEmployeesList((empRes.data.data || []).map((e: any) => ({ id: String(e.id), name: e.name })));
      setCurrencies((curRes.data.data || []).map((c: any) => ({ id: c.code ?? c.label, name: c.code ? `${c.code} — ${c.label}` : c.label })));
      setPfRows(pfRes.data.data || []);
      setCgRows(cgRes.data.data || []);
      setScRows(scRes.data.data || []);
    } catch { toast.error('Failed to load payroll employees'); }
    finally { setPeLoading(false); }
  }

  async function loadRuns() {
    setRunLoading(true);
    try {
      const [runsRes, pfRes, cgRes, ptRes, tplRes] = await Promise.all([
        api.get('/payroll/runs'),
        api.get('/payroll/pay-frequencies').catch(() => ({ data: { data: [] } })),
        api.get('/payroll/calc-groups').catch(() => ({ data: { data: [] } })),
        api.get('/salary/payment-types').catch(() => ({ data: { data: [] } })),
        api.get('/payroll/payslip-templates').catch(() => ({ data: { data: [] } })),
      ]);
      setRunRows(runsRes.data.data || []);
      setPfRows(pfRes.data.data || []);
      setCgRows(cgRes.data.data || []);
      setPtRows(ptRes.data.data || []);
      setPsTemplates(tplRes.data.data || []);
    } catch { toast.error('Failed to load payroll runs'); }
    finally { setRunLoading(false); }
  }

  async function openRun(run: PayrollRun) {
    setActiveRunId(run.id);
    setActiveRun(run);
    setGridData([]);
    setGridLoading(true);
    setEditMode(false);
    try {
      const res = await api.get(`/payroll/runs/${run.id}/data`);
      const rd  = res.data.data;
      setGridData(Array.isArray(rd) ? rd : (rd?.cells || []));
      setStaleColumnCount(rd?.staleColumnCount ?? 0);
    } catch { toast.error('Failed to load payroll data'); }
    finally { setGridLoading(false); }
  }

  async function saveRun() {
    if (!runForm.name.trim())   return toast.error('Run name is required');
    if (!runForm.pay_frequency) return toast.error('Pay frequency is required');
    const nameLower = runForm.name.trim().toLowerCase();
    const duplicate = runRows.find((r: PayrollRun) => r.name.toLowerCase() === nameLower && r.id !== editingRun?.id);
    if (duplicate) return toast.error(`A run named "${duplicate.name}" already exists`);
    setRunSaving(true);
    try {
      if (editingRun) {
        const res = await api.put(`/payroll/runs/${editingRun.id}`, runForm);
        setRunRows(r => r.map(x => x.id === editingRun.id ? res.data.data : x));
        if (activeRun?.id === editingRun.id) setActiveRun(res.data.data);
        toast.success('Payroll run updated');
      } else {
        const res = await api.post('/payroll/runs', runForm);
        setRunRows(r => [res.data.data, ...r]);
        toast.success('Payroll run created');
      }
      setRunModalOpen(false);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setRunSaving(false); }
  }

  async function deleteRun(id: string) {
    setRunDeleting(id);
    try {
      await api.delete(`/payroll/runs/${id}`);
      setRunRows(r => r.filter(x => x.id !== id));
      toast.success('Payroll run deleted');
    } catch (e: any) { toast.error(e.response?.data?.message || 'Delete failed'); }
    finally { setRunDeleting(null); }
  }

  function openRunDuplicate(run: PayrollRun) {
    // Coerce numeric ids to strings so the Combobox fields pre-select (value must equal option.id).
    setRunForm({
      name: `${run.name} (Copy)`,
      pay_frequency: run.pay_frequency != null ? String(run.pay_frequency) : '',
      date_start:    run.date_start?.slice(0, 10) ?? '',
      date_end:      run.date_end?.slice(0, 10)   ?? '',
      deduction_group: run.deduction_group != null ? String(run.deduction_group) : '',
      payment_type: run.payment_type_id != null ? String(run.payment_type_id) : '',
    });
    setEditingRun(null);
    setRunModalOpen(true);
  }

  async function generateRun() {
    if (!activeRunId) return;
    setGenerating(true);
    try {
      const res = await api.post(`/payroll/runs/${activeRunId}/generate`);
      const d   = res.data.data ?? {};
      // No payroll columns / no enrolled employees → backend returns an empty array + an explanatory message
      if (Array.isArray(d) || d.employees === undefined) {
        toast.error(res.data?.message || 'Nothing was generated — set up payroll columns and enrol employees for this pay frequency first.', { duration: 8000 });
      } else if (d.notchRowsFound === 0 && d.salaryRowsFound === 0 && d.employees > 0) {
        toast.error('No salary data — employees have no notch or salary components assigned.', { duration: 8000 });
      } else if (d.missingComponents?.length > 0) {
        toast.warning(`Generated, but no selected employees have salary values for: ${d.missingComponents.join(', ')}`, { duration: 10000 });
      } else if (d.empsWithNoSalary > 0) {
        toast.warning(`${d.empsWithNoSalary} employee(s) have no salary data.`);
      } else {
        toast.success(`Generated: ${d.employees} employee(s) × ${d.columns} columns`);
      }
      if (d.notchWarning) toast.warning(d.notchWarning, { duration: 12000 });
      const [dataRes, runsRes] = await Promise.all([
        api.get(`/payroll/runs/${activeRunId}/data`),
        api.get('/payroll/runs'),
      ]);
      const rd = dataRes.data.data;
      setGridData(Array.isArray(rd) ? rd : (rd?.cells || []));
      setStaleColumnCount(rd?.staleColumnCount ?? 0);
      setRunRows(runsRes.data.data || []);
      const updated = (runsRes.data.data || []).find((r: PayrollRun) => r.id === activeRunId);
      if (updated) setActiveRun(updated);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Generation failed'); }
    finally { setGenerating(false); }
  }

  async function finalizeRun() {
    if (!activeRunId) return;
    setFinalizing(true);
    try {
      const res = await api.post(`/payroll/runs/${activeRunId}/finalize`);
      const updated: PayrollRun | null = res.data?.data ?? null;
      toast.success('Payroll finalized and locked');
      // Inform user whether GL posting succeeded
      if (updated?.document_ref) {
        toast.success(`GL posted — Ref: ${updated.document_ref}`, { duration: 6000 });
      } else {
        let glErr = '';
        try { const log = JSON.parse(updated?.payment_log ?? '{}'); glErr = log?.error?.message || log?.message || JSON.stringify(log); } catch {}
        toast.error(`GL posting failed${glErr ? ': ' + glErr : ' — check server logs'}`, { duration: 8000 });
      }
      setRunRows(r => r.map(x => x.id === activeRunId ? (updated ? { ...x, ...updated } : { ...x, status: 'Completed' as const }) : x));
      setActiveRun(r => r ? (updated ? { ...r, ...updated } : { ...r, status: 'Completed' as const }) : r);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Finalize failed'); }
    finally { setFinalizing(false); }
  }

  async function retryGL() {
    if (!activeRunId) return;
    setRetryingGL(true);
    try {
      const res = await api.post(`/payroll/runs/${activeRunId}/retry-gl`);
      const updated: PayrollRun | null = res.data?.data ?? null;
      if (updated?.document_ref) {
        toast.success(`GL posted — Ref: ${updated.document_ref}`, { duration: 6000 });
      } else {
        let glErr = '';
        try { const log = JSON.parse(updated?.payment_log ?? '{}'); glErr = log?.error?.message || log?.error?.responseCode ? `[${log.error.responseCode}] ${log.error.message || ''}` : JSON.stringify(log.error ?? log); } catch {}
        toast.error(`GL posting failed${glErr ? ': ' + glErr : ''}`, { duration: 8000 });
      }
      if (updated) {
        setRunRows(r => r.map(x => x.id === activeRunId ? { ...x, ...updated } : x));
        setActiveRun(r => r ? { ...r, ...updated } : r);
      }
    } catch (e: any) { toast.error(e.response?.data?.message || 'Retry failed'); }
    finally { setRetryingGL(false); }
  }

  async function submitRun() {
    if (!activeRunId) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/payroll/runs/${activeRunId}/submit`);
      toast.success('Submitted for approval');
      setRunRows(r => r.map(x => x.id === activeRunId ? res.data.data : x));
      setActiveRun(res.data.data);
      await loadRunStages(activeRunId);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Submit failed'); }
    finally { setSubmitting(false); }
  }

  async function approveRun() {
    if (!activeRunId) return;
    setApproving(true);
    try {
      const res = await api.post(`/payroll/runs/${activeRunId}/approve`);
      toast.success(res.data?.message || 'Payroll approved'); // "…awaiting next stage" or "Payroll approved"
      setRunRows(r => r.map(x => x.id === activeRunId ? res.data.data : x));
      setActiveRun(res.data.data);
      await loadRunStages(activeRunId);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Approve failed'); }
    finally { setApproving(false); }
  }

  async function rejectRun() {
    if (!activeRunId) return;
    setRejecting(true);
    try {
      const res = await api.post(`/payroll/runs/${activeRunId}/reject`, { reason: rejectReason });
      toast.success('Payroll rejected');
      setRunRows(r => r.map(x => x.id === activeRunId ? res.data.data : x));
      setActiveRun(res.data.data);
      await loadRunStages(activeRunId);
      setRejectOpen(false); setRejectReason('');
    } catch (e: any) { toast.error(e.response?.data?.message || 'Reject failed'); }
    finally { setRejecting(false); }
  }

  async function loadAuditLog() {
    if (!activeRunId) return;
    setAuditLoading(true);
    try {
      const res = await api.get(`/payroll/runs/${activeRunId}/audit`);
      setAuditLog(res.data.data || []);
    } catch { toast.error('Failed to load audit log'); }
    finally { setAuditLoading(false); }
  }

  async function bulkChangePeFreq() {
    if (!peBulkFreq || !peBulkSelected.length) return;
    setPeBulkSaving(true);
    let success = 0;
    for (const peId of peBulkSelected) {
      const pe = peRows.find((p: PayrollEmp) => p.id === peId);
      if (!pe) continue;
      try {
        const res = await api.put(`/payroll/employees/${peId}`, {
          employee: pe.employee, pay_frequency: peBulkFreq,
          currency: pe.currency ?? '', deduction_group: pe.deduction_group ?? '',
          deduction_exemptions: pe.deduction_exemptions ?? '',
        });
        setPeRows(r => r.map(x => x.id === peId ? res.data.data : x));
        success++;
      } catch {}
    }
    toast.success(`Updated ${success} of ${peBulkSelected.length} employee(s)`);
    setPeBulkFreqOpen(false); setPeBulkSelected([]); setPeBulkFreq('');
    setPeBulkSaving(false);
  }

  async function loadComparison() {
    if (!compareRunA || !compareRunB) return toast.error('Select two runs to compare');
    setComparing(true);
    try {
      const [resA, resB] = await Promise.all([
        api.get(`/payroll/runs/${compareRunA}/data`),
        api.get(`/payroll/runs/${compareRunB}/data`),
      ]);
      const toArr = (rd: any) => Array.isArray(rd) ? rd : (rd?.cells || []);
      setCompareDataA(toArr(resA.data.data));
      setCompareDataB(toArr(resB.data.data));
    } catch { toast.error('Failed to load comparison data'); }
    finally { setComparing(false); }
  }

  async function updateCell(itemId: string, amount: string) {
    if (!activeRunId) return;
    try { await api.put(`/payroll/runs/${activeRunId}/data/${itemId}`, { amount }); }
    catch { toast.error('Failed to save cell'); }
  }

  function exportRunCsv() {
    if (!gridData.length || !activeRun) return;
    const empIds = [...new Set(gridData.map(c => c.employee))];
    // Only export visible columns, in colorder — mirrors what the report shows
    const colNames = [...new Map(
      gridData
        .filter(c => !hiddenColIds.has(String(c.payroll_item)))
        .sort((a, b) => (a.colorder ?? 99999) - (b.colorder ?? 99999))
        .map(c => [c.payroll_item, c.column_name] as [string, string])
    ).entries()];
    const header = ['Employee', ...colNames.map(([, n]) => n), 'Net Pay'].join(',');
    const rows = empIds.map(eid => {
      const cells = gridData.filter(c => c.employee === eid);
      const name  = cells[0]?.emp_name ?? eid;
      const vals  = colNames.map(([pid]) => cells.find(c => c.payroll_item === pid)?.amount ?? '0');
      // Use the same netExcludedIds exclusion as the on-screen Net Pay column
      const net   = cells
        .filter(c => !netExcludedIds.has(String(c.payroll_item)))
        .reduce((s, c) => s + (parseFloat(c.amount ?? '0') || 0) * (c.payment_deduction === 'Deduction' ? -1 : 1), 0);
      return [name, ...vals, net.toFixed(2)].join(',');
    });
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${activeRun.name.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Payroll Employees CRUD ─────────────────────────────────────────────────
  function openPeAdd() { setPeForm(BLANK_PE); setPeSelectedEmpIds([]); setEditingPe(null); setPeModalOpen(true); }
  function openPeEdit(pe: PayrollEmp) {
    setPeForm({
      employee:             String(pe.employee),
      pay_frequency:        pe.pay_frequency  ? String(pe.pay_frequency)  : '',
      currency:             pe.currency       ? String(pe.currency)       : '',
      deduction_group:      pe.deduction_group ? String(pe.deduction_group) : '',
      deduction_exemptions: pe.deduction_exemptions ?? '',
    });
    setEditingPe(pe);
    setPeModalOpen(true);
  }

  async function savePe() {
    if (!peForm.pay_frequency) return toast.error('Pay frequency is required');
    // Currency is no longer chosen per employee — new records use the system
    // default from Settings → Controls → General; edits keep their stored value.
    const payload = { ...peForm, currency: peForm.currency || getSettings().general.currency };
    setPeSaving(true);
    try {
      if (editingPe) {
        const res = await api.put(`/payroll/employees/${editingPe.id}`, payload);
        setPeRows(r => r.map(x => x.id === editingPe.id ? res.data.data : x));
        toast.success('Payroll employee updated');
        setPeModalOpen(false);
      } else {
        if (!peSelectedEmpIds.length) { setPeSaving(false); return toast.error('Select at least one employee'); }
        let added = 0, skipped = 0;
        const newRows: PayrollEmp[] = [];
        for (const empId of peSelectedEmpIds) {
          try {
            const res = await api.post('/payroll/employees', { ...payload, employee: empId });
            newRows.push(res.data.data);
            added++;
          } catch (e: any) { if (e.response?.status === 409) skipped++; }
        }
        if (newRows.length) setPeRows(r => [...r, ...newRows]);
        toast.success(skipped > 0
          ? `Added ${added} employee(s). ${skipped} already enrolled (skipped).`
          : `Added ${added} employee(s) to payroll.`
        );
        setPeModalOpen(false);
      }
    } catch (e: any) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setPeSaving(false); }
  }

  async function deletePe(id: string) {
    setPeDeleting(id);
    try { await api.delete(`/payroll/employees/${id}`); setPeRows(r => r.filter(x => x.id !== id)); toast.success('Removed'); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Delete failed'); }
    finally { setPeDeleting(null); }
  }

  // ── Pay Frequency CRUD ─────────────────────────────────────────────────────
  function openPfAdd()            { setPfForm(BLANK_PF); setEditingPf(null); }
  function openPfEdit(pf: PayFreq){ setPfForm({ name: pf.name, description: pf.description ?? '', sort_order: String(pf.sort_order) }); setEditingPf(pf); }

  async function savePf() {
    if (!pfForm.name.trim()) return toast.error('Name is required');
    setPfSaving(true);
    try {
      if (editingPf) {
        const res = await api.put(`/payroll/pay-frequencies/${editingPf.id}`, pfForm);
        setPfRows(r => r.map(x => x.id === editingPf.id ? res.data.data : x));
        toast.success('Updated');
      } else {
        const res = await api.post('/payroll/pay-frequencies', pfForm);
        setPfRows(r => [...r, res.data.data]);
        toast.success('Created');
      }
      setPfForm(BLANK_PF); setEditingPf(null);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setPfSaving(false); }
  }

  async function deletePf(id: string) {
    setPfDeleting(id);
    try { await api.delete(`/payroll/pay-frequencies/${id}`); setPfRows(r => r.filter(x => x.id !== id)); toast.success('Deleted'); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Delete failed'); }
    finally { setPfDeleting(null); }
  }

  // ── Payroll Columns CRUD ───────────────────────────────────────────────────
  async function loadPcData() {
    setPcLoading(true);
    try {
      const [res, cgRes, scRes, compRes] = await Promise.all([
        api.get('/payroll/columns'),
        api.get('/payroll/calc-groups').catch(() => ({ data: { data: [] } })),
        api.get('/payroll/saved-calculations').catch(() => ({ data: { data: [] } })),
        api.get('/salary/components').catch(() => ({ data: { data: [] } })),
      ]);
      setPcRows(res.data.data || []);
      setCgRows(cgRes.data.data || []);
      setScRows(scRes.data.data || []);
      setComponents((compRes.data.data || []).map((c: any) => ({ id: String(c.id), name: c.name })));
    } catch { toast.error('Failed to load payroll columns'); }
    finally { setPcLoading(false); }
  }

  function openPcAdd() { setPcForm(BLANK_PC); setEditingPc(null); setPcModalOpen(true); }
  function openPcDuplicate(pc: PayrollCol) {
    setPcForm({
      name: `${pc.name} (Copy)`,
      function_type: pc.function_type, enabled: pc.enabled, editable: pc.editable,
      colorder: '',
      default_value: pc.default_value ?? '', payment_deduction: pc.payment_deduction ?? '',
      salarycomponent_gl: pc.salarycomponent_gl ?? '', posting_column: pc.posting_column ?? 'Yes',
      posting_branch: pc.posting_branch ?? '',
      deduction_groups: (pc.deduction_groups ?? []).map(String),
      component_ids: (pc.component_ids ?? []).map(String),
      add_column_ids: (pc.add_column_ids ?? []).map(String), sub_column_ids: (pc.sub_column_ids ?? []).map(String),
      calculation_function: pc.calculation_function ?? '',
      calculation_rule: pc.calculation_rule ? String(pc.calculation_rule) : '',
      visible: pc.visible ? '1' : '0',
      include_in_net: pc.include_in_net ? '1' : '0',
      payslip_label: pc.payslip_label ?? '',
    });
    setEditingPc(null);
    setPcModalOpen(true);
  }
  function openPcEdit(pc: PayrollCol) {
    setPcForm({
      name: pc.name, function_type: pc.function_type, enabled: pc.enabled, editable: pc.editable,
      colorder: pc.colorder != null ? String(pc.colorder) : '',
      default_value: pc.default_value ?? '', payment_deduction: pc.payment_deduction ?? '',
      salarycomponent_gl: pc.salarycomponent_gl ?? '', posting_column: pc.posting_column ?? 'Yes',
      posting_branch: pc.posting_branch ?? '',
      deduction_groups: (pc.deduction_groups ?? []).map(String),
      component_ids: (pc.component_ids ?? []).map(String),
      add_column_ids: (pc.add_column_ids ?? []).map(String), sub_column_ids: (pc.sub_column_ids ?? []).map(String),
      calculation_function: pc.calculation_function ?? '',
      calculation_rule: pc.calculation_rule ? String(pc.calculation_rule) : '',
      visible: pc.visible ? '1' : '0',
      include_in_net: pc.include_in_net ? '1' : '0',
      payslip_label: pc.payslip_label ?? '',
    });
    setEditingPc(pc);
    setPcModalOpen(true);
  }

  async function savePc() {
    if (!pcForm.name.trim())       return toast.error('Name is required');
    if (!pcForm.payment_deduction) return toast.error('Payment / Deduction is required');
    if (pcForm.posting_column === 'Yes' && !pcForm.salarycomponent_gl.trim()) return toast.error('GL Account is required when Posting Column is Yes');
    const pcNameLower = pcForm.name.trim().toLowerCase();
    const pcDup = pcRows.find((r: PayrollCol) => r.name.toLowerCase() === pcNameLower && r.id !== editingPc?.id);
    if (pcDup) return toast.error(`A column named "${pcDup.name}" already exists`);
    setPcSaving(true);
    try {
      let saved: PayrollCol;
      if (editingPc) {
        const res = await api.put(`/payroll/columns/${editingPc.id}`, pcForm);
        saved = res.data.data;
        setPcRows(r => r.map(x => x.id === editingPc.id ? saved : x));
        toast.success('Updated');
      } else {
        const res = await api.post('/payroll/columns', pcForm);
        saved = res.data.data;
        setPcRows(r => [...r, saved]);
        toast.success('Created');
      }
      setPcModalOpen(false);
      // Warn if any referenced (add/subtract) column runs after this one (would evaluate to 0)
      const refIds = [...pcForm.add_column_ids, ...pcForm.sub_column_ids].map(String).filter(Boolean);
      if (refIds.length && saved.colorder != null) {
        const lateRefs = refIds
          .map(rid => pcRows.find((c: PayrollCol) => String(c.id) === rid && c.id !== saved.id))
          .filter((ref): ref is PayrollCol => !!ref && ref.colorder != null && ref.colorder > saved.colorder!)
          .map(ref => ref.name);
        if (lateRefs.length) {
          toast.warning(
            `Column order warning: ${lateRefs.join(', ')} run${lateRefs.length === 1 ? 's' : ''} after "${saved.name}" and may evaluate to 0. Reorder to fix.`,
            { duration: 8000 }
          );
        }
      }
    } catch (e: any) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setPcSaving(false); }
  }

  async function deletePc(id: string) {
    setPcDeleting(id);
    try { await api.delete(`/payroll/columns/${id}`); setPcRows(r => r.filter(x => x.id !== id)); toast.success('Deleted'); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Delete failed'); }
    finally { setPcDeleting(null); }
  }

  // ── Calculation Group CRUD ─────────────────────────────────────────────────
  function openCgAdd() { setCgForm(BLANK_CG); setEditingCg(null); setCgModalOpen(true); }
  function openCgEdit(cg: CalcGroup) { setCgForm({ name: cg.name, details: cg.details || '' }); setEditingCg(cg); setCgModalOpen(true); }

  async function saveCg() {
    if (!cgForm.name.trim()) return toast.error('Name is required');
    setCgSaving(true);
    try {
      if (editingCg) {
        const res = await api.put(`/payroll/calc-groups/${editingCg.id}`, cgForm);
        setCgRows(r => r.map(x => x.id === editingCg.id ? res.data.data : x));
        toast.success('Updated');
      } else {
        const res = await api.post('/payroll/calc-groups', cgForm);
        setCgRows(r => [...r, res.data.data]);
        toast.success('Created');
      }
      setCgModalOpen(false);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setCgSaving(false); }
  }

  async function deleteCg(id: string) {
    setCgDeleting(id);
    try { await api.delete(`/payroll/calc-groups/${id}`); setCgRows(r => r.filter(x => x.id !== id)); toast.success('Deleted'); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Delete failed'); }
    finally { setCgDeleting(null); }
  }

  // ── Saved Calculation CRUD ─────────────────────────────────────────────────
  function openScAdd() {
    setScForm({ name: '', target_type: 'component', target_id: '', calculation_group_id: '', items: [] });
    setEditingSc(null);
    setScModalOpen(true);
  }

  async function openScDuplicate(sc: SavedCalc) {
    try {
      const res  = await api.get(`/payroll/saved-calculations/${sc.id}`);
      const full = res.data.data;
      setScForm({
        name:                 `${full.name} (Copy)`,
        target_type:          full.target_type,
        target_id:            full.target_id ? String(full.target_id) : '',
        calculation_group_id: full.calculation_group_id ? String(full.calculation_group_id) : '',
        items: (full.items || []).map((item: any) => ({
          lower_limit_condition: item.lower_limit_condition,
          lower_limit:           limit2dp(item.lower_limit),
          upper_limit_condition: item.upper_limit_condition,
          upper_limit:           limit2dp(item.upper_limit),
          value:                 item.value ?? '',
        })),
      });
      setEditingSc(null);
      setScModalOpen(true);
    } catch { toast.error('Failed to load saved calculation'); }
  }

  async function openScEdit(sc: SavedCalc) {
    try {
      const res  = await api.get(`/payroll/saved-calculations/${sc.id}`);
      const full = res.data.data;
      setScForm({
        name:                 full.name,
        target_type:          full.target_type,
        target_id:            full.target_id ? String(full.target_id) : '',
        calculation_group_id: full.calculation_group_id ? String(full.calculation_group_id) : '',
        items: (full.items || []).map((item: any) => ({
          lower_limit_condition: item.lower_limit_condition,
          lower_limit:           limit2dp(item.lower_limit),
          upper_limit_condition: item.upper_limit_condition,
          upper_limit:           limit2dp(item.upper_limit),
          value:                 item.value ?? '',
        })),
      });
      setEditingSc(sc);
      setScModalOpen(true);
    } catch { toast.error('Failed to load saved calculation'); }
  }

  // View (read-only): fetch the full rule so the formula items are available in the slide-over.
  async function openScView(sc: SavedCalc) {
    try {
      const res = await api.get(`/payroll/saved-calculations/${sc.id}`);
      setViewRow({ type: 'sc', data: { ...sc, items: res.data.data?.items ?? [] } });
    } catch { toast.error('Failed to load calculation rule'); }
  }

  async function saveSc() {
    if (!scForm.name.trim()) return toast.error('Name is required');
    const scNameLower = scForm.name.trim().toLowerCase();
    const scDup = scRows.find((r: SavedCalc) => r.name.toLowerCase() === scNameLower && r.id !== editingSc?.id);
    if (scDup) return toast.error(`A calculation rule named "${scDup.name}" already exists`);
    setScSaving(true);
    const targetList = scForm.target_type === 'component' ? components : columns;
    const target     = targetList.find(c => c.id === scForm.target_id);
    const payload = {
      name: scForm.name, target_type: scForm.target_type,
      target_id: scForm.target_id, target_name: target?.name || '',
      calculation_group_id: scForm.calculation_group_id || null,
      items: scForm.items.map(item => ({
        lower_limit_condition: item.lower_limit_condition,
        lower_limit:           item.lower_limit  || null,
        upper_limit_condition: item.upper_limit_condition,
        upper_limit:           item.upper_limit  || null,
        value:                 item.value,
      })),
    };
    try {
      if (editingSc) {
        const res      = await api.put(`/payroll/saved-calculations/${editingSc.id}`, payload);
        const saved    = res.data.data;
        const groupName = cgRows.find(cg => cg.id === String(saved.calculation_group_id))?.name ?? null;
        setScRows(r => r.map(x => x.id === editingSc.id ? { ...saved, group_name: groupName } : x));
        toast.success('Updated');
      } else {
        const res      = await api.post('/payroll/saved-calculations', payload);
        const saved    = res.data.data;
        const groupName = cgRows.find(cg => cg.id === String(saved.calculation_group_id))?.name ?? null;
        setScRows(r => [...r, { ...saved, group_name: groupName }]);
        toast.success('Created');
      }
      setScModalOpen(false);
    } catch (e: any) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setScSaving(false); }
  }

  async function deleteSc(id: string) {
    setScDeleting(id);
    try { await api.delete(`/payroll/saved-calculations/${id}`); setScRows(r => r.filter(x => x.id !== id)); toast.success('Deleted'); }
    catch (e: any) { toast.error(e.response?.data?.message || 'Delete failed'); }
    finally { setScDeleting(null); }
  }

  // ── Process item handlers ──────────────────────────────────────────────────
  function openProcessAdd()             { setProcessForm({ ...BLANK_PROCESS }); setEditingProcessIdx(null); setProcessModalOpen(true); }
  function openProcessEdit(idx: number) { setProcessForm({ ...scForm.items[idx] }); setEditingProcessIdx(idx); setProcessModalOpen(true); }

  function saveProcess() {
    if (!processForm.value.trim()) return toast.error('Value is required');
    const normalized = { ...processForm, lower_limit: limit2dp(processForm.lower_limit), upper_limit: limit2dp(processForm.upper_limit) };
    if (editingProcessIdx !== null) {
      setScForm(f => ({ ...f, items: f.items.map((it, i) => i === editingProcessIdx ? normalized : it) }));
    } else {
      setScForm(f => ({ ...f, items: [...f.items, normalized] }));
    }
    setProcessModalOpen(false);
  }

  function removeProcessItem(idx: number) {
    setScForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  // ── Filtered lists ─────────────────────────────────────────────────────────
  const filteredCg = useMemo(() => cgRows.filter(r =>
    r.name.toLowerCase().includes(cgSearch.toLowerCase()) ||
    (r.details ?? '').toLowerCase().includes(cgSearch.toLowerCase())), [cgRows, cgSearch]);

  const filteredSc = useMemo(() => scRows.filter(r =>
    r.name.toLowerCase().includes(scSearch.toLowerCase()) ||
    (r.target_name ?? '').toLowerCase().includes(scSearch.toLowerCase())), [scRows, scSearch]);

  const filteredPc = useMemo(() => pcRows.filter(r => {
    if (!r.name.toLowerCase().includes(pcSearch.toLowerCase())) return false;
    if (pcTypeFilter === 'payment')   return r.payment_deduction === 'Payment';
    if (pcTypeFilter === 'deduction') return r.payment_deduction === 'Deduction';
    if (pcTypeFilter === 'hidden')    return !r.visible;
    if (pcTypeFilter === 'excluded')  return !r.include_in_net;
    return true;
  }), [pcRows, pcSearch, pcTypeFilter]);

  const parseTemplateIds = useCallback((value: any): string[] => {
    if (Array.isArray(value)) return value.map(String);
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }, []);

  const activeReportTemplate = useMemo(() => {
    if (!activeRun || !psTemplates.length) return null;
    const runType = activeRun.payment_type_id ? String(activeRun.payment_type_id) : '';
    const runGroup = activeRun.deduction_group ? String(activeRun.deduction_group) : '';
    return psTemplates.find(t => runType && runGroup && String(t.payment_type_id ?? '') === runType && String(t.deduction_group_id ?? '') === runGroup)
      ?? psTemplates.find(t => runType && String(t.payment_type_id ?? '') === runType && !t.deduction_group_id)
      ?? psTemplates.find(t => runGroup && !t.payment_type_id && String(t.deduction_group_id ?? '') === runGroup)
      ?? psTemplates.find(t => !t.payment_type_id && !t.deduction_group_id)
      ?? null;
  }, [activeRun, psTemplates]);

  const hiddenColIds = useMemo(
    () => {
      const selected = parseTemplateIds(activeReportTemplate?.visible_columns);
      return new Set(
        activeReportTemplate
          ? (selected.length ? pcRows.filter(c => !selected.includes(String(c.id))).map(c => String(c.id)) : [])
          : pcRows.filter(c => !c.visible).map(c => String(c.id))
      );
    },
    [activeReportTemplate, parseTemplateIds, pcRows],
  );

  const netExcludedIds = useMemo(
    () => {
      const selected = parseTemplateIds(activeReportTemplate?.net_columns);
      return new Set(
        selected.length
          ? pcRows.filter(c => !selected.includes(String(c.id))).map(c => String(c.id))
          : pcRows.filter(c => !c.include_in_net).map(c => String(c.id))
      );
    },
    [activeReportTemplate, parseTemplateIds, pcRows],
  );

  const filteredPe = useMemo(() => peRows.filter(r => {
    const matchSearch = (r.emp_name ?? '').toLowerCase().includes(peSearch.toLowerCase()) ||
      (r.freq_name ?? '').toLowerCase().includes(peSearch.toLowerCase());
    const matchFreq = !peFreqFilter || r.pay_frequency === peFreqFilter;
    return matchSearch && matchFreq;
  }), [peRows, peSearch, peFreqFilter]);

  // ── Paged slices ────────────────────────────────────────────────────────────
  const pagedCg: CalcGroup[]   = filteredCg.slice((cgPage - 1) * cgPageSize, cgPage * cgPageSize);
  const pagedSc: SavedCalc[]   = filteredSc.slice((scPage - 1) * scPageSize, scPage * scPageSize);
  const pagedPc: PayrollCol[]  = filteredPc.slice((pcPage - 1) * pcPageSize, pcPage * pcPageSize);
  const pagedPe: PayrollEmp[]  = filteredPe.slice((pePage - 1) * pePageSize, pePage * pePageSize);
  const pagedPs: any[]         = psTemplates.slice((psPage - 1) * psPageSize, psPage * psPageSize);

  // ── Tab renders ─────────────────────────────────────────────────────────────

  const renderCgTab = () => (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden">
        <TableToolbar searchQuery={cgSearch} onSearchChange={setCgSearch} searchPlaceholder="Search groups..."
          actions={can('manage_calculation_groups') ? <button className="primary-btn" onClick={openCgAdd}><Plus size={15} /> Add Group</button> : undefined} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th text-left">Name</th>
                <th className="th text-left">Details</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody>
              {cgLoading ? (
                <tr><td colSpan={3} className="td text-center py-10 text-[var(--text-muted)]">Loading...</td></tr>
              ) : filteredCg.length === 0 ? (
                <tr><td colSpan={3} className="td text-center py-10 text-[var(--text-muted)]">No calculation groups found.</td></tr>
              ) : pagedCg.map((cg, i) => (
                <motion.tr key={cg.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}>
                  <td className="td font-medium text-[var(--text-primary)]">{cg.name}</td>
                  <td className="td text-[var(--text-muted)] max-w-[500px] truncate">{cg.details || '—'}</td>
                  <td className="td text-right">
                    <div className="flex justify-end">
                      <RowActions actions={[
                        { label: 'View', icon: Eye, onClick: () => setViewRow({ type: 'cg', data: cg }) },
                        { label: 'Edit', icon: Edit, onClick: () => openCgEdit(cg), hidden: !can('manage_calculation_groups') },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteCg(cg.id), disabled: cgDeleting === cg.id, hidden: !can('manage_calculation_groups') },
                      ]} />
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={cgRows.length} filtered={filteredCg.length}
          page={cgPage} pageSize={cgPageSize}
          onPageChange={setCgPage}
          onPageSizeChange={(s) => { setCgPageSize(s); setCgPage(1); }}
        />
      </div>
    </motion.div>
  );

  const renderPeTab = () => {
    const allFilteredIds = filteredPe.map((pe: PayrollEmp) => pe.id);
    const allSelected    = allFilteredIds.length > 0 && allFilteredIds.every((id: string) => peBulkSelected.includes(id));
    const someSelected   = peBulkSelected.length > 0;

    return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      {/* Bulk action bar */}
      {someSelected && can('manage_payroll_employees') && (
        <div className="mb-2 px-4 py-2.5 bg-[var(--accent-dim)] border border-[var(--accent)] rounded-[12px] flex items-center gap-3 text-[13px]">
          <CheckSquare size={15} className="text-[var(--accent)] shrink-0" />
          <span className="font-medium text-[var(--accent)]">{peBulkSelected.length} employee{peBulkSelected.length !== 1 ? 's' : ''} selected</span>
          <button className="secondary-btn text-[12px]"
            onClick={() => { setPeBulkFreq(''); setPeBulkFreqOpen(true); }}>
            Change Pay Frequency
          </button>
          <button className="action-btn text-[var(--text-muted)] ml-auto" onClick={() => setPeBulkSelected([])}>Clear</button>
        </div>
      )}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden">
        <TableToolbar searchQuery={peSearch} onSearchChange={setPeSearch} searchPlaceholder="Search employees..."
          actions={
            <>
              {can('manage_payroll_employees') && <button className="primary-btn" onClick={openPeAdd}><Plus size={15} /> Add Employee</button>}
              {can('manage_payroll_employees') && <button className="secondary-btn" onClick={() => {
                setPfSetupOpen(true);
                if (!pfRows.length) api.get('/payroll/pay-frequencies').then((r: { data: { data: PayFreq[] } }) => setPfRows(r.data.data || [])).catch(() => {});
              }}>
                <span className="text-[13px]">⚙</span> Pay Frequencies
              </button>}
            </>
          }
          filterBar={
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mr-1">Frequency</span>
              <button
                type="button"
                onClick={() => setPeFreqFilter('')}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  !peFreqFilter
                    ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                    : 'bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                }`}
              >
                All
              </button>
              {pfRows.map((pf: PayFreq) => (
                <button
                  key={pf.id}
                  type="button"
                  onClick={() => setPeFreqFilter(peFreqFilter === String(pf.id) ? '' : String(pf.id))}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    peFreqFilter === String(pf.id)
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  {pf.name}
                </button>
              ))}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th text-center" style={{ width: 40 }}>
                  <input type="checkbox" checked={allSelected}
                    onChange={() => {
                      if (allSelected) setPeBulkSelected((s: string[]) => s.filter((id: string) => !allFilteredIds.includes(id)));
                      else setPeBulkSelected((s: string[]) => [...new Set([...s, ...allFilteredIds])]);
                    }}
                    className="accent-[var(--accent)] w-3.5 h-3.5" />
                </th>
                <th className="th text-left">Employee</th>
                <th className="th text-left">Pay Frequency</th>
                <th className="th text-left">Currency</th>
                <th className="th text-left">Calc Group</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody>
              {peLoading ? (
                <tr><td colSpan={6} className="td text-center py-10 text-[var(--text-muted)]">Loading...</td></tr>
              ) : filteredPe.length === 0 ? (
                <tr><td colSpan={6} className="td text-center py-10 text-[var(--text-muted)]">No payroll employees found.</td></tr>
              ) : pagedPe.map((pe, i) => {
                const curLabel  = currencies.find((c: RefItem) => c.id === pe.currency)?.name ?? pe.currency ?? '—';
                const isChecked = peBulkSelected.includes(pe.id);
                return (
                  <motion.tr key={pe.id} className={`tr ${isChecked ? 'bg-[var(--accent-dim)]' : ''}`}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                    <td className="td text-center">
                      <input type="checkbox" checked={isChecked}
                        onChange={() => setPeBulkSelected((s: string[]) => isChecked ? s.filter((id: string) => id !== pe.id) : [...s, pe.id])}
                        className="accent-[var(--accent)] w-3.5 h-3.5" />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <Initials name={pe.emp_name || `Employee ${pe.employee}`} index={i} />
                        <span className="font-medium text-[var(--text-primary)]">{pe.emp_name || `Employee #${pe.employee}`}</span>
                      </div>
                    </td>
                    <td className="td"><span className="pill pill-accent">{pe.freq_name || '—'}</span></td>
                    <td className="td text-[var(--text-muted)]">{curLabel}</td>
                    <td className="td text-[var(--text-muted)]">{pe.group_name || <span className="opacity-50">None</span>}</td>
                    <td className="td text-right">
                      <div className="flex justify-end">
                        <RowActions actions={[
                          { label: 'View', icon: Eye, onClick: () => setViewRow({ type: 'pe', data: { ...pe, _currency: curLabel } }) },
                          { label: 'Edit', icon: Edit, onClick: () => openPeEdit(pe), hidden: !can('manage_payroll_employees') },
                          { label: 'Delete', icon: Trash2, danger: true, onClick: () => deletePe(pe.id), disabled: peDeleting === pe.id, hidden: !can('manage_payroll_employees') },
                        ]} />
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={peRows.length} filtered={filteredPe.length}
          page={pePage} pageSize={pePageSize}
          onPageChange={setPePage}
          onPageSizeChange={(s) => { setPePageSize(s); setPePage(1); }}
        />
      </div>
    </motion.div>
    );
  };

  const renderPcTab = () => (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden">
        <TableToolbar searchQuery={pcSearch} onSearchChange={setPcSearch} searchPlaceholder="Search columns..."
          actions={can('manage_payroll_columns') ? <button className="primary-btn" onClick={openPcAdd}><Plus size={15} /> Add Column</button> : undefined}
          filterBar={
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                { key: 'all',       label: 'All' },
                { key: 'payment',   label: 'Payments' },
                { key: 'deduction', label: 'Deductions' },
                { key: 'hidden',    label: 'Hidden' },
                { key: 'excluded',  label: 'Excluded from Net' },
              ] as const).map(f => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setPcTypeFilter(f.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    pcTypeFilter === f.key
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  {f.label}
                  {f.key !== 'all' && (
                    <span className="ml-1 opacity-70">
                      ({f.key === 'payment'   ? pcRows.filter(c => c.payment_deduction === 'Payment').length
                        : f.key === 'deduction' ? pcRows.filter(c => c.payment_deduction === 'Deduction').length
                        : f.key === 'hidden'    ? pcRows.filter(c => !c.visible).length
                        : pcRows.filter(c => !c.include_in_net).length})
                    </span>
                  )}
                </button>
              ))}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th text-left" style={{ width: '18%' }}>Column Name</th>
                <th className="th text-left" style={{ width: '12%' }}>GL Account</th>
                <th className="th text-left" style={{ width: '22%' }}>Calculation Formula</th>
                <th className="th text-left" style={{ width: '10%' }}>Payment / Deduction</th>
                <th className="th text-center" style={{ width: '5%' }}>Order</th>
                <th className="th text-center" style={{ width: '7%' }}>Posting</th>
                <th className="th text-center" style={{ width: '6%' }}>Status</th>
                <th className="th text-center" style={{ width: '10%' }}>Visibility</th>
                <th className="th text-right" style={{ width: '7%' }}></th>
              </tr>
            </thead>
            <tbody>
              {pcLoading ? (
                <tr><td colSpan={9} className="td text-center py-10 text-[var(--text-muted)]">Loading...</td></tr>
              ) : filteredPc.length === 0 ? (
                <tr><td colSpan={9} className="td text-center py-10 text-[var(--text-muted)]">No payroll columns found.</td></tr>
              ) : pagedPc.map((pc, i) => (
                <motion.tr key={pc.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                  <td className="td font-semibold text-[var(--text-primary)]">
                    {pc.name}
                    {pc.payslip_label && (
                      <span className="ml-2 text-[10px] font-normal text-[var(--text-muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                        → {pc.payslip_label}
                      </span>
                    )}
                  </td>
                  <td className="td text-[12px] font-mono text-[var(--accent)]">
                    {pc.salarycomponent_gl || <span className="text-[var(--text-muted)] opacity-50 font-sans">—</span>}
                  </td>
                  <td className="td max-w-0">
                    {pc.calculation_function ? (
                      <code className="block font-mono text-[11px] text-[var(--accent)] bg-[var(--accent-dim)] px-2 py-0.5 rounded truncate" title={pc.calculation_function}>
                        {pc.calculation_function}
                      </code>
                    ) : <span className="text-[12px] text-[var(--text-muted)] opacity-50">—</span>}
                  </td>
                  <td className="td text-[12px]">
                    {pc.payment_deduction ? (
                      <span className={`pill text-[11px] ${pc.payment_deduction === 'Payment' ? 'pill-success' : ''}`}
                        style={pc.payment_deduction !== 'Payment' ? { background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid var(--danger)' } : {}}>
                        {pc.payment_deduction}
                      </span>
                    ) : <span className="text-[var(--text-muted)] opacity-50">—</span>}
                  </td>
                  <td className="td text-center text-[var(--text-muted)] text-[12px]">{pc.colorder ?? '—'}</td>
                  <td className="td text-center">
                    <span className={`pill text-[11px] ${pc.posting_column === 'Yes' ? 'pill-success' : ''}`}
                      style={pc.posting_column !== 'Yes' ? { background: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)' } : {}}>
                      {pc.posting_column === 'Yes' ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="td text-center">
                    <span className={`pill text-[11px] ${pc.enabled === 'Yes' ? 'pill-success' : ''}`}
                      style={pc.enabled !== 'Yes' ? { background: 'var(--danger-dim)', color: 'var(--danger)', border: '1px solid var(--danger)' } : {}}>
                      {pc.enabled === 'Yes' ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="td text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span title={pc.visible ? 'Visible on report' : 'Hidden from report'}
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                          pc.visible
                            ? 'bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent)]'
                            : 'bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] opacity-60'
                        }`}>
                        <Eye size={9} />{pc.visible ? 'On' : 'Off'}
                      </span>
                      <span title={pc.include_in_net ? 'Included in Net Pay' : 'Excluded from Net Pay'}
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                          pc.include_in_net
                            ? 'bg-[var(--success-dim,rgba(16,185,129,0.08))] text-[var(--success)] border-[var(--success)]'
                            : 'bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] opacity-60'
                        }`}>
                        ∑{pc.include_in_net ? ' Net' : ' Skip'}
                      </span>
                    </div>
                  </td>
                  <td className="td text-right">
                    <div className="flex justify-end">
                      <RowActions actions={[
                        { label: 'View', icon: Eye, onClick: () => setViewRow({ type: 'pc', data: pc }) },
                        { label: 'Duplicate Column', icon: Copy, onClick: () => openPcDuplicate(pc), hidden: !can('manage_payroll_columns') },
                        { label: 'Edit', icon: Edit, onClick: () => openPcEdit(pc), hidden: !can('manage_payroll_columns') },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => deletePc(pc.id), disabled: pcDeleting === pc.id, hidden: !can('manage_payroll_columns') },
                      ]} />
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={pcRows.length} filtered={filteredPc.length}
          page={pcPage} pageSize={pcPageSize}
          onPageChange={setPcPage}
          onPageSizeChange={(s) => { setPcPageSize(s); setPcPage(1); }}
        />
      </div>
    </motion.div>
  );

  const renderScTab = () => (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden">
        <TableToolbar searchQuery={scSearch} onSearchChange={setScSearch} searchPlaceholder="Search calculations..."
          actions={can('manage_calculation_groups') ? <button className="primary-btn" onClick={openScAdd}><Plus size={15} /> Add Calculation</button> : undefined} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="th text-left">Name</th>
                <th className="th text-left">Applies To</th>
                <th className="th text-left">Target</th>
                <th className="th text-left">Group</th>
                <th className="th text-right"></th>
              </tr>
            </thead>
            <tbody>
              {scLoading ? (
                <tr><td colSpan={5} className="td text-center py-10 text-[var(--text-muted)]">Loading...</td></tr>
              ) : filteredSc.length === 0 ? (
                <tr><td colSpan={5} className="td text-center py-10 text-[var(--text-muted)]">No saved calculations found.</td></tr>
              ) : pagedSc.map((sc, i) => (
                <motion.tr key={sc.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}>
                  <td className="td font-medium text-[var(--text-primary)]">{sc.name}</td>
                  <td className="td">
                    <span className={`pill ${sc.target_type === 'component' ? 'pill-accent' : 'pill-success'}`}>
                      {sc.target_type === 'component' ? 'Salary Component' : 'Payroll Column'}
                    </span>
                  </td>
                  <td className="td text-[var(--text-muted)]">{sc.target_name || '—'}</td>
                  <td className="td text-[var(--text-muted)]">{sc.group_name || <span className="opacity-50">None</span>}</td>
                  <td className="td text-right">
                    <div className="flex justify-end">
                      <RowActions actions={[
                        { label: 'View', icon: Eye, onClick: () => openScView(sc) },
                        { label: 'Duplicate Rule', icon: Copy, onClick: () => openScDuplicate(sc), hidden: !can('manage_calculation_groups') },
                        { label: 'Edit', icon: Edit, onClick: () => openScEdit(sc), hidden: !can('manage_calculation_groups') },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteSc(sc.id), disabled: scDeleting === sc.id, hidden: !can('manage_calculation_groups') },
                      ]} />
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          total={scRows.length} filtered={filteredSc.length}
          page={scPage} pageSize={scPageSize}
          onPageChange={setScPage}
          onPageSizeChange={(s) => { setScPageSize(s); setScPage(1); }}
        />
      </div>
    </motion.div>
  );

  const renderPayslipDesignerTab = () => {
    const ps = psForm;
    const accent = ps.accent_color || '#3B82F6';
    const paymentCols   = pcRows.filter((c: PayrollCol) => c.payment_deduction === 'Payment');
    const deductionCols = pcRows.filter((c: PayrollCol) => c.payment_deduction === 'Deduction');
    const toggleCol = (id: string) => setPsForm((f: any) => {
      const cur: string[] = f.visible_columns ?? [];
      return { ...f, visible_columns: cur.includes(id) ? cur.filter((x: string) => x !== id) : [...cur, id] };
    });
    const toggleNetCol = (id: string) => setPsForm((f: any) => {
      const cur: string[] = f.net_columns ?? [];
      return { ...f, net_columns: cur.includes(id) ? cur.filter((x: string) => x !== id) : [...cur, id] };
    });
    const allIds = [...paymentCols, ...deductionCols].map((c: PayrollCol) => String(c.id));

    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <p className="text-[12px] text-[var(--text-muted)]">
          Templates control which columns appear in the report grid and on payslips for each payment type. Create one template per payment type to have different column sets.
        </p>
        {/* ── Template list ── */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden">
          <TableToolbar searchQuery="" onSearchChange={() => {}} searchPlaceholder="Report templates..."
            actions={can('manage_report_templates') ? <button className="primary-btn" onClick={openPsAdd}><Plus size={15} /> New Template</button> : undefined} />
          <div className="overflow-x-auto">
            {psLoading ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-10">Loading...</p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="th text-left">Template Name</th>
                    <th className="th text-left">Payment Type</th>
                    <th className="th text-left">Applies To Group</th>
                    <th className="th text-left">Columns Selected</th>
                    <th className="th text-left">Net Columns</th>
                    <th className="th text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {psTemplates.length === 0 ? (
                    <tr><td colSpan={6} className="td text-center py-10 text-[var(--text-muted)]">No templates yet. Add one to configure payslip layout.</td></tr>
                  ) : pagedPs.map((t: any, i: number) => {
                    let colCount = 0;
                    let netCount = 0;
                    try { colCount = t.visible_columns ? JSON.parse(t.visible_columns).length : 0; } catch { colCount = 0; }
                    try { netCount = t.net_columns ? JSON.parse(t.net_columns).length : 0; } catch { netCount = 0; }
                    return (
                      <motion.tr key={t.id} className="tr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}>
                        <td className="td font-medium text-[var(--text-primary)]">{t.template_name}</td>
                        <td className="td text-[var(--text-muted)]">{t.type_name || <span className="opacity-50">All payment types</span>}</td>
                        <td className="td text-[var(--text-muted)]">{t.group_name || <span className="opacity-50">All groups (default)</span>}</td>
                        <td className="td">
                          {colCount === 0
                            ? <span className="text-[var(--text-muted)] opacity-60 text-xs">All columns</span>
                            : <span className="pill pill-accent text-[11px]">{colCount} column{colCount !== 1 ? 's' : ''}</span>}
                        </td>
                        <td className="td">
                          {netCount === 0
                            ? <span className="text-[var(--text-muted)] opacity-60 text-xs">Column defaults</span>
                            : <span className="pill pill-success text-[11px]">{netCount} net column{netCount !== 1 ? 's' : ''}</span>}
                        </td>
                        <td className="td text-right">
                          <div className="flex justify-end">
                            <RowActions actions={[
                              { label: 'View', icon: Eye, onClick: () => openPsView(t) },
                              { label: 'Edit', icon: Edit, onClick: () => openPsEdit(t), hidden: !can('manage_report_templates') },
                              { label: 'Delete', icon: Trash2, danger: true, onClick: () => deletePsTemplate(t.id), disabled: psDeleting === t.id, hidden: !can('manage_report_templates') },
                            ]} />
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <TablePagination
            total={psTemplates.length} filtered={psTemplates.length}
            page={psPage} pageSize={psPageSize}
            onPageChange={setPsPage}
            onPageSizeChange={(s) => { setPsPageSize(s); setPsPage(1); }}
          />
        </div>

        {/* ── Edit / Add modal ── */}
        <AnimatePresence>
          {psModalOpen && (
            <FormModal
              title={psSelected ? `Edit Template — ${psSelected.template_name}` : 'New Payslip Template'}
              maxWidth="5xl" scrollable
              onClose={() => setPsModalOpen(false)}
              onSave={savePayslipSettings}
              saveLabel={psSaving ? 'Saving…' : 'Save Template'}
            >
              <div className="flex gap-6">
                {/* ── Left: settings cards ── */}
                <div className="flex-1 min-w-0 space-y-4">

                  {/* Identity */}
                  <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <FileText size={13} className="text-[var(--accent)]" /> Identity
                    </p>
                    <FormField label="Template Name" required>
                      <input className={inputClass} value={ps.template_name} onChange={e => setPsForm((f: any) => ({ ...f, template_name: e.target.value }))} placeholder="e.g. Salary, Rent Allowance" />
                    </FormField>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="Payment Type">
                        <Combobox
                          options={[{ id: '', label: 'All payment types' }, ...ptRows.map((pt: any) => ({ id: String(pt.id), label: pt.name }))]}
                          value={ps.payment_type_id} onChange={id => setPsForm((f: any) => ({ ...f, payment_type_id: id }))}
                          placeholder="All payment types" />
                      </FormField>
                      <FormField label="Deduction Group">
                        <Combobox
                          options={[{ id: '', label: 'All groups (default)' }, ...cgRows.map((cg: any) => ({ id: cg.id, label: cg.name }))]}
                          value={ps.deduction_group_id} onChange={id => setPsForm((f: any) => ({ ...f, deduction_group_id: id }))}
                          placeholder="All groups (default)" />
                      </FormField>
                    </div>
                  </div>

                  {/* Branding */}
                  <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <Palette size={13} className="text-[var(--accent)]" /> Branding
                    </p>
                    <FormField label="Company Name">
                      <input className={inputClass} value={ps.company_name} onChange={e => setPsForm((f: any) => ({ ...f, company_name: e.target.value }))} placeholder="e.g. Acme Corp Ltd" />
                    </FormField>
                    <FormField label="Company Address">
                      <CountedTextarea className={inputClass} rows={2} maxChars={500} value={ps.company_address} onChange={e => setPsForm((f: any) => ({ ...f, company_address: e.target.value }))} placeholder="Full address..." />
                    </FormField>
                    <div>
                      <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mb-1.5">Company Logo</p>
                      <div className="flex items-center gap-3">
                        {ps.company_logo_url && (
                          <img
                            src={ps.company_logo_url.startsWith('http') ? ps.company_logo_url : `${api.defaults.baseURL}/documents/${ps.company_logo_url}`}
                            alt="Logo preview"
                            className="h-10 w-10 rounded-lg object-contain border border-[var(--border)] bg-[var(--bg)] shrink-0"
                          />
                        )}
                        <input
                          ref={psLogoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadPsLogo(f); e.target.value = ''; }}
                        />
                        <button
                          type="button"
                          onClick={() => psLogoInputRef.current?.click()}
                          disabled={psLogoUploading}
                          className="secondary-btn text-[12px] disabled:opacity-60"
                        >
                          {psLogoUploading ? 'Uploading…' : ps.company_logo_url ? 'Replace Logo' : 'Upload Logo'}
                        </button>
                        {ps.company_logo_url && (
                          <button
                            type="button"
                            onClick={() => setPsForm((f: any) => ({ ...f, company_logo_url: '' }))}
                            className="text-[12px] text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    <FormField label="Accent Colour">
                      <div className="flex items-center gap-3">
                        <input type="color" value={ps.accent_color} onChange={e => setPsForm((f: any) => ({ ...f, accent_color: e.target.value }))} className="h-9 w-14 rounded cursor-pointer border border-[var(--border)]" />
                        <input className={inputClass} value={ps.accent_color} onChange={e => setPsForm((f: any) => ({ ...f, accent_color: e.target.value }))} placeholder="#3B82F6" />
                      </div>
                    </FormField>
                  </div>

                  {/* Notes */}
                  <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <AlignLeft size={13} className="text-[var(--accent)]" /> Notes
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="Header Note">
                        <CountedTextarea className={inputClass} rows={2} maxChars={500} value={ps.header_note} onChange={e => setPsForm((f: any) => ({ ...f, header_note: e.target.value }))} placeholder="Shown at top of payslip..." />
                      </FormField>
                      <FormField label="Footer Note">
                        <CountedTextarea className={inputClass} rows={2} maxChars={500} value={ps.footer_note} onChange={e => setPsForm((f: any) => ({ ...f, footer_note: e.target.value }))} placeholder="Shown at bottom of payslip..." />
                      </FormField>
                    </div>
                  </div>

                  {/* Employee Fields */}
                  <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <User size={13} className="text-[var(--accent)]" /> Employee Fields
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {([['show_emp_id', 'Employee ID'], ['show_department', 'Department'], ['show_position', 'Position'], ['show_bank_account', 'Bank Account']] as [string, string][]).map(([key, lbl]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPsForm((f: any) => ({ ...f, [key]: !f[key] }))}
                          className={ps[key] ? 'pill pill-accent text-[11px]' : 'text-[11px] text-[var(--text-muted)] border border-[var(--border)] rounded-full px-3 py-1 hover:border-[var(--accent)] transition-colors'}
                        >{lbl}</button>
                      ))}
                    </div>
                  </div>

                  {/* Report Columns */}
                  <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <LayoutGrid size={13} className="text-[var(--accent)]" /> Report Columns
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] -mt-1">Leave all unselected to show all columns.</p>
                    {paymentCols.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-[var(--accent)]">Earnings</p>
                          <button type="button" className="text-[11px] text-[var(--accent)] hover:underline"
                            onClick={() => setPsForm((f: any) => {
                              const ids = paymentCols.map((c: PayrollCol) => String(c.id));
                              const cur: string[] = f.visible_columns ?? [];
                              const allOn = ids.every((id: string) => cur.includes(id));
                              return { ...f, visible_columns: allOn ? cur.filter((id: string) => !ids.includes(id)) : [...new Set([...cur, ...ids])] };
                            })}>
                            {paymentCols.every((c: PayrollCol) => (ps.visible_columns ?? []).includes(String(c.id))) ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {paymentCols.map((c: PayrollCol) => {
                            const sel = (ps.visible_columns ?? []).includes(String(c.id));
                            return (
                              <button key={c.id} type="button" onClick={() => toggleCol(String(c.id))}
                                className={sel ? 'pill pill-accent text-[11px]' : 'text-[11px] text-[var(--text-muted)] border border-[var(--border)] rounded-full px-3 py-1 hover:border-[var(--accent)] transition-colors'}>
                                {c.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {deductionCols.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-[var(--danger)]">Deductions</p>
                          <button type="button" className="text-[11px] text-[var(--accent)] hover:underline"
                            onClick={() => setPsForm((f: any) => {
                              const ids = deductionCols.map((c: PayrollCol) => String(c.id));
                              const cur: string[] = f.visible_columns ?? [];
                              const allOn = ids.every((id: string) => cur.includes(id));
                              return { ...f, visible_columns: allOn ? cur.filter((id: string) => !ids.includes(id)) : [...new Set([...cur, ...ids])] };
                            })}>
                            {deductionCols.every((c: PayrollCol) => (ps.visible_columns ?? []).includes(String(c.id))) ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {deductionCols.map((c: PayrollCol) => {
                            const sel = (ps.visible_columns ?? []).includes(String(c.id));
                            return (
                              <button key={c.id} type="button" onClick={() => toggleCol(String(c.id))}
                                className={sel ? 'pill text-[11px] bg-[var(--danger)] text-white border-transparent' : 'text-[11px] text-[var(--text-muted)] border border-[var(--border)] rounded-full px-3 py-1 hover:border-[var(--danger)] transition-colors'}>
                                {c.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {paymentCols.length === 0 && deductionCols.length === 0 && (
                      <p className="text-[11px] text-[var(--text-muted)] italic">No payroll columns configured yet.</p>
                    )}
                  </div>

                  {/* Net Pay Columns */}
                  <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                    <p className="text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <TrendingUp size={13} className="text-[var(--accent)]" /> Net Pay Columns
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] -mt-1">Leave all unselected to use each column's default net setting.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allIds.map(id => {
                        const c = pcRows.find((col: PayrollCol) => String(col.id) === id);
                        if (!c) return null;
                        const sel = (ps.net_columns ?? []).includes(id);
                        return (
                          <button key={id} type="button" onClick={() => toggleNetCol(id)}
                            className={sel ? 'pill pill-success text-[11px]' : 'text-[11px] text-[var(--text-muted)] border border-[var(--border)] rounded-full px-3 py-1 hover:border-[var(--success,#10b981)] transition-colors'}>
                            {c.name}
                          </button>
                        );
                      })}
                      {allIds.length === 0 && <p className="text-[11px] text-[var(--text-muted)] italic">No columns configured yet.</p>}
                    </div>
                  </div>
                </div>

                {/* ── Right: sticky live preview ── */}
                <div className="w-72 shrink-0">
                  <div className="sticky top-4">
                    <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Live Preview</p>
                    <PayslipTemplatePreview template={ps} paymentCols={paymentCols} deductionCols={deductionCols} />
                  </div>
                </div>
              </div>
            </FormModal>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  const renderRunsTab = () => {
    // ── Grid view ──
    if (activeRunId && activeRun) {
      if (gridLoading) {
        return (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] p-12 text-center text-[var(--text-muted)] text-[13px]">
            Loading payroll data…
          </div>
        );
      }
      return (
        <>
        <PayrollGrid
          gridData={gridData}
          activeRun={activeRun}
          editMode={editMode}
          generating={generating}
          finalizing={finalizing}
          retryingGL={retryingGL}
          submitting={submitting}
          approving={approving}
          rejecting={rejecting}
          staleColumnCount={staleColumnCount}
          hiddenColIds={hiddenColIds}
          netExcludedIds={netExcludedIds}
          approvalSettings={approvalSettings}
          currentUserId={currentUserId}
          currentUserRoles={currentUserRoles}
          runStages={runStages}
          auditLog={auditLog}
          auditLoading={auditLoading}
          payslipEnabled={payslipEnabled}
          colLabelMap={new Map(pcRows.filter((c: PayrollCol) => c.payslip_label).map((c: PayrollCol) => [String(c.id), c.payslip_label!]))}
          payslipSettings={activeReportTemplate}
          onBack={() => { setActiveRunId(null); setActiveRun(null); setGridData([]); setStaleColumnCount(0); setEditMode(false); setAuditLog([]); }}
          onGenerate={generateRun}
          onFinalize={finalizeRun}
          onRetryGL={retryGL}
          onSubmit={submitRun}
          onApprove={approveRun}
          onReject={() => setRejectOpen(true)}
          onLoadAudit={loadAuditLog}
          onExport={exportRunCsv}
          onToggleEdit={() => setEditMode(m => !m)}
          onCellUpdate={updateCell}
          onReorderCols={async (updates) => {
            try { await api.patch('/payroll/columns/reorder', updates); }
            catch { toast.error('Failed to save column order'); }
          }}
        />
        {/* Reject reason modal */}
        <AnimatePresence>
          {rejectOpen && (
            <FormModal title="Reject Payroll Run" maxWidth="md"
              onClose={() => { setRejectOpen(false); setRejectReason(''); }}
              onSave={rejectRun} saveLabel={rejecting ? 'Rejecting…' : 'Reject Run'}>
              <div className="space-y-4">
                <p className="text-[13px] text-[var(--text-muted)]">
                  This will reject the payroll run. The submitter must re-generate and re-submit the run.
                </p>
                <FormField label="Reason (optional)">
                  <CountedTextarea className={inputClass} rows={3} maxChars={500} value={rejectReason}
                    onChange={(e: { target: HTMLTextAreaElement }) => setRejectReason(e.target.value)}
                    placeholder="Enter rejection reason..." />
                </FormField>
              </div>
            </FormModal>
          )}
        </AnimatePresence>
        </>
      );
    }

    // ── List view ──
    const filteredRuns = runRows.filter(r =>
      r.name.toLowerCase().includes(runSearch.toLowerCase()) ||
      (r.freq_name ?? '').toLowerCase().includes(runSearch.toLowerCase())
    );
    const pagedRuns: PayrollRun[] = filteredRuns.slice((runPage - 1) * runPageSize, runPage * runPageSize);

    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden">
          <TableToolbar searchQuery={runSearch} onSearchChange={setRunSearch} searchPlaceholder="Search runs..."
            actions={
              <>
                {can('process_payroll') && <button className="primary-btn" onClick={() => { setRunForm(BLANK_RUN); setEditingRun(null); setRunModalOpen(true); }}>
                  <Plus size={15} /> New Run
                </button>}
                {runRows.length >= 2 && (
                  <button className="secondary-btn" onClick={() => { setCompareRunA(''); setCompareRunB(''); setCompareDataA([]); setCompareDataB([]); setCompareOpen(true); }}>
                    <GitCompare size={14} /> Compare Runs
                  </button>
                )}
              </>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th text-left">Run Name</th>
                  <th className="th text-left">Pay Frequency</th>
                  <th className="th text-left">Calculation Group</th>
                  <th className="th text-left">Period</th>
                  <th className="th text-left">Type</th>
                  <th className="th text-left">Status</th>
                  <th className="th text-right"></th>
                </tr>
              </thead>
              <tbody>
                {runLoading ? (
                  <tr><td colSpan={7} className="td text-center py-10 text-[var(--text-muted)]">Loading…</td></tr>
                ) : filteredRuns.length === 0 ? (
                  <tr><td colSpan={7} className="td text-center py-12 text-[var(--text-muted)]">
                    No payroll runs yet. Click <b>New Run</b> to get started.
                  </td></tr>
                ) : pagedRuns.map((run, i) => {
                  const statusCls: Record<string, string> = { Draft: 'pill', Processing: 'pill pill-accent', Completed: 'pill pill-success', 'Pending Approval': 'pill pill-warning', Approved: 'pill pill-success', Rejected: 'pill pill-danger', 'GL Failed': 'pill pill-danger' };
                  const runStatusCls = statusCls[run.status] ?? 'pill';
                  return (
                    <motion.tr key={run.id} className="tr cursor-pointer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
                      onClick={() => openRun(run)}>
                      <td className="td font-medium text-[var(--text-primary)] hover:text-[var(--accent)]">{run.name}</td>
                      <td className="td text-[var(--text-muted)]">{run.freq_name ?? '—'}</td>
                      <td className="td">
                        {run.group_name
                          ? <span className="pill pill-accent text-[11px]">{run.group_name}</span>
                          : <span className="text-[var(--text-muted)] opacity-50">All groups</span>}
                      </td>
                      <td className="td text-[var(--text-muted)]">
                        {run.date_start ? run.date_start.slice(0, 10) : '—'}
                        {run.date_end   ? ` → ${run.date_end.slice(0, 10)}` : ''}
                      </td>
                      <td className="td">
                        {run.type_name
                          ? <span className="pill text-[11px]">{run.type_name}</span>
                          : <span className="text-[var(--text-muted)] opacity-50">—</span>}
                      </td>
                      <td className="td"><span className={runStatusCls}>{run.status}</span></td>
                      <td className="td text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <RowActions actions={[
                            { label: 'View', icon: Eye, onClick: () => openRun(run) },
                            { label: 'Duplicate Run', icon: Copy, onClick: () => openRunDuplicate(run), hidden: !can('process_payroll') },
                            {
                              label: 'Edit', icon: Edit,
                              hidden: !(can('process_payroll') && run.status !== 'Completed' && run.status !== 'GL Failed'),
                              onClick: () => {
                                // Combobox matches value === option.id (a String), so coerce the run's
                                // numeric ids to strings or the fields render empty.
                                setRunForm({
                                  name: run.name,
                                  pay_frequency: run.pay_frequency != null ? String(run.pay_frequency) : '',
                                  date_start: run.date_start?.slice(0, 10) ?? '',
                                  date_end:   run.date_end?.slice(0, 10) ?? '',
                                  deduction_group: run.deduction_group != null ? String(run.deduction_group) : '',
                                  payment_type: run.payment_type_id != null ? String(run.payment_type_id) : '',
                                });
                                setEditingRun(run);
                                setRunModalOpen(true);
                              },
                            },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteRun(run.id), disabled: runDeleting === run.id, hidden: !(can('process_payroll') && run.status !== 'Completed' && run.status !== 'GL Failed') },
                          ]} />
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            total={runRows.length} filtered={filteredRuns.length}
            page={runPage} pageSize={runPageSize}
            onPageChange={setRunPage}
            onPageSizeChange={(s) => { setRunPageSize(s); setRunPage(1); }}
          />
        </div>

        {/* New / Edit Run modal */}
        <AnimatePresence>
          {runModalOpen && (
            <FormModal
              title={editingRun ? 'Edit Payroll Run' : 'New Payroll Run'}
              maxWidth="md"
              onClose={() => setRunModalOpen(false)}
              onSave={saveRun}
              saveLabel={runSaving ? 'Saving…' : 'Save'}
            >
              <div className="space-y-4">
                <FormField label="Run Name" required>
                  <input className={inputClass} value={runForm.name}
                    onChange={e => setRunForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. March 2026 Payroll" />
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Pay Frequency" required>
                    <Combobox
                      options={pfRows.map(pf => ({ id: String(pf.id), label: pf.name }))}
                      value={runForm.pay_frequency}
                      onChange={id => setRunForm(f => ({ ...f, pay_frequency: id }))}
                      placeholder="Select frequency…"
                    />
                  </FormField>
                  <FormField label="Payment Type">
                    <Combobox
                      options={[{ id: '', label: 'None' }, ...ptRows.map(pt => ({ id: String(pt.id), label: pt.name }))]}
                      value={runForm.payment_type}
                      onChange={id => setRunForm(f => ({ ...f, payment_type: id }))}
                      placeholder="e.g. Salary, Mid-month…"
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Start Date">
                    <input className={inputClass} type="date" value={runForm.date_start}
                      onChange={e => setRunForm(f => ({ ...f, date_start: e.target.value }))} />
                  </FormField>
                  <FormField label="End Date">
                    <input className={inputClass} type="date" value={runForm.date_end}
                      onChange={e => setRunForm(f => ({ ...f, date_end: e.target.value }))} />
                  </FormField>
                </div>
                <FormField label="Deduction Group">
                  <Combobox
                    options={[{ id: '', label: 'None' }, ...cgRows.map(cg => ({ id: cg.id, label: cg.name }))]}
                    value={runForm.deduction_group}
                    onChange={id => setRunForm(f => ({ ...f, deduction_group: id }))}
                    placeholder="Select group…"
                  />
                </FormField>
              </div>
            </FormModal>
          )}
        </AnimatePresence>

        {/* Run comparison modal */}
        <AnimatePresence>
          {compareOpen && (
            <FormModal title="Compare Payroll Runs" maxWidth="3xl" scrollable
              onClose={() => setCompareOpen(false)}
              onSave={loadComparison} saveLabel={comparing ? 'Loading…' : 'Compare'}>
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Run A">
                    <Combobox
                      options={runRows.map((r: PayrollRun) => ({ id: r.id, label: `${r.name} (${r.status})` }))}
                      value={compareRunA}
                      onChange={(id: string) => { setCompareRunA(id); setCompareDataA([]); setCompareDataB([]); }}
                      placeholder="Select first run…"
                    />
                  </FormField>
                  <FormField label="Run B">
                    <Combobox
                      options={runRows.filter((r: PayrollRun) => r.id !== compareRunA).map((r: PayrollRun) => ({ id: r.id, label: `${r.name} (${r.status})` }))}
                      value={compareRunB}
                      onChange={(id: string) => { setCompareRunB(id); setCompareDataA([]); setCompareDataB([]); }}
                      placeholder="Select second run…"
                    />
                  </FormField>
                </div>
                {comparing && <p className="text-center text-[var(--text-muted)] text-[13px] py-4">Loading comparison data…</p>}
                {!comparing && compareRunA && compareRunB && compareDataA.length === 0 && (
                  <p className="text-center text-[var(--text-muted)] text-[13px] py-2">Select both runs and click Compare.</p>
                )}
                {compareDataA.length > 0 && compareDataB.length > 0 && (() => {
                  const runAName = runRows.find((r: PayrollRun) => r.id === compareRunA)?.name ?? 'Run A';
                  const runBName = runRows.find((r: PayrollRun) => r.id === compareRunB)?.name ?? 'Run B';
                  const netOf = (cells: GridCell[], eid: string) =>
                    cells.filter(c => c.employee === eid && !netExcludedIds.has(String(c.payroll_item)))
                      .reduce((s, c) => s + (parseFloat(c.amount ?? '0') || 0) * (c.payment_deduction === 'Deduction' ? -1 : 1), 0);
                  const empIdsA = compareDataA.map((c: GridCell) => c.employee).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
                  const empIdsB = compareDataB.map((c: GridCell) => c.employee).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
                  const allIds  = [...empIdsA, ...empIdsB].filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
                  const nameOf  = (eid: string) =>
                    compareDataA.find((c: GridCell) => c.employee === eid)?.emp_name ??
                    compareDataB.find((c: GridCell) => c.employee === eid)?.emp_name ?? eid;
                  return (
                    <div className="border border-[var(--border)] rounded-xl overflow-x-auto">
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr>
                            <th className="th text-left">Employee</th>
                            <th className="th text-right">{runAName}</th>
                            <th className="th text-right">{runBName}</th>
                            <th className="th text-right">Δ Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allIds.map(eid => {
                            const a      = empIdsA.includes(eid) ? netOf(compareDataA, eid) : null;
                            const b      = empIdsB.includes(eid) ? netOf(compareDataB, eid) : null;
                            const delta  = a !== null && b !== null ? b - a : null;
                            const dCls   = delta == null ? '' : delta > 0 ? 'text-[var(--success)]' : delta < 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]';
                            return (
                              <tr key={eid} className="tr">
                                <td className="td font-medium">{nameOf(eid)}</td>
                                <td className="td text-right tabular-nums">{a !== null ? fmt(a) : <span className="opacity-40">—</span>}</td>
                                <td className="td text-right tabular-nums">{b !== null ? fmt(b) : <span className="opacity-40">—</span>}</td>
                                <td className={`td text-right tabular-nums font-semibold ${dCls}`}>
                                  {delta !== null ? `${delta >= 0 ? '+' : ''}${fmt(delta)}` : <span className="opacity-40">—</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </FormModal>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  // ── Saved Calculation form ─────────────────────────────────────────────────
  function bracketLabel(item: ProcessItem, targetName: string): string {
    const lo = item.lower_limit_condition;
    const hi = item.upper_limit_condition;
    const fmt = (v: string | number) => String(parseFloat(String(v)) || 0);
    const loMap: Record<string, string> = {
      GREATER_THAN:          `> ${fmt(item.lower_limit)}`,
      GREATER_THAN_OR_EQUAL: `≥ ${fmt(item.lower_limit)}`,
    };
    const hiMap: Record<string, string> = {
      LESS_THAN:          `< ${fmt(item.upper_limit)}`,
      LESS_THAN_OR_EQUAL: `≤ ${fmt(item.upper_limit)}`,
    };
    const loPart = loMap[lo] ?? null;
    const hiPart = hiMap[hi] ?? null;
    let range: string;
    if (loPart && hiPart) range = `${loPart} and ${hiPart}`;
    else if (loPart)      range = loPart;
    else if (hiPart)      range = hiPart;
    else                  range = 'any value';
    return `If ${targetName} is ${range}`;
  }

  const renderScForm = () => {
    const targetName =
      (scForm.target_type === 'component' ? components : columns)
        .find(c => c.id === scForm.target_id)?.name ?? 'amount';
    return (
    <div className="space-y-5">
      <FormField label="Name" required>
        <input className={inputClass} value={scForm.name}
          onChange={e => setScForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Enter calculation name..." />
      </FormField>
      <div>
        <label className="label">Applies To</label>
        <div className="flex gap-5 mt-1.5">
          {(['component', 'column'] as const).map(type => (
            <label key={type} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={scForm.target_type === type}
                onChange={() => setScForm(f => ({ ...f, target_type: type, target_id: '' }))}
                className="accent-[var(--accent)]" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                {type === 'component' ? 'Salary Component' : 'Payroll Report Column'}
              </span>
            </label>
          ))}
        </div>
      </div>
      <FormField label={scForm.target_type === 'component' ? 'Salary Component' : 'Payroll Report Column'} required>
        <Combobox
          options={(scForm.target_type === 'component' ? components : columns).map(item => ({ id: item.id, label: item.name }))}
          value={scForm.target_id}
          onChange={id => setScForm(f => ({ ...f, target_id: id }))}
          placeholder={`Search ${scForm.target_type === 'component' ? 'salary component' : 'payroll column'}…`}
        />
      </FormField>
      <FormField label="Calculation Group">
        <Combobox
          options={[{ id: '', label: 'None' }, ...cgRows.map(cg => ({ id: cg.id, label: cg.name }))]}
          value={scForm.calculation_group_id}
          onChange={id => setScForm(f => ({ ...f, calculation_group_id: id }))}
          placeholder="Search or select group…"
        />
      </FormField>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="label mb-0">Calculation Process</label>
          <div className="flex gap-2">
            {scForm.items.length > 0 && (
              <button type="button" className="secondary-btn py-1 px-3 text-[12px]"
                onClick={() => setScForm(f => ({ ...f, items: [] }))}>Reset</button>
            )}
            <button type="button" className="primary-btn py-1 px-3 text-[12px]" onClick={openProcessAdd}>
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
        {scForm.items.length === 0 ? (
          <div className="border border-dashed border-[var(--border)] rounded-xl py-7 text-center text-[12px] text-[var(--text-muted)]">
            No process items yet. Click <strong>Add</strong> to define limit conditions and values.
          </div>
        ) : (() => {
          // Gap detection: sort by effective lower bound, find uncovered ranges between adjacent brackets
          const sorted = [...scForm.items].map((item, origIdx) => ({ item, origIdx })).sort((a, b) => {
            const lo = (x: ProcessItem) => x.lower_limit_condition === 'NO_LOWER_LIMIT' ? -Infinity : (parseFloat(x.lower_limit) || 0);
            return lo(a.item) - lo(b.item);
          });
          const gaps: string[] = [];
          for (let i = 0; i < sorted.length - 1; i++) {
            const curr = sorted[i].item;
            const next = sorted[i + 1].item;
            if (curr.upper_limit_condition === 'NO_UPPER_LIMIT') continue;
            if (next.lower_limit_condition === 'NO_LOWER_LIMIT') continue;
            const uv = parseFloat(curr.upper_limit || '0') || 0;
            const lv = parseFloat(next.lower_limit || '0') || 0;
            const uInc = curr.upper_limit_condition === 'LESS_THAN_OR_EQUAL';
            const lInc = next.lower_limit_condition === 'GREATER_THAN_OR_EQUAL';
            const hasGap = uv < lv || (uv === lv && !uInc && !lInc);
            if (hasGap) gaps.push(`${uInc ? uv : `< ${uv}`} → ${lInc ? lv : `> ${lv}`}`);
          }
          return (
            <>
              <div className="border border-[var(--border)] rounded-xl overflow-hidden divide-y divide-[var(--border-light)]">
                {scForm.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between px-4 py-3 text-[13px]">
                    <span className="text-[var(--text-secondary)]">
                      {bracketLabel(item, targetName)}{' '}
                      <span className="text-[var(--text-muted)]">→ result is</span>{' '}
                      <span className="font-semibold text-[var(--text-primary)]">{item.value}</span>
                    </span>
                    <div className="flex items-center gap-1 shrink-0 ml-4">
                      <button type="button" className="action-btn text-[var(--warning)]" onClick={() => openProcessEdit(idx)}><Edit size={12} /></button>
                      <button type="button" className="action-btn text-[var(--danger)]"  onClick={() => removeProcessItem(idx)}><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
              {gaps.length > 0 && (
                <div className="mt-2 px-3 py-2.5 rounded-lg border border-[var(--warning,#f59e0b)] bg-[var(--warning-dim,rgba(245,158,11,0.08))] text-[12px] text-[var(--warning,#b45309)]">
                  <span className="font-semibold">Gap warning:</span> amounts in {gaps.join(', ')} match no bracket — those employees will get 0.
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 w-full relative">
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {!activeRunId && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
            <PageHeader title="Payroll Processing" subtitle="Manage employees, runs, and calculation rules from one place." />
                      
          </motion.div>
        )}

        <div className="flex flex-wrap gap-1 mb-5">
          {TABS.map(tab => {
            const Icon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`tab-btn flex items-center gap-1.5 ${activeTab === tab ? 'active' : ''}`}
              >
                {Icon && <Icon size={13} />}
                {tab}
              </button>
            );
          })}
        </div>

        {activeTab === 'Payroll Runs'      && renderRunsTab()}
        {activeTab === 'Payroll Employees' && renderPeTab()}
        {activeTab === 'Deduction Groups'  && renderCgTab()}
        {activeTab === 'Payroll Columns'   && renderPcTab()}
        {activeTab === 'Calculation Rules' && renderScTab()}
        {activeTab === 'Report Templates'  && renderPayslipDesignerTab()}

        {/* Read-only detail slide-over (View action) */}
        <DetailSlideOver
          open={!!viewRow}
          onClose={() => setViewRow(null)}
          maxWidth={viewRow?.type === 'ps' ? 'lg' : 'md'}
          title={
            viewRow?.type === 'cg' ? 'Deduction Group'
            : viewRow?.type === 'pe' ? 'Payroll Employee'
            : viewRow?.type === 'pc' ? 'Payroll Column'
            : viewRow?.type === 'sc' ? 'Calculation Rule'
            : viewRow?.type === 'ps' ? 'Report Template'
            : 'Details'
          }
        >
          {viewRow && (() => {
            const d = viewRow.data;
            switch (viewRow.type) {
              case 'cg': return (
                <DetailGrid cols={1}>
                  <DetailField label="Name" value={d.name} />
                  <DetailField label="Details" value={d.details} />
                </DetailGrid>
              );
              case 'pe': return (
                <DetailGrid>
                  <DetailField label="Employee" value={d.emp_name || `#${d.employee}`} full />
                  <DetailField label="Pay Frequency" value={d.freq_name} />
                  <DetailField label="Currency" value={d._currency} />
                  <DetailField label="Deduction Group" value={d.group_name} full />
                </DetailGrid>
              );
              case 'pc': return (
                <DetailGrid>
                  <DetailField label="Name" value={d.name} full />
                  <DetailField label="Payslip Label" value={d.payslip_label} />
                  <DetailField label="GL Account" value={d.salarycomponent_gl} />
                  <DetailField label="Type" value={d.payment_deduction} />
                  <DetailField label="Order" value={d.colorder} />
                  <DetailField label="Formula" value={d.calculation_function} full />
                  <DetailField label="Posting Column" value={d.posting_column === 'Yes' ? 'Yes' : 'No'} />
                  <DetailField label="Status" value={d.enabled === 'Yes' ? 'Active' : 'Disabled'} />
                  <DetailField label="Visible on Report" value={d.visible ? 'Yes' : 'No'} />
                  <DetailField label="Included in Net" value={d.include_in_net ? 'Yes' : 'No'} />
                </DetailGrid>
              );
              case 'sc': return (
                <div className="space-y-4">
                  <DetailGrid>
                    <DetailField label="Name" value={d.name} full />
                    <DetailField label="Target Type" value={d.target_type === 'component' ? 'Salary Component' : 'Payroll Column'} />
                    <DetailField label="Target" value={d.target_name} />
                    <DetailField label="Group" value={d.group_name} full />
                  </DetailGrid>
                  <DetailSection title="Formula">
                    {(d.items ?? []).length === 0 ? (
                      <p className="text-[13px] text-[var(--text-muted)]">No conditions defined.</p>
                    ) : (
                      <div className="space-y-2">
                        {d.items.map((item: ProcessItem, idx: number) => (
                          <div key={idx} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5">
                            <div className="text-[12px] text-[var(--text-secondary)]">{bracketLabel(item, d.target_name || 'amount')}</div>
                            <div className="text-[13px] font-semibold text-[var(--text-primary)] mt-0.5">→ {item.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </DetailSection>
                </div>
              );
              case 'ps': return (
                <div className="space-y-4">
                  <DetailField label="Template Name" value={d.template_name || d.name} full />
                  <PayslipTemplatePreview
                    template={d}
                    paymentCols={pcRows.filter((c: PayrollCol) => c.payment_deduction === 'Payment')}
                    deductionCols={pcRows.filter((c: PayrollCol) => c.payment_deduction === 'Deduction')}
                  />
                </div>
              );
              default: return null;
            }
          })()}
        </DetailSlideOver>

        {/* Deduction Group modal */}
        <AnimatePresence>
          {cgModalOpen && (
            <FormModal title={editingCg ? 'Edit Calculation Group' : 'New Calculation Group'} maxWidth="md"
              onClose={() => setCgModalOpen(false)} onSave={saveCg} saveLabel={cgSaving ? 'Saving…' : 'Save'}>
              <div className="space-y-4">
                <FormField label="Name" required>
                  <input className={inputClass} value={cgForm.name}
                    onChange={e => setCgForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Enter group name..." />
                </FormField>
                <FormField label="Details">
                  <CountedTextarea className={inputClass} rows={4} maxChars={1000} value={cgForm.details ?? ''}
                    onChange={e => setCgForm(f => ({ ...f, details: e.target.value }))}
                    placeholder="Optional description..." />
                </FormField>
              </div>
            </FormModal>
          )}
        </AnimatePresence>

        {/* Saved Calculation modal */}
        <AnimatePresence>
          {scModalOpen && (
            <FormModal title={editingSc ? 'Edit Saved Calculation' : 'New Saved Calculation'} maxWidth="3xl"
              onClose={() => setScModalOpen(false)} onSave={saveSc} saveLabel={scSaving ? 'Saving…' : 'Save'}>
              {renderScForm()}
            </FormModal>
          )}
        </AnimatePresence>

        {/* Process item sub-modal */}
        <AnimatePresence>
          {processModalOpen && (
            <FormModal title={editingProcessIdx !== null ? 'Edit Process Item' : 'Add Process Item'} maxWidth="lg"
              onClose={() => setProcessModalOpen(false)} onSave={saveProcess} saveLabel="+ Done">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Lower Limit Condition" required>
                    <select className={inputClass} value={processForm.lower_limit_condition}
                      onChange={e => setProcessForm(f => ({
                        ...f, lower_limit_condition: e.target.value,
                        lower_limit: e.target.value === 'NO_LOWER_LIMIT' ? '' : f.lower_limit,
                      }))}>
                      {LOWER_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Lower Limit">
                    <input className={inputClass} type="text" inputMode="decimal" value={processForm.lower_limit}
                      onChange={e => setProcessForm(f => ({ ...f, lower_limit: e.target.value }))}
                      onBlur={() => setProcessForm(f => ({ ...f, lower_limit: limit2dp(f.lower_limit) }))}
                      disabled={processForm.lower_limit_condition === 'NO_LOWER_LIMIT'}
                      placeholder={processForm.lower_limit_condition === 'NO_LOWER_LIMIT' ? 'N/A' : '0.00'} />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Upper Limit Condition" required>
                    <select className={inputClass} value={processForm.upper_limit_condition}
                      onChange={e => setProcessForm(f => ({
                        ...f, upper_limit_condition: e.target.value,
                        upper_limit: e.target.value === 'NO_UPPER_LIMIT' ? '' : f.upper_limit,
                      }))}>
                      {UPPER_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Upper Limit">
                    <input className={inputClass} type="text" inputMode="decimal" value={processForm.upper_limit}
                      onChange={e => setProcessForm(f => ({ ...f, upper_limit: e.target.value }))}
                      onBlur={() => setProcessForm(f => ({ ...f, upper_limit: limit2dp(f.upper_limit) }))}
                      disabled={processForm.upper_limit_condition === 'NO_UPPER_LIMIT'}
                      placeholder={processForm.upper_limit_condition === 'NO_UPPER_LIMIT' ? 'N/A' : '0.00'} />
                  </FormField>
                </div>
                {(() => {
                  const targetList = scForm.target_type === 'component' ? components : columns;
                  const targetName = targetList.find(c => c.id === scForm.target_id)?.name ?? null;
                  const processVars: FormulaVariable[] = [
                    { name: 'X', label: targetName ? `X — ${targetName}` : 'X', description: targetName ? `Base amount (${targetName})` : 'Base amount' },
                    ...columns.map(col => ({ name: col.name, description: 'Payroll column' })),
                  ];
                  return (
                    <FormField label="Value" required>
                      <FormulaInput
                        value={processForm.value}
                        onChange={v => setProcessForm(f => ({ ...f, value: v }))}
                        variables={processVars}
                        placeholder="e.g. X * 0.05 or 1500"
                        rows={2}
                      />
                      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                        <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-600">X</code>
                        {' '}= base amount. Supports arithmetic and payroll column references.
                      </p>
                    </FormField>
                  );
                })()}
              </div>
            </FormModal>
          )}
        </AnimatePresence>

        {/* Payroll Column modal */}
        <AnimatePresence>
          {pcModalOpen && (
            <FormModal title={editingPc ? 'Edit Payroll Column' : 'New Payroll Column'} maxWidth="2xl"
              onClose={() => setPcModalOpen(false)} onSave={savePc} saveLabel={pcSaving ? 'Saving…' : 'Save'}>
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Column Name" required>
                    <input className={inputClass} value={pcForm.name}
                      onChange={e => setPcForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Clothing Allowance - Permanent" />
                  </FormField>
                  <FormField label="Payslip Label">
                    <input className={inputClass} value={pcForm.payslip_label}
                      onChange={e => setPcForm(f => ({ ...f, payslip_label: e.target.value }))}
                      placeholder="e.g. Clothing Allowance" />
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">Shown on payslips instead of the column name. Leave blank to use the column name.</p>
                  </FormField>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FormField label="Payment / Deduction">
                    <select className={inputClass} value={pcForm.payment_deduction}
                      onChange={e => setPcForm(f => ({ ...f, payment_deduction: e.target.value }))}>
                      <option value="">— None —</option>
                      <option value="Payment">Payment</option>
                      <option value="Deduction">Deduction</option>
                    </select>
                  </FormField>
                  <FormField label="Column Order">
                    <input className={inputClass} type="number" value={pcForm.colorder}
                      onChange={e => setPcForm(f => ({ ...f, colorder: e.target.value }))}
                      onWheel={e => (e.target as HTMLInputElement).blur()}
                      placeholder="Auto (max + 1)" />
                  </FormField>
                  <FormField label="Default Value">
                    <input className={inputClass} value={pcForm.default_value}
                      onChange={e => setPcForm(f => ({ ...f, default_value: e.target.value }))}
                      placeholder="0" />
                  </FormField>
                </div>
                <div className="border border-[var(--border)] rounded-xl p-4 space-y-3 bg-[var(--bg)]">
                  <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Calculation Formula</p>
                  <FormField label="Formula">
                    <FormulaInput
                      value={pcForm.calculation_function}
                      onChange={v => setPcForm(f => ({ ...f, calculation_function: v }))}
                      variables={components.map(c => ({ name: c.name }))}
                      colVariables={pcRows
                        .filter((pc: PayrollCol) => !editingPc || pc.id !== editingPc.id)
                        .sort((a: PayrollCol, b: PayrollCol) => (a.colorder ?? 99999) - (b.colorder ?? 99999))
                        .map((pc: PayrollCol) => ({ name: pc.name, description: `Payroll column (order ${pc.colorder ?? '?'})` }))}
                      placeholder="e.g. BASIC * 0.3  or  (BASIC + ALLOWANCE) * rate"
                      rows={3}
                    />
                    <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                      Click a chip to insert. Green chips are existing payroll columns. Supports <code className="font-mono">+ − * / ( )</code>.
                    </p>
                  </FormField>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="Add Columns">
                      <SearchableCheckList
                        options={pcRows.filter(pc => !editingPc || pc.id !== editingPc.id).map(pc => ({ id: String(pc.id), label: pc.name }))}
                        selected={pcForm.add_column_ids}
                        onChange={ids => setPcForm(f => ({ ...f, add_column_ids: ids }))}
                        placeholder="Search columns…"
                      />
                    </FormField>
                    <FormField label="Subtract Columns">
                      <SearchableCheckList
                        options={pcRows.filter(pc => !editingPc || pc.id !== editingPc.id).map(pc => ({ id: String(pc.id), label: pc.name }))}
                        selected={pcForm.sub_column_ids}
                        onChange={ids => setPcForm(f => ({ ...f, sub_column_ids: ids }))}
                        placeholder="Search columns…"
                      />
                    </FormField>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FormField label="Enabled">
                    <select className={inputClass} value={pcForm.enabled}
                      onChange={e => setPcForm(f => ({ ...f, enabled: e.target.value }))}>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </FormField>
                  <FormField label="Editable">
                    <select className={inputClass} value={pcForm.editable}
                      onChange={e => setPcForm(f => ({ ...f, editable: e.target.value }))}>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </FormField>
                  <FormField label="Show on Report">
                    <select className={inputClass} value={pcForm.visible}
                      onChange={e => setPcForm(f => ({ ...f, visible: e.target.value }))}>
                      <option value="1">Yes</option>
                      <option value="0">No (hidden)</option>
                    </select>
                  </FormField>
                  <FormField label="Include in Net Pay">
                    <select className={inputClass} value={pcForm.include_in_net}
                      onChange={e => setPcForm(f => ({ ...f, include_in_net: e.target.value }))}>
                      <option value="1">Yes</option>
                      <option value="0">No</option>
                    </select>
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Calculation Rule">
                    <Combobox
                      options={[{ id: '', label: 'None (no rule)' }, ...scRows.map(sc => ({ id: String(sc.id), label: sc.name }))]}
                      value={pcForm.calculation_rule}
                      onChange={id => setPcForm(f => ({ ...f, calculation_rule: id }))}
                      placeholder="Search calculation rules…"
                    />
                  </FormField>
                  <FormField label="Calculation Groups">
                    <SearchableCheckList
                      options={cgRows.map(cg => ({ id: String(cg.id), label: cg.name }))}
                      selected={pcForm.deduction_groups}
                      onChange={ids => setPcForm(f => ({ ...f, deduction_groups: ids }))}
                      placeholder="Search groups… (none = applies to all)"
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Salary Components">
                    <SearchableCheckList
                      options={components.map(c => ({ id: String(c.id), label: c.name }))}
                      selected={pcForm.component_ids}
                      onChange={ids => setPcForm(f => ({ ...f, component_ids: ids }))}
                      placeholder="Search components…"
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Posting Column">
                    <select className={inputClass} value={pcForm.posting_column}
                      onChange={e => setPcForm(f => ({ ...f, posting_column: e.target.value }))}>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </FormField>
                  <FormField label="Posting Branch">
                    <input className={inputClass} value={pcForm.posting_branch}
                      onChange={e => setPcForm(f => ({ ...f, posting_branch: e.target.value }))}
                      placeholder="Branch code..." />
                  </FormField>
                </div>
                <FormField label="GL Account" required={pcForm.posting_column === 'Yes'}>
                  <input className={inputClass} value={pcForm.salarycomponent_gl}
                    onChange={e => setPcForm(f => ({ ...f, salarycomponent_gl: e.target.value }))}
                    placeholder={pcForm.posting_column === 'Yes' ? 'Required — GL account code for posting' : 'GL account code (optional)'}
                    style={pcForm.posting_column === 'Yes' && !pcForm.salarycomponent_gl ? { borderColor: 'var(--danger)' } : {}} />
                  {pcForm.posting_column === 'Yes' && (
                    <p className="text-[11px] text-[var(--danger)] mt-1">Required when Posting Column is Yes.</p>
                  )}
                </FormField>
              </div>
            </FormModal>
          )}
        </AnimatePresence>

        {/* Payroll Employee modal */}
        <AnimatePresence>
          {peModalOpen && (
            <FormModal title={editingPe ? 'Edit Payroll Employee' : 'Add Payroll Employee'} maxWidth="lg"
              onClose={() => setPeModalOpen(false)} onSave={savePe} saveLabel={peSaving ? 'Saving…' : 'Save'}>
              <div className="space-y-4">
                {editingPe ? (
                  <FormField label="Employee" required>
                    <Combobox
                      options={employeesList.map(e => ({ id: e.id, label: e.name }))}
                      value={peForm.employee}
                      onChange={id => setPeForm(f => ({ ...f, employee: id }))}
                      placeholder="Search employee…"
                    />
                  </FormField>
                ) : (
                  <FormField label="Employees" required>
                    <SearchableCheckList
                      options={employeesList
                        .filter(e => !peRows.some(p => p.employee === e.id))
                        .map(e => ({ id: e.id, label: e.name }))}
                      selected={peSelectedEmpIds}
                      onChange={setPeSelectedEmpIds}
                      placeholder="Search employees…"
                    />
                  </FormField>
                )}
                <FormField label="Pay Frequency" required>
                  <Combobox
                    options={pfRows.map(pf => ({ id: String(pf.id), label: pf.name }))}
                    value={peForm.pay_frequency}
                    onChange={id => setPeForm(f => ({ ...f, pay_frequency: id }))}
                    placeholder="Select frequency…"
                  />
                </FormField>
                <FormField label="Calculation Group">
                  <Combobox
                    options={[{ id: '', label: 'None' }, ...cgRows.map(cg => ({ id: cg.id, label: cg.name }))]}
                    value={peForm.deduction_group}
                    onChange={id => setPeForm(f => ({ ...f, deduction_group: id }))}
                    placeholder="Search or select group…"
                  />
                </FormField>
                <FormField label="Calculation Exemptions">
                  <SearchableCheckList
                    options={scRows.map(sc => ({ id: String(sc.id), label: sc.name, sub: sc.group_name ?? undefined }))}
                    selected={peForm.deduction_exemptions.split(',').filter(Boolean)}
                    onChange={ids => setPeForm(f => ({ ...f, deduction_exemptions: ids.join(',') }))}
                    placeholder="Search saved calculations…"
                  />
                </FormField>
              </div>
            </FormModal>
          )}
        </AnimatePresence>

        {/* Pay Frequencies modal */}
        <AnimatePresence>
          {pfSetupOpen && (
            <FormModal title="Pay Frequencies"
              subtitle="Configure pay frequency options available to employees"
              maxWidth="md"
              scrollable={false}
              onClose={() => { setPfSetupOpen(false); setEditingPf(null); setPfForm(BLANK_PF); }}
              onSave={() => { setPfSetupOpen(false); setEditingPf(null); setPfForm(BLANK_PF); }}
              saveLabel="Done"
            >
              <div className="space-y-4">
                {/* Add / Edit form — always fully visible */}
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4 space-y-3">
                  <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                    {editingPf ? 'Edit Frequency' : 'Add Frequency'}
                  </p>
                  <div className="grid grid-cols-[1fr_80px] gap-3">
                    <FormField label="Name" required>
                      <input className={inputClass} value={pfForm.name}
                        onChange={e => setPfForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Monthly"
                        onKeyDown={e => e.key === 'Enter' && savePf()} />
                    </FormField>
                    <FormField label="Order">
                      <input className={inputClass} type="number" value={pfForm.sort_order}
                        onChange={e => setPfForm(f => ({ ...f, sort_order: e.target.value }))}
                        placeholder="99"
                        onWheel={e => (e.target as HTMLInputElement).blur()} />
                    </FormField>
                  </div>
                  <FormField label="Description">
                    <input className={inputClass} value={pfForm.description}
                      onChange={e => setPfForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Optional description..."
                      onKeyDown={e => e.key === 'Enter' && savePf()} />
                  </FormField>
                  <div className="flex gap-2 justify-end pt-1">
                    {editingPf && (
                      <button className="secondary-btn" onClick={() => { setEditingPf(null); setPfForm(BLANK_PF); }}>
                        Cancel
                      </button>
                    )}
                    <button className="primary-btn" onClick={savePf} disabled={pfSaving}>
                      <Plus size={14} /> {pfSaving ? 'Saving…' : editingPf ? 'Update' : 'Add'}
                    </button>
                  </div>
                </div>

                {/* Frequency list — scrolls independently */}
                <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                  {pfRows.length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-[var(--text-muted)]">No pay frequencies yet.</div>
                  ) : (
                    <div className="max-h-[220px] overflow-y-auto">
                      <table className="w-full border-collapse text-[13px]">
                        <thead className="sticky top-0 z-10 bg-[var(--surface)]">
                          <tr>
                            <th className="th text-left py-2 px-3">Name</th>
                            <th className="th text-left py-2 px-3">Description</th>
                            <th className="th text-center py-2 px-3">Order</th>
                            <th className="th py-2 px-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...pfRows].sort((a, b) => a.sort_order - b.sort_order).map(pf => (
                            <tr key={pf.id} className="tr">
                              <td className="td py-2 px-3 font-medium">{pf.name}</td>
                              <td className="td py-2 px-3 text-[var(--text-muted)] text-[12px]">{pf.description || '—'}</td>
                              <td className="td py-2 px-3 text-center text-[var(--text-muted)] text-[12px]">{pf.sort_order}</td>
                              <td className="td py-2 px-3 text-right">
                                <div className="flex justify-end">
                                  <RowActions actions={[
                                    { label: 'Edit', icon: Edit, onClick: () => openPfEdit(pf), hidden: !can('manage_payroll_employees') },
                                    { label: 'Delete', icon: Trash2, danger: true, onClick: () => deletePf(String(pf.id)), disabled: pfDeleting === String(pf.id), hidden: !can('manage_payroll_employees') },
                                  ]} />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </FormModal>
          )}
        </AnimatePresence>

        {/* Bulk pay frequency modal */}
        <AnimatePresence>
          {peBulkFreqOpen && (
            <FormModal
              title={`Change Pay Frequency — ${peBulkSelected.length} Employee${peBulkSelected.length !== 1 ? 's' : ''}`}
              maxWidth="sm"
              onClose={() => { setPeBulkFreqOpen(false); setPeBulkFreq(''); }}
              onSave={bulkChangePeFreq}
              saveLabel={peBulkSaving ? 'Updating…' : 'Update'}
            >
              <FormField label="New Pay Frequency" required>
                <Combobox
                  options={pfRows.map((pf: PayFreq) => ({ id: String(pf.id), label: pf.name }))}
                  value={peBulkFreq}
                  onChange={id => setPeBulkFreq(id)}
                  placeholder="Select frequency…"
                />
              </FormField>
            </FormModal>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
