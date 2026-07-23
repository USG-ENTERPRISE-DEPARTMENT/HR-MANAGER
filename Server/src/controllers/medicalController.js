const { prisma }    = require('../helpers/dbQueryHelper');
const { Prisma }    = require('@prisma/client'); // Prisma.raw for the date-cutoff SQL fragments
const asyncHandler  = require('../middleware/asyncHandler');
const respond       = require('../helpers/respondHelper');
const { tmsg }      = require('../helpers/messageStore');
const { postToGL } = require('../helpers/glHelper');
const { getApiConfig } = require('../controllers/apiIntegrationController');
const { toBigInt, s } = require('../helpers/controllerHelpers');
const { notifyEmployee, notifyUser, notifyUsersWithPermission, notifyUsersWithRole } = require('../helpers/notificationHelper');
const { logActivity, fromReq } = require('./auditController');
const { upsertSetting: upsertSettingShared } = require('../helpers/settingsHelper');

// In-app bell for a medical claim status change.
// 'Pending Approval' → approvers; 'Approved'/'Rejected' → the claim's employee.
function notifyMedicalStatus(req, employeeId, status, reason, label) {
  if (status === 'Pending Approval') {
    notifyUsersWithPermission('approve_medical', {
      message: `A ${label} awaits your approval`,
      action: 'AdminMedical', type: 'medical', fromUser: req.user?.id, employee: employeeId,
    }, req.user?.id);
  } else if ((status === 'Approved' || status === 'Rejected') && employeeId) {
    notifyEmployee(employeeId, {
      message: `Your ${label} was ${status.toLowerCase()}${status === 'Rejected' && reason ? ': ' + reason : ''}`,
      action: 'PersonalMedical', type: 'medical', fromUser: req.user?.id,
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInt(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// Medical costs are DECIMAL(..., 2) in both PostgreSQL and MySQL. Some raw-query
// drivers expose those decimals through a JS floating-point conversion (for example
// 56 can become 56.00000000000001), so normalise every returned cost field to the
// database's two-decimal scale before it reaches the API response.
function hasMedicalGlFailure(record) {
  if (!record || record.document_ref) return false;
  try {
    const log = typeof record.payment_log === 'string'
      ? JSON.parse(record.payment_log || '{}')
      : (record.payment_log ?? {});
    return !!log && typeof log === 'object' && Object.prototype.hasOwnProperty.call(log, 'error');
  } catch {
    return false;
  }
}

function serializeMedical(value) {
  const serialized = s(value);
  const roundCosts = current => {
    if (Array.isArray(current)) return current.map(roundCosts);
    if (current === null || typeof current !== 'object') return current;
    for (const [key, child] of Object.entries(current)) {
      if (key === 'cost' && child !== null && child !== '') {
        const amount = Number(child);
        current[key] = Number.isFinite(amount) ? Math.round(amount * 100) / 100 : child;
      } else {
        current[key] = roundCosts(child);
      }
    }
    // Approval and GL posting are separate concerns. The legacy medical status
    // enums do not contain GL Failed, so derive the effective API status from
    // the persisted error log instead.
    if (hasMedicalGlFailure(current)) current.status = 'GL Failed';
    return current;
  };
  return roundCosts(serialized);
}

// The medical status enums store spaced DB values but Prisma's client values are underscored
// (@map). Reads/writes done via raw SQL use the spaced value (Postgres auto-casts a string literal
// to the enum); builder writes need the client value, so map the two spaced ones across.
const MED_STATUS_TO_CLIENT = { 'Pending Approval': 'Pending_Approval', 'GL Failed': 'GL_Failed', 'Cancellation Requested': 'Cancellation_Requested' };
const toMedEnum = v => (v == null ? v : (MED_STATUS_TO_CLIENT[v] ?? v));

/** Read an app-control toggle from the settings table. Returns `defaultOn` when never saved. */
async function readControlSetting(name, defaultOn) {
  const row = await prisma.settings
    .findFirst({ where: { name, category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  return row ? row.value === '1' : defaultOn;
}

/** Whether medical claims post to the GL / pay out. Off ⇒ record-only (skip all GL postings). */
const medicalPaymentsEnabled = () => readControlSetting('medical_payments_enabled', true);

// Build userId → display name map (joins users → employee for full name)
async function userMap(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number).filter(n => !isNaN(n) && n > 0))];
  if (!unique.length) return {};
  try {
    const users = await prisma.users.findMany({
      where: { id: { in: unique.map(BigInt) } },
      select: { id: true, username: true, employeeId: true },
    });
    const empIds = [...new Set(users.map(u => u.employeeId).filter(Boolean))];
    const emps = empIds.length
      ? await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameById = new Map(emps.map(e => [String(e.id), `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim()]));
    return Object.fromEntries(users.map(u => {
      const name = (u.employeeId != null && nameById.get(String(u.employeeId))) || '';
      return [String(u.id), name.trim() || u.username || `User ${u.id}`];
    }));
  } catch { return {}; }
}

// Build id → { id, name, employee_id } map for a list of BigInt ids
async function empMap(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return {};
  const emps = await prisma.employee.findMany({
    where: { id: { in: unique.map(BigInt) } },
    select: { id: true, firstName: true, lastName: true, employee_id: true },
  });
  return Object.fromEntries(emps.map(e => [e.id.toString(), {
    id:          e.id.toString(),
    name:        `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
    employee_id: e.employee_id,
  }]));
}

// Build codeListValue id → label map
async function clvMap(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number).filter(n => !isNaN(n) && n > 0))];
  if (!unique.length) return {};
  try {
    const rows = await prisma.codeListValue.findMany({
      where: { id: { in: unique.map(String) } }, select: { id: true, label: true },
    });
    return Object.fromEntries(rows.map(r => [String(r.id), r.label]));
  } catch { return {}; }
}



// ── WHT settings helpers ──────────────────────────────────────────────────────

const WHT_HOSPITAL_KEY = 'wht_rate_hospital';
const WHT_PHARMACY_KEY = 'wht_rate_pharmacy';
const SETTINGS_CAT     = 'medical';

async function upsertSetting(name, value, category) {
  await upsertSettingShared(null, name, category, String(value));
}

async function getWhtRate(hospitalType) {
  const key = (hospitalType ?? '').toLowerCase() === 'pharmacy' ? WHT_PHARMACY_KEY : WHT_HOSPITAL_KEY;
  const row = await prisma.settings
    .findFirst({ where: { name: key, category: SETTINGS_CAT }, select: { value: true } })
    .catch(() => null);
  return parseFloat(row?.value ?? 0);
}

// ── Year-end utilization reset point ────────────────────────────────────────────
// Utilization is recomputed (never stored). When HR starts a new medical year we record a
// reset timestamp here; the enquiries below then only count Approved records on/after it, so
// everyone shows 0 for the fresh year while all historical records remain intact.
const RESET_AT_KEY = 'utilization_reset_at';

// Returns the cutoff date as 'YYYY-MM-DD' (date-only, safe to inline) or null when never reset.
async function getUtilizationCutoff() {
  const row = await prisma.settings
    .findFirst({ where: { name: RESET_AT_KEY, category: SETTINGS_CAT }, select: { value: true } })
    .catch(() => null);
  if (!row?.value) return null;
  const d = new Date(row.value);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// SQL fragments that restrict each source table's Approved rows to the current medical year.
function cutoffFragments(cut) {
  return {
    staff: cut ? ` AND COALESCE(approved_date, updatedAt, createdAt) >= '${cut}'` : '',
    dep:   cut ? ` AND COALESCE(approved_date, from_date) >= '${cut}'`            : '',
    claim: cut ? ` AND COALESCE(approved_date, posted_date) >= '${cut}'`          : '',
  };
}

// GET /medical/settings — retrieve WHT (withholding tax) rates for hospitals and pharmacies.
exports.getMedicalSettings = asyncHandler(async (req, res) => {
  const rows = await prisma.settings
    .findMany({ where: { category: SETTINGS_CAT }, select: { name: true, value: true } })
    .catch(() => []);
  const map = Object.fromEntries(rows.map(r => [r.name, r.value]));
  respond.ok(res, 'Medical settings', {
    wht_rate_hospital: map[WHT_HOSPITAL_KEY] ?? '0',
    wht_rate_pharmacy: map[WHT_PHARMACY_KEY] ?? '0',
  });
});

// ── Medical GL settings ───────────────────────────────────────────────────────

const GL_CAT          = 'medical_gl';
const GL_EXPENSE_KEY  = 'medical_expense_gl';
const GL_WHT_KEY      = 'medical_wht_gl';
const GL_BRANCH_KEY   = 'medical_gl_branch';

// GET /medical/gl-settings — retrieve GL account codes for medical expense, WHT payable, and branch.
exports.getMedicalGLSettings = asyncHandler(async (req, res) => {
  const rows = await prisma.settings
    .findMany({ where: { category: GL_CAT }, select: { name: true, value: true } })
    .catch(() => []);
  const map = Object.fromEntries(rows.map(r => [r.name, r.value]));
  respond.ok(res, 'Medical GL settings', {
    medical_expense_gl: map[GL_EXPENSE_KEY] ?? '',
    medical_wht_gl:     map[GL_WHT_KEY]     ?? '',
    medical_gl_branch:  map[GL_BRANCH_KEY]  ?? '',
  });
});

// PUT /medical/gl-settings — save GL account codes used when posting medical payments to the general ledger.
exports.updateMedicalGLSettings = asyncHandler(async (req, res) => {
  const { medical_expense_gl = '', medical_wht_gl = '', medical_gl_branch = '' } = req.body;
  await upsertSetting(GL_EXPENSE_KEY, String(medical_expense_gl), GL_CAT);
  await upsertSetting(GL_WHT_KEY,     String(medical_wht_gl),     GL_CAT);
  await upsertSetting(GL_BRANCH_KEY,  String(medical_gl_branch),  GL_CAT);
  respond.ok(res, 'GL settings saved');
});

// Shared GL posting for direct staff/dependent medical approvals.
// creditAccount = employee's bankAccount from the employee record.
async function postStaffMedicalGL({ id, prefix, employeeName, illnessType, cost, approvedBy, glExpense, creditAccount, branch, currency }) {
  const amt = parseFloat(String(cost ?? 0));
  console.log(`[medical GL] MED_${prefix}_${id} — amt=${amt}, glExpense="${glExpense}", creditAccount="${creditAccount}", branch="${branch}", currency="${currency}"`);
  if (!amt || !glExpense || !creditAccount) {
    console.warn(`[medical GL] skipping — missing: ${!amt ? 'amount' : ''}${!glExpense ? ' glExpense' : ''}${!creditAccount ? ' creditAccount(bankAccount)' : ''}`);
    return null;
  }
  const narration   = ['Medical', employeeName, illnessType].filter(Boolean).join(' - ');
  const referenceNo = `M${prefix[0]}${id}${String(Date.now()).slice(-7)}`;
  const payload = {
    approvedBy,
    referenceNo,
    debitAccounts: [{
      debitAmount:    amt,
      debitAccount:   glExpense,
      debitCurrency:  currency,
      debitNarration: narration,
      debitProdRef:   `MED_${prefix}_${id}_EXP`,
      debitBranch:    branch,
    }],
    creditAccounts: [{
      creditAmount:    amt,
      creditAccount:   creditAccount,
      creditCurrency:  currency,
      creditNarration: narration,
      creditProdRef:   `MED_${prefix}_${id}_CR`,
      creditBranch:    branch,
    }],
  };
  console.log('[medical GL] payload:', JSON.stringify(payload, null, 2));
  const result = await postToGL(payload);
  return { ...result, _sentPayload: payload };
}

/**
 * GL API connection config (url) + posting defaults (branch/currency), sourced from the shared API
 * integration settings — same pattern payroll uses (getApiConfig + gl_extra). Replaces the never-defined
 * `glCfg` object that previously threw a ReferenceError whenever a medical approval reached GL posting.
 */
async function glConfig() {
  const cfg = await getApiConfig();
  let extra = {};
  try { extra = JSON.parse(cfg.gl_extra || '{}'); } catch { /* ignore */ }
  return {
    url:      cfg.gl_url || '',
    branch:   extra.branch   || '000',
    currency: extra.currency || 'SLL',
  };
}

async function loadGLSettings() {
  const rows = await prisma.settings
    .findMany({ where: { category: GL_CAT }, select: { name: true, value: true } })
    .catch(() => []);
  const map = Object.fromEntries(rows.map(r => [r.name, r.value]));
  const gl = await glConfig();
  return {
    expenseGl: map[GL_EXPENSE_KEY] || '',
    whtGl:     map[GL_WHT_KEY]     || '',
    branch:    map[GL_BRANCH_KEY]  || gl.branch,
    currency:  gl.currency,
  };
}

// PUT /medical/settings — update WHT rates for hospitals and pharmacies; validates 0–100 range.
exports.updateMedicalSettings = asyncHandler(async (req, res) => {
  const { wht_rate_hospital, wht_rate_pharmacy } = req.body;
  const h = parseFloat(wht_rate_hospital ?? 0);
  const p = parseFloat(wht_rate_pharmacy  ?? 0);
  if (isNaN(h) || h < 0 || h > 100) return respond.badReq(res, 'Hospital WHT rate must be 0–100');
  if (isNaN(p) || p < 0 || p > 100) return respond.badReq(res, 'Pharmacy WHT rate must be 0–100');
  await upsertSetting(WHT_HOSPITAL_KEY, String(h), SETTINGS_CAT);
  await upsertSetting(WHT_PHARMACY_KEY, String(p), SETTINGS_CAT);
  respond.ok(res, 'Settings saved', { wht_rate_hospital: String(h), wht_rate_pharmacy: String(p) });
});

// ── STAFF MEDICAL ─────────────────────────────────────────────────────────────

// GET /medical/staff — list staff medical records. Anyone who can view Manage Medical
// (view_medical permission) sees all submitted records plus their own drafts; everyone
// else sees only their own records across all statuses.
exports.getStaffMedical = asyncHandler(async (req, res) => {
  const canViewAll = (req.user?.permissions ?? []).includes('view_medical');
  let rows;
  if (canViewAll) {
    // Manage Medical viewers see submitted records + their own Drafts
    rows = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE status != 'Draft' OR posted_by = ${String(req.user?.id ?? '')} ORDER BY id DESC`;
  } else {
    // Employees only see their own records (all statuses including Draft)
    const self = await prisma.employee.findFirst({
      where: { OR: [{ email: req.user?.email || '' }, { work_email: req.user?.email || '' }, { employee_id: req.user?.username || '' }] },
      select: { id: true },
    }).catch(() => null);
    if (!self) return respond.ok(res, 'Staff medical records', []);
    rows = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE employee = ${String(self.id)} ORDER BY id DESC`;
  }
  const em  = await empMap(rows.map(r => r.employee));
  const um  = await userMap([
    ...rows.map(r => r.posted_by),
    ...rows.map(r => r.approved_by),
  ]);
  const toDateStr = v => v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null);
  respond.ok(res, 'Staff medical records', rows.map(r => ({
    ...serializeMedical(r),
    employee_name:    em[String(r.employee)]?.name        ?? r.employee,
    employee_empid:   em[String(r.employee)]?.employee_id ?? null,
    posted_by_name:   um[String(r.posted_by)]   ?? null,
    approved_by_name: um[String(r.approved_by)] ?? null,
    admission_date:   toDateStr(r.from_date),
    discharged_date:  toDateStr(r.to_date),
    illness_type:     r.type_of_illness,
    medication:       r.medication_given,
  })));
});

// POST /medical/staff — create a new staff medical record in Draft status.
exports.createStaffMedical = asyncHandler(async (req, res) => {
  const {
    employee, admission_date, discharged_date, admission_type,
    illness_type, medication, hospital, physician, cost,
    mode_of_payment, attachment1, status,
  } = req.body;

  if (!employee)       return respond.badReq(res, 'Employee is required');
  if (!admission_date) return respond.badReq(res, 'Admission date is required');
  if (!illness_type)   return respond.badReq(res, 'Illness type is required');
  if (!cost)           return respond.badReq(res, 'Cost is required');

  const row = await prisma.staffmedical.create({
    data: {
      employee:        String(employee),
      from_date:       new Date(admission_date),
      to_date:         discharged_date ? new Date(discharged_date) : null,
      admission_type:  admission_type  || '',
      type_of_illness: illness_type    || '',
      medication_given:medication      || '',
      cost:            parseFloat(cost),
      mode_of_payment: mode_of_payment || null,
      hospital:        hospital        || '',
      physician:       physician       || null,
      attachment1:     attachment1     || null,
      status:          'Draft',
      posted_by:       String(req.user?.id ?? ''),
      createdAt:       new Date(),
      updatedAt:       new Date(),
    },
  });

  const created = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id = ${row.id}`;
  respond.created(res, 'Staff medical record created', serializeMedical(created[0] ?? {}));
});

// PUT /medical/staff/:id — patch a staff medical record; handles status changes (approve/reject) separately
// from field edits. Editing a Rejected record automatically resets it to Draft for resubmission.
// A non-admin user may only mutate medical requests they originated themselves.
// Admin/HR holding the relevant medical permission can act on any record.
async function assertCanMutateMedical(req, res, table, id, perm) {
  const [rec] = await prisma.$queryRaw`SELECT posted_by FROM ${Prisma.raw(table)} WHERE id = ${id} LIMIT 1`;
  if (!rec) { respond.notFound(res, 'Record not found'); return false; }
  const owns    = String(rec.posted_by ?? '') === String(req.user?.id ?? '');
  const hasPerm = (req.user?.permissions ?? []).includes(perm);
  if (!owns && !hasPerm) { respond.forbidden(res, 'You can only modify medical requests you created'); return false; }
  return true;
}

// A medical record may only be deleted while still in Draft — once it has been submitted
// (Pending Approval, Approved, Rejected, etc.) it must be withdrawn/cancelled, not deleted.
async function assertMedicalIsDraft(req, res, table, id) {
  const [rec] = await prisma.$queryRaw`SELECT status FROM ${Prisma.raw(table)} WHERE id = ${id} LIMIT 1`;
  if (!rec) { respond.notFound(res, 'Record not found'); return false; }
  if (String(rec.status ?? '') !== 'Draft') {
    respond.badReq(res, 'Only medical records in Draft can be deleted');
    return false;
  }
  return true;
}

// Enforce the "Allow Self-Approval" control (Settings → Medical Approval). When the setting is
// OFF, the user who originated a request may not approve it themselves — a different approver
// must act. Defaults to allowed when the setting has never been saved.
async function assertCanSelfApprove(req, res, record) {
  const sameUser = String(record.posted_by ?? '') === String(req.user?.id ?? '');
  if (!sameUser) return true;
  const row = await prisma.settings
    .findFirst({ where: { name: 'approval_medical_self', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  const selfApprovalAllowed = row ? row.value === '1' : true;
  if (!selfApprovalAllowed) {
    respond.forbidden(res, 'Self-approval is disabled — a different approver must review this request');
    return false;
  }
  return true;
}

// ── Multi-stage medical approval flow ───────────────────────────────────────────
// Mirrors the payroll approval flow: a global stage config (medical_approval_flow) is snapshotted per
// record into medicalrequest_stages on submit; approve/reject walk the stages in order. One shared flow
// serves all three record types (staff | dependent | claim), keyed by (record_type, record_id).

/** Read + normalise the configured medical approval flow (empty array when unset/invalid). */
async function readMedicalFlow() {
  const row = await prisma.settings
    .findFirst({ where: { name: 'medical_approval_flow', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  if (!row?.value) return [];
  try {
    const arr = JSON.parse(row.value);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(st => st && String(st.name || '').trim() && (st.approverType === 'role' || st.approverType === 'user') && st.approverId != null && String(st.approverId).trim() !== '')
      .map(st => ({
        name: String(st.name).trim(),
        approverType: st.approverType,
        approverId: String(st.approverId),
        approverLabel: st.approverLabel != null ? String(st.approverLabel) : null,
      }));
  } catch { return []; }
}

/** Does this actor satisfy the given stage? user → id match; role → role name/id match. */
function actorMatchesStage(req, stage) {
  const type = stage.approver_type ?? stage.approverType;
  const idv = stage.approver_id ?? stage.approverId;
  const label = stage.approver_label ?? stage.approverLabel;
  if (type === 'user') return String(req.user?.id ?? '') === String(idv);
  if (type === 'role') {
    const roles = (req.user?.roles || []).map(String);
    return roles.includes(String(label)) || roles.includes(String(idv));
  }
  return false;
}

/** Notify a stage's approver(s): a user stage pings that user; a role stage pings all medical approvers. */
function notifyMedicalStageApprovers(stage, req, employeeId) {
  const type = stage.approver_type ?? stage.approverType;
  const idv = stage.approver_id ?? stage.approverId;
  const stageName = stage.stage_name ?? stage.name;
  const payload = { message: `A medical request awaits your approval (${stageName})`, action: 'AdminMedical', type: 'medical', fromUser: req.user?.id, employee: employeeId };
  if (type === 'user' && idv) notifyUser(idv, payload);
  else notifyUsersWithRole(idv, payload, req.user?.id, stage.approver_label ?? stage.approverLabel);
}

/** Snapshot the configured flow onto a record (all Pending). Returns the stage list (empty ⇒ single-stage,
 *  caller keeps legacy behaviour). Call from submit* when approval_medical is on. */
async function snapshotMedicalStages(recordType, recordId) {
  const flow = await readMedicalFlow();
  await prisma.$executeRaw`DELETE FROM medicalrequest_stages WHERE record_type=${recordType} AND record_id=${BigInt(recordId)}`;
  for (let i = 0; i < flow.length; i++) {
    const st = flow[i];
    await prisma.$executeRaw`
      INSERT INTO medicalrequest_stages (record_type, record_id, stage_order, stage_name, approver_type, approver_id, approver_label, status)
      VALUES (${recordType}, ${BigInt(recordId)}, ${i}, ${st.name}, ${st.approverType}, ${st.approverId}, ${st.approverLabel}, 'Pending')`;
  }
  return flow;
}

/** Remove a record's stage snapshot (on withdraw / edit-back-to-Draft / delete). */
async function deleteMedicalStages(recordType, recordId) {
  await prisma.$executeRaw`DELETE FROM medicalrequest_stages WHERE record_type=${recordType} AND record_id=${BigInt(recordId)}`;
}

/** Load a record's stages ordered by stage_order. */
async function loadMedicalStages(recordType, recordId) {
  return prisma.$queryRaw`
    SELECT id, stage_order, stage_name, approver_type, approver_id, approver_label, status
    FROM medicalrequest_stages WHERE record_type=${recordType} AND record_id=${BigInt(recordId)} ORDER BY stage_order ASC`;
}

/** Fetch a full record row by id from one of the medical tables. */
async function fetchMedicalRecord(table, recordId) {
  const [row] = await prisma.$queryRaw`SELECT * FROM ${Prisma.raw(table)} WHERE id=${BigInt(recordId)}`;
  return row;
}

/**
 * Require the blanket `approve_medical` permission. The approve/reject routes are no longer
 * permission-guarded (so stage approvers can act on their stage via the stage engine); when a record has
 * NO configured flow, that engine defers, so the single-stage path must enforce the permission itself —
 * otherwise any authenticated user could approve. Returns false and responds 403 when the actor lacks it.
 */
function assertCanApproveMedical(req, res) {
  if ((req.user?.permissions || []).includes('approve_medical')) return true;
  respond.forbidden(res, 'You do not have permission to approve medical requests');
  return false;
}

/**
 * Run the multi-stage APPROVE gate for a record. Returns:
 *   { handled:false }              → no flow; caller runs the legacy single-stage approve.
 *   { handled:true, done:false }   → an intermediate stage cleared; this function has already responded
 *                                    (or a 403 was sent) — caller must STOP (no GL, no status change).
 *   { handled:true, done:true }    → last stage cleared; caller proceeds to final approval + GL.
 */
async function medicalStageApprove(req, res, recordType, table, recordId, employeeId) {
  const stages = await loadMedicalStages(recordType, recordId);
  const pending = stages.filter(st => st.status === 'Pending');
  if (!pending.length) return { handled: false };

  const current = pending[0];
  // In a configured flow, the current stage's approver must match — a blanket approve_medical permission
  // grants access to the queue but does NOT let a non-assigned user skip a stage (mirrors payroll).
  if (!actorMatchesStage(req, current)) {
    const who = current.approver_label || (current.approver_type === 'user' ? 'the assigned approver' : 'the assigned role');
    respond.forbidden(res, `Only ${who} can approve the "${current.stage_name}" stage`);
    return { handled: true, done: false };
  }
  const actedBy = req.user?.id ? BigInt(req.user.id) : null;
  await prisma.$executeRaw`UPDATE medicalrequest_stages SET status='Approved', acted_by=${actedBy}, acted_at=NOW(), comment=${req.body?.comment?.trim() || null} WHERE id=${BigInt(current.id)}`;

  if (pending.length > 1) {
    notifyMedicalStageApprovers(pending[1], req, employeeId);
    const updated = await fetchMedicalRecord(table, recordId);
    respond.ok(res, `"${current.stage_name}" approved — awaiting the next stage`, s(updated));
    return { handled: true, done: false };
  }
  return { handled: true, done: true }; // last stage cleared → caller does final approval + GL
}

/**
 * Run the multi-stage REJECT gate. Returns { handled:false } when there's no flow (caller does legacy
 * reject), or { handled:true } after marking the current stage + the record Rejected (caller stops).
 * `rejectRecord(reason, approvedBy)` performs the table-specific status='Rejected' UPDATE.
 */
async function medicalStageReject(req, res, recordType, table, recordId, employeeId, label, rejectRecord) {
  const stages = await loadMedicalStages(recordType, recordId);
  const pending = stages.filter(st => st.status === 'Pending');
  if (!pending.length) return { handled: false };

  const current = pending[0];
  // Only the current stage's assigned approver may reject it (blanket permission doesn't skip stages).
  if (!actorMatchesStage(req, current)) {
    const who = current.approver_label || (current.approver_type === 'user' ? 'the assigned approver' : 'the assigned role');
    respond.forbidden(res, `Only ${who} can act on the "${current.stage_name}" stage`);
    return { handled: true };
  }
  const reason = req.body?.reason?.trim() || null;
  const actedBy = req.user?.id ? BigInt(req.user.id) : null;
  await prisma.$executeRaw`UPDATE medicalrequest_stages SET status='Rejected', acted_by=${actedBy}, acted_at=NOW(), comment=${reason} WHERE id=${BigInt(current.id)}`;
  await rejectRecord(reason, req.user?.id != null ? String(req.user.id) : null);
  if (employeeId) notifyMedicalStatus(req, employeeId, 'Rejected', reason, label);
  const updated = await fetchMedicalRecord(table, recordId);
  respond.ok(res, 'Rejected', s(updated));
  return { handled: true };
}

// GET /medical/approval-flow — the configured medical approval stage chain.
exports.getMedicalApprovalFlow = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Medical approval flow retrieved', await readMedicalFlow());
});

// PUT /medical/approval-flow — validate + save the stage chain (guarded by approve_medical).
exports.saveMedicalApprovalFlow = asyncHandler(async (req, res) => {
  const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const clean = [];
  for (const st of stages) {
    const name = String(st?.name || '').trim();
    if (!name) return respond.badReq(res, 'Every stage needs a name');
    if (st.approverType !== 'role' && st.approverType !== 'user') return respond.badReq(res, `Stage "${name}" has an invalid approver type`);
    if (st.approverId == null || String(st.approverId).trim() === '') return respond.badReq(res, `Stage "${name}" needs an approver`);
    clean.push({
      name,
      approverType: st.approverType,
      approverId: String(st.approverId),
      approverLabel: st.approverLabel != null ? String(st.approverLabel) : null,
    });
  }
  await upsertSettingShared(null, 'medical_approval_flow', 'app_controls', JSON.stringify(clean));
  respond.ok(res, 'Medical approval flow saved', clean);
});

// GET /medical/:type/:id/stages — a record's snapshotted stage progress (type ∈ staff|dependent|claim).
exports.getMedicalStages = asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  if (!['staff', 'dependent', 'claim'].includes(type)) return respond.badReq(res, 'Invalid record type');
  const recId = toBigInt(id);
  if (!recId) return respond.badReq(res, 'Invalid ID');
  const stages = await prisma.$queryRaw`
    SELECT id, record_type, record_id, stage_order, stage_name, approver_type, approver_id, approver_label, status, acted_by, acted_at
    FROM medicalrequest_stages WHERE record_type=${type} AND record_id=${recId} ORDER BY stage_order ASC`;
  respond.ok(res, 'Stages retrieved', s(stages));
});

exports.updateStaffMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  if (!(await assertCanMutateMedical(req, res, 'staffmedical', id, 'edit_medical'))) return;

  const {
    employee, admission_date, discharged_date, admission_type,
    illness_type, medication, hospital, physician, cost,
    mode_of_payment, status, attachment1, rejection_reason,
  } = req.body;

  // Status + approval tracking via raw SQL to avoid Prisma enum mapping issues
  if (status) {
    const approverId = (status === 'Approved' || status === 'Rejected') ? (req.user?.id ?? null) : null;
    const reason     = status === 'Rejected' ? (rejection_reason ?? null) : null;
    // Dynamic status → builder (maps the spaced value to the Prisma enum member) so Postgres binds
    // the enum correctly.
    await prisma.staffmedical.update({
      where: { id },
      data: { status: toMedEnum(status), approved_by: approverId != null ? String(approverId) : null, rejection_reason: reason, updatedAt: new Date() },
    });
    try {
      const rec = await prisma.staffmedical.findUnique({ where: { id }, select: { employee: true } });
      notifyMedicalStatus(req, rec?.employee, status, reason, 'staff medical claim');
    } catch { /* non-blocking */ }
  }

  const hasOtherFields = employee || admission_date || discharged_date !== undefined ||
    admission_type !== undefined || illness_type || medication || hospital !== undefined ||
    physician !== undefined || cost || mode_of_payment !== undefined || attachment1 !== undefined;

  if (hasOtherFields) {
    await prisma.staffmedical.update({
      where: { id },
      data: {
        ...(employee        && { employee: String(employee) }),
        ...(admission_date  && { from_date: new Date(admission_date) }),
        ...(discharged_date !== undefined && { to_date: discharged_date ? new Date(discharged_date) : null }),
        ...(admission_type  !== undefined && { admission_type: admission_type  || '' }),
        ...(illness_type    && { type_of_illness: illness_type }),
        ...(medication      && { medication_given: medication }),
        ...(hospital        !== undefined && { hospital: hospital || '' }),
        ...(physician       !== undefined && { physician: physician || null }),
        ...(cost            && { cost: parseFloat(cost) }),
        ...(mode_of_payment !== undefined && { mode_of_payment: mode_of_payment || null }),
        ...(attachment1     !== undefined && { attachment1: attachment1 || null }),
        updatedAt: new Date(),
      },
    });
    // Editing a rejected record restores it to Draft so it can be resubmitted (literal status → auto-cast)
    await prisma.$executeRaw`UPDATE staffmedical SET status='Draft', rejection_reason=NULL, approved_by=NULL, updatedAt=NOW() WHERE id=${id} AND status='Rejected'`;
    // Clear any stale stage snapshot — a fresh submit re-snapshots the current flow.
    await deleteMedicalStages('staff', id);
  }

  const updated = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id = ${id}`;
  respond.ok(res, 'Staff medical record updated', serializeMedical(updated[0] ?? {}));
});

// DELETE /medical/staff/:id — permanently remove a staff medical record.
exports.deleteStaffMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  if (!(await assertCanMutateMedical(req, res, 'staffmedical', id, 'delete_medical'))) return;
  if (!(await assertMedicalIsDraft(req, res, 'staffmedical', id))) return;
  await prisma.staffmedical.delete({ where: { id } });
  respond.ok(res, 'Deleted');
});

// ── DEPENDENT MEDICAL ─────────────────────────────────────────────────────────

// GET /medical/dependent — list dependent medical records with the same view_medical/self visibility rules as staff medical.
// Resolves relationship labels from CodeListValue and resolves dependent name from the register.
exports.getDependentMedical = asyncHandler(async (req, res) => {
  const canViewAll = (req.user?.permissions ?? []).includes('view_medical');
  let rows;
  if (canViewAll) {
    rows = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE status != 'Draft' OR posted_by = ${String(req.user?.id ?? '')} ORDER BY id DESC`;
  } else {
    const self = await prisma.employee.findFirst({
      where: { OR: [{ email: req.user?.email || '' }, { work_email: req.user?.email || '' }, { employee_id: req.user?.username || '' }] },
      select: { id: true },
    }).catch(() => null);
    if (!self) return respond.ok(res, 'Dependent medical records', []);
    rows = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE employee = ${String(self.id)} ORDER BY id DESC`;
  }
  const em  = await empMap(rows.map(r => r.employee));
  const um  = await userMap([
    ...rows.map(r => r.posted_by),
    ...rows.map(r => r.approved_by),
  ]);
  const cm  = await clvMap(rows.map(r => r.relation_to_dependent));
  const toDateStr = v => v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null);
  respond.ok(res, 'Dependent medical records', rows.map(r => ({
    ...serializeMedical(r),
    employee_name:    em[String(r.employee)]?.name        ?? r.employee,
    employee_empid:   em[String(r.employee)]?.employee_id ?? null,
    posted_by_name:   um[String(r.posted_by)]   ?? null,
    approved_by_name: um[String(r.approved_by)] ?? null,
    dependent_id:     r.dependent_id ? String(r.dependent_id) : null,
    dependent_name:   r.dependant_name,
    relationship:     r.relation_to_dependent
                        ? (cm[String(r.relation_to_dependent)] ?? r.relation_to_dependent)
                        : null,
    date_attended:    toDateStr(r.from_date),
    date_discharged:  toDateStr(r.to_date),
    illness_type:     r.type_of_illness,
    medication:       r.medication_given,
  })));
});

// POST /medical/dependent — create a dependent medical record in Draft status; looks up dependent name
// from the employeedependents register when dependent_id is provided.
exports.createDependentMedical = asyncHandler(async (req, res) => {
  const {
    employee, dependent_id, relationship, dob,
    date_attended, date_discharged, admission_type,
    illness_type, medication, hospital, physician, cost,
    mode_of_payment, attachment1, status,
  } = req.body;

  if (!employee)      return respond.badReq(res, 'Employee is required');
  if (!date_attended) return respond.badReq(res, 'Date attended is required');
  if (!illness_type)  return respond.badReq(res, 'Illness type is required');
  if (!cost)          return respond.badReq(res, 'Cost is required');

  // Look up dependent name
  let dependantName = '';
  if (dependent_id) {
    const dep = await prisma.employeedependents.findUnique({
      where: { id: toBigInt(dependent_id) },
      select: { name: true },
    }).catch(() => null);
    dependantName = dep?.name ?? '';
  }

  const row = await prisma.dependentmedical.create({
    data: {
      employee:             String(employee),
      from_date:            new Date(date_attended),
      to_date:              date_discharged ? new Date(date_discharged) : null,
      dependant_name:       dependantName,
      relation_to_dependent:relationship    || null,
      dob:                  dob ? new Date(dob) : null,
      admission_type:       admission_type  || '',
      type_of_illness:      illness_type    || '',
      medication_given:     medication      || '',
      cost:                 parseFloat(cost),
      mode_of_payment:      mode_of_payment || null,
      hospital:             hospital        || '',
      physician:            physician       || null,
      attachment1:          attachment1     || null,
      status:               'Draft',
      posted_by:            String(req.user?.id ?? ''),
      dependent_id:         dependent_id ? toBigInt(dependent_id) : null,
    },
  });

  const created = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id = ${row.id}`;
  respond.created(res, 'Dependent medical record created', serializeMedical(created[0] ?? {}));
});

// PUT /medical/dependent/:id — patch a dependent medical record; same approve/reject + auto-Draft-restore logic as updateStaffMedical.
exports.updateDependentMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  if (!(await assertCanMutateMedical(req, res, 'dependentmedical', id, 'edit_medical'))) return;

  const {
    employee, dependent_id, relationship, dob,
    date_attended, date_discharged, admission_type,
    illness_type, medication, hospital, physician, cost,
    mode_of_payment, status, attachment1, rejection_reason,
  } = req.body;

  let dependantName;
  if (dependent_id) {
    const dep = await prisma.employeedependents.findUnique({
      where: { id: toBigInt(dependent_id) },
      select: { name: true },
    }).catch(() => null);
    dependantName = dep?.name;
  }

  if (status) {
    const approverId = (status === 'Approved' || status === 'Rejected') ? (req.user?.id ?? null) : null;
    const reason     = status === 'Rejected' ? (rejection_reason ?? null) : null;
    await prisma.dependentmedical.update({
      where: { id },
      data: { status: toMedEnum(status), approved_by: approverId != null ? String(approverId) : null, rejection_reason: reason },
    });
    try {
      const rec = await prisma.dependentmedical.findUnique({ where: { id }, select: { employee: true } });
      notifyMedicalStatus(req, rec?.employee, status, reason, 'dependent medical claim');
    } catch { /* non-blocking */ }
  }

  const hasOtherFieldsDep = employee || date_attended || date_discharged !== undefined ||
    dependantName !== undefined || relationship !== undefined || dob !== undefined ||
    admission_type !== undefined || illness_type || medication || hospital !== undefined ||
    physician !== undefined || cost || mode_of_payment !== undefined || attachment1 !== undefined;

  if (hasOtherFieldsDep) {
    await prisma.dependentmedical.update({
      where: { id },
      data: {
        ...(employee       && { employee: String(employee) }),
        ...(date_attended  && { from_date: new Date(date_attended) }),
        ...(date_discharged !== undefined && { to_date: date_discharged ? new Date(date_discharged) : null }),
        ...(dependantName  !== undefined && { dependant_name: dependantName }),
        ...(relationship   !== undefined && { relation_to_dependent: relationship || null }),
        ...(dob            !== undefined && { dob: dob ? new Date(dob) : null }),
        ...(admission_type !== undefined && { admission_type: admission_type || '' }),
        ...(illness_type   && { type_of_illness: illness_type }),
        ...(medication     && { medication_given: medication }),
        ...(hospital       !== undefined && { hospital: hospital || '' }),
        ...(physician      !== undefined && { physician: physician || null }),
        ...(cost           && { cost: parseFloat(cost) }),
        ...(mode_of_payment !== undefined && { mode_of_payment: mode_of_payment || null }),
        ...(attachment1     !== undefined && { attachment1: attachment1 || null }),
      },
    });
    // Editing a rejected record restores it to Draft so it can be resubmitted (literal status → auto-cast)
    await prisma.$executeRaw`UPDATE dependentmedical SET status='Draft', rejection_reason=NULL, approved_by=NULL WHERE id=${id} AND status='Rejected'`;
    await deleteMedicalStages('dependent', id);
  }

  if (dependent_id) {
    await prisma.dependentmedical.updateMany({ where: { id }, data: { dependent_id: toBigInt(dependent_id) } }).catch(() => {});
  }
  const updatedDep = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id = ${id}`;
  respond.ok(res, 'Dependent medical record updated', serializeMedical(updatedDep[0] ?? {}));
});

// DELETE /medical/dependent/:id — permanently remove a dependent medical record.
exports.deleteDependentMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  if (!(await assertCanMutateMedical(req, res, 'dependentmedical', id, 'delete_medical'))) return;
  if (!(await assertMedicalIsDraft(req, res, 'dependentmedical', id))) return;
  await prisma.dependentmedical.delete({ where: { id } });
  respond.ok(res, 'Deleted');
});

// ── MEDICAL LIMITS ────────────────────────────────────────────────────────────

// GET /medical/limits — list all paygrade medical limits (max claimable amount per pay grade + currency).
exports.getMedicalLimits = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT ml.*, pg.name AS grade_name
    FROM medicallimit ml
    LEFT JOIN paygrades pg ON pg.id = ml.paygrade_id
    ORDER BY ml.id DESC`;
  respond.ok(res, 'Medical limits', rows.map(r => s({
    ...r,
    grade_name: r.grade_name ?? r.grade,
  })));
});

// POST /medical/limits — create a new medical limit for a pay grade; resolves grade name from the paygrades table.
exports.createMedicalLimit = asyncHandler(async (req, res) => {
  const { paygrade, currency, amount } = req.body;
  if (!paygrade) return respond.badReq(res, 'Pay grade is required');
  if (!currency) return respond.badReq(res, 'Currency is required');
  if (!amount)   return respond.badReq(res, 'Amount is required');

  const pgId = toBigInt(paygrade);
  // Get paygrade name for the grade field
  const pg = pgId ? await prisma.paygrades.findUnique({ where: { id: pgId }, select: { name: true } }).catch(() => null) : null;

  const created = await prisma.medicallimit.create({
    data: {
      grade:       pg?.name ?? String(paygrade),
      paygrade_id: pgId ?? null,
      currency,
      amount:      parseFloat(amount),
      status:      'Active',
    },
    select: { id: true },
  });
  respond.created(res, 'Medical limit created', { id: Number(created.id) });
});

// PUT /medical/limits/:id — update a medical limit's pay grade, currency, or amount.
exports.updateMedicalLimit = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return respond.badReq(res, 'Invalid ID');

  const { paygrade, currency, amount } = req.body;
  const pgId = toBigInt(paygrade);
  const pg   = pgId ? await prisma.paygrades.findUnique({ where: { id: pgId }, select: { name: true } }).catch(() => null) : null;

  await prisma.medicallimit.updateMany({
    where: { id: BigInt(id) },
    data: { grade: pg?.name ?? String(paygrade), paygrade_id: pgId ?? null, currency, amount: parseFloat(amount) },
  });
  respond.ok(res, 'Medical limit updated');
});

// DELETE /medical/limits/:id — remove a medical limit entry.
exports.deleteMedicalLimit = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.medicallimit.deleteMany({ where: { id: BigInt(id) } });
  respond.ok(res, 'Deleted');
});

// ── STAFF MEDICAL ENQUIRY ─────────────────────────────────────────────────────

// GET /medical/enquiry — aggregate view of medical utilisation for all active employees: limit, staff-used,
// dependent-used, total utilised, and remaining balance. Includes amounts from approved hospital claim items.
exports.getMedicalEnquiry = asyncHandler(async (req, res) => {
  // Raw join: paygrades relation is not defined in Prisma schema
  const employees = await prisma.$queryRaw`
    SELECT e.id, e.firstName, e.lastName, e.employee_id,
           pg.id AS pg_id, pg.name AS pg_name
    FROM employee e
    LEFT JOIN paygrades pg ON pg.id = e.paygradeId
    WHERE e.lifecycleStatus != 'TERMINATED'
    ORDER BY e.firstName ASC`;

  if (!employees.length) return respond.ok(res, 'Medical enquiry', []);

  const limits = await prisma.$queryRaw`SELECT * FROM medicallimit WHERE paygrade_id IS NOT NULL`;
  const limitByGrade = {};
  for (const lim of limits) {
    if (lim.paygrade_id) limitByGrade[String(lim.paygrade_id)] = lim;
  }

  // Only Approved records on/after the current medical-year reset point count toward utilization
  const cut = await getUtilizationCutoff();
  const frag = cutoffFragments(cut);
  const staffCosts = await prisma.$queryRaw`SELECT employee, SUM(cost) as total FROM staffmedical WHERE status = 'Approved'${Prisma.raw(frag.staff)} GROUP BY employee`;
  const depCosts   = await prisma.$queryRaw`SELECT employee, SUM(cost) as total FROM dependentmedical WHERE status = 'Approved'${Prisma.raw(frag.dep)} GROUP BY employee`;

  const staffMap = Object.fromEntries((staffCosts ?? []).map(r => [String(r.employee), parseFloat(r.total ?? 0)]));
  const depMap   = Object.fromEntries((depCosts   ?? []).map(r => [String(r.employee), parseFloat(r.total ?? 0)]));

  // Include approved hospital claim items in utilisation
  const approvedClaims = await prisma.$queryRaw`SELECT items FROM hospitalclaims WHERE status = 'Approved'${Prisma.raw(frag.claim)}`.catch(() => []);
  for (const claim of approvedClaims) {
    let claimItems = [];
    try { claimItems = JSON.parse(claim.items ?? '[]'); } catch {}
    for (const item of claimItems) {
      const empKey = String(item.employee_id);
      const amt    = parseFloat(item.amount ?? 0);
      if (item.type === 'dependent') {
        depMap[empKey]   = (depMap[empKey]   ?? 0) + amt;
      } else {
        staffMap[empKey] = (staffMap[empKey] ?? 0) + amt;
      }
    }
  }

  const rows = employees.map(emp => {
    const pgId         = emp.pg_id ? String(emp.pg_id) : null;
    const lim          = pgId ? limitByGrade[pgId] : null;
    const limit        = lim  ? parseFloat(lim.amount ?? 0) : null;
    const currency     = lim?.currency ?? '';
    const staffUsed    = staffMap[String(emp.id)] ?? 0;
    const depUsed      = depMap[String(emp.id)]   ?? 0;
    const utilized     = staffUsed + depUsed;

    return {
      employee_id:     String(emp.id),
      employee_empid:  emp.employee_id,
      employee_name:   `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
      grade:           emp.pg_name ?? '—',
      currency,
      medical_limit:   limit,
      staff_utilized:  staffUsed,
      dep_utilized:    depUsed,
      total_utilized:  utilized,
      limit_balance:   limit !== null ? limit - utilized : null,
    };
  });

  respond.ok(res, 'Medical enquiry', serializeMedical(rows));
});

// GET /medical/enquiry/:id — detailed utilisation breakdown for a single employee including all approved
// staff and dependent medical records and approved hospital claim line items.
exports.getMedicalEnquiryByEmployee = asyncHandler(async (req, res) => {
  const empIdStr = String(req.params.id);
  const empIdBig = toBigInt(empIdStr);
  if (!empIdBig) return respond.badReq(res, 'Invalid employee ID');

  const [emp] = await prisma.$queryRaw`
    SELECT e.id, e.firstName, e.lastName, e.employee_id,
           pg.id AS pg_id, pg.name AS pg_name
    FROM employee e
    LEFT JOIN paygrades pg ON pg.id = e.paygradeId
    WHERE e.id = ${empIdBig}
    LIMIT 1`.catch(() => []);
  if (!emp) return respond.notFound(res, 'Employee not found');

  const pgId   = emp.pg_id ? String(emp.pg_id) : null;
  const limits = pgId
    ? await prisma.$queryRaw`SELECT * FROM medicallimit WHERE paygrade_id = ${BigInt(pgId)} LIMIT 1`.catch(() => [])
    : [];
  const lim      = limits?.[0] ?? null;
  const limit    = lim ? parseFloat(lim.amount ?? 0) : null;
  const currency = lim?.currency ?? '';

  // Restrict utilization to the current medical year (records on/after the reset point)
  const cut  = await getUtilizationCutoff();
  const frag = cutoffFragments(cut);
  const [staffTotals] = await prisma.$queryRaw`SELECT SUM(cost) AS total FROM staffmedical WHERE employee = ${empIdStr} AND status = 'Approved'${Prisma.raw(frag.staff)}`.catch(() => [{ total: 0 }]);
  const [depTotals] = await prisma.$queryRaw`SELECT SUM(cost) AS total FROM dependentmedical WHERE employee = ${empIdStr} AND status = 'Approved'${Prisma.raw(frag.dep)}`.catch(() => [{ total: 0 }]);

  let staffUsed = parseFloat(staffTotals?.total ?? 0);
  let depUsed   = parseFloat(depTotals?.total  ?? 0);

  // Include approved hospital claim items
  const approvedClaims = await prisma.$queryRaw`SELECT items FROM hospitalclaims WHERE status = 'Approved'${Prisma.raw(frag.claim)}`.catch(() => []);
  for (const claim of approvedClaims) {
    let claimItems = [];
    try { claimItems = JSON.parse(claim.items ?? '[]'); } catch {}
    for (const item of claimItems) {
      if (String(item.employee_id) !== empIdStr) continue;
      const amt = parseFloat(item.amount ?? 0);
      if (item.type === 'dependent') depUsed   += amt;
      else                           staffUsed += amt;
    }
  }

  const utilized = staffUsed + depUsed;
  const balance  = limit !== null ? limit - utilized : null;

  const toDateStr = v => v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null);

  const staffRows = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE employee = ${empIdStr} AND status = 'Approved'${Prisma.raw(frag.staff)} ORDER BY id DESC`.catch(() => []);
  const depRows = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE employee = ${empIdStr} AND status = 'Approved'${Prisma.raw(frag.dep)} ORDER BY id DESC`.catch(() => []);

  respond.ok(res, 'Employee medical enquiry', serializeMedical({
    employee_id:    String(emp.id),
    employee_empid: emp.employee_id,
    employee_name:  `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
    grade:          emp.pg_name ?? '—',
    currency,
    medical_limit:  limit,
    staff_utilized: staffUsed,
    dep_utilized:   depUsed,
    total_utilized: utilized,
    limit_balance:  balance,
    staff_records: staffRows.map(r => ({
      ...r,
      admission_date:  toDateStr(r.from_date),
      discharged_date: toDateStr(r.to_date),
      illness_type:    r.type_of_illness,
      hospital:        r.hospital,
      cost:            parseFloat(r.cost ?? 0),
    })),
    dependent_records: depRows.map(r => ({
      ...r,
      dependent_name:  r.dependant_name,
      date_attended:   toDateStr(r.from_date),
      date_discharged: toDateStr(r.to_date),
      illness_type:    r.type_of_illness,
      hospital:        r.hospital,
      cost:            parseFloat(r.cost ?? 0),
    })),
  }));
});

// ── PERSONAL MEDICAL ENQUIRY (current user's employee) ───────────────────────

// GET /medical/my-enquiry — return the authenticated user's own medical limit, utilisation, and full record history
// (all statuses). Utilisation includes Approved, Pending Approval, and Draft records to show worst-case balance.
exports.getMyMedicalEnquiry = asyncHandler(async (req, res) => {
  // Find the employee linked to this user
  const userRow = await prisma.users.findUnique({ where: { id: BigInt(req.user?.id) }, select: { employeeId: true } }).catch(() => null);
  const empId = userRow?.employeeId ? String(userRow.employeeId) : null;
  if (!empId) return respond.ok(res, 'My medical enquiry', null);

  const [emp] = await prisma.$queryRaw`
    SELECT e.id, e.firstName, e.lastName, e.employee_id,
           pg.id AS pg_id, pg.name AS pg_name
    FROM employee e
    LEFT JOIN paygrades pg ON pg.id = e.paygradeId
    WHERE e.id = ${BigInt(empId)}
    LIMIT 1`.catch(() => []);
  if (!emp) return respond.ok(res, 'My medical enquiry', null);

  const pgId = emp.pg_id ? String(emp.pg_id) : null;
  const limits = pgId
    ? await prisma.$queryRaw`SELECT * FROM medicallimit WHERE paygrade_id = ${BigInt(pgId)} LIMIT 1`.catch(() => [])
    : [];
  const lim    = limits?.[0] ?? null;
  const limit  = lim ? parseFloat(lim.amount ?? 0) : null;
  const currency = lim?.currency ?? '';

  // Count Approved records only from the current medical year; in-progress Draft/Pending always show.
  const cut  = await getUtilizationCutoff();
  const frag = cutoffFragments(cut);
  const [staffTotals] = await prisma.$queryRaw`SELECT SUM(cost) AS total FROM staffmedical WHERE employee = ${empId}
       AND (status IN ('Pending Approval','Draft') OR (status = 'Approved'${Prisma.raw(frag.staff)}))`.catch(() => [{ total: 0 }]);
  const [depTotals] = await prisma.$queryRaw`SELECT SUM(cost) AS total FROM dependentmedical WHERE employee = ${empId}
       AND (status IN ('Pending Approval','Draft') OR (status = 'Approved'${Prisma.raw(frag.dep)}))`.catch(() => [{ total: 0 }]);

  const utilized = parseFloat(staffTotals?.total ?? 0) + parseFloat(depTotals?.total ?? 0);
  const balance  = limit !== null ? Math.max(0, limit - utilized) : null;

  // Also return individual records for the history
  const staffRows = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE employee = ${empId} ORDER BY id DESC`.catch(() => []);
  const depRows = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE employee = ${empId} ORDER BY id DESC`.catch(() => []);
  const toDateStr = v => v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null);

  respond.ok(res, 'My medical enquiry', serializeMedical({
    employee_name:   `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
    employee_empid:  emp.employee_id,
    grade:           emp.pg_name ?? '—',
    currency,
    medical_limit:   limit,
    amount_utilized: utilized,
    limit_balance:   balance,
    staff_records:   staffRows.map(r => ({
      ...r,
      admission_date:  toDateStr(r.from_date),
      discharged_date: toDateStr(r.to_date),
      illness_type:    r.type_of_illness,
      medication:      r.medication_given,
    })),
    dependent_records: depRows.map(r => ({
      ...r,
      dependent_name:  r.dependant_name,
      relationship:    r.relation_to_dependent,
      date_attended:   toDateStr(r.from_date),
      date_discharged: toDateStr(r.to_date),
      illness_type:    r.type_of_illness,
      medication:      r.medication_given,
    })),
  }));
});

// ── REGISTERED HOSPITALS ──────────────────────────────────────────────────────

// GET /medical/hospitals — list all registered hospitals and pharmacies with their GL account and type.
exports.getHospitals = asyncHandler(async (req, res) => {
  const rows = await prisma.registeredhospitals.findMany({ orderBy: { id: 'desc' } });
  respond.ok(res, 'Hospitals', rows.map(r => s(r)));
});

// POST /medical/hospitals — register a new hospital or pharmacy with its GL credit account.
exports.createHospital = asyncHandler(async (req, res) => {
  const { name, account, type = 'Hospital' } = req.body;
  if (!name?.trim())    return respond.badReq(res, 'Name is required');
  if (!account?.trim()) return respond.badReq(res, 'Account is required');
  const row = await prisma.registeredhospitals.create({
    data: { name: name.trim(), account: account.trim(), type: type || 'Hospital', created_at: new Date() },
  });
  respond.created(res, 'Hospital registered', s(row));
});

// PUT /medical/hospitals/:id — update a registered hospital's name, account, or type.
exports.updateHospital = asyncHandler(async (req, res) => {
  const id  = toInt(req.params.id);
  if (!id)  return respond.badReq(res, 'Invalid ID');
  const { name, account, type } = req.body;
  const row = await prisma.registeredhospitals.update({
    where: { id },
    data: {
      ...(name?.trim()    && { name: name.trim() }),
      ...(account?.trim() && { account: account.trim() }),
      ...(type            && { type }),
      updated_at: new Date(),
    },
  });
  respond.ok(res, 'Hospital updated', s(row));
});

// DELETE /medical/hospitals/:id — remove a registered hospital from the system.
exports.deleteHospital = asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.registeredhospitals.delete({ where: { id } });
  respond.ok(res, 'Hospital removed');
});

// ── HOSPITAL CLAIMS ───────────────────────────────────────────────────────────
// items = JSON array: [{ employee_id, employee_name, type:'self'|'dependent',
//                        dependent_id, dependent_name, narration, amount }]

// GET /medical/hospital-claims — list all hospital claims with resolved hospital name/type, item count, and totals.
exports.getHospitalClaims = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`SELECT * FROM hospitalclaims ORDER BY id DESC`;

  const hospIds = [...new Set(rows.map(r => r.hospital).filter(Boolean).map(Number))];
  const hospitals = hospIds.length
    ? await prisma.registeredhospitals.findMany({ where: { id: { in: hospIds } } })
    : [];
  const hospMap = Object.fromEntries(hospitals.map(h => [h.id, { name: h.name, type: h.type }]));

  respond.ok(res, 'Hospital claims', rows.map(r => {
    let items = [];
    try { items = JSON.parse(r.items ?? '[]'); } catch {}
    const hosp = hospMap[Number(r.hospital)] ?? {};
    return {
      ...s(r),
      hospital_name:  hosp.name  ?? null,
      hospital_type:  hosp.type  ?? null,
      item_count:     items.length,
      items,
      total_amount:        parseFloat(r.total_amount ?? 0),
      withholding_tax:     parseFloat(r.withholding_tax ?? 0),
      total_credit_amount: parseFloat(r.total_credit_amount ?? 0),
      date: r.posted_date ? r.posted_date.toISOString().slice(0, 10) : null,
    };
  }));
});

// POST /medical/hospital-claims — create a hospital claim in Draft status; automatically calculates
// withholding tax from the hospital's WHT rate and derives total_credit_amount = total - WHT.
exports.createHospitalClaim = asyncHandler(async (req, res) => {
  const { hospital, items, comment = '' } = req.body;
  if (!hospital)                                   return respond.badReq(res, 'Hospital is required');
  if (!Array.isArray(items) || items.length === 0) return respond.badReq(res, 'At least one item is required');

  const hospId = toInt(hospital);
  const hosp = await prisma.registeredhospitals.findUnique({ where: { id: hospId }, select: { type: true } }).catch(() => null);
  const rate = await getWhtRate(hosp?.type ?? 'Hospital');

  const total_amount        = items.reduce((s, i) => s + parseFloat(i.amount ?? 0), 0);
  const withholding_tax     = parseFloat((total_amount * rate / 100).toFixed(2));
  const total_credit_amount = parseFloat((total_amount - withholding_tax).toFixed(2));

  const row = await prisma.hospitalclaims.create({
    data: {
      hospital:           BigInt(hospId),
      items:              JSON.stringify(items),
      total_amount,
      withholding_tax,
      category:           0,
      total_credit_amount,
      comment,
      posted_by:          BigInt(req.user?.id ?? 0),
      posted_date:        new Date(),
      status:             'Draft',
    },
  });
  respond.created(res, 'Claim created', s(row));
});

// PUT /medical/hospital-claims/:id — replace items and recalculate WHT totals for a hospital claim.
exports.updateHospitalClaim = asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');

  const { hospital, items, comment } = req.body;
  if (!Array.isArray(items) || items.length === 0) return respond.badReq(res, 'At least one item is required');

  const hospId = hospital ? toInt(hospital) : null;
  let rate = 0;
  if (hospId) {
    const hosp = await prisma.registeredhospitals.findUnique({ where: { id: hospId }, select: { type: true } }).catch(() => null);
    rate = await getWhtRate(hosp?.type ?? 'Hospital');
  }

  const total_amount        = items.reduce((s, i) => s + parseFloat(i.amount ?? 0), 0);
  const withholding_tax     = parseFloat((total_amount * rate / 100).toFixed(2));
  const total_credit_amount = parseFloat((total_amount - withholding_tax).toFixed(2));

  await prisma.hospitalclaims.update({
    where: { id },
    data: {
      ...(hospId && { hospital: BigInt(hospId) }),
      items:              JSON.stringify(items),
      total_amount,
      withholding_tax,
      total_credit_amount,
      ...(comment !== undefined && { comment }),
    },
  });
  respond.ok(res, 'Claim updated');
});

// DELETE /medical/hospital-claims/:id — permanently remove a hospital claim.
exports.deleteHospitalClaim = asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.hospitalclaims.delete({ where: { id } });
  respond.ok(res, 'Deleted');
});

// POST /medical/hospital-claims/:id/submit — move a Draft hospital claim to Pending Approval.
exports.submitHospitalClaim = asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.hospitalclaims.update({ where: { id }, data: { status: 'Pending Approval' } });
  const flow = await readControlSetting('approval_medical', false)
    ? await snapshotMedicalStages('claim', id)
    : [];
  if (flow.length) notifyMedicalStageApprovers(flow[0], req, null);
  else notifyMedicalStatus(req, null, 'Pending Approval', null, 'hospital medical claim');
  respond.ok(res, 'Claim submitted for approval');
});

// POST /medical/hospital-claims/:id/approve — approve a hospital claim and post to GL: debit medical expense
// per line item, credit hospital account (net of WHT), credit WHT payable GL. Sets status to 'GL Failed'
// on posting error so a retry is possible without re-approving.
exports.approveHospitalClaim = asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');

  // Fetch claim + hospital account
  const [claim] = await prisma.$queryRaw`
    SELECT hc.id, hc.hospital, hc.items, hc.total_amount, hc.withholding_tax, hc.total_credit_amount, hc.posted_by,
           rh.name AS hospital_name, rh.account AS hospital_account
    FROM hospitalclaims hc
    JOIN registeredhospitals rh ON rh.id = hc.hospital
    WHERE hc.id = ${id} LIMIT 1`.catch(() => []);

  // Enforce the "Allow Self-Approval" control — the originator can't approve their own claim when it's off.
  if (claim && !(await assertCanSelfApprove(req, res, claim))) return;

  // Multi-stage gate: only the last stage's approval proceeds to the status change + GL below.
  const stage = await medicalStageApprove(req, res, 'claim', 'hospitalclaims', id, null);
  if (stage.handled && !stage.done) return;
  if (!stage.handled && !assertCanApproveMedical(req, res)) return; // no flow → enforce blanket permission

  // Approve the claim
  await prisma.hospitalclaims.update({
    where: { id },
    data: { status: 'Approved', approved_by: BigInt(req.user?.id ?? 0), approved_date: new Date() },
  });
  if (claim?.posted_by && String(claim.posted_by) !== String(req.user?.id ?? '')) {
    notifyUser(claim.posted_by, { message: 'Your hospital medical claim was approved', action: 'AdminMedical', type: 'medical', fromUser: req.user?.id });
  }

  // GL posting (non-blocking — approval already committed above). Skipped in record-only mode.
  if (claim && (await medicalPaymentsEnabled()) && (await glConfig()).url) {
    try {
      const { expenseGl, whtGl, branch, currency } = await loadGLSettings();

      let items = [];
      try { items = JSON.parse(claim.items ?? '[]'); } catch {}

      const debitAccounts  = [];
      const creditAccounts = [];
      const approvedBy  = req.user?.username || req.user?.email || 'System';
      const referenceNo = `MC${id}${String(Date.now()).slice(-7)}`;

      // DEBIT: one entry per claim item → medical expense GL
      if (expenseGl) {
        for (const item of items) {
          const amt = parseFloat(item.amount ?? 0);
          if (!amt || amt <= 0) continue;
          const narration = [
            'Medical',
            item.employee_name,
            item.type === 'dependent' ? `Dep: ${item.dependent_name}` : null,
            item.narration || null,
          ].filter(Boolean).join(' - ');
          debitAccounts.push({
            debitAmount:    amt,
            debitAccount:   expenseGl,
            debitCurrency:  currency,
            debitNarration: narration,
            debitProdRef:   `MED_${id}_${item.employee_id}`,
            debitBranch:    branch,
          });
        }
      }

      // CREDIT: hospital account → total_credit_amount
      const creditAmt = parseFloat(String(claim.total_credit_amount ?? 0));
      if (creditAmt > 0 && claim.hospital_account) {
        creditAccounts.push({
          creditAmount:    creditAmt,
          creditAccount:   claim.hospital_account,
          creditCurrency:  currency,
          creditNarration: `Hospital Payment - ${claim.hospital_name}`,
          creditProdRef:   `MED_${id}`,
          creditBranch:    branch,
        });
      }

      // CREDIT: WHT payable GL → withholding_tax
      const whtAmt = parseFloat(String(claim.withholding_tax ?? 0));
      if (whtAmt > 0 && whtGl) {
        creditAccounts.push({
          creditAmount:    whtAmt,
          creditAccount:   whtGl,
          creditCurrency:  currency,
          creditNarration: `WHT - ${claim.hospital_name}`,
          creditProdRef:   `MED_${id}_WHT`,
          creditBranch:    branch,
        });
      }

      let documentRef = null;
      let paymentLog  = null;
      if (debitAccounts.length && creditAccounts.length) {
        const result = await postToGL({ approvedBy, referenceNo, debitAccounts, creditAccounts });
        documentRef = result.documentRef;
        paymentLog  = JSON.stringify(result.raw);
        console.log('[medical approve] GL posting success, ref:', documentRef);
      }

      if (documentRef !== null || paymentLog !== null) {
        await prisma.hospitalclaims.updateMany({ where: { id }, data: { document_ref: documentRef, payment_log: paymentLog } });
      }
    } catch (e) {
      const errData = e.glResponse || e.response?.data || e.message;
      console.error('[medical approve] GL posting error:', errData);
      await prisma.hospitalclaims.updateMany({ where: { id }, data: { status: 'GL Failed', payment_log: JSON.stringify({ error: errData }) } });
    }
  }

  const [updated] = await prisma.$queryRaw`SELECT * FROM hospitalclaims WHERE id = ${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'Claim approved, but GL posting failed' : 'Claim approved', response);
});

// POST /medical/hospital-claims/:id/reject — reject a hospital claim with an optional reason.
exports.rejectHospitalClaim = asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { reason = '' } = req.body;
  // Multi-stage gate: the current stage's approver rejects → claim Rejected (handled inside).
  const stage = await medicalStageReject(req, res, 'claim', 'hospitalclaims', id, null, 'hospital medical claim',
    (rsn) => prisma.hospitalclaims.update({ where: { id }, data: { status: 'Rejected', approved_by: BigInt(req.user?.id ?? 0), response: rsn ?? '' } }));
  if (stage.handled) return;
  if (!assertCanApproveMedical(req, res)) return; // no flow → enforce blanket permission
  await prisma.hospitalclaims.update({
    where: { id },
    data: { status: 'Rejected', approved_by: BigInt(req.user?.id ?? 0), response: reason },
  });
  respond.ok(res, 'Claim rejected');
});

// ── STAFF MEDICAL — Action endpoints (mirrors payroll submit/approve/reject/finalize) ──

// POST /medical/staff/:id/submit — move a Draft staff medical record to Pending Approval.
exports.submitStaffMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  if (!(await assertCanMutateMedical(req, res, 'staffmedical', id, 'create_medical'))) return;
  const [rec] = await prisma.$queryRaw`SELECT id, status, employee FROM staffmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Draft') return respond.badReq(res, 'Only Draft records can be submitted');
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE staffmedical SET status='Pending Approval', submitted_by=${userId != null ? BigInt(userId) : null}, updatedAt=NOW() WHERE id=${id}`;
  // Snapshot the approval flow onto this record (all Pending) when medical approval is enabled.
  const flow = await readControlSetting('approval_medical', false)
    ? await snapshotMedicalStages('staff', id)
    : [];
  if (flow.length) notifyMedicalStageApprovers(flow[0], req, rec.employee);
  else notifyMedicalStatus(req, rec.employee, 'Pending Approval', null, 'staff medical claim');
  const [updated] = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id=${id}`;
  respond.ok(res, 'Submitted for approval', serializeMedical(updated));
});

// POST /medical/staff/:id/approve — approve a staff medical claim and GL-post the reimbursement to the
// employee's bank account. Sets status to 'GL Failed' on posting error for retry without re-approving.
exports.approveStaffMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [rec] = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Pending Approval') return respond.badReq(res, 'Record is not pending approval');
  if (!(await assertCanSelfApprove(req, res, rec))) return;
  // Multi-stage gate: only the last stage's approval proceeds to the status change + GL below.
  const stage = await medicalStageApprove(req, res, 'staff', 'staffmedical', id, rec.employee);
  if (stage.handled && !stage.done) return;
  // No flow (single-stage): the stage engine deferred, so enforce the blanket permission here.
  if (!stage.handled && !assertCanApproveMedical(req, res)) return;
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE staffmedical SET status='Approved', approved_by=${userId != null ? String(userId) : null}, updatedAt=NOW() WHERE id=${id}`;
  let glPayload = null;
  if ((await medicalPaymentsEnabled()) && (await glConfig()).url) {
    try {
      const gl  = await loadGLSettings();
      const [emp] = await prisma.$queryRaw`
        SELECT TRIM(CONCAT_WS(' ', firstName, lastName)) AS name, bankAccount FROM employee WHERE id = ${toBigInt(rec.employee)} LIMIT 1`.catch(() => []);
      const result = await postStaffMedicalGL({
        id: String(id), prefix: 'STF', employeeName: emp?.name ?? String(rec.employee),
        illnessType: rec.type_of_illness, cost: rec.cost,
        approvedBy:    req.user?.username || req.user?.email || 'System',
        glExpense:     gl.expenseGl,
        creditAccount: emp?.bankAccount || '',
        branch:        gl.branch,
        currency:      gl.currency,
      });
      if (result) {
        glPayload = result._sentPayload;
        await prisma.$executeRaw`UPDATE staffmedical SET document_ref=${result.documentRef}, payment_log=${JSON.stringify(result.raw)} WHERE id=${id}`;
      }
    } catch (e) {
      const errData = e.glResponse || e.response?.data || e.message;
      console.error('[staff medical approve] GL error:', errData);
      await prisma.$executeRaw`UPDATE staffmedical SET payment_log=${JSON.stringify({ error: errData })} WHERE id=${id}`;
    }
  }
  const [updated] = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id=${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'Approved, but GL posting failed' : 'Approved', { ...response, gl_payload: glPayload });
});

// POST /medical/staff/:id/reject — reject a Pending Approval staff medical record with an optional reason.
exports.rejectStaffMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { reason } = req.body;
  const [rec] = await prisma.$queryRaw`SELECT id, status, employee FROM staffmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Pending Approval') return respond.badReq(res, 'Record is not pending approval');
  // Multi-stage gate: the current stage's approver rejects → record Rejected (handled inside).
  const stage = await medicalStageReject(req, res, 'staff', 'staffmedical', id, rec.employee, 'staff medical claim',
    (rsn, by) => prisma.$executeRaw`UPDATE staffmedical SET status='Rejected', approved_by=${by}, rejection_reason=${rsn}, updatedAt=NOW() WHERE id=${id}`);
  if (stage.handled) return;
  if (!assertCanApproveMedical(req, res)) return; // no flow → enforce blanket permission
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE staffmedical SET status='Rejected', approved_by=${userId != null ? String(userId) : null}, rejection_reason=${reason?.trim() || null}, updatedAt=NOW() WHERE id=${id}`;
  const [updated] = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id=${id}`;
  respond.ok(res, 'Rejected', serializeMedical(updated));
});

// POST /medical/staff/:id/finalize — directly approve a Draft record and trigger GL posting in one step,
// bypassing the submit → approve flow. Useful for HR entering retrospective claims.
exports.finalizeStaffMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [rec] = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Draft') return respond.badReq(res, 'Only Draft records can be finalized');
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE staffmedical SET status='Approved', approved_by=${userId != null ? String(userId) : null}, updatedAt=NOW() WHERE id=${id}`;
  let glPayload = null;
  if ((await medicalPaymentsEnabled()) && (await glConfig()).url) {
    try {
      const gl  = await loadGLSettings();
      const [emp] = await prisma.$queryRaw`
        SELECT TRIM(CONCAT_WS(' ', firstName, lastName)) AS name, bankAccount FROM employee WHERE id = ${toBigInt(rec.employee)} LIMIT 1`.catch(() => []);
      const result = await postStaffMedicalGL({
        id: String(id), prefix: 'STF', employeeName: emp?.name ?? String(rec.employee),
        illnessType: rec.type_of_illness, cost: rec.cost,
        approvedBy:    req.user?.username || req.user?.email || 'System',
        glExpense:     gl.expenseGl,
        creditAccount: emp?.bankAccount || '',
        branch:        gl.branch,
        currency:      gl.currency,
      });
      if (result) {
        glPayload = result._sentPayload;
        await prisma.$executeRaw`UPDATE staffmedical SET document_ref=${result.documentRef}, payment_log=${JSON.stringify(result.raw)} WHERE id=${id}`;
      }
    } catch (e) {
      const errData = e.glResponse || e.response?.data || e.message;
      console.error('[staff medical finalize] GL error:', errData);
      await prisma.$executeRaw`UPDATE staffmedical SET payment_log=${JSON.stringify({ error: errData })} WHERE id=${id}`;
    }
  }
  const [updated] = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id=${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'Finalized, but GL posting failed' : 'Finalized', { ...response, gl_payload: glPayload });
});

// ── DEPENDENT MEDICAL — Action endpoints ──────────────────────────────────────

// POST /medical/dependent/:id/submit — move a Draft dependent medical record to Pending Approval.
exports.submitDependentMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  if (!(await assertCanMutateMedical(req, res, 'dependentmedical', id, 'create_medical'))) return;
  const [rec] = await prisma.$queryRaw`SELECT id, status, employee FROM dependentmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Draft') return respond.badReq(res, 'Only Draft records can be submitted');
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE dependentmedical SET status='Pending Approval', submitted_by=${userId != null ? BigInt(userId) : null} WHERE id=${id}`;
  const flow = await readControlSetting('approval_medical', false)
    ? await snapshotMedicalStages('dependent', id)
    : [];
  if (flow.length) notifyMedicalStageApprovers(flow[0], req, rec.employee);
  else notifyMedicalStatus(req, rec.employee, 'Pending Approval', null, 'dependent medical claim');
  const [updated] = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id=${id}`;
  respond.ok(res, 'Submitted for approval', serializeMedical(updated));
});

// POST /medical/dependent/:id/approve — approve a dependent medical claim and GL-post reimbursement to
// the employee's bank account. Sets status to 'GL Failed' on posting error for retry.
exports.approveDependentMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [rec] = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Pending Approval') return respond.badReq(res, 'Record is not pending approval');
  if (!(await assertCanSelfApprove(req, res, rec))) return;
  const stage = await medicalStageApprove(req, res, 'dependent', 'dependentmedical', id, rec.employee);
  if (stage.handled && !stage.done) return;
  if (!stage.handled && !assertCanApproveMedical(req, res)) return; // no flow → enforce blanket permission
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE dependentmedical SET status='Approved', approved_by=${userId != null ? String(userId) : null} WHERE id=${id}`;
  let glPayload = null;
  if ((await medicalPaymentsEnabled()) && (await glConfig()).url) {
    try {
      const gl  = await loadGLSettings();
      const [emp] = await prisma.$queryRaw`
        SELECT TRIM(CONCAT_WS(' ', firstName, lastName)) AS name, bankAccount FROM employee WHERE id = ${toBigInt(rec.employee)} LIMIT 1`.catch(() => []);
      const desc = [rec.dependant_name, rec.type_of_illness].filter(Boolean).join(' - ');
      const result = await postStaffMedicalGL({
        id: String(id), prefix: 'DEP', employeeName: emp?.name ?? String(rec.employee),
        illnessType: desc, cost: rec.cost,
        approvedBy:    req.user?.username || req.user?.email || 'System',
        glExpense:     gl.expenseGl,
        creditAccount: emp?.bankAccount || '',
        branch:        gl.branch,
        currency:      gl.currency,
      });
      if (result) {
        glPayload = result._sentPayload;
        await prisma.$executeRaw`UPDATE dependentmedical SET document_ref=${result.documentRef}, payment_log=${JSON.stringify(result.raw)} WHERE id=${id}`;
      }
    } catch (e) {
      const errData = e.glResponse || e.response?.data || e.message;
      console.error('[dep medical approve] GL error:', errData);
      await prisma.$executeRaw`UPDATE dependentmedical SET payment_log=${JSON.stringify({ error: errData })} WHERE id=${id}`;
    }
  }
  const [updated] = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id=${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'Approved, but GL posting failed' : 'Approved', { ...response, gl_payload: glPayload });
});

// POST /medical/dependent/:id/reject — reject a Pending Approval dependent medical record with an optional reason.
exports.rejectDependentMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { reason } = req.body;
  const [rec] = await prisma.$queryRaw`SELECT id, status, employee FROM dependentmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Pending Approval') return respond.badReq(res, 'Record is not pending approval');
  const stage = await medicalStageReject(req, res, 'dependent', 'dependentmedical', id, rec.employee, 'dependent medical claim',
    (rsn, by) => prisma.$executeRaw`UPDATE dependentmedical SET status='Rejected', approved_by=${by}, rejection_reason=${rsn} WHERE id=${id}`);
  if (stage.handled) return;
  if (!assertCanApproveMedical(req, res)) return; // no flow → enforce blanket permission
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE dependentmedical SET status='Rejected', approved_by=${userId != null ? String(userId) : null}, rejection_reason=${reason?.trim() || null} WHERE id=${id}`;
  const [updated] = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id=${id}`;
  respond.ok(res, 'Rejected', serializeMedical(updated));
});

// POST /medical/dependent/:id/finalize — directly approve a Draft dependent record and GL-post in one step.
exports.finalizeDependentMedical = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [rec] = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'Draft') return respond.badReq(res, 'Only Draft records can be finalized');
  const userId = req.user?.id ? Number(req.user.id) : null;
  await prisma.$executeRaw`UPDATE dependentmedical SET status='Approved', approved_by=${userId != null ? String(userId) : null} WHERE id=${id}`;
  let glPayload = null;
  if ((await medicalPaymentsEnabled()) && (await glConfig()).url) {
    try {
      const gl  = await loadGLSettings();
      const [emp] = await prisma.$queryRaw`
        SELECT TRIM(CONCAT_WS(' ', firstName, lastName)) AS name, bankAccount FROM employee WHERE id = ${toBigInt(rec.employee)} LIMIT 1`.catch(() => []);
      const desc = [rec.dependant_name, rec.type_of_illness].filter(Boolean).join(' - ');
      const result = await postStaffMedicalGL({
        id: String(id), prefix: 'DEP', employeeName: emp?.name ?? String(rec.employee),
        illnessType: desc, cost: rec.cost,
        approvedBy:    req.user?.username || req.user?.email || 'System',
        glExpense:     gl.expenseGl,
        creditAccount: emp?.bankAccount || '',
        branch:        gl.branch,
        currency:      gl.currency,
      });
      if (result) {
        glPayload = result._sentPayload;
        await prisma.$executeRaw`UPDATE dependentmedical SET document_ref=${result.documentRef}, payment_log=${JSON.stringify(result.raw)} WHERE id=${id}`;
      }
    } catch (e) {
      const errData = e.glResponse || e.response?.data || e.message;
      console.error('[dep medical finalize] GL error:', errData);
      await prisma.$executeRaw`UPDATE dependentmedical SET payment_log=${JSON.stringify({ error: errData })} WHERE id=${id}`;
    }
  }
  const [updated] = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id=${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'Finalized, but GL posting failed' : 'Finalized', { ...response, gl_payload: glPayload });
});

// ── GL Retry endpoints ────────────────────────────────────────────────────────

async function retryMedicalGL(table, id, req) {
  const [rec] = await prisma.$queryRaw`SELECT * FROM ${Prisma.raw(table)} WHERE id = ${id}`;
  if (!rec) return null;

  const gl = await loadGLSettings();
  const [emp] = await prisma.$queryRaw`
    SELECT TRIM(CONCAT_WS(' ', firstName, lastName)) AS name, bankAccount FROM employee WHERE id = ${toBigInt(rec.employee)} LIMIT 1`.catch(() => []);

  const prefix   = table === 'staffmedical' ? 'STF' : 'DEP';
  const desc     = table === 'staffmedical'
    ? rec.type_of_illness
    : [rec.dependant_name, rec.type_of_illness].filter(Boolean).join(' - ');

  const result = await postStaffMedicalGL({
    id: String(id), prefix,
    employeeName:  emp?.name ?? String(rec.employee),
    illnessType:   desc,
    cost:          rec.cost,
    approvedBy:    req.user?.username || req.user?.email || 'System',
    glExpense:     gl.expenseGl,
    creditAccount: emp?.bankAccount || '',
    branch:        gl.branch,
    currency:      gl.currency,
  });
  return result;
}

// POST /medical/staff/:id/retry-gl — re-attempt GL posting for a staff medical record stuck in 'GL Failed'.
// Blocked if the GL already posted (document_ref exists) or POSTING_API_URL is not configured.
exports.retryStaffMedicalGL = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [rec] = await prisma.$queryRaw`SELECT id, status, document_ref, payment_log FROM staffmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'GL Failed' && !hasMedicalGlFailure(rec)) return respond.badReq(res, 'Only GL Failed records can retry posting');
  if (rec.document_ref) return respond.badReq(res, 'GL already posted for this record');
  if (!(await medicalPaymentsEnabled())) return respond.badReq(res, 'Medical GL posting is disabled in settings');
  if (!(await glConfig()).url) return respond.badReq(res, "POSTING_API_URL not configured");
  try {
    const result = await retryMedicalGL('staffmedical', id, req);
    if (result) {
      await prisma.$executeRaw`UPDATE staffmedical SET status='Approved', document_ref=${result.documentRef}, payment_log=${JSON.stringify(result.raw)} WHERE id=${id}`;
    }
  } catch (e) {
    const errData = e.glResponse || e.response?.data || e.message;
    await prisma.$executeRaw`UPDATE staffmedical SET payment_log=${JSON.stringify({ error: errData })} WHERE id=${id}`;
  }
  const [updated] = await prisma.$queryRaw`SELECT * FROM staffmedical WHERE id=${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'GL posting failed' : 'GL posted successfully', response);
});

// POST /medical/dependent/:id/retry-gl — re-attempt GL posting for a dependent medical record stuck in 'GL Failed'.
exports.retryDependentMedicalGL = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [rec] = await prisma.$queryRaw`SELECT id, status, document_ref, payment_log FROM dependentmedical WHERE id = ${id}`;
  if (!rec) return respond.notFound(res, 'Record not found');
  if (rec.status !== 'GL Failed' && !hasMedicalGlFailure(rec)) return respond.badReq(res, 'Only GL Failed records can retry posting');
  if (rec.document_ref) return respond.badReq(res, 'GL already posted for this record');
  if (!(await medicalPaymentsEnabled())) return respond.badReq(res, 'Medical GL posting is disabled in settings');
  if (!(await glConfig()).url) return respond.badReq(res, "POSTING_API_URL not configured");
  try {
    const result = await retryMedicalGL('dependentmedical', id, req);
    if (result) {
      await prisma.$executeRaw`UPDATE dependentmedical SET status='Approved', document_ref=${result.documentRef}, payment_log=${JSON.stringify(result.raw)} WHERE id=${id}`;
    }
  } catch (e) {
    const errData = e.glResponse || e.response?.data || e.message;
    await prisma.$executeRaw`UPDATE dependentmedical SET payment_log=${JSON.stringify({ error: errData })} WHERE id=${id}`;
  }
  const [updated] = await prisma.$queryRaw`SELECT * FROM dependentmedical WHERE id=${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'GL posting failed' : 'GL posted successfully', response);
});

// POST /medical/hospital-claims/:id/retry-gl — re-attempt full GL posting for a hospital claim stuck in 'GL Failed';
// rebuilds the same debit/credit/WHT journal as the original approve.
exports.retryHospitalClaimGL = asyncHandler(async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [claim] = await prisma.$queryRaw`
    SELECT hc.*, rh.name AS hospital_name, rh.account AS hospital_account
    FROM hospitalclaims hc
    JOIN registeredhospitals rh ON rh.id = hc.hospital
    WHERE hc.id = ${id} LIMIT 1`.catch(() => []);
  if (!claim) return respond.notFound(res, 'Claim not found');
  if (claim.status !== 'GL Failed') return respond.badReq(res, 'Only GL Failed claims can retry posting');
  if (claim.document_ref) return respond.badReq(res, 'GL already posted for this claim');
  if (!(await medicalPaymentsEnabled())) return respond.badReq(res, 'Medical GL posting is disabled in settings');
  if (!(await glConfig()).url) return respond.badReq(res, "POSTING_API_URL not configured");

  try {
    const { expenseGl, whtGl, branch, currency } = await loadGLSettings();
    let items = [];
    try { items = JSON.parse(claim.items ?? '[]'); } catch {}

    const debitAccounts = [];
    const creditAccounts = [];
    const approvedBy  = req.user?.username || req.user?.email || 'System';
    const referenceNo = `MC${id}${String(Date.now()).slice(-7)}`;

    if (expenseGl) {
      for (const item of items) {
        const amt = parseFloat(item.amount ?? 0);
        if (!amt || amt <= 0) continue;
        const narration = ['Medical', item.employee_name, item.type === 'dependent' ? `Dep: ${item.dependent_name}` : null, item.narration || null].filter(Boolean).join(' - ');
        debitAccounts.push({ debitAmount: amt, debitAccount: expenseGl, debitCurrency: currency, debitNarration: narration, debitProdRef: `BS_${id}_${item.employee_id}`, debitBranch: branch });
      }
    }
    const creditAmt = parseFloat(String(claim.total_credit_amount ?? 0));
    if (creditAmt > 0 && claim.hospital_account) {
      creditAccounts.push({ creditAmount: creditAmt, creditAccount: claim.hospital_account, creditCurrency: currency, creditNarration: `Hospital Payment - ${claim.hospital_name}`, creditProdRef: `NS_${id}`, creditBranch: branch });
    }
    const whtAmt = parseFloat(String(claim.withholding_tax ?? 0));
    if (whtAmt > 0 && whtGl) {
      creditAccounts.push({ creditAmount: whtAmt, creditAccount: whtGl, creditCurrency: currency, creditNarration: `WHT - ${claim.hospital_name}`, creditProdRef: `NS_${id}_WHT`, creditBranch: branch });
    }

    if (debitAccounts.length && creditAccounts.length) {
      const result = await postToGL({ approvedBy, referenceNo, debitAccounts, creditAccounts });
      await prisma.hospitalclaims.updateMany({ where: { id }, data: { status: 'Approved', document_ref: result.documentRef, payment_log: JSON.stringify(result.raw) } });
    }
  } catch (e) {
    const errData = e.glResponse || e.response?.data || e.message;
    await prisma.hospitalclaims.updateMany({ where: { id }, data: { payment_log: JSON.stringify({ error: errData }) } });
  }
  const [updated] = await prisma.$queryRaw`SELECT * FROM hospitalclaims WHERE id = ${id}`;
  const response = serializeMedical(updated);
  respond.ok(res, response.status === 'GL Failed' ? 'GL posting failed' : 'GL posted successfully', response);
});

// ── YEAR-END UTILIZATION RESET ──────────────────────────────────────────────────

// GET /medical/utilization/history — closing snapshots from past medical years.
// Optional ?period= filters to a single closed year.
exports.getUtilizationHistory = asyncHandler(async (req, res) => {
  const { period } = req.query;
  const rows = period
    ? await prisma.$queryRaw`SELECT * FROM medicalutilizationhistory WHERE period_label = ${String(period)} ORDER BY employee_name ASC`.catch(() => [])
    : await prisma.$queryRaw`SELECT * FROM medicalutilizationhistory ORDER BY closed_at DESC, employee_name ASC`.catch(() => []);
  respond.ok(res, 'Medical utilization history', rows.map(r => s(r)));
});

// POST /medical/utilization/reset — start a new medical year. Snapshots every active employee's
// current utilization into medicalutilizationhistory, then advances the reset point so the
// enquiries recompute from 0. Non-destructive: no medical records or GL postings are touched.
exports.resetMedicalUtilization = asyncHandler(async (req, res) => {
  const periodLabel = String(req.body?.period_label ?? '').trim() || String(new Date().getFullYear());

  // Block an accidental second close of the same year.
  const dup = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM medicalutilizationhistory WHERE period_label = ${periodLabel}`.catch(() => [{ n: 0 }]);
  if (Number(dup?.[0]?.n ?? 0) > 0) {
    return respond.badReq(res, tmsg('medical.year_closed', { period: periodLabel }));
  }

  // Compute current utilization for every active employee (same logic as getMedicalEnquiry).
  const employees = await prisma.$queryRaw`
    SELECT e.id, e.firstName, e.lastName, e.employee_id,
           pg.id AS pg_id, pg.name AS pg_name
    FROM employee e
    LEFT JOIN paygrades pg ON pg.id = e.paygradeId
    WHERE e.lifecycleStatus != 'TERMINATED'
    ORDER BY e.firstName ASC`;

  const limits = await prisma.$queryRaw`SELECT * FROM medicallimit WHERE paygrade_id IS NOT NULL`;
  const limitByGrade = {};
  for (const lim of limits) { if (lim.paygrade_id) limitByGrade[String(lim.paygrade_id)] = lim; }

  const cut  = await getUtilizationCutoff();
  const frag = cutoffFragments(cut);
  const staffCosts = await prisma.$queryRaw`SELECT employee, SUM(cost) as total FROM staffmedical WHERE status = 'Approved'${Prisma.raw(frag.staff)} GROUP BY employee`;
  const depCosts = await prisma.$queryRaw`SELECT employee, SUM(cost) as total FROM dependentmedical WHERE status = 'Approved'${Prisma.raw(frag.dep)} GROUP BY employee`;
  const staffMap = Object.fromEntries((staffCosts ?? []).map(r => [String(r.employee), parseFloat(r.total ?? 0)]));
  const depMap   = Object.fromEntries((depCosts   ?? []).map(r => [String(r.employee), parseFloat(r.total ?? 0)]));

  const approvedClaims = await prisma.$queryRaw`SELECT items FROM hospitalclaims WHERE status = 'Approved'${Prisma.raw(frag.claim)}`.catch(() => []);
  for (const claim of approvedClaims) {
    let claimItems = [];
    try { claimItems = JSON.parse(claim.items ?? '[]'); } catch {}
    for (const item of claimItems) {
      const empKey = String(item.employee_id);
      const amt    = parseFloat(item.amount ?? 0);
      if (item.type === 'dependent') depMap[empKey]   = (depMap[empKey]   ?? 0) + amt;
      else                           staffMap[empKey] = (staffMap[empKey] ?? 0) + amt;
    }
  }

  const now      = new Date();
  const closedBy = req.user?.id ? BigInt(req.user.id) : null;
  const { userName } = fromReq(req);

  let count = 0;
  for (const emp of employees) {
    const pgId      = emp.pg_id ? String(emp.pg_id) : null;
    const lim       = pgId ? limitByGrade[pgId] : null;
    const limit     = lim ? parseFloat(lim.amount ?? 0) : null;
    const currency  = lim?.currency ?? '';
    const staffUsed = staffMap[String(emp.id)] ?? 0;
    const depUsed   = depMap[String(emp.id)]   ?? 0;
    const utilized  = staffUsed + depUsed;
    const balance   = limit !== null ? limit - utilized : null;
    const name      = `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim();

    await prisma.$executeRaw`INSERT INTO medicalutilizationhistory
         (period_label, employee_id, employee_name, grade, currency, medical_limit,
          staff_utilized, dep_utilized, total_utilized, limit_balance, closed_at, closed_by, closed_by_name)
       VALUES (${periodLabel}, ${BigInt(emp.id)}, ${name}, ${emp.pg_name ?? null}, ${currency},
               ${limit}, ${staffUsed}, ${depUsed}, ${utilized}, ${balance}, ${now}, ${closedBy}, ${userName ?? null})`;
    count++;
  }

  // Advance the reset point — from now on utilization recomputes from 0.
  await upsertSetting(RESET_AT_KEY, now.toISOString(), SETTINGS_CAT);

  logActivity({
    module: 'Medical', action: 'reset_utilization', entityName: periodLabel,
    details: { period_label: periodLabel, employees: count }, ...fromReq(req),
  });

  respond.ok(res, tmsg('medical.year_started', { count }), {
    period_label: periodLabel, employees: count,
  });
});
