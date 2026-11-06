// Managers on Leave report (HRM-R01): which managers are away for a date or date range, for the MD.
//
// A manager is an active employee who either
//   - has at least one active direct report (employee.supervisorId points at them), when
//     "Include staff with direct reports" is on (the default), or
//   - is on one of the management pay grades chosen in the report settings.
// "On leave" means an application whose dates overlap the range and whose status is Approved or a
// later approved state (GL Scheduled, Paid, GL Failed). Pending applications can be included.
//
// The report is shown under Admin Reports, can be emailed on demand, and is emailed every weekday
// at 07:30 (cronHelper) to the configured recipients when the daily email is switched on.
// Settings live in the `settings` table, category 'managers_on_leave'.
const { prisma }       = require('../helpers/dbQueryHelper');
const { Prisma }       = require('@prisma/client');
const asyncHandler     = require('../middleware/asyncHandler');
const respond          = require('../helpers/respondHelper');
const { upsertSetting } = require('../helpers/settingsHelper');
const { logActivity, fromReq } = require('./auditController');

const CATEGORY = 'managers_on_leave';
const DEFAULTS = {
  mol_include_direct_reports: 'Yes',
  mol_paygrades:              '',     // comma-separated paygrade ids
  mol_email_enabled:          '0',    // daily 07:30 email on weekdays
  mol_recipients:             '',     // comma-separated addresses, e.g. the MD
  mol_send_when_empty:        '0',    // also send on days no manager is away
};
const ON_LEAVE = ['Approved', 'GL Scheduled', 'Paid', 'GL Failed'];
const PENDING  = ['Pending Approval', 'Pending HR Approval'];

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dmy = v => { const [y, m, d] = String(v).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const isYmd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const toYmd = v => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

/** First weekday after the last day of leave. Public holidays are not skipped. */
function backOn(endYmd) {
  const d = new Date(`${endYmd}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Weekdays between two dates, both included — used when a leave has no day rows recorded. */
function weekdays(startYmd, endYmd) {
  let n = 0;
  for (const d = new Date(`${startYmd}T00:00:00Z`), e = new Date(`${endYmd}T00:00:00Z`); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++;
  }
  return n;
}

async function getConfig() {
  const rows = await prisma.settings.findMany({ where: { category: CATEGORY }, select: { name: true, value: true } }).catch(() => []);
  const cfg = { ...DEFAULTS };
  for (const r of rows) if (r.name in cfg) cfg[r.name] = r.value ?? '';
  return cfg;
}

const gradeIdsOf = cfg => cfg.mol_paygrades.split(',').map(x => x.trim()).filter(Boolean);

/** Managers whose leave overlaps [from, to]. Each row is one leave application. */
async function loadManagersOnLeave({ from, to, includePending = false, cfg }) {
  const grades = gradeIdsOf(cfg);
  const byReports = cfg.mol_include_direct_reports !== 'No';
  if (!byReports && !grades.length) return [];

  const statuses = includePending ? [...ON_LEAVE, ...PENDING] : ON_LEAVE;
  // Aliases are snake_case: Postgres lower-cases unquoted mixed-case names.
  const rows = await prisma.$queryRaw`
    SELECT el.id, el.employee, el.date_start, el.date_end, el.status,
           e.employee_id AS employee_code,
           TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS employee_name,
           e.paygradeId AS paygrade_id, pg.name AS pay_grade,
           jt.label AS job_title, dept.title AS department, br.title AS branch,
           TRIM(CONCAT_WS(' ', sup.firstName, sup.lastName)) AS reports_to,
           lt.name AS leave_type,
           (SELECT COUNT(*) FROM employeeleavedays eld WHERE eld.employee_leave = el.id) AS day_count,
           (SELECT COUNT(*) FROM employee r WHERE r.supervisorId = e.id AND r.status = '1') AS direct_reports
      FROM employeeleaves el
      JOIN employee e                 ON e.id    = el.employee
      LEFT JOIN employee sup          ON sup.id  = e.supervisorId
      LEFT JOIN paygrades pg          ON pg.id   = e.paygradeId
      LEFT JOIN codelistvalue jt      ON jt.id   = e.jobTitleId
      LEFT JOIN companystructures dept ON dept.id = e.departmentId
      LEFT JOIN companystructures br  ON br.id   = e.branchId
      LEFT JOIN leavetypes lt         ON lt.id   = el.leave_type
     WHERE e.status = '1'
       AND el.status IN (${Prisma.join(statuses)})
       AND el.date_start <= ${new Date(to)}
       AND el.date_end   >= ${new Date(from)}
     ORDER BY el.date_start ASC, employee_name ASC`;

  return rows
    .map(r => {
      const reports = Number(r.direct_reports ?? 0);
      const onGrade = r.paygrade_id != null && grades.includes(String(r.paygrade_id));
      const isManager = (byReports && reports > 0) || onGrade;
      if (!isManager) return null;
      const start = toYmd(r.date_start), end = toYmd(r.date_end) || start;
      const back = backOn(end);
      return {
        id: String(r.id),
        employee_id: String(r.employee),
        employee_code: r.employee_code ?? '',
        employee_name: r.employee_name ?? '',
        job_title: r.job_title ?? '',
        department: r.department ?? '',
        branch: r.branch ?? '',
        pay_grade: r.pay_grade ?? '',
        reports_to: r.reports_to || '',
        direct_reports: reports,
        basis: [reports > 0 && byReports ? 'Direct reports' : null, onGrade ? 'Management grade' : null].filter(Boolean).join(' + '),
        leave_type: r.leave_type ?? '',
        status: r.status ?? '',
        date_start: start, date_end: end, back_on: back,
        start_label: dmy(start), end_label: dmy(end), back_on_label: dmy(back),
        days: Number(r.day_count ?? 0) || weekdays(start, end),
      };
    })
    .filter(Boolean);
}

function periodLabel(from, to) {
  if (from === to) return from === ymd(new Date()) ? `today (${dmy(from)})` : `on ${dmy(from)}`;
  return `from ${dmy(from)} to ${dmy(to)}`;
}

// GET /reports/managers-on-leave?from=YYYY-MM-DD&to=YYYY-MM-DD&pending=1 — defaults to today.
exports.getReport = asyncHandler(async (req, res) => {
  const today = ymd(new Date());
  const from = isYmd(req.query.from) ? req.query.from : today;
  const to   = isYmd(req.query.to)   ? req.query.to   : from;
  if (to < from) return respond.badReq(res, '"To" must be on or after "From"');
  const cfg = await getConfig();
  const rows = await loadManagersOnLeave({ from, to, includePending: req.query.pending === '1', cfg });
  respond.ok(res, 'Managers on leave', {
    from, to, rows,
    basis: { direct_reports: cfg.mol_include_direct_reports !== 'No', paygrade_ids: gradeIdsOf(cfg) },
  });
});

// GET /reports/managers-on-leave/settings
exports.getSettings = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Managers on leave settings', await getConfig());
});

// PUT /reports/managers-on-leave/settings
exports.saveSettings = asyncHandler(async (req, res) => {
  const b = req.body ?? {};
  const recipients = String(b.mol_recipients ?? '').split(/[,;\s]+/).filter(Boolean);
  const bad = recipients.filter(a => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
  if (bad.length) return respond.badReq(res, `Not a valid email address: ${bad.join(', ')}`);
  const yn = v => (v === 'No' || v === '0' || v === false ? 'No' : 'Yes');
  const on = v => (v === '1' || v === true || v === 'Yes' ? '1' : '0');
  const values = {
    mol_include_direct_reports: yn(b.mol_include_direct_reports),
    mol_paygrades: (Array.isArray(b.mol_paygrades) ? b.mol_paygrades : String(b.mol_paygrades ?? '').split(','))
      .map(x => String(x).trim()).filter(x => /^\d+$/.test(x)).join(','),
    mol_email_enabled: on(b.mol_email_enabled),
    mol_recipients: recipients.join(','),
    mol_send_when_empty: on(b.mol_send_when_empty),
  };
  if (values.mol_email_enabled === '1' && !recipients.length) return respond.badReq(res, 'Add at least one recipient to switch on the daily email');
  for (const [k, v] of Object.entries(values)) await upsertSetting(prisma, k, CATEGORY, v);
  logActivity({ module: 'Reports', action: 'managers_on_leave_settings', ...fromReq(req) });
  respond.ok(res, 'Settings saved', await getConfig());
});

// POST /reports/managers-on-leave/email { from, to, pending } — send the report now to the configured recipients.
exports.emailNow = asyncHandler(async (req, res) => {
  const cfg = await getConfig();
  if (!cfg.mol_recipients) return respond.badReq(res, 'No recipients set — add the MD\'s email address in the report settings first');
  const today = ymd(new Date());
  const from = isYmd(req.body?.from) ? req.body.from : today;
  const to   = isYmd(req.body?.to)   ? req.body.to   : from;
  const rows = await loadManagersOnLeave({ from, to, includePending: !!req.body?.pending, cfg });
  const { sendManagersOnLeaveEmail } = require('../helpers/emailHelper');
  await sendManagersOnLeaveEmail({ to: cfg.mol_recipients, periodLabel: periodLabel(from, to), rows });
  logActivity({ module: 'Reports', action: 'managers_on_leave_emailed', ...fromReq(req) });
  respond.ok(res, `Sent to ${cfg.mol_recipients.split(',').join(', ')}`, { sent: rows.length });
});

// Cron (07:30 daily): email today's managers on leave, weekdays only, when switched on.
exports.runDailyEmail = async () => {
  const now = new Date();
  if (now.getDay() === 0 || now.getDay() === 6) return { skipped: 'weekend' };
  const cfg = await getConfig();
  if (cfg.mol_email_enabled !== '1' || !cfg.mol_recipients) return { skipped: 'disabled' };
  const { notifyEnabled, sendManagersOnLeaveEmail } = require('../helpers/emailHelper');
  if (!(await notifyEnabled('leave'))) return { skipped: 'leave notifications off' };
  const today = ymd(now);
  const rows = await loadManagersOnLeave({ from: today, to: today, cfg });
  if (!rows.length && cfg.mol_send_when_empty !== '1') return { skipped: 'nobody on leave' };
  await sendManagersOnLeaveEmail({ to: cfg.mol_recipients, periodLabel: periodLabel(today, today), rows });
  console.log(`[cron] Managers-on-leave email sent (${rows.length} manager(s))`);
  return { sent: rows.length };
};
