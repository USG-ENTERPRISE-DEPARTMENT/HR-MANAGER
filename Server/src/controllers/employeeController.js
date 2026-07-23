const axios = require('axios');
const { prisma } = require('../helpers/dbQueryHelper');
const { Prisma } = require('@prisma/client'); // Prisma.sql / Prisma.join for portable dynamic SQL
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { logActivity, fromReq } = require('./auditController');
const { getApiConfig } = require('./apiIntegrationController');
const { sendEmployeeLifecycleEmail } = require('../helpers/emailHelper');
const { notifyEmployee, notifyUser, notifyUsersWithPermission, notifyUsersWithRole } = require('../helpers/notificationHelper');
const { upsertSetting } = require('../helpers/settingsHelper');
const { reassignPendingSupervisorWork } = require('../helpers/supervisorHelper');
const pcCodes = require('./pcCodeController');
const { effectiveRequiredFields, effectiveTransferFields } = require('../config/employeeFormFields');
const { tmsg } = require('../helpers/messageStore');

// ─── Lifecycle constants ───────────────────────────────────────────────────────
const LIFECYCLE = {
  PENDING:    'PENDING',
  ACTIVE:     'ACTIVE',
  SUSPENDED:  'SUSPENDED',
  TERMINATED: 'TERMINATED',
  RESIGNED:   'RESIGNED',
};

const APPROVAL = {
  PENDING:  'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const EMPLOYEE_APPROVAL_FLOW_KEY = 'employee_approval_flow';

const EMPLOYEE_CHANGE_LABELS = {
  employee_id: 'Employee ID', firstName: 'First Name', middleName: 'Middle Name', lastName: 'Last Name',
  titleId: 'Title', genderId: 'Gender', nationalityId: 'Nationality', religionId: 'Religion',
  dateOfBirth: 'Date of Birth', place_of_birth: 'Place of Birth', marital_status: 'Marital Status',
  spouse_name: 'Spouse Name', father_name: 'Father Name', mother_name: 'Mother Name', address1: 'Address',
  city: 'City', country: 'Country', mobilePhone: 'Mobile Phone', work_email: 'Work Email',
  personal_email: 'Personal Email', jobTitleId: 'Job Title', employmentStatusId: 'Employment Status',
  staff_level: 'Staff Level', staff_role: 'Staff Role', ssn_num: 'SSN Number', departmentId: 'Department',
  branchId: 'Branch', unitId: 'Unit', outletId: 'Outlet', supervisorId: 'Supervisor', hireDate: 'Hire Date',
  confirmationDate: 'Confirmation Date', nxt_kin_fname: 'Next of Kin Name', nxt_kin_phone: 'Next of Kin Phone',
  nxt_kin_email: 'Next of Kin Email', nxt_kin_address: 'Next of Kin Address', bankAccount: 'Bank Account',
  paygradeId: 'Pay Grade', notcheId: 'Notch', profile_imagebase64: 'Profile Photo',
  nationalIdNumber: 'National ID Number', nationalIdExpiry: 'National ID Expiry', passportNumber: 'Passport Number',
  passportExpiry: 'Passport Expiry', driverLicenseNum: 'Driver License Number', driverLicenseExp: 'Driver License Expiry',
  fit_and_proper: 'Fit and Proper Document', policeClearance: 'Police Clearance', medicalClearance: 'Medical Clearance',
};

const EMPLOYEE_CHANGE_RELATIONS = {
  titleId: 'title', genderId: 'gender', nationalityId: 'nationality', religionId: 'religion',
  jobTitleId: 'jobTitle', employmentStatusId: 'employmentStatus', staff_level: 'staffLevel', staff_role: 'staffRole',
  departmentId: 'department', branchId: 'branch', unitId: 'unit', outletId: 'outlet', supervisorId: 'supervisor',
  paygradeId: 'paygrade', notcheId: 'notch',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const { serialize: serializeBigInt, toBigInt } = require('../helpers/controllerHelpers');

// CodeListValue foreign keys are integers; incoming form values are strings. Coerce to Int
// (blank/invalid -> null).
const clvInt = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/** Read an app-control toggle (Settings → Approvals) from the settings table.
 *  Returns `defaultOn` when the key has never been saved. */
async function readControlSetting(name, defaultOn) {
  const row = await prisma.settings
    .findFirst({ where: { name, category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  return row ? row.value === '1' : defaultOn;
}

/** Load the admin-configured employee-form field config (Settings → Controls → Employee Form).
 *  Returns the parsed `{ key: { visible, required } }` map, or `{}` when never saved. */
async function loadEmployeeFieldConfig() {
  const row = await prisma.settings
    .findFirst({ where: { name: 'employee_form_fields', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  if (!row || !row.value) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}

/** Push employee data to the external HR system and record the result. */
// Map our internal lifecycle status to the external system's `staffStatus` value:
//   SUSPENDED → DEACTIVATED, TERMINATED/RESIGNED → TERMINATED, ACTIVE/PENDING → ACTIVE.
function externalStaffStatus(lifecycle) {
  switch (lifecycle) {
    case LIFECYCLE.SUSPENDED:  return 'DEACTIVATED';
    case LIFECYCLE.TERMINATED:
    case LIFECYCLE.RESIGNED:   return 'TERMINATED';
    case LIFECYCLE.ACTIVE:
    case LIFECYCLE.PENDING:    return 'ACTIVE';
    default:                   return lifecycle || '';
  }
}

async function pushEmployeeToExternalSystem(e) {
  const apiCfg = await getApiConfig();
  const url    = apiCfg.employee_sync_url;
  if (!url) return;
  const id = toBigInt(e.id);
  if (!id) return;

  const fmtDate = d => d ? String(d).substring(0, 10) : '';
  const payload = {
    address1:          e.address1                 || '',
    address2:          '',
    alias:             e.employee_id              || '',
    approvedBy:        '',
    approvedDate:      fmtDate(e.approved_date),
    bankAccountNumber: e.bankAccount              || '',
    bankName:          '',
    branch:            e.branch?.comp_code         || '',
    check:             1,
    costCenter:        '',
    dateAppiont:       fmtDate(e.hireDate),
    dateOfBirth:       fmtDate(e.dateOfBirth),
    department:        e.department?.comp_code     || '',
    doe:               fmtDate(e.hireDate),
    emCode:            e.employee_id              || '',
    emType:            e.employmentStatus?.label  || '',
    employeeID:        e.employee_id              || '',
    employmentStatus:  e.employmentStatus?.label  || '',
    employmentType:    e.staffRole?.label         || '',
    endOfProb:         fmtDate(e.confirmationDate),
    fatherName:        e.father_name              || '',
    firstName:         e.firstName                || '',
    gender:            (e.gender?.label || '').charAt(0).toUpperCase(),
    lastName:          e.lastName                 || '',
    maritalStatus:     e.marital_status           || '',
    middleName:        e.middleName               || '',
    motherName:        e.mother_name              || '',
    nationality:       e.nationality?.label       || '',
    notch:             e.notch                    || '',
    notes:             '',
    phone:             e.mobilePhone              || '',
    phoneCountryCode:  '',
    placeOfBirth:      e.place_of_birth           || '',
    position:          e.jobTitleId               || '',
    postedBy:          e.posted_by                || '',
    proof:             '',
    spouse:            e.spouse_name              || '',
    ssn:               e.ssn_num                  || '',
    staffCat:          e.staffLevel?.label        || '',
    staffGrade:        e.paygradeId               || '',
    staffStatus:       externalStaffStatus(e.lifecycleStatus),
    supervisorID:      e.supervisor?.employee_id  || '',
    unit:              e.unit?.comp_code           || '',
    workEmail:         e.work_email               || '',
  };

  try {
    const apiKey    = apiCfg.employee_sync_api_key      || apiCfg.gl_api_key;
    const apiSecret = apiCfg.employee_sync_api_secret   || apiCfg.gl_api_secret;
    const bearer    = apiCfg.employee_sync_bearer_token || apiCfg.gl_bearer_token;
    const basicUser = apiCfg.employee_sync_basic_user   || apiCfg.gl_basic_user;
    const basicPass = apiCfg.employee_sync_basic_pass   || apiCfg.gl_basic_pass;

    const headers = { 'Content-Type': 'application/json' };
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer}`;
    } else if (basicUser) {
      const creds = Buffer.from(`${basicUser}:${basicPass}`).toString('base64');
      headers['Authorization'] = `Basic ${creds}`;
    } else {
      if (apiKey)    headers['x-api-key']    = apiKey;
      if (apiSecret) headers['x-api-secret'] = apiSecret;
    }
    const r = await axios.post(url, payload, {
      headers,
      timeout: Number(apiCfg.employee_sync_timeout) || 10000,
    });
    console.log('[EmployeeSync] pushed', e.employee_id, '→ status:', r.status, '| response:', JSON.stringify(r.data));
    await prisma.$executeRaw`UPDATE employee SET sync_status='synced', sync_error=NULL WHERE id=${id}`;
    return { success: true, httpStatus: r.status, data: r.data };
  } catch (err) {
    const msg = (err.response?.data ? JSON.stringify(err.response.data) : err.message) || 'Unknown error';
    console.error('[EmployeeSync] failed for', e.employee_id,
      '| http status:', err.response?.status,
      '| response:', JSON.stringify(err.response?.data),
      '| message:', err.message
    );
    await prisma.$executeRaw`UPDATE employee SET sync_status='failed', sync_error=${msg.substring(0, 500)} WHERE id=${id}`;
    return { success: false, httpStatus: err.response?.status, data: err.response?.data, message: err.message };
  }
}

const DEFAULT_EMPLOYEE_ID_PATTERN = 'EP-{YY}-{SEQ4}';
const EMPLOYEE_ID_MAX_LENGTH = 10; // hard cap on staff ID (auto-generated OR manually entered)

/** Read the admin-configured employee-ID structure (Settings → Controls → General).
 *  Returns the stored template, or the default when never saved. */
async function loadEmployeeIdFormat() {
  const row = await prisma.settings
    .findFirst({ where: { name: 'employee_id_format', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  const val = row && typeof row.value === 'string' ? row.value.trim() : '';
  return val || DEFAULT_EMPLOYEE_ID_PATTERN;
}

/** Auto-generate an employee ID by rendering `pattern` against the row's primary key (continuous,
 *  never-reset sequence) and current date. Falls back to the default if the pattern lacks {SEQ}. */
function makeEmployeeId(id, pattern) {
  const tpl = pattern && /\{SEQ\d*\}/i.test(pattern) ? pattern : DEFAULT_EMPLOYEE_ID_PATTERN;
  const now = new Date();
  const seq = String(id);
  const pad = (n) => String(n).padStart(2, '0');
  const out = tpl
    .replace(/\{SEQ(\d+)\}/gi, (_m, n) => seq.padStart(Number(n), '0'))
    .replace(/\{SEQ\}/gi, seq)
    .replace(/\{YYYY\}/gi, String(now.getFullYear()))
    .replace(/\{YY\}/gi, String(now.getFullYear()).slice(-2))
    .replace(/\{MM\}/gi, pad(now.getMonth() + 1))
    .replace(/\{DD\}/gi, pad(now.getDate()));
  return out.slice(0, EMPLOYEE_ID_MAX_LENGTH); // defensive: never exceed the column width
}

/**
 * Batch-resolve code list values and company structures referenced by employees.
 * Returns the same array of employees with extra shaped fields attached.
 */
async function enrichEmployees(employees) {
  // Collect all IDs to fetch
  const clvIds    = new Set();
  const structIds = new Set();
  const supIds    = new Set();
  const pgIds     = new Set();
  const ncIds     = new Set();

  for (const emp of employees) {
    [emp.titleId, emp.genderId, emp.nationalityId, emp.religionId,
     emp.jobTitleId, emp.employmentStatusId, emp.staff_level, emp.staff_role]
      .filter(Boolean).forEach(id => clvIds.add(id));
    [emp.departmentId, emp.branchId, emp.unitId, emp.outletId]
      .filter(Boolean).forEach(id => structIds.add(id));
    if (emp.supervisorId) supIds.add(emp.supervisorId);
    if (emp.paygradeId)   pgIds.add(emp.paygradeId);
    if (emp.notcheId)     ncIds.add(emp.notcheId);
  }

  // Batch fetch code list values
  const clvMap = {};
  if (clvIds.size > 0) {
    const vals = await prisma.codeListValue.findMany({
      where:  { id: { in: [...clvIds] } },
      select: { id: true, label: true, code: true },
    });
    vals.forEach(v => { clvMap[v.id] = v; });
  }

  // Batch fetch company structures
  const structMap = {};
  if (structIds.size > 0) {
    const structs = await prisma.companystructures.findMany({
      where:  { id: { in: [...structIds] } },
      select: { id: true, title: true, type: true, comp_code: true },
    });
    structs.forEach(s => { structMap[s.id.toString()] = serializeBigInt(s); });
  }

  // Batch fetch supervisors
  const supMap = {};
  if (supIds.size > 0) {
    const sups = await prisma.employee.findMany({
      where:  { id: { in: [...supIds] } },
      select: { id: true, firstName: true, lastName: true, employee_id: true },
    });
    sups.forEach(s => { supMap[s.id.toString()] = s; });
  }

  // Batch fetch paygrades
  const pgMap = {};
  if (pgIds.size > 0) {
    const pgs = await prisma.paygrades.findMany({
      where:  { id: { in: [...pgIds] } },
      select: { id: true, name: true },
    });
    pgs.forEach(p => { pgMap[p.id.toString()] = p.name; });
  }

  // Batch fetch notches
  const ncMap = {};
  if (ncIds.size > 0) {
    const ncs = await prisma.notches.findMany({
      where:  { id: { in: [...ncIds] } },
      select: { id: true, name: true },
    });
    ncs.forEach(n => { ncMap[n.id.toString()] = n.name; });
  }

  // Batch fetch each employee's current PC code (open assignment -> pccodes).
  const pcMap = {}; // employeeId(string) -> { id, code, name }
  const empIdList = employees.map(e => e.id).filter(Boolean);
  if (empIdList.length > 0) {
    const openAssigns = await prisma.pccodeassignments.findMany({
      where: { employeeId: { in: empIdList }, endDate: null },
      select: { employeeId: true, pcCodeId: true },
    });
    const pcIds = [...new Set(openAssigns.map(a => a.pcCodeId))];
    const pcRows = pcIds.length
      ? await prisma.pccodes.findMany({ where: { id: { in: pcIds } }, select: { id: true, code: true, name: true } })
      : [];
    const pcById = {};
    pcRows.forEach(c => { pcById[c.id.toString()] = { id: c.id.toString(), code: c.code, name: c.name }; });
    openAssigns.forEach(a => { pcMap[a.employeeId.toString()] = pcById[a.pcCodeId.toString()] ?? null; });
  }

  const mapCLV  = id => id ? (clvMap[id] ?? { id, label: null, code: null }) : null;
  const mapStruct = id => {
    if (!id) return null;
    const key = id.toString();
    return structMap[key] ?? { id: key, title: null };
  };
  const mapSup = id => {
    if (!id) return null;
    const s = supMap[id.toString()];
    return s ? { id: s.id.toString(), name: `${s.firstName} ${s.lastName}`, employee_id: s.employee_id } : null;
  };

  return employees.map(emp => ({
    ...serializeBigInt(emp),
    title:            mapCLV(emp.titleId),
    gender:           mapCLV(emp.genderId),
    nationality:      mapCLV(emp.nationalityId),
    religion:         mapCLV(emp.religionId),
    jobTitle:         mapCLV(emp.jobTitleId),
    employmentStatus: mapCLV(emp.employmentStatusId),
    staffLevel:       mapCLV(emp.staff_level),
    staffRole:        mapCLV(emp.staff_role),
    department:       mapStruct(emp.departmentId),
    branch:           mapStruct(emp.branchId),
    unit:             mapStruct(emp.unitId),
    outlet:           mapStruct(emp.outletId),
    supervisor:       mapSup(emp.supervisorId),
    paygrade:         emp.paygradeId ? (pgMap[emp.paygradeId.toString()] ?? null) : null,
    notch:            emp.notcheId   ? (ncMap[emp.notcheId.toString()]   ?? null) : null,
    pcCode:           pcMap[emp.id.toString()] ?? null,
  }));
}

async function readEmployeeApprovalFlow() {
  const row = await prisma.settings.findFirst({
    where: { name: EMPLOYEE_APPROVAL_FLOW_KEY, category: 'app_controls' }, select: { value: true },
  }).catch(() => null);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(stage => stage && String(stage.name || '').trim()
      && ['role', 'user'].includes(stage.approverType)
      && String(stage.approverId ?? '').trim()).map(stage => ({
        name: String(stage.name).trim(),
        approverType: stage.approverType,
        approverId: String(stage.approverId),
        approverLabel: stage.approverLabel == null ? null : String(stage.approverLabel),
      }));
  } catch { return []; }
}

function employeeApproverMatches(req, stage) {
  const type = stage.approver_type ?? stage.approverType;
  const id = String(stage.approver_id ?? stage.approverId ?? '');
  const label = String(stage.approver_label ?? stage.approverLabel ?? '');
  if (type === 'user') return String(req.user?.id ?? '') === id;
  const roles = (req.user?.roles || []).map(String);
  return type === 'role' && (roles.includes(id) || (label && roles.includes(label)));
}

const hasEmployeeApprovalPermission = req => req.user?.permissions?.includes('approve_employees');

function notifyEmployeeApprovalStage(stage, req, employee, requestType) {
  const label = requestType === 'Employee Details Change' ? 'Employee detail changes' : 'New employee';
  const payload = {
    message: `${label} for ${employee.firstName} ${employee.lastName} await your approval (${stage.stage_name ?? stage.name})`,
    action: 'CentralApproval', type: 'employees', fromUser: req.user?.id, employee: employee.id,
  };
  const type = stage.approver_type ?? stage.approverType;
  const id = stage.approver_id ?? stage.approverId;
  if (type === 'user') notifyUser(id, payload);
  else notifyUsersWithRole(id, payload, req.user?.id, stage.approver_label ?? stage.approverLabel);
}

async function snapshotEmployeeApprovalStages(employeeId, requestType, req, employee) {
  const flow = await readEmployeeApprovalFlow();
  await prisma.$transaction(async tx => {
    await tx.employeeapprovalstages.deleteMany({ where: { employee_id: employeeId } });
    if (flow.length) await tx.employeeapprovalstages.createMany({ data: flow.map((stage, index) => ({
      employee_id: employeeId,
      request_type: requestType,
      stage_order: index,
      stage_name: stage.name,
      approver_type: stage.approverType,
      approver_id: stage.approverId,
      approver_label: stage.approverLabel,
      status: 'Pending',
    })) });
  });
  if (flow.length) notifyEmployeeApprovalStage(flow[0], req, employee, requestType);
  return flow;
}

async function attachEmployeeApprovalStages(employees, req) {
  const pendingIds = employees.filter(employee => employee.approvalStatus === APPROVAL.PENDING && !employee.pending_lifecycle_action)
    .map(employee => toBigInt(employee.id)).filter(Boolean);
  const stages = pendingIds.length ? await prisma.employeeapprovalstages.findMany({
    where: { employee_id: { in: pendingIds } }, orderBy: [{ employee_id: 'asc' }, { stage_order: 'asc' }],
  }).catch(() => []) : [];
  const selfApprovalAllowed = await readControlSetting('approval_employee_self', false);
  const grouped = stages.reduce((map, stage) => {
    const key = String(stage.employee_id);
    map.set(key, [...(map.get(key) || []), serializeBigInt(stage)]);
    return map;
  }, new Map());
  return employees.map(employee => {
    const approvalStages = grouped.get(String(employee.id)) || [];
    const currentApprovalStage = approvalStages.find(stage => stage.status === 'Pending') || null;
    const hasAuthority = employee.pending_lifecycle_action
      ? hasEmployeeApprovalPermission(req)
      : currentApprovalStage ? employeeApproverMatches(req, currentApprovalStage) : hasEmployeeApprovalPermission(req);
    const isOriginator = String(employee.posted_by ?? '') === String(req.user?.id ?? '');
    const canCurrentUserApprove = hasAuthority && (selfApprovalAllowed || !isOriginator);
    return { ...employee, approvalStages, currentApprovalStage, canCurrentUserApprove };
  });
}

/** Reload and enrich an employee before sending the complete, current record to the sync API.
 *  Exported for workflows such as Employee Transfers that change the employee outside this controller. */
async function syncEmployeeToExternalSystem(employeeId) {
  const id = toBigInt(employeeId);
  if (!id) return { success: false, message: 'Invalid employee ID' };
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) return { success: false, message: 'Employee not found' };
  const [enriched] = await enrichEmployees([employee]);
  return pushEmployeeToExternalSystem(enriched);
}

async function loadEmployeeTransferFields() {
  const row = await prisma.settings
    .findFirst({ where: { name: 'employee_transfer_fields', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  let saved = {};
  try { saved = row?.value ? JSON.parse(row.value) : {}; } catch { saved = {}; }
  return effectiveTransferFields(saved);
}

function comparableEmployeeValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

function displayEmployeeChangeValue(employee, field, rawValue, version = 'current') {
  if (field === 'profile_imagebase64') {
    if (!rawValue) return version === 'proposed' ? 'Photo removed' : 'No photo';
    return version === 'proposed' ? 'New photo uploaded' : 'Existing photo';
  }

  const relation = EMPLOYEE_CHANGE_RELATIONS[field];
  if (relation) {
    const resolved = employee?.[relation];
    if (resolved && typeof resolved === 'object') {
      return String(resolved.label ?? resolved.title ?? resolved.name ?? resolved.employee_id ?? rawValue ?? '—');
    }
    if (resolved != null && resolved !== '') return String(resolved);
  }

  if (rawValue == null || rawValue === '') return '—';
  if (rawValue instanceof Date || /(?:Date|Expiry|Exp)$/.test(field)) {
    const date = rawValue instanceof Date ? rawValue : new Date(rawValue);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return String(rawValue).slice(0, 500);
}

/** Attach coalesced old → new comparisons to pending employee records. */
async function attachPendingEmployeeChanges(employees) {
  const pendingIds = employees
    .filter(emp => emp.approvalStatus === APPROVAL.PENDING)
    .map(emp => toBigInt(emp.id))
    .filter(Boolean);
  if (!pendingIds.length) return employees;

  const history = await prisma.employeedatahistory.findMany({
    where: { employee: { in: pendingIds }, type: 'Pending Employee Update' },
    orderBy: [{ created: 'asc' }, { id: 'asc' }],
  }).catch(() => []);

  const grouped = new Map();
  for (const row of history) {
    const employeeId = String(row.employee);
    if (!grouped.has(employeeId)) grouped.set(employeeId, new Map());
    const changes = grouped.get(employeeId);
    const existing = changes.get(row.field);
    if (existing) {
      existing.newValue = row.new_value ?? '—';
    } else {
      changes.set(row.field, {
        field: row.field,
        label: row.description || EMPLOYEE_CHANGE_LABELS[row.field] || row.field,
        oldValue: row.old_value ?? '—',
        newValue: row.new_value ?? '—',
      });
    }
  }

  return employees.map(emp => {
    const changes = [...(grouped.get(String(emp.id))?.values() ?? [])]
      .filter(change => change.oldValue !== change.newValue);
    return { ...emp, pendingChanges: changes };
  });
}

// ─── Controllers ──────────────────────────────────────────────────────────────

// GET /employees
const getAllEmployees = asyncHandler(async (req, res) => {
  const { search, lifecycle, approval } = req.query;

  const where = {};
  if (lifecycle) where.lifecycleStatus = lifecycle;
  if (approval)  where.approvalStatus  = approval;
  if (search) {
    where.OR = [
      { firstName:   { contains: search } },
      { lastName:    { contains: search } },
      { employee_id: { contains: search } },
      { email:       { contains: search } },
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const enriched = await enrichEmployees(employees);
  const withPendingChanges = await attachPendingEmployeeChanges(enriched);
  respond.ok(res, 'Employees retrieved', await attachEmployeeApprovalStages(withPendingChanges, req));
});

// GET /employees/approvals — only requests the current user is allowed to action.
const getEmployeeApprovals = asyncHandler(async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: { approvalStatus: APPROVAL.PENDING }, orderBy: { createdAt: 'desc' },
  });
  const enriched = await enrichEmployees(employees);
  const withChanges = await attachPendingEmployeeChanges(enriched);
  const withStages = await attachEmployeeApprovalStages(withChanges, req);
  respond.ok(res, 'Employee approvals retrieved', withStages.filter(employee => employee.canCurrentUserApprove));
});

// GET /employees/approval-flow — one shared flow for new employees and detail changes.
const getEmployeeApprovalFlow = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Employee approval flow retrieved', await readEmployeeApprovalFlow());
});

// PUT /employees/approval-flow
const saveEmployeeApprovalFlow = asyncHandler(async (req, res) => {
  const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const clean = [];
  for (const stage of stages) {
    const name = String(stage?.name || '').trim();
    if (!name) return respond.badReq(res, 'Every stage needs a name');
    if (!['role', 'user'].includes(stage.approverType)) return respond.badReq(res, `Stage "${name}" has an invalid approver type`);
    if (!String(stage.approverId ?? '').trim()) return respond.badReq(res, `Stage "${name}" needs an approver`);
    clean.push({
      name, approverType: stage.approverType, approverId: String(stage.approverId),
      approverLabel: stage.approverLabel == null || stage.approverLabel === '' ? null : String(stage.approverLabel),
    });
  }
  await upsertSetting(null, EMPLOYEE_APPROVAL_FLOW_KEY, 'app_controls', JSON.stringify(clean));
  logActivity({ module: 'Employees', action: 'Approval flow updated', details: { stages: clean }, ...fromReq(req) });
  respond.ok(res, 'Employee approval flow saved', clean);
});

// GET /employees/active  — lightweight list for supervisor dropdowns
const getActiveEmployees = asyncHandler(async (req, res) => {
  const { search } = req.query;

  const where = { lifecycleStatus: LIFECYCLE.ACTIVE, approvalStatus: APPROVAL.APPROVED };
  if (search) {
    where.OR = [
      { firstName:   { contains: search } },
      { lastName:    { contains: search } },
      { employee_id: { contains: search } },
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    select: {
      id: true, employee_id: true, firstName: true, lastName: true,
      jobTitleId: true, departmentId: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 2000, // searchable picker filters client-side — must return the full active roster
  });

  // Resolve job titles
  const jtIds = [...new Set(employees.map(e => e.jobTitleId).filter(Boolean))];
  const jtMap = {};
  if (jtIds.length > 0) {
    const jts = await prisma.codeListValue.findMany({
      where: { id: { in: jtIds } }, select: { id: true, label: true },
    });
    jts.forEach(j => { jtMap[j.id] = j.label; });
  }

  // Resolve departments
  const deptIds = [...new Set(employees.map(e => e.departmentId).filter(Boolean))];
  const deptMap = {};
  if (deptIds.length > 0) {
    const depts = await prisma.companystructures.findMany({
      where: { id: { in: deptIds } }, select: { id: true, title: true },
    });
    depts.forEach(d => { deptMap[d.id.toString()] = d.title; });
  }

  respond.ok(res, 'Active employees retrieved', employees.map(e => ({
    id:          e.id.toString(),
    employee_id: e.employee_id,
    name:        `${e.firstName} ${e.lastName}`.trim(),
    jobTitle:    e.jobTitleId   ? (jtMap[e.jobTitleId]              ?? null) : null,
    department:  e.departmentId ? (deptMap[e.departmentId.toString()] ?? null) : null,
  })));
});

// GET /employees/organogram — staff hierarchy via supervisor links (lightweight, no sensitive fields)
const getStaffOrganogram = asyncHandler(async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: { lifecycleStatus: LIFECYCLE.ACTIVE, approvalStatus: APPROVAL.APPROVED },
    select: {
      id: true, employee_id: true, firstName: true, lastName: true,
      jobTitleId: true, departmentId: true, supervisorId: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  const jtIds = [...new Set(employees.map(e => e.jobTitleId).filter(Boolean))];
  const jtMap = {};
  if (jtIds.length > 0) {
    const jts = await prisma.codeListValue.findMany({
      where: { id: { in: jtIds } }, select: { id: true, label: true },
    });
    jts.forEach(j => { jtMap[j.id] = j.label; });
  }

  const deptIds = [...new Set(employees.map(e => e.departmentId).filter(Boolean))];
  const deptMap = {};
  if (deptIds.length > 0) {
    const depts = await prisma.companystructures.findMany({
      where: { id: { in: deptIds } }, select: { id: true, title: true },
    });
    depts.forEach(d => { deptMap[d.id.toString()] = d.title; });
  }

  respond.ok(res, 'Staff organogram retrieved', employees.map(e => ({
    id:            e.id.toString(),
    employee_id:   e.employee_id,
    name:          `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
    job_title:     e.jobTitleId   ? (jtMap[e.jobTitleId]                ?? null) : null,
    department:    e.departmentId ? (deptMap[e.departmentId.toString()] ?? null) : null,
    supervisor_id: e.supervisorId ? e.supervisorId.toString() : null,
  })));
});

// GET /employees/:id
const getEmployeeById = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return respond.notFound(res, 'Employee not found');

  const [enriched] = await enrichEmployees([emp]);
  const [withPendingChanges] = await attachPendingEmployeeChanges([enriched]);
  const [withApprovalStages] = await attachEmployeeApprovalStages([withPendingChanges], req);
  respond.ok(res, 'Employee retrieved', withApprovalStages);
});

// POST /employees
const createEmployee = asyncHandler(async (req, res) => {
  const d = req.body;

  // Required fields are driven by the admin Controls config (Settings → Controls → Employee Form),
  // with the locked core (first/last name, work email) always enforced. Keeps the API in sync with
  // the form instead of hardcoding the list here.
  const fieldCfg = await loadEmployeeFieldConfig();
  for (const f of effectiveRequiredFields(fieldCfg)) {
    const v = d[f.key];
    if (v == null || String(v).trim() === '') return respond.badReq(res, tmsg('employee.field_required', { field: f.label }));
  }

  // A manually-entered staff ID must respect the hard length cap (auto-generated IDs are bounded
  // by makeEmployeeId). Checked before the insert so no orphan row is created on rejection.
  if (d.employee_id?.trim() && d.employee_id.trim().length > EMPLOYEE_ID_MAX_LENGTH) {
    return respond.badReq(res, tmsg('employee.id_too_long', { max: EMPLOYEE_ID_MAX_LENGTH }));
  }

  const workEmail = d.work_email.trim().toLowerCase();

  // Email uniqueness (work_email is stored in both email and work_email columns)
  const dupe = await prisma.employee.findFirst({
    where: { OR: [{ email: workEmail }, { work_email: workEmail }] },
  });
  if (dupe) return respond.conflict(res, 'An employee with this work email already exists');

  if (d.personal_email?.trim()) {
    const pdupe = await prisma.employee.findUnique({ where: { personal_email: d.personal_email.trim().toLowerCase() } });
    if (pdupe) return respond.conflict(res, 'An employee with this personal email already exists');
  }

  // CodeListValue ids are integers now — coerce the incoming (string) values to Int so both the
  // validation below and the create write use numbers. Blank/invalid -> null.
  const CLV_FIELDS = ['titleId', 'genderId', 'nationalityId', 'religionId', 'jobTitleId', 'employmentStatusId', 'staff_level', 'staff_role'];
  for (const f of CLV_FIELDS) {
    const n = Number(d[f]);
    d[f] = (d[f] === '' || d[f] == null || !Number.isInteger(n)) ? null : n;
  }

  // Validate code list IDs
  const clvIds = CLV_FIELDS.map(f => d[f]).filter(v => v != null);
  if (clvIds.length > 0) {
    const found = await prisma.codeListValue.findMany({
      where: { id: { in: clvIds }, isActive: true }, select: { id: true },
    });
    const foundSet = new Set(found.map(v => v.id));
    const missing = clvIds.filter(id => !foundSet.has(id));
    if (missing.length > 0) return respond.badReq(res, 'One or more selected options are invalid or inactive');
  }

  // RM/RO tag is required and constrains PC-code reporting links.
  const rmRoType = d.rmRoType ? String(d.rmRoType).trim().toUpperCase() : null;
  if (rmRoType !== 'RM' && rmRoType !== 'RO') {
    return respond.badReq(res, 'RM/RO tag is required (must be "RM" or "RO")');
  }

  // Resolve the PC code to assign: an existing vacant code, or an inline new one that reports
  // to the supervisor's currently-held code. Validated here (before the insert) so we don't
  // create an employee we then can't place.
  const supervisorId = toBigInt(d.supervisorId) || null;
  let pcCodeIdToAssign = null;   // existing code id (string) chosen by the user
  let inlinePcCodeName = null;   // name for an inline new code
  if (d.pcCodeId) {
    const chosen = await prisma.pccodes.findUnique({ where: { id: toBigInt(d.pcCodeId) } });
    if (!chosen) return respond.badReq(res, 'Selected PC code not found');
    const open = await prisma.pccodeassignments.findFirst({ where: { pcCodeId: chosen.id, endDate: null } });
    if (open) return respond.badReq(res, 'Selected PC code is already held by another employee');
    pcCodeIdToAssign = chosen.id;
  } else if (d.pcCode?.name?.trim()) {
    inlinePcCodeName = d.pcCode.name.trim();
    // Inline code reports to the supervisor's held code; that holder must be an RM.
    if (!supervisorId) return respond.badReq(res, 'A supervisor is required to create a PC code inline');
    const supOpen = await prisma.pccodeassignments.findFirst({ where: { employeeId: supervisorId, endDate: null } });
    if (!supOpen) return respond.badReq(res, 'The selected supervisor does not hold a PC code');
    const supTag = await pcCodes.currentHolderTag(supOpen.pcCodeId);
    if (supTag !== 'RM') return respond.badReq(res, 'A position can only report to an RM-held position');
  }

  const postedBy = toBigInt(req.user?.id);

  // When the employee approval workflow is OFF, new records skip the queue and go
  // straight to Approved/Active (and are synced below); when ON they start Pending.
  const approvalRequired = await readControlSetting('approval_employee', true);

  // Step 1 — create without large blob fields to avoid max_allowed_packet issues
  const employee = await prisma.employee.create({
    data: {
      // Personal
      titleId:            d.titleId            || null,
      firstName:          d.firstName.trim(),
      middleName:         d.middleName?.trim() || null,
      lastName:           d.lastName.trim(),
      genderId:           d.genderId           || null,
      dateOfBirth:        d.dateOfBirth        ? new Date(d.dateOfBirth) : null,
      place_of_birth:     d.place_of_birth?.trim()   || null,
      nationalityId:      d.nationalityId      || null,
      religionId:         d.religionId         || null,
      marital_status:     d.marital_status     || null,
      spouse_name:        d.spouse_name?.trim()       || null,
      father_name:        d.father_name?.trim()       || null,
      mother_name:        d.mother_name?.trim()       || null,
      address1:           d.address1?.trim()   || null,
      city:               d.city?.trim()       || null,
      country:            d.country?.trim()    || null,
      // Contact
      email:              workEmail,
      work_email:         workEmail,
      personal_email:     d.personal_email?.trim().toLowerCase() || null,
      mobilePhone:        d.mobilePhone?.trim() || null,
      // Employment
      jobTitleId:         d.jobTitleId,
      employmentStatusId: d.employmentStatusId,
      staff_level:        d.staff_level        || null,
      staff_role:         d.staff_role         || null,
      rmRoType:           rmRoType,
      ssn_num:            d.ssn_num?.trim()    || null,
      departmentId:       toBigInt(d.departmentId),
      branchId:           toBigInt(d.branchId),
      unitId:             toBigInt(d.unitId)        || null,
      outletId:           toBigInt(d.outletId)      || null,
      supervisorId:       toBigInt(d.supervisorId)  || null,
      hireDate:           d.hireDate           ? new Date(d.hireDate)           : null,
      confirmationDate:   d.confirmationDate   ? new Date(d.confirmationDate)   : null,
      // Next of Kin
      nxt_kin_fname:      d.nxt_kin_fname?.trim()   || null,
      nxt_kin_phone:      d.nxt_kin_phone?.trim()   || null,
      nxt_kin_email:      d.nxt_kin_email?.trim()   || null,
      nxt_kin_address:    d.nxt_kin_address?.trim() || null,
      // Financial
      bankAccount:        d.bankAccount?.trim()     || null,
      paygradeId:         toBigInt(d.paygradeId)   || null,
      notcheId:           toBigInt(d.notcheId)     || null,
      // Documents (identity only — no blobs)
      nationalIdNumber:   d.nationalIdNumber?.trim()  || null,
      nationalIdExpiry:   d.nationalIdExpiry  ? new Date(d.nationalIdExpiry)  : null,
      passportNumber:     d.passportNumber?.trim()    || null,
      passportExpiry:     d.passportExpiry    ? new Date(d.passportExpiry)    : null,
      driverLicenseNum:   d.driverLicenseNum?.trim()  || null,
      driverLicenseExp:   d.driverLicenseExp  ? new Date(d.driverLicenseExp)  : null,
      // System
      posted_by:          postedBy,
      approvalStatus:     approvalRequired ? APPROVAL.PENDING : APPROVAL.APPROVED,
      lifecycleStatus:    approvalRequired ? LIFECYCLE.PENDING : LIFECYCLE.ACTIVE,
      approved_by:        approvalRequired ? null : postedBy,
      approved_date:      approvalRequired ? null : new Date(),
      status:             '1',
    },
  });

  // Step 2 — set employee_id + document filenames (short references, not blobs)
  const idFormat = await loadEmployeeIdFormat();
  const employeeId = d.employee_id?.trim() || makeEmployeeId(employee.id, idFormat);
  await prisma.employee.update({
    where: { id: employee.id },
    data: {
      employee_id:      employeeId,
      fit_and_proper:   d.fit_and_proper   || null,
      policeClearance:  d.policeClearance  || null,
      medicalClearance: d.medicalClearance || null,
    },
  });

  // Step 3 — PC-code placement. On any failure, roll back the employee we just created
  // (this function isn't wrapped in a single $transaction, so we compensate explicitly).
  try {
    if (inlinePcCodeName) {
      const supOpen = await prisma.pccodeassignments.findFirst({ where: { employeeId: supervisorId, endDate: null } });
      const { code } = await pcCodes.generateChildCode(supOpen.pcCodeId);
      const newCode = await prisma.pccodes.create({
        data: { code, name: inlinePcCodeName, reportsToId: supOpen.pcCodeId, isActive: true },
      });
      await pcCodes.assignEmployeeToCode(newCode.id, employee.id);
    } else if (pcCodeIdToAssign) {
      await pcCodes.assignEmployeeToCode(pcCodeIdToAssign, employee.id);
    }
  } catch (e) {
    await prisma.pccodeassignments.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    return respond.badReq(res, `Employee not created — PC code assignment failed: ${e.message}`);
  }

  const refreshed = await prisma.employee.findUnique({ where: { id: employee.id } });
  const [enriched] = await enrichEmployees([refreshed]);
  logActivity({ module: 'Employees', action: 'create', entityId: String(employee.id), entityName: `${d.firstName} ${d.lastName}`, ...fromReq(req) });

  if (approvalRequired) {
    const flow = await snapshotEmployeeApprovalStages(employee.id, 'New Employee', req, refreshed);
    if (!flow.length) notifyUsersWithPermission('approve_employees', {
      message: `New employee ${d.firstName} ${d.lastName} awaits approval`,
      action: 'CentralApproval', type: 'employees', fromUser: req.user?.id, employee: employee.id,
    }, req.user?.id);
  }

  // Approval workflow off → push to the external system immediately.
  if (!approvalRequired) {
    const syncResult = await pushEmployeeToExternalSystem(enriched);
    return res.status(201).json({ status: '201', message: 'Employee created, approved and synced', data: enriched, syncResult });
  }
  respond.created(res, 'Employee created successfully. Awaiting approval.', enriched);
});

// PUT /employees/:id
const updateEmployee = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'Employee not found');

  if ([LIFECYCLE.TERMINATED, LIFECYCLE.RESIGNED].includes(existing.lifecycleStatus))
    return respond.badReq(res, 'Cannot edit a terminated or resigned employee');

  const d = req.body;
  const updateData = { updatedAt: new Date() };

  // Personal
  if ('firstName'          in d) updateData.firstName          = d.firstName?.trim()          || existing.firstName;
  if ('middleName'         in d) updateData.middleName         = d.middleName?.trim()         || null;
  if ('lastName'           in d) updateData.lastName           = d.lastName?.trim()           || existing.lastName;
  if ('titleId'            in d) updateData.titleId            = clvInt(d.titleId);
  if ('genderId'           in d) updateData.genderId           = clvInt(d.genderId);
  if ('nationalityId'      in d) updateData.nationalityId      = clvInt(d.nationalityId);
  if ('religionId'         in d) updateData.religionId         = clvInt(d.religionId);
  if ('dateOfBirth'        in d) updateData.dateOfBirth        = d.dateOfBirth ? new Date(d.dateOfBirth) : null;
  if ('place_of_birth'     in d) updateData.place_of_birth     = d.place_of_birth?.trim()     || null;
  if ('marital_status'     in d) updateData.marital_status     = d.marital_status             || null;
  if ('spouse_name'        in d) updateData.spouse_name        = d.spouse_name?.trim()        || null;
  if ('father_name'        in d) updateData.father_name        = d.father_name?.trim()        || null;
  if ('mother_name'        in d) updateData.mother_name        = d.mother_name?.trim()        || null;
  if ('address1'           in d) updateData.address1           = d.address1?.trim()           || null;
  if ('city'               in d) updateData.city               = d.city?.trim()               || null;
  if ('country'            in d) updateData.country            = d.country?.trim()            || null;
  if ('mobilePhone'        in d) updateData.mobilePhone        = d.mobilePhone?.trim()        || null;
  // Employment ID (only update when explicitly provided and non-empty)
  if ('employee_id' in d && d.employee_id?.trim()) {
    const empId = d.employee_id.trim();
    if (empId.length > EMPLOYEE_ID_MAX_LENGTH) return respond.badReq(res, tmsg('employee.id_too_long', { max: EMPLOYEE_ID_MAX_LENGTH }));
    if (empId !== existing.employee_id) {
      const dupe = await prisma.employee.findFirst({ where: { employee_id: empId, NOT: { id } } });
      if (dupe) return respond.conflict(res, 'Employee ID is already in use by another employee');
    }
    updateData.employee_id = empId;
  }
  // Employment
  if ('jobTitleId'         in d) updateData.jobTitleId         = clvInt(d.jobTitleId);
  if ('employmentStatusId' in d) updateData.employmentStatusId = clvInt(d.employmentStatusId);
  if ('staff_level'        in d) updateData.staff_level        = clvInt(d.staff_level);
  if ('staff_role'         in d) updateData.staff_role         = clvInt(d.staff_role);
  if ('ssn_num'            in d) updateData.ssn_num            = d.ssn_num?.trim()            || null;
  if ('departmentId'       in d) updateData.departmentId       = toBigInt(d.departmentId);
  if ('branchId'           in d) updateData.branchId           = toBigInt(d.branchId);
  if ('unitId'             in d) updateData.unitId             = toBigInt(d.unitId);
  if ('outletId'           in d) updateData.outletId           = toBigInt(d.outletId);
  if ('supervisorId'       in d) updateData.supervisorId       = toBigInt(d.supervisorId);
  if ('hireDate'           in d) updateData.hireDate           = d.hireDate         ? new Date(d.hireDate)         : null;
  if ('confirmationDate'   in d) updateData.confirmationDate   = d.confirmationDate ? new Date(d.confirmationDate) : null;
  // Next of Kin
  if ('nxt_kin_fname'      in d) updateData.nxt_kin_fname      = d.nxt_kin_fname?.trim()      || null;
  if ('nxt_kin_phone'      in d) updateData.nxt_kin_phone      = d.nxt_kin_phone?.trim()      || null;
  if ('nxt_kin_email'      in d) updateData.nxt_kin_email      = d.nxt_kin_email?.trim()      || null;
  if ('nxt_kin_address'    in d) updateData.nxt_kin_address    = d.nxt_kin_address?.trim()    || null;
  // Financial
  if ('bankAccount'            in d) updateData.bankAccount        = d.bankAccount?.trim()           || null;
  if ('paygradeId'             in d) updateData.paygradeId         = toBigInt(d.paygradeId)          || null;
  if ('notcheId'               in d) updateData.notcheId           = toBigInt(d.notcheId)            || null;
  // Profile photo
  if ('profile_imagebase64'    in d) updateData.profile_imagebase64 = d.profile_imagebase64          || null;
  // Documents
  if ('nationalIdNumber'   in d) updateData.nationalIdNumber   = d.nationalIdNumber?.trim()  || null;
  if ('nationalIdExpiry'   in d) updateData.nationalIdExpiry   = d.nationalIdExpiry  ? new Date(d.nationalIdExpiry)  : null;
  if ('passportNumber'     in d) updateData.passportNumber     = d.passportNumber?.trim()    || null;
  if ('passportExpiry'     in d) updateData.passportExpiry     = d.passportExpiry    ? new Date(d.passportExpiry)    : null;
  if ('driverLicenseNum'   in d) updateData.driverLicenseNum   = d.driverLicenseNum?.trim()  || null;
  if ('driverLicenseExp'   in d) updateData.driverLicenseExp   = d.driverLicenseExp  ? new Date(d.driverLicenseExp)  : null;
  if ('fit_and_proper'     in d) updateData.fit_and_proper     = d.fit_and_proper               || null;
  if ('policeClearance'    in d) updateData.policeClearance    = d.policeClearance              || null;
  if ('medicalClearance'   in d) updateData.medicalClearance   = d.medicalClearance             || null;

  // Work email update (keeps email column in sync for login)
  if ('work_email' in d && d.work_email?.trim()) {
    const we = d.work_email.trim().toLowerCase();
    if (we !== existing.work_email) {
      const dupe = await prisma.employee.findFirst({ where: { OR: [{ email: we }, { work_email: we }], NOT: { id } } });
      if (dupe) return respond.conflict(res, 'Work email already in use by another employee');
    }
    updateData.email      = we;
    updateData.work_email = we;
  }

  if ('personal_email' in d) {
    const pe = d.personal_email?.trim().toLowerCase() || null;
    // Compare case-insensitively (emails match case-insensitively in the DB) and exclude THIS
    // employee, so re-submitting the record's own personal email never self-collides.
    if (pe && pe !== (existing.personal_email || '').toLowerCase()) {
      const dupe = await prisma.employee.findFirst({ where: { personal_email: pe, NOT: { id } } });
      if (dupe) return respond.conflict(res, 'Personal email already in use by another employee');
    }
    updateData.personal_email = pe;
  }

  // For approved, active employees, fields classified in Control Setup as transfer fields cannot be
  // changed through the general employee editor. Compare values (instead of merely checking payload
  // presence) because the edit form may submit unchanged fields alongside the personal-detail changes.
  //
  // The edit form always submits these fields, and when a lookup value could not be resolved to load
  // (e.g. a supervisor outside the enriched batch) it comes back empty. An empty incoming value is not
  // a real edit — it means "leave as-is", not "clear it" — so treating it as a change produced a false
  // "must be changed through Employee Transfers" error on ordinary personal-detail edits. We therefore
  // ignore empty incoming values here; genuinely clearing a transfer field is itself a transfer action.
  if (existing.approvalStatus === APPROVAL.APPROVED && existing.lifecycleStatus === LIFECYCLE.ACTIVE) {
    const transferFields = await loadEmployeeTransferFields();

    // Drop empty incoming transfer-field values so they neither trip the guard below nor overwrite
    // the stored value: an empty value here means the form couldn't resolve it on load (e.g. a
    // supervisor outside the enriched batch), not an intent to clear it.
    for (const field of transferFields) {
      if (Object.prototype.hasOwnProperty.call(updateData, field.key)
        && comparableEmployeeValue(updateData[field.key]) === '') {
        delete updateData[field.key];
      }
    }

    const attempted = transferFields.filter((field) =>
      Object.prototype.hasOwnProperty.call(updateData, field.key)
      && comparableEmployeeValue(existing[field.key]) !== comparableEmployeeValue(updateData[field.key])
    );
    if (attempted.length) {
      return respond.badReq(res, `${attempted.map((field) => field.label).join(', ')} must be changed through Employee Transfers`);
    }
  }

  // Editing approval is governed by its own control, 'approval_employee_update':
  //  • ON  → the edit is sent back through approval before it syncs (just like creating an employee).
  //  • OFF → the employee keeps its current status and the edit syncs immediately.
  // When the control has never been set it follows the master employee-approval workflow, so existing
  // behaviour is preserved until an admin chooses.
  const masterApproval = await readControlSetting('approval_employee', true);
  const updateNeedsApproval = await readControlSetting('approval_employee_update', masterApproval);
  updateData.actionReason = null;
  if (updateNeedsApproval) {
    updateData.approvalStatus  = APPROVAL.PENDING;
    updateData.lifecycleStatus = LIFECYCLE.PENDING;
  }
  // else: leave approvalStatus / lifecycleStatus untouched (keep the employee's current status).

  // Capture a human-readable old → proposed comparison before overwriting the record. The existing
  // employeedatahistory table keeps this portable across MySQL/PostgreSQL without a schema change.
  let pendingHistoryRows = [];
  if (updateNeedsApproval) {
    const changedFields = Object.keys(EMPLOYEE_CHANGE_LABELS).filter(field =>
      Object.prototype.hasOwnProperty.call(updateData, field) &&
      comparableEmployeeValue(existing[field]) !== comparableEmployeeValue(updateData[field])
    );
    if (changedFields.length) {
      const proposed = { ...existing, ...updateData };
      const [oldDisplay, newDisplay] = await enrichEmployees([existing, proposed]);
      const now = new Date();
      pendingHistoryRows = changedFields.map(field => ({
        type: 'Pending Employee Update',
        employee: id,
        field,
        old_value: displayEmployeeChangeValue(oldDisplay, field, existing[field], 'previous').slice(0, 500),
        new_value: displayEmployeeChangeValue(newDisplay, field, updateData[field], 'proposed').slice(0, 500),
        description: EMPLOYEE_CHANGE_LABELS[field],
        user: toBigInt(req.user?.id),
        updated: now,
        created: now,
      }));
    }
  }

  const mutations = [
    prisma.employee.update({ where: { id }, data: updateData }),
    prisma.$executeRaw`UPDATE employee SET sync_status=NULL, sync_error=NULL WHERE id=${id}`,
  ];
  if (pendingHistoryRows.length) {
    mutations.push(prisma.employeedatahistory.createMany({ data: pendingHistoryRows }));
  }
  await prisma.$transaction(mutations);

  // If the supervisor changed, move any pending supervisor-routed work to the new supervisor so
  // nothing stays stuck with the old one. Centralised in supervisorHelper (live queues like leave,
  // training and attendance re-route automatically; only stored snapshots are handled there).
  // Only when supervisorId actually made it into the write (empty/unresolved values are dropped above
  // for approved-active employees, so this won't fire on ordinary personal-detail edits).
  if (Object.prototype.hasOwnProperty.call(updateData, 'supervisorId')) {
    const oldSup = existing.supervisorId != null ? String(existing.supervisorId) : null;
    const newSup = updateData.supervisorId != null ? String(updateData.supervisorId) : null;
    if (oldSup !== newSup) await reassignPendingSupervisorWork(id, updateData.supervisorId ?? null);
  }

  const refreshed = await prisma.employee.findUnique({ where: { id } });
  const [enriched] = await enrichEmployees([refreshed]);
  logActivity({ module: 'Employees', action: 'update', entityId: String(id), entityName: `${existing.firstName} ${existing.lastName}`, ...fromReq(req) });

  if (updateNeedsApproval) {
    const flow = await snapshotEmployeeApprovalStages(id, 'Employee Details Change', req, refreshed);
    if (!flow.length) await notifyUsersWithPermission('approve_employees', {
      message: `Updated employee ${existing.firstName} ${existing.lastName} awaits approval`,
      action: 'CentralApproval', type: 'employees', fromUser: req.user?.id, employee: id,
    }, req.user?.id);
  }

  // Edit approval off → push the updated record to the external system immediately.
  if (!updateNeedsApproval) {
    const syncResult = await pushEmployeeToExternalSystem(enriched);
    return res.status(200).json({ status: '200', message: 'Employee updated and synced', data: enriched, syncResult });
  }
  respond.ok(res, 'Employee updated', enriched);
});

// PUT /employees/:id/approve
const approveEmployee = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return respond.notFound(res, 'Employee not found');
  if (emp.approvalStatus !== APPROVAL.PENDING)
    return respond.badReq(res, tmsg('employee.already_status', { status: emp.approvalStatus.toLowerCase() }));

  // Lifecycle requests keep their existing permission-based approval route. The configured
  // employee flow applies only to new employee records and employee detail changes.
  if (emp.pending_lifecycle_action && !hasEmployeeApprovalPermission(req))
    return respond.forbidden(res, 'You do not have permission to approve employee lifecycle requests');

  // Self-approval guard: the originator may approve their own record only when the
  // "Allow Self-Approval" control is on (defaults off).
  if (String(emp.posted_by ?? '') === String(req.user?.id ?? '')) {
    const selfApprovalAllowed = await readControlSetting('approval_employee_self', false);
    if (!selfApprovalAllowed)
      return respond.forbidden(res, 'Self-approval is disabled — a different approver must review this employee');
  }

  const approvedBy = toBigInt(req.user?.id);

  // Pending lifecycle action (suspend / resign / terminate) — apply it
  if (emp.pending_lifecycle_action) {
    const action = emp.pending_lifecycle_action;
    await prisma.employee.update({
      where: { id },
      data: {
        lifecycleStatus:          action,
        pending_lifecycle_action: null,
        approvalStatus:           APPROVAL.APPROVED,
        status:                   [LIFECYCLE.TERMINATED, LIFECYCLE.RESIGNED].includes(action) ? '0' : '1',
        approved_date:            new Date(),
        approved_by:              approvedBy,
        updatedAt:                new Date(),
      },
    });

    // A terminated/resigned employee must not keep occupying a PC-code seat — vacate it so the
    // position becomes available. (Suspension keeps the seat; the person may be reinstated.)
    if ([LIFECYCLE.TERMINATED, LIFECYCLE.RESIGNED].includes(action)) {
      const freed = await pcCodes.vacateEmployeeAssignments(id);
      if (freed > 0) logActivity({ module: 'PcCode', action: 'auto-vacate', entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, details: { reason: action.toLowerCase() }, ...fromReq(req) });
    }
    const refreshed = await prisma.employee.findUnique({ where: { id } });
    const [enriched] = await enrichEmployees([refreshed]);
    logActivity({ module: 'Employees', action: action.toLowerCase(), entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, ...fromReq(req) });
    notifyEmployee(id, { message: `Your employment status has been updated to ${action.charAt(0) + action.slice(1).toLowerCase()}`, action: 'PersonalInfo', type: 'employees', fromUser: req.user?.id });
    const empEmail = emp.work_email || emp.email;
    sendEmployeeLifecycleEmail({
      to: empEmail,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      action,
      reason: emp.actionReason,
      effectiveDate: action === LIFECYCLE.RESIGNED && emp.termination_date
        ? new Date(emp.termination_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : null,
    }).catch(e => console.error('[LifecycleEmail]', e.message));
    // Sync the status change to the external system (DEACTIVATED for suspend, TERMINATED for
    // terminate/resign — mapped in pushEmployeeToExternalSystem).
    await pushEmployeeToExternalSystem(enriched);
    return respond.ok(res, tmsg('employee.action_approved', { action: action.charAt(0) + action.slice(1).toLowerCase() }), enriched);
  }

  // Validate before consuming an approval stage. If required data is missing, the assigned
  // approver can retry the same stage after the record is corrected.
  const approvalCfg = await loadEmployeeFieldConfig();
  const missing = [];
  for (const f of effectiveRequiredFields(approvalCfg)) {
    const val = f.key === 'work_email' ? (emp.work_email || emp.email) : emp[f.key];
    if (val == null || String(val).trim() === '') missing.push(f.label);
  }
  if (missing.length > 0) {
    return respond.badReq(res, tmsg('employee.approve_missing_fields', { fields: missing.join(', ') }));
  }

  const stages = await prisma.employeeapprovalstages.findMany({
    where: { employee_id: id }, orderBy: { stage_order: 'asc' },
  });
  const pendingStages = stages.filter(stage => stage.status === 'Pending');
  if (pendingStages.length) {
    const current = pendingStages[0];
    if (!employeeApproverMatches(req, current))
      return respond.forbidden(res, `Only ${current.approver_label || 'the assigned approver'} can approve this stage`);
    await prisma.employeeapprovalstages.update({
      where: { id: current.id },
      data: {
        status: 'Approved', acted_by: approvedBy, acted_at: new Date(),
        comment: req.body?.comment == null || req.body.comment === '' ? null : String(req.body.comment).slice(0, 500),
      },
    });
    if (pendingStages.length > 1) {
      notifyEmployeeApprovalStage(pendingStages[1], req, emp, current.request_type);
      logActivity({ module: 'Employees', action: `Approved stage: ${current.stage_name}`, entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, ...fromReq(req) });
      const [enriched] = await enrichEmployees([emp]);
      const [withChanges] = await attachPendingEmployeeChanges([enriched]);
      const [withStages] = await attachEmployeeApprovalStages([withChanges], req);
      return respond.ok(res, `Stage "${current.stage_name}" approved; awaiting the next stage`, withStages);
    }
  } else if (!hasEmployeeApprovalPermission(req)) {
    return respond.forbidden(res, stages.length
      ? 'The configured approval stages are already complete; an employee approver must finalize this request'
      : 'You do not have permission to approve employees');
  }

  // Standard new-employee approval — validate required fields against the same admin config
  // used at creation (Settings → Controls → Employee Form), so approval never demands a field
  // that was made optional/hidden there.
  await prisma.employee.update({
    where: { id },
    data:  {
      approvalStatus:  APPROVAL.APPROVED,
      lifecycleStatus: LIFECYCLE.ACTIVE,
      approved_date:   new Date(),
      approved_by:     approvedBy,
      updatedAt:       new Date(),
    },
  });
  await prisma.employeedatahistory.updateMany({
    where: { employee: id, type: 'Pending Employee Update' },
    data: { type: 'Approved Employee Update', updated: new Date() },
  });

  const refreshed = await prisma.employee.findUnique({ where: { id } });
  const [enriched] = await enrichEmployees([refreshed]);
  logActivity({ module: 'Employees', action: 'approve', entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, ...fromReq(req) });
  notifyEmployee(id, { message: 'Your employee profile has been approved', action: 'PersonalInfo', type: 'employees', fromUser: req.user?.id });
  const syncResult = await pushEmployeeToExternalSystem(enriched);
  res.status(200).json({ status: '200', message: 'Employee approved and is now active', data: enriched, syncResult });
});

// PUT /employees/:id/status  — suspend | terminate | reinstate
const changeEmployeeStatus = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  const { status, reason } = req.body;
  const validStatuses = [LIFECYCLE.ACTIVE, LIFECYCLE.SUSPENDED, LIFECYCLE.TERMINATED];
  if (!validStatuses.includes(status))
    return respond.badReq(res, tmsg('employee.invalid_status', { statuses: validStatuses.join(', ') }));

  if ([LIFECYCLE.SUSPENDED, LIFECYCLE.TERMINATED].includes(status) && !reason?.trim())
    return respond.badReq(res, tmsg('employee.status_reason_required', { status }));

  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return respond.notFound(res, 'Employee not found');

  if (emp.approvalStatus !== APPROVAL.APPROVED)
    return respond.badReq(res, 'Cannot change status of an unapproved employee');
  if (emp.lifecycleStatus === LIFECYCLE.TERMINATED)
    return respond.badReq(res, 'Terminated employees cannot be modified');
  if (emp.lifecycleStatus === LIFECYCLE.RESIGNED)
    return respond.badReq(res, 'Resigned employees cannot be modified');

  // ACTIVE = reinstate — no approval needed
  if (status === LIFECYCLE.ACTIVE) {
    await prisma.employee.update({
      where: { id },
      data: { lifecycleStatus: LIFECYCLE.ACTIVE, actionReason: null, status: '1', updatedAt: new Date() },
    });
    const refreshed = await prisma.employee.findUnique({ where: { id } });
    const [enriched] = await enrichEmployees([refreshed]);
    logActivity({ module: 'Employees', action: 'reinstate', entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, ...fromReq(req) });
    notifyEmployee(id, { message: 'You have been reinstated to active status', action: 'PersonalInfo', type: 'employees', fromUser: req.user?.id });
    sendEmployeeLifecycleEmail({
      to: emp.work_email || emp.email,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      action: 'REINSTATED',
    }).catch(e => console.error('[LifecycleEmail]', e.message));
    // Re-sync the full record to the external system with staffStatus = ACTIVE.
    await pushEmployeeToExternalSystem(enriched);
    return respond.ok(res, 'Employee reinstated', enriched);
  }

  // SUSPENDED / TERMINATED — queue for approval
  await prisma.employee.update({
    where: { id },
    data: {
      approvalStatus:           APPROVAL.PENDING,
      pending_lifecycle_action: status,
      actionReason:             reason?.trim() || null,
      updatedAt:                new Date(),
    },
  });

  const refreshed = await prisma.employee.findUnique({ where: { id } });
  const [enriched] = await enrichEmployees([refreshed]);
  logActivity({ module: 'Employees', action: `${status.toLowerCase()}_pending`, entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, details: { reason }, ...fromReq(req) });
  notifyUsersWithPermission('approve_employees', {
    message: `${emp.firstName} ${emp.lastName}: ${status.toLowerCase()} request awaits approval`,
    action: 'CentralApproval', type: 'employees', fromUser: req.user?.id, employee: id,
  }, req.user?.id);
  respond.ok(res, tmsg('employee.request_submitted', { status: status.charAt(0) + status.slice(1).toLowerCase() }), enriched);
});

// POST /employees/:id/resign
const initiateResignation = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  const { reason, effectiveDate, resignationLetter } = req.body;

  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return respond.notFound(res, 'Employee not found');
  if (emp.approvalStatus !== APPROVAL.APPROVED)
    return respond.badReq(res, 'Employee is not yet approved');
  if (emp.lifecycleStatus !== LIFECYCLE.ACTIVE)
    return respond.badReq(res, 'Only active employees can initiate resignation');

  await prisma.employee.update({
    where: { id },
    data: {
      approvalStatus:           APPROVAL.PENDING,
      pending_lifecycle_action: LIFECYCLE.RESIGNED,
      actionReason:             reason?.trim() || null,
      termination_date:         effectiveDate ? new Date(effectiveDate) : null,
      resignation_letter:       resignationLetter || null,
      updatedAt:                new Date(),
    },
  });

  const refreshed = await prisma.employee.findUnique({ where: { id } });
  const [enriched] = await enrichEmployees([refreshed]);
  logActivity({ module: 'Employees', action: 'resign_pending', entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, details: { reason, effectiveDate }, ...fromReq(req) });
  notifyUsersWithPermission('approve_employees', {
    message: `${emp.firstName} ${emp.lastName} submitted a resignation awaiting approval`,
    action: 'CentralApproval', type: 'employees', fromUser: req.user?.id, employee: id,
  }, req.user?.id);
  respond.ok(res, 'Resignation submitted for approval', enriched);
});

// GET /paygrades
const getAllPaygrades = asyncHandler(async (req, res) => {
  const rows = await prisma.paygrades.findMany({
    select: { id: true, name: true, currency: true, min_salary: true, max_salary: true },
    orderBy: { name: 'asc' },
  });
  respond.ok(res, 'Paygrades retrieved', rows.map(r => ({ ...serializeBigInt(r) })));
});

// GET /notches
const getAllNotches = asyncHandler(async (req, res) => {
  const rows = await prisma.notches.findMany({
    select: { id: true, name: true, paygradeId: true, currency: true, amount: true },
    orderBy: { name: 'asc' },
  });
  respond.ok(res, 'Notches retrieved', rows.map(r => ({
    ...serializeBigInt(r),
    amount: r.amount ? r.amount.toString() : null,
  })));
});

// PUT /employees/:id/reject
const rejectEmployee = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return respond.notFound(res, 'Employee not found');
  if (emp.approvalStatus !== APPROVAL.PENDING)
    return respond.badReq(res, tmsg('employee.already_status', { status: emp.approvalStatus.toLowerCase() }));

  const { reason } = req.body;

  // Lifecycle action rejection — restore APPROVED, clear the pending action
  if (emp.pending_lifecycle_action) {
    if (!hasEmployeeApprovalPermission(req))
      return respond.forbidden(res, 'You do not have permission to reject employee lifecycle requests');
    await prisma.employee.update({
      where: { id },
      data: {
        approvalStatus:           APPROVAL.APPROVED,
        pending_lifecycle_action: null,
        actionReason:             null,
        updatedAt:                new Date(),
      },
    });
    logActivity({ module: 'Employees', action: 'reject_lifecycle', entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, details: { action: emp.pending_lifecycle_action, reason }, ...fromReq(req) });
    return respond.ok(res, tmsg('employee.request_rejected', { action: emp.pending_lifecycle_action.toLowerCase() }));
  }

  const stages = await prisma.employeeapprovalstages.findMany({
    where: { employee_id: id }, orderBy: { stage_order: 'asc' },
  });
  const currentStage = stages.find(stage => stage.status === 'Pending');
  if (currentStage && !employeeApproverMatches(req, currentStage))
    return respond.forbidden(res, `Only ${currentStage.approver_label || 'the assigned approver'} can reject this stage`);
  if (!currentStage && !hasEmployeeApprovalPermission(req))
    return respond.forbidden(res, stages.length
      ? 'The configured approval stages are already complete; an employee approver must finalize this request'
      : 'You do not have permission to reject employees');

  if (currentStage) {
    await prisma.$transaction([
      prisma.employeeapprovalstages.update({ where: { id: currentStage.id }, data: {
        status: 'Rejected', acted_by: toBigInt(req.user?.id), acted_at: new Date(),
        comment: reason?.trim() ? reason.trim().slice(0, 500) : null,
      } }),
      prisma.employeeapprovalstages.updateMany({
        where: { employee_id: id, status: 'Pending', NOT: { id: currentStage.id } }, data: { status: 'Skipped' },
      }),
    ]);
  }

  // Standard new-employee rejection
  await prisma.employee.update({
    where: { id },
    data:  {
      approvalStatus: APPROVAL.REJECTED,
      actionReason:   reason?.trim() || null,
      updatedAt:      new Date(),
    },
  });
  await prisma.employeedatahistory.updateMany({
    where: { employee: id, type: 'Pending Employee Update' },
    data: { type: 'Rejected Employee Update', updated: new Date() },
  });

  logActivity({ module: 'Employees', action: 'reject', entityId: String(id), entityName: `${emp.firstName} ${emp.lastName}`, details: { reason: reason || null }, ...fromReq(req) });
  notifyEmployee(id, { message: `Your employee profile was rejected${reason ? ': ' + reason : ''}`, action: 'PersonalInfo', type: 'employees', fromUser: req.user?.id });
  respond.ok(res, 'Employee application rejected');
});

// GET /employees/:id/activity — paginated audit log for a specific employee
const getEmployeeActivity = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { search, action, page = '1', limit = '25' } = req.query;

  const conds = [Prisma.sql`module = 'Employees'`, Prisma.sql`entity_id = ${id}`];
  if (action) conds.push(Prisma.sql`action = ${String(action)}`);
  if (search) {
    const like = `%${search}%`;
    conds.push(Prisma.sql`(action LIKE ${like} OR user_name LIKE ${like} OR details LIKE ${like})`);
  }
  const where    = Prisma.join(conds, ' AND ');
  const pageNum  = Math.max(1, parseInt(page));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
  const offset   = (pageNum - 1) * pageSize;

  const [{ total }] = await prisma.$queryRaw`SELECT COUNT(*) AS total FROM auditlogs WHERE ${where}`;
  const logs = await prisma.$queryRaw`
    SELECT id, action, user_id, user_name, ip_address, details, created_at
     FROM auditlogs WHERE ${where} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`;

  const serialize = v => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date)     return v.toISOString();
    if (Array.isArray(v))      return v.map(serialize);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = serialize(val);
      return out;
    }
    return v;
  };

  respond.ok(res, 'Employee activity retrieved', {
    logs: serialize(logs),
    total: Number(total),
    page: pageNum,
    limit: pageSize,
  });
});

// GET /employees/:id/position-impact — checks active supervisory/approver roles before suspend/terminate
const getEmployeePositionImpact = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  // Employees this person supervises (active/pending only — not already gone)
  const reportees = await prisma.employee.findMany({
    where: {
      supervisorId: id,
      lifecycleStatus: { notIn: [LIFECYCLE.TERMINATED, LIFECYCLE.RESIGNED] },
    },
    select: { id: true, firstName: true, lastName: true, employee_id: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  // Check if linked user is a leave-allowance threshold approver
  let isThresholdApprover = false;
  const linkedUser = await prisma.users.findFirst({
    where: { OR: [{ employeeId: id }, { employee: id }] },
    select: { id: true },
  });
  if (linkedUser) {
    const row = await prisma.settings
      .findFirst({ where: { category: 'leave_threshold_approval', name: 'threshold_approvers' }, select: { value: true } })
      .catch(() => null);
    if (row?.value) {
      try {
        const approvers = JSON.parse(row.value);
        isThresholdApprover = approvers.includes(String(linkedUser.id));
      } catch {}
    }
  }

  respond.ok(res, 'Position impact retrieved', {
    reportees: reportees.map(r => serializeBigInt({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), employee_id: r.employee_id })),
    isThresholdApprover,
  });
});

// POST /employees/:id/sync — manual retry of external system push
const syncEmployee = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee ID');

  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp) return respond.notFound(res, 'Employee not found');
  if (emp.approvalStatus !== APPROVAL.APPROVED)
    return respond.badReq(res, 'Only approved employees can be synced');

  await syncEmployeeToExternalSystem(id);

  const updated = await prisma.employee.findUnique({ where: { id } });
  if (updated?.sync_status === 'failed')
    return respond.badReq(res, tmsg('employee.sync_failed', { error: updated.sync_error || 'Unknown error' }));

  respond.ok(res, 'Employee synced successfully');
});

module.exports = {
  getAllEmployees,
  getEmployeeApprovals,
  getEmployeeApprovalFlow,
  saveEmployeeApprovalFlow,
  getActiveEmployees,
  getStaffOrganogram,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  approveEmployee,
  rejectEmployee,
  changeEmployeeStatus,
  initiateResignation,
  getAllPaygrades,
  getAllNotches,
  syncEmployee,
  syncEmployeeToExternalSystem,
  getEmployeePositionImpact,
  getEmployeeActivity,
};
