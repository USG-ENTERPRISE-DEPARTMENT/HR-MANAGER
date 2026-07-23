const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { tmsg } = require('../helpers/messageStore');
const { sendPerformanceEmail } = require('../helpers/emailHelper');
const { logActivity, fromReq } = require('./auditController');
const { notifyEmployee, notifyUsersWithPermission } = require('../helpers/notificationHelper');

const CYCLE_TYPES     = ['Annual', 'Semi-Annual', 'Quarterly', 'Probation'];
const CYCLE_STATUSES  = ['Draft', 'Active', 'Closed'];
const REVIEW_STATUSES = ['Not Started', 'Self Assessment', 'Supervisor Review', 'HR Review', 'Completed'];
const GOAL_STATUSES   = ['Draft', 'Active', 'Completed', 'Cancelled'];
const ACHIEVEMENT     = ['Exceeded', 'Met', 'Partially Met', 'Not Met'];
const RATING_SCALE    = [
  { value: 1, label: 'Below Expectations'  },
  { value: 2, label: 'Needs Improvement'   },
  { value: 3, label: 'Meets Expectations'  },
  { value: 4, label: 'Exceeds Expectations'},
  { value: 5, label: 'Outstanding'         },
];

const { toBigInt, s, toDate } = require('../helpers/controllerHelpers');
const { Prisma } = require('@prisma/client'); // Prisma.sql / Prisma.join for portable dynamic SQL

// Tagged-template query helpers — portable (Prisma emits the right placeholders per provider).
// Call as query`SELECT ... ${value}` (values become bound parameters).
async function query(strings, ...values) {
  return s(await prisma.$queryRaw(strings, ...values));
}

async function exec(strings, ...values) {
  return prisma.$executeRaw(strings, ...values);
}

const now = () => new Date(); // a Date binds correctly to timestamp columns on both MySQL and Postgres

async function enrichEmployees(rows, field = 'employee') {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map(r => String(r[field])).filter(Boolean))];
  const emps = ids.length
    ? await query`SELECT id, firstName, lastName, employee_id AS emp_code, work_email, email FROM employee WHERE id IN (${Prisma.join(ids.map(toBigInt))})`
    : [];
  const em = Object.fromEntries(emps.map(e => [String(e.id), e]));
  return rows.map(r => {
    const emp = em[String(r[field])] ?? null;
    return {
      ...r,
      [field]: emp
        ? { id: String(emp.id), name: `${emp.firstName} ${emp.lastName}`.trim(), employee_id: emp.emp_code }
        : { id: String(r[field]), name: null, employee_id: null },
      _email: emp ? (emp.work_email || emp.email || null) : null,
    };
  });
}

// ─── META ─────────────────────────────────────────────────────────────────────

// GET /performance/meta — return static lookup lists: cycle types, statuses, review stages, achievement options, and rating scale.
const getPerformanceMeta = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Performance meta', {
    cycleTypes: CYCLE_TYPES,
    cycleStatuses: CYCLE_STATUSES,
    reviewStatuses: REVIEW_STATUSES,
    goalStatuses: GOAL_STATUSES,
    achievementOptions: ACHIEVEMENT,
    ratingScale: RATING_SCALE,
  });
});

// ─── CYCLES ───────────────────────────────────────────────────────────────────

// GET /performance/cycles — list all performance cycles with per-cycle review counts (total and completed).
const getAllCycles = asyncHandler(async (_req, res) => {
  const cycles = await query`SELECT * FROM performance_cycle ORDER BY created_at DESC`;
  if (!cycles.length) return respond.ok(res, 'Cycles retrieved', []);

  const ids = cycles.map(c => c.id);
  const stats = await query`
    SELECT cycle_id,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed
     FROM performance_review WHERE cycle_id IN (${Prisma.join(ids.map(toBigInt))}) GROUP BY cycle_id`;
  // COUNT/SUM come back as BigInt (MySQL) or string/BigInt (PG); normalise to plain numbers.
  const sm = Object.fromEntries(stats.map(st => [String(st.cycle_id), { total: Number(st.total) || 0, completed: Number(st.completed) || 0 }]));

  respond.ok(res, 'Cycles retrieved', cycles.map(c => ({
    ...c,
    stats: sm[c.id] ?? { total: 0, completed: 0 },
  })));
});

// GET /performance/cycles/:id — retrieve a single cycle with all linked reviews, resolved employee and supervisor names.
const getCycleById = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [cycle] = await query`SELECT * FROM performance_cycle WHERE id = ${id} LIMIT 1`;
  if (!cycle) return respond.notFound(res, 'Cycle not found');

  const reviews = await query`
    SELECT pr.*, e.firstName, e.lastName, e.employee_id AS emp_code,
            s.firstName AS sup_first, s.lastName AS sup_last
     FROM performance_review pr
     LEFT JOIN employee e ON e.id = pr.employee
     LEFT JOIN employee s ON s.id = pr.supervisor
     WHERE pr.cycle_id = ${id}
     ORDER BY e.firstName, e.lastName`;

  respond.ok(res, 'Cycle retrieved', {
    ...cycle,
    reviews: reviews.map(r => ({
      ...r,
      employee:   { id: String(r.employee), name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(), employee_id: r.emp_code },
      supervisor: r.supervisor ? { id: String(r.supervisor), name: `${r.sup_first ?? ''} ${r.sup_last ?? ''}`.trim() } : null,
      firstName: undefined, lastName: undefined, emp_code: undefined, sup_first: undefined, sup_last: undefined,
    })),
  });
});

// POST /performance/cycles — create a new performance cycle in Draft status with optional per-stage due dates.
const createCycle = asyncHandler(async (req, res) => {
  const { name, type = 'Annual', period_start, period_end, self_due, supervisor_due, hr_due, notes } = req.body;
  if (!name?.trim())   return respond.badReq(res, 'Cycle name is required');
  if (!period_start)   return respond.badReq(res, 'Period start is required');
  if (!period_end)     return respond.badReq(res, 'Period end is required');

  const createdBy = req.user?.id ? BigInt(req.user.id) : null;

  await exec`
    INSERT INTO performance_cycle (name, type, period_start, period_end, self_due, supervisor_due, hr_due, status, notes, created_by, created_at, updated_at)
     VALUES (${name.trim()}, ${type}, ${toDate(period_start)}, ${toDate(period_end)}, ${toDate(self_due)}, ${toDate(supervisor_due)}, ${toDate(hr_due)},
             'Draft', ${notes?.trim() || null}, ${createdBy}, ${now()}, ${now()})`;
  const [created] = await query`SELECT * FROM performance_cycle ORDER BY id DESC LIMIT 1`;

  logActivity({
    module: 'Performance', action: 'create_cycle',
    entityId: String(created.id), entityName: name.trim(),
    details: { type, period_start, period_end },
    ...fromReq(req),
  });

  respond.created(res, 'Cycle created', created);
});

// PUT /performance/cycles/:id — update a cycle's metadata (name, dates, due dates, notes).
const updateCycle = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [ex] = await query`SELECT * FROM performance_cycle WHERE id = ${id} LIMIT 1`;
  if (!ex) return respond.notFound(res, 'Cycle not found');

  const { name, type, period_start, period_end, self_due, supervisor_due, hr_due, notes } = req.body;

  await exec`
    UPDATE performance_cycle SET
      name=${name?.trim() ?? ex.name},
      type=${type ?? ex.type},
      period_start=${toDate(period_start ?? ex.period_start)},
      period_end=${toDate(period_end ?? ex.period_end)},
      self_due=${toDate(self_due != null ? (self_due || null) : ex.self_due)},
      supervisor_due=${toDate(supervisor_due != null ? (supervisor_due || null) : ex.supervisor_due)},
      hr_due=${toDate(hr_due != null ? (hr_due || null) : ex.hr_due)},
      notes=${notes != null ? (notes?.trim() || null) : ex.notes},
      updated_at=${now()}
     WHERE id=${id}`;
  const [updated] = await query`SELECT * FROM performance_cycle WHERE id = ${id} LIMIT 1`;
  respond.ok(res, 'Cycle updated', updated);
});

// DELETE /performance/cycles/:id — delete a cycle; blocked unless status is Draft.
const deleteCycle = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [ex] = await query`SELECT status FROM performance_cycle WHERE id = ${id} LIMIT 1`;
  if (!ex) return respond.notFound(res, 'Cycle not found');
  if (ex.status !== 'Draft') return respond.badReq(res, 'Only Draft cycles can be deleted');
  await exec`DELETE FROM performance_cycle WHERE id = ${id}`;
  respond.ok(res, 'Cycle deleted');
});

// POST /performance/cycles/:id/close — transition an Active cycle to Closed.
const closeCycle = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [ex] = await query`SELECT status FROM performance_cycle WHERE id = ${id} LIMIT 1`;
  if (!ex) return respond.notFound(res, 'Cycle not found');
  if (ex.status !== 'Active') return respond.badReq(res, 'Only Active cycles can be closed');
  await exec`UPDATE performance_cycle SET status='Closed', updated_at=${now()} WHERE id=${id}`;
  logActivity({ module: 'Performance', action: 'close_cycle', entityId: String(id), ...fromReq(req) });
  respond.ok(res, 'Cycle closed');
});

// POST /performance/cycles/:id/employees — bulk-add employees to a cycle; auto-assigns supervisor from the
// employee record and skips duplicates (INSERT IGNORE).
const addEmployeesToCycle = asyncHandler(async (req, res) => {
  const cycleId = toBigInt(req.params.id);
  if (!cycleId) return respond.badReq(res, 'Invalid cycle ID');
  const { assignments } = req.body; // [{ employee_id }]
  if (!Array.isArray(assignments) || !assignments.length)
    return respond.badReq(res, 'assignments array is required');

  // Bulk-fetch supervisorId from employee records
  const empIds = assignments.map(a => toBigInt(a.employee_id)).filter(Boolean);
  const empRows = empIds.length
    ? await query`SELECT id, supervisorId FROM employee WHERE id IN (${Prisma.join(empIds)})`
    : [];
  const supMap = Object.fromEntries(empRows.map(e => [String(e.id), e.supervisorId ?? null]));

  const ts = now();
  let added = 0;
  for (const a of assignments) {
    const empId = toBigInt(a.employee_id);
    if (!empId) continue;
    const supId = toBigInt(supMap[String(empId)]);
    // Portable "INSERT IGNORE": only insert when no review already exists for this cycle+employee.
    const affected = await exec`
      INSERT INTO performance_review (cycle_id, employee, supervisor, status, created_at, updated_at)
      SELECT ${cycleId}, ${empId}, ${supId ?? null}, 'Not Started', ${ts}, ${ts}
      FROM (SELECT 1) AS _t
      WHERE NOT EXISTS (
        SELECT 1 FROM performance_review WHERE cycle_id = ${cycleId} AND employee = ${empId}
      )`;
    if (affected > 0) added++;
  }
  respond.ok(res, tmsg('performance.added_to_cycle', { count: added }));
});

// DELETE /performance/cycles/:id/employees/:employeeId — remove an employee's review from a Draft cycle.
const removeEmployeeFromCycle = asyncHandler(async (req, res) => {
  const cycleId = toBigInt(req.params.id);
  const empId   = toBigInt(req.params.employeeId);
  if (!cycleId || !empId) return respond.badReq(res, 'Invalid ID');

  const [cycle] = await query`SELECT status FROM performance_cycle WHERE id = ${cycleId} LIMIT 1`;
  if (!cycle) return respond.notFound(res, 'Cycle not found');
  if (cycle.status !== 'Draft') return respond.badReq(res, 'Employees can only be removed from Draft cycles');

  await exec`DELETE FROM performance_review WHERE cycle_id = ${cycleId} AND employee = ${empId}`;
  respond.ok(res, 'Employee removed from cycle');
});

// POST /performance/cycles/:id/activate — transition a cycle to Active and email all assigned employees
// that their self-assessment window is open.
const activateCycle = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [cycle] = await query`SELECT * FROM performance_cycle WHERE id = ${id} LIMIT 1`;
  if (!cycle) return respond.notFound(res, 'Cycle not found');
  if (cycle.status === 'Active') return respond.badReq(res, 'Cycle is already active');

  await exec`UPDATE performance_cycle SET status='Active', updated_at=${now()} WHERE id=${id}`;

  // Notify all assigned employees
  const reviews = await query`
    SELECT pr.employee, e.firstName, e.lastName, e.work_email, e.email
     FROM performance_review pr LEFT JOIN employee e ON e.id = pr.employee
     WHERE pr.cycle_id = ${id}`;
  for (const r of reviews) {
    notifyEmployee(r.employee, {
      message: `Your performance review for "${cycle.name}" is open — complete your self-assessment`,
      action: 'PersonalPerformance', type: 'performance', fromUser: req.user?.id,
    });
    const to = r.work_email || r.email;
    if (!to) continue;
    sendPerformanceEmail({
      to, name: `${r.firstName} ${r.lastName}`.trim(),
      action: 'CYCLE_STARTED', cycleName: cycle.name,
      dueDate: cycle.self_due,
    }).catch(e => console.error('[PerfEmail]', e.message));
  }

  logActivity({
    module: 'Performance', action: 'activate_cycle',
    entityId: String(id), entityName: cycle.name,
    ...fromReq(req),
  });

  respond.ok(res, 'Cycle activated');
});

// ─── REVIEWS ──────────────────────────────────────────────────────────────────

// GET /performance/reviews — paginated, filterable list of reviews (by cycle, status, employee, or name/code search).
const getAllReviews = asyncHandler(async (req, res) => {
  const { cycle_id, status, employee_id, search, page = '1', limit = '25' } = req.query;

  const conds = [Prisma.sql`1=1`];
  if (cycle_id)    conds.push(Prisma.sql`pr.cycle_id = ${toBigInt(cycle_id)}`);
  if (status)      conds.push(Prisma.sql`pr.status = ${status}`);
  if (employee_id) conds.push(Prisma.sql`pr.employee = ${toBigInt(employee_id)}`);
  const where = Prisma.join(conds, ' AND ');

  let rows = await query`
    SELECT pr.*, e.firstName, e.lastName, e.employee_id AS emp_code,
            s.firstName AS sup_first, s.lastName AS sup_last,
            pc.name AS cycle_name
     FROM performance_review pr
     LEFT JOIN employee e ON e.id = pr.employee
     LEFT JOIN employee s ON s.id = pr.supervisor
     LEFT JOIN performance_cycle pc ON pc.id = pr.cycle_id
     WHERE ${where}
     ORDER BY pr.created_at DESC`;

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      (`${r.firstName ?? ''} ${r.lastName ?? ''}`).toLowerCase().includes(q) ||
      (r.emp_code ?? '').toLowerCase().includes(q)
    );
  }

  const pageNum  = Math.max(1, parseInt(page));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
  const total    = rows.length;
  const paged    = rows.slice((pageNum - 1) * pageSize, pageNum * pageSize);

  respond.ok(res, 'Reviews retrieved', {
    records: paged.map(r => ({
      ...r,
      employee:   { id: String(r.employee), name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(), employee_id: r.emp_code },
      supervisor: r.supervisor ? { id: String(r.supervisor), name: `${r.sup_first ?? ''} ${r.sup_last ?? ''}`.trim() } : null,
      cycle_name: r.cycle_name,
      firstName: undefined, lastName: undefined, emp_code: undefined, sup_first: undefined, sup_last: undefined,
    })),
    total, page: pageNum, limit: pageSize,
  });
});

// GET /performance/reviews/mine — return the authenticated employee's own reviews for all non-Draft cycles.
const getMyReviews = asyncHandler(async (req, res) => {
  const userId = req.user?.employee_id || req.user?.employeeId || req.user?.employee;
  const empId  = toBigInt(userId);
  if (!empId) return respond.badReq(res, 'Employee not resolved from token');

  const rows = await query`
    SELECT pr.*, pc.name AS cycle_name, pc.status AS cycle_status,
            pc.period_start, pc.period_end,
            pc.self_due, pc.supervisor_due, pc.hr_due
     FROM performance_review pr
     LEFT JOIN performance_cycle pc ON pc.id = pr.cycle_id
     WHERE pr.employee = ${empId} AND pc.status != 'Draft'
     ORDER BY pr.created_at DESC`;
  respond.ok(res, 'My reviews retrieved', rows);
});

// GET /performance/reviews/team — return all reviews where the authenticated employee is the assigned supervisor.
const getTeamReviews = asyncHandler(async (req, res) => {
  const userId = req.user?.employee_id || req.user?.employeeId || req.user?.employee;
  const supId  = toBigInt(userId);
  if (!supId) return respond.badReq(res, 'Employee not resolved from token');

  const rows = await query`
    SELECT pr.*, e.firstName, e.lastName, e.employee_id AS emp_code,
            pc.name AS cycle_name, pc.supervisor_due
     FROM performance_review pr
     LEFT JOIN employee e ON e.id = pr.employee
     LEFT JOIN performance_cycle pc ON pc.id = pr.cycle_id
     WHERE pr.supervisor = ${supId}
     ORDER BY pr.created_at DESC`;

  respond.ok(res, 'Team reviews retrieved', rows.map(r => ({
    ...r,
    employee: { id: String(r.employee), name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(), employee_id: r.emp_code },
    firstName: undefined, lastName: undefined, emp_code: undefined,
  })));
});

// GET /performance/reviews/:id — retrieve a review with full context: competency ratings and linked goals for the employee+cycle.
const getReviewById = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');

  const [review] = await query`
    SELECT pr.*, e.firstName, e.lastName, e.employee_id AS emp_code, e.work_email, e.email,
            s.firstName AS sup_first, s.lastName AS sup_last,
            pc.name AS cycle_name, pc.self_due, pc.supervisor_due, pc.hr_due
     FROM performance_review pr
     LEFT JOIN employee e ON e.id = pr.employee
     LEFT JOIN employee s ON s.id = pr.supervisor
     LEFT JOIN performance_cycle pc ON pc.id = pr.cycle_id
     WHERE pr.id = ${id} LIMIT 1`;
  if (!review) return respond.notFound(res, 'Review not found');

  const ratings = await query`
    SELECT pc2.id AS competency_id, pc2.name AS competency_name, pc2.category,
            pcr.id, pcr.self_rating, pcr.supervisor_rating, pcr.hr_rating,
            pcr.self_comment, pcr.supervisor_comment, pcr.hr_comment
     FROM performance_competency pc2
     LEFT JOIN performance_comp_rating pcr ON pcr.competency_id = pc2.id AND pcr.review_id = ${id}
     WHERE pc2.is_active = TRUE
     ORDER BY pc2.category, pc2.name`;

  const goals = await query`
    SELECT g.*, pc.self_due AS cycle_self_due, pc.name AS cycle_name
     FROM performance_goal g
     LEFT JOIN performance_cycle pc ON pc.id = g.cycle_id
     WHERE g.cycle_id = ${toBigInt(review.cycle_id)} AND g.employee = ${toBigInt(review.employee)}
     ORDER BY g.title`;

  respond.ok(res, 'Review retrieved', {
    ...review,
    employee:   { id: String(review.employee), name: `${review.firstName ?? ''} ${review.lastName ?? ''}`.trim(), employee_id: review.emp_code },
    supervisor: review.supervisor ? { id: String(review.supervisor), name: `${review.sup_first ?? ''} ${review.sup_last ?? ''}`.trim() } : null,
    firstName: undefined, lastName: undefined, emp_code: undefined, sup_first: undefined, sup_last: undefined,
    ratings, goals,
  });
});

// PUT /performance/reviews/:id — patch any combination of score/comment/status fields on a review record.
const updateReview = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [ex] = await query`SELECT * FROM performance_review WHERE id = ${id} LIMIT 1`;
  if (!ex) return respond.notFound(res, 'Review not found');

  const fields = [
    'status', 'supervisor',
    'self_score', 'self_comments',
    'supervisor_score', 'supervisor_comments', 'strengths', 'improvements',
    'hr_score', 'hr_comments', 'overall_score', 'development_plan',
  ];
  const sets = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) sets.push(Prisma.sql`${Prisma.raw(f)} = ${req.body[f] || null}`);
  }
  if (!sets.length) return respond.badReq(res, 'Nothing to update');

  sets.push(Prisma.sql`updated_at = ${now()}`);
  await exec`UPDATE performance_review SET ${Prisma.join(sets, ', ')} WHERE id = ${id}`;
  const [updated] = await query`SELECT * FROM performance_review WHERE id = ${id} LIMIT 1`;
  respond.ok(res, 'Review updated', updated);
});

// POST /performance/reviews/:id/self — employee submits self assessment; moves review to 'Self Assessment'
// status and emails the assigned supervisor to begin their review.
const submitSelfAssessment = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [review] = await query`
    SELECT pr.*, e.work_email, e.email, e.firstName, e.lastName,
            s.work_email AS sup_email, s.firstName AS sup_first, s.lastName AS sup_last,
            pc.name AS cycle_name, pc.supervisor_due
     FROM performance_review pr
     LEFT JOIN employee e ON e.id = pr.employee
     LEFT JOIN employee s ON s.id = pr.supervisor
     LEFT JOIN performance_cycle pc ON pc.id = pr.cycle_id
     WHERE pr.id = ${id} LIMIT 1`;
  if (!review) return respond.notFound(res, 'Review not found');
  if (review.status !== 'Not Started') return respond.badReq(res, 'Self assessment already submitted');

  const { self_score, self_comments } = req.body;
  const ts = now();

  await exec`
    UPDATE performance_review SET self_score=${self_score ? Number(self_score) : null}, self_comments=${self_comments?.trim() || null},
      self_submitted=${ts}, status='Self Assessment', updated_at=${ts} WHERE id=${id}`;

  logActivity({
    module: 'Performance', action: 'self_assessment',
    entityId: String(id), entityName: `${review.firstName} ${review.lastName}`.trim(),
    ...fromReq(req),
  });

  // Notify supervisor
  if (review.supervisor) {
    notifyEmployee(review.supervisor, {
      message: `${`${review.firstName} ${review.lastName}`.trim()} submitted a self-assessment for your review`,
      action: 'PersonalPerformance', type: 'performance', fromUser: req.user?.id,
    });
  }
  if (review.sup_email) {
    sendPerformanceEmail({
      to: review.sup_email,
      name: `${review.sup_first ?? ''} ${review.sup_last ?? ''}`.trim(),
      action: 'SUPERVISOR_NOTIFY',
      cycleName: review.cycle_name,
      employeeName: `${review.firstName} ${review.lastName}`.trim(),
      dueDate: review.supervisor_due,
    }).catch(e => console.error('[PerfEmail]', e.message));
  }

  respond.ok(res, 'Self assessment submitted');
});

// POST /performance/reviews/:id/supervisor — supervisor submits their review; moves to 'Supervisor Review'
// and notifies the first 5 admin/super-admin users (HR) to complete the final stage.
const submitSupervisorReview = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [review] = await query`
    SELECT pr.*, pc.name AS cycle_name, pc.hr_due FROM performance_review pr
     LEFT JOIN performance_cycle pc ON pc.id = pr.cycle_id
     WHERE pr.id = ${id} LIMIT 1`;
  if (!review) return respond.notFound(res, 'Review not found');
  if (review.status !== 'Self Assessment') return respond.badReq(res, 'Review is not in Self Assessment stage');

  const { supervisor_score, supervisor_comments, strengths, improvements } = req.body;
  // Use the employee ID from the token (not req.user.id which is the users-table ID)
  const supEmpId = toBigInt(req.user?.employee_id || req.user?.employeeId || req.user?.employee);
  const supId = supEmpId ?? toBigInt(review.supervisor);
  const ts = now();

  await exec`
    UPDATE performance_review SET supervisor_score=${supervisor_score ? Number(supervisor_score) : null},
      supervisor_comments=${supervisor_comments?.trim() || null}, strengths=${strengths?.trim() || null},
      improvements=${improvements?.trim() || null}, supervisor_reviewed=${ts}, supervisor=${supId},
      status='Supervisor Review', updated_at=${ts} WHERE id=${id}`;

  logActivity({
    module: 'Performance', action: 'supervisor_review',
    entityId: String(id), ...fromReq(req),
  });

  notifyUsersWithPermission('review_performance', {
    message: 'A performance review is ready for HR sign-off',
    action: 'ManagePerformance', type: 'performance', fromUser: req.user?.id,
  }, req.user?.id);

  // Notify HR: fetch HR emails from users with admin/hr role
  const hrUsers = await query`
    SELECT u.id, e.work_email, e.email, e.firstName, e.lastName
     FROM users u
     LEFT JOIN employee e ON e.id = u.employee
     WHERE u.status = '1' AND (
       u.id IN (SELECT user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name IN ('admin','super-admin'))
     ) LIMIT 5`
  .catch(() => []);

  for (const hr of hrUsers) {
    const to = hr.work_email || hr.email;
    if (!to) continue;
    sendPerformanceEmail({
      to, name: `${hr.firstName ?? ''} ${hr.lastName ?? ''}`.trim(),
      action: 'HR_NOTIFY', cycleName: review.cycle_name, dueDate: review.hr_due,
    }).catch(e => console.error('[PerfEmail]', e.message));
  }

  respond.ok(res, 'Supervisor review submitted');
});

// POST /performance/reviews/:id/hr — HR submits the final review; auto-calculates overall_score as the
// average of self, supervisor, and HR scores (clamped 0–5), marks review 'Completed', and emails the employee.
const submitHRReview = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [review] = await query`
    SELECT pr.*, e.work_email, e.email, e.firstName, e.lastName, pc.name AS cycle_name
     FROM performance_review pr
     LEFT JOIN employee e ON e.id = pr.employee
     LEFT JOIN performance_cycle pc ON pc.id = pr.cycle_id
     WHERE pr.id = ${id} LIMIT 1`;
  if (!review) return respond.notFound(res, 'Review not found');
  if (review.status !== 'Supervisor Review') return respond.badReq(res, 'Review is not in Supervisor Review stage');

  const { hr_score, hr_comments, overall_score, development_plan } = req.body;
  const hrEmpId = toBigInt(req.user?.employee_id || req.user?.employeeId || req.user?.employee);
  const hrId = hrEmpId;
  const ts   = now();

  const clamp   = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  // Handles plain numbers, Prisma.Decimal instances, and {s,e,d} plain objects
  // produced by the old s() serialiser before it was fixed.
  const toFloat = v => {
    if (!v && v !== 0) return NaN;
    if (typeof v === 'number') return v;
    if (typeof v === 'object') {
      if (typeof v.toNumber === 'function') return v.toNumber();   // Decimal instance
      if (Array.isArray(v.d) && v.d.length > 0)                   // plain {s,e,d} object
        return (v.s < 0 ? -1 : 1) * Number(v.d[0]);
    }
    return parseFloat(String(v));
  };

  // Average all scores that were actually provided; HR score is optional
  const scores = [review.self_score, review.supervisor_score, hr_score]
    .map(toFloat)
    .filter(n => !isNaN(n) && n > 0);

  const rawOverall = overall_score
    ? toFloat(overall_score)
    : scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const overall = rawOverall != null && !isNaN(rawOverall) ? clamp(rawOverall, 0, 5) : null;

  await exec`
    UPDATE performance_review SET hr_score=${hr_score ? clamp(Number(hr_score), 1, 5) : null}, hr_comments=${hr_comments?.trim() || null},
      overall_score=${overall}, development_plan=${development_plan?.trim() || null}, hr_reviewed=${ts}, hr_reviewer=${hrId},
      status='HR Review', updated_at=${ts} WHERE id=${id}`;

  // Second exec to mark Completed
  await exec`UPDATE performance_review SET status='Completed', updated_at=${ts} WHERE id=${id}`;

  logActivity({
    module: 'Performance', action: 'hr_review',
    entityId: String(id), entityName: `${review.firstName} ${review.lastName}`.trim(),
    ...fromReq(req),
  });

  notifyEmployee(review.employee, {
    message: `Your performance review for "${review.cycle_name}" is complete`,
    action: 'PersonalPerformance', type: 'performance', fromUser: req.user?.id,
  });

  const to = review.work_email || review.email;
  if (to) {
    sendPerformanceEmail({
      to, name: `${review.firstName} ${review.lastName}`.trim(),
      action: 'REVIEW_COMPLETED', cycleName: review.cycle_name,
    }).catch(e => console.error('[PerfEmail]', e.message));
  }

  respond.ok(res, 'Review completed');
});

// ─── GOALS ────────────────────────────────────────────────────────────────────

// GET /performance/goals — list goals filterable by employee, cycle, or status; resolves employee name.
const getGoals = asyncHandler(async (req, res) => {
  const { employee_id, cycle_id, status } = req.query;
  const conds = [Prisma.sql`1=1`];
  if (employee_id) conds.push(Prisma.sql`g.employee = ${toBigInt(employee_id)}`);
  if (cycle_id)    conds.push(Prisma.sql`g.cycle_id = ${toBigInt(cycle_id)}`);
  if (status)      conds.push(Prisma.sql`g.status = ${status}`);
  const where = Prisma.join(conds, ' AND ');

  const rows = await query`
    SELECT g.*, e.firstName, e.lastName, e.employee_id AS emp_code, pc.name AS cycle_name
     FROM performance_goal g
     LEFT JOIN employee e ON e.id = g.employee
     LEFT JOIN performance_cycle pc ON pc.id = g.cycle_id
     WHERE ${where}
     ORDER BY g.due_date, g.title`;

  respond.ok(res, 'Goals retrieved', rows.map(r => ({
    ...r,
    employee: { id: String(r.employee), name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(), employee_id: r.emp_code },
    firstName: undefined, lastName: undefined, emp_code: undefined,
  })));
});

// POST /performance/goals — create a goal for an employee; supports weight, target, actual_result, and cycle linkage.
// Numeric score fields (employee_score, supervisor_score, hr_score) are set later during the review process.
const createGoal = asyncHandler(async (req, res) => {
  const { employee_id, cycle_id, title, description, weight, target, actual_result, progress_note, status = 'Active', due_date, achievement, source = 'hr', comment, document_ref } = req.body;
  if (!employee_id)    return respond.badReq(res, 'Employee is required');
  if (!title?.trim())  return respond.badReq(res, 'Title is required');

  const empId = toBigInt(employee_id);
  await exec`
    INSERT INTO performance_goal (employee, cycle_id, title, description, weight, target, actual_result, progress_note, status, due_date, achievement, source, comment, document_ref, created_at, updated_at)
     VALUES (${empId}, ${cycle_id ? toBigInt(cycle_id) : null}, ${title.trim()}, ${description?.trim() || null}, ${weight ?? null},
             ${target?.trim() || null}, ${actual_result?.trim() || null}, ${progress_note?.trim() || null}, ${status},
             ${toDate(due_date)}, ${achievement || null}, ${source}, ${comment?.trim() || null}, ${document_ref?.trim() || null},
             ${now()}, ${now()})`;
  const [created] = await query`SELECT * FROM performance_goal ORDER BY id DESC LIMIT 1`;
  respond.created(res, 'Goal created', created);
});

// PUT /performance/goals/:id — patch any goal field; undefined-safe fallback preserves existing values.
// Used by employees to record actual_result and employee_score, by supervisors to set supervisor_score,
// and by HR to set hr_score.
const updateGoal = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [ex] = await query`SELECT * FROM performance_goal WHERE id = ${id} LIMIT 1`;
  if (!ex) return respond.notFound(res, 'Goal not found');

  const { title, description, weight, target, actual_result, progress_note, status, due_date, achievement, employee_score, supervisor_score, hr_score, comment, supervisor_comment, hr_comment, document_ref } = req.body;
  await exec`
    UPDATE performance_goal SET
      title=${title?.trim() ?? ex.title},
      description=${description?.trim() != null ? (description?.trim() || null) : ex.description},
      weight=${weight != null ? weight : ex.weight},
      target=${target?.trim() != null ? (target?.trim() || null) : ex.target},
      actual_result=${actual_result != null ? (actual_result?.trim() || null) : ex.actual_result},
      progress_note=${progress_note?.trim() != null ? (progress_note?.trim() || null) : ex.progress_note},
      status=${status ?? ex.status},
      due_date=${toDate(due_date != null ? (due_date || null) : ex.due_date)},
      achievement=${achievement != null ? (achievement || null) : ex.achievement},
      employee_score=${employee_score != null ? employee_score : ex.employee_score},
      supervisor_score=${supervisor_score != null ? supervisor_score : ex.supervisor_score},
      hr_score=${hr_score != null ? hr_score : ex.hr_score},
      comment=${comment != null ? (comment?.trim() || null) : ex.comment},
      supervisor_comment=${supervisor_comment != null ? (supervisor_comment?.trim() || null) : ex.supervisor_comment},
      hr_comment=${hr_comment != null ? (hr_comment?.trim() || null) : ex.hr_comment},
      document_ref=${document_ref != null ? (document_ref?.trim() || null) : ex.document_ref},
      updated_at=${now()}
     WHERE id=${id}`;
  const [updated] = await query`SELECT * FROM performance_goal WHERE id = ${id} LIMIT 1`;
  respond.ok(res, 'Goal updated', updated);
});

// POST /performance/goals/:id/upload — attach a supporting document to a goal; stores the uploaded filename as document_ref.
const uploadGoalDocument = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid goal ID');
  if (!req.file) return respond.badReq(res, 'No file provided');

  const [ex] = await query`SELECT id, document_ref FROM performance_goal WHERE id = ${id} LIMIT 1`;
  if (!ex) return respond.notFound(res, 'Goal not found');

  await exec`UPDATE performance_goal SET document_ref=${req.file.filename}, updated_at=${now()} WHERE id=${id}`;
  respond.ok(res, 'Document uploaded', { document_ref: req.file.filename });
});

// DELETE /performance/goals/:id — permanently remove a goal record.
const deleteGoal = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await exec`DELETE FROM performance_goal WHERE id = ${id}`;
  respond.ok(res, 'Goal deleted');
});

// ─── COMPETENCIES ─────────────────────────────────────────────────────────────

// GET /performance/competencies — list all active competency definitions ordered by category and name.
const getCompetencies = asyncHandler(async (_req, res) => {
  const rows = await query`SELECT * FROM performance_competency WHERE is_active = TRUE ORDER BY category, name`;
  respond.ok(res, 'Competencies retrieved', rows);
});

// POST /performance/competencies — create a new active competency with a name, category, and optional description.
const createCompetency = asyncHandler(async (req, res) => {
  const { name, category, description } = req.body;
  if (!name?.trim())     return respond.badReq(res, 'Name is required');
  if (!category?.trim()) return respond.badReq(res, 'Category is required');
  await exec`
    INSERT INTO performance_competency (name, category, description, is_active)
     VALUES (${name.trim()}, ${category.trim()}, ${description?.trim() || null}, TRUE)`;
  const [created] = await query`SELECT * FROM performance_competency ORDER BY id DESC LIMIT 1`;
  respond.created(res, 'Competency created', created);
});

// PUT /performance/competencies/:id — update a competency's name, category, description, or active status.
const updateCompetency = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const [ex] = await query`SELECT * FROM performance_competency WHERE id = ${id} LIMIT 1`;
  if (!ex) return respond.notFound(res, 'Competency not found');

  const { name, category, description, is_active } = req.body;
  await exec`
    UPDATE performance_competency SET
      name=${name?.trim() ?? ex.name},
      category=${category?.trim() ?? ex.category},
      description=${description?.trim() != null ? (description?.trim() || null) : ex.description},
      is_active=${is_active != null ? !!is_active : !!ex.is_active}
     WHERE id=${id}`;
  const [updated] = await query`SELECT * FROM performance_competency WHERE id = ${id} LIMIT 1`;
  respond.ok(res, 'Competency updated', updated);
});

// POST /performance/reviews/:id/ratings — upsert competency ratings for a review; each entry in the ratings
// array can carry self, supervisor, and HR rating values and comments, merged into a single row per competency.
const saveCompRatings = asyncHandler(async (req, res) => {
  const reviewId = toBigInt(req.params.id);
  if (!reviewId) return respond.badReq(res, 'Invalid review ID');
  const { ratings } = req.body; // [{ competency_id, self_rating?, supervisor_rating?, hr_rating?, self_comment?, supervisor_comment?, hr_comment? }]
  if (!Array.isArray(ratings)) return respond.badReq(res, 'ratings array is required');

  for (const r of ratings) {
    const compId = toBigInt(r.competency_id);
    if (!compId) continue;
    const [existing] = await query`SELECT id FROM performance_comp_rating WHERE review_id = ${reviewId} AND competency_id = ${compId} LIMIT 1`;
    if (existing) {
      await exec`
        UPDATE performance_comp_rating SET
          self_rating=${r.self_rating ?? null}, supervisor_rating=${r.supervisor_rating ?? null}, hr_rating=${r.hr_rating ?? null},
          self_comment=${r.self_comment?.trim() || null}, supervisor_comment=${r.supervisor_comment?.trim() || null}, hr_comment=${r.hr_comment?.trim() || null}
         WHERE id=${toBigInt(existing.id)}`;
    } else {
      await exec`
        INSERT INTO performance_comp_rating (review_id, competency_id, self_rating, supervisor_rating, hr_rating, self_comment, supervisor_comment, hr_comment)
         VALUES (${reviewId}, ${compId}, ${r.self_rating ?? null}, ${r.supervisor_rating ?? null}, ${r.hr_rating ?? null},
                 ${r.self_comment?.trim() || null}, ${r.supervisor_comment?.trim() || null}, ${r.hr_comment?.trim() || null})`;
    }
  }
  respond.ok(res, 'Ratings saved');
});

module.exports = {
  getPerformanceMeta,
  getAllCycles, getCycleById, createCycle, updateCycle, deleteCycle, addEmployeesToCycle, removeEmployeeFromCycle, activateCycle, closeCycle,
  getAllReviews, getMyReviews, getTeamReviews, getReviewById, updateReview,
  submitSelfAssessment, submitSupervisorReview, submitHRReview,
  getGoals, createGoal, updateGoal, deleteGoal, uploadGoalDocument,
  getCompetencies, createCompetency, updateCompetency, saveCompRatings,
};
