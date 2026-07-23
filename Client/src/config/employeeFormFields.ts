// Canonical registry of configurable employee-creation form fields.
//
// Single source of truth shared by the form (EmployeeFormFull.tsx) and the Controls UI
// (Settings → Controls → Employee Form). Admins toggle each field's visibility and whether it's
// required; the saved config lives in the `employee_form_fields` app-control setting.
//
// Defaults mirror the form's CURRENT hardcoded behaviour, so with no saved config the form behaves
// exactly as before. `locked` fields are core identity fields that can never be hidden or made
// optional (work_email backs the mandatory, unique `email` column).
//
// NOTE: `employee_id` is intentionally NOT configurable — it has its own auto-generate logic.

export type EmployeeFieldStep = 'personal' | 'employment' | 'nextofkin' | 'financial' | 'documents';

export interface EmployeeFormField {
  key: string;
  label: string;
  step: EmployeeFieldStep;
  type?: 'text' | 'date' | 'select' | 'file';
  defaultVisible: boolean;
  defaultRequired: boolean;
  locked?: boolean;
}

export interface FieldFlags { visible: boolean; required: boolean }
export type EmployeeFieldConfig = Record<string, FieldFlags>;
export type EmployeeTransferFieldConfig = Record<string, boolean>;

// Initial business defaults for the transfer workflow. Admins can change this classification from
// Settings → Controls → Employee Form → Employee Transfers without changing the employee form registry.
export const DEFAULT_EMPLOYEE_TRANSFER_FIELD_KEYS = [
  'jobTitleId', 'branchId', 'departmentId', 'unitId', 'outletId',
  'supervisorId', 'paygradeId', 'notcheId',
];

export const EMPLOYEE_FORM_STEPS: { id: EmployeeFieldStep; label: string }[] = [
  { id: 'personal',   label: 'Personal'    },
  { id: 'employment', label: 'Employment'  },
  { id: 'nextofkin',  label: 'Next of Kin' },
  { id: 'financial',  label: 'Financial'   },
  { id: 'documents',  label: 'Documents'   },
];

export const EMPLOYEE_FORM_FIELDS: EmployeeFormField[] = [
  // ── Personal ──────────────────────────────────────────────────────────────
  { key: 'titleId',        label: 'Title',           step: 'personal', type: 'select', defaultVisible: true, defaultRequired: false },
  { key: 'firstName',      label: 'First Name',      step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: true,  locked: true },
  { key: 'middleName',     label: 'Middle Name',     step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: false },
  { key: 'lastName',       label: 'Last Name',       step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: true,  locked: true },
  { key: 'genderId',       label: 'Gender',          step: 'personal', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'dateOfBirth',    label: 'Date of Birth',   step: 'personal', type: 'date',   defaultVisible: true, defaultRequired: true  },
  { key: 'place_of_birth', label: 'Place of Birth',  step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: false },
  { key: 'nationalityId',  label: 'Nationality',     step: 'personal', type: 'select', defaultVisible: true, defaultRequired: false },
  { key: 'religionId',     label: 'Religion',        step: 'personal', type: 'select', defaultVisible: true, defaultRequired: false },
  { key: 'marital_status', label: 'Marital Status',  step: 'personal', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'spouse_name',    label: 'Spouse Name',     step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: false },
  { key: 'father_name',    label: "Father's Name",   step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: false },
  { key: 'mother_name',    label: "Mother's Name",   step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: false },
  { key: 'work_email',     label: 'Work Email',      step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: true,  locked: true },
  { key: 'personal_email', label: 'Personal Email',  step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: false },
  { key: 'mobilePhone',    label: 'Mobile Phone',    step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: true  },
  { key: 'address1',       label: 'Address',         step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: true  },
  { key: 'city',           label: 'City',            step: 'personal', type: 'text',   defaultVisible: true, defaultRequired: false },
  { key: 'country',        label: 'Country',         step: 'personal', type: 'select', defaultVisible: true, defaultRequired: false },

  // ── Employment ────────────────────────────────────────────────────────────
  { key: 'employmentStatusId', label: 'Employment Status', step: 'employment', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'jobTitleId',         label: 'Job Title',         step: 'employment', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'staff_level',        label: 'Staff Level',       step: 'employment', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'staff_role',         label: 'Staff Role',        step: 'employment', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'rmRoType',           label: 'RM / RO',           step: 'employment', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'branchId',           label: 'Branch',            step: 'employment', type: 'select', defaultVisible: true, defaultRequired: false },
  { key: 'departmentId',       label: 'Department',        step: 'employment', type: 'select', defaultVisible: true, defaultRequired: false },
  { key: 'unitId',             label: 'Unit',              step: 'employment', type: 'select', defaultVisible: true, defaultRequired: false },
  { key: 'outletId',           label: 'Outlet',            step: 'employment', type: 'select', defaultVisible: true, defaultRequired: false },
  { key: 'supervisorId',       label: 'Supervisor',        step: 'employment', type: 'select', defaultVisible: true, defaultRequired: true  },
  { key: 'ssn_num',            label: 'SSN',               step: 'employment', type: 'text',   defaultVisible: true, defaultRequired: true  },
  { key: 'hireDate',           label: 'Hire Date',         step: 'employment', type: 'date',   defaultVisible: true, defaultRequired: true  },
  { key: 'confirmationDate',   label: 'Confirmation Date',  step: 'employment', type: 'date',  defaultVisible: true, defaultRequired: true  },

  // ── Next of Kin ───────────────────────────────────────────────────────────
  { key: 'nxt_kin_fname',   label: 'Full Name',     step: 'nextofkin', type: 'text', defaultVisible: true, defaultRequired: true  },
  { key: 'nxt_kin_phone',   label: 'Phone Number',  step: 'nextofkin', type: 'text', defaultVisible: true, defaultRequired: true  },
  { key: 'nxt_kin_email',   label: 'Email Address', step: 'nextofkin', type: 'text', defaultVisible: true, defaultRequired: false },
  { key: 'nxt_kin_address', label: 'Address',       step: 'nextofkin', type: 'text', defaultVisible: true, defaultRequired: true  },

  // ── Financial ─────────────────────────────────────────────────────────────
  { key: 'bankAccount', label: 'Bank Account Number', step: 'financial', type: 'text',   defaultVisible: true, defaultRequired: true },
  { key: 'paygradeId',  label: 'Pay Grade',           step: 'financial', type: 'select', defaultVisible: true, defaultRequired: true },
  { key: 'notcheId',    label: 'Salary Notch',        step: 'financial', type: 'select', defaultVisible: true, defaultRequired: true },

  // ── Documents ─────────────────────────────────────────────────────────────
  { key: 'nationalIdNumber', label: 'National ID Number',     step: 'documents', type: 'text', defaultVisible: true, defaultRequired: false },
  { key: 'nationalIdExpiry', label: 'National ID Expiry',     step: 'documents', type: 'date', defaultVisible: true, defaultRequired: false },
  { key: 'passportNumber',   label: 'Passport Number',        step: 'documents', type: 'text', defaultVisible: true, defaultRequired: false },
  { key: 'passportExpiry',   label: 'Passport Expiry',        step: 'documents', type: 'date', defaultVisible: true, defaultRequired: false },
  { key: 'driverLicenseNum', label: "Driver's License Number", step: 'documents', type: 'text', defaultVisible: true, defaultRequired: false },
  { key: 'driverLicenseExp', label: "Driver's License Expiry", step: 'documents', type: 'date', defaultVisible: true, defaultRequired: false },
  { key: 'fit_and_proper',   label: 'Fit & Proper Form',      step: 'documents', type: 'file', defaultVisible: true, defaultRequired: false },
  { key: 'policeClearance',  label: 'Police Clearance',       step: 'documents', type: 'file', defaultVisible: true, defaultRequired: false },
  { key: 'medicalClearance', label: 'Medical Clearance',      step: 'documents', type: 'file', defaultVisible: true, defaultRequired: false },
];

export const EMPLOYEE_FORM_FIELDS_BY_KEY: Record<string, EmployeeFormField> =
  Object.fromEntries(EMPLOYEE_FORM_FIELDS.map((f) => [f.key, f]));

/** Build the default config map (every field at its registry defaults). */
export function defaultFieldConfig(): EmployeeFieldConfig {
  const out: EmployeeFieldConfig = {};
  for (const f of EMPLOYEE_FORM_FIELDS) out[f.key] = { visible: f.defaultVisible, required: f.defaultRequired };
  return out;
}

export function defaultTransferFieldConfig(): EmployeeTransferFieldConfig {
  const selected = new Set(DEFAULT_EMPLOYEE_TRANSFER_FIELD_KEYS);
  return Object.fromEntries(EMPLOYEE_FORM_FIELDS.map((field) => [field.key, selected.has(field.key)]));
}
