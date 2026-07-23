const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');

const { serialize, toBigInt } = require('../helpers/controllerHelpers');
const { tmsg } = require('../helpers/messageStore');

function toInt(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDecimalString(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

const { Prisma } = require('@prisma/client'); // Prisma.sql / Prisma.join for portable dynamic SQL

// Tagged-template query helpers — portable (Prisma emits the right placeholders per provider).
// Call as query`SELECT ... ${value}` (values become bound parameters).
async function query(strings, ...values) {
  return serialize(await prisma.$queryRaw(strings, ...values));
}

async function exec(strings, ...values) {
  return prisma.$executeRaw(strings, ...values);
}

// GET /salary/component-types — list all salary component type categories (e.g. Basic, Allowance, Deduction).
// Uses raw SQL because the Prisma model for salarycomponenttype is @@ignore.
const getSalaryComponentTypes = asyncHandler(async (_req, res) => {
  const rows = await query`SELECT id, code, name, description FROM salarycomponenttype ORDER BY name ASC`;
  respond.ok(res, 'Salary component types retrieved', rows);
});

// POST /salary/component-types — create a new salary component type; enforces unique code.
const createSalaryComponentType = asyncHandler(async (req, res) => {
  const { code, name, description } = req.body;
  if (!code?.trim()) return respond.badReq(res, 'Code is required');
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const dup = await query`SELECT id FROM salarycomponenttype WHERE UPPER(code) = UPPER(${code.trim()}) LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'Component type code already exists');

  const nextId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM salarycomponenttype`)[0].nextId);
  await exec`INSERT INTO salarycomponenttype (id, code, name, description)
    VALUES (${nextId}, ${code.trim().toUpperCase()}, ${name.trim()}, ${description?.trim() || null})`;
  const [created] = await query`SELECT id, code, name, description FROM salarycomponenttype WHERE id = ${nextId}`;
  respond.created(res, 'Salary component type created', created);
});

// PUT /salary/component-types/:id — update a salary component type; blocks duplicate codes.
const updateSalaryComponentType = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid component type ID');
  const { code, name, description } = req.body;
  if (!code?.trim()) return respond.badReq(res, 'Code is required');
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const existing = await query`SELECT id FROM salarycomponenttype WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Salary component type not found');
  const dup = await query`SELECT id FROM salarycomponenttype WHERE UPPER(code) = UPPER(${code.trim()}) AND id <> ${id} LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'Component type code already exists');

  await exec`UPDATE salarycomponenttype SET code = ${code.trim().toUpperCase()}, name = ${name.trim()}, description = ${description?.trim() || null} WHERE id = ${id}`;
  const [updated] = await query`SELECT id, code, name, description FROM salarycomponenttype WHERE id = ${id}`;
  respond.ok(res, 'Salary component type updated', updated);
});

// DELETE /salary/component-types/:id — delete a component type; blocked if any salary components use it.
const deleteSalaryComponentType = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid component type ID');
  const inUse = await prisma.salarycomponent.count({ where: { componentType: id } });
  if (inUse) return respond.badReq(res, 'Cannot delete: component type is used by salary components');
  await exec`DELETE FROM salarycomponenttype WHERE id = ${id}`;
  respond.ok(res, 'Salary component type deleted', null);
});

// GET /salary/components — list all salary components joined with their type name.
const getSalaryComponents = asyncHandler(async (_req, res) => {
  const rows = await query`
    SELECT sc.id, sc.name, sc.salarycomp_gl, sc.branch, sc.summary, sc.processing_code,
           sc.componentType, sc.details, sc.is_notch_linked,
           sct.name AS componentTypeName
    FROM salarycomponent sc
    LEFT JOIN salarycomponenttype sct ON sct.id = sc.componentType
    ORDER BY sc.name ASC`;
  respond.ok(res, 'Salary components retrieved', rows);
});

// POST /salary/components — create a salary component; marks it notch-linked (clearing any prior notch link) if flagged.
const createSalaryComponent = asyncHandler(async (req, res) => {
  const { name, componentType, details, salarycomp_gl, branch, summary, processing_code, is_notch_linked } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');
  const isNotchLinked = !!is_notch_linked; // Boolean column — pass a real boolean for PG portability
  if (isNotchLinked) {
    await exec`UPDATE salarycomponent SET is_notch_linked = FALSE`;
  }
  await exec`
    INSERT INTO salarycomponent (name, componentType, details, salarycomp_gl, branch, summary, processing_code, is_notch_linked)
     VALUES (${name.trim()}, ${toBigInt(componentType)}, ${details?.trim() || null}, ${salarycomp_gl?.trim() || null},
             ${branch?.trim() || null}, ${summary?.trim() || null}, ${processing_code?.trim() || null}, ${isNotchLinked})`;
  const [row] = await query`
    SELECT sc.id, sc.name, sc.salarycomp_gl, sc.branch, sc.summary, sc.processing_code,
            sc.componentType, sc.details, sc.is_notch_linked,
            sct.name AS componentTypeName
     FROM salarycomponent sc
     LEFT JOIN salarycomponenttype sct ON sct.id = sc.componentType
     ORDER BY sc.id DESC LIMIT 1`;
  respond.created(res, 'Salary component created', row);
});

// PUT /salary/components/:id — update a salary component and cascade-rename its reference in payrollcolumns
// and savedcalculations so existing payroll configs stay consistent after a name change.
const updateSalaryComponent = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid salary component ID');
  const [existing] = await query`SELECT id, name, is_notch_linked FROM salarycomponent WHERE id = ${id} LIMIT 1`;
  if (!existing) return respond.notFound(res, 'Salary component not found');
  const { name, componentType, details, salarycomp_gl, branch, summary, processing_code, is_notch_linked } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const isNotchLinked = !!is_notch_linked; // Boolean column — pass a real boolean for PG portability
  if (isNotchLinked) {
    await exec`UPDATE salarycomponent SET is_notch_linked = FALSE WHERE id != ${id}`;
  }

  await exec`
    UPDATE salarycomponent
     SET name=${name.trim()}, componentType=${toBigInt(componentType)}, details=${details?.trim() || null},
         salarycomp_gl=${salarycomp_gl?.trim() || null}, branch=${branch?.trim() || null}, summary=${summary?.trim() || null},
         processing_code=${processing_code?.trim() || null}, is_notch_linked=${isNotchLinked}
     WHERE id=${id}`;

  // Cascade rename into places that still store the component name as a plain string.
  // (Payroll columns link components by id via payrollcolumn_components — no name stored there —
  // so only saved-calculation targets need updating.)
  const oldName = existing.name;
  const newName = name.trim();
  if (oldName !== newName) {
    await exec`UPDATE savedcalculations SET target_name = ${newName} WHERE target_type = 'component' AND LOWER(target_name) = LOWER(${oldName})`;
  }

  const [row] = await query`
    SELECT sc.id, sc.name, sc.salarycomp_gl, sc.branch, sc.summary, sc.processing_code,
            sc.componentType, sc.details, sc.is_notch_linked,
            sct.name AS componentTypeName
     FROM salarycomponent sc
     LEFT JOIN salarycomponenttype sct ON sct.id = sc.componentType
     WHERE sc.id = ${id}`;
  respond.ok(res, 'Salary component updated', row);
});

// DELETE /salary/components/:id — delete a salary component; blocked if it is assigned to any employee.
const deleteSalaryComponent = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid salary component ID');
  const inUse = await prisma.employeesalary.count({ where: { component: id } });
  if (inUse) return respond.badReq(res, 'Cannot delete: component is assigned to employees');
  await prisma.salarycomponent.delete({ where: { id } });
  respond.ok(res, 'Salary component deleted', null);
});

// GET /salary/employee-components — list all salary component assignments across every employee,
// joined with employee name/ID and component name.
const getEmployeeSalaryComponents = asyncHandler(async (_req, res) => {
  const rows = await query`
    SELECT es.id, es.employee, es.component, es.working_days, es.pay_frequency, es.currency,
           es.excluded,
           CONCAT(es.amount, '') AS amount,
           CONCAT(es.original_amount, '') AS original_amount,
           TRIM(CONCAT(COALESCE(e.firstName,''), ' ', COALESCE(e.lastName,''))) AS emp_name,
           e.employee_id,
           sc.name AS component_name
    FROM employeesalary es
    LEFT JOIN employee e ON e.id = es.employee
    LEFT JOIN salarycomponent sc ON sc.id = es.component
    ORDER BY es.id DESC
  `;
  const data = rows.map(r => ({
    ...r,
    employeeName: r.emp_name ? (r.emp_name + (r.employee_id ? ` (${r.employee_id})` : '')) : null,
    componentName: r.component_name ?? null,
  }));
  respond.ok(res, 'Employee salary components retrieved', data);
});

async function enrichEmployeeSalaries(rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const enriched = await query`
    SELECT es.id, es.employee, es.component, es.working_days, es.pay_frequency, es.currency,
           es.excluded,
           CONCAT(es.amount, '') AS amount,
           CONCAT(es.original_amount, '') AS original_amount,
           TRIM(CONCAT(COALESCE(e.firstName,''), ' ', COALESCE(e.lastName,''))) AS emp_name,
           e.employee_id,
           sc.name AS component_name
    FROM employeesalary es
    LEFT JOIN employee e ON e.id = es.employee
    LEFT JOIN salarycomponent sc ON sc.id = es.component
    WHERE es.id IN (${Prisma.join(ids.map(BigInt))})
  `;
  return enriched.map(r => ({
    ...r,
    employeeName: r.emp_name ? (r.emp_name + (r.employee_id ? ` (${r.employee_id})` : '')) : null,
    componentName: r.component_name ?? null,
  }));
}

// ── Salary history ────────────────────────────────────────────────────────────

async function recordHistory({ employeeId, componentId, componentName, action, oldAmount, newAmount, oldCurrency, newCurrency, changedBy }) {
  await exec`
    INSERT INTO salary_history (employee_id, component_id, component_name, action, old_amount, new_amount, old_currency, new_currency, changed_by)
     VALUES (${BigInt(employeeId)}, ${BigInt(componentId)}, ${componentName || null}, ${action},
             ${oldAmount || null}, ${newAmount || null}, ${oldCurrency || null}, ${newCurrency || null}, ${changedBy || null})`
    .catch(() => {});
}

// GET /salary/employee-history/:employeeId — retrieve the last 200 salary change events (create/update/delete)
// for a specific employee, useful for auditing pay adjustments over time.
const getEmployeeSalaryHistory = asyncHandler(async (req, res) => {
  const empId = toBigInt(req.params.employeeId);
  if (!empId) return respond.badReq(res, 'Invalid employee ID');
  const rows = await query`
    SELECT id, employee_id, component_id, component_name, action, old_amount, new_amount, old_currency, new_currency, changed_by, created_at
     FROM salary_history WHERE employee_id = ${empId} ORDER BY created_at DESC LIMIT 200`;
  respond.ok(res, 'Salary history retrieved', rows);
});

// POST /salary/employee-components — assign a salary component to an employee; blocks duplicate assignments
// and records a 'created' entry in salary_history for audit purposes.
const createEmployeeSalaryComponent = asyncHandler(async (req, res) => {
  const { employee, component, working_days, pay_frequency, currency, amount, excluded } = req.body;
  const employeeId = toBigInt(employee);
  const componentId = toBigInt(component);
  if (!employeeId) return respond.badReq(res, 'Employee is required');
  if (!componentId) return respond.badReq(res, 'Component is required');

  const duplicate = await query`SELECT id FROM employeesalary WHERE employee = ${employeeId} AND component = ${componentId} LIMIT 1`;
  if (duplicate.length) return respond.conflict(res, 'There is already an exception for this employee and component');

  const isExcluded = excluded === true || excluded === 1 || excluded === '1';
  const amountValue = isExcluded ? null : toDecimalString(amount);
  const originalAmount = amountValue === null ? null : String(Math.round(Number(amountValue)));
  const row = await prisma.employeesalary.create({
    data: {
      employee: employeeId,
      component: componentId,
      working_days: toInt(working_days),
      pay_frequency: pay_frequency || null,
      currency: toBigInt(currency),
      amount: amountValue,
      original_amount: originalAmount,
      excluded: isExcluded,
    },
  });
  const [enriched] = await enrichEmployeeSalaries([row]);
  await recordHistory({
    employeeId, componentId, componentName: enriched?.component_name,
    action: 'created', newAmount: amountValue,
    newCurrency: enriched?.currency ? String(enriched.currency) : null,
    changedBy: req.user?.username || req.user?.email || null,
  });
  respond.created(res, 'Employee salary component created', enriched);
});

// PUT /salary/employee-components/:id — update an employee's salary component assignment (amount, frequency, currency);
// records an 'updated' entry in salary_history capturing old vs new values.
const updateEmployeeSalaryComponent = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee salary component ID');
  const existing = await prisma.employeesalary.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'Employee salary component not found');
  const { employee, component, working_days, pay_frequency, currency, amount, excluded } = req.body;
  const employeeId = toBigInt(employee);
  const componentId = toBigInt(component);
  if (!employeeId) return respond.badReq(res, 'Employee is required');
  if (!componentId) return respond.badReq(res, 'Component is required');

  const duplicate = await query`SELECT id FROM employeesalary WHERE employee = ${employeeId} AND component = ${componentId} AND id <> ${id} LIMIT 1`;
  if (duplicate.length) return respond.conflict(res, 'There is already an exception for this employee and component');

  const isExcluded = excluded === true || excluded === 1 || excluded === '1';
  const amountValue = isExcluded ? null : toDecimalString(amount);
  const row = await prisma.employeesalary.update({
    where: { id },
    data: {
      employee: employeeId,
      component: componentId,
      working_days: toInt(working_days),
      pay_frequency: pay_frequency || null,
      currency: toBigInt(currency),
      amount: amountValue,
      excluded: isExcluded,
    },
  });
  const [enriched] = await enrichEmployeeSalaries([row]);
  await recordHistory({
    employeeId, componentId, componentName: enriched?.component_name,
    action: 'updated',
    oldAmount: existing.amount != null ? String(existing.amount) : null,
    newAmount: amountValue,
    oldCurrency: existing.currency ? String(existing.currency) : null,
    newCurrency: toBigInt(currency) ? String(toBigInt(currency)) : null,
    changedBy: req.user?.username || req.user?.email || null,
  });
  respond.ok(res, 'Employee salary component updated', enriched);
});

// DELETE /salary/employee-components/:id — remove a salary component from an employee and record a
// 'deleted' entry in salary_history to preserve the audit trail of what was removed.
const deleteEmployeeSalaryComponent = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid employee salary component ID');
  const existing = await prisma.employeesalary.findUnique({ where: { id } });
  if (existing) {
    const [comp] = await query`SELECT name FROM salarycomponent WHERE id = ${BigInt(existing.component)} LIMIT 1`;
    await recordHistory({
      employeeId: existing.employee, componentId: existing.component,
      componentName: comp?.name || null,
      action: 'deleted',
      oldAmount: existing.amount != null ? String(existing.amount) : null,
      oldCurrency: existing.currency ? String(existing.currency) : null,
      changedBy: req.user?.username || req.user?.email || null,
    });
  }
  await prisma.employeesalary.delete({ where: { id } });
  respond.ok(res, 'Employee salary component deleted', null);
});

// ── Grade/Notch component assignment (inherited by employees) ───────────────────
// Factory for the paygrade_components / notch_components CRUD (identical shape, different FK column).
function makeGradeComponentHandlers(table, fkCol, label) {
  // table / fkCol are fixed internal literals (see call sites below), safe to inline as identifiers.
  const tbl = Prisma.raw(table);
  const fk  = Prisma.raw(fkCol);

  const list = asyncHandler(async (req, res) => {
    const targetId = toBigInt(req.query.target_id);
    const where = targetId ? Prisma.sql`WHERE gc.${fk} = ${targetId}` : Prisma.empty;
    const rows = await query`
      SELECT gc.id, gc.${fk} AS target_id, gc.component_id, gc.working_days,
             CONCAT(gc.amount, '') AS amount, sc.name AS component_name
      FROM ${tbl} gc
      LEFT JOIN salarycomponent sc ON sc.id = gc.component_id
      ${where}
      ORDER BY sc.name ASC`;
    respond.ok(res, tmsg('salary.components_retrieved', { label }), rows.map(r => ({ ...r, componentName: r.component_name ?? null })));
  });

  const create = asyncHandler(async (req, res) => {
    const targetId = toBigInt(req.body.target_id);
    const componentId = toBigInt(req.body.component);
    if (!targetId) return respond.badReq(res, tmsg('salary.target_required', { label }));
    if (!componentId) return respond.badReq(res, 'Component is required');
    const dup = await query`SELECT id FROM ${tbl} WHERE ${fk} = ${targetId} AND component_id = ${componentId} LIMIT 1`;
    if (dup.length) return respond.conflict(res, tmsg('salary.component_already_assigned', { target: label.toLowerCase() }));
    const amountValue = toDecimalString(req.body.amount);
    await exec`INSERT INTO ${tbl} (${fk}, component_id, amount, working_days) VALUES (${targetId}, ${componentId}, ${amountValue === null ? null : Number(amountValue)}, ${toInt(req.body.working_days)})`;
    const [created] = await query`
      SELECT gc.id, gc.${fk} AS target_id, gc.component_id, gc.working_days, CONCAT(gc.amount, '') AS amount,
             sc.name AS component_name FROM ${tbl} gc LEFT JOIN salarycomponent sc ON sc.id = gc.component_id
      WHERE gc.${fk} = ${targetId} AND gc.component_id = ${componentId}`;
    respond.created(res, tmsg('salary.component_assigned', { label }), { ...created, componentName: created?.component_name ?? null });
  });

  const update = asyncHandler(async (req, res) => {
    const id = toBigInt(req.params.id);
    if (!id) return respond.badReq(res, 'Invalid ID');
    const [existing] = await query`SELECT id FROM ${tbl} WHERE id = ${id} LIMIT 1`;
    if (!existing) return respond.notFound(res, tmsg('salary.component_not_found', { label }));
    const amountValue = toDecimalString(req.body.amount);
    await exec`UPDATE ${tbl} SET amount = ${amountValue === null ? null : Number(amountValue)}, working_days = ${toInt(req.body.working_days)} WHERE id = ${id}`;
    const [updated] = await query`
      SELECT gc.id, gc.${fk} AS target_id, gc.component_id, gc.working_days, CONCAT(gc.amount, '') AS amount,
             sc.name AS component_name FROM ${tbl} gc LEFT JOIN salarycomponent sc ON sc.id = gc.component_id WHERE gc.id = ${id}`;
    respond.ok(res, tmsg('salary.component_updated', { label }), { ...updated, componentName: updated?.component_name ?? null });
  });

  const remove = asyncHandler(async (req, res) => {
    const id = toBigInt(req.params.id);
    if (!id) return respond.badReq(res, 'Invalid ID');
    await exec`DELETE FROM ${tbl} WHERE id = ${id}`;
    respond.ok(res, tmsg('salary.component_removed', { label }), null);
  });

  return { list, create, update, remove };
}

const paygradeComp = makeGradeComponentHandlers('paygrade_components', 'paygrade_id', 'Paygrade');
const notchComp = makeGradeComponentHandlers('notch_components', 'notch_id', 'Notch');

// GET /salary/notches — list all salary notches (named pay points within a paygrade band).
const getNotches = asyncHandler(async (_req, res) => {
  const rows = await query`
    SELECT n.id, n.name, n.paygradeId, p.name AS paygrade_name, n.currency, CONCAT(n.amount, '') AS amount
     FROM notches n LEFT JOIN paygrades p ON p.id = n.paygradeId ORDER BY n.name ASC`;
  respond.ok(res, 'Notches retrieved', rows);
});

// POST /salary/notches — create a notch within a paygrade; validates that the amount falls within the
// paygrade's min–max salary band to maintain structural integrity.
const createNotch = asyncHandler(async (req, res) => {
  const { name, paygradeId, currency, amount } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Notch name is required');
  const pgId = toBigInt(paygradeId);
  if (!pgId) return respond.badReq(res, 'Paygrade is required');

  const amountVal = toDecimalString(amount);
  if (amountVal !== null) {
    const dup = await query`SELECT id FROM notches WHERE paygradeId = ${pgId} AND amount = ${Number(amountVal)} LIMIT 1`;
    if (dup.length) return respond.conflict(res, 'A notch with this amount already exists for this paygrade');

    const [pg] = await query`
      SELECT name, CONCAT(min_salary, '') AS min_salary, CONCAT(max_salary, '') AS max_salary FROM paygrades WHERE id = ${pgId} LIMIT 1`;
    if (!pg) return respond.badReq(res, 'Paygrade not found');
    if (pg.min_salary != null && pg.max_salary != null) {
      const amt = Number(amountVal);
      const min = Number(pg.min_salary);
      const max = Number(pg.max_salary);
      if (amt < min || amt > max) {
        return respond.badReq(res, tmsg('salary.amount_out_of_band', { min: min.toLocaleString(), max: max.toLocaleString(), paygrade: pg.name }));
      }
    }
  }

  const row = await prisma.notches.create({
    data: { name: name.trim(), paygradeId: pgId, currency: currency?.trim() || null, amount: amountVal },
  });
  respond.created(res, 'Notch created', serialize(row));
});

// PUT /salary/notches/:id — update a notch's name, amount, or currency; same paygrade band validation as create.
const updateNotch = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid notch ID');
  const { name, paygradeId, currency, amount } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Notch name is required');
  const pgId = toBigInt(paygradeId);
  if (!pgId) return respond.badReq(res, 'Paygrade is required');

  const amountVal = toDecimalString(amount);
  if (amountVal !== null) {
    const dup = await query`SELECT id FROM notches WHERE paygradeId = ${pgId} AND amount = ${Number(amountVal)} AND id != ${id} LIMIT 1`;
    if (dup.length) return respond.conflict(res, 'A notch with this amount already exists for this paygrade');

    const [pg] = await query`
      SELECT name, CONCAT(min_salary, '') AS min_salary, CONCAT(max_salary, '') AS max_salary FROM paygrades WHERE id = ${pgId} LIMIT 1`;
    if (!pg) return respond.badReq(res, 'Paygrade not found');
    if (pg.min_salary != null && pg.max_salary != null) {
      const amt = Number(amountVal);
      const min = Number(pg.min_salary);
      const max = Number(pg.max_salary);
      if (amt < min || amt > max) {
        return respond.badReq(res, tmsg('salary.amount_out_of_band', { min: min.toLocaleString(), max: max.toLocaleString(), paygrade: pg.name }));
      }
    }
  }

  const row = await prisma.notches.update({
    where: { id },
    data: { name: name.trim(), paygradeId: pgId, currency: currency?.trim() || null, amount: amountVal },
  });
  respond.ok(res, 'Notch updated', serialize(row));
});

// DELETE /salary/notches/:id — permanently delete a notch.
const deleteNotch = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid notch ID');
  await prisma.notches.delete({ where: { id } });
  respond.ok(res, 'Notch deleted', null);
});

// ─── Paygrades ────────────────────────────────────────────────────────────────

// GET /salary/paygrades — list all paygrade bands with their salary range and currency.
const getPaygrades = asyncHandler(async (_req, res) => {
  const rows = await query`
    SELECT id, name, currency, CONCAT(min_salary, '') AS min_salary, CONCAT(max_salary, '') AS max_salary FROM paygrades ORDER BY name ASC`;
  respond.ok(res, 'Paygrades retrieved', rows);
});

// POST /salary/paygrades — create a named paygrade band (e.g. Grade A) with a min/max salary range; blocks duplicate names.
const createPaygrade = asyncHandler(async (req, res) => {
  const { name, currency, min_salary, max_salary } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Paygrade name is required');
  if (!currency?.trim()) return respond.badReq(res, 'Currency is required');

  const dup = await prisma.paygrades.findFirst({ where: { name: name.trim() } });
  if (dup) return respond.conflict(res, 'Paygrade name already exists');

  const row = await prisma.paygrades.create({
    data: {
      name:       name.trim(),
      currency:   currency.trim().toUpperCase(),
      min_salary: toDecimalString(min_salary),
      max_salary: toDecimalString(max_salary),
    },
  });
  respond.created(res, 'Paygrade created', serialize(row));
});

// PUT /salary/paygrades/:id — update paygrade name, currency, or salary band; blocks duplicate names.
const updatePaygrade = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid paygrade ID');

  const existing = await prisma.paygrades.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'Paygrade not found');

  const { name, currency, min_salary, max_salary } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Paygrade name is required');
  if (!currency?.trim()) return respond.badReq(res, 'Currency is required');

  const dup = await prisma.paygrades.findFirst({ where: { name: name.trim(), id: { not: id } } });
  if (dup) return respond.conflict(res, 'Paygrade name already exists');

  const row = await prisma.paygrades.update({
    where: { id },
    data: {
      name:       name.trim(),
      currency:   currency.trim().toUpperCase(),
      min_salary: toDecimalString(min_salary),
      max_salary: toDecimalString(max_salary),
    },
  });
  respond.ok(res, 'Paygrade updated', serialize(row));
});

// DELETE /salary/paygrades/:id — delete a paygrade; blocked if any notches are assigned to it by name.
const deletePaygrade = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid paygrade ID');

  const existing = await prisma.paygrades.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'Paygrade not found');

  // Block deletion when notches reference this paygrade
  const notchCount = await prisma.notches.count({ where: { paygradeId: id } });
  if (notchCount > 0) {
    return respond.badReq(res, tmsg('salary.paygrade_notches_assigned', { count: notchCount }));
  }

  await prisma.paygrades.delete({ where: { id } });
  respond.ok(res, 'Paygrade deleted', null);
});

// ─────────────────────────────────────────────────────────────────────────────

// GET /salary/payment-types — list all payment types (e.g. Bank Transfer, Cash) with their payslip generation flag.
const getPaymentTypes = asyncHandler(async (_req, res) => {
  const rows = await query`SELECT id, name, description, generate_payslip FROM paymenttype ORDER BY name ASC`;
  respond.ok(res, 'Payment types retrieved', rows);
});

// POST /salary/payment-types — create a payment type; defaults generate_payslip to true if not specified.
const createPaymentType = asyncHandler(async (req, res) => {
  const { name, description, generate_payslip } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Payment type is required');
  const gp = generate_payslip === undefined ? true : !!generate_payslip; // Boolean column — pass a real boolean for PG
  const nextId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM paymenttype`)[0].nextId);
  await exec`INSERT INTO paymenttype (id, name, description, generate_payslip) VALUES (${nextId}, ${name.trim()}, ${description?.trim() || null}, ${gp})`;
  const [row] = await query`SELECT id, name, description, generate_payslip FROM paymenttype WHERE id = ${nextId}`;
  respond.created(res, 'Payment type created', row);
});

// PUT /salary/payment-types/:id — update a payment type's name, description, or payslip generation flag.
const updatePaymentType = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid payment type ID');
  const { name, description, generate_payslip } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Payment type is required');
  const gp = generate_payslip === undefined ? true : !!generate_payslip; // Boolean column — pass a real boolean for PG
  await exec`UPDATE paymenttype SET name=${name.trim()}, description=${description?.trim() || null}, generate_payslip=${gp} WHERE id=${id}`;
  const [row] = await query`SELECT id, name, description, generate_payslip FROM paymenttype WHERE id = ${id}`;
  respond.ok(res, 'Payment type updated', row);
});

// DELETE /salary/payment-types/:id — permanently delete a payment type.
const deletePaymentType = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid payment type ID');
  await exec`DELETE FROM paymenttype WHERE id = ${id}`;
  respond.ok(res, 'Payment type deleted', null);
});

// GET /salary/notch-movements — list all historical notch increment/decrement operations applied to salary levels.
const getNotchMovements = asyncHandler(async (_req, res) => {
  const rows = await query`SELECT id, date, employees, no_notches FROM notchmovement ORDER BY date DESC, id DESC`;
  respond.ok(res, 'Salary increment/decrement records retrieved', rows);
});

// POST /salary/notch-movements — apply a percentage increment or decrement to a notch's amount and log the movement.
// The notch amount is updated in-place; the movement record preserves the operation for historical reference.
const createNotchMovement = asyncHandler(async (req, res) => {
  const { notchId, operation, percentage, date } = req.body;
  const id = toBigInt(notchId);
  if (!id) return respond.badReq(res, 'Notch is required');
  const pct = Number(percentage);
  if (!Number.isFinite(pct) || pct <= 0) return respond.badReq(res, 'Change percentage must be greater than zero');
  if (!['Increment', 'Decrement'].includes(operation)) return respond.badReq(res, 'Operation must be Increment or Decrement');

  const notch = await prisma.notches.findUnique({ where: { id } });
  if (!notch) return respond.notFound(res, 'Notch not found');

  const current = Number(notch.amount ?? 0);
  const delta = current * (pct / 100);
  const next = operation === 'Increment' ? current + delta : current - delta;
  await prisma.notches.update({ where: { id }, data: { amount: next.toFixed(2) } });

  const nextId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM notchmovement`)[0].nextId);
  const movementDate = date ? new Date(date) : new Date();
  const note = `${operation} ${pct}%`;
  await exec`INSERT INTO notchmovement (id, date, employees, no_notches) VALUES (${nextId}, ${movementDate}, ${notch.name}, ${note})`;
  const [created] = await query`SELECT id, date, employees, no_notches FROM notchmovement WHERE id = ${nextId}`;
  respond.created(res, 'Salary increment/decrement applied', created);
});

// GET /salary/refs — single endpoint that returns all salary-related lookup lists (employees, components,
// component types, notches, paygrades, payment types) for populating form dropdowns in one round trip.
const getSalaryRefs = asyncHandler(async (_req, res) => {
  const [employees, components, componentTypes, notches, paygrades, paymentTypes] = await Promise.all([
    prisma.employee.findMany({ where: { approvalStatus: 'APPROVED' }, select: { id: true, firstName: true, lastName: true, employee_id: true }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }),
    prisma.salarycomponent.findMany({ select: { id: true, name: true, is_notch_linked: true }, orderBy: { name: 'asc' } }),
    query`SELECT id, code, name, description FROM salarycomponenttype ORDER BY name ASC`,
    query`SELECT n.id, n.name, n.paygradeId, p.name AS paygrade_name, n.currency, CONCAT(n.amount, '') AS amount
           FROM notches n LEFT JOIN paygrades p ON p.id = n.paygradeId ORDER BY n.name ASC`,
    query`SELECT id, name, currency, CONCAT(min_salary, '') AS min_salary, CONCAT(max_salary, '') AS max_salary FROM paygrades ORDER BY name ASC`,
    prisma.paymenttype.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  respond.ok(res, 'Salary references retrieved', {
    employees: serialize(employees.map(e => ({ id: e.id, label: `${e.firstName} ${e.lastName}`.trim() + (e.employee_id ? ` (${e.employee_id})` : '') }))),
    components: serialize(components.map(c => ({ id: c.id, label: c.name, is_notch_linked: c.is_notch_linked }))),
    componentTypes,
    notches: notches.map(n => ({ id: n.id, label: `${n.name}${n.amount ? ` (${n.currency ?? ''} ${n.amount})` : ''}`, ...n })),
    paygrades: paygrades.map(p => ({ id: p.id, label: `${p.name}${p.currency ? ` (${p.currency})` : ''}`, name: p.name, currency: p.currency, min_salary: p.min_salary, max_salary: p.max_salary })),
    paymentTypes: serialize(paymentTypes.map(p => ({ id: p.id, label: p.name }))),
  });
});

module.exports = {
  getSalaryComponentTypes,
  createSalaryComponentType,
  updateSalaryComponentType,
  deleteSalaryComponentType,

  getSalaryComponents,
  createSalaryComponent,
  updateSalaryComponent,
  deleteSalaryComponent,

  getEmployeeSalaryComponents,
  getEmployeeSalaryHistory,
  createEmployeeSalaryComponent,
  updateEmployeeSalaryComponent,
  deleteEmployeeSalaryComponent,

  getPaygradeComponents:    paygradeComp.list,
  createPaygradeComponent:  paygradeComp.create,
  updatePaygradeComponent:  paygradeComp.update,
  deletePaygradeComponent:  paygradeComp.remove,
  getNotchComponents:       notchComp.list,
  createNotchComponent:     notchComp.create,
  updateNotchComponent:     notchComp.update,
  deleteNotchComponent:     notchComp.remove,

  getPaygrades,
  createPaygrade,
  updatePaygrade,
  deletePaygrade,

  getNotches,
  createNotch,
  updateNotch,
  deleteNotch,
  getPaymentTypes,
  createPaymentType,
  updatePaymentType,
  deletePaymentType,
  getNotchMovements,
  createNotchMovement,
  getSalaryRefs,
};
