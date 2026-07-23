// aiTools — permission-scoped "facts" the assistant can pull from the database.
// Rather than trusting a small CPU model to call tools correctly, a lightweight keyword
// router selects the relevant tools, runs them with the caller's req.user scoping, and the
// results are injected into the prompt as grounded facts. Org tools require the matching
// view_* permission; otherwise the caller's personal variant runs. Nothing a user can't
// see is ever fetched.
const { prisma } = require('./dbQueryHelper');
const { Prisma } = require('@prisma/client'); // Prisma.sql for portable dynamic SQL fragments

const ACTIVE = Prisma.sql`lifecycleStatus = 'ACTIVE' AND approvalStatus = 'APPROVED'`;
const num = rows => Number(rows?.[0]?.cnt ?? 0);
// Tagged-template count helper — portable. Call as count`SELECT COUNT(*) cnt ... ${value}`.
const count = (strings, ...values) => prisma.$queryRaw(strings, ...values).then(num).catch(() => 0);

const todayStr = () => {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function has(req, ...keys) {
  const perms = req.user?.permissions ?? [];
  return keys.some(k => perms.includes(k));
}
function empId(req) {
  return req.user?.employeeId != null ? BigInt(req.user.employeeId) : null;
}

// Each tool: keywords that trigger it + a run(req) that returns a short fact string (or null).
const TOOLS = {
  org_overview: {
    keywords: ['how many employee', 'employee count', 'headcount', 'total employee', 'number of employee', 'staff count'],
    async run(req) {
      if (!has(req, 'view_employees')) return null;
      const n = await count`SELECT COUNT(*) cnt FROM employee WHERE ${ACTIVE}`;
      return `Active employees: ${n}.`;
    },
  },

  pending_leave: {
    keywords: ['pending leave', 'leave request', 'leaves pending', 'leave approval', 'leaves awaiting', 'who is on leave', 'leave balance'],
    async run(req) {
      if (has(req, 'view_leave_setup', 'manage_leave_types', 'manage_leave_periods')) {
        const n = await count`SELECT COUNT(*) cnt FROM employeeleaves WHERE status LIKE 'Pending%'`;
        return `Leave requests pending approval (organisation-wide): ${n}.`;
      }
      const id = empId(req); if (id == null) return null;
      const n = await count`SELECT COUNT(*) cnt FROM employeeleaves WHERE employee = ${id} AND status LIKE 'Pending%'`;
      return `Your pending leave requests: ${n}.`;
    },
  },

  pending_medical: {
    keywords: ['pending medical', 'medical claim', 'claims pending', 'medical approval', 'claims awaiting'],
    async run(req) {
      if (has(req, 'view_medical')) {
        const a = await count`SELECT COUNT(*) cnt FROM staffmedical WHERE status = 'Pending Approval'`;
        const b = await count`SELECT COUNT(*) cnt FROM dependentmedical WHERE status = 'Pending Approval'`;
        return `Medical claims pending approval (organisation-wide): ${a + b}.`;
      }
      const id = empId(req); if (id == null) return null;
      const n = await count`SELECT COUNT(*) cnt FROM staffmedical WHERE employee = ${String(id)} AND status IN ('Pending Approval','Pending','Processing')`;
      return `Your pending medical claims: ${n}.`;
    },
  },

  attendance_today: {
    keywords: ['present today', 'attendance today', 'who is in', 'clocked in', 'how many present'],
    async run(req) {
      if (has(req, 'view_attendance')) {
        const n = await count`SELECT COUNT(*) cnt FROM attendance WHERE date = ${todayStr()} AND day_status IN ('Present','Late','Half_Day','Incomplete')`;
        return `Employees present today (organisation-wide): ${n}.`;
      }
      const id = empId(req); if (id == null) return null;
      const rows = await prisma.$queryRaw`SELECT day_status FROM attendance WHERE employee = ${id} AND date = ${todayStr()} LIMIT 1`
        .catch(() => []);
      return rows?.[0]?.day_status
        ? `Your attendance status today: ${String(rows[0].day_status).replace(/_/g, ' ')}.`
        : `You have no attendance record for today yet.`;
    },
  },

  payroll_status: {
    keywords: ['payroll run', 'last payroll', 'payroll status', 'last run', 'payslip run'],
    async run(req) {
      if (!has(req, 'view_payroll', 'process_payroll', 'approve_payroll', 'manage_payroll_employees')) return null;
      const rows = await prisma.$queryRaw`SELECT name, status, date_end, created_at FROM payrollruns ORDER BY COALESCE(date_end, created_at) DESC LIMIT 1`
        .catch(() => []);
      const r = rows?.[0];
      if (!r) return `No payroll runs have been created yet.`;
      const d = r.date_end || r.created_at;
      return `Most recent payroll run: "${r.name}" (status ${r.status})${d ? `, period ending ${new Date(d).toISOString().slice(0, 10)}` : ''}.`;
    },
  },

  my_profile: {
    keywords: ['my profile', 'my details', 'my position', 'my department', 'my job title', 'who am i', 'my hire date', 'my grade'],
    async run(req) {
      const id = empId(req); if (id == null) return null;
      const rows = await prisma.$queryRaw`
        SELECT TRIM(CONCAT_WS(' ', e.firstName, e.lastName)) AS name, e.hireDate,
                jt.label AS job_title, cs.title AS department, pg.name AS pay_grade
         FROM employee e
         LEFT JOIN CodeListValue jt ON jt.id = e.jobTitleId
         LEFT JOIN companystructures cs ON cs.id = e.departmentId
         LEFT JOIN paygrades pg ON pg.id = e.paygradeId
         WHERE e.id = ${id} LIMIT 1`
        .catch(() => []);
      const r = rows?.[0]; if (!r) return null;
      const hire = r.hireDate ? new Date(r.hireDate).toISOString().slice(0, 10) : 'unknown';
      return `Your profile — name: ${r.name}; job title: ${r.job_title || '—'}; department: ${r.department || '—'}; pay grade: ${r.pay_grade || '—'}; hired: ${hire}.`;
    },
  },

  my_medical_utilization: {
    keywords: ['my medical balance', 'my medical utilization', 'my medical utilisation', 'medical balance', 'medical remaining', 'how much medical'],
    async run(req) {
      const id = empId(req); if (id == null) return null;
      const used = await count`SELECT COALESCE(SUM(cost),0) cnt FROM staffmedical WHERE employee = ${String(id)} AND status = 'Approved'`;
      return `Your approved medical utilization so far this year: ${used.toLocaleString('en-US')}.`;
    },
  },
};

// Pick tools whose keywords appear in the user's message (case-insensitive substring match).
function routeIntents(message) {
  const m = String(message || '').toLowerCase();
  const picked = [];
  for (const [name, tool] of Object.entries(TOOLS)) {
    if (tool.keywords.some(k => m.includes(k))) picked.push(name);
  }
  return picked;
}

// Run the selected tools and return the non-empty fact strings.
async function runTools(names, req) {
  const facts = [];
  for (const name of names) {
    const tool = TOOLS[name];
    if (!tool) continue;
    try { const f = await tool.run(req); if (f) facts.push(f); }
    catch { /* a failed fact is non-critical */ }
  }
  return facts;
}

module.exports = { TOOLS, routeIntents, runTools };
