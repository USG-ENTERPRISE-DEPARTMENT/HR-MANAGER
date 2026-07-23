// Server mirror of the configurable employee-creation fields.
// Keep the keys/defaults in sync with the client registry:
//   Client/src/config/employeeFormFields.ts
// Used to enforce required fields on create from the admin Controls config. `locked` fields are
// core identity fields that are always required regardless of config (work_email backs the
// mandatory, unique `email` column). Default visibility is true for every field.

const EMPLOYEE_FORM_FIELDS = [
  // locked core
  { key: 'firstName',  label: 'First name', defaultRequired: true, locked: true },
  { key: 'lastName',   label: 'Last name',  defaultRequired: true, locked: true },
  { key: 'work_email', label: 'Work email', defaultRequired: true, locked: true },
  // personal
  { key: 'titleId',        label: 'Title',          defaultRequired: false },
  { key: 'middleName',     label: 'Middle name',    defaultRequired: false },
  { key: 'genderId',       label: 'Gender',         defaultRequired: true  },
  { key: 'dateOfBirth',    label: 'Date of birth',  defaultRequired: true  },
  { key: 'place_of_birth', label: 'Place of birth', defaultRequired: false },
  { key: 'nationalityId',  label: 'Nationality',    defaultRequired: false },
  { key: 'religionId',     label: 'Religion',       defaultRequired: false },
  { key: 'marital_status', label: 'Marital status', defaultRequired: true  },
  { key: 'spouse_name',    label: 'Spouse name',    defaultRequired: false },
  { key: 'father_name',    label: "Father's name",  defaultRequired: false },
  { key: 'mother_name',    label: "Mother's name",  defaultRequired: false },
  { key: 'personal_email', label: 'Personal email', defaultRequired: false },
  { key: 'mobilePhone',    label: 'Mobile phone',   defaultRequired: true  },
  { key: 'address1',       label: 'Address',        defaultRequired: true  },
  { key: 'city',           label: 'City',           defaultRequired: false },
  { key: 'country',        label: 'Country',        defaultRequired: false },
  // employment
  { key: 'employmentStatusId', label: 'Employment status',  defaultRequired: true  },
  { key: 'jobTitleId',         label: 'Job title',          defaultRequired: true  },
  { key: 'staff_level',        label: 'Staff level',        defaultRequired: true  },
  { key: 'staff_role',         label: 'Staff role',         defaultRequired: true  },
  { key: 'rmRoType',           label: 'RM / RO',            defaultRequired: true  },
  { key: 'branchId',           label: 'Branch',             defaultRequired: false },
  { key: 'departmentId',       label: 'Department',         defaultRequired: false },
  { key: 'unitId',             label: 'Unit',               defaultRequired: false },
  { key: 'outletId',           label: 'Outlet',             defaultRequired: false },
  { key: 'supervisorId',       label: 'Supervisor',         defaultRequired: true  },
  { key: 'ssn_num',            label: 'SSN',                defaultRequired: true  },
  { key: 'hireDate',           label: 'Hire date',          defaultRequired: true  },
  { key: 'confirmationDate',   label: 'Confirmation date',  defaultRequired: true  },
  // next of kin
  { key: 'nxt_kin_fname',   label: 'Next of kin full name',     defaultRequired: true  },
  { key: 'nxt_kin_phone',   label: 'Next of kin phone number',  defaultRequired: true  },
  { key: 'nxt_kin_email',   label: 'Next of kin email',         defaultRequired: false },
  { key: 'nxt_kin_address', label: 'Next of kin address',       defaultRequired: true  },
  // financial
  { key: 'bankAccount', label: 'Bank account number', defaultRequired: true },
  { key: 'paygradeId',  label: 'Pay grade',           defaultRequired: true },
  { key: 'notcheId',    label: 'Salary notch',        defaultRequired: true },
  // documents
  { key: 'nationalIdNumber', label: 'National ID number',     defaultRequired: false },
  { key: 'nationalIdExpiry', label: 'National ID expiry',     defaultRequired: false },
  { key: 'passportNumber',   label: 'Passport number',        defaultRequired: false },
  { key: 'passportExpiry',   label: 'Passport expiry',        defaultRequired: false },
  { key: 'driverLicenseNum', label: "Driver's license number", defaultRequired: false },
  { key: 'driverLicenseExp', label: "Driver's license expiry", defaultRequired: false },
  { key: 'fit_and_proper',   label: 'Fit & Proper form',      defaultRequired: false },
  { key: 'policeClearance',  label: 'Police clearance',       defaultRequired: false },
  { key: 'medicalClearance', label: 'Medical clearance',      defaultRequired: false },
];

/**
 * Given the saved `{ key: { visible, required } }` config, return the fields that are effectively
 * required. Locked fields are always required; otherwise a field is required only when it is both
 * visible and required. Missing keys fall back to the registry default (default visibility = true).
 */
function effectiveRequiredFields(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const out = [];
  for (const f of EMPLOYEE_FORM_FIELDS) {
    if (f.locked) { out.push(f); continue; }
    const saved = c[f.key];
    const visible = saved ? saved.visible !== false : true;
    const required = saved ? !!saved.required : !!f.defaultRequired;
    if (visible && required) out.push(f);
  }
  return out;
}

const FIELD_BY_KEY = Object.fromEntries(EMPLOYEE_FORM_FIELDS.map((f) => [f.key, f]));
const DEFAULT_EMPLOYEE_TRANSFER_FIELD_KEYS = [
  'jobTitleId', 'branchId', 'departmentId', 'unitId', 'outletId',
  'supervisorId', 'paygradeId', 'notcheId',
];
const NON_TRANSFERABLE_FIELDS = new Set([
  'firstName', 'lastName', 'work_email',
  'fit_and_proper', 'policeClearance', 'medicalClearance',
]);

function defaultTransferFieldConfig() {
  const selected = new Set(DEFAULT_EMPLOYEE_TRANSFER_FIELD_KEYS);
  return Object.fromEntries(EMPLOYEE_FORM_FIELDS.map((field) => [field.key, selected.has(field.key)]));
}

/** Normalize the saved transfer classification and return enabled, whitelisted field metadata. */
function effectiveTransferFields(cfg) {
  let normalized;
  if (Array.isArray(cfg)) {
    const selected = new Set(cfg.map(String));
    normalized = Object.fromEntries(EMPLOYEE_FORM_FIELDS.map((field) => [field.key, selected.has(field.key)]));
  } else {
    normalized = { ...defaultTransferFieldConfig(), ...(cfg && typeof cfg === 'object' ? cfg : {}) };
  }
  return EMPLOYEE_FORM_FIELDS.filter((field) => !!normalized[field.key] && !NON_TRANSFERABLE_FIELDS.has(field.key));
}

/** Whether a field is visible given the saved `{ key: { visible, required } }` config.
 *  Locked fields are always visible; unknown/unsaved keys default to visible. */
function isFieldVisible(cfg, key) {
  if (FIELD_BY_KEY[key]?.locked) return true;
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return c[key]?.visible !== false;
}

module.exports = {
  EMPLOYEE_FORM_FIELDS, FIELD_BY_KEY, DEFAULT_EMPLOYEE_TRANSFER_FIELD_KEYS,
  effectiveRequiredFields, effectiveTransferFields, isFieldVisible,
};
