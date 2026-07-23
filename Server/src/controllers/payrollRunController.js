const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { Parser } = require('expr-eval');
const { logActivity, fromReq } = require('./auditController');
const { notifyUser, notifyUsersWithPermission, notifyUsersWithRole } = require('../helpers/notificationHelper');
const { postToGL }    = require('../helpers/glHelper');
const { getApiConfig } = require('./apiIntegrationController');
const _parser = new Parser({ operators: { logical: false, comparison: false, conditional: false } });

const { serialize, toDate } = require('../helpers/controllerHelpers');
const { upsertSetting } = require('../helpers/settingsHelper');
const { Prisma } = require('@prisma/client'); // Prisma.sql / Prisma.join for portable dynamic SQL

// Tagged-template query helpers — portable (Prisma emits the right placeholders per provider).
// Call as query`SELECT ... ${value}` (values become bound parameters). Reusable SQL fragments
// are built with Prisma.sql`...` and interpolated into a tagged query.
async function query(strings, ...values) {
  return serialize(await prisma.$queryRaw(strings, ...values));
}

async function exec(strings, ...values) {
  return prisma.$executeRaw(strings, ...values);
}

/** Read an app-control toggle from the settings table. Returns `defaultOn` when never saved. */
async function readControlSetting(name, defaultOn) {
  const [row] = await query`SELECT value FROM settings WHERE name=${name} AND category='app_controls' LIMIT 1`
    .catch(() => []);
  return row ? row.value === '1' : defaultOn;
}

/** Attach `groupIds` (array of calculation-group id strings) to each payroll column from the
 *  payrollcolumn_groups junction table. Empty array = the column is universal (runs for everyone). */
async function attachColumnGroups(cols) {
  if (!cols.length) return cols;
  const rows = await query`SELECT payrollcolumn_id, group_id FROM payrollcolumn_groups`;
  const map = {};
  for (const r of rows) (map[String(r.payrollcolumn_id)] ??= []).push(String(r.group_id));
  for (const c of cols) c.groupIds = map[String(c.id)] ?? [];
  return cols;
}

/** Attach `componentNames` (linked salary component names) and `links` ([{target_column_id,operation}])
 *  to each payroll column from the junction tables, and return `compNameById` (id→name) for resolving
 *  {comp:id} tokens in formulas. Replaces the old salary_components / add_columns / sub_columns CSVs. */
async function attachColumnRefs(cols) {
  const compNameById = new Map((await query`SELECT id, name FROM salarycomponent`).map(c => [String(c.id), c.name]));
  if (!cols.length) return { compNameById };
  const compRows = await query`SELECT payrollcolumn_id, component_id FROM payrollcolumn_components`;
  const linkRows = await query`SELECT payrollcolumn_id, target_column_id, operation FROM payrollcolumn_links`;
  const compMap = {}; for (const r of compRows) (compMap[String(r.payrollcolumn_id)] ??= []).push(String(r.component_id));
  const linkMap = {}; for (const r of linkRows) (linkMap[String(r.payrollcolumn_id)] ??= []).push({ target_column_id: Number(r.target_column_id), operation: r.operation });
  for (const c of cols) {
    c.componentNames = (compMap[String(c.id)] || []).map(cid => compNameById.get(cid)).filter(Boolean);
    c.links = linkMap[String(c.id)] || [];
  }
  return { compNameById };
}

/**
 * Build each employee's salary map (`salaryByEmp[eid][COMPONENT_NAME_UPPER] = amount`) by resolving,
 * in order (later overrides earlier):
 *   1. paygrade components (employee.paygradeId → paygrade_components)
 *   2. notch components    (employee.notcheId  → notch_components, override paygrade on same component)
 *   3. per-employee exceptions (employeesalary): excluded → remove; else override/add
 *   4. notch base salary injection: notch name alias + the is_notch_linked component (Basic Salary)
 *      when not already set and not excluded.
 * Null/blank amounts are skipped so calcColumn's default_value can still fire (matches old behaviour).
 * Component NAMES (uppercased) stay the keys, so calcColumn is unchanged.
 */
async function buildSalaryByEmp(empIdBigs) {
  const salaryByEmp = {};
  const [notchLinkedComp] = await query`SELECT name FROM salarycomponent WHERE is_notch_linked = TRUE LIMIT 1`;
  const notchCompKey = notchLinkedComp?.name?.toUpperCase() || null;
  if (!empIdBigs.length) return { salaryByEmp, notchLinkedComp, notchWarning: null, salaryRowsFound: 0, notchRowsFound: 0 };

  const empIn = Prisma.join(empIdBigs);
  const compNameById = new Map((await query`SELECT id, name FROM salarycomponent`).map(c => [String(c.id), c.name]));
  const emps = await query`SELECT id, paygradeId, notcheId FROM employee WHERE id IN (${empIn})`;

  const pgIds = [...new Set(emps.map(e => e.paygradeId).filter(v => v != null).map(String))];
  const ntIds = [...new Set(emps.map(e => e.notcheId).filter(v => v != null).map(String))];
  const pgComps = pgIds.length ? await query`SELECT paygrade_id, component_id, CONCAT(amount, '') amount FROM paygrade_components WHERE paygrade_id IN (${Prisma.join(pgIds.map(BigInt))})` : [];
  const ntComps = ntIds.length ? await query`SELECT notch_id, component_id, CONCAT(amount, '') amount FROM notch_components WHERE notch_id IN (${Prisma.join(ntIds.map(BigInt))})` : [];
  const exceptions = await query`SELECT employee, component, CONCAT(amount, '') amount, excluded FROM employeesalary WHERE employee IN (${empIn})`;
  const notchRows = await query`SELECT e.id AS employee, CONCAT(n.amount, '') amount, n.name AS notch_name FROM employee e JOIN notches n ON n.id = e.notcheId WHERE e.id IN (${empIn})`;

  const byKey = (rows, k) => { const m = {}; for (const r of rows) (m[String(r[k])] ??= []).push(r); return m; };
  const pgByGrade = byKey(pgComps, 'paygrade_id');
  const ntByNotch = byKey(ntComps, 'notch_id');
  const excByEmp  = byKey(exceptions, 'employee');
  const notchByEmp = {}; for (const r of notchRows) notchByEmp[String(Number(r.employee))] = r;

  const hasAmt = v => !(v === null || v === undefined || v === '');
  let sourceCount = 0;
  for (const emp of emps) {
    const eid = String(Number(emp.id));
    const map = {};
    const excludedKeys = new Set();
    const put = (compId, amount) => {
      const nm = compNameById.get(String(compId));
      if (!nm || !hasAmt(amount)) return;
      map[nm.toUpperCase()] = parseFloat(amount) || 0;
      sourceCount++;
    };
    // 1. paygrade   2. notch (override)
    (pgByGrade[String(emp.paygradeId)] || []).forEach(r => put(r.component_id, r.amount));
    (ntByNotch[String(emp.notcheId)]   || []).forEach(r => put(r.component_id, r.amount));
    // 3. exceptions
    (excByEmp[eid] || []).forEach(r => {
      const nm = compNameById.get(String(r.component));
      if (!nm) return;
      const key = nm.toUpperCase();
      if (r.excluded === 1 || r.excluded === true) { delete map[key]; excludedKeys.add(key); }
      else if (hasAmt(r.amount)) { map[key] = parseFloat(r.amount) || 0; sourceCount++; }
    });
    // 4. notch base salary injection
    const nb = notchByEmp[eid];
    if (nb) {
      const amt = parseFloat(nb.amount) || 0;
      map[String(nb.notch_name).toUpperCase()] = amt;
      if (notchCompKey && !(notchCompKey in map) && !excludedKeys.has(notchCompKey)) map[notchCompKey] = amt;
    }
    salaryByEmp[eid] = map;
  }

  const notchWarning = notchRows.length > 0 && !notchLinkedComp
    ? 'No grade-scale component is linked. Employees on the grade scale may have incorrect values. Go to Payroll Management → Components to link one.'
    : null;
  return { salaryByEmp, notchLinkedComp, notchWarning, salaryRowsFound: sourceCount, notchRowsFound: notchRows.length };
}

// ── Formula evaluator ─────────────────────────────────────────────────────────
function safeEval(formula, vars = {}) {
  let expr = String(formula || '0');
  // Substitute variable names with their numeric values (longest names first to avoid partial matches)
  Object.entries(vars)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([name, val]) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expr = expr.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), String(Number(val) || 0));
    });
  try {
    const result = _parser.evaluate(expr);
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch { return 0; }
}

function matchesBracket(item, amount) {
  const lo = item.lower_limit_condition;
  const hi = item.upper_limit_condition;
  const ll = parseFloat(item.lower_limit) || 0;
  const ul = parseFloat(item.upper_limit) || 0;
  const lowerOk = lo === 'NO_LOWER_LIMIT' ||
    (lo === 'GREATER_THAN' && amount > ll) ||
    (lo === 'GREATER_THAN_OR_EQUAL' && amount >= ll);
  const upperOk = hi === 'NO_UPPER_LIMIT' ||
    (hi === 'LESS_THAN' && amount < ul) ||
    (hi === 'LESS_THAN_OR_EQUAL' && amount <= ul);
  return lowerOk && upperOk;
}

/** Round a value UP to 2 decimal places. The small epsilon absorbs floating-point noise so a value
 *  that is already exact to the cent (e.g. 12.35) is not pushed up to 12.36. */
function ceilTo2(n) {
  return Math.ceil(n * 100 - 1e-6) / 100;
}

// ── Calculation engine ────────────────────────────────────────────────────────
function calcColumn(col, salaryMap, allCols, savedCalcs, empId, exemptions, cache = {}, ctx = {}) {
  if (cache[col.id] !== undefined) return cache[col.id];

  // Guard against circular references: mark this column as in-progress (0)
  // so any recursive call back to this column returns 0 instead of infinitely recursing
  cache[col.id] = 0;

  // A column tied to salary component(s) only applies to employees who actually have at least one of
  // those components. If the employee has none of them, the whole column is 0 for them — its default
  // value, formula, add/subtract columns and calculation rule are all skipped. A column with NO
  // linked components stays universal (its calculation/default applies to everyone).
  // componentNames is attached per-run from the payrollcolumn_components junction.
  const compNames = col.componentNames || [];
  if (compNames.length > 0 && !compNames.some(name => salaryMap[String(name).toUpperCase()] !== undefined)) {
    cache[col.id] = 0;
    return 0;
  }

  // 1. Sum linked salary components; fall back to default_value if sum is 0
  const defaultVal = parseFloat(col.default_value || '0') || 0;
  let result = compNames.reduce((sum, name) => sum + (parseFloat(salaryMap[String(name).toUpperCase()]) || 0), 0);
  if (result === 0 && defaultVal > 0) result = defaultVal;

  // 2. Evaluate formula if present. The formula is stored in TOKEN form ({comp:id}/{col:id}); resolve
  // each token directly to a value by id — no name matching at eval time (rename-proof). Column tokens
  // use ONLY already-cached values (0 otherwise), preserving the colorder dependency rule.
  if (col.calculation_function && col.calculation_function.trim()) {
    const expr = col.calculation_function
      .replace(/\{comp:(\d+)\}/g, (_, id) => {
        const nm = ctx.compNameById ? ctx.compNameById.get(String(id)) : undefined;
        const v = nm ? salaryMap[String(nm).toUpperCase()] : undefined;
        return `(${parseFloat(v) || 0})`;
      })
      .replace(/\{col:(\d+)\}/g, (_, id) => {
        const v = cache[id];
        return `(${v !== undefined && v !== null ? (Number(v) || 0) : 0})`;
      });
    const formulaResult = safeEval(expr, {});
    if (!isNaN(formulaResult)) result = formulaResult;
  }

  // 3/4. Add / subtract linked columns (resolved by id from the payrollcolumn_links junction)
  (col.links || []).forEach(link => {
    const found = allCols.find(c => Number(c.id) === Number(link.target_column_id));
    if (found && Number(found.id) !== Number(col.id)) {
      const v = calcColumn(found, salaryMap, allCols, savedCalcs, empId, exemptions, cache, ctx);
      result += link.operation === 'subtract' ? -v : v;
    }
  });

  // 5. Apply calculation rule — only when explicitly linked via calculation_rule.
  // Auto-matching by target_name was removed: savedCalc target_name is the BASE column/component,
  // not the output column, so name-matching incorrectly applied rules to the wrong columns.
  // X (and the target's own name) in bracket formulas = the rule's TARGET base amount.
  const exemptIds = (exemptions || '').split(',').map(s => s.trim()).filter(Boolean);
  if (col.calculation_rule) {
    const rulesToApply = savedCalcs.filter(sc =>
      String(sc.id) === String(col.calculation_rule) &&
      !exemptIds.includes(String(sc.id)) &&
      sc.items && sc.items.length > 0
    );
    rulesToApply.forEach(sc => {
      // Resolve the base amount from the rule's declared target
      let base = result;
      if (sc.target_type === 'component' && sc.target_name) {
        const amt = parseFloat(salaryMap[sc.target_name.toUpperCase()]);
        if (!isNaN(amt)) base = amt;
      } else if (sc.target_type === 'column' && sc.target_name) {
        const tgt = allCols.find(c => c.name.toLowerCase() === sc.target_name.toLowerCase());
        if (tgt && String(tgt.id) !== String(col.id)) {
          base = cache[tgt.id] !== undefined
            ? cache[tgt.id]
            : calcColumn(tgt, salaryMap, allCols, savedCalcs, empId, exemptions, cache, ctx);
        }
      }
      const bracket = sc.items.find(item => matchesBracket(item, base));
      if (bracket) {
        // Provide X + the target's own name so formulas like "Salary Basic * 0.05" resolve
        const bracketVars = { X: base, x: base };
        if (sc.target_name) {
          bracketVars[sc.target_name] = base;
          bracketVars[sc.target_name.toUpperCase()] = base;
        }
        Object.entries(salaryMap).forEach(([k, v]) => { bracketVars[k] = v; bracketVars[k.toLowerCase()] = v; });
        allCols.forEach(c => {
          if (cache[c.id] !== undefined) { bracketVars[c.name] = cache[c.id]; bracketVars[c.name.toUpperCase()] = cache[c.id]; }
        });
        const calcResult = safeEval(bracket.value, bracketVars);
        // Saved-calculation (bracket) results round UP to the nearest cent.
        if (!isNaN(calcResult)) result = ceilTo2(calcResult);
      }
    });
  }

  const final = Math.round(Math.max(0, result) * 100) / 100;
  cache[col.id] = final;
  return final;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
// ── Audit helper ──────────────────────────────────────────────────────────────
async function logAudit(runId, action, req, details = null) {
  try {
    const userId   = req.user?.id   ? BigInt(req.user.id)   : null;
    const userName = req.user?.username || null;
    await exec`
      INSERT INTO payrollrunaudit (run_id, action, user_id, user_name, details)
       VALUES (${BigInt(runId)}, ${action}, ${userId}, ${userName}, ${details ? JSON.stringify(details) : null})`;
  } catch (e) { console.error('[payroll audit]', e.message); }
}

// Reusable SELECT fragment. Built with Prisma.sql so it composes into tagged queries:
//   query`${RUNS_SELECT} WHERE pr.id = ${id}`
const RUNS_SELECT = Prisma.sql`
  SELECT pr.id, pr.name, pr.pay_frequency, pf.name AS freq_name,
         pr.date_start, pr.date_end, pr.deduction_group,
         cg.name AS group_name, pr.payment_type_id, pt.name AS type_name,
         pr.status, pr.created_at,
         pr.submitted_by, pr.approved_by, pr.approved_at, pr.rejection_reason,
         pr.document_ref, pr.payment_log, pr.finalized_at,
         cs.approver_type  AS cur_approver_type,
         cs.approver_id    AS cur_approver_id,
         cs.approver_label AS cur_approver_label,
         cs.stage_name     AS cur_stage_name
  FROM   payrollruns pr
  -- current pending stage per run (lowest stage_order still Pending). Portable to MariaDB 10.4 + Postgres:
  -- join the stages to the per-run minimum pending order rather than using LATERAL (unsupported on MariaDB).
  LEFT JOIN (
    SELECT s.run_id, s.approver_type, s.approver_id, s.approver_label, s.stage_name, s.stage_order
    FROM   payrollrun_stages s
    JOIN  (SELECT run_id, MIN(stage_order) AS min_order
           FROM payrollrun_stages WHERE status = 'Pending' GROUP BY run_id) m
      ON  m.run_id = s.run_id AND m.min_order = s.stage_order
    WHERE  s.status = 'Pending'
  ) cs ON cs.run_id = pr.id
  LEFT JOIN payfrequencies     pf ON pf.id = pr.pay_frequency
  LEFT JOIN calculationgroups  cg ON cg.id = pr.deduction_group
  LEFT JOIN paymenttype        pt ON pt.id = pr.payment_type_id
`;

// GET /payroll/runs — list all payroll runs with frequency, deduction group, payment type, and approval status.
const getPayrollRuns = asyncHandler(async (_req, res) => {
  const rows = await query`${RUNS_SELECT} ORDER BY pr.created_at DESC`;
  respond.ok(res, 'Payroll runs retrieved', rows);
});

// POST /payroll/runs — create a new payroll run in Draft status for a given pay frequency and date range.
const createPayrollRun = asyncHandler(async (req, res) => {
  const { name, pay_frequency, date_start, date_end, deduction_group, payment_type } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Run name is required');
  if (!pay_frequency)  return respond.badReq(res, 'Pay frequency is required');
  await exec`
    INSERT INTO payrollruns (name, pay_frequency, date_start, date_end, deduction_group, payment_type_id)
     VALUES (${name.trim()}, ${parseInt(pay_frequency)}, ${toDate(date_start)}, ${toDate(date_end)},
             ${deduction_group ? BigInt(deduction_group) : null}, ${payment_type ? BigInt(payment_type) : null})`;
  const rows = await query`${RUNS_SELECT} ORDER BY pr.id DESC LIMIT 1`;
  respond.created(res, 'Payroll run created', rows[0] || null);
});

// PUT /payroll/runs/:id — update run metadata (name, dates, frequency, deduction group); blocked on Completed runs.
const updatePayrollRun = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, pay_frequency, date_start, date_end, deduction_group, payment_type } = req.body;
  const [run] = await query`SELECT status FROM payrollruns WHERE id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status === 'Completed') return respond.badReq(res, 'Cannot edit a completed payroll run');
  await exec`
    UPDATE payrollruns SET
      name=${name?.trim() || run.name},
      pay_frequency=${pay_frequency ? parseInt(pay_frequency) : null},
      date_start=${toDate(date_start)},
      date_end=${toDate(date_end)},
      deduction_group=${deduction_group ? BigInt(deduction_group) : null},
      payment_type_id=${payment_type ? BigInt(payment_type) : null},
      updated_at=NOW()
     WHERE id=${BigInt(id)}`;
  const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  respond.ok(res, 'Updated', rows[0] || null);
});

// DELETE /payroll/runs/:id — delete a Draft or Processing run and its payroll data; blocked on Completed runs.
const deletePayrollRun = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`SELECT status FROM payrollruns WHERE id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status === 'Completed') return respond.badReq(res, 'Cannot delete a completed payroll run');
  await exec`DELETE FROM payrolldata WHERE payroll = ${BigInt(id)}`;
  await exec`DELETE FROM payrollrun_stages WHERE run_id = ${BigInt(id)}`;
  await exec`DELETE FROM payrollruns WHERE id = ${BigInt(id)}`;
  respond.ok(res, 'Deleted');
});

// ── Generate ──────────────────────────────────────────────────────────────────
// POST /payroll/runs/:id/generate — compute each employee's payroll column values using the calculation engine
// (salary components, formulas, add/sub columns, bracket rules) and store results in payrolldata.
// Reports missing salary components and employees with no salary setup for diagnostics.
const generatePayroll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status === 'Completed')        return respond.badReq(res, 'Cannot regenerate a completed payroll run');
  if (run.status === 'Pending Approval') return respond.badReq(res, 'Withdraw the approval request before regenerating');
  if (run.status === 'Approved')         return respond.badReq(res, 'Cannot regenerate an approved payroll run');

  // Mark as Processing and clear any prior approval state
  await exec`UPDATE payrollruns SET status='Processing', submitted_by=NULL, approved_by=NULL, approved_at=NULL, rejection_reason=NULL, updated_at=NOW() WHERE id=${BigInt(id)}`;
  await exec`DELETE FROM payrollrun_stages WHERE run_id = ${BigInt(id)}`; // clear any prior approval progress

  // Load all enabled columns — no pay_frequency filter; columns are not per-frequency.
  // A column's calculation groups (payrollcolumn_groups) mean "only run for employees in those
  // groups"; no groups = universal.
  const allCols = await query`
    SELECT id, name, calculation_function,
            payment_deduction, colorder, default_value, calculation_rule
     FROM payrollcolumns
     WHERE enabled='Yes'
     ORDER BY COALESCE(colorder, 99999), id`;
  if (!allCols.length) return respond.ok(res, 'No enabled payroll columns found', []);
  await attachColumnGroups(allCols);
  const { compNameById } = await attachColumnRefs(allCols);

  // Load payroll employees (optionally scoped to the run's deduction group)
  const groupFilter = run.deduction_group ? Prisma.sql`AND pe.deduction_group = ${BigInt(run.deduction_group)}` : Prisma.empty;
  const payrollEmps = await query`
    SELECT pe.id, pe.employee, pe.deduction_group, pe.deduction_exemptions
     FROM payrollemployees pe WHERE pe.pay_frequency = ${parseInt(run.pay_frequency)} ${groupFilter}`;
  if (!payrollEmps.length) return respond.ok(res, 'No employees found for this pay frequency', []);

  // Load all saved calculations with their items
  const savedCalcs = await query`
    SELECT sc.id, sc.name, sc.target_type, sc.target_name, sc.calculation_group_id
    FROM savedcalculations sc`;
  const calcItems = await query`SELECT * FROM calculationprocessitems ORDER BY sort_order`;
  savedCalcs.forEach(sc => {
    sc.items = calcItems.filter(i => String(i.saved_calculation_id) === String(sc.id));
  });

  // Load salary components for all employees — use plain numeric strings as keys
  // (serialize() turns BigInt → string, but the exact format can differ; normalise to Number string)
  const empIdNums = payrollEmps.map(e => String(Number(e.employee)));
  const empIdBigs = payrollEmps.map(e => BigInt(e.employee));

  // Build each employee's salary map from inherited paygrade/notch components + per-employee exceptions.
  const { salaryByEmp, notchWarning, salaryRowsFound, notchRowsFound } = await buildSalaryByEmp(empIdBigs);

  // Diagnostics
  const emptySalaryEmps = empIdNums.filter(eid => !salaryByEmp[eid] || Object.keys(salaryByEmp[eid]).length === 0);

  // Detect salary components that applicable payroll columns need but no selected employee has.
  // Columns with a default value can still calculate without an employee salary row, so skip them.
  // Scope the check to columns that actually appear on THIS run's report template — a column that is
  // enabled system-wide but not shown on this run (e.g. an ungrouped "Union Dues" deduction the template
  // omits) must not trip a "no salary values" warning for a figure the user never sees. Fall back to the
  // group-scoped applicability rule when the run has no report template.
  const runTemplate = await resolveRunTemplate(id);
  const templateColIds = new Set(parseTemplateColumns(runTemplate?.visible_columns));
  const applicableCols = allCols.filter(col => {
    if (templateColIds.size) return templateColIds.has(String(col.id));
    return !col.groupIds.length || payrollEmps.some(pe => col.groupIds.includes(String(pe.deduction_group ?? '')));
  });
  const neededComponents = new Set();
  applicableCols.forEach(col => {
    const hasDefault = (parseFloat(col.default_value || '0') || 0) > 0;
    if (hasDefault) return;
    if (col.calculation_function && col.calculation_function.trim()) return;
    (col.componentNames || []).map(s => String(s).trim().toUpperCase()).filter(Boolean)
      .forEach(name => neededComponents.add(name));
  });
  const foundComponents = new Set();
  empIdNums.forEach(eid => {
    Object.keys(salaryByEmp[eid] || {}).forEach(key => foundComponents.add(key));
  });
  const missingComponents = [...neededComponents].filter(name => !foundComponents.has(name));

  // Delete previous data for this run
  await exec`DELETE FROM payrolldata WHERE payroll = ${BigInt(id)}`;

  // Calculate and insert
  for (const pe of payrollEmps) {
    const eid = String(Number(pe.employee));
    const salaryMap = salaryByEmp[eid] || {};
    const cache = {};
    for (const col of allCols) {
      // Skip group-specific columns for employees not in any of the column's groups.
      // A column with no groups is universal and always runs.
      if (col.groupIds.length && !col.groupIds.includes(String(pe.deduction_group ?? ''))) continue;
      const amount = calcColumn(col, salaryMap, allCols, savedCalcs, pe.employee, pe.deduction_exemptions, cache, { compNameById });
      await exec`INSERT INTO payrolldata (payroll, employee, payroll_item, amount) VALUES (${BigInt(id)}, ${BigInt(pe.employee)}, ${parseInt(col.id)}, ${String(amount)})`;
    }
  }

  await logAudit(id, 'generate', req, { employees: payrollEmps.length, columns: allCols.length });
  logActivity({ module: 'Payroll', action: 'generate', entityId: String(id), entityName: run.name, ...fromReq(req), details: { employees: payrollEmps.length } });
  respond.ok(res, 'Payroll generated', {
    employees:           payrollEmps.length,
    columns:             allCols.length,
    salaryRowsFound:     salaryRowsFound,
    notchRowsFound:      notchRowsFound,
    empsWithNoSalary:    emptySalaryEmps.length,
    missingComponents,
    notchWarning,
  });
});

// ── Grid data ─────────────────────────────────────────────────────────────────
/** Parse a payslip template's visible_columns (JSON array of column ids) into a string[] — tolerant of null,
 *  already-parsed arrays, or malformed JSON. */
function parseTemplateColumns(raw) {
  if (raw == null) return [];
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { return []; } }
  return Array.isArray(arr) ? arr.map(String).filter(v => v !== '') : [];
}

/**
 * Resolve the report template (payslip_settings row) that applies to a run, mirroring the client's
 * precedence: exact payment-type + deduction-group match, then payment-type-only, then group-only, then a
 * global default (neither set). Returns null when nothing matches.
 */
async function resolveRunTemplate(runId) {
  const [run] = await query`SELECT payment_type_id, deduction_group FROM payrollruns WHERE id = ${BigInt(runId)} LIMIT 1`;
  if (!run) return null;
  const pt = run.payment_type_id != null ? String(run.payment_type_id) : '';
  const dg = run.deduction_group != null ? String(run.deduction_group) : '';
  const templates = await query`SELECT payment_type_id, deduction_group_id, visible_columns, net_columns FROM payslip_settings`;
  const eq = (a, b) => String(a ?? '') === String(b ?? '');
  return (
    (pt && dg && templates.find(t => eq(t.payment_type_id, pt) && eq(t.deduction_group_id, dg))) ||
    (pt && templates.find(t => eq(t.payment_type_id, pt) && (t.deduction_group_id == null || t.deduction_group_id === ''))) ||
    (dg && templates.find(t => (t.payment_type_id == null || t.payment_type_id === '') && eq(t.deduction_group_id, dg))) ||
    templates.find(t => (t.payment_type_id == null || t.payment_type_id === '') && (t.deduction_group_id == null || t.deduction_group_id === '')) ||
    null
  );
}

// GET /payroll/runs/:id/data — retrieve all payroll cells for a run (employee × column), with stale-column warning count.
const getPayrollData = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const cells = await query`
    SELECT pd.id, pd.employee, pd.payroll_item, pd.amount,
           TRIM(CONCAT(COALESCE(e.firstName,''), ' ', COALESCE(e.lastName,''))) AS emp_name,
           pc.name AS column_name, pc.colorder, pc.payment_deduction,
           COALESCE(pc.visible, TRUE) AS visible
    FROM   payrolldata pd
    LEFT JOIN employee       e  ON e.id  = pd.employee
    LEFT JOIN payrollcolumns pc ON pc.id = pd.payroll_item
    WHERE  pd.payroll = ${BigInt(id)}
    ORDER BY emp_name, COALESCE(pc.colorder, 99999), pc.id`;

  // Stale-column warning: only columns that would actually appear in THIS run's report count. A run resolves
  // to a report template (payslip_settings) by payment type + deduction group; its `visible_columns` is the
  // set the report shows. So we warn only when a *template* column is missing from the run's stored cells —
  // brand-new enabled columns that aren't in the template are irrelevant and must not nag "recalculate".
  // When a run has no matching template, fall back to all enabled columns (the report shows them all).
  const template = await resolveRunTemplate(id);
  const colsInRun = new Set(cells.map(r => String(r.payroll_item)));
  const enabledCols = await query`SELECT id FROM payrollcolumns WHERE enabled='Yes'`;
  const enabledIds = new Set(enabledCols.map(c => String(c.id)));

  let staleColumnCount;
  let relevantColCount;
  const templateCols = parseTemplateColumns(template?.visible_columns);
  if (templateCols.length) {
    // Only template columns that are currently enabled can appear in a recalculated run — a template entry
    // for a disabled column can never be filled, so it must not count as "stale".
    const relevant = templateCols.filter(cid => enabledIds.has(String(cid)));
    relevantColCount = relevant.length;
    staleColumnCount = relevant.filter(cid => !colsInRun.has(String(cid))).length;
  } else {
    relevantColCount = enabledIds.size;
    staleColumnCount = Math.max(0, relevantColCount - colsInRun.size);
  }

  // Expose the run's resolved report-template column sets so any consumer (e.g. the approver's review)
  // renders exactly the columns this run's report shows, not a general all-columns view. Null when the run
  // has no matching template — consumers then fall back to each column's own visible/include_in_net flags.
  const templateVisibleCols = templateCols.length ? templateCols : null;
  const templateNetCols = template ? parseTemplateColumns(template.net_columns) : [];

  respond.ok(res, 'Payroll data retrieved', {
    cells, staleColumnCount, totalEnabledCols: relevantColCount,
    templateVisibleCols,
    templateNetCols: templateNetCols.length ? templateNetCols : null,
  });
});

// GET /payroll/runs/:id/debug — re-run the calculation engine in read-only mode and return the raw salary map
// plus each column's computed value per employee; used for troubleshooting incorrect payroll results.
const debugPayrollRun = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`SELECT id, pay_frequency, deduction_group FROM payrollruns WHERE id = ${BigInt(id)} LIMIT 1`;
  if (!run) return respond.notFound(res, 'Run not found');

  const allCols = await query`
    SELECT id, name, calculation_function,
            payment_deduction, colorder, default_value, calculation_rule
     FROM payrollcolumns WHERE enabled='Yes' ORDER BY COALESCE(colorder, 99999), id`;
  await attachColumnGroups(allCols);
  const { compNameById } = await attachColumnRefs(allCols);

  const groupFilter = run.deduction_group ? Prisma.sql`AND pe.deduction_group = ${BigInt(run.deduction_group)}` : Prisma.empty;
  const payrollEmps = await query`
    SELECT pe.id, pe.employee, pe.deduction_group, pe.deduction_exemptions
     FROM payrollemployees pe WHERE pe.pay_frequency = ${parseInt(run.pay_frequency)} ${groupFilter}`;

  const empIdBigs = payrollEmps.map(e => BigInt(e.employee));
  const { salaryByEmp, notchLinkedComp } = await buildSalaryByEmp(empIdBigs);

  const savedCalcs = await query`SELECT sc.id, sc.name, sc.target_type, sc.target_name FROM savedcalculations sc`;
  const calcItems = await query`SELECT * FROM calculationprocessitems ORDER BY sort_order`;
  savedCalcs.forEach(sc => { sc.items = calcItems.filter(i => String(i.saved_calculation_id) === String(sc.id)); });

  const result = payrollEmps.map(pe => {
    const eid = String(Number(pe.employee));
    const salaryMap = salaryByEmp[eid] || {};
    const cache = {};
    const colResults = [];
    for (const col of allCols) {
      if (col.groupIds.length && !col.groupIds.includes(String(pe.deduction_group ?? ''))) continue;
      const amount = calcColumn(col, salaryMap, allCols, savedCalcs, pe.employee, pe.deduction_exemptions, cache, { compNameById });
      colResults.push({ id: col.id, name: col.name, salary_components: (col.componentNames || []).join(','), default_value: col.default_value, calculation_function: col.calculation_function, amount });
    }
    return { employee: eid, salaryMap, columns: colResults };
  });

  respond.ok(res, 'Debug info', { notchLinkedComponent: notchLinkedComp?.name || null, employees: result });
});

// PUT /payroll/runs/:id/data/:itemId — manually override a single payroll cell amount (for corrections before finalization).
const updatePayrollDataItem = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { amount } = req.body;
  const [run] = await query`SELECT status FROM payrollruns WHERE id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status === 'Completed') return respond.badReq(res, 'Cannot edit a completed payroll run');
  await exec`UPDATE payrolldata SET amount = ${String(amount ?? '')} WHERE id = ${parseInt(itemId)} AND payroll = ${BigInt(id)}`;
  respond.ok(res, 'Updated');
});

// ── GL posting helper (shared by finalize + retry) ───────────────────────────
async function buildAndPostGL(id, req) {
  const apiCfg = await getApiConfig();
  let glExtra  = {};
  try { glExtra = JSON.parse(apiCfg.gl_extra || '{}'); } catch {}
  const defaultCurrency = glExtra.currency || 'SLL';
  const defaultBranch   = glExtra.branch   || '000';

  const postingRows = await query`
    SELECT pd.employee, pd.amount,
           pc.name AS col_name, pc.payment_deduction, pc.salarycomponent_gl, pc.posting_branch,
           TRIM(CONCAT(COALESCE(e.firstName,''), ' ', COALESCE(e.lastName,''))) AS emp_name,
           e.bankAccount,
           COALESCE(pe.currency, ${defaultCurrency}) AS currency
    FROM   payrolldata pd
    JOIN   payrollcolumns    pc ON pc.id       = pd.payroll_item
    JOIN   employee           e  ON e.id        = pd.employee
    LEFT JOIN payrollemployees pe ON pe.employee = pd.employee
    WHERE  pd.payroll = ${BigInt(id)} AND pc.posting_column = 'Yes'
    ORDER  BY pd.employee, COALESCE(pc.colorder, 99999)`;

  const debitAccounts  = [];
  const creditAccounts = [];
  const approvedBy  = req.user?.username || req.user?.email || 'System';
  const referenceNo = `PR${id}${String(Date.now()).slice(-7)}`;

  const fallbackExpenseGL   = (process.env.PAYROLL_EXPENSE_GL   || '').trim();
  const fallbackDeductionGL = (process.env.PAYROLL_DEDUCTION_GL || '').trim();
  const fallbackNetGL       = (process.env.PAYROLL_NET_PAYABLE_GL || '').trim();

  for (const row of postingRows) {
    const amount   = parseFloat(row.amount || '0');
    if (!amount || amount <= 0) continue;
    const branch   = row.posting_branch || defaultBranch;
    const currency = row.currency       || defaultCurrency;
    const prodRef  = `HR_${id}_${row.employee}`;
    const isNet    = (row.col_name || '').toLowerCase().startsWith('net');

    if (isNet) {
      const acct = row.bankAccount || fallbackNetGL;
      if (!acct) continue;
      creditAccounts.push({ creditAmount: amount, creditAccount: acct, creditCurrency: currency, creditNarration: `${row.col_name} - ${row.emp_name}`, creditProdRef: prodRef, creditBranch: branch });
    } else if (row.payment_deduction === 'Deduction') {
      const acct = row.salarycomponent_gl || fallbackDeductionGL;
      if (!acct) continue;
      creditAccounts.push({ creditAmount: amount, creditAccount: acct, creditCurrency: currency, creditNarration: `${row.col_name} - ${row.emp_name}`, creditProdRef: prodRef, creditBranch: branch });
    } else if (row.payment_deduction === 'Payment') {
      const acct = row.salarycomponent_gl || fallbackExpenseGL;
      if (!acct) continue;
      debitAccounts.push({ debitAmount: amount, debitAccount: acct, debitCurrency: currency, debitNarration: `${row.col_name} - ${row.emp_name}`, debitProdRef: prodRef, debitBranch: branch });
    }
  }

  const totalDr = debitAccounts.reduce((s, e) => s + e.debitAmount, 0);
  const totalCr = creditAccounts.reduce((s, e) => s + e.creditAmount, 0);
  if (Math.abs(totalDr - totalCr) > 0.01) {
    console.warn(`[payroll GL] run ${id} imbalanced — DR ${totalDr.toFixed(2)} CR ${totalCr.toFixed(2)} diff ${(totalCr - totalDr).toFixed(2)}.`);
  }

  return postToGL({ approvedBy, referenceNo, debitAccounts, creditAccounts });
}

// ── Finalize ──────────────────────────────────────────────────────────────────
// POST /payroll/runs/:id/finalize — mark a payroll run as Completed and attempt GL posting via the configured API.
// Sets status to 'GL Failed' (not Completed) when GL posting errors, allowing a retry without re-generating.
const finalizePayroll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status === 'Draft')            return respond.badReq(res, 'Generate the payroll before finalizing');
  if (run.status === 'Completed')        return respond.badReq(res, 'Already finalized');
  if (run.status === 'Pending Approval') return respond.badReq(res, 'Approve the payroll before finalizing');
  if (run.status === 'Rejected')         return respond.badReq(res, 'Regenerate the payroll before finalizing');

  let documentRef = null;
  let paymentLog  = null;
  let finalStatus = 'Completed';

  // ── GL posting ───────────────────────────────────────────────────────────────
  // Skip entirely when payroll postings are switched off (record-only mode) — the run still
  // finalizes to 'Completed', just without any journal posted to the general ledger.
  const glEnabled = await readControlSetting('payroll_payments_enabled', true);
  const _glUrl = glEnabled ? (await getApiConfig()).gl_url : null;
  if (_glUrl) {
    try {
      const result = await buildAndPostGL(id, req);
      documentRef = result.documentRef;
      paymentLog  = JSON.stringify(result.raw);
      console.log('[finalize] GL posting success, ref:', documentRef);
    } catch (e) {
      const errData = e.glResponse || e.response?.data || e.message;
      console.error('[finalize] GL posting error:', errData);
      paymentLog  = JSON.stringify({ error: errData });
      finalStatus = 'GL Failed';
    }
  }

  // status is an @map'd enum ('GL Failed' has a space); a bound text param won't cast to the enum on
  // Postgres, so inline it as a SQL literal chosen from the known 2-value set.
  const statusSql = finalStatus === 'GL Failed' ? Prisma.sql`'GL Failed'` : Prisma.sql`'Completed'`;
  await exec`
    UPDATE payrollruns SET status=${statusSql}, document_ref=${documentRef}, payment_log=${paymentLog},
      finalized_at=NOW(), updated_at=NOW() WHERE id=${BigInt(id)}`;
  await logAudit(id, 'finalize', req, { documentRef });
  logActivity({ module: 'Payroll', action: 'finalize', entityId: String(id), entityName: run.name, ...fromReq(req), details: { documentRef } });
  const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  respond.ok(res, 'Payroll finalized', rows[0] || null);
});

// ── Retry GL posting (for GL Failed runs) ────────────────────────────────────
// POST /payroll/runs/:id/retry-gl — re-attempt GL posting for a 'GL Failed' run; transitions to Completed on success.
const retryGLPosting = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status !== 'GL Failed') return respond.badReq(res, 'Only a GL Failed run can retry GL posting');
  if (run.document_ref) return respond.badReq(res, 'GL already posted for this run');
  if (!(await readControlSetting('payroll_payments_enabled', true))) return respond.badReq(res, 'Payroll GL posting is disabled in settings');
  if (!(await getApiConfig()).gl_url) return respond.badReq(res, 'GL API URL not configured');

  try {
    const result = await buildAndPostGL(id, req);
    await exec`
      UPDATE payrollruns SET status='Completed', document_ref=${result.documentRef}, payment_log=${JSON.stringify(result.raw)},
        updated_at=NOW() WHERE id=${BigInt(id)}`;
    logActivity({ module: 'Payroll', action: 'gl_retry_success', entityId: String(id), entityName: run.name, ...fromReq(req), details: { documentRef: result.documentRef } });
    const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
    respond.ok(res, 'GL posted successfully', rows[0] || null);
  } catch (e) {
    const errData = e.glResponse || e.response?.data || e.message;
    console.error('[gl retry] error:', errData);
    await exec`UPDATE payrollruns SET payment_log=${JSON.stringify({ error: errData })}, updated_at=NOW() WHERE id=${BigInt(id)}`;
    const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
    respond.ok(res, 'GL posting failed', rows[0] || null);
  }
});

// ── Multi-stage approval flow ─────────────────────────────────────────────────
// The flow is a global config (an ordered list of stages, each approved by a role OR a specific user),
// stored as the `payroll_approval_flow` app-control (JSON). When a run is submitted it is snapshotted
// into payrollrun_stages so editing the flow can't corrupt an in-flight run; the "current" stage is the
// lowest stage_order still Pending. With no flow configured, approval stays single-stage (legacy).

/** Read + normalise the configured approval flow (array; [] when unset/invalid). */
async function readApprovalFlow() {
  const rows = await query`SELECT value FROM settings WHERE name='payroll_approval_flow' AND category='app_controls' LIMIT 1`.catch(() => []);
  if (!rows[0]?.value) return [];
  try {
    const arr = JSON.parse(rows[0].value);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(s => s && String(s.name || '').trim() && (s.approverType === 'role' || s.approverType === 'user') && s.approverId != null && String(s.approverId).trim() !== '')
      .map(s => ({ name: String(s.name).trim(), approverType: s.approverType, approverId: String(s.approverId), approverLabel: s.approverLabel != null ? String(s.approverLabel) : null }));
  } catch { return []; }
}

/** Does the signed-in user satisfy a stage? role → they hold that role; user → they ARE that user. */
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

/**
 * May this actor act on the run's approval at all? Being named as the current stage's approver grants
 * authority for THIS run even without the blanket `approve_payroll` permission — that is the whole point
 * of assigning specific people/roles per stage. Blanket approvers can always act (they cover the no-flow
 * single-stage path and any stage). `currentStage` is the lowest-order Pending stage, or null when there
 * is no configured flow.
 */
function canActOnApproval(req, currentStage) {
  if ((req.user?.permissions || []).includes('approve_payroll')) return true;
  return currentStage ? actorMatchesStage(req, currentStage) : false;
}

/** Notify a stage's approver(s): a user stage pings that user; a role stage pings all payroll approvers. */
function notifyStageApprovers(stage, runName, req) {
  const type = stage.approver_type ?? stage.approverType;
  const idv = stage.approver_id ?? stage.approverId;
  const stageName = stage.stage_name ?? stage.name;
  const payload = { message: `Payroll run "${runName}" awaits your approval (${stageName})`, action: 'Payroll', type: 'payroll', fromUser: req.user?.id };
  if (type === 'user' && idv) notifyUser(idv, payload);
  else notifyUsersWithRole(idv, payload, req.user?.id, stage.approver_label ?? stage.approverLabel);
}

// GET /payroll/approval-flow — the configured stages (empty array when none set).
const getApprovalFlow = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Approval flow retrieved', await readApprovalFlow());
});

// PUT /payroll/approval-flow — replace the flow. Body: { stages: [{ name, approverType, approverId, approverLabel? }] }
const saveApprovalFlow = asyncHandler(async (req, res) => {
  const input = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const clean = [];
  for (const s of input) {
    const name = String(s?.name ?? '').trim();
    const approverType = s?.approverType === 'user' ? 'user' : s?.approverType === 'role' ? 'role' : null;
    const approverId = s?.approverId != null && String(s.approverId).trim() !== '' ? String(s.approverId).trim() : null;
    if (!name) return respond.badReq(res, 'Every stage needs a name');
    if (!approverType) return respond.badReq(res, `Stage "${name}" needs an approver type (role or user)`);
    if (!approverId) return respond.badReq(res, `Stage "${name}" needs an approver`);
    clean.push({ name, approverType, approverId, approverLabel: s?.approverLabel != null ? String(s.approverLabel) : null });
  }
  await upsertSetting(null, 'payroll_approval_flow', 'app_controls', JSON.stringify(clean));
  logActivity({ module: 'Payroll', action: 'save_approval_flow', entityName: `${clean.length} stage(s)`, ...fromReq(req) });
  respond.ok(res, 'Approval flow saved', clean);
});

// GET /payroll/runs/:id/stages — a run's stage snapshot + per-stage progress.
const getRunStages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const stages = await query`
    SELECT id, stage_order, stage_name, approver_type, approver_id, approver_label, status, acted_by, acted_at, comment
    FROM payrollrun_stages WHERE run_id = ${BigInt(id)} ORDER BY stage_order ASC`;
  respond.ok(res, 'Run stages retrieved', stages);
});

// ── Approval workflow ─────────────────────────────────────────────────────────
// POST /payroll/runs/:id/submit — move a Processing run to 'Pending Approval' for sign-off before finalization.
const submitPayroll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`SELECT status, name FROM payrollruns WHERE id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status !== 'Processing') return respond.badReq(res, 'Only a Processing run can be submitted for approval');
  const userId = req.user?.id ? BigInt(req.user.id) : null;

  // Snapshot the configured multi-stage flow onto this run (all Pending). No flow → single-stage.
  const flow = await readApprovalFlow();
  await exec`DELETE FROM payrollrun_stages WHERE run_id = ${BigInt(id)}`;
  for (let i = 0; i < flow.length; i++) {
    const st = flow[i];
    await exec`
      INSERT INTO payrollrun_stages (run_id, stage_order, stage_name, approver_type, approver_id, approver_label, status)
       VALUES (${BigInt(id)}, ${i}, ${st.name}, ${st.approverType}, ${String(st.approverId)}, ${st.approverLabel}, 'Pending')`;
  }

  await exec`UPDATE payrollruns SET status='Pending Approval', submitted_by=${userId}, approved_by=NULL, approved_at=NULL, updated_at=NOW() WHERE id=${BigInt(id)}`;
  await logAudit(id, 'submit', req);
  logActivity({ module: 'Payroll', action: 'submit', entityId: String(id), entityName: run.name, ...fromReq(req) });

  if (flow.length) notifyStageApprovers(flow[0], run.name, req);
  else notifyUsersWithPermission('approve_payroll', { message: 'A payroll run awaits your approval', action: 'Payroll', type: 'payroll', fromUser: req.user?.id }, req.user?.id);

  const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  respond.ok(res, 'Submitted for approval', rows[0] || null);
});

// POST /payroll/runs/:id/approve — approve the current approval stage; when the last stage clears,
// the run transitions to 'Approved'. With no configured flow it stays single-stage (one approval).
const approvePayroll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`SELECT status, submitted_by, name FROM payrollruns WHERE id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status !== 'Pending Approval') return respond.badReq(res, 'Run is not pending approval');

  const userId = req.user?.id ? BigInt(req.user.id) : null;
  const stages = await query`
    SELECT id, stage_order, stage_name, approver_type, approver_id, approver_label, status
    FROM payrollrun_stages WHERE run_id = ${BigInt(id)} ORDER BY stage_order ASC`;
  const pending = stages.filter(st => st.status === 'Pending');

  // Authority: the route is no longer permission-guarded, so gate here — a blanket `approve_payroll`
  // holder, or the current stage's assigned approver, may act. Everyone else is denied.
  if (!canActOnApproval(req, pending[0] || null))
    return respond.forbidden(res, 'You are not authorised to approve this payroll run');

  // Self-approval guard: the user who submitted the run may approve only when the control is on.
  if (String(run.submitted_by ?? '') === String(req.user?.id ?? '')) {
    if (!(await readControlSetting('approval_payroll_self', false)))
      return respond.forbidden(res, 'Self-approval is disabled — a different approver must review this payroll run');
  }

  if (pending.length) {
    // ── multi-stage ──
    const stage = pending[0]; // current stage = lowest-order Pending
    if (!actorMatchesStage(req, stage)) {
      const who = stage.approver_label || (stage.approver_type === 'user' ? 'the assigned approver' : 'the assigned role');
      return respond.forbidden(res, `Only ${who} can approve the "${stage.stage_name}" stage`);
    }
    await exec`UPDATE payrollrun_stages SET status='Approved', acted_by=${userId}, acted_at=NOW(), comment=${req.body?.comment?.trim() || null} WHERE id=${BigInt(stage.id)}`;
    await logAudit(id, 'approve_stage', req, { stage: stage.stage_name });

    if (pending.length > 1) {
      // more stages remain — advance, keep the run Pending Approval
      notifyStageApprovers(pending[1], run.name, req);
      logActivity({ module: 'Payroll', action: 'approve_stage', entityId: String(id), entityName: run.name, details: { stage: stage.stage_name }, ...fromReq(req) });
      const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
      return respond.ok(res, `"${stage.stage_name}" approved — awaiting the next stage`, rows[0] || null);
    }
    // last stage cleared → final approval below
  }

  await exec`UPDATE payrollruns SET status='Approved', approved_by=${userId}, approved_at=NOW(), updated_at=NOW() WHERE id=${BigInt(id)}`;
  await logAudit(id, 'approve', req);
  logActivity({ module: 'Payroll', action: 'approve', entityId: String(id), entityName: run.name, ...fromReq(req) });
  if (run.submitted_by && String(run.submitted_by) !== String(req.user?.id ?? '')) {
    notifyUser(run.submitted_by, { message: 'Your payroll run was fully approved', action: 'Payroll', type: 'payroll', fromUser: req.user?.id });
  }
  const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  respond.ok(res, 'Payroll approved', rows[0] || null);
});

// POST /payroll/runs/:id/reject — reject the run at its current stage (with an optional reason) and send
// it back for regeneration. In a multi-stage flow only the current stage's approver may reject.
const rejectPayroll = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const [run] = await query`SELECT status, submitted_by, name FROM payrollruns WHERE id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  if (run.status !== 'Pending Approval') return respond.badReq(res, 'Run is not pending approval');

  const stages = await query`
    SELECT id, stage_name, approver_type, approver_id, approver_label, status
    FROM payrollrun_stages WHERE run_id = ${BigInt(id)} AND status='Pending' ORDER BY stage_order ASC`;
  const current = stages[0];

  // Authority: route is no longer permission-guarded — allow a blanket approver or the current stage's
  // assigned approver; deny everyone else.
  if (!canActOnApproval(req, current || null))
    return respond.forbidden(res, 'You are not authorised to reject this payroll run');

  if (current) {
    if (!actorMatchesStage(req, current)) {
      const who = current.approver_label || (current.approver_type === 'user' ? 'the assigned approver' : 'the assigned role');
      return respond.forbidden(res, `Only ${who} can act on the "${current.stage_name}" stage`);
    }
    const userId = req.user?.id ? BigInt(req.user.id) : null;
    await exec`UPDATE payrollrun_stages SET status='Rejected', acted_by=${userId}, acted_at=NOW(), comment=${reason?.trim() || null} WHERE id=${BigInt(current.id)}`;
  }

  await exec`UPDATE payrollruns SET status='Rejected', rejection_reason=${reason?.trim() || null}, updated_at=NOW() WHERE id=${BigInt(id)}`;
  await logAudit(id, 'reject', req, { reason: reason?.trim() || null, stage: current?.stage_name });
  if (run.submitted_by && String(run.submitted_by) !== String(req.user?.id ?? '')) {
    notifyUser(run.submitted_by, { message: `Your payroll run was rejected${reason?.trim() ? ': ' + reason.trim() : ''}`, action: 'Payroll', type: 'payroll', fromUser: req.user?.id });
  }
  logActivity({ module: 'Payroll', action: 'reject', entityId: String(id), entityName: run.name, details: { reason: reason?.trim() || null }, ...fromReq(req) });
  const rows = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  respond.ok(res, 'Payroll rejected', rows[0] || null);
});

// ── Audit log ─────────────────────────────────────────────────────────────────
// GET /payroll/runs/:id/audit — retrieve the chronological audit trail of all actions taken on a payroll run.
const getPayrollAudit = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const entries = await query`
    SELECT id, run_id, action, user_id, user_name, details, created_at FROM payrollrunaudit WHERE run_id = ${BigInt(id)} ORDER BY created_at ASC`;
  respond.ok(res, 'Audit log retrieved', entries);
});

// POST /payroll/runs/:id/duplicate — copy a run's config (frequency, dates, group) into a new Draft run
// named "<original> (Copy)", without copying the payroll data.
const duplicatePayrollRun = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [run] = await query`${RUNS_SELECT} WHERE pr.id = ${BigInt(id)}`;
  if (!run) return respond.notFound(res, 'Run not found');
  await exec`
    INSERT INTO payrollruns (name, pay_frequency, date_start, date_end, deduction_group, payment_type_id, status)
     VALUES (${`${run.name} (Copy)`}, ${run.pay_frequency ? parseInt(run.pay_frequency) : null},
             ${toDate(run.date_start)}, ${toDate(run.date_end)},
             ${run.deduction_group ? BigInt(run.deduction_group) : null}, ${run.payment_type_id ? BigInt(run.payment_type_id) : null}, 'Draft')`;
  const rows = await query`${RUNS_SELECT} ORDER BY pr.id DESC LIMIT 1`;
  logActivity({ module: 'Payroll', action: 'duplicate_run', entityId: String(id), entityName: run.name, ...fromReq(req) });
  respond.created(res, 'Run duplicated', rows[0] || null);
});

module.exports = {
  getPayrollRuns, createPayrollRun, updatePayrollRun, deletePayrollRun,
  generatePayroll, getPayrollData, updatePayrollDataItem, finalizePayroll, retryGLPosting,
  submitPayroll, approvePayroll, rejectPayroll, getPayrollAudit, duplicatePayrollRun,
  debugPayrollRun,
  getApprovalFlow, saveApprovalFlow, getRunStages,
};
