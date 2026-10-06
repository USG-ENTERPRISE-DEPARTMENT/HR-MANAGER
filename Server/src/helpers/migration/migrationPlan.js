// ─────────────────────────────────────────────────────────────────────────────
// Migration plan — WHAT moves, in WHAT order, and WHICH rows are excluded.
//
// This file is pure declaration and pure functions: no database connections, no side effects.
// The analyser (migrationAnalyzer.js) reads it to produce a dry run; the loader will read the
// same plan to execute. Keeping the rules here means the dry run and the real load can never
// disagree about what would happen — the commonest way a migration surprises you.
//
// Source: `hrmdata_rcb` (legacy IceHRM production, MySQL)
// Target: the HR-MANAGER schema, on MySQL (`xhrm`) or Postgres
//
// Scope decisions are the user's, recorded 2026-09-29:
//   * core + medical now; documents and audit deferred but switchable (SCOPES below)
//   * 158,495 payrolldata rows whose payroll run was deleted are EXCLUDED
//   * ~90 hand-made scratch tables are EXCLUDED
//   * nationality imports as null where it cannot be resolved
//   * nassit_num is carried across (added to `employee` by 20260929_employee_nassit_num.*.sql)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scopes group the migration into switchable chunks.
 *
 * `enabled: false` entries are built and tested but not run, so turning documents or audit on
 * later is a flag change rather than new code — which is what the user asked for.
 */
const SCOPES = {
  core:      { label: 'Core (lookups, structure, employees)', enabled: true,  required: true },
  payroll:   { label: 'Payroll configuration and history',    enabled: true },
  medical:   { label: 'Medical claims and limits',            enabled: true },
  documents: { label: 'Documents and uploaded files',         enabled: false },
  audit:     { label: 'Audit log and change history',         enabled: false },
};

/**
 * Tables to migrate, in dependency order. Order matters: a step may only depend on steps above it,
 * because foreign keys are remapped using ids resolved by earlier steps.
 *
 *   source        table in hrmdata_rcb
 *   target        table in the HR-MANAGER schema
 *   scope         which SCOPES entry gates it
 *   naturalKey    the column used to match an existing target row, making re-runs idempotent
 *   dependsOn     steps whose id maps this step needs
 */
const STEPS = [
  // ── Lookups ────────────────────────────────────────────────────────────────
  // Old lookup tables become rows in the single `codelistvalue` table, matched BY LABEL.
  // The old columns hold ids (all 1,280 employees join cleanly), so the mapping is
  // old id -> old label -> new codelistvalue.id.
  { key: 'jobtitles',        source: 'jobtitles',        target: 'codelistvalue',      scope: 'core', naturalKey: 'label', codelist: 'Job Titles' },
  { key: 'employmentstatus', source: 'employmentstatus', target: 'codelistvalue',      scope: 'core', naturalKey: 'label', codelist: 'Employment Status' },
  { key: 'nationality',      source: 'nationality',      target: 'codelistvalue',      scope: 'core', naturalKey: 'label', codelist: 'Nationalities' },

  // ── Company structure ──────────────────────────────────────────────────────
  { key: 'companystructures', source: 'companystructures', target: 'companystructures', scope: 'core', naturalKey: 'comp_code' },
  { key: 'paygrades',         source: 'paygrades',         target: 'paygrades',         scope: 'core', naturalKey: 'name' },
  { key: 'notches',           source: 'notches',           target: 'notches',           scope: 'core', naturalKey: 'name', dependsOn: ['paygrades'] },

  // ── People ─────────────────────────────────────────────────────────────────
  // `employee_id` (staff code) is the ONLY natural key: the target has no legacy-id column.
  { key: 'employees', source: 'employees', target: 'employee', scope: 'core', naturalKey: 'employee_id',
    dependsOn: ['jobtitles', 'employmentstatus', 'nationality', 'companystructures', 'paygrades', 'notches'] },

  // ── Payroll ────────────────────────────────────────────────────────────────
  { key: 'payrollcolumns',   source: 'payrollcolumns',   target: 'payrollcolumns',   scope: 'payroll', naturalKey: 'name' },
  { key: 'payrollruns',      source: 'payroll',          target: 'payrollruns',      scope: 'payroll', naturalKey: 'name' },
  { key: 'payrollemployees', source: 'payrollemployees', target: 'payrollemployees', scope: 'payroll', dependsOn: ['employees'] },
  { key: 'employeesalary',   source: 'employeesalary',   target: 'employeesalary',   scope: 'payroll', dependsOn: ['employees'] },
  { key: 'payrolldata',      source: 'payrolldata',      target: 'payrolldata',      scope: 'payroll',
    dependsOn: ['employees', 'payrollruns', 'payrollcolumns'], large: true },

  // ── Medical ────────────────────────────────────────────────────────────────
  // staffmedical / staffmedical_hist are column-identical old->new; only the employee FK moves.
  { key: 'medicallimit',      source: 'medicallimit',      target: 'medicallimit',      scope: 'medical' },
  { key: 'medicalcondition',  source: 'medicalcondition',  target: 'medicalcondition',  scope: 'medical' },
  { key: 'medicalsymptom',    source: 'medicalsymptom',    target: 'medicalsymptom',    scope: 'medical' },
  { key: 'staffmedical',      source: 'staffmedical',      target: 'staffmedical',      scope: 'medical', dependsOn: ['employees'] },
  { key: 'staffmedical_hist', source: 'staffmedical_hist', target: 'staffmedical_hist', scope: 'medical', dependsOn: ['employees'] },

  // ── Deferred (built, not enabled) ──────────────────────────────────────────
  { key: 'files',               source: 'files',               target: 'files',               scope: 'documents', dependsOn: ['employees'] },
  { key: 'auditlog',            source: 'auditlog',            target: 'auditlog',            scope: 'audit' },
  { key: 'employeedatahistory', source: 'employeedatahistory', target: 'employeedatahistory', scope: 'audit', dependsOn: ['employees'] },
];

/**
 * Tables deliberately NOT migrated: hand-made working copies someone used once for a salary
 * increase or allowance run, left behind in the database. Migrating them would carry stale
 * duplicates into a clean system.
 *
 * Matched by pattern rather than listed one by one, because there are ~90 and more will appear
 * if the legacy system keeps running until go-live. Anything matching is reported in the dry run
 * so a table that IS wanted cannot be dropped silently.
 */
const SCRATCH_PATTERNS = [
  /^mid_month/i, /^cloth/i, /^13/i, /^rent/i, /^lunch/i, /^cars$/i, /^transport/i,
  /^special$/i, /^emp_id$/i, /^emps$/i, /^new_grades$/i, /^account_numbers$/i,
  /^upgrade_/i, /^paygrades_\d/i, /^notches_\d/i, /^displacement/i, /^duty_allowance/i,
  /^live_/i, /_old$/i, /_bak$/i, /_temp$/i, /^temp/i, /^tmp/i, /^utb_migration_log$/i,
  /^employee_bra$/i, /^\d/,           // tables starting with a digit, e.g. 13perm25
];

const isScratchTable = (name) => SCRATCH_PATTERNS.some(re => re.test(String(name)));

/**
 * Normalise the legacy gender values.
 *
 * The legacy column is free text and holds four spellings for two genders — "M" (405),
 * "F" (345), "Male" (338), "Female" (192). Left alone these would create duplicate codelist
 * entries and split every gender-based report in two.
 */
function normaliseGender(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'm' || v === 'male')   return 'Male';
  if (v === 'f' || v === 'female') return 'Female';
  return null;                       // anything else is reported, not guessed at
}

/**
 * Legacy lookup ids that point at nothing, and what they should become.
 *
 * `employees.nationality` uses only three values across 1,280 employees:
 *   200 -> "Sierra Leonean"  (529 employees, resolves correctly)
 *   241 -> NO SUCH ROW       (750 employees)
 *     1 -> "Afghan"          (1 employee, resolves correctly)
 *
 * The old `nationality` table has 198 rows with ids 1-201, so 241 is a dangling reference — most
 * likely a hardcoded value from a bulk import that never matched anything. (That table has been
 * damaged before: ids 195-198 contain JSON fragments such as `{\"type\":\"Separators\"` where
 * country names should be.)
 *
 * The user directed that all 750 be treated as Sierra Leonean. Checked before applying, since
 * this asserts something about 750 real people:
 *   - 745 of the 750 carry country = 'SL'; the other 5 are BLANK, not foreign
 *   - all 750 sit in the 21 domestic RCB branches
 *   - the control group (the 529 known Sierra Leoneans) includes 4 people with country AF/AQ,
 *     which shows `country` records address, not citizenship — so it cannot contradict this
 *
 * No evidence of any foreign national in the group, so the mapping is safe. It lives here as
 * data rather than buried in a query so it stays visible and reversible.
 */
const LEGACY_LOOKUP_FIXES = {
  nationality: {
    // dangling legacy id -> label to resolve against the new Nationalities codelist
    241: 'Sierra Leonean',
  },
};

/**
 * Resolve a legacy lookup id to a label, applying any recorded fix for dangling ids.
 *
 * `lookup` maps legacy id -> label (built from the old lookup table). Returns null when the id is
 * genuinely unknown, so the caller imports null rather than inventing a value.
 */
function resolveLookup(field, legacyId, lookup = {}) {
  const key = String(legacyId ?? '').trim();
  if (!key) return null;
  if (lookup[key] != null) return lookup[key];
  const fix = LEGACY_LOOKUP_FIXES[field]?.[key];
  return fix ?? null;
}

/**
 * Map a legacy employee status to the new lifecycle status.
 * One legacy row has the value "'Active'" complete with quotes, hence the strip.
 */
function normaliseLifecycle(raw) {
  const v = String(raw ?? '').trim().replace(/^'|'$/g, '').toLowerCase();
  if (v === 'active')     return 'ACTIVE';
  if (v === 'terminated') return 'RESIGNED';
  return v ? v.toUpperCase() : null;
}

/**
 * Employee identity is `employee_id`, and nothing else.
 *
 * An earlier version paired records by first+last name and then used "no payroll or medical
 * history" to pick which side was a merge shell. Measuring the data showed that rule was unsound:
 *
 *   - NO UTB-coded employee has ANY payrolldata row (0 of 530) or any medical record (0 of 1,833),
 *     whether Active or Terminated. UTB staff are SET UP for payroll — 294 of 352 active ones are
 *     on the roster with salaries configured — but have never been PAID through this system.
 *   - So "no payroll, no medical" describes every UTB employee, not just duplicates. It had no
 *     discriminating power, and the name match was silently making the whole decision.
 *   - Names collide heavily here: UTB00202 (MOHAMED KAMARA) matched two different people, both
 *     with 1,500+ payroll rows. 76 of the 85 records it would have dropped were ACTIVE staff.
 *
 * All 1,280 employee_id values in the source are unique (after trimming and case-folding), so on
 * this rule there are no duplicates to collapse and every employee imports.
 *
 * Genuine duplicates still exist — the user identified SHERIFF JOHN KAMARA as P2022037 rather than
 * UTB00523 — but nothing in the data identifies them reliably, so they are REPORTED for review
 * rather than dropped. See findPossibleDuplicates in the analyser.
 */
const employeeKey = (e) => {
  const id = String(e?.employee_id ?? '').trim().toUpperCase();
  return id || null;                                  // null = cannot be keyed, so cannot import
};

/** Steps that are actually enabled, in dependency order. */
const activeSteps = (scopes = SCOPES) =>
  STEPS.filter(s => scopes[s.scope]?.enabled);

module.exports = {
  SCOPES,
  STEPS,
  SCRATCH_PATTERNS,
  LEGACY_LOOKUP_FIXES,
  isScratchTable,
  normaliseGender,
  normaliseLifecycle,
  resolveLookup,
  employeeKey,
  activeSteps,
};
