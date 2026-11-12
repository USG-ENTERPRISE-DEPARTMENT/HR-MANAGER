// Out of Station allowance.
//
// Staff sent on duty away from their station are paid days × the daily rate for their pay grade.
// The number of days is entered on the request — not worked out from the dates, since some staff are
// paid by nights away — and the allowance is not taxed.
//
// HR raises every request (manage_out_of_station); employees never raise their own and only see their
// own requests, read-only, under Personal Out of Station. One form can raise requests for several
// employees at once — one request each, same period and days, each at its own grade's rate.
//
// Approval follows the Out of Station approval flow (Settings → Controls → Approvals), like payroll:
// an ordered list of stages, each approved by a role or a specific user. The flow is copied onto the
// request when it is submitted, so editing the flow never changes a request already in approval. With
// no stages configured, one approval by anyone with approve_out_of_station is enough. The final
// approval posts it to the GL: Dr the out-of-station expense account, Cr the employee's bank account.
//
// Status flow:  Draft → Pending Approval (stage 1 … n) → Approved → Posting → Paid
//                                                                       └→ GL Failed → (retry) → Posting → Paid
//               Rejected / Cancelled from any open state.
// With postings switched off a request stops at Approved (record only) and can be posted later.
//
// Every status change is a conditional UPDATE (… WHERE status = <the status we read>) and only the
// caller whose UPDATE changed the row goes on — two clicks, or two approvers at once, can never both
// approve or both post. "Posting" is held while the GL call is in flight for the same reason.
//
// Maker-checker: whoever raised or submitted a request cannot approve it at any stage, and one person
// cannot approve two stages of the same request.
//
// Tables come from manual-migrations/20261026_out_of_station.*.sql and 20261112_out_of_station_stages.*.sql
// and are read with raw SQL, so this module needs no regenerated Prisma client. Ids are generated here.
const { Prisma }   = require('@prisma/client');
const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const { toBigInt, s } = require('../helpers/controllerHelpers');
const { postToGL } = require('../helpers/glHelper');
const { getApiConfig } = require('./apiIntegrationController');
const { upsertSetting, getSystemCurrency } = require('../helpers/settingsHelper');
const { notifyEmployee, notifyUser, notifyUsersWithPermission, notifyUsersWithRole } = require('../helpers/notificationHelper');
const { logActivity, fromReq } = require('./auditController');

const SETTINGS_CAT = 'out_of_station';
const SETTING_DEFAULTS = {
  oos_expense_gl:       '',     // Dr account for every posting
  oos_gl_branch:        '',     // posting branch; blank → gl_extra.branch → '000'
  oos_payments_enabled: 'Yes',  // No → requests stop at Approved, nothing is sent to the GL
};
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);
const FLOW_KEY = 'out_of_station_approval_flow';   // app_controls, JSON list of stages

// The database is a remote link with high latency; Prisma's 2s default to start a transaction is too short.
const TX_OPTS = { maxWait: 15000, timeout: 30000 };

const OPEN_STATUSES   = ['Draft', 'Pending Approval'];
const ACTIVE_STATUSES = [...OPEN_STATUSES, 'Approved', 'Posting', 'Paid', 'GL Failed'];   // block overlapping dates

const CONFLICT_MSG = 'This request was changed by someone else a moment ago. Refresh to see its current status.';

/** Thrown inside a transaction when a conditional UPDATE finds the row already moved on. */
class Conflict extends Error {}

// ── Helpers ───────────────────────────────────────────────────────────────────

const newId   = () => BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
const round2  = (n) => Math.round(Number(n) * 100) / 100;
const hasPerm = (req, p) => Array.isArray(req.user?.permissions) && req.user.permissions.includes(p);
const isAdmin = (req) => (req.user?.roles ?? []).some(r => ['admin', 'super-admin'].includes(String(r)));
const myEmployeeId = (req) => (req.user?.employeeId != null ? String(req.user.employeeId) : null);
const myUserId     = (req) => String(req.user?.id ?? '');

/** Approves when no flow is configured; retries and posts to the GL. */
const isHrApprover = (req) => isAdmin(req) || hasPerm(req, 'approve_out_of_station');
/** Raises, edits, submits and cancels requests; sets rates and the approval flow. */
const canManage    = (req) => isAdmin(req) || hasPerm(req, 'manage_out_of_station');
/** The All Requests list and the printed schedule. */
const canViewAll   = (req) => canManage(req) || isHrApprover(req) || hasPerm(req, 'view_out_of_station');

/** 'YYYY-MM-DD' → a UTC-midnight Date, or null. */
function parseDay(value) {
  const str = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function readSettings() {
  const rows = await prisma.settings
    .findMany({ where: { category: SETTINGS_CAT }, select: { name: true, value: true } })
    .catch(() => []);
  const map = { ...SETTING_DEFAULTS };
  for (const r of rows) if (SETTING_KEYS.includes(r.name)) map[r.name] = r.value ?? map[r.name];
  return map;
}

/** Employees by id, in one query (the database link is slow). Map of id string → employee. */
async function loadEmployees(employeeIds) {
  const ids = [...new Set(employeeIds.map(toBigInt).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT e.id, e.employee_id AS employee_code,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.status, e.paygradeId AS paygrade_id,
           e.bankAccount AS bank_account, pg.name AS paygrade_name,
           COALESCE(b.comp_code, b.title) AS branch_code
      FROM employee e
      LEFT JOIN paygrades pg ON pg.id = e.paygradeId
      LEFT JOIN companystructures b ON b.id = e.branchId
     WHERE e.id IN (${Prisma.join(ids)})`.catch(() => []);
  return new Map(rows.map(row => [String(row.id), {
    ...row,
    id:          String(row.id),
    paygrade_id: row.paygrade_id != null ? String(row.paygrade_id) : null,
  }]));
}

async function loadEmployee(employeeId) {
  const map = await loadEmployees([employeeId]);
  return map.get(String(toBigInt(employeeId))) ?? null;
}

/** The employee ids in a request body: `employees` (list) or the older single `employee`. */
function requestedIds(body) {
  const list = Array.isArray(body?.employees) ? body.employees : (body?.employee ? [body.employee] : []);
  return [...new Set(list.map(v => String(v ?? '').trim()).filter(v => /^\d+$/.test(v)))];
}

/**
 * The period and the number of days to pay, or { error }. The days are entered by HR and are not
 * tied to the dates: some staff are paid by nights slept away, which counts differently.
 */
function checkPeriod(startStr, endStr, daysValue) {
  const start = parseDay(startStr), end = parseDay(endStr);
  if (!start || !end) return { error: 'Start and end dates are required (YYYY-MM-DD)' };
  if (start > end)    return { error: 'The start date must be on or before the end date' };
  const raw = String(daysValue ?? '').trim();
  if (!raw) return { error: 'Enter the number of days to pay' };
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) return { error: 'Number of days must be a whole number of 1 or more' };
  return { start, end, days };
}

/** Daily rate per pay grade id, for the given grades. */
async function loadRates(paygradeIds) {
  const ids = [...new Set(paygradeIds.filter(Boolean).map(toBigInt).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT paygrade_id, daily_rate FROM outofstation_rates WHERE paygrade_id IN (${Prisma.join(ids)})`.catch(() => []);
  return new Map(rows.map(r => [String(r.paygrade_id), Number(s(r.daily_rate))]));
}

/** Rate and amount for one employee over a checked period, or { error }. */
function priceFor(emp, period, rates) {
  if (!emp.paygrade_id) return { error: `${emp.employee_name || 'This employee'} has no pay grade on record, so no out-of-station rate applies. Set their pay grade first.` };
  const dailyRate = rates.get(String(emp.paygrade_id));
  if (dailyRate == null) return { error: `No out-of-station daily rate is set for pay grade ${emp.paygrade_name || emp.paygrade_id}. Add it in Manage Out of Station → Daily Rates.` };
  return { ...period, daily_rate: dailyRate, amount: round2(period.days * dailyRate) };
}

/** Days, rate and amount for one employee, or { error }. The rate is the grade's rate now. */
async function quoteFor(emp, startStr, endStr, daysValue) {
  const period = checkPeriod(startStr, endStr, daysValue);
  if (period.error) return period;
  return priceFor(emp, period, await loadRates([emp.paygrade_id]));
}

/** Active requests that share a day with the range, first one per employee. Map of employee id → row. */
async function findOverlaps(employeeIds, start, end, excludeId = null) {
  const ids = employeeIds.map(toBigInt).filter(Boolean);
  if (!ids.length) return new Map();
  const exclude = excludeId ? Prisma.sql`AND id <> ${toBigInt(excludeId)}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT employee, request_number, date_start, date_end, status FROM outofstation_requests
     WHERE employee IN (${Prisma.join(ids)})
       AND status IN (${Prisma.join(ACTIVE_STATUSES)})
       AND date_end >= ${start} AND date_start <= ${end} ${exclude}
     ORDER BY date_start`.catch(() => []);
  const map = new Map();
  for (const r of rows) if (!map.has(String(r.employee))) map.set(String(r.employee), r);
  return map;
}
async function findOverlap(employeeId, start, end, excludeId = null) {
  return (await findOverlaps([employeeId], start, end, excludeId)).get(String(toBigInt(employeeId))) ?? null;
}

const overlapMessage = (o) =>
  `These dates overlap out-of-station request ${o.request_number} (${fmtDay(o.date_start)} – ${fmtDay(o.date_end)}, ${o.status}). Change the dates or cancel that request first.`;

/**
 * Price every selected employee for one period. Each line carries its own `error` when that employee
 * cannot be included (not found, inactive, the caller themself, no rate, dates clash).
 */
async function quoteMany(req, ids, period) {
  const me = myEmployeeId(req);
  const emps  = await loadEmployees(ids);
  const rates = await loadRates([...emps.values()].map(e => e.paygrade_id));
  const clashes = await findOverlaps([...emps.keys()], period.start, period.end);
  const lines = [];
  for (const id of ids) {
    const emp = emps.get(id);
    const base = { employee: id, employee_name: emp?.employee_name ?? `Employee ${id}`, employee_code: emp?.employee_code ?? null, paygrade_name: emp?.paygrade_name ?? null };
    let error = null, price = null;
    if (!emp)                     error = 'Employee not found';
    else if (emp.status !== '1')  error = 'Not an active employee';
    else if (me && emp.id === me) error = 'You cannot raise an out-of-station request for yourself — another HR user must raise it';
    else {
      price = priceFor(emp, period, rates);
      if (price.error) error = price.error;
      else if (clashes.has(id)) error = overlapMessage(clashes.get(id));
    }
    lines.push(error ? { ...base, error } : { ...base, emp, days: price.days, daily_rate: price.daily_rate, amount: price.amount });
  }
  return lines;
}
const publicLine = ({ emp, ...line }) => line;

/**
 * The next sequence number for OOS-<year>-NNNN: one past the highest in use (not the count — deleting
 * a draft would otherwise hand out a number that still exists). Longest first so 10000 sorts after
 * 9999. The unique key catches the rare race; the caller retries and gets a fresh maximum.
 */
async function nextRequestSeq(db, year) {
  const prefix = `OOS-${year}-`;
  const [row] = await db.$queryRaw`
    SELECT request_number FROM outofstation_requests WHERE request_number LIKE ${prefix + '%'}
     ORDER BY LENGTH(request_number) DESC, request_number DESC LIMIT 1`;
  const last = row ? parseInt(String(row.request_number).slice(prefix.length), 10) : 0;
  return (Number.isFinite(last) ? last : 0) + 1;
}
const requestNumber = (year, seq) => `OOS-${year}-${String(seq).padStart(4, '0')}`;

let logSeq = 0;
async function writeLog(requestId, userId, action, statusFrom, statusTo) {
  try {
    logSeq = (logSeq + 1) % 1000;
    await prisma.$executeRaw`
      INSERT INTO outofstation_log (id, request_id, user_id, action, status_from, status_to, created_at)
      VALUES (${BigInt(Date.now()) * 1000n + BigInt(logSeq)}, ${toBigInt(requestId)}, ${toBigInt(userId)},
              ${String(action).slice(0, 500)}, ${statusFrom ?? null}, ${statusTo ?? null}, NOW())`;
  } catch (err) {
    console.error(`[out of station] could not write history for ${requestId} (${statusFrom} → ${statusTo}):`, err.message);
  }
}

const REQUEST_SELECT = Prisma.sql`
  SELECT r.*,
         TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
         e.employee_id AS employee_code, e.status AS employee_status,
         pg.name AS paygrade_name,
         TRIM(CONCAT_WS(' ', re.firstName, re.lastName)) AS requested_by_name,
         ru.username AS requested_by_username
    FROM outofstation_requests r
    LEFT JOIN employee  e  ON e.id  = r.employee
    LEFT JOIN paygrades pg ON pg.id = r.paygrade_id
    LEFT JOIN users     ru ON ru.id = r.requested_by
    LEFT JOIN employee  re ON re.id = ru.employeeId`;

async function getRow(id) {
  const [row] = await prisma.$queryRaw`${REQUEST_SELECT} WHERE r.id = ${toBigInt(id)}`.catch(() => []);
  return row ? s(row) : null;
}

// ── Approval flow ─────────────────────────────────────────────────────────────

/** The configured flow: [{ name, approverType: 'role'|'user', approverId, approverLabel }] ([] when unset). */
async function readFlow() {
  const row = await prisma.settings
    .findFirst({ where: { name: FLOW_KEY, category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(st => st && String(st.name || '').trim() && ['role', 'user'].includes(st.approverType) && String(st.approverId ?? '').trim())
      .map(st => ({ name: String(st.name).trim(), approverType: st.approverType, approverId: String(st.approverId), approverLabel: st.approverLabel == null ? null : String(st.approverLabel) }));
  } catch { return []; }
}

/** Does the signed-in user satisfy a stage? role → they hold that role; user → they are that user. */
function actorMatchesStage(req, stage) {
  const type  = stage.approver_type ?? stage.approverType;
  const id    = String(stage.approver_id ?? stage.approverId ?? '');
  const label = String(stage.approver_label ?? stage.approverLabel ?? '');
  if (type === 'user') return myUserId(req) === id;
  const roles = (req.user?.roles || []).map(String);
  return type === 'role' && (roles.includes(id) || (!!label && roles.includes(label)));
}

/** Stage rows per request id, in order. Map of request id → stages. */
async function loadStages(requestIds) {
  const ids = requestIds.map(toBigInt).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT st.id, st.request_id, st.stage_order, st.stage_name, st.approver_type, st.approver_id, st.approver_label,
           st.status, st.acted_by, st.acted_at, st.comment,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ae.firstName, ae.lastName)), ''), au.username) AS acted_by_name
      FROM outofstation_stages st
      LEFT JOIN users au ON au.id = st.acted_by
      LEFT JOIN employee ae ON ae.id = au.employeeId
     WHERE st.request_id IN (${Prisma.join(ids)})
     ORDER BY st.request_id, st.stage_order`.catch(() => []);
  const map = new Map();
  for (const r of s(rows)) {
    const key = String(r.request_id);
    map.set(key, [...(map.get(key) || []), r]);
  }
  return map;
}

/**
 * May this user act on the request now, and on which stage? Returns { stage } (null when there is no
 * flow on the request) or { error, code }. Checks maker-checker too.
 */
function approvalAuthority(req, row, stages) {
  if (row.status !== 'Pending Approval') return { code: 400, error: `This request is ${row.status} and is not awaiting approval` };
  const me = myEmployeeId(req);
  if (me && String(row.employee) === me) return { code: 403, error: 'You cannot approve your own out-of-station request' };
  if ([row.requested_by, row.submitted_by].some(u => u != null && String(u) === myUserId(req)))
    return { code: 403, error: 'You raised this request, so someone else must approve it' };
  const pending = stages.filter(st => st.status === 'Pending');
  if (pending.length) {
    const stage = pending[0];
    if (!actorMatchesStage(req, stage))
      return { code: 403, error: `Only ${stage.approver_label || (stage.approver_type === 'user' ? 'the assigned approver' : 'the assigned role')} can act on the "${stage.stage_name}" stage` };
    if (stages.some(st => st.status === 'Approved' && String(st.acted_by ?? '') === myUserId(req)))
      return { code: 403, error: 'You already approved an earlier stage of this request, so someone else must approve this one' };
    return { stage, last: pending.length === 1 };
  }
  if (stages.length) return { code: 400, error: 'This request has no stage awaiting approval' };
  if (!isHrApprover(req)) return { code: 403, error: 'Only users with the Approve Out of Station permission can approve this request' };
  return { stage: null, last: true };
}

/** Notify whoever must act next: a stage's approver(s), or every approver when there is no flow. */
function notifyApprovers(stage, row, req) {
  try {
    const what = `Out-of-station request ${row.request_number} for ${row.employee_name || 'an employee'}`;
    const payload = { action: 'CentralApproval', type: 'out_of_station', fromUser: req.user?.id, employee: row.employee };
    if (!stage) {
      notifyUsersWithPermission('approve_out_of_station', { ...payload, message: `${what} awaits your approval` }, req.user?.id);
      return;
    }
    const type = stage.approver_type ?? stage.approverType;
    const id   = stage.approver_id ?? stage.approverId;
    const msg  = `${what} awaits your approval (${stage.stage_name ?? stage.name})`;
    if (type === 'user') notifyUser(id, { ...payload, message: msg });
    else notifyUsersWithRole(id, { ...payload, message: msg }, req.user?.id, stage.approver_label ?? stage.approverLabel);
  } catch { /* never block the request */ }
}

/** The employee hears when it is approved and paid; whoever raised it hears when it is rejected. */
function notifyOutcome(kind, row, req, reason) {
  try {
    const what = `out-of-station allowance ${row.request_number} (${row.location}, ${row.days} day${Number(row.days) === 1 ? '' : 's'})`;
    if (kind === 'approved' || kind === 'paid') {
      notifyEmployee(row.employee, {
        message: kind === 'paid' ? `Your ${what} has been paid to your account` : `Your ${what} was approved`,
        action: 'PersonalOutOfStation', type: 'out_of_station', fromUser: req.user?.id,
      });
    } else if (kind === 'rejected' && row.requested_by && String(row.requested_by) !== myUserId(req)) {
      notifyUser(row.requested_by, {
        message: `Out-of-station request ${row.request_number} for ${row.employee_name || 'an employee'} was rejected${reason ? ': ' + reason : ''}`,
        action: 'ManageOutOfStation', type: 'out_of_station', fromUser: req.user?.id,
      });
    }
  } catch { /* never block the request */ }
}

/** Insert the flow's stages for a request (all Pending). Runs inside the caller's transaction. */
async function snapshotStages(tx, requestId, flow, idBase) {
  await tx.$executeRaw`DELETE FROM outofstation_stages WHERE request_id = ${toBigInt(requestId)}`;
  for (let i = 0; i < flow.length; i++) {
    const st = flow[i];
    await tx.$executeRaw`
      INSERT INTO outofstation_stages (id, request_id, stage_order, stage_name, approver_type, approver_id, approver_label, status, created_at)
      VALUES (${idBase + BigInt(i)}, ${toBigInt(requestId)}, ${i}, ${st.name.slice(0, 150)}, ${st.approverType},
              ${String(st.approverId).slice(0, 64)}, ${st.approverLabel ? st.approverLabel.slice(0, 200) : null}, 'Pending', NOW())`;
  }
}

/** Can this user see this request? HR viewers, the employee it is for, and the approvers on its stages. */
async function canSee(req, row) {
  if (canViewAll(req)) return true;
  const me = myEmployeeId(req);
  if (me && String(row.employee) === me && row.status !== 'Draft') return true;
  const stages = (await loadStages([row.id])).get(String(row.id)) || [];
  return stages.some(st => actorMatchesStage(req, st));
}

// ── GL posting ────────────────────────────────────────────────────────────────

/** A failed posting in the shape the UI renders (same as medical's glFailure). */
function glFailure(e) {
  const errData = e.glResponse || e.response?.data || e.message;
  return {
    log: e.glInvalidAccounts ? { error: e.message, invalidAccounts: e.glInvalidAccounts }
       : e.glImbalance       ? { error: e.message, imbalance: e.glImbalance }
       : { error: errData },
    glError:           e.message,
    glInvalidAccounts: e.glInvalidAccounts ?? null,
    glImbalance:       e.glImbalance ?? null,
  };
}

/**
 * Post an approved request: Dr out-of-station expense, Cr the employee's bank account.
 * `fromStatus` is the status the request must still be in (Approved, or GL Failed for a retry).
 * Returns { skipped } when postings are off or no GL is configured, { busy } when someone else has
 * already claimed or posted it, { documentRef } on success, { glFail } on failure — the request is
 * left at Paid or GL Failed accordingly.
 */
async function postToLedger(id, req, fromStatus) {
  const settings = await readSettings();
  const cfg = await getApiConfig();
  if (settings.oos_payments_enabled !== 'Yes' || !cfg.gl_url) return { skipped: true };
  let extra = {};
  try { extra = JSON.parse(cfg.gl_extra || '{}'); } catch { /* ignore */ }

  // Claim it: only one caller can move it to Posting, so only one posting is ever sent.
  const claimed = await prisma.$executeRaw`
    UPDATE outofstation_requests SET status = 'Posting', updated_at = NOW()
     WHERE id = ${toBigInt(id)} AND status = ${fromStatus} AND document_ref IS NULL`;
  if (claimed !== 1) return { busy: true };

  const row = await getRow(id);
  const emp = await loadEmployee(row.employee);
  try {
    // The bank account is read now, not from the request: a corrected account number on the
    // employee's record should be used on a retry.
    const account   = emp?.bank_account || '';
    const expenseGl = settings.oos_expense_gl || '';
    const amount    = round2(row.amount);
    const missing = [
      !(amount > 0) && 'an amount',
      !expenseGl    && 'the Out of Station expense GL account (Settings → Controls → Medical & GL → GL Posting — Out of Station)',
      !account      && "the employee's bank account (on their employee profile)",
    ].filter(Boolean);
    if (missing.length) throw new Error(`GL posting not attempted — missing ${missing.join(' and ')}. Nothing was sent to the GL.`);

    const branch    = settings.oos_gl_branch || extra.branch || '000';
    const currency  = await getSystemCurrency(extra.currency);
    const narration = ['Out of Station', row.employee_name, row.location].filter(Boolean).join(' - ');
    const referenceNo = `OS${String(row.request_number).replace(/\D/g, '')}${String(Date.now()).slice(-7)}`;
    const employeeCode = emp?.employee_code || undefined;

    const result = await postToGL({
      approvedBy: req.user?.username || 'System',
      referenceNo,
      description: `Out of station allowance - ${row.employee_name} - ${row.location}`,
      branch,
      debitAccounts: [{
        debitAmount: amount, debitAccount: expenseGl, debitCurrency: currency,
        debitNarration: narration, debitProdRef: `BS_OOS_${row.request_number}`, debitBranch: branch,
        ...(employeeCode ? { employeeCode } : {}),
      }],
      creditAccounts: [{
        creditAmount: amount, creditAccount: account, creditCurrency: currency,
        creditNarration: narration, creditProdRef: `NS_OOS_${row.request_number}`, creditBranch: branch,
        ...(employeeCode ? { employeeCode } : {}),
      }],
    });

    await prisma.$executeRaw`
      UPDATE outofstation_requests
         SET status = 'Paid', document_ref = ${String(result.documentRef ?? referenceNo).slice(0, 100)},
             payment_log = ${JSON.stringify(result.raw ?? {})}, posted_at = NOW(),
             account_no = ${account}, updated_at = NOW()
       WHERE id = ${toBigInt(id)} AND status = 'Posting'`;
    await writeLog(id, req.user?.id, `Posted to the GL — reference ${result.documentRef ?? referenceNo}`, fromStatus, 'Paid');
    notifyOutcome('paid', row, req);
    return { documentRef: result.documentRef ?? referenceNo };
  } catch (e) {
    const fail = glFailure(e);
    await prisma.$executeRaw`
      UPDATE outofstation_requests SET status = 'GL Failed', payment_log = ${JSON.stringify(fail.log)}, updated_at = NOW()
       WHERE id = ${toBigInt(id)} AND status = 'Posting'`.catch(() => {});
    await writeLog(id, req.user?.id, `GL posting failed: ${String(fail.glError || '').slice(0, 400)}`, fromStatus, 'GL Failed');
    console.error(`[out of station] GL posting failed for ${row.request_number}:`, fail.glError);
    return { glFail: fail };
  }
}

/** Spread into a response: the blocking detail when posting failed. */
const glDetail = (fail) => (fail ? { glError: fail.glError, glInvalidAccounts: fail.glInvalidAccounts, glImbalance: fail.glImbalance } : {});

/** Message + payload after a posting attempt. `prefix` names what happened first ("Request approved"). */
function postingOutcome(res, post, row, prefix = null) {
  if (post.busy) return respond.conflict(res, `${prefix ? `${prefix}, but it` : 'It'} is already being posted or was posted by someone else. Refresh to see its status.`);
  if (post.documentRef) return respond.ok(res, `${prefix ? `${prefix} and paid` : 'Paid'} — GL reference ${post.documentRef}`, row);
  if (post.glFail) return res.status(200).json({
    status: '200', message: `${prefix ? `${prefix}, but the` : 'The'} GL posting failed: ${post.glFail.glError}`, data: row, ...glDetail(post.glFail),
  });
  return respond.ok(res, `${prefix ?? 'Approved'}. Postings are switched off, so nothing was sent to the GL.`, row);
}

// ══════════════════════════════════════════════════════════════════════════════
// SETUP
// ══════════════════════════════════════════════════════════════════════════════

// GET /out-of-station/settings — expense GL, posting branch and postings switch.
exports.getSettings = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Out of station settings', await readSettings());
});

// PUT /out-of-station/settings — save any of the setting keys.
exports.saveSettings = asyncHandler(async (req, res) => {
  if (req.body.oos_payments_enabled !== undefined && !['Yes', 'No'].includes(String(req.body.oos_payments_enabled)))
    return respond.badReq(res, 'oos_payments_enabled must be Yes or No');
  await prisma.$transaction(async (tx) => {
    for (const key of SETTING_KEYS) {
      if (req.body[key] === undefined) continue;
      await upsertSetting(tx, key, SETTINGS_CAT, String(req.body[key] ?? '').trim());
    }
  }, TX_OPTS);
  logActivity({ module: 'Out of Station', action: 'update_settings', details: req.body, ...fromReq(req) });
  respond.ok(res, 'Out of station settings saved', await readSettings());
});

// GET /out-of-station/approval-flow — the configured stages ([] when none).
exports.getApprovalFlow = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Out of station approval flow', await readFlow());
});

// PUT /out-of-station/approval-flow — { stages: [{ name, approverType, approverId, approverLabel? }] }.
// Applies to requests submitted from now on; requests already in approval keep the stages they had.
exports.saveApprovalFlow = asyncHandler(async (req, res) => {
  const input = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const clean = [];
  for (const st of input) {
    const name = String(st?.name ?? '').trim();
    if (!name) return respond.badReq(res, 'Every stage needs a name');
    if (!['role', 'user'].includes(st?.approverType)) return respond.badReq(res, `Stage "${name}" needs an approver type (role or user)`);
    if (!String(st?.approverId ?? '').trim()) return respond.badReq(res, `Stage "${name}" needs an approver`);
    clean.push({ name, approverType: st.approverType, approverId: String(st.approverId).trim(), approverLabel: st.approverLabel != null ? String(st.approverLabel) : null });
  }
  await upsertSetting(null, FLOW_KEY, 'app_controls', JSON.stringify(clean));
  logActivity({ module: 'Out of Station', action: 'save_approval_flow', entityName: `${clean.length} stage(s)`, details: { stages: clean }, ...fromReq(req) });
  respond.ok(res, clean.length ? 'Approval flow saved' : 'Approval flow cleared', clean);
});

// GET /out-of-station/rates — every pay grade with its daily rate (null when not set).
exports.getRates = asyncHandler(async (_req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT pg.id AS paygrade_id, pg.name AS paygrade_name, r.daily_rate
      FROM paygrades pg
      LEFT JOIN outofstation_rates r ON r.paygrade_id = pg.id
     ORDER BY pg.name`.catch(() => []);
  respond.ok(res, 'Out of station rates', s(rows));
});

// PUT /out-of-station/rates — { rates: [{ paygrade_id, daily_rate }] }. A blank rate removes it.
exports.saveRates = asyncHandler(async (req, res) => {
  const rates = Array.isArray(req.body?.rates) ? req.body.rates : null;
  if (!rates) return respond.badReq(res, 'rates must be a list of { paygrade_id, daily_rate }');
  const clean = [];
  for (const r of rates) {
    const pg = toBigInt(r.paygrade_id);
    if (!pg) return respond.badReq(res, 'Every rate needs a pay grade');
    const blank = r.daily_rate === null || r.daily_rate === undefined || String(r.daily_rate).trim() === '';
    const value = blank ? null : Number(r.daily_rate);
    if (!blank && (!Number.isFinite(value) || value < 0)) return respond.badReq(res, 'Daily rates must be zero or a positive amount');
    clean.push({ pg, value: blank ? null : round2(value) });
  }
  // Delete-then-insert keeps this portable (no ON CONFLICT / ON DUPLICATE KEY dialect split).
  await prisma.$transaction(async (tx) => {
    for (const { pg, value } of clean) {
      await tx.$executeRaw`DELETE FROM outofstation_rates WHERE paygrade_id = ${pg}`;
      if (value !== null) {
        await tx.$executeRaw`
          INSERT INTO outofstation_rates (id, paygrade_id, daily_rate, updated_by, updated_at)
          VALUES (${newId()}, ${pg}, ${value}, ${toBigInt(req.user?.id)}, NOW())`;
      }
    }
  }, TX_OPTS);
  logActivity({ module: 'Out of Station', action: 'update_rates', details: { count: clean.length }, ...fromReq(req) });
  respond.ok(res, 'Daily rates saved');
});

// ══════════════════════════════════════════════════════════════════════════════
// REQUESTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /out-of-station/employees — every active employee HR may raise a request for (not themself).
exports.getRequestableEmployees = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.ok(res, 'Employees', []);
  const me = toBigInt(myEmployeeId(req)) ?? 0n;
  const rows = await prisma.$queryRaw`
    SELECT e.id, e.employee_id AS employee_code,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.paygradeId AS paygrade_id, pg.name AS paygrade_name,
           e.departmentId AS department_id, d.title AS department_name
      FROM employee e
      LEFT JOIN paygrades pg ON pg.id = e.paygradeId
      LEFT JOIN companystructures d ON d.id = e.departmentId
     WHERE e.status = '1' AND e.id <> ${me}
     ORDER BY e.firstName, e.lastName`.catch(() => []);
  respond.ok(res, 'Employees', s(rows));
});

// POST /out-of-station/quote — { employees: [id…], date_start, date_end, days, exclude_id? } → a line per
// employee (rate and amount, or the reason they can't be included) and the total, for the form.
// `exclude_id` is the draft being edited, so it does not clash with itself.
exports.quote = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'Only HR can raise out-of-station requests');
  const ids = requestedIds(req.body);
  if (!ids.length) return respond.badReq(res, 'Select at least one employee');
  const period = checkPeriod(req.body.date_start, req.body.date_end, req.body.days);
  if (period.error) return respond.badReq(res, period.error);
  let lines;
  if (req.body.exclude_id) {
    // Editing a draft: one employee, already checked when it was raised.
    const emp = await loadEmployee(ids[0]);
    if (!emp) return respond.badReq(res, 'Employee not found');
    const q = priceFor(emp, period, await loadRates([emp.paygrade_id]));
    const clash = q.error ? null : await findOverlap(emp.id, period.start, period.end, req.body.exclude_id);
    const base = { employee: emp.id, employee_name: emp.employee_name, employee_code: emp.employee_code, paygrade_name: emp.paygrade_name };
    lines = [q.error || clash ? { ...base, error: q.error || overlapMessage(clash) } : { ...base, days: q.days, daily_rate: q.daily_rate, amount: q.amount }];
  } else {
    lines = (await quoteMany(req, ids, period)).map(publicLine);
  }
  const ok = lines.filter(l => !l.error);
  respond.ok(res, 'Quote', { days: period.days, lines, total: round2(ok.reduce((n, l) => n + l.amount, 0)), count: ok.length });
});

// GET /out-of-station/requests?scope=mine|all&status=&from=&to=
//   mine — requests for the caller's own employee record (never drafts): Personal Out of Station,
//          read-only history. Nothing else — not requests they raised for others.
//   all  — everyone's (view/approve/manage), with the current approval stage.
// from/to keep requests that overlap the range.
exports.listRequests = asyncHandler(async (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  const where = [];
  if (scope === 'all') {
    if (!canViewAll(req)) return respond.forbidden(res, 'You do not have access to all out-of-station requests');
  } else {
    const me = myEmployeeId(req);
    if (!me) return respond.ok(res, 'Requests', []);
    where.push(Prisma.sql`r.employee = ${toBigInt(me)} AND r.status <> 'Draft'`);
  }
  if (req.query.status) where.push(Prisma.sql`r.status = ${String(req.query.status)}`);
  const from = parseDay(req.query.from), to = parseDay(req.query.to);
  if (from) where.push(Prisma.sql`r.date_end >= ${from}`);
  if (to)   where.push(Prisma.sql`r.date_start <= ${to}`);
  const clause = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
  const rows = s(await prisma.$queryRaw`${REQUEST_SELECT} ${clause} ORDER BY r.created_at DESC, r.id DESC`);
  const pendingIds = rows.filter(r => r.status === 'Pending Approval').map(r => r.id);
  const stages = await loadStages(pendingIds);
  respond.ok(res, 'Requests', rows.map(r => {
    const current = (stages.get(String(r.id)) || []).find(st => st.status === 'Pending');
    return { ...r, current_stage_name: current?.stage_name ?? null };
  }));
});

// GET /out-of-station/approvals — requests the caller can approve right now: those whose current stage
// is theirs (by role or by name), or — for requests with no flow — every pending one for approvers.
// Never their own, nor ones they raised, nor ones where they approved an earlier stage.
exports.listApprovals = asyncHandler(async (req, res) => {
  const rows = s(await prisma.$queryRaw`${REQUEST_SELECT} WHERE r.status = 'Pending Approval' ORDER BY r.submitted_at, r.id`);
  if (!rows.length) return respond.ok(res, 'Approvals', []);
  const stages = await loadStages(rows.map(r => r.id));
  const out = [];
  for (const r of rows) {
    const list = stages.get(String(r.id)) || [];
    const auth = approvalAuthority(req, r, list);
    if (auth.error) continue;
    out.push({ ...r, stages: list, current_stage_name: auth.stage?.stage_name ?? null, final_stage: auth.last });
  }
  respond.ok(res, 'Approvals', out);
});

// GET /out-of-station/requests/:id
exports.getRequest = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row || !(await canSee(req, row))) return respond.notFound(res, 'Request not found');
  respond.ok(res, 'Request', row);
});

// GET /out-of-station/requests/:id/history — status history (oldest first) and the approval stages.
exports.getHistory = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row || !(await canSee(req, row))) return respond.notFound(res, 'Request not found');
  const rows = await prisma.$queryRaw`
    SELECT l.id, l.action, l.status_from, l.status_to, l.created_at, u.username AS user_name,
           TRIM(CONCAT_WS(' ', ue.firstName, ue.lastName)) AS user_full_name
      FROM outofstation_log l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN employee ue ON ue.id = u.employeeId
     WHERE l.request_id = ${toBigInt(req.params.id)}
     ORDER BY l.created_at, l.id`.catch(() => []);
  respond.ok(res, 'History', s(rows));
});

// GET /out-of-station/requests/:id/stages — the request's approval stages and their progress.
exports.getStages = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row || !(await canSee(req, row))) return respond.notFound(res, 'Request not found');
  respond.ok(res, 'Stages', (await loadStages([row.id])).get(String(row.id)) || []);
});

// POST /out-of-station/requests — { employees: [id…] (or employee), purpose, location, date_start,
// date_end, days, submit? }. HR only. One request per employee, all with the same period and days,
// each at its own grade's rate. All or nothing: if any selected employee can't be included, nothing is
// saved and the reasons are listed. Saved as Drafts; `submit: true` sends them for approval at once.
exports.createRequest = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'Only HR can raise out-of-station requests');
  const purpose  = String(req.body.purpose  ?? '').trim();
  const location = String(req.body.location ?? '').trim();
  if (!purpose)  return respond.badReq(res, 'Purpose is required');
  if (!location) return respond.badReq(res, 'Location is required');
  if (purpose.length > 255 || location.length > 150) return respond.badReq(res, 'Purpose (255) or location (150) is too long');

  const ids = requestedIds(req.body);
  if (!ids.length) return respond.badReq(res, 'Select at least one employee the request is for');
  const period = checkPeriod(req.body.date_start, req.body.date_end, req.body.days);
  if (period.error) return respond.badReq(res, period.error);

  const lines = await quoteMany(req, ids, period);
  const bad = lines.filter(l => l.error);
  if (bad.length) {
    if (lines.length === 1) return respond.badReq(res, bad[0].error);
    return respond.badReq(res, `Nothing was saved — ${bad.length} of the ${lines.length} selected employees cannot be included: ` +
      bad.map(l => `${l.employee_name}: ${l.error}`).join(' | ') + '. Remove them and try again.');
  }

  // The whole group is saved — and, with submit, put into approval — together or not at all.
  const submit = !!req.body.submit;
  const flow = submit ? await readFlow() : [];
  const year = period.start.getUTCFullYear();
  const userId = toBigInt(req.user?.id);

  let created;
  for (let attempt = 0; ; attempt++) {
    try {
      created = await prisma.$transaction(async (tx) => {
        let seq = await nextRequestSeq(tx, year);
        const base = newId();
        const stageBase = base * 100n;   // stage ids: distinct per request, never reused by another table's id
        const out = [];
        for (const line of lines) {
          const emp = line.emp;
          const idx = BigInt(out.length);
          const id = base + idx;   // distinct within the group; a clash with another user's id is retried
          const number = requestNumber(year, seq++);
          await tx.$executeRaw`
            INSERT INTO outofstation_requests
              (id, request_number, employee, purpose, location, date_start, date_end, days,
               paygrade_id, daily_rate, amount, account_no, branch, status, approval_level,
               requested_by, submitted_by, submitted_at, created_at, updated_at)
            VALUES (${id}, ${number}, ${toBigInt(emp.id)}, ${purpose}, ${location}, ${period.start}, ${period.end}, ${line.days},
                    ${toBigInt(emp.paygrade_id)}, ${line.daily_rate}, ${line.amount}, ${emp.bank_account ?? null}, ${emp.branch_code ?? null},
                    ${submit ? 'Pending Approval' : 'Draft'}, 0,
                    ${userId}, ${submit ? userId : null}, ${submit ? new Date() : null}, NOW(), NOW())`;
          if (submit) await snapshotStages(tx, id, flow, stageBase + idx * 100n);
          out.push({ id: String(id), number, emp, line });
        }
        return out;
      }, { maxWait: 15000, timeout: 120000 });
      break;
    } catch (e) {
      // Someone else took a number or id at the same moment: start again from a fresh maximum.
      if (attempt < 4 && /unique|duplicate/i.test(String(e.message))) continue;
      throw e;
    }
  }

  // History, audit and notifications once the group is safely saved.
  const firstStage = flow.length ? { stage_name: flow[0].name, approver_type: flow[0].approverType, approver_id: flow[0].approverId, approver_label: flow[0].approverLabel } : null;
  for (const c of created) {
    await writeLog(c.id, req.user?.id, `Request raised by HR for ${c.emp.employee_name}`, null, 'Draft');
    if (submit) {
      await writeLog(c.id, req.user?.id, firstStage ? `Submitted — awaiting "${firstStage.stage_name}"` : 'Submitted for approval', 'Draft', 'Pending Approval');
    }
    logActivity({ module: 'Out of Station', action: 'create', entityId: c.id, entityName: c.emp.employee_name, ...fromReq(req) });
  }
  if (submit) {
    // One notification per approver for the whole group, not one per request.
    const label = created.length === 1
      ? { request_number: created[0].number, employee_name: created[0].emp.employee_name, employee: created[0].emp.id }
      : { request_number: `${created[0].number} – ${created[created.length - 1].number}`, employee_name: `${created.length} employees` };
    notifyApprovers(firstStage, label, req);
  }

  if (created.length === 1) {
    return respond.created(res, submit ? 'Request submitted for approval' : 'Out-of-station request saved as a draft', await getRow(created[0].id));
  }
  const n = created.length;
  respond.created(res, submit ? `${n} out-of-station requests submitted for approval` : `${n} out-of-station requests saved as drafts`,
    { ids: created.map(c => c.id) });
});

// PUT /out-of-station/requests/:id — edit a Draft (HR). Days, rate and amount are recalculated.
exports.updateRequest = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'Only HR can edit out-of-station requests');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft requests can be edited');

  const purpose  = req.body.purpose  !== undefined ? String(req.body.purpose).trim()  : row.purpose;
  const location = req.body.location !== undefined ? String(req.body.location).trim() : row.location;
  if (!purpose)  return respond.badReq(res, 'Purpose is required');
  if (!location) return respond.badReq(res, 'Location is required');

  const emp = await loadEmployee(row.employee);
  const q = await quoteFor(emp, req.body.date_start ?? String(row.date_start).slice(0, 10), req.body.date_end ?? String(row.date_end).slice(0, 10),
                           req.body.days ?? row.days);
  if (q.error) return respond.badReq(res, q.error);
  const clash = await findOverlap(emp.id, q.start, q.end, row.id);
  if (clash) return respond.badReq(res, overlapMessage(clash));

  const changed = await prisma.$executeRaw`
    UPDATE outofstation_requests
       SET purpose = ${purpose}, location = ${location}, date_start = ${q.start}, date_end = ${q.end},
           days = ${q.days}, paygrade_id = ${toBigInt(emp.paygrade_id)}, daily_rate = ${q.daily_rate}, amount = ${q.amount},
           account_no = ${emp.bank_account ?? null}, branch = ${emp.branch_code ?? null}, updated_at = NOW()
     WHERE id = ${toBigInt(row.id)} AND status = 'Draft'`;
  if (changed !== 1) return respond.conflict(res, CONFLICT_MSG);
  respond.ok(res, 'Request updated', await getRow(row.id));
});

// DELETE /out-of-station/requests/:id — remove a Draft (HR).
exports.deleteRequest = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'Only HR can delete out-of-station requests');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft requests can be deleted. Cancel it instead.');
  const removed = await prisma.$executeRaw`DELETE FROM outofstation_requests WHERE id = ${toBigInt(row.id)} AND status = 'Draft'`;
  if (removed !== 1) return respond.conflict(res, CONFLICT_MSG);
  await prisma.$executeRaw`DELETE FROM outofstation_log WHERE request_id = ${toBigInt(row.id)}`;
  await prisma.$executeRaw`DELETE FROM outofstation_stages WHERE request_id = ${toBigInt(row.id)}`;
  logActivity({ module: 'Out of Station', action: 'delete', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
  respond.ok(res, 'Request deleted');
});

// POST /out-of-station/requests/:id/submit — send a Draft into approval (HR). The rate, grade, bank
// account and branch are refreshed first, so a draft saved weeks ago does not go out at an old rate.
exports.submit = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'Only HR can submit out-of-station requests');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft requests can be submitted');

  const emp = await loadEmployee(row.employee);
  if (!emp || emp.status !== '1') return respond.badReq(res, `${row.employee_name || 'This employee'} is no longer an active employee. Delete this draft instead.`);
  const q = await quoteFor(emp, String(row.date_start).slice(0, 10), String(row.date_end).slice(0, 10), row.days);
  if (q.error) return respond.badReq(res, q.error);

  const flow = await readFlow();
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.$executeRaw`
        UPDATE outofstation_requests
           SET status = 'Pending Approval', approval_level = 0,
               paygrade_id = ${toBigInt(emp.paygrade_id)}, daily_rate = ${q.daily_rate}, amount = ${q.amount},
               account_no = ${emp.bank_account ?? null}, branch = ${emp.branch_code ?? null},
               submitted_by = ${toBigInt(req.user?.id)}, submitted_at = NOW(), updated_at = NOW()
         WHERE id = ${toBigInt(row.id)} AND status = 'Draft'`;
      if (changed !== 1) throw new Conflict();
      await snapshotStages(tx, row.id, flow, newId() * 100n);
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof Conflict) return respond.conflict(res, CONFLICT_MSG);
    throw e;
  }

  const rateNote = Number(row.daily_rate) !== q.daily_rate ? ` (daily rate updated from ${row.daily_rate} to ${q.daily_rate})` : '';
  const first = flow[0] ? { stage_name: flow[0].name, approver_type: flow[0].approverType, approver_id: flow[0].approverId, approver_label: flow[0].approverLabel } : null;
  await writeLog(row.id, req.user?.id, (first ? `Submitted — awaiting "${first.stage_name}"` : 'Submitted for approval') + rateNote, 'Draft', 'Pending Approval');
  const fresh = await getRow(row.id);
  notifyApprovers(first, fresh, req);
  logActivity({ module: 'Out of Station', action: 'submit', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
  respond.ok(res, 'Request submitted for approval' + rateNote, fresh);
});

// POST /out-of-station/requests/:id/approve — { comment? }. Approves the current stage; the last stage
// (or the single approval when there is no flow) approves the request and posts it to the GL.
exports.approve = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  const stages = (await loadStages([row.id])).get(String(row.id)) || [];
  const auth = approvalAuthority(req, row, stages);
  if (auth.error) return res.status(auth.code).json({ status: String(auth.code), message: auth.error });
  if (auth.last && row.employee_status !== '1')
    return respond.badReq(res, `${row.employee_name || 'This employee'} is no longer an active employee. Reject the request instead.`);
  const comment = String(req.body?.comment ?? '').trim().slice(0, 500) || null;
  const userId = toBigInt(req.user?.id);

  try {
    await prisma.$transaction(async (tx) => {
      if (auth.stage) {
        const done = await tx.$executeRaw`
          UPDATE outofstation_stages SET status = 'Approved', acted_by = ${userId}, acted_at = NOW(), comment = ${comment}
           WHERE id = ${toBigInt(auth.stage.id)} AND status = 'Pending'`;
        if (done !== 1) throw new Conflict();
      }
      const changed = auth.last
        ? await tx.$executeRaw`
            UPDATE outofstation_requests
               SET status = 'Approved', approval_level = ${stages.length || 1}, approved_by = ${userId}, approved_at = NOW(), updated_at = NOW()
             WHERE id = ${toBigInt(row.id)} AND status = 'Pending Approval'`
        : await tx.$executeRaw`
            UPDATE outofstation_requests SET approval_level = approval_level + 1, updated_at = NOW()
             WHERE id = ${toBigInt(row.id)} AND status = 'Pending Approval'`;
      if (changed !== 1) throw new Conflict();
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof Conflict) return respond.conflict(res, CONFLICT_MSG);
    throw e;
  }

  if (!auth.last) {
    const next = stages.filter(st => st.status === 'Pending')[1];
    await writeLog(row.id, req.user?.id, `"${auth.stage.stage_name}" approved${comment ? `: ${comment}` : ''} — awaiting "${next.stage_name}"`, row.status, row.status);
    notifyApprovers(next, row, req);
    logActivity({ module: 'Out of Station', action: 'approve_stage', entityId: String(row.id), entityName: row.request_number, details: { stage: auth.stage.stage_name }, ...fromReq(req) });
    return respond.ok(res, `"${auth.stage.stage_name}" approved — awaiting "${next.stage_name}"`, await getRow(row.id));
  }

  await writeLog(row.id, req.user?.id, auth.stage ? `"${auth.stage.stage_name}" approved${comment ? `: ${comment}` : ''} — final approval` : 'Approved', row.status, 'Approved');
  notifyOutcome('approved', row, req);
  logActivity({ module: 'Out of Station', action: 'approve', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
  const post = await postToLedger(row.id, req, 'Approved');
  postingOutcome(res, post, await getRow(row.id), 'Request approved');
});

// POST /out-of-station/requests/:id/reject — { reason }. Whoever may approve the current stage may reject.
exports.reject = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) return respond.badReq(res, 'A reason is required to reject a request');
  const stages = (await loadStages([row.id])).get(String(row.id)) || [];
  const auth = approvalAuthority(req, row, stages);
  if (auth.error) return res.status(auth.code).json({ status: String(auth.code), message: auth.error.replace('approve it', 'reject it').replace('approve this one', 'reject it') });
  const userId = toBigInt(req.user?.id);

  try {
    await prisma.$transaction(async (tx) => {
      if (auth.stage) {
        const done = await tx.$executeRaw`
          UPDATE outofstation_stages SET status = 'Rejected', acted_by = ${userId}, acted_at = NOW(), comment = ${reason.slice(0, 500)}
           WHERE id = ${toBigInt(auth.stage.id)} AND status = 'Pending'`;
        if (done !== 1) throw new Conflict();
        await tx.$executeRaw`UPDATE outofstation_stages SET status = 'Skipped' WHERE request_id = ${toBigInt(row.id)} AND status = 'Pending'`;
      }
      const changed = await tx.$executeRaw`
        UPDATE outofstation_requests
           SET status = 'Rejected', rejection_reason = ${reason.slice(0, 500)}, approved_by = ${userId}, updated_at = NOW()
         WHERE id = ${toBigInt(row.id)} AND status = 'Pending Approval'`;
      if (changed !== 1) throw new Conflict();
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof Conflict) return respond.conflict(res, CONFLICT_MSG);
    throw e;
  }

  await writeLog(row.id, req.user?.id, `Rejected${auth.stage ? ` at "${auth.stage.stage_name}"` : ''}: ${reason}`, row.status, 'Rejected');
  notifyOutcome('rejected', row, req, reason);
  logActivity({ module: 'Out of Station', action: 'reject', entityId: String(row.id), entityName: row.request_number, details: { reason }, ...fromReq(req) });
  respond.ok(res, 'Request rejected', await getRow(row.id));
});

// POST /out-of-station/requests/:id/cancel — { reason? }. HR can cancel while it is pending, or once
// approved as long as it has not been paid.
exports.cancel = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (!canManage(req) && !isHrApprover(req)) return respond.forbidden(res, 'Only HR can cancel out-of-station requests');
  if (row.status === 'Paid') return respond.badReq(res, 'A paid request cannot be cancelled — reverse it in the core banking system');
  if (!['Pending Approval', 'Approved', 'GL Failed'].includes(row.status)) return respond.badReq(res, `A ${row.status} request cannot be cancelled`);
  if (row.document_ref) return respond.badReq(res, 'This request already has a GL reference and cannot be cancelled');
  const reason = String(req.body?.reason ?? '').trim();
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.$executeRaw`
        UPDATE outofstation_requests SET status = 'Cancelled', rejection_reason = ${reason ? reason.slice(0, 500) : null}, updated_at = NOW()
         WHERE id = ${toBigInt(row.id)} AND status = ${row.status} AND document_ref IS NULL`;
      if (changed !== 1) throw new Conflict();
      await tx.$executeRaw`UPDATE outofstation_stages SET status = 'Skipped' WHERE request_id = ${toBigInt(row.id)} AND status = 'Pending'`;
    }, TX_OPTS);
  } catch (e) {
    if (e instanceof Conflict) return respond.conflict(res, CONFLICT_MSG);
    throw e;
  }
  await writeLog(row.id, req.user?.id, reason ? `Cancelled: ${reason}` : 'Cancelled', row.status, 'Cancelled');
  logActivity({ module: 'Out of Station', action: 'cancel', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
  respond.ok(res, 'Request cancelled', await getRow(row.id));
});

// POST /out-of-station/requests/:id/retry-gl — post a GL Failed request again.
// POST /out-of-station/requests/:id/post     — post an Approved request that stopped there because
//                                              postings were switched off.
async function repost(req, res, fromStatus, label) {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (!isHrApprover(req) && !canManage(req)) return respond.forbidden(res, 'Only HR can post out-of-station requests');
  if (row.status !== fromStatus) return respond.badReq(res, `Only ${fromStatus} requests can be ${label}`);
  // A reference means the bank accepted it once — posting again would pay twice.
  if (row.document_ref) return respond.badReq(res, `This request already has GL reference ${row.document_ref}; posting again would pay it twice`);
  if (row.employee_status !== '1')
    return respond.badReq(res, `${row.employee_name || 'This employee'} is no longer an active employee, so the allowance was not posted. Cancel the request instead.`);
  const post = await postToLedger(row.id, req, fromStatus);
  if (post.skipped) return respond.badReq(res, 'Postings are switched off or no GL connection is configured, so nothing was sent');
  logActivity({ module: 'Out of Station', action: fromStatus === 'GL Failed' ? 'retry_gl' : 'post_gl', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
  postingOutcome(res, post, await getRow(row.id));
}
exports.retryGL = asyncHandler((req, res) => repost(req, res, 'GL Failed', 'retried'));
exports.post    = asyncHandler((req, res) => repost(req, res, 'Approved', 'posted'));
