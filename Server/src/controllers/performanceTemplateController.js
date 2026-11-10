// Goal templates: a named set of goals (e.g. "Teller KPIs 2027") that HR assigns to a performance cycle
// for a group of employees at once, instead of one goal and one employee at a time.
//
// Assigning gives every employee their OWN copy of each goal in performance_goal, because each copy is
// scored separately. The copies keep template_id / template_item_id, so editing the template reaches the
// copies nobody has started on: a copy is left alone once it has any score or actual result, once the
// employee's review has left 'Not Started', or once its cycle is Closed.
//
// Tables come from manual-migrations/20261110_performance_goal_templates.*.sql and are read with raw
// SQL, so this module needs no regenerated Prisma client. Ids are generated here (as out of station does).
const { Prisma }   = require('@prisma/client');
const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const { toBigInt, s, toDate } = require('../helpers/controllerHelpers');
const { logActivity, fromReq } = require('./auditController');
const { notifyEmployee } = require('../helpers/notificationHelper');

let idSeq = 0;
const newId = () => { idSeq = (idSeq + 1) % 1000; return BigInt(Date.now()) * 1000n + BigInt(idSeq); };
const BATCH = 500;   // rows per multi-row INSERT

const NOT_MIGRATED = 'Goal templates are not set up on this database yet. Run manual-migrations/20261110_performance_goal_templates on it, then try again.';
const isMissingTable = (e) => /does not exist|doesn't exist|Unknown column|42P01|42703|P2010/i.test(String(e?.message ?? '') + String(e?.code ?? ''));

/** Wrap a handler so a database without the template tables gets a clear message, not a 500. */
const guarded = (fn) => asyncHandler(async (req, res, next) => {
  try { return await fn(req, res, next); }
  catch (e) {
    if (isMissingTable(e)) return respond.badReq(res, NOT_MIGRATED);
    throw e;
  }
});

// A copy still untouched by the employee, supervisor and HR.
const UNSCORED = Prisma.sql`performance_goal.employee_score IS NULL AND performance_goal.supervisor_score IS NULL
  AND performance_goal.hr_score IS NULL AND performance_goal.actual_result IS NULL`;
// Its cycle is open and the employee's review has not started.
const EDITABLE = Prisma.sql`EXISTS (SELECT 1 FROM performance_cycle c WHERE c.id = performance_goal.cycle_id AND c.status <> 'Closed')
  AND NOT EXISTS (SELECT 1 FROM performance_review r WHERE r.cycle_id = performance_goal.cycle_id
                    AND r.employee = performance_goal.employee AND r.status <> 'Not Started')`;

/** Validate and normalise the goals of a template. Returns { items } or { error }. */
function cleanItems(raw) {
  if (!Array.isArray(raw) || !raw.length) return { error: 'Add at least one goal to the template' };
  const items = [];
  for (const [i, it] of raw.entries()) {
    const title = String(it?.title ?? '').trim();
    if (!title) return { error: `Goal ${i + 1} needs a title` };
    if (title.length > 200) return { error: `Goal ${i + 1}: the title is longer than 200 characters` };
    let weight = null;
    if (it.weight !== undefined && it.weight !== null && it.weight !== '') {
      weight = Number(it.weight);
      if (!Number.isInteger(weight) || weight < 0 || weight > 100) return { error: `Goal ${i + 1}: weight must be a whole number from 0 to 100` };
    }
    const target = String(it.target ?? '').trim();
    if (target.length > 300) return { error: `Goal ${i + 1}: the target is longer than 300 characters` };
    items.push({
      id: it.id != null && it.id !== '' ? String(it.id) : null,
      title, weight, target: target || null,
      description: String(it.description ?? '').trim() || null,
      sort_order: i,
    });
  }
  return { items };
}

async function readTemplate(id) {
  const [tpl] = await prisma.$queryRaw`SELECT * FROM performance_goal_template WHERE id = ${id}`;
  if (!tpl) return null;
  const items = await prisma.$queryRaw`
    SELECT * FROM performance_goal_template_item WHERE template_id = ${id} ORDER BY sort_order, id`;
  return { ...tpl, items };
}

// GET /performance/goal-templates — every template with its goals and how widely it is assigned.
exports.listTemplates = guarded(async (_req, res) => {
  const tpls  = await prisma.$queryRaw`SELECT * FROM performance_goal_template ORDER BY name`;
  const items = await prisma.$queryRaw`SELECT * FROM performance_goal_template_item ORDER BY sort_order, id`;
  const usage = await prisma.$queryRaw`
    SELECT template_id, COUNT(DISTINCT employee) AS employees, COUNT(DISTINCT cycle_id) AS cycles
      FROM performance_goal WHERE template_id IS NOT NULL GROUP BY template_id`;
  const byTpl = new Map();
  for (const it of items) {
    const k = String(it.template_id);
    if (!byTpl.has(k)) byTpl.set(k, []);
    byTpl.get(k).push(it);
  }
  const use = new Map(usage.map(u => [String(u.template_id), { employees: Number(u.employees), cycles: Number(u.cycles) }]));
  respond.ok(res, 'Goal templates', s(tpls.map(t => ({
    ...t,
    items: byTpl.get(String(t.id)) ?? [],
    usage: use.get(String(t.id)) ?? { employees: 0, cycles: 0 },
  }))));
});

// POST /performance/goal-templates — { name, description, items: [{ title, description, weight, target }] }
exports.createTemplate = guarded(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return respond.badReq(res, 'Template name is required');
  if (name.length > 150) return respond.badReq(res, 'Template name is longer than 150 characters');
  const { items, error } = cleanItems(req.body?.items);
  if (error) return respond.badReq(res, error);

  const id = newId();
  const ts = new Date();
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO performance_goal_template (id, name, description, created_by, created_at, updated_at)
      VALUES (${id}, ${name}, ${String(req.body?.description ?? '').trim() || null}, ${toBigInt(req.user?.id) ?? null}, ${ts}, ${ts})`,
    ...items.map(it => prisma.$executeRaw`
      INSERT INTO performance_goal_template_item (id, template_id, title, description, weight, target, sort_order)
      VALUES (${newId()}, ${id}, ${it.title}, ${it.description}, ${it.weight}, ${it.target}, ${it.sort_order})`),
  ]);
  logActivity({ module: 'Performance', action: 'create_goal_template', entityId: String(id), entityName: name, ...fromReq(req) });
  respond.created(res, 'Template created', s(await readTemplate(id)));
});

// PUT /performance/goal-templates/:id — rename, and add / edit / remove goals. Items carrying an `id` are
// edited, items without one are added, and existing items left out are removed. The change is then
// carried to every copy nobody has started on (see the header).
exports.updateTemplate = guarded(async (req, res) => {
  const id = toBigInt(req.params.id);
  const current = id ? await readTemplate(id) : null;
  if (!current) return respond.notFound(res, 'Template not found');

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : current.name;
  if (!name) return respond.badReq(res, 'Template name is required');
  const { items, error } = cleanItems(req.body?.items);
  if (error) return respond.badReq(res, error);

  const known   = new Set(current.items.map(it => String(it.id)));
  const kept    = items.filter(it => it.id && known.has(it.id));
  const added   = items.filter(it => !it.id || !known.has(it.id)).map(it => ({ ...it, id: String(newId()) }));
  const keptIds = new Set(kept.map(it => it.id));
  const removed = current.items.filter(it => !keptIds.has(String(it.id))).map(it => toBigInt(it.id));

  // Assignments the change may still reach, with the due date their copies already carry.
  const reachable = await prisma.$queryRaw`
    SELECT employee, cycle_id, MAX(due_date) AS due_date
      FROM performance_goal
     WHERE template_id = ${id} AND ${EDITABLE}
     GROUP BY employee, cycle_id`;
  const [{ n: assignedPairs } = { n: 0 }] = await prisma.$queryRaw`
    SELECT COUNT(*) AS n FROM (SELECT DISTINCT employee, cycle_id FROM performance_goal WHERE template_id = ${id}) t`;

  const ts = new Date();
  const ops = [
    prisma.$executeRaw`UPDATE performance_goal_template SET name = ${name},
      description = ${req.body?.description !== undefined ? (String(req.body.description).trim() || null) : current.description},
      updated_at = ${ts} WHERE id = ${id}`,
  ];
  for (const it of kept) {
    ops.push(prisma.$executeRaw`UPDATE performance_goal_template_item
      SET title = ${it.title}, description = ${it.description}, weight = ${it.weight}, target = ${it.target}, sort_order = ${it.sort_order}
      WHERE id = ${toBigInt(it.id)}`);
    ops.push(prisma.$executeRaw`UPDATE performance_goal
      SET title = ${it.title}, description = ${it.description}, weight = ${it.weight}, target = ${it.target}, updated_at = ${ts}
      WHERE template_item_id = ${toBigInt(it.id)} AND ${UNSCORED} AND ${EDITABLE}`);
  }
  for (const it of added) {
    ops.push(prisma.$executeRaw`INSERT INTO performance_goal_template_item (id, template_id, title, description, weight, target, sort_order)
      VALUES (${toBigInt(it.id)}, ${id}, ${it.title}, ${it.description}, ${it.weight}, ${it.target}, ${it.sort_order})`);
  }
  if (removed.length) {
    ops.push(prisma.$executeRaw`DELETE FROM performance_goal
      WHERE template_item_id IN (${Prisma.join(removed)}) AND ${UNSCORED} AND ${EDITABLE}`);
    ops.push(prisma.$executeRaw`DELETE FROM performance_goal_template_item WHERE id IN (${Prisma.join(removed)})`);
  }
  // New goals reach the assignments that have not started.
  const newRows = [];
  for (const pair of reachable) for (const it of added) newRows.push(goalRow(pair.employee, pair.cycle_id, id, it, pair.due_date, ts));
  for (let i = 0; i < newRows.length; i += BATCH) ops.push(insertGoals(newRows.slice(i, i + BATCH)));

  const results = await prisma.$transaction(ops);
  const changed = results.slice(1).reduce((n, r) => n + (typeof r === 'number' ? r : 0), 0);

  logActivity({ module: 'Performance', action: 'update_goal_template', entityId: String(id), entityName: name,
    details: { kept: kept.length, added: added.length, removed: removed.length }, ...fromReq(req) });

  const lockedPairs = Number(assignedPairs) - reachable.length;
  respond.ok(res, lockedPairs > 0
    ? `Template saved. ${lockedPairs} assignment(s) whose review has started or whose cycle is closed were left as they were.`
    : 'Template saved', s({ ...(await readTemplate(id)), applied_to: reachable.length, locked: lockedPairs, rows_changed: changed }));
});

// DELETE /performance/goal-templates/:id — the goals already given to employees stay; they are only unlinked.
exports.deleteTemplate = guarded(async (req, res) => {
  const id = toBigInt(req.params.id);
  const current = id ? await readTemplate(id) : null;
  if (!current) return respond.notFound(res, 'Template not found');
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE performance_goal SET template_id = NULL, template_item_id = NULL WHERE template_id = ${id}`,
    prisma.$executeRaw`DELETE FROM performance_goal_template_item WHERE template_id = ${id}`,
    prisma.$executeRaw`DELETE FROM performance_goal_template WHERE id = ${id}`,
  ]);
  logActivity({ module: 'Performance', action: 'delete_goal_template', entityId: String(id), entityName: current.name, ...fromReq(req) });
  respond.ok(res, 'Template deleted. Goals already assigned from it were kept.');
});

function goalRow(employee, cycleId, templateId, it, dueDate, ts) {
  return Prisma.sql`(${toBigInt(employee)}, ${toBigInt(cycleId)}, ${it.title}, ${it.description}, ${it.weight}, ${it.target},
    'Active', ${dueDate ?? null}, 'template', ${templateId}, ${toBigInt(it.id)}, ${ts}, ${ts})`;
}
function insertGoals(rows) {
  return prisma.$executeRaw`INSERT INTO performance_goal
    (employee, cycle_id, title, description, weight, target, status, due_date, source, template_id, template_item_id, created_at, updated_at)
    VALUES ${Prisma.join(rows)}`;
}

// POST /performance/goal-templates/:id/assign — { cycle_id, employee_ids: [], due_date? }
// Gives each employee a copy of every goal in the template, linked to the cycle, and adds anyone not yet
// in the cycle to it (a goal outside the employee's review would never be seen or scored). Employees who
// already have this template in this cycle are skipped, so assigning twice is harmless.
exports.assignTemplate = guarded(async (req, res) => {
  const id = toBigInt(req.params.id);
  const tpl = id ? await readTemplate(id) : null;
  if (!tpl) return respond.notFound(res, 'Template not found');
  if (!tpl.items.length) return respond.badReq(res, 'This template has no goals');

  const cycleId = toBigInt(req.body?.cycle_id);
  if (!cycleId) return respond.badReq(res, 'Choose the cycle to assign the goals to');
  const [cycle] = await prisma.$queryRaw`SELECT id, name, status FROM performance_cycle WHERE id = ${cycleId}`;
  if (!cycle) return respond.notFound(res, 'Cycle not found');
  if (cycle.status === 'Closed') return respond.badReq(res, `"${cycle.name}" is closed — goals cannot be added to it`);

  const requested = [...new Set((Array.isArray(req.body?.employee_ids) ? req.body.employee_ids : []).map(String))]
    .map(toBigInt).filter(Boolean);
  if (!requested.length) return respond.badReq(res, 'Choose at least one employee');
  const dueDate = req.body?.due_date ? toDate(req.body.due_date) : null;

  // Only active, approved employees may be in a performance cycle.
  const emps = await prisma.employee.findMany({
    where: { id: { in: requested }, lifecycleStatus: 'ACTIVE', approvalStatus: 'APPROVED' },
    select: { id: true, supervisorId: true },
  });
  const valid = new Map(emps.map(e => [String(e.id), e]));
  const notEligible = requested.length - valid.size;

  const ids = [...valid.keys()].map(toBigInt);
  const already = ids.length ? await prisma.$queryRaw`
    SELECT DISTINCT employee FROM performance_goal
     WHERE template_id = ${id} AND cycle_id = ${cycleId} AND employee IN (${Prisma.join(ids)})` : [];
  const alreadySet = new Set(already.map(r => String(r.employee)));
  const targets = ids.filter(e => !alreadySet.has(String(e)));
  if (!targets.length) {
    return respond.badReq(res, alreadySet.size
      ? 'Every selected employee already has this template in this cycle'
      : 'None of the selected employees are active and approved');
  }

  const inCycle = await prisma.$queryRaw`
    SELECT employee FROM performance_review WHERE cycle_id = ${cycleId} AND employee IN (${Prisma.join(targets)})`;
  const inCycleSet = new Set(inCycle.map(r => String(r.employee)));
  const joining = targets.filter(e => !inCycleSet.has(String(e)));

  const ts = new Date();
  const ops = [];
  for (let i = 0; i < joining.length; i += BATCH) {
    const rows = joining.slice(i, i + BATCH).map(e => Prisma.sql`(${cycleId}, ${e},
      ${toBigInt(valid.get(String(e))?.supervisorId) ?? null}, 'Not Started', ${ts}, ${ts})`);
    ops.push(prisma.$executeRaw`INSERT INTO performance_review (cycle_id, employee, supervisor, status, created_at, updated_at)
      VALUES ${Prisma.join(rows)}`);
  }
  const goalRows = [];
  for (const e of targets) for (const it of tpl.items) goalRows.push(goalRow(e, cycleId, id, { ...it, id: it.id }, dueDate, ts));
  for (let i = 0; i < goalRows.length; i += BATCH) ops.push(insertGoals(goalRows.slice(i, i + BATCH)));
  await prisma.$transaction(ops);

  // Joining an open cycle late: tell them, as activation does for everyone else.
  if (cycle.status === 'Active') {
    for (const e of joining) notifyEmployee(e, {
      message: `You have been added to the performance review "${cycle.name}"`,
      action: 'PersonalPerformance', type: 'performance', fromUser: req.user?.id,
    });
  }

  logActivity({ module: 'Performance', action: 'assign_goal_template', entityId: String(id), entityName: tpl.name,
    details: { cycle: String(cycleId), employees: targets.length, goals: goalRows.length, added_to_cycle: joining.length }, ...fromReq(req) });

  const parts = [`${tpl.items.length} goal(s) assigned to ${targets.length} employee(s)`];
  if (joining.length)  parts.push(`${joining.length} added to the cycle`);
  if (alreadySet.size) parts.push(`${alreadySet.size} skipped — already had this template`);
  if (notEligible)     parts.push(`${notEligible} skipped — not active and approved`);
  respond.ok(res, parts.join('; '), {
    employees: targets.length, goals: goalRows.length, added_to_cycle: joining.length,
    skipped_existing: alreadySet.size, skipped_ineligible: notEligible,
  });
});
