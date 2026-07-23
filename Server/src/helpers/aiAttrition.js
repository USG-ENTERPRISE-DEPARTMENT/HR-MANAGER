// aiAttrition - explainable, offline attrition-risk scorecard.
// Uses Prisma ORM plus in-process aggregation so it stays portable across DB engines.
const { prisma } = require('./dbQueryHelper');

const ACTIVE_WHERE = { lifecycleStatus: 'ACTIVE', approvalStatus: 'APPROVED' };

const daysAgo = n => {
  const d = new Date(Date.now() - n * 86400000);
  const p = x => String(x).padStart(2, '0');
  return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
};

async function computeAttrition() {
  const employees = await prisma.employee.findMany({
    where: ACTIVE_WHERE,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      hireDate: true,
      confirmationDate: true,
      departmentId: true,
      jobTitleId: true,
    },
  }).catch(() => []);
  if (!employees.length) return [];

  const since90 = daysAgo(90);
  const since180 = daysAgo(180);
  const empIds = employees.map(e => e.id);
  const deptIds = [...new Set(employees.map(e => e.departmentId).filter(Boolean))];
  const jobTitleIds = [...new Set(employees.map(e => e.jobTitleId).filter(Boolean))];

  const [
    departments,
    jobTitles,
    attendanceRows,
    leaveRows,
    reviewRows,
    disciplinaryRows,
  ] = await Promise.all([
    deptIds.length
      ? prisma.companystructures.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, title: true },
      }).catch(() => [])
      : [],
    jobTitleIds.length
      ? prisma.codeListValue.findMany({
        where: { id: { in: jobTitleIds } },
        select: { id: true, label: true },
      }).catch(() => [])
      : [],
    prisma.attendance.findMany({
      where: { employee: { in: empIds }, date: { gte: since90 } },
      select: { employee: true, day_status: true },
    }).catch(() => []),
    prisma.employeeleaves.findMany({
      where: {
        employee: { in: empIds },
        date_start: { gte: since180 },
        status: { in: ['Approved', 'Pending', 'Processing'] },
      },
      select: { employee: true },
    }).catch(() => []),
    prisma.performance_review.findMany({
      where: { employee: { in: empIds } },
      orderBy: { id: 'desc' },
      select: { employee: true, supervisor_score: true, hr_score: true },
    }).catch(() => []),
    prisma.employee_disciplinary.findMany({
      where: { employee: { in: empIds } },
      select: { employee: true, status: true, severity: true },
    }).catch(() => []),
  ]);

  const deptMap = new Map(departments.map(d => [String(d.id), d.title]));
  const jobTitleMap = new Map(jobTitles.map(j => [j.id, j.label]));

  const attMap = new Map();
  for (const row of attendanceRows) {
    const key = String(row.employee);
    const stat = attMap.get(key) || { late: 0, absent: 0 };
    if (row.day_status === 'Late') stat.late++;
    if (row.day_status === 'Absent') stat.absent++;
    attMap.set(key, stat);
  }

  const leaveMap = new Map();
  for (const row of leaveRows) {
    const key = String(row.employee);
    leaveMap.set(key, { cnt: (leaveMap.get(key)?.cnt || 0) + 1 });
  }

  const perfMap = new Map();
  for (const row of reviewRows) {
    const key = String(row.employee);
    if (!perfMap.has(key)) perfMap.set(key, row);
  }

  const discMap = new Map();
  for (const row of disciplinaryRows) {
    const key = String(row.employee);
    const stat = discMap.get(key) || { open_cnt: 0, severe_cnt: 0 };
    if (row.status !== 'Resolved') stat.open_cnt++;
    if (row.severity === 'High' || row.severity === 'Critical') stat.severe_cnt++;
    discMap.set(key, stat);
  }

  const now = Date.now();
  const results = employees.map(e => {
    const id = String(e.id);
    const factors = [];
    let score = 0;
    const add = (pts, label) => {
      if (pts > 0) {
        score += pts;
        factors.push({ label, points: pts });
      }
    };

    const tenureYrs = e.hireDate ? (now - new Date(e.hireDate).getTime()) / (365.25 * 86400000) : null;
    if (tenureYrs != null) {
      if (tenureYrs < 1) add(20, 'Short tenure (under 1 year)');
      else if (tenureYrs < 2) add(10, 'Early tenure (1-2 years)');
    }
    if (!e.confirmationDate) add(8, 'Not yet confirmed (probation)');

    const a = attMap.get(id);
    const late = Number(a?.late ?? 0);
    const absent = Number(a?.absent ?? 0);
    if (absent >= 3) add(Math.min(20, absent * 4), `Frequent absences (${absent} in 90 days)`);
    if (late >= 5) add(Math.min(12, Math.floor(late / 2)), `Frequent lateness (${late} in 90 days)`);

    const lc = Number(leaveMap.get(id)?.cnt ?? 0);
    if (lc >= 4) add(Math.min(15, (lc - 3) * 4), `High leave frequency (${lc} in 180 days)`);

    const p = perfMap.get(id);
    const pScore = p ? Number(p.hr_score ?? p.supervisor_score ?? NaN) : NaN;
    if (!Number.isNaN(pScore)) {
      if (pScore <= 2) add(22, `Low performance score (${pScore})`);
      else if (pScore <= 2.8) add(12, `Below-average performance score (${pScore})`);
    }

    const d = discMap.get(id);
    const open = Number(d?.open_cnt ?? 0);
    const severe = Number(d?.severe_cnt ?? 0);
    if (severe > 0) add(Math.min(20, severe * 12), `Severe disciplinary record (${severe})`);
    else if (open > 0) add(Math.min(12, open * 6), `Open disciplinary case(s) (${open})`);

    score = Math.min(100, Math.round(score));
    const band = score >= 60 ? 'High' : score >= 35 ? 'Medium' : 'Low';
    factors.sort((x, y) => y.points - x.points);

    return {
      employee_id: id,
      name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
      department: (e.departmentId && deptMap.get(String(e.departmentId))) || '-',
      job_title: (e.jobTitleId && jobTitleMap.get(e.jobTitleId)) || '-',
      score,
      band,
      factors: factors.slice(0, 5),
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results;
}

async function persist(results) {
  await prisma.ai_attrition_scores.deleteMany().catch(() => {});
  if (!results.length) return;

  await prisma.ai_attrition_scores.createMany({
    data: results.map(r => ({
      employee_id: BigInt(r.employee_id),
      score: r.score,
      band: r.band,
      factors: JSON.stringify(r.factors),
    })),
  }).catch(() => {});
}

module.exports = { computeAttrition, persist };
