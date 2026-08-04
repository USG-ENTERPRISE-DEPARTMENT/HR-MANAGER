// ─────────────────────────────────────────────────────────────────────────────
// Mobile self-service delegation layer (`/v1/api/hr/me/*`)
//
// This file deliberately contains NO business logic. Leave accrual, medical limits, payroll and the
// multi-stage approval rules are intricate and already correct in their own controllers; forking
// them here would guarantee the mobile app and the web app eventually disagree about, say, how many
// leave days someone has left.
//
// Every handler does the same three things:
//   1. Force the employee to `req.self.id`, discarding anything the caller sent.
//   2. Strip parameters that would widen the query beyond the caller's own records (`?all=1`).
//   3. Delegate to the existing exported controller function.
//
// `req.self` is set by mobileAuth and is the ONLY trusted source of identity on this path.
// ─────────────────────────────────────────────────────────────────────────────
const { Prisma } = require('@prisma/client');
const { prisma } = require('../helpers/dbQueryHelper');
const { toBigInt } = require('../helpers/controllerHelpers');
const respond = require('../helpers/respondHelper');
const asyncHandler = require('../middleware/asyncHandler');

const leave      = require('./leaveController');
const med        = require('./medicalController');
const payslip    = require('./payslipController');
const attendance = require('./attendanceController');
const training   = require('./trainingController');
const perf       = require('./performanceController');
const docs       = require('./documentController');
const notif      = require('./notificationController');
const employee   = require('./employeeController');

// ── Scoping utilities ────────────────────────────────────────────────────────

/** Force `employee` in the body to the authenticated employee, discarding any caller value. */
const ownBody = (req, extra = {}) => {
  req.body = { ...req.body, employee: String(req.self.id), ...extra };
  delete req.body.employeeId;      // auth field, never a payload field
  return req;
};

/**
 * Remove every query parameter that widens a listing beyond the caller's own rows.
 * `all=1` on leaveController.getLeaves returns EVERY employee's leave — forwarding it would
 * turn a self-service endpoint into a full data dump.
 */
const ownQuery = (req, extra = {}) => {
  const q = { ...req.query, ...extra };
  delete q.all;
  delete q.employeeId;
  req.query = q;
  return req;
};

/**
 * Confirm a record belongs to the authenticated employee before acting on it.
 * The API key proves only "some holder of the key"; this proves the record is actually theirs.
 * Table names are from a fixed internal allowlist at each call site — never caller input.
 */
async function ownsRecord(table, id, selfId) {
  const rid = toBigInt(id);
  if (rid == null) return false;
  // `Prisma.raw` interpolates the (allowlisted, never user-supplied) table name; the id binds through
  // the tagged template so the placeholder is emitted correctly per provider. A hardcoded `?` here
  // was a MySQL-ism that threw a syntax error on Postgres — swallowed by the catch, so every
  // ownership check silently failed with "Record not found".
  const rows = await prisma.$queryRaw(
    Prisma.sql`SELECT employee FROM ${Prisma.raw(table)} WHERE id = ${rid} LIMIT 1`,
  ).catch(() => []);
  const owner = rows?.[0]?.employee;
  return owner != null && String(owner) === String(selfId);
}

/** Guard factory: 404 unless the addressed record belongs to the caller. */
const requireOwnership = (table) => asyncHandler(async (req, res, next) => {
  if (!(await ownsRecord(table, req.params.id, req.self.id))) {
    // 404 rather than 403 so the response does not confirm the record exists.
    return respond.notFound(res, 'Record not found');
  }
  next();
});

// ── Profile ──────────────────────────────────────────────────────────────────

exports.getProfile = asyncHandler(async (req, res) => {
  req.params.id = String(req.self.id);
  return employee.getEmployeeById(req, res);
});

// Only fields an employee may change about themselves. Everything else — pay grade, job title,
// department, status, supervisor — is an HR decision and is silently dropped rather than rejected,
// so an over-eager client cannot escalate by including extra keys.
const SELF_EDITABLE = ['phone', 'personal_email', 'address', 'residential_address', 'city', 'country'];

exports.updateProfile = asyncHandler(async (req, res) => {
  const patch = {};
  for (const f of SELF_EDITABLE) if (req.body[f] !== undefined) patch[f] = req.body[f];
  if (Object.keys(patch).length === 0) {
    return respond.badReq(res, `No editable fields supplied. Allowed: ${SELF_EDITABLE.join(', ')}`);
  }
  req.params.id = String(req.self.id);
  req.body = patch;
  return employee.updateEmployee(req, res);
});

// ── Leave ────────────────────────────────────────────────────────────────────

exports.getLeaves     = (req, res, next) => leave.getLeaves(ownQuery(req), res, next);
exports.applyLeave    = (req, res, next) => leave.applyLeave(ownBody(req), res, next);
exports.getLeaveTypes = (req, res, next) => leave.getLeaveTypes(req, res, next);

exports.getLeaveBalance = (req, res, next) => {
  req.params.employeeId = String(req.self.id);
  return leave.getLeaveBalance(req, res, next);
};

exports.submitLeave = (req, res, next) => leave.submitLeave(req, res, next);
exports.cancelLeave = (req, res, next) => leave.cancelLeave(req, res, next);
exports.updateLeave = (req, res, next) => leave.updateLeave(ownBody(req), res, next);
exports.deleteLeave = (req, res, next) => leave.deleteLeave(req, res, next);
exports.leaveOwnership = requireOwnership('employeeleaves');

// ── Payslips ─────────────────────────────────────────────────────────────────
// How these resolve the employee differs, which matters because payslips are the most sensitive
// data on this API:
//   • getMyTaxSummary prefers req.user.employeeId (set by mobileAuth) — exact, nothing to do.
//   • getMyPayslips resolves ONLY by string match:
//       employee.email = req.user.email OR work_email = req.user.email OR employee_id = req.user.username
//     It never consults employeeId, so it cannot be pinned from here without editing that
//     controller. mobileAuth fills email/username from the resolved employee row, so the match does
//     land on the right person, and every response echoes `data.employeeId` — assert on that in
//     tests. If two employees ever share an email address this becomes ambiguous; fixing it properly
//     means teaching payslipController to prefer employeeId, as getMyTaxSummary already does.

exports.getMyPayslips = (req, res, next) => payslip.getMyPayslips(req, res, next);

exports.getMyTaxSummary = (req, res, next) => {
  req.user = { ...req.user, employeeId: String(req.self.id) };
  return payslip.getMyTaxSummary(req, res, next);
};

exports.downloadPayslip = (req, res, next) => {
  // The web route takes :empId from the URL; pin it to the caller so one employee cannot fetch
  // another's payslip PDF by editing the path.
  req.params.empId = String(req.self.id);
  return payslip.downloadPayslip(req, res, next);
};

// ── Attendance ───────────────────────────────────────────────────────────────
// attendanceController resolves the employee via req.user.employeeId, already set by mobileAuth.

exports.punch       = (req, res, next) => attendance.punch(req, res, next);
exports.getToday    = (req, res, next) => attendance.getToday(req, res, next);
exports.getTimesheet = (req, res, next) =>
  // `personal=1` forces the self branch; without it a caller-supplied `employee` would be honoured.
  attendance.getTimesheet(ownQuery(req, { personal: '1', employee: undefined }), res, next);

// ── Medical ──────────────────────────────────────────────────────────────────
// The list endpoints branch on the `view_medical` permission; mobileAuth grants no permissions, so
// they take the self-scoped branch. Do not add permissions to the synthetic user.

exports.getStaffMedical     = (req, res, next) => med.getStaffMedical(req, res, next);
exports.createStaffMedical  = (req, res, next) => med.createStaffMedical(ownBody(req), res, next);
exports.submitStaffMedical  = (req, res, next) => med.submitStaffMedical(req, res, next);
exports.staffMedicalOwnership = requireOwnership('staffmedical');

exports.getDependentMedical    = (req, res, next) => med.getDependentMedical(req, res, next);
exports.createDependentMedical = (req, res, next) => med.createDependentMedical(ownBody(req), res, next);
exports.submitDependentMedical = (req, res, next) => med.submitDependentMedical(req, res, next);
exports.dependentMedicalOwnership = requireOwnership('dependentmedical');

exports.getMedicalEnquiry = (req, res, next) => med.getMyMedicalEnquiry(req, res, next);

// ── Training ─────────────────────────────────────────────────────────────────

exports.getCatalog = (req, res, next) => training.getCatalog(req, res, next);

// `personal=1` is mandatory here: without it getNominations returns EVERY employee's nomination
// (it treats screen access as the gate, which does not exist on this path).
exports.getNominations = (req, res, next) =>
  training.getNominations(ownQuery(req, { personal: '1' }), res, next);

exports.createNomination = (req, res, next) => training.createNomination(ownBody(req), res, next);
exports.submitNomination = (req, res, next) => training.submitNomination(req, res, next);
exports.nominationOwnership = requireOwnership('trainingnomination');

// ── Performance ──────────────────────────────────────────────────────────────

exports.getMyReviews = (req, res, next) => perf.getMyReviews(req, res, next);
exports.submitSelfAssessment = (req, res, next) => perf.submitSelfAssessment(req, res, next);
exports.getGoals   = (req, res, next) => perf.getGoals(ownQuery(req, { employee_id: String(req.self.id) }), res, next);
exports.createGoal = (req, res, next) => perf.createGoal(ownBody(req, { employee_id: String(req.self.id) }), res, next);

// ── Documents & notifications ────────────────────────────────────────────────

exports.getMyDocuments   = (req, res, next) => docs.getMyPersonalDocs(req, res, next);
exports.getSharedDocuments = (req, res, next) => docs.getMySharedDocs(req, res, next);
exports.getCompanyDocs   = (req, res, next) => docs.getCompanyDocs(req, res, next);

// Serve an uploaded file by its stored filename. The web app uses the public /documents/:filename for
// this; mobile needs the same capability under /me. Filenames are unguessable HMAC-SHA256 hashes and
// the caller is already authenticated by mobileAuth, so this matches the web route's exposure.
exports.downloadDocument = (req, res, next) => docs.downloadDocument(req, res, next);

exports.getNotifications = (req, res, next) => notif.list(req, res, next);
exports.markRead    = (req, res, next) => notif.markRead(req, res, next);
exports.markAllRead = (req, res, next) => notif.markAllRead(req, res, next);

exports.unreadCount = asyncHandler(async (req, res) => {
  const uid = toBigInt(req.user?.id);
  if (uid == null) return respond.ok(res, 'Unread count', { count: 0 });
  // Column/flag names mirror notificationController: recipient is `toUser`, unread is status 'Unread'.
  const count = await prisma.notifications.count({ where: { toUser: uid, status: 'Unread' } }).catch(() => 0);
  respond.ok(res, 'Unread count', { count });
});

// ── Supervisor approvals ─────────────────────────────────────────────────────

/**
 * Approve/reject routes must confirm the target is a direct report. The underlying controllers do
 * authorise internally, but they assume a real JWT carrying roles and permissions — the synthetic
 * mobile user has neither, so that check cannot be relied on here. This is the actual gate.
 */
const requireSubordinate = (table) => asyncHandler(async (req, res, next) => {
  const rid = toBigInt(req.params.id);
  if (rid == null) return respond.notFound(res, 'Record not found');

  const rows = await prisma.$queryRaw(
    Prisma.sql`SELECT employee FROM ${Prisma.raw(table)} WHERE id = ${rid} LIMIT 1`,
  ).catch(() => []);
  const targetEmp = rows?.[0]?.employee;
  if (targetEmp == null) return respond.notFound(res, 'Record not found');

  const [emp] = await prisma.$queryRaw`
    SELECT supervisorid FROM employee WHERE id = ${toBigInt(targetEmp)} LIMIT 1`.catch(() => []);

  if (!emp?.supervisorid || String(emp.supervisorid) !== String(req.self.id)) {
    return respond.forbidden(res, 'You are not the supervisor for this request');
  }
  next();
});

exports.requireLeaveSubordinate     = requireSubordinate('employeeleaves');
exports.requireMedicalSubordinate   = requireSubordinate('staffmedical');
exports.requireTrainingSubordinate  = requireSubordinate('training_nomination');

exports.getApprovals = (req, res, next) => leave.getLeaveCentralApproval(req, res, next);
exports.getSubordinates = (req, res, next) => leave.getSubordinateEmployees(req, res, next);
exports.getSubordinateLeaves = (req, res, next) => leave.getSubordinateLeaves(req, res, next);

exports.approveLeave = (req, res, next) => leave.approveLeave(req, res, next);
exports.rejectLeave  = (req, res, next) => leave.rejectLeave(req, res, next);
exports.approveMedical = (req, res, next) => med.approveStaffMedical(req, res, next);
exports.rejectMedical  = (req, res, next) => med.rejectStaffMedical(req, res, next);
exports.approveTraining = (req, res, next) => training.supervisorApproveNomination(req, res, next);
exports.rejectTraining  = (req, res, next) => training.supervisorRejectNomination(req, res, next);
