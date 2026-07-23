import api from './api';
import { defaultFieldConfig, defaultTransferFieldConfig, EMPLOYEE_FORM_FIELDS_BY_KEY, type EmployeeFieldConfig, type EmployeeTransferFieldConfig } from '../src/config/employeeFormFields';
import { DEFAULT_EMPLOYEE_ID_PATTERN } from './employeeIdFormat';

export interface AppSettings {
  companyStructure: {
    autoGenerateCode: boolean;
  };
  employees: {
    autoGenerateNumber: boolean;
    /** Template for the auto-generated employee ID, e.g. EMP-{YYYY}-{SEQ4}. */
    idFormat: string;
  };
  recruitment: {
    autoGenerateCode: boolean;
  };
  approvals: {
    employeeApproval: boolean;
    employeeSelfApproval: boolean;
    employeeUpdateApproval: boolean;
    payrollApproval: boolean;
    selfApproval: boolean;
    medicalApproval: boolean;
    medicalSelfApproval: boolean;
  };
  general: {
    currency: string;
  };
  // Master switches: when off, the module records data only — no GL/payment postings.
  payments: {
    leave: boolean;
    medical: boolean;
    payroll: boolean;
  };
  medicalClaims: {
    hospitalWhtRate: number;
    pharmacyWhtRate: number;
  };
  // Per-field visibility/required config for the employee-creation form.
  employeeForm: {
    fields: EmployeeFieldConfig;
    transferFields: EmployeeTransferFieldConfig;
  };
}

const DEFAULTS: AppSettings = {
  companyStructure: {
    autoGenerateCode: false,
  },
  employees: {
    autoGenerateNumber: true,
    idFormat: DEFAULT_EMPLOYEE_ID_PATTERN,
  },
  recruitment: {
    autoGenerateCode: false,
  },
  approvals: {
    employeeApproval: true,
    employeeSelfApproval: false,
    employeeUpdateApproval: true,
    payrollApproval: false,
    selfApproval: false,
    medicalApproval: false,
    medicalSelfApproval: true,
  },
  general: {
    currency: 'SLE',
  },
  payments: {
    leave: true,
    medical: true,
    payroll: true,
  },
  medicalClaims: {
    hospitalWhtRate: 0,
    pharmacyWhtRate: 0,
  },
  employeeForm: {
    fields: defaultFieldConfig(),
    transferFields: defaultTransferFieldConfig(),
  },
};

// In-memory store only — settings are NEVER persisted to localStorage. The database
// (settings table) is the single source of truth; this cache is hydrated from the
// server by initControlSettings() on app load and reset to defaults on every reload.
let cache: AppSettings = structuredClone(DEFAULTS);

// Remove any settings persisted by older builds so nothing lingers in the browser.
try { localStorage.removeItem('hr_settings'); } catch { /* no localStorage — ignore */ }

/** Whether an employee field is configured to show (Settings → Controls → Employee Form).
 *  Drives the create form AND the read views (detail slide-over, personal info). Locked core
 *  fields are always visible. Reads the cache directly (no clone) so it's cheap per-field. */
export function employeeFieldVisible(key: string): boolean {
  const meta = EMPLOYEE_FORM_FIELDS_BY_KEY[key];
  if (meta?.locked) return true;
  return cache.employeeForm.fields[key]?.visible ?? meta?.defaultVisible ?? true;
}

/** Whether an approved/active employee field must be changed through Employee Transfers. */
export function employeeTransferField(key: string): boolean {
  return cache.employeeForm.transferFields[key] ?? defaultTransferFieldConfig()[key] ?? false;
}

export function getSettings(): AppSettings {
  // Return a fresh copy so callers can't mutate the shared cache.
  return {
    companyStructure: { ...cache.companyStructure },
    employees:        { ...cache.employees },
    recruitment:      { ...cache.recruitment },
    approvals:        { ...cache.approvals },
    general:          { ...cache.general },
    payments:         { ...cache.payments },
    medicalClaims:    { ...cache.medicalClaims },
    employeeForm:     {
      fields: structuredClone(cache.employeeForm.fields),
      transferFields: structuredClone(cache.employeeForm.transferFields),
    },
  };
}

// Server keys for each section/field — the database (settings table, category
// 'app_controls') is the source of truth; the in-memory cache is just a synchronous
// view so components can keep calling getSettings() without await.
// medicalClaims is excluded: it persists through its own /medical/settings endpoint.
const SERVER_KEYS: Record<string, Record<string, string>> = {
  companyStructure: { autoGenerateCode:   'company_auto_generate_code' },
  employees:        { autoGenerateNumber: 'employee_auto_generate_number', idFormat: 'employee_id_format' },
  recruitment:      { autoGenerateCode:   'recruitment_auto_generate_code' },
  approvals: {
    employeeApproval:     'approval_employee',
    employeeSelfApproval: 'approval_employee_self',
    employeeUpdateApproval: 'approval_employee_update',
    payrollApproval:      'approval_payroll',
    selfApproval:         'approval_payroll_self',
    medicalApproval:      'approval_medical',
    medicalSelfApproval:  'approval_medical_self',
  },
  general: { currency: 'general_currency' },
  payments: {
    leave:   'leave_payments_enabled',
    medical: 'medical_payments_enabled',
    payroll: 'payroll_payments_enabled',
  },
};

function writeCache(settings: AppSettings): void {
  cache = settings;
}

/** Pull control settings from the server into the local cache.
 *  Called before first render (main.tsx) and after login (App.tsx). */
export async function initControlSettings(): Promise<void> {
  try {
    const r = await api.get('/settings/controls');
    const flat: Record<string, string> = r.data?.data ?? {};
    const merged = getSettings();
    for (const [section, fields] of Object.entries(SERVER_KEYS)) {
      for (const [field, serverKey] of Object.entries(fields)) {
        const def = (DEFAULTS as any)[section][field];
        if (flat[serverKey] === undefined) {
          // Not on the server → reset to the built-in default, never a stale local edit
          // that failed to persist. The DB is the source of truth.
          (merged as any)[section][field] = def;
          continue;
        }
        (merged as any)[section][field] = typeof def === 'boolean' ? flat[serverKey] === '1' : flat[serverKey];
      }
    }
    // employee_form_fields is a JSON object value — parse it separately and merge over the
    // registry defaults so newly-added fields automatically appear with their defaults.
    try {
      const raw = flat['employee_form_fields'];
      merged.employeeForm = {
        fields: raw ? { ...defaultFieldConfig(), ...JSON.parse(raw) } : defaultFieldConfig(),
        transferFields: defaultTransferFieldConfig(),
      };
      const transferRaw = flat['employee_transfer_fields'];
      const savedTransfer = transferRaw ? JSON.parse(transferRaw) : {};
      merged.employeeForm.transferFields = Array.isArray(savedTransfer)
        ? { ...defaultTransferFieldConfig(), ...Object.fromEntries(savedTransfer.map((key: string) => [key, true])) }
        : { ...defaultTransferFieldConfig(), ...savedTransfer };
    } catch { merged.employeeForm = { fields: defaultFieldConfig(), transferFields: defaultTransferFieldConfig() }; }
    writeCache(merged);
  } catch { /* offline — keep cached/default values */ }
}

export function saveSetting<K extends keyof AppSettings>(
  section: K,
  values: Partial<AppSettings[K]>
): void {
  const current = getSettings();
  const updated: AppSettings = {
    ...current,
    [section]: { ...(current[section] as object), ...(values as object) },
  };
  writeCache(updated);

  // The employee-form field config is stored as a single JSON string setting.
  if (section === 'employeeForm') {
    const cfg = updated.employeeForm.fields ?? {};
    const transferFields = updated.employeeForm.transferFields ?? defaultTransferFieldConfig();
    api.put('/settings/controls', {
      employee_form_fields: JSON.stringify(cfg),
      employee_transfer_fields: JSON.stringify(transferFields),
    })
      .catch(() => { /* cache still holds the value locally */ });
    return;
  }

  // Write-through to the server so the setting applies to every user
  const fields = SERVER_KEYS[section as string];
  if (!fields) return;
  const payload: Record<string, string> = {};
  for (const [field, value] of Object.entries(values as object)) {
    const serverKey = fields[field];
    if (!serverKey) continue;
    payload[serverKey] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  }
  if (Object.keys(payload).length) {
    api.put('/settings/controls', payload).catch(() => { /* cache still holds the value locally */ });
  }
}
