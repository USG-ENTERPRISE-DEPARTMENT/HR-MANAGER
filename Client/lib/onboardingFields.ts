// Canonical catalog of fields that HR can expose on the public self-onboarding form.
// Used by BOTH the Form Builder (SelfOnboarding.tsx) and the public renderer
// (OnboardingPortal.tsx). Keys match `employee` columns so a submission maps 1:1
// onto EmployeeFormFull when HR converts it.
//
// - `alwaysOn` fields are always shown and always required (the minimum needed to
//   identify a submission); their checkboxes are locked on in the builder.
// - `select` fields are backed either by a code list (`codeList`) or a fixed list
//   (`staticOptions`). The public form fetches code-list options from the server.
// - `wrap` is the nested key EmployeeFormFull expects for a code-list value on
//   convert prefill (e.g. genderId → initialData.gender.id). Fields without `wrap`
//   prefill flat by `key`.

export type OnboardingFieldType = 'text' | 'email' | 'tel' | 'date' | 'select' | 'file';

export interface OnboardingField {
  key: string;
  label: string;
  group: string;
  type: OnboardingFieldType;
  codeList?: string;          // code-list code (server returns the option list)
  staticOptions?: string[];   // fixed select options
  wrap?: string;              // nested initialData key for convert prefill
  alwaysOn?: boolean;
}

export const ONBOARDING_GROUPS = [
  'Personal',
  'Contact & Address',
  'Next of Kin',
  'Identity Documents',
  'Clearance Documents',
] as const;

export const ONBOARDING_FIELDS: OnboardingField[] = [
  // ── Personal ──────────────────────────────────────────────
  { key: 'titleId',        label: 'Title',           group: 'Personal', type: 'select', codeList: 'TIT', wrap: 'title' },
  { key: 'firstName',      label: 'First Name',      group: 'Personal', type: 'text',  alwaysOn: true },
  { key: 'middleName',     label: 'Middle Name',     group: 'Personal', type: 'text' },
  { key: 'lastName',       label: 'Last Name',       group: 'Personal', type: 'text',  alwaysOn: true },
  { key: 'genderId',       label: 'Gender',          group: 'Personal', type: 'select', codeList: 'GEN', wrap: 'gender' },
  { key: 'dateOfBirth',    label: 'Date of Birth',   group: 'Personal', type: 'date' },
  { key: 'place_of_birth', label: 'Place of Birth',  group: 'Personal', type: 'text' },
  { key: 'nationalityId',  label: 'Nationality',     group: 'Personal', type: 'select', codeList: 'NAT', wrap: 'nationality' },
  { key: 'religionId',     label: 'Religion',        group: 'Personal', type: 'select', codeList: 'REG', wrap: 'religion' },
  { key: 'marital_status', label: 'Marital Status',  group: 'Personal', type: 'select', staticOptions: ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'] },
  { key: 'spouse_name',    label: 'Spouse Name',     group: 'Personal', type: 'text' },
  { key: 'father_name',    label: "Father's Name",   group: 'Personal', type: 'text' },
  { key: 'mother_name',    label: "Mother's Name",   group: 'Personal', type: 'text' },

  // ── Contact & Address ─────────────────────────────────────
  { key: 'work_email',     label: 'Email Address',   group: 'Contact & Address', type: 'email', alwaysOn: true },
  { key: 'personal_email', label: 'Personal Email',  group: 'Contact & Address', type: 'email' },
  { key: 'mobilePhone',    label: 'Mobile Phone',    group: 'Contact & Address', type: 'tel' },
  { key: 'address1',       label: 'Address',         group: 'Contact & Address', type: 'text' },
  { key: 'city',           label: 'City',            group: 'Contact & Address', type: 'text' },
  { key: 'country',        label: 'Country',         group: 'Contact & Address', type: 'select', codeList: 'CT' },

  // ── Next of Kin ───────────────────────────────────────────
  { key: 'nxt_kin_fname',   label: 'Full Name',      group: 'Next of Kin', type: 'text' },
  { key: 'nxt_kin_phone',   label: 'Phone Number',   group: 'Next of Kin', type: 'tel' },
  { key: 'nxt_kin_email',   label: 'Email Address',  group: 'Next of Kin', type: 'email' },
  { key: 'nxt_kin_address', label: 'Address',        group: 'Next of Kin', type: 'text' },

  // ── Identity Documents ────────────────────────────────────
  { key: 'nationalIdNumber', label: 'National ID Number',       group: 'Identity Documents', type: 'text' },
  { key: 'nationalIdExpiry', label: 'National ID Expiry',       group: 'Identity Documents', type: 'date' },
  { key: 'passportNumber',   label: 'Passport Number',          group: 'Identity Documents', type: 'text' },
  { key: 'passportExpiry',   label: 'Passport Expiry',          group: 'Identity Documents', type: 'date' },
  { key: 'driverLicenseNum', label: "Driver's License Number",  group: 'Identity Documents', type: 'text' },
  { key: 'driverLicenseExp', label: "Driver's License Expiry",  group: 'Identity Documents', type: 'date' },

  // ── Clearance Documents (file uploads) ────────────────────
  { key: 'fit_and_proper',   label: 'Fit & Proper Form',  group: 'Clearance Documents', type: 'file' },
  { key: 'policeClearance',  label: 'Police Clearance',   group: 'Clearance Documents', type: 'file' },
  { key: 'medicalClearance', label: 'Medical Clearance',  group: 'Clearance Documents', type: 'file' },
];

export const ONBOARDING_FIELD_MAP: Record<string, OnboardingField> =
  Object.fromEntries(ONBOARDING_FIELDS.map(f => [f.key, f]));

/** Keys that are always shown + required (locked on in the builder). */
export const ALWAYS_ON_KEYS = ONBOARDING_FIELDS.filter(f => f.alwaysOn).map(f => f.key);

/** Default config used before HR saves anything (just the always-on fields). */
export interface OnboardingConfig {
  enabledFields: string[];          // field keys shown on the public form
  requiredFields: string[];         // subset of enabledFields that are required
}

export const DEFAULT_ONBOARDING_CONFIG: OnboardingConfig = {
  enabledFields: [...ALWAYS_ON_KEYS],
  requiredFields: [...ALWAYS_ON_KEYS],
};
