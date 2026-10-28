// End of Service Benefit (EOSB).
//
//   EOSB = Annual Gross Salary × Years of Service × Days' Pay per Year ÷ 261
//
// Years run from the hire date to the effective date of the exit; a part year of 6 months or more
// counts as a full year, at every length of service, and service under 6 months earns nothing. The
// days per year come from the service band the employee falls into, and that band's rate applies to
// every year (5 years → 33 days × 5, not 30 × 3 + 33 × 2). Annual Gross is basic plus allowances —
// the salary components chosen in setup, × 12. No benefit is paid for dismissal or end of contract.
//
// A settlement then adds what the Bank still owes and deducts what the employee owes:
//   leave allowance   — paid when the employee applies for leave. Already paid this year → the
//                       months after the exit are recovered; not paid yet → the months worked are added.
//   rent allowance    — paid in advance for the year: recovered the same way, or added if not paid.
//   clothing allowance— never paid in advance: added for the months worked if not paid yet.
//   final salary      — added when the employee gave notice and has not been paid that month.
//   notice pay        — one month's salary deducted when no notice was given, only if that salary
//                       has not already been paid.
//   staff loans, Provident Fund (fixed amount, employees on the PF list only), anything else.
// The benefit and monthly amounts are cut off at 2 decimals, not rounded (42,320 ÷ 12 = 3,526.66),
// as the Bank does.
// Every suggested line can be changed by HR before the settlement is submitted.
//
// Status flow:  Draft → Pending Approval (the stages set in Settings → Approvals) → Approved → Paid
//                                                                                    └→ GL Failed → (retry) → Paid
//               Rejected / Cancelled from an open state.
// Final approval marks the employee as exited (resigned or terminated) and posts the settlement:
//   Dr EOSB expense           Cr employee account     the benefit
//   Dr addition's GL          Cr employee account     each addition
//   Dr employee account       Cr deduction's GL/loan  each deduction
// A negative balance leaves the employee's account overdrawn; the Bank follows it up outside the app.
//
// Tables come from manual-migrations/20261027_end_of_service.*.sql and are read with raw SQL.
const { Prisma }   = require('@prisma/client');
const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const { toBigInt, s } = require('../helpers/controllerHelpers');
const { postToGL } = require('../helpers/glHelper');
const { getApiConfig } = require('./apiIntegrationController');
const { upsertSetting, getSystemCurrency } = require('../helpers/settingsHelper');
const { notifyUser, notifyUsersWithPermission, notifyUsersWithRole } = require('../helpers/notificationHelper');
const { logActivity, fromReq } = require('./auditController');
const { buildSalaryByEmp } = require('./payrollRunController');
const { applyEmployeeExit } = require('./employeeController');

const SETTINGS_CAT = 'end_of_service';
const FLOW_KEY = 'eos_approval_flow';   // category app_controls, as the medical and payroll flows

const DEFAULT_LETTER = [
  'We write to confirm that your employment with the Bank ends with effect from {effective_date} ({reason}).',
  'Your End of Service Benefit has been calculated as shown below. After the additions and deductions, {balance_sentence}',
  'Please return all Bank property in your possession, including your staff identity card, to the Human Resources Department. Your NASSIT contributions remain valid.',
  'We thank you for your service to the Bank and wish you well in the future.',
].join('\n\n');
const DEFAULT_LETTER_DEATH = [
  'We write with deep regret to confirm that the employment of the late {name} with the Bank ended on {effective_date}.',
  'The End of Service Benefit has been calculated as shown below. After the additions and deductions, {balance_sentence}',
  'The NASSIT contributions of the late {name} remain valid. Please contact the Human Resources Department for any assistance.',
  'Please accept our sincere condolences.',
].join('\n\n');

const SETTING_DEFAULTS = {
  // Calculation (Manage End of Service → Setup)
  eos_divisor:             '261',     // working days a year: annual salary → daily rate
  eos_min_service_months:  '6',       // less service than this earns no benefit
  eos_round_up_months:     '6',       // a part year of this many months or more counts as a full year
  eos_notice_months:       '1',       // notice the employee must give
  eos_salary_basis:        'basic',   // one month's salary for notice and final salary: basic | gross
  eos_gross_components:    '[]',      // salary component ids that make up Annual Gross (monthly × 12)
  eos_rent_components:     '[]',
  eos_clothing_components: '[]',
  // How rent and clothing component amounts are held: annual | monthly. The Bank's are annual (Rent
  // 2025 averages about four times the basic salary; Cloth Allowance about one month's basic).
  eos_allowance_basis:     'annual',
  eos_ineligible_reasons:  JSON.stringify(['Dismissal', 'End of Contract']),
  eos_letter_signatory:    'Managing Director/CEO',
  eos_letter_body:         DEFAULT_LETTER,
  eos_letter_body_death:   DEFAULT_LETTER_DEATH,
  // Postings and GL (Settings → Controls)
  eos_payments_enabled:    'Yes',
  eos_expense_gl:          '',        // Dr for the benefit
  eos_leave_gl:            '',        // leave allowance: Cr when recovered, Dr when added
  eos_rent_gl:             '',
  eos_clothing_gl:         '',
  eos_salary_gl:           '',        // final month's salary (Dr)
  eos_notice_gl:           '',        // salary in lieu of notice (Cr)
  eos_pf_gl:               '',        // Provident Fund (Cr)
  eos_gl_branch:           '',
};
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);
const JSON_LIST_KEYS = ['eos_gross_components', 'eos_rent_components', 'eos_clothing_components', 'eos_ineligible_reasons'];

const EXIT_REASONS = ['Resignation', 'Termination by the Bank', 'Death', 'Retirement', 'Redundancy', 'Medical Grounds', 'Dismissal', 'End of Contract'];

// The GL account a line falls back to when it carries none.
const ITEM_GL_KEY = {
  leave_allowance: 'eos_leave_gl', rent_allowance: 'eos_rent_gl', clothing_allowance: 'eos_clothing_gl',
  final_salary: 'eos_salary_gl', notice_pay: 'eos_notice_gl', pf: 'eos_pf_gl',
};
const ITEM_CODES = ['leave_allowance', 'rent_allowance', 'clothing_allowance', 'final_salary', 'notice_pay', 'pf', 'loan', 'other'];

const TX_OPTS = { maxWait: 15000, timeout: 30000 };
const OPEN_STATUSES = ['Draft', 'Pending Approval'];
const CLOSED_STATUSES = ['Rejected', 'Cancelled'];   // these do not block a new settlement

// ── Helpers ───────────────────────────────────────────────────────────────────

let idSeq = 0;
const newId = () => { idSeq = (idSeq + 1) % 1000; return BigInt(Date.now()) * 1000n + BigInt(idSeq); };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
/** Cut off at 2 decimals, as the Bank does for monthly amounts (3,526.666 → 3,526.66). */
const trunc2 = (n) => Math.floor(Number(n) * 100 + 1e-6) / 100;
const toBool = (v) => v === true || v === 1 || v === '1' || v === 't' || v === 'true';
const hasPerm = (req, p) => Array.isArray(req.user?.permissions) && req.user.permissions.includes(p);
const isAdmin = (req) => (req.user?.roles ?? []).some(r => ['admin', 'super-admin'].includes(String(r)));
const canManage   = (req) => isAdmin(req) || hasPerm(req, 'manage_end_of_service');
const canApprove  = (req) => isAdmin(req) || hasPerm(req, 'approve_end_of_service');
const canView     = (req) => canManage(req) || canApprove(req) || hasPerm(req, 'view_end_of_service');
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseDay(value) {
  const str = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(`${str}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function parseList(value) {
  try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

async function readSettings() {
  const rows = await prisma.settings
    .findMany({ where: { category: SETTINGS_CAT }, select: { name: true, value: true } })
    .catch(() => []);
  const map = { ...SETTING_DEFAULTS };
  for (const r of rows) if (SETTING_KEYS.includes(r.name) && r.value != null) map[r.name] = r.value;
  return map;
}

async function readBands() {
  const rows = await prisma.$queryRaw`SELECT id, up_to_years, days_per_year FROM eos_bands`.catch(() => []);
  return s(rows)
    .map(r => ({ id: String(r.id), up_to_years: r.up_to_years == null ? null : Number(r.up_to_years), days_per_year: Number(r.days_per_year) }))
    .sort((a, b) => (a.up_to_years ?? Infinity) - (b.up_to_years ?? Infinity));
}

async function loadEmployee(employeeId) {
  const id = toBigInt(employeeId);
  if (!id) return null;
  const [row] = await prisma.$queryRaw`
    SELECT e.id, e.employee_id AS employee_code,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.status, e.lifecycleStatus AS lifecycle_status, e.hireDate AS hire_date,
           e.termination_date, e.bankAccount AS bank_account,
           COALESCE(b.comp_code, b.title) AS branch_code, b.title AS branch_name,
           jt.name AS job_title
      FROM employee e
      LEFT JOIN companystructures b ON b.id = e.branchId
      LEFT JOIN jobtitles jt ON jt.id = e.jobTitleId
     WHERE e.id = ${id}`.catch(() => []);
  return row ? { ...s(row), id: String(row.id) } : null;
}

/** Complete years and months from hire to exit: 01 Aug 2021 → 25 Sep 2026 = 5 years 1 month. */
function serviceBetween(hire, exit) {
  let months = (exit.getUTCFullYear() - hire.getUTCFullYear()) * 12 + (exit.getUTCMonth() - hire.getUTCMonth());
  if (exit.getUTCDate() < hire.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12, total: months };
}

/** Monthly amounts of an employee's salary components, by component id, plus the basic salary. */
async function salaryFor(employeeId) {
  const { salaryByEmp, notchLinkedComp } = await buildSalaryByEmp([toBigInt(employeeId)]);
  const byName = salaryByEmp[String(Number(employeeId))] || {};
  const comps = await prisma.$queryRaw`SELECT id, name FROM salarycomponent`.catch(() => []);
  const byId = {};
  for (const c of comps) {
    const key = String(c.name).toUpperCase();
    if (key in byName) byId[String(c.id)] = { name: c.name, amount: Number(byName[key]) || 0 };
  }
  const basicKey = notchLinkedComp?.name?.toUpperCase();
  const basic = basicKey && basicKey in byName ? Number(byName[basicKey]) || 0 : 0;
  return { byId, basic };
}

/** Sum of the chosen components (monthly amounts), with the parts that made it up. */
function sumComponents(salary, ids) {
  const parts = ids.filter(id => salary.byId[id]).map(id => ({ name: salary.byId[id].name, amount: salary.byId[id].amount }));
  return { total: round2(parts.reduce((t, p) => t + p.amount, 0)), parts };
}

/** Annual leave allowance as the leave module works it out: basic × 12 × the annual factor. */
async function annualLeaveAllowance(basic) {
  const [row] = await prisma.$queryRaw`
    SELECT value FROM settings WHERE category = 'leave_allowance' AND name = 'leave_allow_annual_factor'`.catch(() => []);
  const factor = parseFloat(row?.value) || 0.3;
  return round2(basic * 12 * factor);
}

const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * What the system's own records say about the questions HR answers on a settlement. Each answer is
 * { value, note } — or null when the records cannot tell, and HR's answer (or the default) stands.
 *   leave_paid   — the leave module: a leave this year whose allowance was paid.
 *   salary_paid  — payroll: a paid run (Completed or Bank Pending) covering the effective date that
 *                  includes the employee.
 *   notice_given — the dates: notified at least the notice period before the effective date.
 */
async function systemChecks(employeeId, effective, notified, noticeMonths) {
  const emp = toBigInt(employeeId);
  const year = effective.getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year, 11, 31));

  // Only an allowance actually paid counts. One that is approved but not yet paid ('GL Scheduled',
  // paid on the leave's start date) or whose posting failed counts as not paid: the settlement adds
  // the months worked, and the leave module holds the payment while the settlement is open and stops
  // it on final approval (see stopScheduledLeaveAllowances), so it is never paid on top.
  const leaves = await prisma.$queryRaw`
    SELECT el.date_start, el.leave_name, el.allowance_status, el.amount, lt.name AS leave_type_name
      FROM employeeleaves el LEFT JOIN leavetypes lt ON lt.id = el.leave_type
     WHERE el.employee = ${emp}
       AND el.allowance_status IN ('Paid', 'GL Scheduled', 'Failed GL Posting')
       AND el.date_start >= ${from} AND el.date_start <= ${to}
     ORDER BY el.date_start`;
  const paid = leaves.find(l => l.allowance_status === 'Paid');
  const pending = leaves.find(l => l.allowance_status !== 'Paid');
  const nameOf = (l) => l.leave_type_name || l.leave_name || 'leave';
  const leave_paid = paid
    ? { value: true, amount: Number(paid.amount) || 0, note: `Leave module: allowance of ${fmtMoney(paid.amount)} paid with ${nameOf(paid)} starting ${fmtDay(paid.date_start)}` }
    : {
        value: false,
        note: pending
          ? `Leave module: an allowance of ${fmtMoney(pending.amount)} for ${nameOf(pending)} starting ${fmtDay(pending.date_start)} is ${pending.allowance_status === 'GL Scheduled' ? 'scheduled' : 'in a failed posting'}, not paid. It is held while this settlement is open and stopped when it is approved.`
          : `Leave module: no leave allowance paid in ${year}`,
      };

  // status is an enum on Postgres; CONCAT turns it into text so the literal list compares on both databases.
  const [run] = await prisma.$queryRaw`
    SELECT pr.name, CONCAT(pr.status, '') AS status
      FROM payrollruns pr
     WHERE CONCAT(pr.status, '') IN ('Completed', 'Bank Pending')
       AND pr.date_start <= ${effective} AND pr.date_end >= ${effective}
       AND EXISTS (SELECT 1 FROM payrolldata pd WHERE pd.payroll = pr.id AND pd.employee = ${emp})
     ORDER BY pr.date_end DESC LIMIT 1`.catch(() => []);
  const salary_paid = run
    ? { value: true, note: `Payroll: paid in "${run.name}" (${run.status})` }
    : { value: false, note: 'Payroll: no paid run covering the effective date includes this employee' };

  let notice_given = null;
  if (notified) {
    const due = new Date(notified); due.setUTCMonth(due.getUTCMonth() + noticeMonths);
    notice_given = due <= effective
      ? { value: true, note: `Dates: notified ${fmtDay(notified)}, at least ${noticeMonths} month${noticeMonths === 1 ? '' : 's'} before the effective date` }
      : { value: false, note: `Dates: notified ${fmtDay(notified)}; ${noticeMonths} month${noticeMonths === 1 ? "'s" : "s'"} notice ends ${fmtDay(due)}, after the effective date` };
  }
  return { leave_paid, salary_paid, notice_given };
}

/**
 * Work out a settlement for an employee. `input` holds the exit details and the HR answers
 * (notice given, salary/leave/rent/clothing paid this year, an Annual Gross override). Returns the
 * benefit, the suggested additions and deductions, and warnings for anything set up incompletely —
 * or { error }.
 */
async function computeSettlement(emp, input, settings) {
  const reason = String(input.exit_reason ?? '').trim();
  if (!EXIT_REASONS.includes(reason)) return { error: `Choose the reason for leaving (${EXIT_REASONS.join(', ')})` };
  const effective = parseDay(input.effective_date);
  if (!effective) return { error: 'The effective date of the exit is required (YYYY-MM-DD)' };
  const hire = parseDay(isoDay(emp.hire_date));
  if (!hire) return { error: `${emp.employee_name} has no hire date on record, so years of service cannot be counted. Add it to their employee profile first.` };
  if (hire > effective) return { error: 'The effective date is before the hire date' };

  const warnings = [];
  const divisor = Number(settings.eos_divisor) || 261;
  const minMonths = Number(settings.eos_min_service_months) || 0;
  const roundUp = Number(settings.eos_round_up_months) || 6;

  const service = serviceBetween(hire, effective);
  let counted = service.years + (service.months >= roundUp ? 1 : 0);
  if (service.total < minMonths) counted = 0;

  const bands = await readBands();
  const band = counted > 0 ? bands.find(b => b.up_to_years == null || counted <= b.up_to_years) : null;
  if (counted > 0 && !band) warnings.push('No service band covers this length of service. Check the bands in Setup.');
  const daysPerYear = band ? band.days_per_year : 0;

  const salary = await salaryFor(emp.id);
  const grossIds = parseList(settings.eos_gross_components);
  let monthlyGross, grossParts;
  if (grossIds.length) {
    ({ total: monthlyGross, parts: grossParts } = sumComponents(salary, grossIds));
  } else {
    monthlyGross = salary.basic;
    grossParts = salary.basic ? [{ name: 'Basic salary', amount: salary.basic }] : [];
    warnings.push('The salary components that make up Annual Gross are not chosen yet, so only the basic salary is used. Choose them in Setup → Calculation.');
  }
  const computedGross = round2(monthlyGross * 12);
  const override = input.annual_gross !== undefined && input.annual_gross !== null && String(input.annual_gross).trim() !== '';
  const annualGross = override ? round2(Number(input.annual_gross)) : computedGross;
  if (override && !(annualGross >= 0)) return { error: 'Annual Gross must be zero or a positive amount' };
  if (!annualGross) warnings.push('Annual Gross is zero. Check the employee\'s salary, or enter the Annual Gross.');

  const ineligible = parseList(settings.eos_ineligible_reasons);
  const eligible = !ineligible.includes(reason);
  // Cut off, not rounded, as the Bank's sheet does: 104,781.36 × 5 × 33 ÷ 261 = 66,241.0896 → 66,241.08.
  const eosb = eligible ? trunc2(annualGross * counted * daysPerYear / divisor) : 0;

  // Additions and deductions. Months are counted on the exit month: leaving in September, 9 months
  // were worked and October–December (3) were not.
  const exitMonth = effective.getUTCMonth() + 1;
  const worked = exitMonth, notWorked = 12 - exitMonth;
  const lines = [];
  const add = (line_type, item_code, description, basis, amount) => {
    if (amount > 0) lines.push({ line_type, item_code, description, basis, amount: round2(amount), gl_account: '' });
  };
  const monthlyOf = (annual) => trunc2(annual / 12);

  // HR's answer wins when given; otherwise the system's records, otherwise the default.
  const noticeMonths = Number(settings.eos_notice_months) || 1;
  const notified = parseDay(input.notified_date);
  const checks = await systemChecks(emp.id, effective, notified, noticeMonths);
  const given = (k) => input[k] !== undefined && input[k] !== null && input[k] !== '';
  const answer = (k, fallback) => (given(k) ? toBool(input[k]) : checks[k] ? checks[k].value : fallback);

  const leavePaid = answer('leave_paid', false);
  // When the leave module has paid the allowance, recover from that amount; otherwise work out the
  // year's allowance the way the leave module does.
  const leaveAnnual = leavePaid && checks.leave_paid?.amount > 0 ? round2(checks.leave_paid.amount) : await annualLeaveAllowance(salary.basic);
  if (leaveAnnual > 0) {
    const m = monthlyOf(leaveAnnual);
    if (leavePaid) add('deduction', 'leave_allowance', 'Leave allowance not earned', `${fmtMoney(leaveAnnual)} ÷ 12 × ${notWorked} month${notWorked === 1 ? '' : 's'} not worked`, trunc2(m * notWorked));
    else           add('addition',  'leave_allowance', 'Leave allowance earned, not paid', `${fmtMoney(leaveAnnual)} ÷ 12 × ${worked} month${worked === 1 ? '' : 's'} worked`, trunc2(m * worked));
  }

  const annualBasis = settings.eos_allowance_basis === 'annual';
  const allowanceAnnual = (key) => {
    const { total } = sumComponents(salary, parseList(settings[key]));
    return round2(annualBasis ? total : total * 12);
  };
  const rentPaid = input.rent_paid !== undefined ? toBool(input.rent_paid) : true;
  const rentAnnual = allowanceAnnual('eos_rent_components');
  if (rentAnnual > 0) {
    const m = monthlyOf(rentAnnual);
    if (rentPaid) add('deduction', 'rent_allowance', 'Rent allowance not earned', `${fmtMoney(rentAnnual)} ÷ 12 × ${notWorked} month${notWorked === 1 ? '' : 's'} not worked`, trunc2(m * notWorked));
    else          add('addition',  'rent_allowance', 'Rent allowance earned, not paid', `${fmtMoney(rentAnnual)} ÷ 12 × ${worked} month${worked === 1 ? '' : 's'} worked`, trunc2(m * worked));
  } else if (!parseList(settings.eos_rent_components).length) {
    warnings.push('The rent allowance component is not chosen in Setup → Calculation, so no rent line was suggested.');
  }

  const clothingPaid = input.clothing_paid !== undefined ? toBool(input.clothing_paid) : false;
  const clothingAnnual = allowanceAnnual('eos_clothing_components');
  if (clothingAnnual > 0 && !clothingPaid) {
    add('addition', 'clothing_allowance', 'Clothing allowance earned, not paid', `${fmtMoney(clothingAnnual)} ÷ 12 × ${worked} month${worked === 1 ? '' : 's'} worked`, trunc2(monthlyOf(clothingAnnual) * worked));
  }

  const noticeGiven = answer('notice_given', true);
  const salaryPaid  = answer('salary_paid', false);
  const monthlySalary = settings.eos_salary_basis === 'gross' ? monthlyOf(annualGross) : round2(salary.basic);
  if (!salaryPaid) {
    if (noticeGiven) add('addition', 'final_salary', "Final month's salary", 'Notice given — salary for the final month', monthlySalary);
    else add('deduction', 'notice_pay', 'Salary in lieu of notice', `Notice not given — ${noticeMonths} month${noticeMonths === 1 ? "'s" : "s'"} salary`, round2(monthlySalary * noticeMonths));
  }

  const [pf] = await prisma.$queryRaw`SELECT amount FROM eos_pf_list WHERE employee = ${toBigInt(emp.id)}`.catch(() => []);
  if (pf && Number(s(pf.amount)) > 0) add('deduction', 'pf', 'Bank Provident Fund', 'Fixed amount on the PF list', Number(s(pf.amount)));

  return {
    reason, effective, hire, eligible,
    service_years: service.years, service_months: service.months, counted_years: counted,
    days_per_year: daysPerYear, divisor,
    annual_gross: annualGross, computed_gross: computedGross, gross_overridden: override, gross_parts: grossParts,
    eosb_amount: eosb, monthly_salary: monthlySalary,
    notice_given: noticeGiven, salary_paid: salaryPaid, leave_paid: leavePaid, rent_paid: rentPaid, clothing_paid: clothingPaid,
    checks, lines, warnings,
  };
}

/** Lines sent by the form, checked. Returns { lines } or { error }. */
function cleanLines(raw) {
  if (!Array.isArray(raw)) return { error: 'lines must be a list' };
  const lines = [];
  for (const [i, l] of raw.entries()) {
    const line_type = l?.line_type === 'addition' ? 'addition' : l?.line_type === 'deduction' ? 'deduction' : null;
    if (!line_type) return { error: `Line ${i + 1}: choose addition or deduction` };
    const description = String(l.description ?? '').trim();
    if (!description) return { error: `Line ${i + 1}: a description is required` };
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount < 0) return { error: `"${description}": the amount must be zero or a positive number` };
    const item_code = ITEM_CODES.includes(l.item_code) ? l.item_code : 'other';
    if (item_code === 'loan' && !String(l.gl_account ?? '').trim()) return { error: `"${description}": enter the loan account number` };
    lines.push({
      line_type, item_code, amount: round2(amount),
      description: description.slice(0, 255),
      basis: l.basis ? String(l.basis).slice(0, 255) : null,
      gl_account: String(l.gl_account ?? '').trim().slice(0, 50) || null,
    });
  }
  return { lines: lines.filter(l => l.amount > 0) };
}

const totalsOf = (eosb, lines) => {
  const additions  = round2(lines.filter(l => l.line_type === 'addition').reduce((t, l) => t + l.amount, 0));
  const deductions = round2(lines.filter(l => l.line_type === 'deduction').reduce((t, l) => t + l.amount, 0));
  return { additions, deductions, net: round2(eosb + additions - deductions) };
};

/** EOS-2026-0001, numbered per year. The unique key catches the rare race; the caller retries. */
async function nextNumber(year) {
  const prefix = `EOS-${year}-`;
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*) AS n FROM eos_settlements WHERE settlement_number LIKE ${prefix + '%'}`.catch(() => [{ n: 0 }]);
  return `${prefix}${String(Number(row?.n ?? 0) + 1).padStart(4, '0')}`;
}

async function writeLog(settlementId, userId, action, statusFrom, statusTo) {
  try {
    await prisma.$executeRaw`
      INSERT INTO eos_log (id, settlement_id, user_id, action, status_from, status_to, created_at)
      VALUES (${newId()}, ${toBigInt(settlementId)}, ${toBigInt(userId)}, ${String(action).slice(0, 500)},
              ${statusFrom ?? null}, ${statusTo ?? null}, NOW())`;
  } catch (err) {
    console.error(`[end of service] could not write history for ${settlementId} (${statusFrom} → ${statusTo}):`, err.message);
  }
}

const SETTLEMENT_SELECT = Prisma.sql`
  SELECT st.*,
         TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
         e.employee_id AS employee_code, e.lifecycleStatus AS lifecycle_status,
         jt.name AS job_title, b.title AS branch_name,
         TRIM(CONCAT_WS(' ', ce.firstName, ce.lastName)) AS created_by_name, cu.username AS created_by_username
    FROM eos_settlements st
    LEFT JOIN employee e  ON e.id  = st.employee
    LEFT JOIN jobtitles jt ON jt.id = e.jobTitleId
    LEFT JOIN companystructures b ON b.id = e.branchId
    LEFT JOIN users    cu ON cu.id = st.created_by
    LEFT JOIN employee ce ON ce.id = cu.employeeId`;

function normalise(row) {
  const r = s(row);
  for (const k of ['gross_overridden', 'eligible', 'notice_given', 'salary_paid', 'leave_paid', 'rent_paid', 'clothing_paid']) r[k] = toBool(r[k]);
  return r;
}

async function getRow(id) {
  const [row] = await prisma.$queryRaw`${SETTLEMENT_SELECT} WHERE st.id = ${toBigInt(id)}`.catch(() => []);
  return row ? normalise(row) : null;
}

async function loadLines(id) {
  const rows = await prisma.$queryRaw`
    SELECT id, line_type, item_code, description, basis, amount, gl_account, sort_order
      FROM eos_settlement_lines WHERE settlement_id = ${toBigInt(id)} ORDER BY sort_order, id`.catch(() => []);
  return s(rows).map(r => ({ ...r, id: String(r.id), amount: Number(r.amount) }));
}

async function loadStages(id) {
  const rows = await prisma.$queryRaw`
    SELECT st.id, st.stage_order, st.stage_name, st.approver_type, st.approver_id, st.approver_label,
           st.status, st.acted_at, st.comment, u.username AS acted_by_name
      FROM eos_settlement_stages st
      LEFT JOIN users u ON u.id = st.acted_by
     WHERE st.settlement_id = ${toBigInt(id)} ORDER BY st.stage_order`.catch(() => []);
  return s(rows).map(r => ({ ...r, id: String(r.id) }));
}

async function getFull(id) {
  const row = await getRow(id);
  if (!row) return null;
  return { ...row, lines: await loadLines(id), stages: await loadStages(id) };
}

async function replaceLines(tx, settlementId, lines) {
  await tx.$executeRaw`DELETE FROM eos_settlement_lines WHERE settlement_id = ${toBigInt(settlementId)}`;
  for (const [i, l] of lines.entries()) {
    await tx.$executeRaw`
      INSERT INTO eos_settlement_lines (id, settlement_id, line_type, item_code, description, basis, amount, gl_account, sort_order)
      VALUES (${newId()}, ${toBigInt(settlementId)}, ${l.line_type}, ${l.item_code}, ${l.description}, ${l.basis},
              ${l.amount}, ${l.gl_account}, ${i})`;
  }
}

/**
 * On final approval: the settlement has settled the leave allowance, so any allowance the leave
 * module still has scheduled (or failed) for this employee must never be paid. Returns how many.
 */
async function stopScheduledLeaveAllowances(employeeId) {
  return prisma.$executeRaw`
    UPDATE employeeleaves SET allowance_status = 'Stopped (End of Service)'
     WHERE employee = ${toBigInt(employeeId)} AND allowance_status IN ('GL Scheduled', 'Failed GL Posting')`;
}

// ── Approval flow ─────────────────────────────────────────────────────────────

async function readFlow() {
  const row = await prisma.settings
    .findFirst({ where: { name: FLOW_KEY, category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  if (!row?.value) return [];
  try {
    const arr = JSON.parse(row.value);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(st => st && String(st.name || '').trim() && ['role', 'user'].includes(st.approverType) && String(st.approverId ?? '').trim())
      .map(st => ({ name: String(st.name).trim(), approverType: st.approverType, approverId: String(st.approverId), approverLabel: st.approverLabel != null ? String(st.approverLabel) : null }));
  } catch { return []; }
}

/** Does this user satisfy the stage? A user stage by id; a role stage by role name or id. */
function matchesStage(req, stage) {
  if (stage.approver_type === 'user') return String(req.user?.id ?? '') === String(stage.approver_id);
  const roles = (req.user?.roles || []).map(String);
  return roles.includes(String(stage.approver_label)) || roles.includes(String(stage.approver_id));
}

function notifyStage(stage, row, req) {
  try {
    const payload = {
      message: `End of service settlement ${row.settlement_number} (${row.employee_name}) awaits your approval — ${stage.stage_name}`,
      action: 'ManageEndOfService', type: 'end_of_service', fromUser: req.user?.id, employee: row.employee,
    };
    if (stage.approver_type === 'user') notifyUser(stage.approver_id, payload);
    else notifyUsersWithRole(stage.approver_id, payload, req.user?.id, stage.approver_label);
  } catch { /* never block the settlement */ }
}

function notifyApprovers(row, req) {
  try {
    notifyUsersWithPermission('approve_end_of_service', {
      message: `End of service settlement ${row.settlement_number} (${row.employee_name}) awaits approval`,
      action: 'ManageEndOfService', type: 'end_of_service', fromUser: req.user?.id, employee: row.employee,
    }, req.user?.id);
  } catch { /* never block the settlement */ }
}

function notifyCreator(row, req, message) {
  try {
    if (row.created_by && String(row.created_by) !== String(req.user?.id ?? '')) {
      notifyUser(row.created_by, { message, action: 'ManageEndOfService', type: 'end_of_service', fromUser: req.user?.id, employee: row.employee });
    }
  } catch { /* never block the settlement */ }
}

/** The stage this user can act on now, true when the settlement has no stages and they may approve, else null. */
async function currentStageFor(req, row) {
  const stages = await loadStages(row.id);
  const pending = stages.filter(st => st.status === 'Pending');
  if (!stages.length) return canApprove(req) ? { stage: null, rest: [] } : null;
  if (!pending.length) return null;
  return matchesStage(req, pending[0]) ? { stage: pending[0], rest: pending.slice(1) } : null;
}

// ── GL posting ────────────────────────────────────────────────────────────────

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
const glDetail = (fail) => (fail ? { glError: fail.glError, glInvalidAccounts: fail.glInvalidAccounts, glImbalance: fail.glImbalance } : {});

/**
 * Post an approved settlement. Returns { skipped } when postings are off or nothing is owed either
 * way, { documentRef } on success, { glFail } on failure; the settlement is left Paid or GL Failed.
 */
async function postToLedger(id, req) {
  const row = await getRow(id);
  const lines = await loadLines(id);
  const settings = await readSettings();
  const cfg = await getApiConfig();
  if (settings.eos_payments_enabled !== 'Yes' || !cfg.gl_url) return { skipped: true };
  const eosb = round2(row.eosb_amount);
  if (!(eosb > 0) && !lines.length) return { skipped: true };
  let extra = {};
  try { extra = JSON.parse(cfg.gl_extra || '{}'); } catch { /* ignore */ }

  const emp = await loadEmployee(row.employee);
  const prevStatus = row.status;
  try {
    // The account is read now: a corrected account number on the employee's record is used on a retry.
    const account = emp?.bank_account || '';
    const glOf = (l) => l.gl_account || settings[ITEM_GL_KEY[l.item_code]] || '';
    const missing = [];
    if (!account) missing.push("the employee's bank account (on their employee profile)");
    if (eosb > 0 && !settings.eos_expense_gl) missing.push('the EOSB expense GL account (Settings → Controls → Medical & GL → GL Posting — End of Service)');
    for (const l of lines) if (!glOf(l)) missing.push(`the GL account for "${l.description}"`);
    if (missing.length) throw new Error(`GL posting not attempted — missing ${missing.join(', ')}. Nothing was sent to the GL.`);

    const branch   = settings.eos_gl_branch || extra.branch || '000';
    const currency = await getSystemCurrency(extra.currency);
    const employeeCode = emp?.employee_code || undefined;
    const ref = String(row.settlement_number);
    const debit  = (n, accountNo, amount, narration) => ({
      debitAmount: amount, debitAccount: accountNo, debitCurrency: currency, debitNarration: narration,
      debitProdRef: `BS_EOS_${ref}_${n}`, debitBranch: branch, ...(employeeCode ? { employeeCode } : {}),
    });
    const credit = (n, accountNo, amount, narration) => ({
      creditAmount: amount, creditAccount: accountNo, creditCurrency: currency, creditNarration: narration,
      creditProdRef: `NS_EOS_${ref}_${n}`, creditBranch: branch, ...(employeeCode ? { employeeCode } : {}),
    });

    const debitAccounts = [], creditAccounts = [];
    let n = 0;
    if (eosb > 0) {
      n++;
      const narr = ['End of Service Benefit', row.employee_name].filter(Boolean).join(' - ');
      debitAccounts.push(debit(n, settings.eos_expense_gl, eosb, narr));
      creditAccounts.push(credit(n, account, eosb, narr));
    }
    for (const l of lines) {
      n++;
      const narr = [l.description, row.employee_name].filter(Boolean).join(' - ').slice(0, 100);
      if (l.line_type === 'addition') {
        debitAccounts.push(debit(n, glOf(l), round2(l.amount), narr));
        creditAccounts.push(credit(n, account, round2(l.amount), narr));
      } else {
        debitAccounts.push(debit(n, account, round2(l.amount), narr));
        creditAccounts.push(credit(n, glOf(l), round2(l.amount), narr));
      }
    }

    const referenceNo = `EO${ref.replace(/\D/g, '')}${String(Date.now()).slice(-7)}`;
    const result = await postToGL({
      approvedBy: req.user?.username || 'System',
      referenceNo,
      description: `End of service settlement - ${row.employee_name} - ${row.exit_reason}`,
      branch, debitAccounts, creditAccounts,
    });

    await prisma.$executeRaw`
      UPDATE eos_settlements
         SET status = 'Paid', document_ref = ${String(result.documentRef ?? referenceNo).slice(0, 100)},
             payment_log = ${JSON.stringify(result.raw ?? {})}, posted_at = NOW(), account_no = ${account}, updated_at = NOW()
       WHERE id = ${toBigInt(id)}`;
    await writeLog(id, req.user?.id, `Posted to the GL — reference ${result.documentRef ?? referenceNo}`, prevStatus, 'Paid');
    return { documentRef: result.documentRef ?? referenceNo };
  } catch (e) {
    const fail = glFailure(e);
    await prisma.$executeRaw`
      UPDATE eos_settlements SET status = 'GL Failed', payment_log = ${JSON.stringify(fail.log)}, updated_at = NOW()
       WHERE id = ${toBigInt(id)}`.catch(() => {});
    await writeLog(id, req.user?.id, `GL posting failed: ${String(fail.glError || '').slice(0, 400)}`, prevStatus, 'GL Failed');
    console.error(`[end of service] GL posting failed for ${row.settlement_number}:`, fail.glError);
    return { glFail: fail };
  }
}

function postingOutcome(res, post, row, prefix = null) {
  if (post.documentRef) return respond.ok(res, `${prefix ? `${prefix} and posted` : 'Posted'} — GL reference ${post.documentRef}`, row);
  if (post.glFail) return res.status(200).json({
    status: '200', message: `${prefix ? `${prefix}, but the` : 'The'} GL posting failed: ${post.glFail.glError}`, data: row, ...glDetail(post.glFail),
  });
  return respond.ok(res, `${prefix ?? 'Approved'}. Postings are switched off or there is nothing to post, so nothing was sent to the GL.`, row);
}

// ══════════════════════════════════════════════════════════════════════════════
// SETUP
// ══════════════════════════════════════════════════════════════════════════════

// GET /end-of-service/settings — calculation rules, letter wording, GL accounts and the postings switch.
exports.getSettings = asyncHandler(async (_req, res) => {
  respond.ok(res, 'End of service settings', { ...(await readSettings()), exit_reasons: EXIT_REASONS });
});

// PUT /end-of-service/settings — save any of the setting keys.
exports.saveSettings = asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.eos_payments_enabled !== undefined && !['Yes', 'No'].includes(String(b.eos_payments_enabled))) return respond.badReq(res, 'eos_payments_enabled must be Yes or No');
  if (b.eos_salary_basis !== undefined && !['basic', 'gross'].includes(String(b.eos_salary_basis))) return respond.badReq(res, 'eos_salary_basis must be basic or gross');
  if (b.eos_allowance_basis !== undefined && !['monthly', 'annual'].includes(String(b.eos_allowance_basis))) return respond.badReq(res, 'eos_allowance_basis must be monthly or annual');
  for (const [key, min] of [['eos_divisor', 1], ['eos_min_service_months', 0], ['eos_round_up_months', 1], ['eos_notice_months', 0]]) {
    if (b[key] === undefined) continue;
    const v = Number(b[key]);
    if (!Number.isFinite(v) || v < min) return respond.badReq(res, `${key} must be a number of at least ${min}`);
  }
  for (const key of JSON_LIST_KEYS) {
    if (b[key] === undefined) continue;
    const list = Array.isArray(b[key]) ? b[key] : parseList(b[key]);
    if (key === 'eos_ineligible_reasons' && list.some(r => !EXIT_REASONS.includes(r))) return respond.badReq(res, 'Unknown reason for leaving');
    b[key] = JSON.stringify(list.map(String));
  }
  await prisma.$transaction(async (tx) => {
    for (const key of SETTING_KEYS) {
      if (b[key] === undefined) continue;
      await upsertSetting(tx, key, SETTINGS_CAT, String(b[key] ?? '').trim());
    }
  }, TX_OPTS);
  logActivity({ module: 'End of Service', action: 'update_settings', details: Object.keys(b), ...fromReq(req) });
  respond.ok(res, 'End of service settings saved', { ...(await readSettings()), exit_reasons: EXIT_REASONS });
});

// GET /end-of-service/components — salary components, for choosing Annual Gross, rent and clothing.
exports.getComponents = asyncHandler(async (_req, res) => {
  const rows = await prisma.$queryRaw`SELECT id, name FROM salarycomponent ORDER BY name`.catch(() => []);
  respond.ok(res, 'Salary components', s(rows).map(r => ({ id: String(r.id), name: r.name })));
});

// GET /end-of-service/bands
exports.getBands = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Service bands', await readBands());
});

// PUT /end-of-service/bands — { bands: [{ up_to_years, days_per_year }] }, replacing them all. The
// bands must rise, and exactly the last one is open-ended (up_to_years blank).
exports.saveBands = asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body?.bands) ? req.body.bands : null;
  if (!raw || !raw.length) return respond.badReq(res, 'Add at least one band');
  const bands = raw.map(b => ({
    up_to: b.up_to_years === null || b.up_to_years === undefined || String(b.up_to_years).trim() === '' ? null : Number(b.up_to_years),
    days: Number(b.days_per_year),
  }));
  for (const [i, b] of bands.entries()) {
    if (!Number.isFinite(b.days) || b.days < 0) return respond.badReq(res, `Band ${i + 1}: days per year must be zero or more`);
    if (b.up_to !== null && (!Number.isInteger(b.up_to) || b.up_to < 1)) return respond.badReq(res, `Band ${i + 1}: "up to" must be a whole number of years`);
    if (i < bands.length - 1 && b.up_to === null) return respond.badReq(res, 'Only the last band can be open-ended');
    if (i > 0 && b.up_to !== null && b.up_to <= bands[i - 1].up_to) return respond.badReq(res, 'Each band must cover more years than the one before it');
  }
  if (bands[bands.length - 1].up_to !== null) return respond.badReq(res, 'The last band must be open-ended, to cover longer service');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM eos_bands`;
    for (const b of bands) {
      await tx.$executeRaw`
        INSERT INTO eos_bands (id, up_to_years, days_per_year, updated_by, updated_at)
        VALUES (${newId()}, ${b.up_to}, ${b.days}, ${toBigInt(req.user?.id)}, NOW())`;
    }
  }, TX_OPTS);
  logActivity({ module: 'End of Service', action: 'update_bands', details: bands, ...fromReq(req) });
  respond.ok(res, 'Service bands saved', await readBands());
});

// GET /end-of-service/pf — the Provident Fund list.
exports.getPfList = asyncHandler(async (_req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT p.id, p.employee, p.amount, p.note, p.updated_at,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name, e.employee_id AS employee_code
      FROM eos_pf_list p LEFT JOIN employee e ON e.id = p.employee
     ORDER BY e.firstName, e.lastName`.catch(() => []);
  respond.ok(res, 'Provident Fund list', s(rows).map(r => ({ ...r, id: String(r.id), employee: String(r.employee), amount: Number(r.amount) })));
});

// POST /end-of-service/pf — { employee, amount, note? }: add an employee, or change their amount.
exports.savePf = asyncHandler(async (req, res) => {
  const emp = await loadEmployee(req.body?.employee);
  if (!emp) return respond.badReq(res, 'Choose the employee');
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return respond.badReq(res, 'The amount must be more than zero');
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 255) : null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM eos_pf_list WHERE employee = ${toBigInt(emp.id)}`;
    await tx.$executeRaw`
      INSERT INTO eos_pf_list (id, employee, amount, note, updated_by, updated_at)
      VALUES (${newId()}, ${toBigInt(emp.id)}, ${round2(amount)}, ${note}, ${toBigInt(req.user?.id)}, NOW())`;
  }, TX_OPTS);
  logActivity({ module: 'End of Service', action: 'save_pf', entityId: emp.id, entityName: emp.employee_name, details: { amount }, ...fromReq(req) });
  respond.ok(res, `${emp.employee_name} saved on the Provident Fund list`);
});

// DELETE /end-of-service/pf/:id
exports.deletePf = asyncHandler(async (req, res) => {
  await prisma.$executeRaw`DELETE FROM eos_pf_list WHERE id = ${toBigInt(req.params.id)}`;
  logActivity({ module: 'End of Service', action: 'delete_pf', entityId: String(req.params.id), ...fromReq(req) });
  respond.ok(res, 'Removed from the Provident Fund list');
});

// GET /end-of-service/approval-flow
exports.getApprovalFlow = asyncHandler(async (_req, res) => {
  respond.ok(res, 'End of service approval flow', await readFlow());
});

// PUT /end-of-service/approval-flow — { stages: [{ name, approverType: role|user, approverId, approverLabel }] }
exports.saveApprovalFlow = asyncHandler(async (req, res) => {
  const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const clean = [];
  for (const st of stages) {
    const name = String(st?.name || '').trim();
    if (!name) return respond.badReq(res, 'Every stage needs a name');
    if (!['role', 'user'].includes(st.approverType)) return respond.badReq(res, `Stage "${name}" has an invalid approver type`);
    if (st.approverId == null || String(st.approverId).trim() === '') return respond.badReq(res, `Stage "${name}" needs an approver`);
    clean.push({ name: name.slice(0, 100), approverType: st.approverType, approverId: String(st.approverId), approverLabel: st.approverLabel != null ? String(st.approverLabel) : null });
  }
  await upsertSetting(null, FLOW_KEY, 'app_controls', JSON.stringify(clean));
  logActivity({ module: 'End of Service', action: 'save_approval_flow', entityName: `${clean.length} stage(s)`, ...fromReq(req) });
  respond.ok(res, 'End of service approval flow saved', clean);
});

// ══════════════════════════════════════════════════════════════════════════════
// SETTLEMENTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /end-of-service/employees — every employee, with any settlement already raised for them.
exports.getEmployees = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'You do not have access to raise end of service settlements');
  const rows = await prisma.$queryRaw`
    SELECT e.id, e.employee_id AS employee_code, TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.status, e.lifecycleStatus AS lifecycle_status, e.hireDate AS hire_date, e.termination_date,
           (SELECT st.settlement_number FROM eos_settlements st
             WHERE st.employee = e.id AND st.status NOT IN (${Prisma.join(CLOSED_STATUSES)}) LIMIT 1) AS open_settlement
      FROM employee e
     ORDER BY e.firstName, e.lastName`.catch(() => []);
  respond.ok(res, 'Employees', s(rows).map(r => ({ ...r, id: String(r.id) })));
});

// POST /end-of-service/quote — the exit details → the benefit and the suggested lines, for the form.
exports.quote = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'You do not have access to raise end of service settlements');
  const emp = await loadEmployee(req.body?.employee);
  if (!emp) return respond.badReq(res, 'Choose the employee');
  const q = await computeSettlement(emp, req.body, await readSettings());
  if (q.error) return respond.badReq(res, q.error);
  respond.ok(res, 'Quote', {
    ...q, effective: undefined, hire: undefined, hire_date: isoDay(q.hire),
    account_no: emp.bank_account, branch: emp.branch_name || emp.branch_code,
  });
});

// GET /end-of-service/settlements?status=
exports.listSettlements = asyncHandler(async (req, res) => {
  if (!canView(req)) return respond.forbidden(res, 'You do not have access to end of service settlements');
  const where = req.query.status ? Prisma.sql`WHERE st.status = ${String(req.query.status)}` : Prisma.empty;
  const rows = await prisma.$queryRaw`${SETTLEMENT_SELECT} ${where} ORDER BY st.created_at DESC, st.id DESC`;
  respond.ok(res, 'Settlements', rows.map(normalise));
});

// GET /end-of-service/approvals — settlements awaiting the caller: the current stage is theirs, or
// there are no stages and they may approve. Never one they raised.
exports.listApprovals = asyncHandler(async (req, res) => {
  const rows = (await prisma.$queryRaw`${SETTLEMENT_SELECT} WHERE st.status = 'Pending Approval' ORDER BY st.submitted_at DESC, st.id DESC`).map(normalise);
  const mine = [];
  for (const row of rows) {
    if (String(row.created_by ?? '') === String(req.user?.id ?? '')) continue;
    const cur = await currentStageFor(req, row);
    if (cur) mine.push({ ...row, current_stage: cur.stage?.stage_name ?? null });
  }
  respond.ok(res, 'Approvals', mine);
});

// GET /end-of-service/settlements/:id — with its lines and approval stages.
exports.getSettlement = asyncHandler(async (req, res) => {
  const row = await getFull(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  const cur = row.status === 'Pending Approval' ? await currentStageFor(req, row) : null;
  if (!canView(req) && !cur) return respond.forbidden(res, 'You do not have access to this settlement');
  const salary = await salaryFor(row.employee);
  respond.ok(res, 'Settlement', { ...row, monthly_basic: salary.basic, can_decide: !!cur && String(row.created_by ?? '') !== String(req.user?.id ?? '') });
});

// GET /end-of-service/settlements/:id/history
exports.getHistory = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT l.id, l.action, l.status_from, l.status_to, l.created_at, u.username AS user_name,
           TRIM(CONCAT_WS(' ', ue.firstName, ue.lastName)) AS user_full_name
      FROM eos_log l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN employee ue ON ue.id = u.employeeId
     WHERE l.settlement_id = ${toBigInt(req.params.id)}
     ORDER BY l.created_at, l.id`.catch(() => []);
  respond.ok(res, 'History', s(rows).map(r => ({ ...r, id: String(r.id) })));
});

/** Validate the body, work out the settlement and return what to store, or { error }. */
async function prepare(emp, body) {
  const settings = await readSettings();
  const q = await computeSettlement(emp, body, settings);
  if (q.error) return q;
  const { lines, error } = body.lines !== undefined ? cleanLines(body.lines) : { lines: q.lines };
  if (error) return { error };
  const notified = body.notified_date ? parseDay(body.notified_date) : null;
  if (body.notified_date && !notified) return { error: 'The notified date must be a date (YYYY-MM-DD)' };
  return {
    q, lines, totals: totalsOf(q.eosb_amount, lines), notified,
    notes: body.notes ? String(body.notes).slice(0, 4000) : null,
    next_of_kin: body.next_of_kin ? String(body.next_of_kin).trim().slice(0, 150) : null,
  };
}

// POST /end-of-service/settlements — { employee, exit_reason, effective_date, notified_date?,
//   notice_given, salary_paid, leave_paid, rent_paid, clothing_paid, annual_gross?, lines?, notes?,
//   next_of_kin?, submit? }. Without lines the suggested ones are used.
exports.createSettlement = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'You do not have access to raise end of service settlements');
  const emp = await loadEmployee(req.body?.employee);
  if (!emp) return respond.badReq(res, 'Choose the employee');
  const [open] = await prisma.$queryRaw`
    SELECT settlement_number, status FROM eos_settlements
     WHERE employee = ${toBigInt(emp.id)} AND status NOT IN (${Prisma.join(CLOSED_STATUSES)}) LIMIT 1`.catch(() => []);
  if (open) return respond.badReq(res, `${emp.employee_name} already has settlement ${open.settlement_number} (${open.status}). Cancel it before raising another.`);

  const p = await prepare(emp, req.body);
  if (p.error) return respond.badReq(res, p.error);
  const { q, lines, totals } = p;
  const id = newId();
  for (let attempt = 0; ; attempt++) {
    const number = await nextNumber(q.effective.getUTCFullYear());
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO eos_settlements
            (id, settlement_number, employee, exit_reason, notified_date, effective_date, hire_date,
             service_years, service_months, counted_years, days_per_year, divisor, annual_gross, gross_overridden,
             eligible, eosb_amount, total_additions, total_deductions, net_amount,
             notice_given, salary_paid, leave_paid, rent_paid, clothing_paid,
             account_no, branch, next_of_kin, notes, status, created_by, created_at, updated_at)
          VALUES (${id}, ${number}, ${toBigInt(emp.id)}, ${q.reason}, ${p.notified}, ${q.effective}, ${q.hire},
                  ${q.service_years}, ${q.service_months}, ${q.counted_years}, ${q.days_per_year}, ${q.divisor},
                  ${q.annual_gross}, ${q.gross_overridden}, ${q.eligible}, ${q.eosb_amount},
                  ${totals.additions}, ${totals.deductions}, ${totals.net},
                  ${q.notice_given}, ${q.salary_paid}, ${q.leave_paid}, ${q.rent_paid}, ${q.clothing_paid},
                  ${emp.bank_account ?? null}, ${emp.branch_name || emp.branch_code || null}, ${p.next_of_kin}, ${p.notes},
                  'Draft', ${toBigInt(req.user?.id)}, NOW(), NOW())`;
        await replaceLines(tx, id, lines);
      }, TX_OPTS);
      break;
    } catch (e) {
      if (attempt < 4 && /unique|duplicate/i.test(String(e.message))) continue;
      throw e;
    }
  }
  await writeLog(id, req.user?.id, `Settlement raised — ${q.reason}, effective ${isoDay(q.effective)}`, null, 'Draft');
  logActivity({ module: 'End of Service', action: 'create', entityId: String(id), entityName: emp.employee_name, ...fromReq(req) });
  if (req.body.submit) {
    const msg = await submitSettlement(String(id), req);
    return respond.created(res, msg, await getFull(id));
  }
  respond.created(res, 'Settlement saved as a draft', await getFull(id));
});

// PUT /end-of-service/settlements/:id — edit a Draft; the benefit is worked out again.
exports.updateSettlement = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'You do not have access to change end of service settlements');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft settlements can be edited');
  const emp = await loadEmployee(row.employee);
  const body = {
    exit_reason: row.exit_reason, effective_date: isoDay(row.effective_date), notified_date: isoDay(row.notified_date),
    notice_given: row.notice_given, salary_paid: row.salary_paid, leave_paid: row.leave_paid, rent_paid: row.rent_paid,
    clothing_paid: row.clothing_paid, annual_gross: row.gross_overridden ? row.annual_gross : undefined,
    notes: row.notes, next_of_kin: row.next_of_kin,
    // An edit that does not send lines keeps the ones on the settlement (loans included).
    lines: (await loadLines(row.id)).map(({ line_type, item_code, description, basis, amount, gl_account }) => ({ line_type, item_code, description, basis, amount, gl_account })),
    ...req.body,
  };
  const p = await prepare(emp, body);
  if (p.error) return respond.badReq(res, p.error);
  const { q, lines, totals } = p;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE eos_settlements
         SET exit_reason = ${q.reason}, notified_date = ${p.notified}, effective_date = ${q.effective}, hire_date = ${q.hire},
             service_years = ${q.service_years}, service_months = ${q.service_months}, counted_years = ${q.counted_years},
             days_per_year = ${q.days_per_year}, divisor = ${q.divisor}, annual_gross = ${q.annual_gross},
             gross_overridden = ${q.gross_overridden}, eligible = ${q.eligible}, eosb_amount = ${q.eosb_amount},
             total_additions = ${totals.additions}, total_deductions = ${totals.deductions}, net_amount = ${totals.net},
             notice_given = ${q.notice_given}, salary_paid = ${q.salary_paid}, leave_paid = ${q.leave_paid},
             rent_paid = ${q.rent_paid}, clothing_paid = ${q.clothing_paid},
             account_no = ${emp.bank_account ?? null}, branch = ${emp.branch_name || emp.branch_code || null},
             next_of_kin = ${p.next_of_kin}, notes = ${p.notes}, updated_at = NOW()
       WHERE id = ${toBigInt(row.id)}`;
    await replaceLines(tx, row.id, lines);
  }, TX_OPTS);
  logActivity({ module: 'End of Service', action: 'update', entityId: String(row.id), entityName: row.settlement_number, ...fromReq(req) });
  respond.ok(res, 'Settlement updated', await getFull(row.id));
});

// DELETE /end-of-service/settlements/:id — remove a Draft.
exports.deleteSettlement = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'You do not have access to delete end of service settlements');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft settlements can be deleted. Cancel it instead.');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM eos_settlement_lines WHERE settlement_id = ${toBigInt(row.id)}`;
    await tx.$executeRaw`DELETE FROM eos_settlement_stages WHERE settlement_id = ${toBigInt(row.id)}`;
    await tx.$executeRaw`DELETE FROM eos_log WHERE settlement_id = ${toBigInt(row.id)}`;
    await tx.$executeRaw`DELETE FROM eos_settlements WHERE id = ${toBigInt(row.id)}`;
  }, TX_OPTS);
  logActivity({ module: 'End of Service', action: 'delete', entityId: String(row.id), entityName: row.settlement_number, ...fromReq(req) });
  respond.ok(res, 'Settlement deleted');
});

/** Send a Draft for approval: copy the configured stages onto it and notify the first approver. */
async function submitSettlement(id, req) {
  const row = await getRow(id);
  const flow = await readFlow();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM eos_settlement_stages WHERE settlement_id = ${toBigInt(id)}`;
    for (const [i, st] of flow.entries()) {
      await tx.$executeRaw`
        INSERT INTO eos_settlement_stages (id, settlement_id, stage_order, stage_name, approver_type, approver_id, approver_label, status)
        VALUES (${newId()}, ${toBigInt(id)}, ${i}, ${st.name}, ${st.approverType}, ${st.approverId}, ${st.approverLabel}, 'Pending')`;
    }
    await tx.$executeRaw`
      UPDATE eos_settlements SET status = 'Pending Approval', submitted_at = NOW(), rejection_reason = NULL, updated_at = NOW()
       WHERE id = ${toBigInt(id)}`;
  }, TX_OPTS);
  await writeLog(id, req.user?.id, flow.length ? `Submitted — ${flow.length} approval stage${flow.length === 1 ? '' : 's'}` : 'Submitted for approval', row.status, 'Pending Approval');
  if (flow.length) {
    const [first] = await loadStages(id);
    notifyStage(first, row, req);
  } else {
    notifyApprovers(row, req);
  }
  return flow.length ? `Settlement submitted — awaiting "${flow[0].name}"` : 'Settlement submitted for approval';
}

// POST /end-of-service/settlements/:id/submit
exports.submit = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'You do not have access to submit end of service settlements');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  if (row.status !== 'Draft') return respond.badReq(res, 'Only Draft settlements can be submitted');
  const msg = await submitSettlement(row.id, req);
  respond.ok(res, msg, await getFull(row.id));
});

// POST /end-of-service/settlements/:id/approve — { comment? }. Clears the current stage; the last
// one approves the settlement, marks the employee as exited and posts it.
exports.approve = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  if (row.status !== 'Pending Approval') return respond.badReq(res, `This settlement is ${row.status} and is not awaiting approval`);
  if (String(row.created_by ?? '') === String(req.user?.id ?? '')) return respond.forbidden(res, 'You raised this settlement, so a different approver must approve it');
  const cur = await currentStageFor(req, row);
  if (!cur) {
    const stages = (await loadStages(row.id)).filter(st => st.status === 'Pending');
    return respond.forbidden(res, stages.length
      ? `Only ${stages[0].approver_label || 'the assigned approver'} can approve the "${stages[0].stage_name}" stage`
      : 'You do not have permission to approve end of service settlements');
  }
  const comment = req.body?.comment ? String(req.body.comment).trim().slice(0, 500) : null;
  if (cur.stage) {
    await prisma.$executeRaw`
      UPDATE eos_settlement_stages SET status = 'Approved', acted_by = ${toBigInt(req.user?.id)}, acted_at = NOW(), comment = ${comment}
       WHERE id = ${toBigInt(cur.stage.id)}`;
    if (cur.rest.length) {
      await writeLog(row.id, req.user?.id, `"${cur.stage.stage_name}" approved — awaiting "${cur.rest[0].stage_name}"`, row.status, row.status);
      notifyStage(cur.rest[0], row, req);
      logActivity({ module: 'End of Service', action: 'approve_stage', entityId: String(row.id), entityName: row.settlement_number, details: { stage: cur.stage.stage_name }, ...fromReq(req) });
      return respond.ok(res, `"${cur.stage.stage_name}" approved — awaiting "${cur.rest[0].stage_name}"`, await getFull(row.id));
    }
  }

  await prisma.$executeRaw`
    UPDATE eos_settlements SET status = 'Approved', approved_by = ${toBigInt(req.user?.id)}, approved_at = NOW(), updated_at = NOW()
     WHERE id = ${toBigInt(row.id)}`;
  await writeLog(row.id, req.user?.id, cur.stage ? `"${cur.stage.stage_name}" approved — final approval` : 'Approved', row.status, 'Approved');
  logActivity({ module: 'End of Service', action: 'approve', entityId: String(row.id), entityName: row.settlement_number, ...fromReq(req) });

  // The exit is confirmed: mark the employee as exited (unless Employees already did).
  const exit = await applyEmployeeExit(row.employee, {
    action: row.exit_reason === 'Resignation' ? 'RESIGNED' : 'TERMINATED',
    reason: `End of service: ${row.exit_reason}`,
    effectiveDate: isoDay(row.effective_date),
  }, req).catch(e => ({ applied: false, message: e.message }));
  if (exit.applied) await prisma.$executeRaw`UPDATE eos_settlements SET exit_applied_at = NOW() WHERE id = ${toBigInt(row.id)}`.catch(() => {});
  await writeLog(row.id, req.user?.id, exit.applied ? exit.message : `Employee status not changed: ${exit.message}`, 'Approved', 'Approved');
  const stopped = await stopScheduledLeaveAllowances(row.employee).catch(e => { console.error('[end of service] could not stop leave allowances:', e.message); return 0; });
  if (stopped) await writeLog(row.id, req.user?.id, `Stopped ${stopped} scheduled leave allowance${stopped === 1 ? '' : 's'} — settled here instead`, 'Approved', 'Approved');
  notifyCreator(row, req, `End of service settlement ${row.settlement_number} (${row.employee_name}) was approved`);

  const post = await postToLedger(row.id, req);
  postingOutcome(res, post, await getFull(row.id), 'Settlement approved');
});

// POST /end-of-service/settlements/:id/reject — { reason }
exports.reject = asyncHandler(async (req, res) => {
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  if (row.status !== 'Pending Approval') return respond.badReq(res, `This settlement is ${row.status} and is not awaiting approval`);
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) return respond.badReq(res, 'A reason is required to reject a settlement');
  const cur = await currentStageFor(req, row);
  if (!cur) return respond.forbidden(res, 'You cannot act on this settlement at its current stage');
  if (cur.stage) {
    await prisma.$executeRaw`
      UPDATE eos_settlement_stages SET status = 'Rejected', acted_by = ${toBigInt(req.user?.id)}, acted_at = NOW(), comment = ${reason.slice(0, 500)}
       WHERE id = ${toBigInt(cur.stage.id)}`;
  }
  await prisma.$executeRaw`
    UPDATE eos_settlements SET status = 'Rejected', rejection_reason = ${reason.slice(0, 500)}, approved_by = ${toBigInt(req.user?.id)}, updated_at = NOW()
     WHERE id = ${toBigInt(row.id)}`;
  await writeLog(row.id, req.user?.id, `Rejected${cur.stage ? ` at "${cur.stage.stage_name}"` : ''}: ${reason}`, row.status, 'Rejected');
  notifyCreator(row, req, `End of service settlement ${row.settlement_number} (${row.employee_name}) was rejected: ${reason}`);
  logActivity({ module: 'End of Service', action: 'reject', entityId: String(row.id), entityName: row.settlement_number, details: { reason }, ...fromReq(req) });
  respond.ok(res, 'Settlement rejected', await getFull(row.id));
});

// POST /end-of-service/settlements/:id/cancel — { reason? }. Not once it has been posted. Cancelling
// an approved settlement does not reinstate the employee.
exports.cancel = asyncHandler(async (req, res) => {
  if (!canManage(req)) return respond.forbidden(res, 'You do not have access to cancel end of service settlements');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  if (row.status === 'Paid' || row.document_ref) return respond.badReq(res, 'This settlement has been posted to the GL and cannot be cancelled');
  if (!['Draft', 'Pending Approval', 'Approved', 'GL Failed'].includes(row.status)) return respond.badReq(res, `A ${row.status} settlement cannot be cancelled`);
  const reason = String(req.body?.reason ?? '').trim();
  await prisma.$executeRaw`
    UPDATE eos_settlements SET status = 'Cancelled', rejection_reason = ${reason ? reason.slice(0, 500) : null}, updated_at = NOW()
     WHERE id = ${toBigInt(row.id)}`;
  await writeLog(row.id, req.user?.id, reason ? `Cancelled: ${reason}` : 'Cancelled', row.status, 'Cancelled');
  logActivity({ module: 'End of Service', action: 'cancel', entityId: String(row.id), entityName: row.settlement_number, ...fromReq(req) });
  respond.ok(res, row.exit_applied_at ? 'Settlement cancelled. The employee stays exited; reinstate them in Employees if needed.' : 'Settlement cancelled', await getFull(row.id));
});

// POST /end-of-service/settlements/:id/retry-gl — post a GL Failed settlement again.
// POST /end-of-service/settlements/:id/post     — post an Approved settlement that stopped there
//                                                 because postings were switched off.
async function repost(req, res, fromStatus, label) {
  if (!canManage(req) && !canApprove(req)) return respond.forbidden(res, 'You do not have access to post end of service settlements');
  const row = await getRow(req.params.id);
  if (!row) return respond.notFound(res, 'Settlement not found');
  if (row.status !== fromStatus) return respond.badReq(res, `Only ${fromStatus} settlements can be ${label}`);
  if (row.document_ref) return respond.badReq(res, `This settlement already has GL reference ${row.document_ref}; posting again would pay it twice`);
  const post = await postToLedger(row.id, req);
  if (post.skipped) return respond.badReq(res, 'Postings are switched off, no GL connection is configured, or there is nothing to post');
  logActivity({ module: 'End of Service', action: fromStatus === 'GL Failed' ? 'retry_gl' : 'post_gl', entityId: String(row.id), entityName: row.settlement_number, ...fromReq(req) });
  postingOutcome(res, post, await getFull(row.id));
}
exports.retryGL = asyncHandler((req, res) => repost(req, res, 'GL Failed', 'retried'));
exports.post    = asyncHandler((req, res) => repost(req, res, 'Approved', 'posted'));

// Exposed for tests.
exports._internal = { serviceBetween, trunc2, computeSettlement, totalsOf };
