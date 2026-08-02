// Postgres returns raw-query result columns in lower-case (it folds unquoted identifiers), whereas
// the schema's columns are @map'd to lower-case but the app reads the camelCase *field* names
// (e.g. `row.employeeId`, `row.firstName`). MySQL returns the camelCase names as written, so the
// app works there directly. To keep raw-query results identical across providers, we rename any
// lower-cased DB column key back to its camelCase Prisma field name.
//
// The map is derived from Prisma's DMMF (`field.dbName` = the @map target, `field.name` = the
// camelCase field), so it stays in sync with the schema automatically. On MySQL this is a no-op
// (keys already match the field names, so nothing is renamed).
const { Prisma } = require('@prisma/client');

// camelCase SQL aliases used in raw queries (e.g. `SELECT COALESCE(MAX(id),0)+1 AS nextId`). Postgres
// lower-cases these in the result set; the code reads the camelCase form. They are not Prisma fields so
// the DMMF map below can't cover them — list them explicitly. Keyed by the lower-cased form.
const COMPUTED_ALIASES = {
  nextid: 'nextId',
  nextitemid: 'nextItemId',
  nextorder: 'nextOrder',
  totalenabled: 'totalEnabled',
  componenttypename: 'componentTypeName',
};

// ── camelCase COLUMNS ────────────────────────────────────────────────────────
// The DMMF map below only produces an entry where the LOADED schema carries an @map. That works when
// running schema.postgres.prisma, but under schema.prisma (MySQL) these fields have no @map — the
// MySQL columns really are camelCase (`SHOW COLUMNS` confirms `bankAccount`), so nothing to map.
//
// The result: with the MySQL client loaded, the DMMF map is empty for every camelCase column, and a
// raw query written as `SELECT e.bankAccount` returns the key `bankAccount` on MySQL but `bankaccount`
// on Postgres (which folds unquoted identifiers). Code reading `row.bankAccount` then silently gets
// `undefined` on Postgres — no error, just a null. That has real consequences: payroll GL posting
// would credit every employee's net pay to the fallback account instead of their bank account, and
// medical GL postings would skip entirely for want of a creditAccount.
//
// So the case-only mappings are listed here explicitly rather than left to the DMMF, making raw-query
// results identical on both providers regardless of which schema generated the client.
//
// Generated from the @map directives in schema.postgres.prisma, keeping only maps that differ purely
// by case, and excluding:
//   • keys that are a literal field name somewhere (`name`, `branch`, `tax`, `id`, …) — renaming
//     those would hijack legitimately lower-case columns;
//   • keys two models map to different camelCase names (`employee_id`, `staff_id`, `amount`);
//   • legacy import-table fields whose Prisma name is ALL-CAPS (`CAR`, `SSN`, …) — their columns are
//     already lower-case and no code reads them from raw SQL.
// Regenerate the same way if the Postgres schema gains new case-only @maps.
const COLUMN_ALIASES = {
  actionreason:            'actionReason',
  approvalstatus:          'approvalStatus',
  bankaccount:             'bankAccount',
  branchid:                'branchId',
  closingdate:             'closingDate',
  codelistid:              'codeListId',
  companyname:             'companyName',
  componenttype:           'componentType',
  confirmationdate:        'confirmationDate',
  createdat:               'createdAt',
  customernumber:          'customerNumber',
  datatype:                'dataType',
  dateofbirth:             'dateOfBirth',
  deliverylocation:        'deliveryLocation',
  departmentid:            'departmentId',
  driverlicenseexp:        'driverLicenseExp',
  driverlicensenum:        'driverLicenseNum',
  duedate:                 'dueDate',
  educationlevel:          'educationLevel',
  emailsent:               'emailSent',
  employeeid:              'employeeId',
  employementtype:         'employementType',
  employmentstatusid:      'employmentStatusId',
  enddate:                 'endDate',
  expectedsalary:          'expectedSalary',
  experiencelevel:         'experienceLevel',
  facebookprofileid:       'facebookProfileId',
  facebookprofilelink:     'facebookProfileLink',
  firstname:               'firstName',
  fromemployee:            'fromEmployee',
  fromuser:                'fromUser',
  genderid:                'genderId',
  generatedcvfile:         'generatedCVFile',
  googleprofileid:         'googleProfileId',
  googleprofilelink:       'googleProfileLink',
  hiredate:                'hireDate',
  hiringmanager:           'hiringManager',
  hiringstage:             'hiringStage',
  htmlcvdata:              'htmlCVData',
  iattstate:               'iAttState',
  isactive:                'isActive',
  isinvalid:               'isInvalid',
  iverifymethod:           'iVerifyMethod',
  jobfunction:             'jobFunction',
  jobid:                   'jobId',
  jobtitleid:              'jobTitleId',
  lastname:                'lastName',
  lifecyclestatus:         'lifecycleStatus',
  linkedindata:            'linkedInData',
  linkedinprofileid:       'linkedInProfileId',
  linkedinprofilelink:     'linkedInProfileLink',
  linkedinurl:             'linkedInUrl',
  mapid:                   'mapId',
  medicalclearance:        'medicalClearance',
  middlename:              'middleName',
  mobilephone:             'mobilePhone',
  nationalidexpiry:        'nationalIdExpiry',
  nationalidnumber:        'nationalIdNumber',
  nationalityid:           'nationalityId',
  notcheid:                'notcheId',
  objecttype:              'objectType',
  outletid:                'outletId',
  paramorder:              'paramOrder',
  passportexpiry:          'passportExpiry',
  passportnumber:          'passportNumber',
  paygradeid:              'paygradeId',
  payrollcolumn:           'payrollColumn',
  paysliptemplate:         'payslipTemplate',
  pccodeid:                'pcCodeId',
  policeclearance:         'policeClearance',
  positionreason:          'positionReason',
  postalcode:              'postalCode',
  postedby:                'postedBy',
  preferedcountries:       'preferedCountries',
  preferedjobtype:         'preferedJobtype',
  preferedpositions:       'preferedPositions',
  profileimage:            'profileImage',
  rangeamounts:            'rangeAmounts',
  referredbyemail:         'referredByEmail',
  religionid:              'religionId',
  reportstoid:             'reportsToId',
  rmrotype:                'rmRoType',
  salarymax:               'salaryMax',
  salarymin:               'salaryMin',
  scheduleupdated:         'scheduleUpdated',
  shortdescription:        'shortDescription',
  showhiringmanager:       'showHiringManager',
  sortorder:               'sortOrder',
  startdate:               'startDate',
  supervisorid:            'supervisorId',
  tabletype:               'tableType',
  textmapped:              'textMapped',
  textorig:                'textOrig',
  titleid:                 'titleId',
  toemail:                 'toEmail',
  totalmonthsofexperience: 'totalMonthsOfExperience',
  totalyearsofexperience:  'totalYearsOfExperience',
  touser:                  'toUser',
  trainingsession:         'trainingSession',
  twitterprofileid:        'twitterProfileId',
  twitterprofilelink:      'twitterProfileLink',
  unitid:                  'unitId',
  updatedat:               'updatedAt',
  userid:                  'userId',
};

const ALIAS_SUPPLEMENT = { ...COMPUTED_ALIASES, ...COLUMN_ALIASES };

let _map = null;
function dbToField() {
  if (_map) return _map;
  _map = Object.create(null);
  Object.assign(_map, ALIAS_SUPPLEMENT);
  try {
    // Any column name that some model uses as a LITERAL field name (e.g. `name`, `status`,
    // `staff_id`) is a legitimate lower-case column — a raw query may select it directly, so it
    // must never be renamed. Collect those to exclude ambiguous/colliding mappings.
    const literalNames = new Set();
    for (const model of Prisma.dmmf.datamodel.models)
      for (const f of model.fields)
        if (f.kind === 'scalar') literalNames.add(f.name);

    for (const model of Prisma.dmmf.datamodel.models) {
      for (const f of model.fields) {
        // Map only scalar columns @map'd to a purely case-differing name (camelCase → lower),
        // and only when the lower-cased column isn't a real field name anywhere (avoids hijacking
        // generic columns like `name`/`status` that legacy PascalCase models @map).
        if (f.kind === 'scalar' && f.dbName && f.dbName.toLowerCase() !== f.name) {
          const db = f.dbName.toLowerCase();
          if (!literalNames.has(f.dbName) && !literalNames.has(db)) _map[db] = f.name;
        }
      }
    }
  } catch { /* dmmf unavailable — leave map empty (no renaming) */ }
  return _map;
}

// Return the camelCase field name for a (possibly lower-cased) result key, or the key unchanged.
function fieldFor(key) {
  const m = dbToField();
  return m[key] || m[String(key).toLowerCase()] || key;
}

module.exports = { fieldFor, dbToField };
