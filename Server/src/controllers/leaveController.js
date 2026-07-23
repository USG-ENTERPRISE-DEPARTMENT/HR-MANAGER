const { prisma }        = require('../helpers/dbQueryHelper');
const asyncHandler      = require('../middleware/asyncHandler');
const respond           = require('../helpers/respondHelper');
const { tmsg }          = require('../helpers/messageStore');
const { sendLeaveEmail } = require('../helpers/emailHelper');
const { logActivity, fromReq } = require('./auditController');
const { toBigInt, s, enumSql } = require('../helpers/controllerHelpers');
const { notifyEmployee, notifyUser, notifyUsersWithPermission, notifyUsersWithRole } = require('../helpers/notificationHelper');
const { Prisma } = require('@prisma/client'); // Prisma.sql / Prisma.join for portable dynamic SQL
const { upsertSetting: upsertSettingShared } = require('../helpers/settingsHelper');

// In-app bell notification for a leave action (independent of the email toggle).
// 'submitted' → the employee's supervisor; approved/rejected/cancelled → the employee.
async function notifyLeaveInApp(leaveId, kind, reason, fromUser = null) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT el.employee, e.supervisorId AS supervisor_id, lt.name AS leave_type_name,
             TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name
        FROM employeeleaves el
        LEFT JOIN employee e   ON e.id  = el.employee
        LEFT JOIN leavetypes lt ON lt.id = el.leave_type
       WHERE el.id = ${toBigInt(leaveId)}`;
    if (!rows.length) return;
    const r  = rows[0];
    const lt = r.leave_type_name ?? 'Leave';
    if (kind === 'supervisor_pending') {
      if (r.supervisor_id) notifyEmployee(r.supervisor_id, {
        message: `${r.employee_name || 'An employee'} submitted a ${lt} request for your approval`,
        action: 'LeaveManagement', type: 'leave', fromUser, fromEmployee: r.employee,
      });
    } else if (kind === 'hr_pending') {
      notifyUsersWithPermission('manage_leave_approvals', {
        message: `${r.employee_name || 'An employee'}: ${lt} request awaits HR approval`,
        action: 'LeaveSetup', type: 'leave', fromUser, fromEmployee: r.employee, employee: r.employee,
      }, fromUser);
    } else if (r.employee) {
      const msg = kind === 'approved'  ? `Your ${lt} request was approved`
                : kind === 'rejected'  ? `Your ${lt} request was rejected${reason ? ': ' + reason : ''}`
                : kind === 'cancelled' ? `Your ${lt} request was cancelled`
                : `Your ${lt} request was updated`;
      notifyEmployee(r.employee, { message: msg, action: 'LeaveManagement', type: 'leave', fromUser });
    }
  } catch { /* never block the request */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInt(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// Whole months from dateA to dateB (positive if B > A)
function monthsDiff(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}


// ── Working days calculator ───────────────────────────────────────────────────

async function getWorkingDays(dateStart, dateEnd) {
  const holidays = await prisma.holidays.findMany({ select: { dateh: true } }).catch(() => []);
  const holidaySet = new Set(
    holidays.map(h => {
      const d = h.dateh instanceof Date ? h.dateh : new Date(h.dateh);
      return d.toISOString().split('T')[0];
    })
  );

  // Use Prisma model so enum @map values are returned as Prisma names (e.g. 'Non_working_Day' not 'Non-working Day')
  const workdays = await prisma.workdays.findMany({ select: { name: true, status: true } }).catch(() => []);
  const workdayMap = {};
  for (const w of workdays) workdayMap[w.name.toLowerCase()] = w.status;

  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const days = [];
  const cur  = new Date(dateStart);
  const end  = new Date(dateEnd);
  while (cur <= end) {
    const dayName = DAY_NAMES[cur.getDay()];
    const dateStr = cur.toISOString().split('T')[0];
    const wd = workdayMap[dayName] ?? 'Full_Day';
    if (wd !== 'Non_working_Day' && !holidaySet.has(dateStr)) {
      days.push({ date: dateStr, type: wd === 'Half_Day' ? 'Half_Day' : 'Full_Day' });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// ── Leave balance calculator ──────────────────────────────────────────────────

async function calcBalance(employeeId, leaveTypeId, leavePeriodId, empProfile) {
  const [typeRow, periodRow] = await Promise.all([
    prisma.leavetypes.findUnique({ where: { id: toBigInt(leaveTypeId) } }).catch(() => null),
    prisma.leaveperiods.findUnique({ where: { id: toBigInt(leavePeriodId) } }).catch(() => null),
  ]);

  // Find matching rule for this employee + leave type (raw SQL — avoids stale Prisma client types)
  const emp = empProfile ?? (await prisma.$queryRaw`
    SELECT jobTitleId AS job_title_id, departmentId, employmentStatusId AS emp_status_id, paygradeId, hireDate
     FROM employee WHERE id=${toBigInt(employeeId)}`.catch(() => []))[0] ?? {};
  const allRules = await prisma.leaverules.findMany({ where: { leave_type: toBigInt(leaveTypeId) } }).catch(() => []);
  const ruleMatch = allRules.find(r => {
    if (r.employee          && String(r.employee)          !== String(employeeId        ?? '')) return false;
    if (r.leave_period      && String(r.leave_period)      !== String(leavePeriodId     ?? '')) return false;
    if (r.job_title         && String(r.job_title)         !== String(emp.job_title_id  ?? '')) return false;
    if (r.department        && String(r.department)        !== String(emp.departmentId  ?? '')) return false;
    if (r.employment_status && String(r.employment_status) !== String(emp.emp_status_id ?? '')) return false;
    if (r.leave_group       && String(r.leave_group)       !== String(emp.paygradeId    ?? '')) return false;
    if (r.exp_days) {
      const days = emp.hireDate ? Math.floor((Date.now() - new Date(emp.hireDate).getTime()) / 86400000) : 0;
      if (days < Number(r.exp_days)) return false;
    }
    return true;
  });

  // Rule overrides type where present
  const effectiveRow = {
    default_per_year:                   ruleMatch?.default_per_year                   ?? typeRow?.default_per_year,
    propotionate_on_joined_date:        ruleMatch?.propotionate_on_joined_date        ?? typeRow?.propotionate_on_joined_date,
    leave_accrue:                       ruleMatch?.leave_accrue                       ?? typeRow?.leave_accrue,
    accrual_frequency:                  ruleMatch?.accrual_frequency                  ?? typeRow?.accrual_frequency ?? 'Monthly',
    accrual_rate:                       ruleMatch?.accrual_rate                       ?? typeRow?.accrual_rate      ?? null,
    carried_forward_leave_availability: ruleMatch?.carried_forward_leave_availability ?? typeRow?.carried_forward_leave_availability ?? 365,
  };
  const baseAllocated = parseFloat(effectiveRow.default_per_year) || 0;

  // Starting balance override (e.g. from carry-forward)
  const sb = await prisma.$queryRaw`
    SELECT amount FROM leavestartingbalance WHERE employee=${toBigInt(employeeId)} AND leave_type=${toBigInt(leaveTypeId)} AND leave_period=${toBigInt(leavePeriodId)}`.catch(() => []);
  const startBalance = sb.length ? parseFloat(sb[0].amount) : null;

  // Check if the CF availability window has expired.
  // Values ≤ 12 are legacy month-counts (from old parseInt of "X Months" label); convert to days.
  let cfExpired = false;
  if (startBalance !== null && periodRow) {
    const rawAvail    = parseInt(effectiveRow.carried_forward_leave_availability) || 365;
    const cfAvailDays = rawAvail <= 12 ? rawAvail * 30 : rawAvail;
    const expiryDate  = new Date(new Date(periodRow.date_start).getTime() + cfAvailDays * 86400000);
    if (new Date() > expiryDate) cfExpired = true;
  }

  let totalAllocated;
  if (startBalance !== null && !cfExpired) {
    // CF window still open — use the full starting balance (base + carried days)
    totalAllocated = startBalance;
  } else {
    // No starting balance or CF window has closed — work from the base allocation only
    totalAllocated = baseAllocated;

    // ── Proportionate on joined date ──────────────────────────────────────────
    if (effectiveRow.propotionate_on_joined_date === 'Yes' && periodRow) {
      // Use hireDate already on emp — joined_date is on a different table and caused silent SQL failure
      const joinDate    = emp.hireDate ? new Date(emp.hireDate) : null;
      const periodStart = new Date(periodRow.date_start);
      const periodEnd   = new Date(periodRow.date_end);

      if (joinDate && joinDate > periodStart && joinDate <= periodEnd) {
        const totalMonths   = monthsDiff(periodStart, periodEnd) || 1;
        const remainMonths  = monthsDiff(joinDate, periodEnd);
        const ratio         = Math.max(0, Math.min(1, remainMonths / totalMonths));
        totalAllocated = Math.round(baseAllocated * ratio);
      }
    }

    // ── Leave accrual ─────────────────────────────────────────────────────────
    if (effectiveRow.leave_accrue === 'Yes' && periodRow) {
      const periodStart   = new Date(periodRow.date_start);
      const periodEnd     = new Date(periodRow.date_end);
      const today         = new Date();
      const refDate       = today < periodEnd ? today : periodEnd;
      const totalMonths   = monthsDiff(periodStart, periodEnd) || 1;
      const elapsedMonths = Math.max(0, monthsDiff(periodStart, refDate));

      const frequency  = effectiveRow.accrual_frequency || 'Monthly';
      const rate       = parseFloat(effectiveRow.accrual_rate) || 0;
      // unitMonths: how many months per accrual grant
      const unitMonths = frequency === 'Quarterly' ? 3 : frequency === 'Bi-annually' ? 6 : 1;

      if (rate > 0) {
        // Rate-based: employee earns `rate` days per completed unit
        const completedUnits = Math.floor(elapsedMonths / unitMonths);
        totalAllocated = Math.min(Math.floor(rate * completedUnits), totalAllocated);
      } else if (unitMonths === 1) {
        // Monthly, no rate: continuous linear ratio (original behaviour)
        const ratio = Math.min(1, elapsedMonths / totalMonths);
        totalAllocated = Math.floor(totalAllocated * ratio);
      } else {
        // Quarterly / Bi-annually, no rate: divide allocation evenly across units
        const totalUnits     = Math.ceil(totalMonths / unitMonths);
        const completedUnits = Math.floor(elapsedMonths / unitMonths);
        const daysPerUnit    = totalAllocated / (totalUnits || 1);
        totalAllocated = Math.min(Math.floor(daysPerUnit * completedUnits), totalAllocated);
      }
    }
  }

  const eId = toBigInt(employeeId), ltId = toBigInt(leaveTypeId), lpId = toBigInt(leavePeriodId);
  const usedRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt FROM employeeleavedays eld
     JOIN employeeleaves el ON el.id = eld.employee_leave
     WHERE el.employee=${eId} AND el.leave_type=${ltId} AND el.leave_period=${lpId} AND el.status='Approved'`.catch(() => [{ cnt: 0 }]);
  const used = parseInt(usedRows[0]?.cnt ?? 0);

  const pendRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt FROM employeeleavedays eld
     JOIN employeeleaves el ON el.id = eld.employee_leave
     WHERE el.employee=${eId} AND el.leave_type=${ltId} AND el.leave_period=${lpId}
       AND el.status IN ('Draft', 'Pending', 'Pending Approval', 'Pending HR Approval')`.catch(() => [{ cnt: 0 }]);
  const pending = parseInt(pendRows[0]?.cnt ?? 0);

  return { allocated: totalAllocated, used, pending, balance: totalAllocated - used - pending };
}

// ── Allowance settings (stored in `settings` table, category='leave_allowance') ─

const ALLOW_KEYS = [
  'leave_allow_enabled',      // Yes|No
  'leave_allow_tax_gl',       // Tax suspense GL account
  'leave_allow_debit_gl',     // Main debit GL fallback
  'leave_allow_annual_factor',// Basic × 12 × factor = Gross Leave Allowance (default 0.3)
  'leave_allow_tax_rate',     // Tax rate on taxable portion (default 0.3)
];

const ALLOW_DEFAULTS = {
  leave_allow_enabled:       'No',
  leave_allow_tax_gl:        '',
  leave_allow_debit_gl:      '',
  leave_allow_annual_factor: '0.3',
  leave_allow_tax_rate:      '0.3',
};

/** Read an app-control toggle from the settings table. Returns `defaultOn` when never saved. */
async function readControlSetting(name, defaultOn) {
  const row = await prisma.settings
    .findFirst({ where: { name, category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  return row ? row.value === '1' : defaultOn;
}

/** Whether leave allowances are paid/posted. Off ⇒ record-only (skip all GL postings). */
const leavePaymentsEnabled = () => readControlSetting('leave_payments_enabled', true);

async function getAllowanceSettings() {
  const rows = await prisma.settings
    .findMany({ where: { category: 'leave_allowance' }, select: { name: true, value: true } })
    .catch(() => []);
  const map = { ...ALLOW_DEFAULTS };
  for (const r of rows) map[r.name] = r.value ?? map[r.name];
  return map;
}

async function calcLeaveAllowance(employeeId, settings) {
  const annualFactor = parseFloat(settings.leave_allow_annual_factor) || 0.3;
  const taxRate      = parseFloat(settings.leave_allow_tax_rate) || 0.3;

  const empRow = await prisma.employee.findUnique({ where: { id: toBigInt(employeeId) }, select: { notcheId: true } }).catch(() => null);
  const notcheId = empRow?.notcheId;
  if (!notcheId) return { amount: 0, leave_tax: 0 };

  const notchRow = await prisma.notches.findUnique({ where: { id: toBigInt(notcheId) }, select: { amount: true } }).catch(() => null);
  const basicSalary = parseFloat(notchRow?.amount) || 0;
  if (!basicSalary) return { amount: 0, leave_tax: 0 };

  // Gross Leave Allowance
  const sgla       = basicSalary * 12 * annualFactor;
  // Deductible = basic (no additional component in simplified version)
  const deductible = basicSalary;
  const taxable    = Math.max(0, sgla - deductible);
  const tax        = taxable * taxRate;
  const net        = deductible + (taxable - tax);

  return { amount: Math.round(net * 100) / 100, leave_tax: Math.round(tax * 100) / 100 };
}

// Internal: posts GL (called from processLeaveAllowance and approveAllowanceLeave).
// No-op when leave payments are switched off — leave is recorded only, never paid/posted.
async function postLeaveGL(leaveId) {
  if (!(await leavePaymentsEnabled())) return;
  const s = await getAllowanceSettings();
  const rows = await prisma.$queryRaw`
    SELECT el.*, e.bankAccount AS emp_bank_acc
     FROM employeeleaves el
     LEFT JOIN employee e ON e.id = el.employee
     WHERE el.id=${toBigInt(leaveId)}`;
  if (!rows.length) return;
  const leave      = rows[0];
  const amount     = parseFloat(leave.amount)    || 0;
  const taxAmount  = parseFloat(leave.leave_tax) || 0;
  if (!amount) return;
  const custAccount = (leave.emp_acc_no || leave.emp_bank_acc || '').trim();
  if (!custAccount) throw new Error('No bank account on record for this employee');

  const transRef    = Date.now();
  const documentRef = Math.random().toString(36).substring(2, 4).toUpperCase() + String(transRef);
  const logEntry    = JSON.stringify({
    documentRef, amount, leave_tax: taxAmount,
    debit_gl:    (leave.leave_gl || s.leave_allow_debit_gl || '').trim(),
    tax_gl:      s.leave_allow_tax_gl || '',
    credit_acct: custAccount,
    employee:    String(leave.employee),
    posted_at:   new Date().toISOString(),
  });
  await prisma.$executeRaw`UPDATE employeeleaves SET documentref=${documentRef}, allowance_status='Paid', api_response=${logEntry.substring(0, 500)} WHERE id=${toBigInt(leaveId)}`;
}

async function processLeaveAllowance(leaveId) {
  try {
    // Record-only mode — skip allowance scheduling/payment entirely; the leave itself is still saved.
    if (!(await leavePaymentsEnabled())) return;
    const s = await getAllowanceSettings();
    if (s.leave_allow_enabled !== 'Yes') return;

    const rows = await prisma.$queryRaw`
      SELECT el.*, e.bankAccount AS emp_bank_acc, e.branchId AS emp_branch_id
       FROM employeeleaves el
       LEFT JOIN employee e ON e.id = el.employee
       WHERE el.id=${toBigInt(leaveId)}`.catch(() => []);
    if (!rows.length) return;
    const leave = rows[0];

    if (leave.allowance_status === 'Paid') return;
    if (leave.allowance_status === 'Pre-enable Skip') return;
    if (leave.req_allowance !== 'Yes') return;

    const amount = parseFloat(leave.amount) || 0;
    if (!amount) return;

    // Financial stages are completed before HR approval. A missing bank account does not prevent
    // scheduling; the posting job will mark it as failed if it is still missing on the posting date.
    // Financial approval now happens before HR approval. `Financial Approved` proves that the
    // configured chain has already completed, so HR must not route it through finance again.
    if (!['Financial Approved', 'Financial Approval Not Required'].includes(leave.allowance_status)) {
      const flow    = await readLeaveFlow();
      const matched = matchedLeaveStages(flow, amount);
      if (matched.length) return;
    }

    // ── Once-per-period check ─────────────────────────────────────────────
    const typeOnceRow = await prisma.leavetypes.findUnique({ where: { id: toBigInt(leave.leave_type) }, select: { leave_allowance_once: true } }).catch(() => null);
    if (typeOnceRow?.leave_allowance_once === 'Yes') {
      const alreadyPaid = await prisma.$queryRaw`
        SELECT 1 FROM employeeleaves
         WHERE employee=${toBigInt(leave.employee)} AND leave_type=${toBigInt(leave.leave_type)} AND leave_period=${toBigInt(leave.leave_period)}
           AND allowance_status='Paid' AND id!=${toBigInt(leaveId)}
         LIMIT 1`.catch(() => []);
      if (alreadyPaid.length > 0) {
        await prisma.$executeRaw`UPDATE employeeleaves SET allowance_status='Already Paid This Period' WHERE id=${toBigInt(leaveId)}`;
        return;
      }
    }

    // All checks passed — schedule GL posting for the leave start date
    await prisma.$executeRaw`UPDATE employeeleaves SET allowance_status='GL Scheduled' WHERE id=${toBigInt(leaveId)}`;
  } catch (err) {
    console.error('[leave-allowance]', err.message);
  }
}

// Post GL and clean up sibling once-per-period leaves — called by cron and financial approval
async function postLeaveGLWithCleanup(leaveId) {
  try {
    await postLeaveGL(leaveId);
  } catch (err) {
    console.error(`[postLeaveGL] Failed for leave ${leaveId}:`, err.message);
    await prisma.$executeRaw`UPDATE employeeleaves SET allowance_status='Failed GL Posting', api_response=${err.message.substring(0, 500)} WHERE id=${toBigInt(leaveId)}`.catch(() => {});
    return;
  }

  const leaveRow = await prisma.employeeleaves
    .findUnique({ where: { id: toBigInt(leaveId) }, select: { employee: true, leave_type: true, leave_period: true } })
    .catch(() => null);
  if (!leaveRow) return;

  const typeOnceRow = await prisma.leavetypes.findUnique({ where: { id: toBigInt(leaveRow.leave_type) }, select: { leave_allowance_once: true } }).catch(() => null);
  if (typeOnceRow?.leave_allowance_once === 'Yes') {
    await prisma.$executeRaw`UPDATE employeeleaves
       SET amount=NULL, req_allowance=NULL, allowance_status='Already Paid This Period'
       WHERE employee=${toBigInt(leaveRow.employee)} AND leave_type=${toBigInt(leaveRow.leave_type)} AND leave_period=${toBigInt(leaveRow.leave_period)}
         AND allowance_status IN ('GL Scheduled', '')
         AND id != ${toBigInt(leaveId)}`.catch(() => {});
  }
}

// Called by cron — posts GL for all leaves whose start date has arrived
exports.runDailyLeaveGL = async function () {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const due = await prisma.$queryRaw`SELECT id FROM employeeleaves WHERE allowance_status='GL Scheduled' AND date_start <= ${today}`.catch(() => []);
  if (!due.length) return;
  console.log(`[leave-cron] Processing GL for ${due.length} leave(s)`);
  for (const row of due) {
    await postLeaveGLWithCleanup(toBigInt(row.id));
  }
};

// POST /leave/retry-gl/:id — HR/admin only. Retry a failed GL posting for a leave's allowance payment.
exports.retryLeaveGL = asyncHandler(async (req, res) => {
  const isAdmin = req.user?.roles?.some(r => ['admin', 'super-admin'].includes(r));
  if (!isAdmin) return respond.badReq(res, 'Only HR/admin can retry GL posting');

  const id   = toBigInt(req.params.id);
  const current = await prisma.employeeleaves.findUnique({ where: { id }, select: { id: true, allowance_status: true } }).catch(() => null);
  if (!current) return respond.notFound(res, 'Leave not found');
  if (current.allowance_status !== 'Failed GL Posting')
    return respond.badReq(res, 'Leave GL posting has not failed — no retry needed');

  await prisma.$executeRaw`UPDATE employeeleaves SET allowance_status='GL Scheduled' WHERE id=${id}`;
  await postLeaveGLWithCleanup(id);

  const updated = await prisma.employeeleaves.findUnique({ where: { id }, select: { allowance_status: true } }).catch(() => null);

  if (updated?.allowance_status === 'Paid') {
    return respond.ok(res, 'GL posting succeeded');
  } else {
    return respond.ok(res, 'GL posting failed again — check server logs', { allowance_status: updated?.allowance_status });
  }
});

// GET /leave/allowance-settings — read the leave allowance configuration (enabled flag, GL accounts, tax/factor rates).
exports.getLeaveAllowanceSettings = asyncHandler(async (req, res) => {
  respond.ok(res, 'Leave allowance settings', await getAllowanceSettings());
});

// PUT /leave/allowance-settings — save leave allowance config; when enabling for the first time,
// marks all existing approved-but-unprocessed leaves as 'Pre-enable Skip' so they're excluded from allowance payouts.
exports.updateLeaveAllowanceSettings = asyncHandler(async (req, res) => {
  // Detect transition from disabled → enabled so we can protect existing leaves
  let beingEnabled = false;
  if (req.body.leave_allow_enabled === 'Yes') {
    const prev = await prisma.settings
      .findFirst({ where: { name: 'leave_allow_enabled', category: 'leave_allowance' }, select: { value: true } })
      .catch(() => null);
    if (!prev || prev.value !== 'Yes') beingEnabled = true;
  }

  for (const key of ALLOW_KEYS) {
    if (req.body[key] === undefined) continue;
    await upsertSettingShared(null, key, 'leave_allowance', String(req.body[key]));
  }

  // Mark all existing unprocessed approved leaves so they are skipped by processLeaveAllowance.
  // Only leaves approved from this point forward will receive allowances.
  // Note: no req_allowance filter — leaves applied while allowance was off have req_allowance=null
  // and would otherwise slip through the enrichment and show a computed amount in the UI.
  if (beingEnabled) {
    await prisma.$executeRaw`UPDATE employeeleaves
       SET allowance_status='Pre-enable Skip', amount=NULL, leave_tax=NULL
       WHERE status='Approved'
         AND (allowance_status IS NULL OR allowance_status = '')`.catch(() => {});
  }

  respond.ok(res, 'Settings saved');
});

// ── Approval flow settings (category='leave_approval_flow') ──────────────────

const FLOW_KEYS     = ['leave_supervisor_approval'];
const FLOW_DEFAULTS = { leave_supervisor_approval: 'No' };

async function getApprovalFlowSettings() {
  const rows = await prisma.settings
    .findMany({ where: { category: 'leave_approval_flow' }, select: { name: true, value: true } })
    .catch(() => []);
  const map = { ...FLOW_DEFAULTS };
  for (const r of rows) map[r.name] = r.value ?? map[r.name];
  return map;
}

// GET /leave/approval-flow-settings — read the leave approval flow config (e.g. whether supervisor approval is required).
exports.getApprovalFlowSettings = asyncHandler(async (req, res) => {
  respond.ok(res, 'Approval flow settings', await getApprovalFlowSettings());
});

// PUT /leave/approval-flow-settings — save leave approval flow settings (e.g. require supervisor sign-off).
exports.updateApprovalFlowSettings = asyncHandler(async (req, res) => {
  for (const key of FLOW_KEYS) {
    if (req.body[key] === undefined) continue;
    await upsertSettingShared(null, key, 'leave_approval_flow', String(req.body[key]));
  }
  respond.ok(res, 'Approval flow settings saved');
});

// ── Multi-stage, amount-range financial approval flow ────────────────────────
// After a leave is fully approved, its allowance is routed through a configurable stage chain: each stage
// has an amount RANGE, and only the stages whose [minAmount, maxAmount] covers the leave's payout apply.
// A snapshot of the matched stages is written to employeeleave_stages and walked in order (mirrors the
// payroll/medical stage engine). An amount below every range skips financial approval → straight to GL.

/** Read + normalise the configured leave approval flow (empty array when unset/invalid). */
async function readLeaveFlow() {
  const row = await prisma.settings
    .findFirst({ where: { name: 'leave_approval_flow', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  if (!row?.value) return [];
  try {
    const arr = JSON.parse(row.value);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(st => st && String(st.name || '').trim() && (st.approverType === 'role' || st.approverType === 'user') && st.approverId != null && String(st.approverId).trim() !== '')
      .map(st => ({
        name: String(st.name).trim(),
        minAmount: Number(st.minAmount) >= 0 ? Number(st.minAmount) : 0,
        maxAmount: st.maxAmount == null || st.maxAmount === '' ? null : Number(st.maxAmount),
        approverType: st.approverType,
        approverId: String(st.approverId),
        approverLabel: st.approverLabel != null ? String(st.approverLabel) : null,
      }));
  } catch { return []; }
}

/** Stages whose amount range covers `amount`, in flow order (the routing step). */
function matchedLeaveStages(flow, amount) {
  const amt = parseFloat(amount) || 0;
  return flow.filter(st => amt >= st.minAmount && (st.maxAmount == null || amt <= st.maxAmount));
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

/** Notify a stage's approver(s): a user stage pings that user; a role stage pings all leave-allowance approvers. */
function notifyLeaveStageApprovers(stage, req, employeeId) {
  const type = stage.approver_type ?? stage.approverType;
  const idv = stage.approver_id ?? stage.approverId;
  const stageName = stage.stage_name ?? stage.name;
  const payload = { message: `A leave allowance awaits your approval (${stageName})`, action: 'CentralApproval', type: 'leave', fromUser: req.user?.id, employee: employeeId };
  if (type === 'user' && idv) notifyUser(idv, payload);
  else notifyUsersWithRole(idv, payload, req.user?.id, stage.approver_label ?? stage.approverLabel);
}

/** Snapshot the matched stages onto a leave (all Pending). */
async function snapshotLeaveStages(leaveId, matched) {
  await prisma.$executeRaw`DELETE FROM employeeleave_stages WHERE leave_id = ${toBigInt(leaveId)}`;
  for (let i = 0; i < matched.length; i++) {
    const st = matched[i];
    await prisma.$executeRaw`
      INSERT INTO employeeleave_stages (leave_id, stage_order, stage_name, approver_type, approver_id, approver_label, status)
      VALUES (${toBigInt(leaveId)}, ${i}, ${st.name}, ${st.approverType}, ${st.approverId}, ${st.approverLabel}, 'Pending')`;
  }
}

/**
 * Route a leave after the supervisor tier (or immediately when that tier is skipped).
 * Allowance-bearing leaves walk their matching financial stages first; all other leaves go to HR.
 */
async function routeAfterSupervisorApproval(leaveId, actorUserId = null) {
  const id = toBigInt(leaveId);
  const rows = await prisma.$queryRaw`
    SELECT id, employee, req_allowance, amount
      FROM employeeleaves
     WHERE id = ${id}`.catch(() => []);
  const leave = rows[0] ?? null;
  if (!leave) return { status: 'Pending HR Approval', financial: false };

  const hasAllowance = leave.req_allowance === 'Yes' && (parseFloat(leave.amount) || 0) > 0;
  if (hasAllowance) {
    const flow = await readLeaveFlow();
    const matched = matchedLeaveStages(flow, leave.amount);
    if (matched.length) {
      await snapshotLeaveStages(id, matched);
      await prisma.$executeRaw`
        UPDATE employeeleaves
           SET status='Pending Financial Approval', allowance_status='Pending Financial Approval'
         WHERE id=${id}`;
      notifyLeaveStageApprovers(matched[0], { user: { id: actorUserId } }, leave.employee);
      return { status: 'Pending Financial Approval', financial: true };
    }

    await prisma.$executeRaw`
      UPDATE employeeleaves
         SET allowance_status='Financial Approval Not Required'
       WHERE id=${id}`;
  }

  // No allowance, no financial approvers configured, or no stage matching the allowance amount:
  // finance is skipped and Admin HR receives the request directly.
  await prisma.$executeRaw`UPDATE employeeleaves SET status='Pending HR Approval' WHERE id=${id}`;
  await notifyLeaveInApp(id, 'hr_pending', null, actorUserId);
  return { status: 'Pending HR Approval', financial: false };
}

/** Load a leave's stages ordered by stage_order. */
async function loadLeaveStages(leaveId) {
  return prisma.$queryRaw`
    SELECT id, stage_order, stage_name, approver_type, approver_id, approver_label, status, acted_by, acted_at
    FROM employeeleave_stages WHERE leave_id = ${toBigInt(leaveId)} ORDER BY stage_order ASC`;
}

/** Whether the actor holds the blanket leave-allowance approval permission (or is admin). */
function hasBlanketFinancial(req) {
  const perms = req.user?.permissions || [];
  const roles = (req.user?.roles || []).map(String);
  return perms.includes('approve_leave_allowance') || roles.includes('admin') || roles.includes('super-admin');
}

// GET /leave/approval-flow — the configured amount-range approval stage chain.
exports.getLeaveApprovalFlow = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Leave approval flow retrieved', await readLeaveFlow());
});

// PUT /leave/approval-flow — validate + save the stage chain (name, approver, amount range per stage).
exports.saveLeaveApprovalFlow = asyncHandler(async (req, res) => {
  const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const clean = [];
  for (const st of stages) {
    const name = String(st?.name || '').trim();
    if (!name) return respond.badReq(res, 'Every stage needs a name');
    if (st.approverType !== 'role' && st.approverType !== 'user') return respond.badReq(res, `Stage "${name}" has an invalid approver type`);
    if (st.approverId == null || String(st.approverId).trim() === '') return respond.badReq(res, `Stage "${name}" needs an approver`);
    const minAmount = Number(st.minAmount);
    if (!Number.isFinite(minAmount) || minAmount < 0) return respond.badReq(res, `Stage "${name}" needs a valid minimum amount (≥ 0)`);
    const maxAmount = st.maxAmount == null || st.maxAmount === '' ? null : Number(st.maxAmount);
    if (maxAmount != null && (!Number.isFinite(maxAmount) || maxAmount <= minAmount)) return respond.badReq(res, `Stage "${name}" maximum must be greater than the minimum`);
    clean.push({
      name, minAmount, maxAmount,
      approverType: st.approverType,
      approverId: String(st.approverId),
      approverLabel: st.approverLabel != null ? String(st.approverLabel) : null,
    });
  }
  await upsertSettingShared(null, 'leave_approval_flow', 'app_controls', JSON.stringify(clean));
  respond.ok(res, 'Leave approval flow saved', clean);
});

// GET /leave/leaves/:id/stages — a leave's snapshotted financial-approval stage progress.
exports.getLeaveStages = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  respond.ok(res, 'Stages retrieved', s(await loadLeaveStages(id)));
});

// ── Calendar visibility settings (category='leave_calendar') ─────────────────

const CAL_KEYS     = ['calendar_show_all'];
const CAL_DEFAULTS = { calendar_show_all: 'No' };

async function getCalendarSettings() {
  const rows = await prisma.settings
    .findMany({ where: { category: 'leave_calendar' }, select: { name: true, value: true } })
    .catch(() => []);
  const map = { ...CAL_DEFAULTS };
  for (const r of rows) map[r.name] = r.value ?? map[r.name];
  return map;
}

// GET /leave/calendar-settings — read whether the leave calendar shows all employees' leaves or only the user's own.
exports.getCalendarSettings = asyncHandler(async (req, res) => {
  respond.ok(res, 'Calendar settings', await getCalendarSettings());
});

// PUT /leave/calendar-settings — save calendar visibility setting (show all vs own leaves only).
exports.updateCalendarSettings = asyncHandler(async (req, res) => {
  for (const key of CAL_KEYS) {
    if (req.body[key] === undefined) continue;
    await upsertSettingShared(null, key, 'leave_calendar', String(req.body[key]));
  }
  respond.ok(res, 'Calendar settings saved');
});

// GET /leave/calendar?from=&to= — return approved/pending leaves for calendar display; non-admins see only their own
// unless calendar_show_all is enabled in settings.
exports.getCalendarLeaves = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const isAdmin = req.user?.roles?.some(r => ['admin', 'super-admin'].includes(r));

  const cs = await getCalendarSettings();
  const showAll = cs.calendar_show_all === 'Yes';

  const conds = [Prisma.sql`el.status IN ('Approved','Pending Approval','Pending Financial Approval','Pending HR Approval')`];
  if (from) conds.push(Prisma.sql`el.date_end >= ${from}`);
  if (to)   conds.push(Prisma.sql`el.date_start <= ${to}`);

  if (!isAdmin && !showAll) {
    const userEmp = await prisma.users.findUnique({ where: { id: toBigInt(req.user.id) }, select: { employeeId: true } }).catch(() => null);
    const ownEmpId = userEmp?.employeeId;
    if (!ownEmpId) return respond.ok(res, 'Calendar leaves', []);
    conds.push(Prisma.sql`el.employee=${toBigInt(ownEmpId)}`);
  }
  const where = Prisma.join(conds, ' AND ');

  const rows = await prisma.$queryRaw`
    SELECT el.id, el.employee, el.date_start, el.date_end, el.status, el.leave_type, el.leave_period,
           el.details AS notes, el.rejection_reason,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.employee_id AS employee_code,
           d.title AS department_name,
           lt.name AS leave_type_name, lt.leave_color,
           lp.name AS period_name,
           (SELECT COUNT(*) FROM employeeleavedays eld WHERE eld.employee_leave = el.id) AS day_count
    FROM employeeleaves el
    LEFT JOIN employee         e  ON e.id  = el.employee
    LEFT JOIN companystructures d  ON d.id  = e.departmentId
    LEFT JOIN leavetypes        lt ON lt.id = el.leave_type
    LEFT JOIN leaveperiods      lp ON lp.id = el.leave_period
    WHERE ${where}
    ORDER BY el.date_start ASC`.catch(() => []);

  respond.ok(res, 'Calendar leaves', s(rows));
});

// ── Sync leave type ↔ groups (many-to-many) ──────────────────────────────────

async function syncLeaveTypeGroups(leaveTypeId, groupIds) {
  const ltId = toBigInt(leaveTypeId);
  await prisma.$executeRaw`DELETE FROM leavetype_groups WHERE leave_type_id=${ltId}`.catch(() => {});
  if (!Array.isArray(groupIds) || !groupIds.length) return;
  // DELETE above clears existing rows; de-dupe the input to replace INSERT IGNORE's dedup portably.
  const seen = new Set();
  for (const gid of groupIds) {
    const gBig = toBigInt(gid);
    if (!gBig || seen.has(String(gBig))) continue;
    seen.add(String(gBig));
    await prisma.$executeRaw`INSERT INTO leavetype_groups (id, leave_type_id, leave_group_id)
      VALUES (${BigInt(Date.now() + Math.floor(Math.random() * 100000))}, ${ltId}, ${gBig})`.catch(() => {});
  }
}

// ── Write to leave log ────────────────────────────────────────────────────────

async function writeLog(leaveId, userId, data, statusFrom, statusTo) {
  try {
    await prisma.$executeRaw`INSERT INTO employeeleavelog (id, employee_leave, user_id, data, status_from, status_to, created)
      VALUES (${BigInt(Date.now())}, ${toBigInt(leaveId)}, ${toBigInt(userId)}, ${String(data)}, ${String(statusFrom)}, ${String(statusTo)}, NOW())`;
  } catch {}
}

// ── Email notifications ───────────────────────────────────────────────────────

async function notifyLeaveAction(leaveId, action, reason) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT el.date_start, el.date_end,
              lt.name AS leave_type_name, lt.send_notification_emails,
              TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
              u.email AS employee_email
       FROM employeeleaves el
       LEFT JOIN leavetypes  lt ON lt.id = el.leave_type
       LEFT JOIN employee    e  ON e.id  = el.employee
       LEFT JOIN users       u  ON u.employeeId = e.id
       WHERE el.id = ${toBigInt(leaveId)}`;
    if (!rows.length) return;
    const row = rows[0];
    if (row.send_notification_emails !== 'Yes') return;
    if (!row.employee_email) return;

    await sendLeaveEmail({
      to:           row.employee_email,
      employeeName: row.employee_name ?? 'Employee',
      action,
      leaveType:    row.leave_type_name ?? 'Leave',
      dateStart:    row.date_start instanceof Date ? row.date_start.toISOString().split('T')[0] : String(row.date_start),
      dateEnd:      row.date_end instanceof Date ? row.date_end.toISOString().split('T')[0] : String(row.date_end),
      reason,
    });
  } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
// LEAVE TYPES
// ══════════════════════════════════════════════════════════════════════════════

// GET /leave/types[?all=1] — list leave types; without ?all=1 filters by the requesting user's paygrade and gender.
// Admin pages pass ?all=1 to skip filtering and show every type for configuration purposes.
exports.getLeaveTypes = asyncHandler(async (req, res) => {
  // ?all=1 — skip paygrade filtering (used by admin management pages like LeaveSetup)
  const skipFilter = req.query.all === '1';

  const types = await prisma.$queryRaw`SELECT * FROM leavetypes ORDER BY name`.catch(() => []);

  // Fetch ALL group assignments — param-free to avoid BigInt IN-clause issues.
  // leavetype_groups.leave_group_id stores paygrade IDs (set from the leave-type form).
  const assignments = await prisma.$queryRaw`
    SELECT ltg.leave_type_id, ltg.leave_group_id, pg.name AS group_name
    FROM leavetype_groups ltg
    LEFT JOIN paygrades pg ON pg.id = ltg.leave_group_id`.catch(() => []);

  // Build map: typeId → [{ id, name }]
  const groupsByType = {};
  for (const a of assignments) {
    const key = String(a.leave_type_id);
    if (!groupsByType[key]) groupsByType[key] = [];
    groupsByType[key].push({ id: String(a.leave_group_id), name: a.group_name });
  }

  // Look up the requesting user's paygrade from the users → employee link.
  // Always query directly — req.user may not carry employeeId (auth middleware omits it).
  let empPaygradeId = null;
  let empGenderCode  = null;
  if (!skipFilter) {
    const userId = toBigInt(req.user?.id);
    if (userId) {
      const userRow = await prisma.users.findUnique({ where: { id: userId }, select: { employeeId: true } }).catch(() => null);
      const empId = toBigInt(userRow?.employeeId);
      if (empId) {
        const empRow = await prisma.$queryRaw`
          SELECT e.paygradeId, UPPER(LEFT(clv.label,1)) AS gender_code
           FROM employee e
           LEFT JOIN CodeListValue clv ON clv.id = e.genderId
           WHERE e.id=${empId}`.catch(() => []);
        empPaygradeId = empRow[0]?.paygradeId != null ? String(empRow[0].paygradeId) : null;
        empGenderCode = empRow[0]?.gender_code ?? null;
      }
    }
  }

  const result = types
    .filter(t => {
      if (skipFilter) return true;
      // Paygrade group check
      const groupIds = (groupsByType[t.id.toString()] ?? []).map(g => g.id);
      if (groupIds.length > 0 && empPaygradeId !== null && !groupIds.includes(empPaygradeId)) return false;
      // Gender check — restricted types are hidden when the employee's gender is unknown
      const tg = t.gender ?? 'All';
      if (tg !== 'All' && empGenderCode !== tg) return false;
      return true;
    })
    .map(t => ({
      ...s(t),
      groups:     groupsByType[t.id.toString()] ?? [],
      group_ids:  (groupsByType[t.id.toString()] ?? []).map(g => g.id),
      group_name: (groupsByType[t.id.toString()] ?? []).map(g => g.name).join(', ') || null,
    }));
  respond.ok(res, 'Leave types', result);
});

// POST /leave/types — create a leave type with accrual, carry-forward, gender, allowance, and paygrade group settings.
exports.createLeaveType = asyncHandler(async (req, res) => {
  const {
    name, leave_gl, default_per_year, supervisor_leave_assign, employee_can_apply,
    apply_beyond_current, leave_accrue, carried_forward, carried_forward_percentage,
    max_carried_forward_amount, carried_forward_leave_availability, propotionate_on_joined_date,
    send_notification_emails, leave_group, leave_color, leave_allowance, leave_allowance_once,
  } = req.body;

  if (!name) return respond.badReq(res, 'Leave type name is required');

  const { group_ids } = req.body;

  const created = await prisma.leavetypes.create({
    data: {
      name,
      leave_gl:                           leave_gl ?? null,
      default_per_year:                   parseFloat(default_per_year) || 0,
      supervisor_leave_assign:            supervisor_leave_assign ?? 'Yes',
      employee_can_apply:                 employee_can_apply ?? 'Yes',
      apply_beyond_current:               apply_beyond_current ?? 'Yes',
      leave_accrue:                       leave_accrue ?? 'No',
      carried_forward:                    carried_forward ?? 'No',
      carried_forward_percentage:         toInt(carried_forward_percentage) ?? 0,
      max_carried_forward_amount:         toInt(max_carried_forward_amount) ?? 0,
      carried_forward_leave_availability: toInt(carried_forward_leave_availability) ?? 365,
      propotionate_on_joined_date:        propotionate_on_joined_date ?? 'No',
      send_notification_emails:           send_notification_emails ?? 'Yes',
      leave_group:                        leave_group ? toBigInt(leave_group) : null,
      leave_color:                        leave_color ?? null,
    },
  });
  const { accrual_frequency, accrual_rate } = req.body;
  const { gender } = req.body;
  await prisma.$executeRaw`UPDATE leavetypes SET leave_allowance=${leave_allowance === 'Yes' ? 'Yes' : 'No'}, leave_allowance_once=${leave_allowance_once === 'Yes' ? 'Yes' : 'No'}, accrual_frequency=${accrual_frequency || 'Monthly'}, accrual_rate=${accrual_rate ? parseFloat(accrual_rate) : null}, gender=${/^[A-Z]$/.test(String(gender ?? '')) ? gender : 'All'} WHERE id=${created.id}`.catch(() => {});
  await syncLeaveTypeGroups(created.id, group_ids);
  logActivity({ module: 'Leave Setup', action: 'create_leave_type', entityId: String(created.id), entityName: created.name, ...fromReq(req) });
  respond.created(res, 'Leave type created', s(created));
});

// PUT /leave/types/:id — update leave type fields; raw SQL used for fields (accrual, gender) not yet in Prisma schema.
exports.updateLeaveType = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const {
    name, leave_gl, default_per_year, supervisor_leave_assign, employee_can_apply,
    apply_beyond_current, leave_accrue, carried_forward, carried_forward_percentage,
    max_carried_forward_amount, carried_forward_leave_availability, propotionate_on_joined_date,
    send_notification_emails, leave_group, leave_color, leave_allowance,
  } = req.body;

  const data = {};
  if (name !== undefined)                        data.name = name;
  if (leave_gl !== undefined)                    data.leave_gl = leave_gl;
  if (default_per_year !== undefined)            data.default_per_year = parseFloat(default_per_year) || 0;
  if (supervisor_leave_assign !== undefined)     data.supervisor_leave_assign = supervisor_leave_assign;
  if (employee_can_apply !== undefined)          data.employee_can_apply = employee_can_apply;
  if (apply_beyond_current !== undefined)        data.apply_beyond_current = apply_beyond_current;
  if (leave_accrue !== undefined)                data.leave_accrue = leave_accrue;
  if (carried_forward !== undefined)             data.carried_forward = carried_forward;
  if (carried_forward_percentage !== undefined)  data.carried_forward_percentage = toInt(carried_forward_percentage);
  if (max_carried_forward_amount !== undefined)  data.max_carried_forward_amount = toInt(max_carried_forward_amount);
  if (carried_forward_leave_availability !== undefined) data.carried_forward_leave_availability = toInt(carried_forward_leave_availability);
  if (propotionate_on_joined_date !== undefined) data.propotionate_on_joined_date = propotionate_on_joined_date;
  if (send_notification_emails !== undefined)    data.send_notification_emails = send_notification_emails;
  if (leave_group !== undefined)                 data.leave_group = leave_group ? toBigInt(leave_group) : null;
  if (leave_color !== undefined)                 data.leave_color = leave_color;

  const updated = await prisma.leavetypes.update({ where: { id }, data });
  if (leave_allowance !== undefined) {
    await prisma.$executeRaw`UPDATE leavetypes SET leave_allowance=${leave_allowance === 'Yes' ? 'Yes' : 'No'} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.leave_allowance_once !== undefined) {
    await prisma.$executeRaw`UPDATE leavetypes SET leave_allowance_once=${req.body.leave_allowance_once === 'Yes' ? 'Yes' : 'No'} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.accrual_frequency !== undefined || req.body.accrual_rate !== undefined) {
    const af = req.body.accrual_frequency !== undefined ? (req.body.accrual_frequency || 'Monthly') : undefined;
    const ar = req.body.accrual_rate !== undefined ? (req.body.accrual_rate ? parseFloat(req.body.accrual_rate) : null) : undefined;
    if (af !== undefined && ar !== undefined) {
      await prisma.$executeRaw`UPDATE leavetypes SET accrual_frequency=${af}, accrual_rate=${ar} WHERE id=${id}`.catch(() => {});
    } else if (af !== undefined) {
      await prisma.$executeRaw`UPDATE leavetypes SET accrual_frequency=${af} WHERE id=${id}`.catch(() => {});
    } else if (ar !== undefined) {
      await prisma.$executeRaw`UPDATE leavetypes SET accrual_rate=${ar} WHERE id=${id}`.catch(() => {});
    }
  }
  if (req.body.gender !== undefined) {
    const g = req.body.gender;
    await prisma.$executeRaw`UPDATE leavetypes SET gender=${/^[A-Z]$/.test(String(g ?? '')) ? g : 'All'} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.group_ids !== undefined) await syncLeaveTypeGroups(id, req.body.group_ids);
  logActivity({ module: 'Leave Setup', action: 'update_leave_type', entityId: String(id), entityName: updated.name, ...fromReq(req) });
  respond.ok(res, 'Leave type updated', s(updated));
});

// DELETE /leave/types/:id — permanently delete a leave type.
exports.deleteLeaveType = asyncHandler(async (req, res) => {
  const delType = await prisma.leavetypes.findUnique({ where: { id: toBigInt(req.params.id) } }).catch(() => null);
  await prisma.leavetypes.delete({ where: { id: toBigInt(req.params.id) } });
  logActivity({ module: 'Leave Setup', action: 'delete_leave_type', entityId: req.params.id, entityName: delType?.name ?? req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave type deleted');
});

// ══════════════════════════════════════════════════════════════════════════════
// LEAVE PERIODS
// ══════════════════════════════════════════════════════════════════════════════

// GET /leave/periods — list all leave periods ordered by start date descending.
exports.getLeavePeriods = asyncHandler(async (req, res) => {
  const rows = await prisma.leaveperiods.findMany({ orderBy: { date_start: 'desc' } });
  respond.ok(res, 'Leave periods', s(rows));
});

// POST /leave/periods — create a new leave period (Inactive by default until explicitly activated).
exports.createLeavePeriod = asyncHandler(async (req, res) => {
  const { name, date_start, date_end } = req.body;
  if (!date_start || !date_end) return respond.badReq(res, 'Start and end dates are required');
  const created = await prisma.leaveperiods.create({
    data: { name: name ?? '', date_start: new Date(date_start), date_end: new Date(date_end), status: 'Inactive' },
  });
  logActivity({ module: 'Leave Setup', action: 'create_leave_period', entityId: String(created.id), entityName: created.name, ...fromReq(req) });
  respond.created(res, 'Leave period created', s(created));
});

// PUT /leave/periods/:id — update a leave period's name or date range.
exports.updateLeavePeriod = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const { name, date_start, date_end } = req.body;
  const data = {};
  if (name !== undefined)       data.name = name;
  if (date_start !== undefined) data.date_start = new Date(date_start);
  if (date_end !== undefined)   data.date_end = new Date(date_end);
  const updated = await prisma.leaveperiods.update({ where: { id }, data });
  logActivity({ module: 'Leave Setup', action: 'update_leave_period', entityId: String(id), entityName: updated.name, ...fromReq(req) });
  respond.ok(res, 'Leave period updated', s(updated));
});

// DELETE /leave/periods/:id — permanently delete a leave period.
exports.deleteLeavePeriod = asyncHandler(async (req, res) => {
  const delPeriod = await prisma.leaveperiods.findUnique({ where: { id: toBigInt(req.params.id) } }).catch(() => null);
  await prisma.leaveperiods.delete({ where: { id: toBigInt(req.params.id) } });
  logActivity({ module: 'Leave Setup', action: 'delete_leave_period', entityId: req.params.id, entityName: delPeriod?.name ?? req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave period deleted');
});

// ── Carry-forward processing helper — called on period activation and manual recalculation ──
async function processCarryForward(oldPeriod, newPeriodId) {
  const allTypes = await prisma.leavetypes.findMany();

  const allRules = await prisma.leaverules.findMany().catch(() => []);
  const rulesByType = {};
  for (const r of allRules) {
    const key = String(r.leave_type);
    if (!rulesByType[key]) rulesByType[key] = [];
    rulesByType[key].push(r);
  }

  const employees = await prisma.$queryRaw`
    SELECT id, jobTitleId AS job_title_id, departmentId, employmentStatusId AS emp_status_id, paygradeId, hireDate
     FROM employee WHERE status='Active' OR status='active'`.catch(() => []);

  for (const lt of allTypes) {
    const typeRules = rulesByType[String(lt.id)] || [];

    for (const emp of employees) {
      const empId = emp.id.toString();

      const ruleMatch = typeRules.find(r => {
        if (r.employee          && String(r.employee)          !== String(empId                 )) return false;
        if (r.leave_period      && String(r.leave_period)      !== String(oldPeriod.id  ?? '')) return false;
        if (r.job_title         && String(r.job_title)         !== String(emp.job_title_id ?? '')) return false;
        if (r.department        && String(r.department)        !== String(emp.departmentId  ?? '')) return false;
        if (r.employment_status && String(r.employment_status) !== String(emp.emp_status_id ?? '')) return false;
        if (r.leave_group       && String(r.leave_group)       !== String(emp.paygradeId    ?? '')) return false;
        if (r.exp_days) {
          const days = emp.hireDate ? Math.floor((Date.now() - new Date(emp.hireDate).getTime()) / 86400000) : 0;
          if (days < Number(r.exp_days)) return false;
        }
        return true;
      });

      const effectiveCF   = ruleMatch?.carried_forward            ?? lt.carried_forward;
      const effectivePct  = parseFloat(ruleMatch?.carried_forward_percentage ?? lt.carried_forward_percentage) || 100;
      const effectiveMax  = parseFloat(ruleMatch?.max_carried_forward_amount  ?? lt.max_carried_forward_amount)  || 0;
      const effectiveBase = parseFloat(ruleMatch?.default_per_year             ?? lt.default_per_year)            || 0;

      if (effectiveCF !== 'Yes') continue;

      const bal = await calcBalance(empId, lt.id.toString(), oldPeriod.id.toString());
      if (bal.balance <= 0) continue;

      let cfDays = bal.balance * (effectivePct / 100);
      if (effectiveMax > 0) cfDays = Math.min(cfDays, effectiveMax);
      cfDays = Math.round(cfDays * 2) / 2;

      const newTotal = effectiveBase + cfDays;

      const eBig = toBigInt(emp.id);
      const existing = await prisma.$queryRaw`SELECT id FROM leavestartingbalance WHERE employee=${eBig} AND leave_type=${lt.id} AND leave_period=${newPeriodId}`.catch(() => []);

      if (existing.length) {
        await prisma.$executeRaw`UPDATE leavestartingbalance SET amount=${newTotal} WHERE employee=${eBig} AND leave_type=${lt.id} AND leave_period=${newPeriodId}`.catch(() => {});
      } else {
        await prisma.$executeRaw`INSERT INTO leavestartingbalance (id, employee, leave_type, leave_period, amount)
          VALUES (${BigInt(Date.now() + Math.floor(Math.random() * 1000000))}, ${eBig}, ${lt.id}, ${newPeriodId}, ${newTotal})`.catch(() => {});
      }
    }
  }
}

// PUT /leave/periods/:id/activate — set this period as Active (deactivating all others) and run carry-forward
// calculations if the new period chronologically follows an existing active period.
exports.activateLeavePeriod = asyncHandler(async (req, res) => {
  const newPeriodId = toBigInt(req.params.id);
  const newPeriod   = await prisma.leaveperiods.findUnique({ where: { id: newPeriodId } });
  if (!newPeriod) return respond.notFound(res, 'Leave period not found');

  const activePeriods = await prisma.leaveperiods.findMany({ where: { status: 'Active' } });
  let ranCarryForward = false;
  for (const oldPeriod of activePeriods) {
    // Only carry forward when the new period genuinely starts after the old one ends
    if (new Date(newPeriod.date_start) > new Date(oldPeriod.date_end)) {
      await processCarryForward(oldPeriod, newPeriodId);
      ranCarryForward = true;
    }
  }

  // Going backward (reactivating an earlier period) — clear any starting-balance records
  // that were wrongly pushed here when the forward test ran processCarryForward into this period
  if (!ranCarryForward && activePeriods.length > 0) {
    await prisma.$executeRaw`DELETE FROM leavestartingbalance WHERE leave_period=${newPeriodId}`.catch(() => {});
  }

  await prisma.$executeRaw`UPDATE leaveperiods SET status='Inactive'`;
  await prisma.leaveperiods.update({ where: { id: newPeriodId }, data: { status: 'Active' } });
  logActivity({ module: 'Leave Setup', action: 'activate_leave_period', entityId: String(newPeriodId), entityName: newPeriod.name, ...fromReq(req) });
  respond.ok(res, 'Leave period activated');
});

// POST /leave/periods/:id/recalculate-carry-forward — manually re-run carry-forward from the preceding period
// into this one; clears existing starting balances first so stale values don't persist.
exports.recalculateCarryForward = asyncHandler(async (req, res) => {
  const targetPeriodId = toBigInt(req.params.id);
  const targetPeriod   = await prisma.leaveperiods.findUnique({ where: { id: targetPeriodId } });
  if (!targetPeriod) return respond.notFound(res, 'Leave period not found');

  // Clear existing starting balances for this period first so stale/wrong values don't persist
  await prisma.$executeRaw`DELETE FROM leavestartingbalance WHERE leave_period=${targetPeriodId}`.catch(() => {});

  // Find the period that chronologically precedes this one (end date before target's start date)
  const sources = await prisma.$queryRaw`
    SELECT * FROM leaveperiods WHERE id != ${targetPeriodId} AND date_end < ${new Date(targetPeriod.date_start)} ORDER BY date_end DESC LIMIT 1`.catch(() => []);

  if (!sources.length) return respond.ok(res, 'No prior period found — starting balances cleared');

  await processCarryForward(sources[0], targetPeriodId);
  respond.ok(res, 'Carry forward recalculated');
});

// ══════════════════════════════════════════════════════════════════════════════
// HOLIDAYS
// ══════════════════════════════════════════════════════════════════════════════

// GET /leave/holidays — list all public holidays ordered by date.
exports.getHolidays = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`SELECT * FROM holidays ORDER BY dateh ASC`.catch(() => []);
  respond.ok(res, 'Holidays', s(rows));
});

// POST /leave/holidays — add a public holiday with full-day or half-day status.
exports.createHoliday = asyncHandler(async (req, res) => {
  const { name, dateh, status } = req.body;
  if (!name || !dateh) return respond.badReq(res, 'Name and date are required');
  const id = BigInt(Date.now());
  await prisma.$executeRaw`INSERT INTO holidays (id, name, dateh, status) VALUES (${id}, ${name}, ${new Date(dateh)}, ${enumSql(/half/i.test(String(status||'')) ? 'Half Day' : 'Full Day', ['Full Day','Half Day'], 'Full Day')})`;
  logActivity({ module: 'Leave Setup', action: 'create_holiday', entityId: id.toString(), entityName: name, ...fromReq(req) });
  respond.created(res, 'Holiday created', { id: id.toString(), name, dateh, status: status ?? 'Full_Day' });
});

// PUT /leave/holidays/:id — update a holiday's name, date, or full/half-day status.
exports.updateHoliday = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const { name, dateh, status } = req.body;
  const parts = [];
  if (name   !== undefined) parts.push(Prisma.sql`name=${name}`);
  if (dateh  !== undefined) parts.push(Prisma.sql`dateh=${new Date(dateh)}`);
  if (status !== undefined) parts.push(Prisma.sql`status=${enumSql(/half/i.test(String(status||'')) ? 'Half Day' : 'Full Day', ['Full Day','Half Day'], 'Full Day')}`);
  if (!parts.length) return respond.badReq(res, 'No fields to update');
  await prisma.$executeRaw`UPDATE holidays SET ${Prisma.join(parts, ', ')} WHERE id=${id}`;
  logActivity({ module: 'Leave Setup', action: 'update_holiday', entityId: req.params.id, entityName: name ?? req.params.id, ...fromReq(req) });
  respond.ok(res, 'Holiday updated');
});

// DELETE /leave/holidays/:id — permanently remove a public holiday.
exports.deleteHoliday = asyncHandler(async (req, res) => {
  const hid = toBigInt(req.params.id);
  const delHol = await prisma.$queryRaw`SELECT name FROM holidays WHERE id=${hid}`.catch(() => []);
  await prisma.$executeRaw`DELETE FROM holidays WHERE id=${hid}`;
  logActivity({ module: 'Leave Setup', action: 'delete_holiday', entityId: req.params.id, entityName: delHol[0]?.name ?? req.params.id, ...fromReq(req) });
  respond.ok(res, 'Holiday deleted');
});

// ══════════════════════════════════════════════════════════════════════════════
// WORK WEEK
// ══════════════════════════════════════════════════════════════════════════════

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// GET /leave/work-week — return the work-week schedule (Mon–Sun) with Full_Day/Half_Day/Non_working_Day status for each day.
exports.getWorkWeek = asyncHandler(async (req, res) => {
  // Use Prisma model so enum @map values ('Full Day' etc.) are returned as Prisma names ('Full_Day' etc.)
  const rows = await prisma.workdays.findMany({ select: { name: true, status: true } }).catch(() => []);
  const map = Object.fromEntries(rows.map(r => [r.name, r.status]));
  const result = ALL_DAYS.map(d => ({ name: d, status: map[d] ?? 'Full_Day' }));
  respond.ok(res, 'Work week', result);
});

// PUT /leave/work-week — bulk-save the work-week schedule; upserts each day's status.
exports.updateWorkWeek = asyncHandler(async (req, res) => {
  const entries = Array.isArray(req.body) ? req.body : [];
  for (const { name, status } of entries) {
    if (!name) continue;
    // Use Prisma model so enum names ('Non_working_Day') are mapped to DB values ('Non-working Day') automatically
    const existing = await prisma.workdays.findFirst({ where: { name } }).catch(() => null);
    if (existing) {
      await prisma.workdays.update({ where: { id: existing.id }, data: { status } });
    } else {
      await prisma.workdays.create({ data: { name, status } });
    }
  }
  respond.ok(res, 'Work week updated');
});

// ══════════════════════════════════════════════════════════════════════════════
// LEAVE GROUPS
// ══════════════════════════════════════════════════════════════════════════════

// GET /leave/groups — list all leave groups (used to bundle leave types for a set of employees).
exports.getLeaveGroups = asyncHandler(async (req, res) => {
  const rows = await prisma.leavegroups.findMany({ orderBy: { name: 'asc' } });
  respond.ok(res, 'Leave groups', s(rows));
});

// POST /leave/groups — create a named leave group.
exports.createLeaveGroup = asyncHandler(async (req, res) => {
  const { name, details } = req.body;
  if (!name) return respond.badReq(res, 'Group name is required');
  const created = await prisma.leavegroups.create({
    data: { name, details: details ?? null, created: new Date(), updated: new Date() },
  });
  logActivity({ module: 'Leave Setup', action: 'create_leave_group', entityId: String(created.id), entityName: created.name, ...fromReq(req) });
  respond.created(res, 'Leave group created', s(created));
});

// PUT /leave/groups/:id — update a leave group's name or description.
exports.updateLeaveGroup = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const { name, details } = req.body;
  const data = { updated: new Date() };
  if (name    !== undefined) data.name    = name;
  if (details !== undefined) data.details = details;
  const updated = await prisma.leavegroups.update({ where: { id }, data });
  logActivity({ module: 'Leave Setup', action: 'update_leave_group', entityId: String(id), entityName: updated.name, ...fromReq(req) });
  respond.ok(res, 'Leave group updated', s(updated));
});

// DELETE /leave/groups/:id — permanently delete a leave group.
exports.deleteLeaveGroup = asyncHandler(async (req, res) => {
  const delGrp = await prisma.leavegroups.findUnique({ where: { id: toBigInt(req.params.id) } }).catch(() => null);
  await prisma.leavegroups.delete({ where: { id: toBigInt(req.params.id) } });
  logActivity({ module: 'Leave Setup', action: 'delete_leave_group', entityId: req.params.id, entityName: delGrp?.name ?? req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave group deleted');
});

// GET /leave/groups/:id/employees — list all employees directly assigned to a leave group.
exports.getLeaveGroupEmployees = asyncHandler(async (req, res) => {
  const groupId = toBigInt(req.params.id);
  const members = await prisma.$queryRaw`
    SELECT lge.id, lge.employee, TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name, e.employee_id AS employee_code
     FROM leavegroupemployees lge
     LEFT JOIN employee e ON e.id = lge.employee
     WHERE lge.leave_group=${groupId}`.catch(() => []);
  respond.ok(res, 'Group employees', s(members));
});

// POST /leave/groups/:id/employees — add an employee to a leave group; blocks duplicate membership.
exports.addLeaveGroupEmployee = asyncHandler(async (req, res) => {
  const groupId    = toBigInt(req.params.id);
  const employeeId = toBigInt(req.body.employee_id);
  if (!employeeId) return respond.badReq(res, 'employee_id is required');

  // Prevent duplicate
  const existing = await prisma.$queryRaw`SELECT id FROM leavegroupemployees WHERE leave_group=${groupId} AND employee=${employeeId}`.catch(() => []);
  if (existing.length) return respond.badReq(res, 'Employee already in this group');

  await prisma.$executeRaw`INSERT INTO leavegroupemployees (id, employee, leave_group, created, updated) VALUES (${BigInt(Date.now())}, ${employeeId}, ${groupId}, NOW(), NOW())`;
  respond.created(res, 'Employee added to group');
});

// DELETE /leave/groups/:id/employees/:eid — remove an employee from a leave group.
exports.removeLeaveGroupEmployee = asyncHandler(async (req, res) => {
  const groupId = toBigInt(req.params.id);
  const empId   = toBigInt(req.params.eid);
  await prisma.$executeRaw`DELETE FROM leavegroupemployees WHERE leave_group=${groupId} AND employee=${empId}`;
  respond.ok(res, 'Employee removed from group');
});

// ── Leave Group Paygrades (paygrade-based assignment) ─────────────────────────

// GET /leave/groups/:id/paygrades — list paygrades assigned to a leave group, with employee count per paygrade.
exports.getLeaveGroupPaygrades = asyncHandler(async (req, res) => {
  const groupId = toBigInt(req.params.id);
  const rows = await prisma.$queryRaw`
    SELECT lgp.id, lgp.leave_group, lgp.paygrade_id, lgp.created,
           pg.name AS paygrade_name, pg.currency,
           COUNT(e.id) AS employee_count
    FROM leavegrouppaygrades lgp
    LEFT JOIN paygrades pg ON pg.id = lgp.paygrade_id
    LEFT JOIN employee e ON e.paygradeId = lgp.paygrade_id
    WHERE lgp.leave_group = ${groupId}
    GROUP BY lgp.id, lgp.leave_group, lgp.paygrade_id, lgp.created, pg.name, pg.currency`.catch(() => []);
  respond.ok(res, 'Group paygrades', s(rows));
});

// POST /leave/groups/:id/paygrades — assign a paygrade to a leave group; blocks duplicates.
exports.addLeaveGroupPaygrade = asyncHandler(async (req, res) => {
  const groupId   = toBigInt(req.params.id);
  const paygadeId = toBigInt(req.body.paygrade_id);
  if (!paygadeId) return respond.badReq(res, 'paygrade_id is required');

  const existing = await prisma.$queryRaw`SELECT id FROM leavegrouppaygrades WHERE leave_group=${groupId} AND paygrade_id=${paygadeId}`.catch(() => []);
  if (existing.length) return respond.badReq(res, 'Paygrade already assigned to this group');

  await prisma.$executeRaw`INSERT INTO leavegrouppaygrades (id, leave_group, paygrade_id) VALUES (${BigInt(Date.now())}, ${groupId}, ${paygadeId})`;
  respond.created(res, 'Paygrade assigned to group');
});

// DELETE /leave/groups/:id/paygrades/:pgId — remove a paygrade assignment from a leave group.
exports.removeLeaveGroupPaygrade = asyncHandler(async (req, res) => {
  const groupId   = toBigInt(req.params.id);
  const paygadeId = toBigInt(req.params.pgId);
  await prisma.$executeRaw`DELETE FROM leavegrouppaygrades WHERE leave_group=${groupId} AND paygrade_id=${paygadeId}`;
  respond.ok(res, 'Paygrade removed from group');
});

// ══════════════════════════════════════════════════════════════════════════════
// LEAVE RULES
// ══════════════════════════════════════════════════════════════════════════════

// GET /leave/rules[?leave_type=] — list leave rules with type/job title/employment status labels; optionally filtered by leave type.
exports.getLeaveRules = asyncHandler(async (req, res) => {
  const where = req.query.leave_type ? Prisma.sql`WHERE lr.leave_type=${toBigInt(req.query.leave_type)}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT lr.*,
            lt.name AS leave_type_name,
            lt.leave_color,
            jt.label  AS job_title_name,
            es.label  AS employment_status_name
     FROM leaverules lr
     LEFT JOIN leavetypes   lt ON lt.id  = lr.leave_type
     LEFT JOIN codelistvalue jt ON jt.id = lr.job_title
     LEFT JOIN codelistvalue es ON es.id = lr.employment_status
     ${where}
     ORDER BY lr.id DESC`.catch(() => []);
  respond.ok(res, 'Leave rules', s(rows));
});

// POST /leave/rules — create a leave rule that overrides leave type defaults for specific employees, job titles,
// departments, employment status, or paygrade groups; accrual/allowance fields written via raw SQL due to Prisma schema lag.
exports.createLeaveRule = asyncHandler(async (req, res) => {
  const {
    leave_type, job_title, employment_status, employee, supervisor_leave_assign,
    employee_can_apply, apply_beyond_current, leave_accrue, carried_forward,
    default_per_year, carried_forward_percentage, carried_forward_leave_availability,
    propotionate_on_joined_date, leave_group, max_carried_forward_amount,
    exp_days, leave_period, department, leave_allowance, leave_allowance_once,
  } = req.body;
  if (!leave_type) return respond.badReq(res, 'leave_type is required');

  const created = await prisma.leaverules.create({
    data: {
      leave_type:                         toBigInt(leave_type),
      employee:                           employee ? toBigInt(employee) : null,
      supervisor_leave_assign:            supervisor_leave_assign ?? 'Yes',
      employee_can_apply:                 employee_can_apply ?? 'Yes',
      apply_beyond_current:               apply_beyond_current ?? 'Yes',
      leave_accrue:                       leave_accrue ?? 'No',
      carried_forward:                    carried_forward ?? 'No',
      default_per_year:                   parseFloat(default_per_year) || 0,
      carried_forward_percentage:         toInt(carried_forward_percentage) ?? 0,
      carried_forward_leave_availability: toInt(carried_forward_leave_availability) ?? 365,
      propotionate_on_joined_date:        propotionate_on_joined_date ?? 'No',
      leave_group:                        leave_group ? toBigInt(leave_group) : null,
      max_carried_forward_amount:         toInt(max_carried_forward_amount) ?? 0,
      exp_days:                           exp_days ? toInt(exp_days) : null,
      leave_period:                       leave_period ? toBigInt(leave_period) : null,
      department:                         department ? toBigInt(department) : null,
    },
  });
  // job_title/employment_status are varchar codelistvalue IDs — write via raw SQL
  const { accrual_frequency: ruleAF, accrual_rate: ruleAR } = req.body;
  await prisma.$executeRaw`UPDATE leaverules SET leave_allowance=${leave_allowance === 'Yes' ? 'Yes' : 'No'}, leave_allowance_once=${leave_allowance_once === 'Yes' ? 'Yes' : 'No'}, job_title=${job_title || null}, employment_status=${employment_status || null}, accrual_frequency=${ruleAF || 'Monthly'}, accrual_rate=${ruleAR ? parseFloat(ruleAR) : null} WHERE id=${created.id}`.catch(() => {});
  logActivity({ module: 'Leave Setup', action: 'create_leave_rule', entityId: String(created.id), entityName: `Rule for type ${leave_type}`, ...fromReq(req) });
  respond.created(res, 'Leave rule created', s(created));
});

// PUT /leave/rules/:id — update a leave rule; handles string, int, decimal, and BigInt nullable fields separately
// because Prisma client types for job_title/employment_status don't match the DB VARCHAR type yet.
exports.updateLeaveRule = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const data = {};

  // String / enum fields
  const stringFields = ['supervisor_leave_assign','employee_can_apply','apply_beyond_current',
    'leave_accrue','carried_forward','propotionate_on_joined_date'];
  for (const key of stringFields) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }

  // Int fields
  const intFields = ['carried_forward_percentage','carried_forward_leave_availability',
    'max_carried_forward_amount','exp_days'];
  for (const key of intFields) {
    if (req.body[key] !== undefined) data[key] = toInt(req.body[key]) ?? 0;
  }

  // Decimal
  if (req.body.default_per_year !== undefined) data.default_per_year = parseFloat(req.body.default_per_year) || 0;

  // BigInt nullable fields (empty string → null)
  const bigintNullable = ['leave_type','department','leave_period','employee','leave_group'];
  for (const key of bigintNullable) {
    if (req.body[key] !== undefined) data[key] = req.body[key] ? toBigInt(req.body[key]) : null;
  }

  const updated = await prisma.leaverules.update({ where: { id }, data });

  // job_title and employment_status are varchar codelistvalue IDs — write via raw SQL
  // (Prisma client still has BigInt type for these fields until next client regen)
  if (req.body.job_title !== undefined) {
    await prisma.$executeRaw`UPDATE leaverules SET job_title=${req.body.job_title || null} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.employment_status !== undefined) {
    await prisma.$executeRaw`UPDATE leaverules SET employment_status=${req.body.employment_status || null} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.leave_allowance !== undefined) {
    await prisma.$executeRaw`UPDATE leaverules SET leave_allowance=${req.body.leave_allowance === 'Yes' ? 'Yes' : 'No'} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.leave_allowance_once !== undefined) {
    await prisma.$executeRaw`UPDATE leaverules SET leave_allowance_once=${req.body.leave_allowance_once === 'Yes' ? 'Yes' : 'No'} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.accrual_frequency !== undefined) {
    await prisma.$executeRaw`UPDATE leaverules SET accrual_frequency=${req.body.accrual_frequency || 'Monthly'} WHERE id=${id}`.catch(() => {});
  }
  if (req.body.accrual_rate !== undefined) {
    await prisma.$executeRaw`UPDATE leaverules SET accrual_rate=${req.body.accrual_rate ? parseFloat(req.body.accrual_rate) : null} WHERE id=${id}`.catch(() => {});
  }
  logActivity({ module: 'Leave Setup', action: 'update_leave_rule', entityId: String(id), ...fromReq(req) });
  respond.ok(res, 'Leave rule updated', s(updated));
});

// DELETE /leave/rules/:id — permanently delete a leave rule.
exports.deleteLeaveRule = asyncHandler(async (req, res) => {
  await prisma.leaverules.delete({ where: { id: toBigInt(req.params.id) } });
  logActivity({ module: 'Leave Setup', action: 'delete_leave_rule', entityId: req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave rule deleted');
});

// ══════════════════════════════════════════════════════════════════════════════
// LEAVE MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// GET /leave/leaves — list the requesting employee's own leave applications; computes live allowance estimates
// for allowance-enabled types when the global allowance control is on.
exports.getLeaves = asyncHandler(async (req, res) => {
  const { status, date_start, date_end } = req.query;

  // Default: scope to the requesting user's own employee record.
  // ?all=1 returns every employee's leaves (reports/admin views — screen access is the gate).
  let scopedEmployee = null;
  if (req.query.all !== '1') {
    const userEmp = await prisma.$queryRaw`SELECT employeeId, employee FROM users WHERE id=${toBigInt(req.user.id)}`.catch(() => []);
    const ownEmpId = userEmp[0]?.employeeId || userEmp[0]?.employee;
    if (!ownEmpId) return respond.ok(res, 'Leaves', []);
    scopedEmployee = String(ownEmpId);
  }

  const conds = [Prisma.sql`1=1`];
  if (status)         conds.push(Prisma.sql`el.status=${status}`);
  if (scopedEmployee) conds.push(Prisma.sql`el.employee=${toBigInt(scopedEmployee)}`);
  if (date_start)     conds.push(Prisma.sql`el.date_end>=${new Date(date_start)}`);
  if (date_end)       conds.push(Prisma.sql`el.date_start<=${new Date(date_end)}`);
  const where = Prisma.join(conds, ' AND ');

  const rows = await prisma.$queryRaw`
    SELECT el.*,
            TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
            e.employee_id AS employee_code,
            lt.name AS leave_type_name,
            lt.leave_color,
            lt.leave_allowance AS leave_type_allowance_enabled,
            lp.name AS period_name,
            nt.amount AS notch_amount,
            (SELECT COUNT(*) FROM employeeleavedays eld WHERE eld.employee_leave = el.id) AS day_count
     FROM employeeleaves el
     LEFT JOIN employee    e  ON e.id  = el.employee
     LEFT JOIN leavetypes  lt ON lt.id = el.leave_type
     LEFT JOIN leaveperiods lp ON lp.id = el.leave_period
     LEFT JOIN notches     nt ON nt.id = e.notcheId
     WHERE ${where}
     ORDER BY el.posted_date DESC`.catch(() => []);

  // For allowance-enabled leave types, compute expected allowance when not already stored
  const as = await getAllowanceSettings().catch(() => ({}));
  const globalAllowanceOn = as.leave_allow_enabled === 'Yes';
  const annualFactor = parseFloat(as.leave_allow_annual_factor) || 0.3;
  const taxRate      = parseFloat(as.leave_allow_tax_rate)      || 0.3;

  const enriched = rows.map(row => {
    if (row.leave_type_allowance_enabled !== 'Yes') return row;
    // Pre-enable Skip: leave was approved before allowance was turned on — never show an amount
    if (row.allowance_status === 'Pre-enable Skip') return { ...row, amount: null, leave_tax: null };
    const basic  = parseFloat(row.notch_amount) || 0;
    const stored = parseFloat(row.amount)       || 0;
    // If an amount is already stored (paid, or calculated while control was on),
    // always surface its breakdown regardless of the current global setting.
    if (stored > 0) {
      const storedTax = parseFloat(row.leave_tax) || 0;
      return {
        ...row,
        allowance_gross:         String(Math.round((stored + storedTax) * 100) / 100),
        allowance_tax:           String(storedTax),
        allowance_basic:         String(Math.round(basic * 100) / 100),
        allowance_annual_factor: String(annualFactor),
        allowance_tax_rate:      String(taxRate),
      };
    }
    // Only compute a live estimate when the global allowance control is on.
    // Also skip if the type/rule explicitly denied allowance for this leave ('No' stored at application).
    if (!globalAllowanceOn || !basic || row.req_allowance === 'No') return row;
    const sgla       = basic * 12 * annualFactor;
    const deductible = basic;
    const taxable    = Math.max(0, sgla - deductible);
    const tax        = Math.round(taxable * taxRate * 100) / 100;
    const net        = Math.round((deductible + (taxable - tax)) * 100) / 100;
    return {
      ...row,
      amount:                  String(net),
      leave_tax:               String(tax),
      allowance_gross:         String(Math.round(sgla * 100) / 100),
      allowance_tax:           String(tax),
      allowance_basic:         String(Math.round(basic * 100) / 100),
      allowance_annual_factor: String(annualFactor),
      allowance_tax_rate:      String(taxRate),
    };
  });

  respond.ok(res, 'Leaves', s(enriched));
});

// GET /leave/all-leaves[?status=&employee=] — admin view of all employee leave applications with allowance enrichment.
exports.getAllEmployeeLeaves = asyncHandler(async (req, res) => {
  const { status, employee } = req.query;
  const conds = [];
  // GL scheduling is an allowance/payment stage; the leave itself remains Approved.
  // All other Leave Approval List filters apply to the main leave status.
  if (status === 'GL Scheduled') conds.push(Prisma.sql`el.allowance_status = 'GL Scheduled'`);
  else if (status)               conds.push(Prisma.sql`el.status = ${status}`);
  if (employee) conds.push(Prisma.sql`el.employee = ${toBigInt(employee)}`);
  const whereSql = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT el.*,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.employee_id AS employee_code,
           lt.name AS leave_type_name, lt.leave_color,
           lt.leave_allowance AS leave_type_allowance_enabled,
           lp.name AS period_name,
           nt.amount AS notch_amount,
           (SELECT COUNT(*) FROM employeeleavedays eld WHERE eld.employee_leave = el.id) AS day_count
    FROM employeeleaves el
    LEFT JOIN employee    e  ON e.id  = el.employee
    LEFT JOIN leavetypes  lt ON lt.id = el.leave_type
    LEFT JOIN leaveperiods lp ON lp.id = el.leave_period
    LEFT JOIN notches     nt ON nt.id = e.notcheId
    ${whereSql}
    ORDER BY el.posted_date DESC`.catch(() => []);

  const as = await getAllowanceSettings().catch(() => ({}));
  const globalAllowanceOn = as.leave_allow_enabled === 'Yes';
  const annualFactor = parseFloat(as.leave_allow_annual_factor) || 0.3;
  const taxRate      = parseFloat(as.leave_allow_tax_rate)      || 0.3;

  const enriched = rows.map(row => {
    if (row.leave_type_allowance_enabled !== 'Yes') return row;
    // Pre-enable Skip: leave was approved before allowance was turned on — never show an amount
    if (row.allowance_status === 'Pre-enable Skip') return { ...row, amount: null, leave_tax: null };
    const basic  = parseFloat(row.notch_amount) || 0;
    const stored = parseFloat(row.amount)       || 0;
    if (stored > 0) {
      const storedTax = parseFloat(row.leave_tax) || 0;
      return {
        ...row,
        allowance_gross:         String(Math.round((stored + storedTax) * 100) / 100),
        allowance_tax:           String(storedTax),
        allowance_basic:         String(Math.round(basic * 100) / 100),
        allowance_annual_factor: String(annualFactor),
        allowance_tax_rate:      String(taxRate),
      };
    }
    if (!globalAllowanceOn || !basic || row.req_allowance === 'No') return row;
    const sgla       = basic * 12 * annualFactor;
    const deductible = basic;
    const taxable    = Math.max(0, sgla - deductible);
    const tax        = Math.round(taxable * taxRate * 100) / 100;
    const net        = Math.round((deductible + (taxable - tax)) * 100) / 100;
    return {
      ...row,
      amount:                  String(net),
      leave_tax:               String(tax),
      allowance_gross:         String(Math.round(sgla * 100) / 100),
      allowance_tax:           String(tax),
      allowance_basic:         String(Math.round(basic * 100) / 100),
      allowance_annual_factor: String(annualFactor),
      allowance_tax_rate:      String(taxRate),
    };
  });

  respond.ok(res, 'All employee leaves', s(enriched));
});

// POST /leave/apply — submit a leave application; validates working days, leave balance, gender restrictions,
// supervisor-assign permission, and allowance eligibility before creating the leave record and its day entries.
exports.applyLeave = asyncHandler(async (req, res) => {
  const {
    employee: bodyEmployee, leave_type, leave_period, date_start, date_end,
    details, req_allowance, position, emp_acc_no, branch, department,
    amount: bodyAmount,
  } = req.body;

  // Resolve employee first — use body value if provided, otherwise look up from user account
  let employee = bodyEmployee;
  if (!employee) {
    const userRow = await prisma.$queryRaw`SELECT employeeId, employee FROM users WHERE id=${toBigInt(req.user?.id)}`.catch(() => []);
    const empLink = userRow[0]?.employeeId || userRow[0]?.employee;
    employee = empLink ? String(empLink) : null;
  }
  if (!employee) return respond.badReq(res, 'No employee record linked to your account. Contact HR to link your profile.');

  if (!leave_type || !leave_period || !date_start || !date_end)
    return respond.badReq(res, 'leave_type, leave_period, date_start and date_end are required');

  // ── Date sanity ───────────────────────────────────────────────────────────
  const dStart = new Date(date_start + 'T00:00:00');
  const dEnd   = new Date(date_end   + 'T00:00:00');
  if (isNaN(dStart.getTime()) || isNaN(dEnd.getTime()))
    return respond.badReq(res, 'Invalid date format');
  if (dStart > dEnd)
    return respond.badReq(res, 'Start date must be on or before end date');

  // ── Fetch leave type ──────────────────────────────────────────────────────
  const typeRows = await prisma.$queryRaw`SELECT * FROM leavetypes WHERE id=${toBigInt(leave_type)} LIMIT 1`.catch(() => []);
  const typeRow  = typeRows[0] ?? null;
  if (!typeRow) return respond.badReq(res, 'Leave type not found');

  // ── Fetch employee details (needed for rule matching + exp_days) ──────────
  const empRows = await prisma.$queryRaw`
    SELECT e.id, e.status, e.hireDate, e.jobTitleId AS job_title_id, e.departmentId,
            e.employmentStatusId AS emp_status_id, e.paygradeId,
            UPPER(LEFT(clv.label,1)) AS gender_code
     FROM employee e
     LEFT JOIN CodeListValue clv ON clv.id = e.genderId
     WHERE e.id=${toBigInt(employee)}`.catch(() => []);
  const emp = empRows[0] ?? {};
  if (!emp.id) return respond.badReq(res, 'Employee not found');
  if (emp.status !== '1') return respond.badReq(res, 'Cannot apply leave for an inactive employee');

  // ── Gender restriction check ──────────────────────────────────────────────
  const typeGender = (typeRow.gender ?? 'All');
  if (typeGender !== 'All' && emp.gender_code !== typeGender) {
    const label = typeGender === 'M' ? 'male' : 'female';
    return respond.badReq(res, tmsg('leave.type_restricted', { label }));
  }

  // ── Match leave rule ──────────────────────────────────────────────────────
  const matchingRules = await prisma.$queryRaw`SELECT * FROM leaverules WHERE leave_type=${toBigInt(leave_type)}`.catch(() => []);
  const ruleMatch = matchingRules.find(r => {
    if (r.employee          && String(r.employee)          !== String(employee          ?? '')) return false;
    if (r.leave_period      && String(r.leave_period)      !== String(leave_period      ?? '')) return false;
    if (r.job_title         && String(r.job_title)         !== String(emp.job_title_id  ?? '')) return false;
    if (r.department        && String(r.department)        !== String(emp.departmentId  ?? '')) return false;
    if (r.employment_status && String(r.employment_status) !== String(emp.emp_status_id ?? '')) return false;
    if (r.leave_group       && String(r.leave_group)       !== String(emp.paygradeId    ?? '')) return false;
    if (r.exp_days) {
      const days = emp.hireDate ? Math.floor((Date.now() - new Date(emp.hireDate).getTime()) / 86400000) : 0;
      if (days < Number(r.exp_days)) return false;
    }
    return true;
  });

  // Effective settings — rule overrides type where present
  const effectiveSupAssign  = ruleMatch?.supervisor_leave_assign ?? typeRow.supervisor_leave_assign;
  const effectiveBeyond     = ruleMatch?.apply_beyond_current ?? typeRow.apply_beyond_current;

  // ── Permission checks ─────────────────────────────────────────────────────
  const isAdmin = req.user?.roles?.some(r => ['admin', 'super-admin'].includes(r));
  const isSelf  = String(req.user?.id) === String(employee) ||
                  await prisma.$queryRaw`SELECT id FROM users WHERE id=${toBigInt(req.user?.id)} AND employeeId=${toBigInt(employee)}`
                    .then(r => r.length > 0).catch(() => false);
  const isSupervisorOf = !isSelf && await prisma.$queryRaw`
    SELECT 1 FROM employee WHERE id=${toBigInt(employee)} AND supervisorid=(SELECT employeeId FROM users WHERE id=${toBigInt(req.user?.id)} LIMIT 1)`
    .then(r => r.length > 0).catch(() => false);

  if (isSupervisorOf && !isAdmin && effectiveSupAssign !== 'Yes')
    return respond.badReq(res, 'Supervisors cannot assign this leave type to subordinates');

  // ── Paygrade group eligibility check ──────────────────────────────────────
  // If the leave type is restricted to specific paygrade groups, verify the
  // employee belongs to one of them. Admins bypass this check.
  if (!isAdmin) {
    const typeGroupRows = await prisma.$queryRaw`SELECT leave_group_id FROM leavetype_groups WHERE leave_type_id=${toBigInt(leave_type)}`.catch(() => []);
    if (typeGroupRows.length > 0) {
      const allowedPaygrades = typeGroupRows.map(g => String(g.leave_group_id));
      if (!emp.paygradeId || !allowedPaygrades.includes(String(emp.paygradeId))) {
        return respond.badReq(res, 'Employee is not eligible for this leave type based on their pay grade');
      }
    }
  }

  // ── Working days ──────────────────────────────────────────────────────────
  const days = await getWorkingDays(date_start, date_end);
  if (days.length === 0)
    return respond.badReq(res, 'The selected date range contains no working days (weekends or public holidays only)');

  // ── Leave period boundary check ───────────────────────────────────────────
  const periodRows = await prisma.$queryRaw`SELECT date_start, date_end FROM leaveperiods WHERE id=${toBigInt(leave_period)} LIMIT 1`.catch(() => []);
  const period = periodRows[0] ?? null;
  if (!period) return respond.badReq(res, 'Leave period not found');
  const pStart = new Date(period.date_start); pStart.setHours(0, 0, 0, 0);
  const pEnd   = new Date(period.date_end);   pEnd.setHours(23, 59, 59, 999);
  if (dStart < pStart || dEnd > pEnd)
    return respond.badReq(res, 'Leave dates must fall within the selected leave period');


  // ── Overlap check (any active leave on these dates) ───────────────────────
  const overlaps = await prisma.$queryRaw`
    SELECT id FROM employeeleaves
     WHERE employee=${toBigInt(employee)}
       AND status NOT IN ('Rejected','Cancelled')
       AND date_end >= ${dStart} AND date_start <= ${dEnd}
     LIMIT 1`.catch(() => []);
  if (overlaps.length > 0)
    return respond.badReq(res, 'The selected dates overlap with an existing leave application');

  // ── Allowance settings + once-per-period check ────────────────────────────
  const allowSettings    = await getAllowanceSettings();
  const globalAllowance  = allowSettings.leave_allow_enabled === 'Yes';
  const typeWantsAllow   = ruleMatch ? ruleMatch.leave_allowance === 'Yes' : typeRow.leave_allowance === 'Yes';
  // Type/rule is the authority — frontend req_allowance cannot override a 'No' at type or rule level
  const effectiveReqAllow = typeWantsAllow && globalAllowance;

  const typeOnce = ruleMatch ? ruleMatch.leave_allowance_once === 'Yes' : typeRow.leave_allowance_once === 'Yes';
  let alreadyReceivedAllowance = false;
  if (effectiveReqAllow && typeOnce) {
    const existing = await prisma.$queryRaw`
      SELECT 1 FROM employeeleaves
       WHERE employee=${toBigInt(employee)} AND leave_type=${toBigInt(leave_type)} AND leave_period=${toBigInt(leave_period)}
         AND (allowance_status='Paid' OR (amount IS NOT NULL AND CAST(amount AS DECIMAL) > 0))
         AND status NOT IN ('Rejected','Cancelled')
       LIMIT 1`.catch(() => []);
    alreadyReceivedAllowance = existing.length > 0;
  }

  let allowanceAmount = null;
  let leaveTaxAmount  = null;
  if (effectiveReqAllow && !alreadyReceivedAllowance) {
    if (bodyAmount !== undefined && bodyAmount !== '') {
      allowanceAmount = parseFloat(bodyAmount) || 0;
    } else {
      const calc = await calcLeaveAllowance(employee, allowSettings);
      allowanceAmount = calc.amount;
      leaveTaxAmount  = calc.leave_tax;
    }
  }

  // ── Balance check ─────────────────────────────────────────────────────────
  if (effectiveBeyond !== 'Yes') {
    const bal = await calcBalance(employee, leave_type, leave_period, emp);
    if (days.length > bal.balance)
      return respond.badReq(res,
        tmsg('leave.insufficient_balance', { requested: days.length, available: bal.balance })
      );
  }

  const leaveId = BigInt(Date.now() + Math.floor(Math.random() * 10000));
  const amountVal = allowanceAmount !== null ? String(allowanceAmount) : null;

  await prisma.$executeRaw`
    INSERT INTO employeeleaves
      (id, employee, leave_type, leave_period, date_start, date_end, notice_date,
       details, req_allowance, position, emp_acc_no, leave_gl, leave_name,
       department, status, approval_level, amount)
    VALUES (${leaveId}, ${toBigInt(employee)}, ${toBigInt(leave_type)}, ${toBigInt(leave_period)},
            ${new Date(date_start)}, ${new Date(date_end)}, ${new Date()},
            ${details ?? null},
            ${(effectiveReqAllow && !alreadyReceivedAllowance) ? 'Yes' : (typeWantsAllow && !alreadyReceivedAllowance ? null : 'No')},
            ${position ?? null}, ${emp_acc_no ?? null}, ${typeRow?.leave_gl ?? null}, ${typeRow?.name ?? null},
            ${department ?? null}, 'Draft', ${0}, ${amountVal})`;

  for (const d of days) {
    await prisma.$executeRaw`INSERT INTO employeeleavedays (id, employee_leave, leave_date, leave_type)
      VALUES (${BigInt(Date.now() + Math.floor(Math.random() * 100000))}, ${leaveId}, ${new Date(d.date)}, ${d.type})`.catch(() => {});
  }

  // Store extra fields not in Prisma model
  const extraParts = [];
  if (branch)                  extraParts.push(Prisma.sql`branch=${branch}`);
  if (leaveTaxAmount !== null) extraParts.push(Prisma.sql`leave_tax=${String(leaveTaxAmount)}`);
  if (extraParts.length) {
    await prisma.$executeRaw`UPDATE employeeleaves SET ${Prisma.join(extraParts, ', ')} WHERE id=${leaveId}`.catch(() => {});
  }

  const newLeave = await prisma.$queryRaw`SELECT * FROM employeeleaves WHERE id=${leaveId}`
    .then(r => r[0] ?? { id: leaveId }).catch(() => ({ id: leaveId }));

  logActivity({ module: 'Leave', action: 'apply', entityId: String(leaveId), entityName: `Leave ${leave_type}`, ...fromReq(req) });
  respond.created(res, 'Leave application submitted', s(newLeave));
});

// PUT /leave/:id — update a draft or pending leave application; patches only provided fields.
// Recalculates and replaces all day entries when dates change.
exports.updateLeave = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const rows = await prisma.$queryRaw`SELECT id, status FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');
  if (!['Pending', 'Draft'].includes(current.status))
    return respond.badReq(res, 'Only Pending or Draft leaves can be edited');

  const { leave_type, leave_period, date_start, date_end, details, req_allowance, position } = req.body;
  const typeRow = leave_type
    ? await prisma.leavetypes.findUnique({ where: { id: toBigInt(leave_type) } }).catch(() => null)
    : null;

  const data = {};
  if (leave_type   !== undefined) { data.leave_type   = toBigInt(leave_type); data.leave_gl = typeRow?.leave_gl ?? null; data.leave_name = typeRow?.name ?? null; }
  if (leave_period !== undefined) data.leave_period = toBigInt(leave_period);
  if (date_start   !== undefined) data.date_start   = new Date(date_start);
  if (date_end     !== undefined) data.date_end     = new Date(date_end);
  if (details      !== undefined) data.details      = details;
  if (req_allowance !== undefined) data.req_allowance = req_allowance;
  if (position     !== undefined) data.position     = position;

  await prisma.employeeleaves.update({ where: { id }, data });

  // Recalculate leave days if dates changed
  if (date_start || date_end) {
    await prisma.$executeRaw`DELETE FROM employeeleavedays WHERE employee_leave=${id}`;
    const start = date_start ?? current.date_start.toISOString().split('T')[0];
    const end   = date_end   ?? current.date_end.toISOString().split('T')[0];
    const days  = await getWorkingDays(start, end);
    for (const d of days) {
      await prisma.$executeRaw`INSERT INTO employeeleavedays (id, employee_leave, leave_date, leave_type)
        VALUES (${BigInt(Date.now() + Math.floor(Math.random() * 100000))}, ${id}, ${new Date(d.date)}, ${d.type})`.catch(() => {});
    }
  }

  respond.ok(res, 'Leave updated');
});

// DELETE /leave/:id — permanently remove a draft or pending leave application, cascading to its day entries and log.
exports.deleteLeave = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const rows = await prisma.$queryRaw`SELECT id, status FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');
  if (!['Pending', 'Draft'].includes(current.status))
    return respond.badReq(res, 'Only Pending or Draft leaves can be deleted');

  await prisma.$executeRaw`DELETE FROM employeeleavedays WHERE employee_leave=${id}`;
  await prisma.$executeRaw`DELETE FROM employeeleavelog WHERE employee_leave=${id}`;
  await prisma.employeeleaves.delete({ where: { id } });
  logActivity({ module: 'Leave', action: 'delete', entityId: req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave deleted');
});

// ── Workflow ──────────────────────────────────────────────────────────────────

// POST /leave/:id/submit — move a draft/pending leave into the approval queue.
// Routes to 'Pending Approval' (supervisor tier) when supervisor approval is enabled, else directly to 'Pending HR Approval'.
exports.submitLeave = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const rows    = await prisma.$queryRaw`SELECT id, status FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');
  if (!['Pending', 'Draft'].includes(current.status))
    return respond.badReq(res, 'Only Draft or Pending leaves can be submitted');

  const flow      = await getApprovalFlowSettings();
  const supOn     = flow.leave_supervisor_approval === 'Yes';

  // Only route to the supervisor tier when supervisor approval is on AND the employee actually
  // has a supervisor. Otherwise the request would sit in a queue no one can see — so skip the
  // supervisor step and send it straight to HR (advancing approval_level past the supervisor tier
  // so HR's approval finalises it).
  let hasSupervisor = false;
  if (supOn) {
    const empRows = await prisma.$queryRaw`SELECT e.supervisorId AS sup FROM employeeleaves el JOIN employee e ON e.id = el.employee WHERE el.id = ${id} LIMIT 1`.catch(() => []);
    hasSupervisor = !!empRows?.[0]?.sup;
  }
  const toSupervisor = supOn && hasSupervisor;
  const newLevel     = (supOn && !hasSupervisor) ? 1 : 0;  // skipped supervisor tier ⇒ HR is final
  await prisma.$executeRaw`UPDATE employeeleaves SET submitted_by=${toBigInt(req.user.id)}, approval_level=${newLevel} WHERE id=${id}`;

  let routed;
  if (toSupervisor) {
    await prisma.$executeRaw`UPDATE employeeleaves SET status='Pending Approval' WHERE id=${id}`;
    routed = { status: 'Pending Approval', financial: false };
  } else {
    routed = await routeAfterSupervisorApproval(id, req.user.id);
  }

  const logMsg = toSupervisor
    ? 'Submitted for supervisor approval'
    : routed.financial
      ? 'Submitted — supervisor tier skipped, sent for financial approval'
      : 'Submitted — supervisor tier skipped, sent directly to HR approval';
  await writeLog(id, req.user.id, logMsg, current.status, routed.status);
  notifyLeaveAction(id, 'submitted');
  if (toSupervisor) await notifyLeaveInApp(id, 'supervisor_pending', null, req.user.id);
  respond.ok(res, routed.financial
    ? 'Leave submitted — sent for financial approval'
    : toSupervisor ? 'Leave submitted for supervisor approval' : 'Leave submitted — sent directly to HR approval');
});

// POST /leave/:id/approve — supervisor approval conditionally routes through finance before HR.
// HR is always the final leave approver and schedules an already-cleared allowance for GL posting.
exports.approveLeave = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const rows    = await prisma.$queryRaw`SELECT id, status, approval_level, allowance_status FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');

  const level = current.approval_level ?? 0;
  const prevStatus = current.status;

  if (current.status === 'Pending Approval') {
    const newLevel = level + 1;
    await prisma.$executeRaw`UPDATE employeeleaves SET approved_by=${toBigInt(req.user.id)}, approval_level=${newLevel} WHERE id=${id}`;
    const routed = await routeAfterSupervisorApproval(id, req.user.id);
    const logNote = routed.financial
      ? `Supervisor approved (level ${newLevel}) — awaiting financial approval`
      : `Supervisor approved (level ${newLevel}) — awaiting HR approval`;
    await writeLog(id, req.user.id, logNote, prevStatus, routed.status);
    notifyLeaveAction(id, 'submitted');
    logActivity({ module: 'Leave', action: 'supervisor_approve', entityId: req.params.id, ...fromReq(req) });
    return respond.ok(res, routed.financial
      ? 'Supervisor approval recorded — awaiting financial approval'
      : 'Supervisor approval recorded — awaiting HR approval');
  }

  if (current.status !== 'Pending HR Approval')
    return respond.badReq(res, 'Leave is not pending supervisor or HR approval');

  const isAdmin = req.user?.roles?.some(r => ['admin', 'super-admin'].includes(String(r)));
  if (!isAdmin) return respond.forbidden(res, 'Only Admin HR can give final leave approval');

  const newLevel = level + 1;
  await prisma.$executeRaw`UPDATE employeeleaves SET status='Approved', approved_by=${toBigInt(req.user.id)}, approval_level=${newLevel} WHERE id=${id}`;
  await writeLog(id, req.user.id, 'Final approval by HR', prevStatus, 'Approved');
  notifyLeaveAction(id, 'approved');
  await notifyLeaveInApp(id, 'approved', null, req.user.id);

  // Finance has already cleared any configured stages. HR approval is the only point at which
  // an allowance may become GL Scheduled.
  await processLeaveAllowance(id);

  logActivity({ module: 'Leave', action: 'approve', entityId: req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave approved');
});

// POST /leave/:id/finalize — manually trigger GL posting for an already-approved leave whose allowance was not auto-posted.
// Blocked if GL was already processed, is in-flight, or the leave predates allowance being enabled.
exports.finalizeLeave = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const rows    = await prisma.$queryRaw`SELECT id, status, allowance_status FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');

  if (current.status !== 'Approved')
    return respond.badReq(res, 'Only Approved leaves can be finalized');
  if (['Paid', 'GL Scheduled', 'Pending Financial Approval'].includes(current.allowance_status ?? ''))
    return respond.badReq(res, 'GL posting already processed or in progress');
  if (current.allowance_status === 'Pre-enable Skip')
    return respond.badReq(res, 'This leave was approved before allowance was enabled and is not eligible for payout');

  await writeLog(id, req.user.id, 'Finalized manually — GL posting triggered', 'Approved', 'Approved');
  processLeaveAllowance(id);
  logActivity({ module: 'Leave', action: 'finalize', entityId: req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave finalized — GL posting in progress');
});

// POST /leave/:id/reject — reject a leave at any approval stage and release the once-per-period allowance slot
// so the employee can apply again within the same period.
exports.rejectLeave = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const rows    = await prisma.$queryRaw`SELECT id, status FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');

  const { reason } = req.body;
  const prevStatus = current.status;

  // Fetch amount before updating so we can release the once-per-period slot
  const leaveData = await prisma.$queryRaw`SELECT amount FROM employeeleaves WHERE id=${id}`.then(r => r[0]).catch(() => null);

  await prisma.$executeRaw`UPDATE employeeleaves SET status='Rejected', approved_by=${toBigInt(req.user.id)}, rejection_reason=${reason ?? null} WHERE id=${id}`;

  // Release once-per-period allowance slot so a future application can claim it
  if (leaveData?.amount && parseFloat(leaveData.amount) > 0) {
    await prisma.$executeRaw`UPDATE employeeleaves SET amount=NULL, req_allowance=NULL WHERE id=${id}`.catch(() => {});
  }

  await writeLog(id, req.user.id, reason ? `Rejected: ${reason}` : 'Rejected', prevStatus, 'Rejected');
  notifyLeaveAction(id, 'rejected', reason);
  notifyLeaveInApp(id, 'rejected', reason);
  logActivity({ module: 'Leave', action: 'reject', entityId: req.params.id, details: reason ? { reason } : null, ...fromReq(req) });
  respond.ok(res, 'Leave rejected');
});

// POST /leave/:id/cancel — cancel an approved leave before it starts; releases the allowance slot.
// Blocked once the leave start date has passed to prevent retroactive cancellation.
exports.cancelLeave = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const rows    = await prisma.$queryRaw`SELECT id, status, date_start, amount FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');
  if (current.status !== 'Approved')
    return respond.badReq(res, 'Only Approved leaves can be cancelled');

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDate = new Date(current.date_start); startDate.setHours(0, 0, 0, 0);
  if (startDate <= today)
    return respond.badReq(res, 'Leave cannot be cancelled after it has started');

  // Fetch amount before updating so we can release the once-per-period slot
  const cancelData = current;

  await prisma.$executeRaw`UPDATE employeeleaves SET status='Cancelled' WHERE id=${id}`;

  // Release once-per-period allowance slot so a future application can claim it
  if (cancelData?.amount && parseFloat(cancelData.amount) > 0) {
    await prisma.$executeRaw`UPDATE employeeleaves SET amount=NULL, req_allowance=NULL WHERE id=${id}`.catch(() => {});
  }

  await writeLog(id, req.user.id, 'Cancelled', 'Approved', 'Cancelled');
  notifyLeaveAction(id, 'cancelled');
  notifyLeaveInApp(id, 'cancelled');
  logActivity({ module: 'Leave', action: 'cancel', entityId: req.params.id, ...fromReq(req) });
  respond.ok(res, 'Leave cancelled');
});

// ── Balance & Entitlement ─────────────────────────────────────────────────────

// GET /leave/balance/:employeeId — compute allocated / used / pending / balance for every leave type the employee is
// eligible for in the active period. Lazily calculates and persists carry-forward from the previous period when needed.
// Also returns allowance net/tax amounts per type when the allowance feature is enabled.
exports.getLeaveBalance = asyncHandler(async (req, res) => {
  const employeeId = req.params.employeeId;

  const activePeriods = await prisma.leaveperiods.findMany({ where: { status: 'Active' } });
  if (!activePeriods.length) return respond.ok(res, 'No active leave period', []);
  const period = activePeriods[0];

  // Allowance settings + employee allowance amount (same calc as processLeaveAllowance)
  const allowSettings = await getAllowanceSettings();
  const allowEnabled  = allowSettings.leave_allow_enabled === 'Yes';
  const allowCalc     = allowEnabled ? await calcLeaveAllowance(employeeId, allowSettings) : null;

  // Employee profile for rule matching
  const empRows = await prisma.$queryRaw`
    SELECT e.id, e.jobTitleId AS job_title_id, e.departmentId, e.employmentStatusId AS emp_status_id, e.paygradeId, e.hireDate,
            UPPER(LEFT(clv.label,1)) AS gender_code
     FROM employee e
     LEFT JOIN CodeListValue clv ON clv.id = e.genderId
     WHERE e.id=${toBigInt(employeeId)}`.catch(() => []);
  const emp = empRows[0] ?? {};

  const [allTypes, rules, groupAssignments] = await Promise.all([
    prisma.$queryRaw`SELECT * FROM leavetypes ORDER BY name`.catch(() => []),
    prisma.$queryRaw`SELECT * FROM leaverules`.catch(() => []),
    prisma.$queryRaw`SELECT leave_type_id, leave_group_id FROM leavetype_groups`.catch(() => []),
  ]);

  // Build paygrade→type restriction map then filter to types this employee can access.
  // leavetype_groups.leave_group_id stores paygrade IDs (assigned from the leave-type form).
  const pgByType = {};
  for (const a of groupAssignments) {
    const key = String(a.leave_type_id);
    if (!pgByType[key]) pgByType[key] = [];
    pgByType[key].push(String(a.leave_group_id));
  }
  const empPgId      = emp.paygradeId != null ? String(emp.paygradeId) : null;
  const empGenderCode = emp.gender_code ?? null;
  const types = allTypes.filter(t => {
    // Paygrade group check
    const allowed = pgByType[String(t.id)] ?? [];
    if (allowed.length > 0 && (empPgId === null || !allowed.includes(empPgId))) return false;
    // Gender check
    const tg = t.gender ?? 'All';
    if (tg !== 'All' && empGenderCode !== null && empGenderCode !== tg) return false;
    return true;
  });

  // Most recent period that ended before the active period started — used for lazy CF computation.
  // Must be chronologically before the active period so testing future periods and switching back
  // doesn't cause carry-forward to run in reverse.
  const prevPeriodRows = await prisma.$queryRaw`
    SELECT * FROM leaveperiods WHERE id != ${toBigInt(period.id)} AND date_end < ${new Date(period.date_start)} ORDER BY date_end DESC LIMIT 1`.catch(() => []);
  const prevPeriod = prevPeriodRows[0] ?? null;

  const result = await Promise.all(
    types.map(async (t) => {
      // 1. Rule match first — needed before CF check
      const ruleMatch = rules.find((r) => {
        if (String(r.leave_type) !== String(t.id)) return false;
        if (r.employee          && String(r.employee)          !== String(employeeId        ?? '')) return false;
        if (r.leave_period      && String(r.leave_period)      !== String(period.id         ?? '')) return false;
        if (r.job_title         && String(r.job_title)         !== String(emp.job_title_id  ?? '')) return false;
        if (r.department        && String(r.department)        !== String(emp.departmentId  ?? '')) return false;
        if (r.employment_status && String(r.employment_status) !== String(emp.emp_status_id ?? '')) return false;
        if (r.leave_group       && String(r.leave_group)       !== String(emp.paygradeId    ?? '')) return false;
        if (r.exp_days) {
          const days = emp.hireDate ? Math.floor((Date.now() - new Date(emp.hireDate).getTime()) / 86400000) : 0;
          if (days < Number(r.exp_days)) return false;
        }
        return true;
      });
      const has_rule = !!ruleMatch;

      // 2. Check for existing starting balance; if none and CF is enabled, auto-compute from the previous period
      const sbRows = await prisma.$queryRaw`SELECT amount FROM leavestartingbalance WHERE employee=${toBigInt(employeeId)} AND leave_type=${t.id} AND leave_period=${toBigInt(period.id)}`.catch(() => []);
      let startingBalance = sbRows.length ? parseFloat(sbRows[0].amount) : null;

      if (startingBalance === null && prevPeriod && (ruleMatch?.carried_forward ?? t.carried_forward) === 'Yes') {
        // Only carry forward if the employee actually participated in the previous period
        // (approved leave exists or a starting balance was set there). Prevents phantom CF
        // after a data reset where the previous period shows a full unused allocation.
        const [prevLeaves, prevSB] = await Promise.all([
          prisma.$queryRaw`SELECT 1 FROM employeeleaves WHERE employee=${toBigInt(employeeId)} AND leave_type=${t.id} AND leave_period=${toBigInt(prevPeriod.id)} AND status='Approved' LIMIT 1`.catch(() => []),
          prisma.$queryRaw`SELECT 1 FROM leavestartingbalance WHERE employee=${toBigInt(employeeId)} AND leave_type=${t.id} AND leave_period=${toBigInt(prevPeriod.id)} LIMIT 1`.catch(() => []),
        ]);

        if (prevLeaves.length || prevSB.length) {
          const prevBal = await calcBalance(employeeId, t.id.toString(), String(prevPeriod.id), emp);
          if (prevBal.balance > 0) {
            const effectivePct  = parseFloat(ruleMatch?.carried_forward_percentage ?? t.carried_forward_percentage) || 100;
            const effectiveMax  = parseFloat(ruleMatch?.max_carried_forward_amount  ?? t.max_carried_forward_amount)  || 0;
            const effectiveBase = parseFloat(ruleMatch?.default_per_year ?? t.default_per_year) || 0;
            let cfDays = prevBal.balance * (effectivePct / 100);
            if (effectiveMax > 0) cfDays = Math.min(cfDays, effectiveMax);
            cfDays = Math.round(cfDays * 2) / 2;
            startingBalance = effectiveBase + cfDays;
            await prisma.$executeRaw`INSERT INTO leavestartingbalance (id, employee, leave_type, leave_period, amount)
              VALUES (${BigInt(Date.now() + Math.floor(Math.random() * 1000000))}, ${toBigInt(employeeId)}, ${t.id}, ${toBigInt(period.id)}, ${startingBalance})`.catch(() => {});
          }
        }
      }

      // 3. calcBalance for current period — benefits from starting balance we may have just written
      const bal = await calcBalance(employeeId, t.id.toString(), period.id.toString(), emp);

      const effectiveBaseAlloc = parseFloat(ruleMatch?.default_per_year ?? t.default_per_year) || 0;
      // carry_forward_days is 0 if CF window expired (calcBalance will have dropped to base allocation)
      const carry_forward_days = (startingBalance !== null && bal.allocated > effectiveBaseAlloc)
        ? Math.max(0, startingBalance - effectiveBaseAlloc)
        : 0;

      const effectiveAllowance = ruleMatch ? ruleMatch.leave_allowance === 'Yes' : t.leave_allowance === 'Yes';
      const typeAllowance = allowEnabled && effectiveAllowance;
      const aNet   = allowCalc?.amount    ?? 0;
      const aTax   = allowCalc?.leave_tax ?? 0;
      return {
        leave_type_id:               t.id.toString(),
        name:                        t.name,
        leave_color:                 t.leave_color,
        // Rule overrides type where present
        leave_accrue:                ruleMatch?.leave_accrue               ?? t.leave_accrue,
        carried_forward:             ruleMatch?.carried_forward             ?? t.carried_forward,
        carried_forward_percentage:  ruleMatch?.carried_forward_percentage  ?? t.carried_forward_percentage ?? 100,
        max_carried_forward_amount:  ruleMatch?.max_carried_forward_amount  ?? t.max_carried_forward_amount ?? 0,
        apply_beyond_current:        ruleMatch?.apply_beyond_current        ?? t.apply_beyond_current ?? 'No',
        supervisor_leave_assign:     ruleMatch?.supervisor_leave_assign     ?? t.supervisor_leave_assign ?? 'No',
        propotionate_on_joined_date: ruleMatch?.propotionate_on_joined_date ?? t.propotionate_on_joined_date ?? 'No',
        period_name:                 period.name ?? '',
        ...bal,
        carry_forward_days,
        has_rule,
        allowance_enabled:           typeAllowance,
        allowance_amount:            typeAllowance ? aNet : null,
        allowance_tax:               typeAllowance ? aTax : null,
        allowance_gross:             typeAllowance ? Math.round((aNet + aTax) * 100) / 100 : null,
        allowance_annual_factor:     typeAllowance ? (allowSettings.leave_allow_annual_factor ?? '0.3') : null,
        allowance_tax_rate:          typeAllowance ? (allowSettings.leave_allow_tax_rate      ?? '0.3') : null,
      };
    })
  );
  respond.ok(res, 'Leave balance', result);
});

// GET /leave/subordinate — list all leave applications belonging to the current user's direct reports,
// with optional ?status= filter. Returns day count, leave-type colour, and allowance figures per record.
exports.getSubordinateLeaves = asyncHandler(async (req, res) => {
  const supervisorId = toBigInt(req.user.id);
  const statusFilter = req.query.status ? String(req.query.status) : null;

  const subordinates = await prisma.$queryRaw`
    SELECT e.id FROM employee e
     WHERE e.supervisorid = (SELECT employeeId FROM users WHERE id=${supervisorId} LIMIT 1)`.catch(() => []);

  if (!subordinates.length) return respond.ok(res, 'Subordinate leaves', []);

  const ids = subordinates.map(r => r.id);
  const statusCond = statusFilter ? Prisma.sql`AND el.status = ${statusFilter}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT el.*,
            TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
            e.employee_id AS employee_code,
            lt.name AS leave_type_name,
            lt.leave_color,
            lt.leave_allowance AS leave_type_allowance_enabled,
            lp.name AS period_name,
            nt.amount AS notch_amount,
            (SELECT COUNT(*) FROM employeeleavedays eld WHERE eld.employee_leave = el.id) AS day_count
     FROM employeeleaves el
     LEFT JOIN employee   e  ON e.id  = el.employee
     LEFT JOIN leavetypes lt ON lt.id = el.leave_type
     LEFT JOIN leaveperiods lp ON lp.id = el.leave_period
     LEFT JOIN notches     nt ON nt.id = e.notcheId
     WHERE el.employee IN (${Prisma.join(ids)}) ${statusCond}
     ORDER BY el.posted_date DESC`.catch(() => []);

  // Return the same allowance display fields as the employee/admin leave endpoints. The supervisor
  // table and detail panel deliberately key off these aliases, so omitting them hides a saved payout.
  const allowanceSettings = await getAllowanceSettings().catch(() => ({}));
  const annualFactor = parseFloat(allowanceSettings.leave_allow_annual_factor) || 0.3;
  const taxRate      = parseFloat(allowanceSettings.leave_allow_tax_rate)      || 0.3;
  const cleaned = rows.map(r => {
    if (r.allowance_status === 'Pre-enable Skip' || r.req_allowance === 'No') {
      return { ...r, amount: null, leave_tax: null, allowance_tax: null };
    }
    const net = parseFloat(r.amount) || 0;
    if (r.leave_type_allowance_enabled !== 'Yes' || net <= 0) return r;
    const tax   = parseFloat(r.leave_tax) || 0;
    const basic = parseFloat(r.notch_amount) || 0;
    return {
      ...r,
      allowance_gross:         String(Math.round((net + tax) * 100) / 100),
      allowance_tax:           String(tax),
      allowance_basic:         String(Math.round(basic * 100) / 100),
      allowance_annual_factor: String(annualFactor),
      allowance_tax_rate:      String(taxRate),
    };
  });
  respond.ok(res, 'Subordinate leaves', s(cleaned));
});

// GET /leave/subordinate/employees — list the current user's direct reports (id, name, employee code),
// used to populate the supervisor's employee filter on the leave management view.
exports.getSubordinateEmployees = asyncHandler(async (req, res) => {
  const supervisorId = toBigInt(req.user.id);
  const rows = await prisma.$queryRaw`
    SELECT e.id, TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS name, e.employee_id AS employee_code
     FROM employee e
     WHERE e.supervisorid = (SELECT employeeId FROM users WHERE id=${supervisorId} LIMIT 1)
     ORDER BY e.firstName, e.lastName`.catch(() => []);
  respond.ok(res, 'Subordinate employees', s(rows));
});

// ── Leave Central Approval (role-based unified queue) ─────────────────────────

// GET /leave/central-approval — unified approval inbox that merges three permission-gated queues into one response:
//   • Supervisor tier: subordinates' leaves at 'Pending Approval'
//   • HR tier (admin only): leaves at 'Pending HR Approval'
//   • Financial approver tier: leaves at 'Pending Financial Approval' (allowance threshold holds)
// Each caller only sees the rows their role permits.
exports.getLeaveCentralApproval = asyncHandler(async (req, res) => {
  const userId    = toBigInt(req.user.id);
  const isAdmin   = req.user?.roles?.some(r => ['admin', 'super-admin'].includes(r));
  const canFinancial = hasBlanketFinancial(req) || (await readLeaveFlow()).length > 0;

  // Find current user's linked employee record
  const userEmp = await prisma.$queryRaw`SELECT employeeId FROM users WHERE id=${userId}`.catch(() => []);
  const empId = userEmp[0]?.employeeId ? toBigInt(userEmp[0].employeeId) : null;

  const clauses = [];
  // Supervisor tier: subordinates waiting for first approval
  if (empId) {
    clauses.push(Prisma.sql`(el.status = 'Pending Approval' AND EXISTS (
      SELECT 1 FROM employee sub WHERE sub.supervisorid = ${empId} AND sub.id = el.employee
    ))`);
  }
  // HR tier: leaves waiting for HR approval
  if (isAdmin) clauses.push(Prisma.sql`el.status = 'Pending HR Approval'`);
  // Financial tier: allowances held pending sign-off (further filtered to current-stage match below)
  if (canFinancial) clauses.push(Prisma.sql`el.allowance_status = 'Pending Financial Approval'`);

  if (!clauses.length) return respond.ok(res, 'Leave approvals', []);

  // Current pending stage per pending-financial leave (lowest stage_order still Pending). Portable
  // MIN(stage_order) join (works on MariaDB + Postgres) — surfaces the current approver so Central
  // Approval can build a per-approver queue + stage chain.
  const rows = await prisma.$queryRaw`
    SELECT el.*,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.employee_id AS employee_code,
           d.title AS department_name,
           lt.name AS leave_type_name, lt.leave_color,
           lp.name AS period_name,
           cs.approver_type  AS cur_approver_type,
           cs.approver_id    AS cur_approver_id,
           cs.approver_label AS cur_approver_label,
           cs.stage_name     AS cur_stage_name,
           (SELECT COUNT(*) FROM employeeleavedays eld WHERE eld.employee_leave = el.id) AS day_count
    FROM employeeleaves el
    LEFT JOIN employee         e  ON e.id   = el.employee
    LEFT JOIN companystructures d  ON d.id   = e.departmentId
    LEFT JOIN leavetypes        lt ON lt.id  = el.leave_type
    LEFT JOIN leaveperiods      lp ON lp.id  = el.leave_period
    LEFT JOIN (
      SELECT s.leave_id, s.approver_type, s.approver_id, s.approver_label, s.stage_name
      FROM   employeeleave_stages s
      JOIN  (SELECT leave_id, MIN(stage_order) AS min_order
             FROM employeeleave_stages WHERE status = 'Pending' GROUP BY leave_id) m
        ON  m.leave_id = s.leave_id AND m.min_order = s.stage_order
      WHERE  s.status = 'Pending'
    ) cs ON cs.leave_id = el.id
    WHERE ${Prisma.join(clauses, ' OR ')}
    ORDER BY el.posted_date DESC`.catch(() => []);

  // Configured financial stages are visible only to their assigned approver. Blanket permission is the
  // fallback only for legacy/no-stage requests; it must not let Admin HR act before finance.
  const blanket = hasBlanketFinancial(req);
  const visible = s(rows).filter(r => {
    if (r.allowance_status !== 'Pending Financial Approval') return true;
    if (!r.cur_approver_type) return blanket;
    return actorMatchesStage(req, { approver_type: r.cur_approver_type, approver_id: r.cur_approver_id, approver_label: r.cur_approver_label });
  }).map(r => ({
    ...r,
    // Whether THIS user may act on the allowance now (used to gate the Approve/Reject buttons).
    _canActAllowance: r.allowance_status === 'Pending Financial Approval' && (r.cur_approver_type
      ? actorMatchesStage(req, { approver_type: r.cur_approver_type, approver_id: r.cur_approver_id, approver_label: r.cur_approver_label })
      : blanket),
  }));

  respond.ok(res, 'Leave approvals', visible);
});

// POST /leave/:id/approve-allowance — walk the amount-range financial approval flow. Intermediate stages
// advance in finance; the final financial approval sends the whole leave to Admin HR. GL scheduling only
// occurs after Admin HR gives final leave approval.
exports.approveAllowanceLeave = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const rows    = await prisma.$queryRaw`SELECT id, status, allowance_status, employee FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');
  if (current.allowance_status !== 'Pending Financial Approval')
    return respond.badReq(res, 'Leave is not pending financial approval');

  const stages  = await loadLeaveStages(id);
  const pending = stages.filter(st => st.status === 'Pending');
  const actedBy = req.user?.id ? BigInt(req.user.id) : null;

  if (pending.length) {
    const stage = pending[0];
    // In a configured flow, only the current stage's assigned approver may act — a blanket permission grants
    // access to the queue but does NOT let a non-assigned user skip a stage (mirrors payroll/medical).
    if (!actorMatchesStage(req, stage)) {
      const who = stage.approver_label || (stage.approver_type === 'user' ? 'the assigned approver' : 'the assigned role');
      return respond.forbidden(res, `Only ${who} can approve the "${stage.stage_name}" stage`);
    }
    await prisma.$executeRaw`UPDATE employeeleave_stages SET status='Approved', acted_by=${actedBy}, acted_at=NOW(), comment=${req.body?.comment?.trim() || null} WHERE id=${BigInt(stage.id)}`;
    await writeLog(id, req.user.id, `Financial stage "${stage.stage_name}" approved`, 'Pending Financial Approval', 'Pending Financial Approval');

    if (pending.length > 1) {
      notifyLeaveStageApprovers(pending[1], req, current.employee);
      return respond.ok(res, `"${stage.stage_name}" approved — awaiting the next stage`);
    }
  } else {
    // Legacy / defensive: pending-financial leave with no snapshot ⇒ single blanket sign-off.
    if (!hasBlanketFinancial(req)) return respond.forbidden(res, 'You are not authorised to approve this allowance');
  }

  // Compatibility for requests that entered finance under the old HR-before-finance workflow:
  // HR has already approved those rows, so complete their allowance without asking HR twice.
  if (current.status === 'Approved') {
    await prisma.$executeRaw`UPDATE employeeleaves SET allowance_status='Financial Approved' WHERE id=${id}`;
    await writeLog(id, req.user.id, 'Financial approval completed for previously HR-approved leave', 'Approved', 'Approved');
    await processLeaveAllowance(id);
    return respond.ok(res, 'Financial approval completed — allowance scheduled for GL');
  }

  // Last financial stage cleared (or no-flow blanket) → Admin HR becomes the final approver.
  await prisma.$executeRaw`
    UPDATE employeeleaves
       SET allowance_status='Financial Approved', status='Pending HR Approval'
     WHERE id=${id}`;
  await writeLog(id, req.user.id, 'Financial approval completed — awaiting final HR approval', 'Pending Financial Approval', 'Pending HR Approval');
  await notifyLeaveInApp(id, 'hr_pending', null, req.user.id);
  respond.ok(res, 'Financial approval completed — awaiting Admin HR approval');
});

// POST /leave/:id/reject-allowance — financial rejection rejects the entire leave, not only its allowance.
exports.rejectAllowanceLeave = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const reason  = req.body?.reason?.trim() || null;
  const rows    = await prisma.$queryRaw`SELECT id, allowance_status, employee FROM employeeleaves WHERE id=${id}`.catch(() => []);
  const current = rows[0] ?? null;
  if (!current) return respond.notFound(res, 'Leave not found');
  if (current.allowance_status !== 'Pending Financial Approval')
    return respond.badReq(res, 'Leave is not pending financial approval');

  const stages  = await loadLeaveStages(id);
  const pending = stages.filter(st => st.status === 'Pending');
  const stage   = pending[0];
  if (stage) {
    // Only the current stage's assigned approver may reject it (blanket permission doesn't skip stages).
    if (!actorMatchesStage(req, stage)) {
      const who = stage.approver_label || (stage.approver_type === 'user' ? 'the assigned approver' : 'the assigned role');
      return respond.forbidden(res, `Only ${who} can act on the "${stage.stage_name}" stage`);
    }
    const actedBy = req.user?.id ? BigInt(req.user.id) : null;
    await prisma.$executeRaw`UPDATE employeeleave_stages SET status='Rejected', acted_by=${actedBy}, acted_at=NOW(), comment=${reason} WHERE id=${BigInt(stage.id)}`;
  } else if (!hasBlanketFinancial(req)) {
    return respond.forbidden(res, 'You are not authorised to reject this allowance');
  }

  await prisma.$executeRaw`UPDATE employeeleave_stages SET status='Skipped' WHERE leave_id=${id} AND status='Pending'`;
  await prisma.$executeRaw`
    UPDATE employeeleaves
       SET status='Rejected', allowance_status='Financial Rejected', approved_by=${toBigInt(req.user.id)}, rejection_reason=${reason}
     WHERE id=${id}`;
  await writeLog(id, req.user.id, reason ? `Leave rejected during financial approval: ${reason}` : 'Leave rejected during financial approval', 'Pending Financial Approval', 'Rejected');
  notifyLeaveAction(id, 'rejected', reason);
  await notifyLeaveInApp(id, 'rejected', reason, req.user.id);
  respond.ok(res, 'Financial approval rejected — the leave has been rejected');
});
