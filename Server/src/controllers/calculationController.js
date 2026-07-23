const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');

const { serialize, toBigInt, enumSql } = require('../helpers/controllerHelpers');
const { tokenizeFormula, detokenizeFormula } = require('../helpers/payrollFormula');
const { Prisma } = require('@prisma/client'); // Prisma.sql for reusable/portable SQL fragments

function toDecimalString(val) {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n.toFixed(4) : null;
}

// Tagged-template query helpers — portable (Prisma emits the right placeholders per provider).
// Call as query`SELECT ... ${value}` (values become bound parameters).
async function query(strings, ...values) {
  return serialize(await prisma.$queryRaw(strings, ...values));
}

async function exec(strings, ...values) {
  return prisma.$executeRaw(strings, ...values);
}

// ─── Payroll column ↔ calculation group (many-to-many via payrollcolumn_groups) ──

/** Map of payrollcolumn id (string) → array of group id strings it is scoped to. */
async function columnGroupsMap() {
  const rows = await query`SELECT payrollcolumn_id, group_id FROM payrollcolumn_groups`;
  const map = {};
  for (const r of rows) {
    const key = String(r.payrollcolumn_id);
    (map[key] ??= []).push(String(r.group_id));
  }
  return map;
}

/** Group ids for a single column. */
async function groupsForColumn(columnId) {
  const rows = await query`SELECT group_id FROM payrollcolumn_groups WHERE payrollcolumn_id = ${columnId}`;
  return rows.map(r => String(r.group_id));
}

/** Replace a column's group links with `groups` (array of ids or a comma-separated string).
 *  DELETE-then-insert with Set-deduped ids means the unique key can't collide, so a plain
 *  INSERT (portable) replaces the old MySQL-only INSERT IGNORE. */
async function syncColumnGroups(columnId, groups) {
  await exec`DELETE FROM payrollcolumn_groups WHERE payrollcolumn_id = ${columnId}`;
  const raw = Array.isArray(groups) ? groups : String(groups ?? '').split(',');
  const ids = [...new Set(raw.map(g => toBigInt(g)).filter(Boolean).map(String))];
  for (const gid of ids) {
    await exec`INSERT INTO payrollcolumn_groups (payrollcolumn_id, group_id) VALUES (${columnId}, ${BigInt(gid)})`;
  }
}

// ─── Payroll column ↔ salary components (payrollcolumn_components) ───────────────

/** Map of payrollcolumn id (string) → array of component id strings. */
async function columnComponentsMap() {
  const rows = await query`SELECT payrollcolumn_id, component_id FROM payrollcolumn_components`;
  const map = {};
  for (const r of rows) (map[String(r.payrollcolumn_id)] ??= []).push(String(r.component_id));
  return map;
}
async function componentsForColumn(columnId) {
  const rows = await query`SELECT component_id FROM payrollcolumn_components WHERE payrollcolumn_id = ${columnId}`;
  return rows.map(r => String(r.component_id));
}
/** Replace a column's linked salary components with `ids` (array or CSV of component ids). */
async function syncColumnComponents(columnId, ids) {
  await exec`DELETE FROM payrollcolumn_components WHERE payrollcolumn_id = ${columnId}`;
  const raw = Array.isArray(ids) ? ids : String(ids ?? '').split(',');
  const clean = [...new Set(raw.map(g => toBigInt(g)).filter(Boolean).map(String))];
  for (const cid of clean) {
    await exec`INSERT INTO payrollcolumn_components (payrollcolumn_id, component_id) VALUES (${columnId}, ${BigInt(cid)})`;
  }
}

// ─── Payroll column ↔ add/subtract column links (payrollcolumn_links) ────────────

/** Map of payrollcolumn id (string) → { add: [ids], subtract: [ids] }. */
async function columnLinksMap() {
  const rows = await query`SELECT payrollcolumn_id, target_column_id, operation FROM payrollcolumn_links`;
  const map = {};
  for (const r of rows) {
    const m = (map[String(r.payrollcolumn_id)] ??= { add: [], subtract: [] });
    (r.operation === 'subtract' ? m.subtract : m.add).push(String(r.target_column_id));
  }
  return map;
}
async function linksForColumn(columnId) {
  const rows = await query`SELECT target_column_id, operation FROM payrollcolumn_links WHERE payrollcolumn_id = ${columnId}`;
  const out = { add: [], subtract: [] };
  for (const r of rows) (r.operation === 'subtract' ? out.subtract : out.add).push(String(r.target_column_id));
  return out;
}
/** Replace a column's add/subtract links. `addIds`/`subIds` are arrays (or CSV) of column ids. */
async function syncColumnLinks(columnId, addIds, subIds) {
  await exec`DELETE FROM payrollcolumn_links WHERE payrollcolumn_id = ${columnId}`;
  const clean = v => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => parseInt(x, 10)).filter(n => Number.isInteger(n) && n !== Number(columnId)))];
  for (const tid of clean(addIds)) await exec`INSERT INTO payrollcolumn_links (payrollcolumn_id, target_column_id, operation) VALUES (${columnId}, ${tid}, 'add')`;
  for (const tid of clean(subIds)) await exec`INSERT INTO payrollcolumn_links (payrollcolumn_id, target_column_id, operation) VALUES (${columnId}, ${tid}, 'subtract')`;
}

/** Build {comp,col} id→name maps for detokenizing formulas back to current names for the client. */
async function nameMaps() {
  const comps = await query`SELECT id, name FROM salarycomponent`;
  const cols = await query`SELECT id, name FROM payrollcolumns`;
  return {
    compById: new Map(comps.map(c => [String(c.id), c.name])),
    colById: new Map(cols.map(c => [String(c.id), c.name])),
    comps, cols,
  };
}

/** Re-fetch one column and attach its junction refs + detokenized formula (the API shape). */
async function buildColumnResponse(id) {
  const [row] = await query`
    SELECT id, name, COALESCE(function_type,'Simple') AS function_type,
           COALESCE(enabled,'Yes') AS enabled, COALESCE(editable,'Yes') AS editable,
           colorder, default_value, payment_deduction,
           salarycomponent_gl, posting_column, posting_branch,
           calculation_function, calculation_rule,
           COALESCE(visible, TRUE) AS visible, COALESCE(include_in_net, TRUE) AS include_in_net,
           payslip_label
    FROM payrollcolumns WHERE id = ${id}`;
  if (!row) return null;
  const { compById, colById } = await nameMaps();
  const links = await linksForColumn(id);
  row.deduction_groups = await groupsForColumn(id);
  row.component_ids = await componentsForColumn(id);
  row.add_column_ids = links.add;
  row.sub_column_ids = links.subtract;
  row.calculation_function = detokenizeFormula(row.calculation_function, compById, colById);
  return row;
}

// ─── Payroll Columns ──────────────────────────────────────────────────────────

// GET /calculation/payroll-columns — list all payroll columns ordered by colorder, with all display/calculation config.
const getPayrollColumns = asyncHandler(async (_req, res) => {
  const rows = await query`
    SELECT id, name,
           COALESCE(function_type, 'Simple') AS function_type,
           COALESCE(enabled,       'Yes')    AS enabled,
           COALESCE(editable,      'Yes')    AS editable,
           colorder, default_value, payment_deduction,
           salarycomponent_gl, posting_column, posting_branch,
           calculation_function, calculation_rule,
           COALESCE(visible, TRUE) AS visible, COALESCE(include_in_net, TRUE) AS include_in_net,
           payslip_label
    FROM payrollcolumns
    ORDER BY COALESCE(colorder, 9999) ASC, name ASC`;
  const [groupMap, compMap, linkMap, { compById, colById }] = await Promise.all([
    columnGroupsMap(), columnComponentsMap(), columnLinksMap(), nameMaps(),
  ]);
  for (const r of rows) {
    const id = String(r.id);
    r.deduction_groups = groupMap[id] ?? [];
    r.component_ids    = compMap[id] ?? [];
    r.add_column_ids   = linkMap[id]?.add ?? [];
    r.sub_column_ids   = linkMap[id]?.subtract ?? [];
    r.calculation_function = detokenizeFormula(r.calculation_function, compById, colById);
  }
  respond.ok(res, 'Payroll columns retrieved', rows);
});

// POST /calculation/payroll-columns — create a new payroll column; auto-assigns next colorder if not provided.
// Blocks duplicate names. Supports salary_components, add/sub columns, formula, and calculation rule linking.
const createPayrollColumn = asyncHandler(async (req, res) => {
  const {
    name, function_type = 'Simple', enabled = 'Yes', editable = 'Yes', colorder, default_value, payment_deduction,
    salarycomponent_gl, posting_column, posting_branch, deduction_groups,
    component_ids, add_column_ids, sub_column_ids, calculation_function,
    calculation_rule, visible = 1, include_in_net = 1, payslip_label,
  } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const dup = await query`SELECT id FROM payrollcolumns WHERE UPPER(name) = UPPER(${name.trim()}) LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A column with this name already exists');

  const nextId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM payrollcolumns`)[0].nextId);
  const colorderVal = (colorder !== undefined && colorder !== '')
    ? parseInt(colorder)
    : Number((await query`SELECT COALESCE(MAX(colorder), 0) + 1 AS nextOrder FROM payrollcolumns`)[0].nextOrder);
  const { comps, cols } = await nameMaps();
  const { formula } = tokenizeFormula(calculation_function, comps, cols);
  // visible / include_in_net are Boolean columns — pass real booleans for PG portability.
  const visibleBool      = visible        !== undefined && visible        !== '' ? !!parseInt(visible)        : true;
  const includeInNetBool = include_in_net !== undefined && include_in_net !== '' ? !!parseInt(include_in_net) : true;
  await exec`
    INSERT INTO payrollcolumns (
      id, name, function_type, enabled, editable, colorder, default_value, payment_deduction,
      salarycomponent_gl, posting_column, posting_branch, calculation_function,
      calculation_rule, visible, include_in_net, payslip_label
    ) VALUES (${nextId}, ${name.trim()}, ${enumSql(function_type, ['Simple','Advanced'], 'Simple')}, ${enumSql(enabled, ['Yes','No'], 'Yes')}, ${enumSql(editable, ['Yes','No'], 'Yes')}, ${colorderVal},
             ${default_value?.trim() || null}, ${payment_deduction?.trim() || null}, ${salarycomponent_gl?.trim() || null},
             ${posting_column?.trim() || 'Yes'}, ${posting_branch?.trim() || null}, ${formula?.trim() || null},
             ${calculation_rule ? parseInt(calculation_rule) : null}, ${visibleBool}, ${includeInNetBool},
             ${payslip_label?.trim() || null})`;
  await syncColumnGroups(nextId, deduction_groups);
  await syncColumnComponents(nextId, component_ids);
  await syncColumnLinks(nextId, add_column_ids, sub_column_ids);
  respond.created(res, 'Payroll column created', await buildColumnResponse(nextId));
});

// PUT /calculation/payroll-columns/:id — update all fields on a payroll column; blocks duplicate names.
const updatePayrollColumn = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const {
    name, function_type, enabled, editable, colorder, default_value, payment_deduction,
    salarycomponent_gl, posting_column, posting_branch, deduction_groups,
    component_ids, add_column_ids, sub_column_ids, calculation_function,
    calculation_rule, visible, include_in_net, payslip_label,
  } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const existing = await query`SELECT id FROM payrollcolumns WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Payroll column not found');

  const dup = await query`SELECT id FROM payrollcolumns WHERE UPPER(name) = UPPER(${name.trim()}) AND id <> ${id} LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A column with this name already exists');

  const { comps, cols } = await nameMaps();
  const { formula } = tokenizeFormula(calculation_function, comps, cols);
  // visible / include_in_net are Boolean columns — pass real booleans for PG portability.
  const visibleBool      = visible        !== undefined && visible        !== '' ? !!parseInt(visible)        : true;
  const includeInNetBool = include_in_net !== undefined && include_in_net !== '' ? !!parseInt(include_in_net) : true;
  await exec`
    UPDATE payrollcolumns SET
      name=${name.trim()}, function_type=${enumSql(function_type, ['Simple','Advanced'], 'Simple')}, enabled=${enumSql(enabled, ['Yes','No'], 'Yes')}, editable=${enumSql(editable, ['Yes','No'], 'Yes')},
      colorder=${colorder !== undefined && colorder !== '' ? parseInt(colorder) : null},
      default_value=${default_value?.trim() || null}, payment_deduction=${payment_deduction?.trim() || null},
      salarycomponent_gl=${salarycomponent_gl?.trim() || null}, posting_column=${posting_column?.trim() || 'Yes'},
      posting_branch=${posting_branch?.trim() || null}, calculation_function=${formula?.trim() || null},
      calculation_rule=${calculation_rule ? parseInt(calculation_rule) : null},
      visible=${visibleBool}, include_in_net=${includeInNetBool}, payslip_label=${payslip_label?.trim() || null}
    WHERE id=${id}`;
  await syncColumnGroups(id, deduction_groups);
  await syncColumnComponents(id, component_ids);
  await syncColumnLinks(id, add_column_ids, sub_column_ids);
  respond.ok(res, 'Payroll column updated', await buildColumnResponse(id));
});

// DELETE /calculation/payroll-columns/:id — permanently delete a payroll column by ID.
const deletePayrollColumn = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');

  const existing = await query`SELECT id FROM payrollcolumns WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Payroll column not found');

  // Clean up junction rows where this column is the owner OR a referenced target.
  await exec`DELETE FROM payrollcolumn_groups WHERE payrollcolumn_id = ${id}`;
  await exec`DELETE FROM payrollcolumn_components WHERE payrollcolumn_id = ${id}`;
  await exec`DELETE FROM payrollcolumn_links WHERE payrollcolumn_id = ${id} OR target_column_id = ${id}`;
  await exec`DELETE FROM payrollcolumns WHERE id = ${id}`;
  respond.ok(res, 'Payroll column deleted');
});

// PUT /calculation/payroll-columns/reorder — bulk-update colorder for multiple columns; used by drag-and-drop UI.
const reorderPayrollColumns = asyncHandler(async (req, res) => {
  const updates = req.body;
  if (!Array.isArray(updates) || !updates.length) return respond.badReq(res, 'Array of {id, colorder} required');
  for (const u of updates) {
    if (u.id == null || u.colorder == null) return respond.badReq(res, 'Each item needs id and colorder');
    await exec`UPDATE payrollcolumns SET colorder=${parseInt(u.colorder)} WHERE id=${toBigInt(u.id)}`;
  }
  respond.ok(res, 'Column order updated');
});

// ─── Calculation Groups ───────────────────────────────────────────────────────

// GET /calculation/groups — list all calculation groups used to organise saved calculation rules.
const getCalcGroups = asyncHandler(async (_req, res) => {
  const rows = await query`SELECT id, name, details, created_at FROM calculationgroups ORDER BY name ASC`;
  respond.ok(res, 'Calculation groups retrieved', rows);
});

// POST /calculation/groups — create a calculation group; blocks duplicate names.
const createCalcGroup = asyncHandler(async (req, res) => {
  const { name, details } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const dup = await query`SELECT id FROM calculationgroups WHERE UPPER(name) = UPPER(${name.trim()}) LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A calculation group with this name already exists');

  const nextId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM calculationgroups`)[0].nextId);
  await exec`INSERT INTO calculationgroups (id, name, details) VALUES (${nextId}, ${name.trim()}, ${details?.trim() || null})`;
  const [created] = await query`SELECT id, name, details, created_at FROM calculationgroups WHERE id = ${nextId}`;
  respond.created(res, 'Calculation group created', created);
});

// PUT /calculation/groups/:id — update a calculation group's name or description; blocks duplicate names.
const updateCalcGroup = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { name, details } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const existing = await query`SELECT id FROM calculationgroups WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Calculation group not found');

  const dup = await query`SELECT id FROM calculationgroups WHERE UPPER(name) = UPPER(${name.trim()}) AND id <> ${id} LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A calculation group with this name already exists');

  await exec`UPDATE calculationgroups SET name = ${name.trim()}, details = ${details?.trim() || null} WHERE id = ${id}`;
  const [updated] = await query`SELECT id, name, details, created_at FROM calculationgroups WHERE id = ${id}`;
  respond.ok(res, 'Calculation group updated', updated);
});

// DELETE /calculation/groups/:id — delete a calculation group; blocked if any saved calculations still reference it.
const deleteCalcGroup = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');

  const existing = await query`SELECT id FROM calculationgroups WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Calculation group not found');

  const inUse = await query`SELECT id FROM savedcalculations WHERE calculation_group_id = ${id} LIMIT 1`;
  if (inUse.length) return respond.conflict(res, 'Cannot delete: group is in use by saved calculations');

  await exec`DELETE FROM calculationgroups WHERE id = ${id}`;
  respond.ok(res, 'Calculation group deleted');
});

// ─── Saved Calculations ───────────────────────────────────────────────────────

// GET /calculation/saved — list all saved calculation rules with their group name (no bracket items for speed).
const getSavedCalculations = asyncHandler(async (_req, res) => {
  const rows = await query`
    SELECT sc.id, sc.name, sc.target_type, sc.target_id, sc.target_name, sc.calculation_group_id,
           cg.name AS group_name
    FROM savedcalculations sc
    LEFT JOIN calculationgroups cg ON cg.id = sc.calculation_group_id
    ORDER BY sc.name ASC`;
  respond.ok(res, 'Saved calculations retrieved', rows);
});

// GET /calculation/saved/:id — get a single saved calculation with its full bracket item list.
const getSavedCalculationById = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');

  const rows = await query`
    SELECT sc.id, sc.name, sc.target_type, sc.target_id, sc.target_name, sc.calculation_group_id,
           cg.name AS group_name
    FROM savedcalculations sc
    LEFT JOIN calculationgroups cg ON cg.id = sc.calculation_group_id
    WHERE sc.id = ${id} LIMIT 1`;
  if (!rows.length) return respond.notFound(res, 'Saved calculation not found');

  const items = await query`
    SELECT id,
           lower_limit_condition, CONCAT(lower_limit, '') AS lower_limit,
           upper_limit_condition, CONCAT(upper_limit, '') AS upper_limit,
           value, sort_order
    FROM calculationprocessitems
    WHERE saved_calculation_id = ${id}
    ORDER BY sort_order ASC, id ASC`;

  respond.ok(res, 'Saved calculation retrieved', { ...rows[0], items });
});

// POST /calculation/saved — create a saved calculation with its bracket process items in one request.
// Target_type is either 'component' (salary component base) or 'column' (payroll column base).
const createSavedCalculation = asyncHandler(async (req, res) => {
  const { name, target_type, target_id, target_name, calculation_group_id, items = [] } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');
  if (!['component', 'column'].includes(target_type)) return respond.badReq(res, 'Invalid target type');

  const dup = await query`SELECT id FROM savedcalculations WHERE UPPER(name) = UPPER(${name.trim()}) LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A saved calculation with this name already exists');

  const nextId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM savedcalculations`)[0].nextId);
  const groupId = calculation_group_id ? toBigInt(calculation_group_id) : null;
  const targetId = target_id ? toBigInt(target_id) : null;

  await exec`
    INSERT INTO savedcalculations (id, name, target_type, target_id, target_name, calculation_group_id)
     VALUES (${nextId}, ${name.trim()}, ${target_type}, ${targetId}, ${target_name?.trim() || null}, ${groupId})`;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nextItemId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextItemId FROM calculationprocessitems`)[0].nextItemId);
    await exec`
      INSERT INTO calculationprocessitems
        (id, saved_calculation_id, lower_limit_condition, lower_limit, upper_limit_condition, upper_limit, value, sort_order)
       VALUES (${nextItemId}, ${nextId}, ${item.lower_limit_condition || 'NO_LOWER_LIMIT'}, ${toDecimalString(item.lower_limit)},
               ${item.upper_limit_condition || 'NO_UPPER_LIMIT'}, ${toDecimalString(item.upper_limit)},
               ${item.value?.toString().trim() || '0'}, ${i})`;
  }

  const [created] = await query`SELECT id, name, target_type, target_id, target_name, calculation_group_id FROM savedcalculations WHERE id = ${nextId}`;
  respond.created(res, 'Saved calculation created', created);
});

// PUT /calculation/saved/:id — replace a saved calculation's metadata and bracket items (full replace, not patch).
const updateSavedCalculation = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { name, target_type, target_id, target_name, calculation_group_id, items = [] } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');
  if (!['component', 'column'].includes(target_type)) return respond.badReq(res, 'Invalid target type');

  const existing = await query`SELECT id FROM savedcalculations WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Saved calculation not found');

  const dup = await query`SELECT id FROM savedcalculations WHERE UPPER(name) = UPPER(${name.trim()}) AND id <> ${id} LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A saved calculation with this name already exists');

  const groupId = calculation_group_id ? toBigInt(calculation_group_id) : null;
  const targetId = target_id ? toBigInt(target_id) : null;

  await exec`
    UPDATE savedcalculations SET name = ${name.trim()}, target_type = ${target_type}, target_id = ${targetId},
      target_name = ${target_name?.trim() || null}, calculation_group_id = ${groupId} WHERE id = ${id}`;

  await exec`DELETE FROM calculationprocessitems WHERE saved_calculation_id = ${id}`;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nextItemId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextItemId FROM calculationprocessitems`)[0].nextItemId);
    await exec`
      INSERT INTO calculationprocessitems
        (id, saved_calculation_id, lower_limit_condition, lower_limit, upper_limit_condition, upper_limit, value, sort_order)
       VALUES (${nextItemId}, ${id}, ${item.lower_limit_condition || 'NO_LOWER_LIMIT'}, ${toDecimalString(item.lower_limit)},
               ${item.upper_limit_condition || 'NO_UPPER_LIMIT'}, ${toDecimalString(item.upper_limit)},
               ${item.value?.toString().trim() || '0'}, ${i})`;
  }

  const [updated] = await query`SELECT id, name, target_type, target_id, target_name, calculation_group_id FROM savedcalculations WHERE id = ${id}`;
  respond.ok(res, 'Saved calculation updated', updated);
});

// DELETE /calculation/saved/:id — delete a saved calculation and all its bracket process items.
const deleteSavedCalculation = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');

  const existing = await query`SELECT id FROM savedcalculations WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Saved calculation not found');

  await exec`DELETE FROM calculationprocessitems WHERE saved_calculation_id = ${id}`;
  await exec`DELETE FROM savedcalculations WHERE id = ${id}`;
  respond.ok(res, 'Saved calculation deleted');
});

// ─── Pay Frequencies ─────────────────────────────────────────────────────────

// GET /calculation/pay-frequencies — list all pay frequencies (Weekly, Monthly, etc.) ordered by sort_order.
const getPayFrequencies = asyncHandler(async (_req, res) => {
  const rows = await query`SELECT id, name, description, is_active, sort_order FROM payfrequencies ORDER BY sort_order ASC, name ASC`;
  respond.ok(res, 'Pay frequencies retrieved', rows);
});

// POST /calculation/pay-frequencies — create a pay frequency; blocks duplicates.
const createPayFrequency = asyncHandler(async (req, res) => {
  const { name, description, sort_order } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');
  const dup = await query`SELECT id FROM payfrequencies WHERE UPPER(name) = UPPER(${name.trim()}) LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A pay frequency with this name already exists');
  // id is autoincrement — use the Prisma builder so we get the generated id back portably
  // (MySQL's LAST_INSERT_ID() has no cross-dialect equivalent in raw SQL).
  const created = await prisma.payfrequencies.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      sort_order: sort_order != null && sort_order !== '' ? parseInt(sort_order) : 99,
    },
    select: { id: true, name: true, description: true, is_active: true, sort_order: true },
  });
  respond.created(res, 'Pay frequency created', serialize(created));
});

// PUT /calculation/pay-frequencies/:id — update a pay frequency's name, description, sort order, or active flag.
const updatePayFrequency = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { name, description, sort_order, is_active } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');
  const existing = await query`SELECT id FROM payfrequencies WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Pay frequency not found');
  const dup = await query`SELECT id FROM payfrequencies WHERE UPPER(name) = UPPER(${name.trim()}) AND id <> ${id} LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'A pay frequency with this name already exists');
  await exec`
    UPDATE payfrequencies SET name=${name.trim()}, description=${description?.trim() || null},
      sort_order=${sort_order != null && sort_order !== '' ? parseInt(sort_order) : 99},
      is_active=${is_active !== undefined ? !!is_active : true}
     WHERE id=${id}`;
  const [updated] = await query`SELECT id, name, description, is_active, sort_order FROM payfrequencies WHERE id = ${id}`;
  respond.ok(res, 'Pay frequency updated', updated);
});

// DELETE /calculation/pay-frequencies/:id — delete a pay frequency; blocked if assigned to any payroll employees.
const deletePayFrequency = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const existing = await query`SELECT id FROM payfrequencies WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Pay frequency not found');
  const inUse = await query`SELECT id FROM payrollemployees WHERE pay_frequency = ${id} LIMIT 1`;
  if (inUse.length) return respond.conflict(res, 'Cannot delete: frequency is used by payroll employees');
  await exec`DELETE FROM payfrequencies WHERE id = ${id}`;
  respond.ok(res, 'Pay frequency deleted');
});

// ─── Payroll Employees ────────────────────────────────────────────────────────
// Payroll employee records link an employee to their pay frequency, currency, deduction group,
// and any component exemptions. One record per employee — duplicate employee is blocked.

// Reusable SELECT fragment (Prisma.sql so it composes into tagged queries).
const PE_SELECT = Prisma.sql`
  SELECT pe.id, pe.employee,
         TRIM(CONCAT(COALESCE(e.firstName,''), ' ', COALESCE(e.lastName,''))) AS emp_name,
         pe.pay_frequency, pf.name AS freq_name,
         pe.currency,
         pe.deduction_group, cg.name AS group_name,
         pe.deduction_exemptions
  FROM payrollemployees pe
  LEFT JOIN employee e  ON e.id  = pe.employee
  LEFT JOIN payfrequencies pf ON pf.id = pe.pay_frequency
  LEFT JOIN calculationgroups cg ON cg.id = pe.deduction_group
`;

// GET /calculation/payroll-employees — list all payroll employee setup records with employee name, frequency, and group.
const getPayrollEmployees = asyncHandler(async (_req, res) => {
  const rows = await query`${PE_SELECT} ORDER BY emp_name ASC`;
  respond.ok(res, 'Payroll employees retrieved', rows);
});

// POST /calculation/payroll-employees — enrol an employee in the payroll system with their frequency, currency, and group.
const createPayrollEmployee = asyncHandler(async (req, res) => {
  const { employee, pay_frequency, currency, deduction_group, deduction_exemptions } = req.body;
  if (!employee)      return respond.badReq(res, 'Employee is required');
  if (!pay_frequency) return respond.badReq(res, 'Pay frequency is required');
  if (!currency)      return respond.badReq(res, 'Currency is required');

  const empId = toBigInt(employee);
  const dup = await query`SELECT id FROM payrollemployees WHERE employee = ${empId} LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'This employee already has a payroll record');

  const nextId = Number((await query`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM payrollemployees`)[0].nextId);
  await exec`
    INSERT INTO payrollemployees (id, employee, pay_frequency, currency, deduction_group, deduction_exemptions)
     VALUES (${nextId}, ${empId}, ${toBigInt(pay_frequency)}, ${currency?.trim() || null},
             ${deduction_group ? toBigInt(deduction_group) : null}, ${deduction_exemptions?.trim() || null})`;
  const [created] = await query`${PE_SELECT} WHERE pe.id = ${nextId}`;
  respond.created(res, 'Payroll employee created', created);
});

// PUT /calculation/payroll-employees/:id — update an employee's payroll settings (frequency, currency, group, exemptions).
const updatePayrollEmployee = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { employee, pay_frequency, currency, deduction_group, deduction_exemptions } = req.body;
  if (!employee)      return respond.badReq(res, 'Employee is required');
  if (!pay_frequency) return respond.badReq(res, 'Pay frequency is required');
  if (!currency)      return respond.badReq(res, 'Currency is required');

  const existing = await query`SELECT id FROM payrollemployees WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Payroll employee not found');

  const empId = toBigInt(employee);
  const dup = await query`SELECT id FROM payrollemployees WHERE employee = ${empId} AND id <> ${id} LIMIT 1`;
  if (dup.length) return respond.conflict(res, 'This employee already has a payroll record');

  await exec`
    UPDATE payrollemployees SET employee=${empId}, pay_frequency=${toBigInt(pay_frequency)}, currency=${currency?.trim() || null},
      deduction_group=${deduction_group ? toBigInt(deduction_group) : null}, deduction_exemptions=${deduction_exemptions?.trim() || null}
     WHERE id=${id}`;
  const [updated] = await query`${PE_SELECT} WHERE pe.id = ${id}`;
  respond.ok(res, 'Payroll employee updated', updated);
});

// DELETE /calculation/payroll-employees/:id — remove an employee from the payroll system.
const deletePayrollEmployee = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const existing = await query`SELECT id FROM payrollemployees WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return respond.notFound(res, 'Payroll employee not found');
  await exec`DELETE FROM payrollemployees WHERE id = ${id}`;
  respond.ok(res, 'Payroll employee deleted');
});

// ── Payslip templates ─────────────────────────────────────────────────────────

// Base SELECT fragment (Prisma.sql) — callers append ORDER BY / WHERE as a tagged query.
const PAYSLIP_SELECT = Prisma.sql`
  SELECT ps.*, cg.name AS group_name, pt.name AS type_name
  FROM payslip_settings ps
  LEFT JOIN calculationgroups cg ON cg.id = ps.deduction_group_id
  LEFT JOIN paymenttype pt ON pt.id = ps.payment_type_id
`;

// GET /calculation/payslip-templates — list all payslip templates with their deduction group and payment type names.
const getPayslipTemplates = asyncHandler(async (_req, res) => {
  const rows = await query`${PAYSLIP_SELECT} ORDER BY ps.id ASC`;
  respond.ok(res, 'Payslip templates retrieved', rows);
});

// POST /calculation/payslip-templates — create a payslip template with branding, visible column list, and display flags.
const createPayslipTemplate = asyncHandler(async (req, res) => {
  const { template_name, deduction_group_id, payment_type_id, company_name, company_address, company_logo_url,
          header_note, footer_note, accent_color, show_emp_id, show_department,
          show_position, show_bank_account, visible_columns, net_columns } = req.body;
  if (!template_name?.trim()) return respond.badReq(res, 'Template name is required');
  // show_* are Boolean columns — pass real booleans for PG portability.
  await exec`
    INSERT INTO payslip_settings
       (template_name, deduction_group_id, payment_type_id, company_name, company_address, company_logo_url,
        header_note, footer_note, accent_color, show_emp_id, show_department,
        show_position, show_bank_account, visible_columns, net_columns)
     VALUES (${template_name.trim()}, ${deduction_group_id ? BigInt(deduction_group_id) : null}, ${payment_type_id ? BigInt(payment_type_id) : null},
             ${company_name || null}, ${company_address || null}, ${company_logo_url || null},
             ${header_note || null}, ${footer_note || null}, ${accent_color || '#3B82F6'},
             ${!!show_emp_id}, ${!!show_department}, ${!!show_position}, ${!!show_bank_account},
             ${visible_columns?.length ? JSON.stringify(visible_columns) : null},
             ${net_columns?.length ? JSON.stringify(net_columns) : null})`;
  const rows = await query`${PAYSLIP_SELECT} ORDER BY ps.id ASC`;
  respond.created(res, 'Template created', rows[rows.length - 1] ?? null);
});

// PUT /calculation/payslip-templates/:id — update a payslip template's branding, column visibility, or display flags.
const updatePayslipTemplate = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { template_name, deduction_group_id, payment_type_id, company_name, company_address, company_logo_url,
          header_note, footer_note, accent_color, show_emp_id, show_department,
          show_position, show_bank_account, visible_columns, net_columns } = req.body;
  if (!template_name?.trim()) return respond.badReq(res, 'Template name is required');
  // show_* are Boolean columns — pass real booleans for PG portability.
  await exec`
    UPDATE payslip_settings SET
       template_name=${template_name.trim()}, deduction_group_id=${deduction_group_id ? BigInt(deduction_group_id) : null},
       payment_type_id=${payment_type_id ? BigInt(payment_type_id) : null}, company_name=${company_name || null},
       company_address=${company_address || null}, company_logo_url=${company_logo_url || null},
       header_note=${header_note || null}, footer_note=${footer_note || null}, accent_color=${accent_color || '#3B82F6'},
       show_emp_id=${!!show_emp_id}, show_department=${!!show_department}, show_position=${!!show_position}, show_bank_account=${!!show_bank_account},
       visible_columns=${visible_columns?.length ? JSON.stringify(visible_columns) : null},
       net_columns=${net_columns?.length ? JSON.stringify(net_columns) : null}
     WHERE id=${id}`;
  const [row] = await query`${PAYSLIP_SELECT} WHERE ps.id = ${id}`;
  respond.ok(res, 'Template updated', row ?? null);
});

// DELETE /calculation/payslip-templates/:id — permanently delete a payslip template.
const deletePayslipTemplate = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await exec`DELETE FROM payslip_settings WHERE id = ${id}`;
  respond.ok(res, 'Template deleted', null);
});

module.exports = {
  getPayrollColumns, createPayrollColumn, updatePayrollColumn, deletePayrollColumn, reorderPayrollColumns,
  getPayFrequencies, createPayFrequency, updatePayFrequency, deletePayFrequency,
  getPayrollEmployees, createPayrollEmployee, updatePayrollEmployee, deletePayrollEmployee,
  getCalcGroups, createCalcGroup, updateCalcGroup, deleteCalcGroup,
  getSavedCalculations, getSavedCalculationById,
  createSavedCalculation, updateSavedCalculation, deleteSavedCalculation,
  getPayslipTemplates, createPayslipTemplate, updatePayslipTemplate, deletePayslipTemplate,
};
