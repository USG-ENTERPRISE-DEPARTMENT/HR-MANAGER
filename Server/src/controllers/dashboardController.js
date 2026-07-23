const { prisma }    = require('../helpers/dbQueryHelper');
const asyncHandler  = require('../middleware/asyncHandler');
const respond       = require('../helpers/respondHelper');

const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Active-employee filter (was the raw `lifecycleStatus='ACTIVE' AND approvalStatus='APPROVED'`).
const ACTIVE_WHERE = { lifecycleStatus: 'ACTIVE', approvalStatus: 'APPROVED' };
// day_status values counted as "present" (string column, not an enum).
const DAY_PRESENT = ['Present', 'Late', 'Half_Day', 'Incomplete'];

// "1 file" / "2 files" — pluralize a counted noun for module-card labels.
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

const timeHM = v => {
  if (v == null) return null;
  const x = v instanceof Date ? v.toISOString().slice(11, 16) : String(v).slice(11, 16);
  return x || null;
};

// Prefer a non-empty work_email, else fall back to email (was COALESCE(NULLIF(work_email,''), email)).
const pickEmail = e => (e?.work_email && e.work_email !== '' ? e.work_email : e?.email) ?? null;
const fullName  = e => `${e?.firstName ?? ''} ${e?.lastName ?? ''}`.trim();

// Complete years between a hire date (a @db.Date → read as UTC midnight) and now
// (was TIMESTAMPDIFF(YEAR, hireDate, CURDATE())). UTC parts avoid off-by-one on the stored date.
function fullYears(from, to) {
  let y = to.getFullYear() - from.getUTCFullYear();
  const m = to.getMonth() - from.getUTCMonth();
  if (m < 0 || (m === 0 && to.getDate() < from.getUTCDate())) y--;
  return y;
}

// GET /dashboard/summary — everything the overview page needs in one round-trip
exports.getDashboardSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const today = dstr(now);
  const yesterday = dstr(new Date(now.getTime() - 86_400_000));
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const lastMonthStart = `${lastMonthEnd.getFullYear()}-${pad(lastMonthEnd.getMonth() + 1)}-01`;

  const dToday = new Date(today), dYesterday = new Date(yesterday);
  const dMonthStart = new Date(monthStart), dLastMonthStart = new Date(lastMonthStart);
  const safe = (p, dflt) => p.catch(() => dflt);

  const [
    total_employees, new_hires_month, new_hires_last_month,
    applicants, applicants_month, applicants_last_month,
    present_today, present_yesterday,
    attRows, statusGrp, activeHires, recent,
  ] = await Promise.all([
    safe(prisma.employee.count({ where: ACTIVE_WHERE }), 0),
    safe(prisma.employee.count({ where: { ...ACTIVE_WHERE, hireDate: { gte: dMonthStart } } }), 0),
    safe(prisma.employee.count({ where: { ...ACTIVE_WHERE, hireDate: { gte: dLastMonthStart, lt: dMonthStart } } }), 0),
    safe(prisma.applications.count(), 0),
    safe(prisma.applications.count({ where: { created: { gte: dMonthStart } } }), 0),
    safe(prisma.applications.count({ where: { created: { gte: dLastMonthStart, lt: dMonthStart } } }), 0),
    safe(prisma.attendance.count({ where: { date: dToday, day_status: { in: DAY_PRESENT } } }), 0),
    safe(prisma.attendance.count({ where: { date: dYesterday, day_status: { in: DAY_PRESENT } } }), 0),
    safe(prisma.attendance.findMany({
      where: { date: dToday, in_time: { not: null } },
      orderBy: { in_time: 'desc' }, take: 8,
      select: { in_time: true, out_time: true, day_status: true, employee: true },
    }), []),
    safe(prisma.employee.groupBy({ by: ['employmentStatusId'], where: ACTIVE_WHERE, _count: { _all: true } }), []),
    safe(prisma.employee.findMany({ where: { ...ACTIVE_WHERE, hireDate: { not: null } }, select: { hireDate: true } }), []),
    safe(prisma.employee.findMany({
      where: ACTIVE_WHERE, orderBy: { id: 'desc' }, take: 6,
      select: { id: true, firstName: true, lastName: true, work_email: true, email: true, jobTitleId: true, staff_level: true, employmentStatusId: true },
    }), []),
  ]);

  // Resolve attendance-row employees (replaces JOIN employee) via one batched lookup.
  const attEmpIds = [...new Set(attRows.map(a => a.employee).filter(v => v != null))];
  const attEmps = attEmpIds.length
    ? await prisma.employee.findMany({ where: { id: { in: attEmpIds } }, select: { id: true, firstName: true, lastName: true, work_email: true, email: true } }).catch(() => [])
    : [];
  const attEmpMap = new Map(attEmps.map(e => [String(e.id), e]));

  // Resolve CodeListValue labels for status distribution + recent employees (replaces the LEFT JOINs).
  const clvIds = [...new Set([
    ...statusGrp.map(g => g.employmentStatusId),
    ...recent.flatMap(e => [e.jobTitleId, e.staff_level, e.employmentStatusId]),
  ].filter(Boolean))];
  const clvs = clvIds.length
    ? await prisma.codeListValue.findMany({ where: { id: { in: clvIds } }, select: { id: true, label: true } }).catch(() => [])
    : [];
  const clvMap = new Map(clvs.map(c => [c.id, c.label]));

  const attendance_today = attRows
    .filter(a => attEmpMap.has(String(a.employee)))                  // INNER JOIN employee
    .map(a => {
      const e = attEmpMap.get(String(a.employee));
      return {
        name:       fullName(e),
        email:      pickEmail(e),
        in_time:    timeHM(a.in_time),
        out_time:   timeHM(a.out_time),
        day_status: a.day_status ?? 'Incomplete',
      };
    });

  // Employment-status distribution (COALESCE(label,'Unspecified'), merged + sorted desc).
  const statusAgg = {};
  for (const g of statusGrp) {
    const label = (g.employmentStatusId && clvMap.get(g.employmentStatusId)) || 'Unspecified';
    statusAgg[label] = (statusAgg[label] || 0) + Number(g._count._all);
  }
  const employment_status = Object.entries(statusAgg)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // Hires-per-month histogram from active hire dates (UTC to match the stored @db.Date value).
  const hiresMap = {};
  for (const r of activeHires) {
    if (!r.hireDate) continue;
    const ym = `${r.hireDate.getUTCFullYear()}-${pad(r.hireDate.getUTCMonth() + 1)}`;
    hiresMap[ym] = (hiresMap[ym] || 0) + 1;
  }
  const monthKeys = Object.keys(hiresMap).sort();
  const growth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const cumulative = monthKeys.filter(k => k <= ym).reduce((sum, k) => sum + hiresMap[k], 0);
    growth.push({ month: d.toLocaleString('en-US', { month: 'short' }), employees: cumulative, new_hires: hiresMap[ym] ?? 0 });
  }

  // Length-of-service buckets (replaces the TIMESTAMPDIFF GROUP BY).
  const buckets = { '< 1yr': 0, '1–2yr': 0, '2–3yr': 0, '3–5yr': 0, '5–10yr': 0, '10yr+': 0 };
  for (const r of activeHires) {
    if (!r.hireDate) continue;
    const y = fullYears(r.hireDate, now);
    if (y < 1) buckets['< 1yr']++;
    else if (y < 2) buckets['1–2yr']++;
    else if (y < 3) buckets['2–3yr']++;
    else if (y < 5) buckets['3–5yr']++;
    else if (y < 10) buckets['5–10yr']++;
    else buckets['10yr+']++;
  }

  const recent_employees = recent.map(e => ({
    id:         String(e.id),
    name:       fullName(e),
    email:      pickEmail(e),
    position:   (e.jobTitleId && clvMap.get(e.jobTitleId)) || null,
    level:      (e.staff_level && clvMap.get(e.staff_level)) || null,
    emp_status: (e.employmentStatusId && clvMap.get(e.employmentStatusId)) || null,
  }));

  respond.ok(res, 'Dashboard summary', {
    date: today,
    stats: {
      total_employees, new_hires_month, new_hires_last_month,
      applicants, applicants_month, applicants_last_month,
      present_today, present_yesterday,
    },
    attendance_today,
    employment_status,
    growth,
    service: Object.entries(buckets).map(([label, value]) => ({ label, value })),
    recent_employees,
  });
});

// GET /dashboard/module-stats — the live stat shown on each module launcher card.
// For each module, returns an org-wide figure when the user can manage that module,
// otherwise a figure scoped to the user's own data (personal view). Modules the user
// cannot access at all are omitted. Mirrors the client's resolveTarget access rules.
exports.getModuleStats = asyncHandler(async (req, res) => {
  const perms = new Set(req.user?.permissions ?? []);
  const has   = (...keys) => keys.some(k => perms.has(k));
  const empId = req.user?.employeeId != null ? BigInt(req.user.employeeId) : null; // employee.id (BigInt)
  const empIdStr = empId != null ? String(empId) : null;                           // string-keyed tables (medical)

  const now   = new Date();
  const today = new Date(dstr(now));
  const monthStart = new Date(`${dstr(now).slice(0, 7)}-01`);

  const n = (p) => p.then(v => Number(v)).catch(() => 0); // count → number, never throws

  const tasks = [];
  const push  = (p) => tasks.push(p);

  // ── Employees (management only) ──
  if (has('view_employees')) {
    push((async () => ['Employees', plural(await n(prisma.employee.count({ where: ACTIVE_WHERE })), 'employee')])());
  }

  // ── Leave ──
  if (has('view_leave_setup', 'manage_leave_types', 'manage_leave_periods', 'manage_holidays')) {
    push((async () => ['LeaveManagement', `${await n(prisma.employeeleaves.count({ where: { status: { startsWith: 'Pending' } } }))} pending`])());
  } else if (empId != null) {
    push((async () => ['LeaveManagement', `${await n(prisma.employeeleaves.count({ where: { employee: empId, status: { startsWith: 'Pending' } } }))} pending`])());
  }

  // ── Payroll (management only) — last run period ──
  if (has('view_payroll', 'process_payroll', 'approve_payroll', 'manage_payroll_employees',
          'view_salary_setup', 'manage_salary_component_types', 'manage_salary_components', 'manage_notch_setup')) {
    push((async () => {
      // COALESCE ordering has no builder equivalent; a static (no-param) tagged template is portable.
      const rows = await prisma.$queryRaw`SELECT date_end, created_at FROM payrollruns ORDER BY COALESCE(date_end, created_at) DESC LIMIT 1`.catch(() => []);
      const d = rows?.[0]?.date_end || rows?.[0]?.created_at;
      return ['Payroll', d ? `Last run: ${new Date(d).toLocaleString('en-US', { month: 'short', year: 'numeric' })}` : 'No runs yet'];
    })());
  }

  // ── Insights / Reports ──
  if (has('generate_reports')) {
    push((async () => ['Insights', plural(await n(prisma.reports.count()), 'report')])());
  } else {
    push((async () => ['Insights', plural(await n(prisma.userreports.count()), 'report')])());
  }

  // ── Company / Organisation Structure (management only) — count org nodes ──
  if (has('view_company_structure')) {
    push((async () => ['Company', plural(await n(prisma.companystructures.count()), 'structure')])());
  }

  // ── Recruitment (management only) ──
  if (has('view_recruitment')) {
    push((async () => ['Recruitment', plural(await n(prisma.applications.count()), 'applicant')])());
  }

  // ── Training ──
  if (has('view_training')) {
    push((async () => ['Training', plural(await n(prisma.trainingcatalog.count({ where: { is_active: true } })), 'active course')])());
  } else if (empId != null) {
    push((async () => ['Training', plural(await n(prisma.trainingnomination.count({ where: { employee: empId } })), 'training')])());
  }

  // ── Documents — actual files (company + employee documents), not definitions ──
  if (has('view_documents')) {
    push((async () => {
      const [a, b] = await Promise.all([
        n(prisma.companydocuments.count({ where: { status: 'Active' } })),
        n(prisma.employeedocuments.count()),
      ]);
      return ['Documents', plural(a + b, 'file')];
    })());
  } else if (empId != null) {
    push((async () => ['Documents', plural(await n(prisma.employeedocuments.count({ where: { employee: empId } })), 'file')])());
  }

  // ── System Administration (management only) ──
  if (has('manage_app_settings', 'view_app_settings')) {
    push((async () => ['Admin', plural(await n(prisma.users.count()), 'user')])());
  }

  // ── Medical (status is an enum; DB "Pending Approval" ⇒ client value Pending_Approval) ──
  if (has('view_medical')) {
    push((async () => {
      const [a, b] = await Promise.all([
        n(prisma.staffmedical.count({ where: { status: 'Pending_Approval' } })),
        n(prisma.dependentmedical.count({ where: { status: 'Pending_Approval' } })),
      ]);
      return ['Medical', `${a + b} pending`];
    })());
  } else if (empIdStr != null) {
    push((async () => ['Medical', `${await n(prisma.staffmedical.count({ where: { employee: empIdStr, status: { in: ['Pending_Approval', 'Pending', 'Processing'] } } }))} pending`])());
  }

  // ── Performance ──
  if (has('view_performance')) {
    push((async () => ['Performance', plural(await n(prisma.performance_review.count({ where: { status: { notIn: ['Completed', 'Closed'] } } })), 'review')])());
  } else if (empId != null) {
    push((async () => ['Performance', plural(await n(prisma.performance_review.count({ where: { employee: empId, status: { notIn: ['Completed', 'Closed'] } } })), 'review')])());
  }

  // ── Attendance ──
  if (has('view_attendance')) {
    push((async () => ['Attendance', `${await n(prisma.attendance.count({ where: { date: today, day_status: { in: DAY_PRESENT } } }))} present today`])());
  } else if (empId != null) {
    push((async () => {
      const cnt = await n(prisma.attendance.count({ where: { employee: empId, date: { gte: monthStart }, day_status: { in: DAY_PRESENT } } }));
      return ['Attendance', `${plural(cnt, 'day')} this month`];
    })());
  }

  const results = await Promise.all(tasks);
  const out = {};
  for (const [id, label] of results) if (id) out[id] = label;

  respond.ok(res, 'Module stats', out);
});
