// Out of Station allowance.
//
// Staff sent on duty away from their station are paid days × the daily rate for their pay grade.
// Days run from the start date to the end date, both included — weekends and holidays count — and
// the allowance is not taxed. A request is raised by the employee or by their supervisor on their
// behalf and approved like leave: a supervisor tier when switched on (skipped when the supervisor
// raised it), then HR. HR's approval posts it to the GL: Dr the out-of-station expense account,
// Cr the employee's bank account.
//
// Status flow:  Draft → Pending Approval (supervisor) → Pending HR Approval → Approved → Paid
//                                                                                  └→ GL Failed → (retry) → Paid
//               Rejected / Cancelled from any open state.
// With postings switched off a request stops at Approved (record only) and can be posted later.
//
// Tables come from manual-migrations/20261026_out_of_station.*.sql and are read with raw SQL, so
// this module needs no regenerated Prisma client. Ids are generated here (as employeeleaves does).
const { Prisma }   = require('@prisma/client');
const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const { toBigInt, s } = require('../helpers/controllerHelpers');
const { postToGL } = require('../helpers/glHelper');
const { getApiConfig } = require('./apiIntegrationController');
const { upsertSetting, getSystemCurrency } = require('../helpers/settingsHelper');
const { notifyEmployee, notifyUsersWithPermission } = require('../helpers/notificationHelper');
const { logActivity, fromReq } = require('./auditController');

const SETTINGS_CAT = 'out_of_station';
const SETTING_DEFAULTS = {
  oos_expense_gl:          '',     // Dr account for every posting
  oos_gl_branch:           '',     // posting branch; blank → gl_extra.branch → '000'
  oos_supervisor_approval: 'Yes',  // supervisor tier before HR, as leave does
  oos_payments_enabled:    'Yes',  // No → requests stop at Approved, nothing is sent to the GL
};
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);

// The database is a remote link with high latency; Prisma's 2s default to start a transaction is too short.
const TX_OPTS = { maxWait: 15000, timeout: 30000 };

const OPEN_STATUSES   = ['Draft', 'Pending Approval', 'Pending HR Approval'];
const ACTIVE_STATUSES = [...OPEN_STATUSES, 'Approved', 'Paid', 'GL Failed'];   // block overlapping dates

// ── Helpers ───────────────────────────────────────────────────────────────────

const newId   = () => BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
const round2  = (n) => Math.round(Number(n) * 100) / 100;
const hasPerm = (req, p) => Array.isArray(req.user?.permissions) && req.user.permissions.includes(p);
const isAdmin = (req) => (req.user?.roles ?? []).some(r => ['admin', 'super-admin'].includes(String(r)));
const myEmployeeId = (req) => (req.user?.employeeId != null ? String(req.user.employeeId) : null);

/** HR tier: final approval, retry and posting. */
const isHrApprover = (req) => isAdmin(req) || hasPerm(req, 'approve_out_of_station');
/** Setup, and raising a request for any employee. */
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

/** Calendar days from start to end, both included (12 Oct → 25 Oct = 14). */
const daysBetween = (start, end) => Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function readSettings() {
  const rows = await prisma.settings
    .findMany({ where: { category: SETTINGS_CAT }, select: { name: true, value: true } })
    .catch(() => []);
  const map = { ...SETTING_DEFAULTS };
  for (const r of rows) if (SETTING_KEYS.includes(r.name)) map[r.name] = r.value ?? map[r.name];
  return map;
}

async function loadEmployee(employeeId) {
  const id = toBigInt(employeeId);
  if (!id) return null;
  const [row] = await prisma.$queryRaw`
    SELECT e.id, e.employee_id AS employee_code,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.status, e.paygradeId AS paygrade_id, e.supervisorId AS supervisor_id,
           e.bankAccount AS bank_account, pg.name AS paygrade_name,
           COALESCE(b.comp_code, b.title) AS branch_code
      FROM employee e
      LEFT JOIN paygrades pg ON pg.id = e.paygradeId
      LEFT JOIN companystructures b ON b.id = e.branchId
     WHERE e.id = ${id}`.catch(() => []);
  if (!row) return null;
  return {
    ...row,
    id:            String(row.id),
    paygrade_id:   row.paygrade_id   != null ? String(row.paygrade_id)   : null,
    supervisor_id: row.supervisor_id != null ? String(row.supervisor_id) : null,
  };
}

/** May this caller raise or edit a request for `emp`? Self, their supervisor, or HR setup. */
function canActFor(req, emp) {
  const me = myEmployeeId(req);
  if (canManage(req)) return true;
  if (!me || !emp) return false;
  return emp.id === me || emp.supervisor_id === me;
}

/**
 * Days, rate and amount for an employee over a date range, or { error }.
 * The rate is the one set for the employee's pay grade at the time of the quote.
 */
async function quoteFor(emp, startStr, endStr) {
  const start = parseDay(startStr), end = parseDay(endStr);
  if (!start || !end) return { error: 'Start and end dates are required (YYYY-MM-DD)' };
  if (start > end)    return { error: 'The start date must be on or before the end date' };
  if (!emp.paygrade_id) return { error: `${emp.employee_name || 'This employee'} has no pay grade on record, so no out-of-station rate applies. Set their pay grade first.` };
  const [rate] = await prisma.$queryRaw`
    SELECT daily_rate FROM outofstation_rates WHERE paygrade_id = ${toBigInt(emp.paygrade_id)}`.catch(() => []);
  if (!rate) return { error: `No out-of-station daily rate is set for pay grade ${emp.paygrade_name || emp.paygrade_id}. Add it in Out of Station → Setup.` };
  const dailyRate = Number(s(rate.daily_rate));
  const days = daysBetween(start, end);
  return { start, end, days, daily_rate: dailyRate, amount: round2(days * dailyRate) };
}

/** The first active request of this employee that shares a day with the range, or null. */
async function findOverlap(employeeId, start, end, excludeId = null) {
  const exclude = excludeId ? Prisma.sql`AND id <> ${toBigInt(excludeId)}` : Prisma.empty;
  const [row] = await prisma.$queryRaw`
    SELECT request_number, date_start, date_end, status FROM outofstation_requests
     WHERE employee = ${toBigInt(employeeId)}
       AND status IN (${Prisma.join(ACTIVE_STATUSES)})
       AND date_end >= ${start} AND date_start <= ${end} ${exclude}
     ORDER BY date_start LIMIT 1`.catch(() => []);
  return row ?? null;
}

const overlapMessage = (o) =>
  `These dates overlap out-of-station request ${o.request_number} (${fmtDay(o.date_start)} – ${fmtDay(o.date_end)}, ${o.status}). Change the dates or cancel that request first.`;

/** OOS-2026-0001, numbered per year. The unique key catches the rare race; the caller retries. */
async function nextRequestNumber(year) {
  const prefix = `OOS-${year}-`;
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*) AS n FROM outofstation_requests WHERE request_number LIKE ${prefix + '%'}`.catch(() => [{ n: 0 }]);
  return `${prefix}${String(Number(row?.n ?? 0) + 1).padStart(4, '0')}`;
}

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
         e.employee_id AS employee_code, e.supervisorId AS supervisor_id,
         pg.name AS paygrade_name,
         TRIM(CONCAT_WS(' ', re.firstName, re.lastName)) AS requested_by_name
    FROM outofstation_requests r
    LEFT JOIN employee  e  ON e.id  = r.employee
    LEFT JOIN paygrades pg ON pg.id = r.paygrade_id
    LEFT JOIN users     ru ON ru.id = r.requested_by
    LEFT JOIN employee  re ON re.id = ru.employeeId`;

async function getRow(id) {
  const [row] = await prisma.$queryRaw`${REQUEST_SELECT} WHERE r.id = ${toBigInt(id)}`.catch(() => []);
  return row ? s(row) : null;
}

/** The employee, or whoever raised it, or HR setup — the people who own a request before approval. */
function isOwner(req, row) {
  const me = myEmployeeId(req);
  return canManage(req)
      || (me && String(row.employee) === me)
      || String(row.requested_by ?? '') === String(req.user?.id ?? '');
}

/** In-app notifications. Never throws. */
function notify(kind, row, req, reason) {
  try {
    const who  = row.employee_name || 'An employee';
    const what = `out-of-station request ${row.request_number} (${row.location}, ${row.days} day${row.days === 1 ? '' : 's'})`;
    if (kind === 'supervisor_pending' && row.supervisor_id) {
      notifyEmployee(row.supervisor_id, {
        message: `${who} has an ${what} awaiting your approval`,
        action: 'PersonalOutOfStation', type: 'out_of_station', fromUser: req.user?.id, employee: row.employee,
      });
    } else if (kind === 'hr_pending') {
      notifyUsersWithPermission('approve_out_of_station', {
        message: `${who}: ${what} awaits HR approval`,
        action: 'ManageOutOfStation', type: 'out_of_station', fromUser: req.user?.id, employee: row.employee,
      }, req.user?.id);
    } else if (row.employee) {
      const msg = kind === 'approved'  ? `Your ${what} was approved`
                : kind === 'paid'      ? `Your ${what} has been paid to your account`
                : kind === 'rejected'  ? `Your ${what} was rejected${reason ? ': ' + reason : ''}`
                : kind === 'cancelled' ? `Your ${what} was cancelled`
                : `Your ${what} was updated`;
      notifyEmployee(row.employee, { message: msg, action: 'PersonalOutOfStation', type: 'out_of_station', fromUser: req.user?.id });
    }
  } catch { /* never block the request */ }
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
 * Returns { skipped } when postings are off or no GL is configured, { documentRef } on success,
 * { glFail } on failure — the request is left at Paid or GL Failed accordingly.
 */
async function postToLedger(id, req) {
  const row = await getRow(id);
  const settings = await readSettings();
  const cfg = await getApiConfig();
  if (settings.oos_payments_enabled !== 'Yes' || !cfg.gl_url) return { skipped: true };
  let extra = {};
  try { extra = JSON.parse(cfg.gl_extra || '{}'); } catch { /* ignore */ }

  const emp = await loadEmployee(row.employee);
  const prevStatus = row.status;
  try {
    // The bank account is read now, not from the request: a corrected account number on the
    // employee's record should be used on a retry.
    const account   = emp?.bank_account || '';
    const expenseGl = settings.oos_expense_gl || '';
    const amount    = round2(row.amount);
    const missing = [
      !(amount > 0) && 'an amount',
      !expenseGl    && 'the Out of Station expense GL account (Out of Station → Setup)',
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
       WHERE id = ${toBigInt(id)}`;
    await writeLog(id, req.user?.id, `Posted to the GL — reference ${result.documentRef ?? referenceNo}`, prevStatus, 'Paid');
    notify('paid', row, req);
    return { documentRef: result.documentRef ?? referenceNo };
  } catch (e) {
    const fail = glFailure(e);
    await prisma.$executeRaw`
      UPDATE outofstation_requests SET status = 'GL Failed', payment_log = ${JSON.stringify(fail.log)}, updated_at = NOW()
       WHERE id = ${toBigInt(id)}`.catch(() => {});
    await writeLog(id, req.user?.id, `GL posting failed: ${String(fail.glError || '').slice(0, 400)}`, prevStatus, 'GL Failed');
    console.error(`[out of station] GL posting failed for ${row.request_number}:`, fail.glError);
    return { glFail: fail };
  }
}

/** Spread into a response: the blocking detail when posting failed. */
const glDetail = (fail) => (fail ? { glError: fail.glError, glInvalidAccounts: fail.glInvalidAccounts, glImbalance: fail.glImbalance } : {});

/** Message + payload after a posting attempt. `prefix` names what happened first ("Request approved"). */
function postingOutcome(res, post, row, prefix = null) {
  if (post.documentRef) return respond.ok(res, `${prefix ? `${prefix} and paid` : 'Paid'} — GL reference ${post.documentRef}`, row);
  if (post.glFail) return res.status(200).json({
    status: '200', message: `${prefix ? `${prefix}, but the` : 'The'} GL posting failed: ${post.glFail.glError}`, data: row, ...glDetail(post.glFail),
  });
  return respond.ok(res, `${prefix ?? 'Approved'}. Postings are switched off, so nothing was sent to the GL.`, row);
}

// ══════════════════════════════════════════════════════════════════════════════
// SETUP
// ══════════════════════════════════════════════════════════════════════════════

// GET /out-of-station/settings — expense GL, posting branch, supervisor tier and postings switch.
exports.getSettings = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Out of station settings', await readSettings());
});

// PUT /out-of-station/settings — save any of the setting keys.
exports.saveSettings = asyncHandler(async (req, res) => {
  for (const key of ['oos_supervisor_approval', 'oos_payments_enabled']) {
    if (req.body[key] !== undefined && !['Yes', 'No'].includes(String(req.body[key])))
      return respond.badReq(res, `${key} must be Yes or No`);
  }
  await prisma.$transaction(async (tx) => {
    for (const key of SETTING_KEYS) {
      if (req.body[key] === undefined) continue;
      await upsertSetting(tx, key, SETTINGS_CAT, String(req.body[key] ?? '').trim());
    }
  }, TX_OPTS);
  logActivity({ module: 'Out of Station', action: 'update_settings', details: req.body, ...fromReq(req) });
  respond.ok(res, 'Out of station settings saved', await readSettings());
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

// GET /out-of-station/employees[?scope=personal] — who the caller may raise a request for.
//   personal (Personal Out of Station): themself and their direct reports, for everyone;
//   otherwise (Manage Out of Station): every active employee for HR setup, else as personal.
// Each row says whether it is the caller (is_self) or one of their direct reports (is_report).
exports.getRequestableEmployees = asyncHandler(async (req, res) => {
  const me = myEmployeeId(req);
  const personal = req.query.scope === 'personal' || !canManage(req);
  const where = !personal
    ? Prisma.sql`e.status = '1'`
    : me ? Prisma.sql`e.status = '1' AND (e.id = ${toBigInt(me)} OR e.supervisorId = ${toBigInt(me)})`
         : null;
  if (!where) return respond.ok(res, 'Employees', []);
  const rows = await prisma.$queryRaw`
    SELECT e.id, e.employee_id AS employee_code,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.paygradeId AS paygrade_id, pg.name AS paygrade_name, e.supervisorId AS supervisor_id
      FROM employee e
      LEFT JOIN paygrades pg ON pg.id = e.paygradeId
     WHERE ${where}
     ORDER BY e.firstName, e.lastName`.catch(() => []);
  respond.ok(res, 'Employees', s(rows).map(r => ({
    ...r,
    is_self:   String(r.id) === me,
    is_report: !!me && String(r.supervisor_id ?? '') === me,
  })));
});

// POST /out-of-station/quote — { employee, date_start, date_end } → days, rate and amount, for the form.
exports.quote = asyncHandler(async (req, res) => {
  const emp = await loadEmployee(req.body.employee || myEmployeeId(req));
  if (!emp) return respond.badReq(res, 'Employee not found');
  if (!canActFor(req, emp)) return respond.forbidden(res, 'You can only raise out-of-station requests for yourself or your direct reports');
  const q = await quoteFor(emp, req.body.date_start, req.body.date_end);
  if (q.error) return respond.badReq(res, q.error);
  respond.ok(res, 'Quote', { days: q.days, daily_rate: q.daily_rate, amount: q.amount, paygrade_name: emp.paygrade_name });
});

// GET /out-of-station/requests?scope=mine|team|all&status=&from=&to=
//   mine — the caller's own requests and those they raised; team — their direct reports';
//   all  — everyone's (view/approve/manage). from/to keep requests that overlap the range.
exports.listRequests = asyncHandler(async (req, res) => {
  const scope = ['mine', 'team', 'all'].includes(req.query.scope) ? req.query.scope : 'mine';
  const me = myEmployeeId(req);
  const where = [];
  if (scope === 'all') {
    if (!canViewAll(req)) return respond.forbidden(res, 'You do not have access to all out-of-station requests');
  } else if (scope === 'team') {
    if (!me) return respond.ok(res, 'Requests', []);
    where.push(Prisma.sql`e.supervisorId = ${toBigInt(me)}`);
  } else {
    where.push(me
      ? Prisma.sql`(r.employee = ${toBigInt(me)} OR r.requested_by = ${toBigInt(req.user.id)})`
      : Prisma.sql`r.requested_by = ${toBigInt(req.user.id)}`);
  }
  if (req.query.status) where.push(Prisma.sql`r.status = ${String(req.query.status)}`);
  const from = parseDay(req.query.from), to = parseDay(req.query.to);
  if (from) where.push(Prisma.sql`r.date_end >= ${from}`);
  if (to)   where.push(Prisma.sql`r.date_start <= ${to}`);
  const clause = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
  const rows = await prisma.$queryRaw`${REQUEST_SELECT} ${clause} ORDER BY r.created_at DESC, r.id DESC`;
  respond.ok(res, 'Requests', s(rows));
});

// GET /out-of-station/approvals — requests the caller can act on now: their direct reports' at the
// supervisor tier, and (HR approvers) everyone's at the HR tier. Never the caller's own.
exports.listApprovals = asyncHandler(async (req, res) => {
  const me = myEmployeeId(req);
  const clauses = [];
  if (me) clauses.push(Prisma.sql`(r.status = 'Pending Approval' AND e.supervisorId = ${toBigInt(me)})`);
  if (isHrApprover(req)) clauses.push(Prisma.sql`r.status = 'Pending HR Approval'`);
  if (!clauses.length) return respond.ok(res, 'Approvals', []);
  const notMine = me ? Prisma.sql`AND r.employee <> ${toBigInt(me)}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    ${REQUEST_SELECT} WHERE (${Prisma.join(clauses, ' OR ')}) ${notMine}
    ORDER BY r.submitted_at DESC, r.id DESC`;
  respond.ok(res, 'Approvals', s(rows));
});

// GET /out-of-station/requests/:id
exports.getRequest = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  const me = myEmployeeId(req);
  const visible = isOwner(req, row) || canViewAll(req) || (me && String(row.supervisor_id ?? '') === me);
  if (!visible) return respond.forbidden(res, 'You do not have access to this request');
  respond.ok(res, 'Request', row);
});

// GET /out-of-station/requests/:id/history — status history, oldest first.
exports.getHistory = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
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

// POST /out-of-station/requests — { employee?, purpose, location, date_start, date_end, submit? }.
// Saved as a Draft; `submit: true` sends it for approval straight away.
exports.createRequest = asyncHandler(async (req, res) => {
  const purpose  = String(req.body.purpose  ?? '').trim();
  const location = String(req.body.location ?? '').trim();
  if (!purpose)  return respond.badReq(res, 'Purpose is required');
  if (!location) return respond.badReq(res, 'Location is required');
  if (purpose.length > 255 || location.length > 150) return respond.badReq(res, 'Purpose (255) or location (150) is too long');

  const employeeId = req.body.employee || myEmployeeId(req);
  if (!employeeId) return respond.badReq(res, 'No employee record is linked to your account. Contact HR to link your profile.');
  const emp = await loadEmployee(employeeId);
  if (!emp) return respond.badReq(res, 'Employee not found');
  if (emp.status !== '1') return respond.badReq(res, 'Out-of-station requests can only be raised for active employees');
  if (!canActFor(req, emp)) return respond.forbidden(res, 'You can only raise out-of-station requests for yourself or your direct reports');

  const q = await quoteFor(emp, req.body.date_start, req.body.date_end);
  if (q.error) return respond.badReq(res, q.error);
  const clash = await findOverlap(emp.id, q.start, q.end);
  if (clash) return respond.badReq(res, overlapMessage(clash));

  const id = newId();
  for (let attempt = 0; ; attempt++) {
    const number = await nextRequestNumber(q.start.getUTCFullYear());
    try {
      await prisma.$executeRaw`
        INSERT INTO outofstation_requests
          (id, request_number, employee, purpose, location, date_start, date_end, days,
           paygrade_id, daily_rate, amount, account_no, branch, status, approval_level,
           requested_by, created_at, updated_at)
        VALUES (${id}, ${number}, ${toBigInt(emp.id)}, ${purpose}, ${location}, ${q.start}, ${q.end}, ${q.days},
                ${toBigInt(emp.paygrade_id)}, ${q.daily_rate}, ${q.amount}, ${emp.bank_account ?? null}, ${emp.branch_code ?? null},
                'Draft', 0, ${toBigInt(req.user?.id)}, NOW(), NOW())`;
      break;
    } catch (e) {
      // Two requests numbered at the same moment: take the next number.
      if (attempt < 4 && /unique|duplicate/i.test(String(e.message))) continue;
      throw e;
    }
  }
  await writeLog(id, req.user?.id, emp.id === myEmployeeId(req) ? 'Request created' : `Request created on behalf of ${emp.employee_name}`, null, 'Draft');
  logActivity({ module: 'Out of Station', action: 'create', entityId: String(id), entityName: emp.employee_name, ...fromReq(req) });

  if (req.body.submit) {
    const msg = await submitRequest(String(id), req);
    return respond.created(res, msg, await getRow(id));
  }
  respond.created(res, 'Out-of-station request saved as a draft', await getRow(id));
});

// PUT /out-of-station/requests/:id — edit a Draft. Days, rate and amount are recalculated.
exports.updateRequest = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft requests can be edited');
  if (!isOwner(req, row)) return respond.forbidden(res, 'You can only edit your own requests or those you raised');

  const purpose  = req.body.purpose  !== undefined ? String(req.body.purpose).trim()  : row.purpose;
  const location = req.body.location !== undefined ? String(req.body.location).trim() : row.location;
  if (!purpose)  return respond.badReq(res, 'Purpose is required');
  if (!location) return respond.badReq(res, 'Location is required');

  const emp = await loadEmployee(row.employee);
  const q = await quoteFor(emp, req.body.date_start ?? String(row.date_start).slice(0, 10), req.body.date_end ?? String(row.date_end).slice(0, 10));
  if (q.error) return respond.badReq(res, q.error);
  const clash = await findOverlap(emp.id, q.start, q.end, row.id);
  if (clash) return respond.badReq(res, overlapMessage(clash));

  await prisma.$executeRaw`
    UPDATE outofstation_requests
       SET purpose = ${purpose}, location = ${location}, date_start = ${q.start}, date_end = ${q.end},
           days = ${q.days}, paygrade_id = ${toBigInt(emp.paygrade_id)}, daily_rate = ${q.daily_rate}, amount = ${q.amount},
           account_no = ${emp.bank_account ?? null}, branch = ${emp.branch_code ?? null}, updated_at = NOW()
     WHERE id = ${toBigInt(row.id)}`;
  respond.ok(res, 'Request updated', await getRow(row.id));
});

// DELETE /out-of-station/requests/:id — remove a Draft.
exports.deleteRequest = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft requests can be deleted. Cancel it instead.');
  if (!isOwner(req, row)) return respond.forbidden(res, 'You can only delete your own requests or those you raised');
  await prisma.$executeRaw`DELETE FROM outofstation_log WHERE request_id = ${toBigInt(row.id)}`;
  await prisma.$executeRaw`DELETE FROM outofstation_requests WHERE id = ${toBigInt(row.id)}`;
  logActivity({ module: 'Out of Station', action: 'delete', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
  respond.ok(res, 'Request deleted');
});

/**
 * Send a Draft for approval and return the message to show. The supervisor tier applies when it is
 * switched on and the employee has a supervisor — and is skipped when that supervisor raised the
 * request, since raising it is their endorsement.
 */
async function submitRequest(id, req) {
  const row = await getRow(id);
  const settings = await readSettings();
  const raisedBySupervisor = !!row.supervisor_id && myEmployeeId(req) === String(row.supervisor_id);
  const toSupervisor = settings.oos_supervisor_approval === 'Yes' && !!row.supervisor_id && !raisedBySupervisor;
  const status = toSupervisor ? 'Pending Approval' : 'Pending HR Approval';

  await prisma.$executeRaw`
    UPDATE outofstation_requests
       SET status = ${status}, approval_level = ${toSupervisor ? 0 : 1},
           submitted_by = ${toBigInt(req.user?.id)}, submitted_at = NOW(), updated_at = NOW()
     WHERE id = ${toBigInt(id)}`;
  const why = toSupervisor ? 'Submitted for supervisor approval'
            : raisedBySupervisor ? 'Submitted by the supervisor — sent to HR approval'
            : settings.oos_supervisor_approval !== 'Yes' ? 'Submitted — sent to HR approval'
            : 'Submitted — no supervisor on record, sent to HR approval';
  await writeLog(id, req.user?.id, why, row.status, status);
  notify(toSupervisor ? 'supervisor_pending' : 'hr_pending', { ...row, status }, req);
  return toSupervisor ? 'Request submitted for supervisor approval' : 'Request submitted for HR approval';
}

// POST /out-of-station/requests/:id/submit
exports.submit = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft requests can be submitted');
  if (!isOwner(req, row)) return respond.forbidden(res, 'You can only submit your own requests or those you raised');
  const msg = await submitRequest(row.id, req);
  respond.ok(res, msg, await getRow(row.id));
});

// POST /out-of-station/requests/:id/approve — supervisor tier sends it to HR; HR's approval approves
// and posts it.
exports.approve = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  const me = myEmployeeId(req);
  if (me && String(row.employee) === me) return respond.forbidden(res, 'You cannot approve your own out-of-station request');

  if (row.status === 'Pending Approval') {
    const isSupervisor = me && String(row.supervisor_id ?? '') === me;
    if (!isSupervisor && !isHrApprover(req)) return respond.forbidden(res, "Only the employee's supervisor or HR can approve at this stage");
    await prisma.$executeRaw`
      UPDATE outofstation_requests SET status = 'Pending HR Approval', approval_level = 1, updated_at = NOW()
       WHERE id = ${toBigInt(row.id)}`;
    await writeLog(row.id, req.user?.id, 'Supervisor approved — awaiting HR approval', row.status, 'Pending HR Approval');
    notify('hr_pending', row, req);
    logActivity({ module: 'Out of Station', action: 'supervisor_approve', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
    return respond.ok(res, 'Supervisor approval recorded — awaiting HR approval', await getRow(row.id));
  }

  if (row.status !== 'Pending HR Approval') return respond.badReq(res, `This request is ${row.status} and is not awaiting approval`);
  if (!isHrApprover(req)) return respond.forbidden(res, 'Only HR can give the final approval');

  await prisma.$executeRaw`
    UPDATE outofstation_requests
       SET status = 'Approved', approval_level = 2, approved_by = ${toBigInt(req.user?.id)}, approved_at = NOW(), updated_at = NOW()
     WHERE id = ${toBigInt(row.id)}`;
  await writeLog(row.id, req.user?.id, 'Final approval by HR', row.status, 'Approved');
  notify('approved', row, req);
  logActivity({ module: 'Out of Station', action: 'approve', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });

  const post = await postToLedger(row.id, req);
  postingOutcome(res, post, await getRow(row.id), 'Request approved');
});

// POST /out-of-station/requests/:id/reject — { reason } at either approval tier.
exports.reject = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) return respond.badReq(res, 'A reason is required to reject a request');
  const me = myEmployeeId(req);
  if (row.status === 'Pending Approval') {
    const isSupervisor = me && String(row.supervisor_id ?? '') === me;
    if (!isSupervisor && !isHrApprover(req)) return respond.forbidden(res, "Only the employee's supervisor or HR can reject at this stage");
  } else if (row.status === 'Pending HR Approval') {
    if (!isHrApprover(req)) return respond.forbidden(res, 'Only HR can reject at this stage');
  } else {
    return respond.badReq(res, `This request is ${row.status} and is not awaiting approval`);
  }
  await prisma.$executeRaw`
    UPDATE outofstation_requests
       SET status = 'Rejected', rejection_reason = ${reason.slice(0, 500)}, approved_by = ${toBigInt(req.user?.id)}, updated_at = NOW()
     WHERE id = ${toBigInt(row.id)}`;
  await writeLog(row.id, req.user?.id, `Rejected: ${reason}`, row.status, 'Rejected');
  notify('rejected', row, req, reason);
  logActivity({ module: 'Out of Station', action: 'reject', entityId: String(row.id), entityName: row.request_number, details: { reason }, ...fromReq(req) });
  respond.ok(res, 'Request rejected', await getRow(row.id));
});

// POST /out-of-station/requests/:id/cancel — { reason? }. The owner can cancel while it is open;
// HR can also cancel an approved request that has not been paid.
exports.cancel = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Request not found');
  const reason = String(req.body?.reason ?? '').trim();
  const ownerMayCancel = OPEN_STATUSES.includes(row.status) && isOwner(req, row);
  const hrMayCancel    = ['Approved', 'GL Failed', ...OPEN_STATUSES].includes(row.status) && (isHrApprover(req) || canManage(req));
  if (row.status === 'Paid') return respond.badReq(res, 'A paid request cannot be cancelled');
  if (!ownerMayCancel && !hrMayCancel) return respond.forbidden(res, `You cannot cancel a request that is ${row.status}`);
  if (row.document_ref) return respond.badReq(res, 'This request already has a GL reference and cannot be cancelled');
  await prisma.$executeRaw`
    UPDATE outofstation_requests SET status = 'Cancelled', rejection_reason = ${reason ? reason.slice(0, 500) : null}, updated_at = NOW()
     WHERE id = ${toBigInt(row.id)}`;
  await writeLog(row.id, req.user?.id, reason ? `Cancelled: ${reason}` : 'Cancelled', row.status, 'Cancelled');
  notify('cancelled', row, req);
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
  const post = await postToLedger(row.id, req);
  if (post.skipped) return respond.badReq(res, 'Postings are switched off or no GL connection is configured, so nothing was sent');
  logActivity({ module: 'Out of Station', action: fromStatus === 'GL Failed' ? 'retry_gl' : 'post_gl', entityId: String(row.id), entityName: row.request_number, ...fromReq(req) });
  postingOutcome(res, post, await getRow(row.id));
}
exports.retryGL = asyncHandler((req, res) => repost(req, res, 'GL Failed', 'retried'));
exports.post    = asyncHandler((req, res) => repost(req, res, 'Approved', 'posted'));
