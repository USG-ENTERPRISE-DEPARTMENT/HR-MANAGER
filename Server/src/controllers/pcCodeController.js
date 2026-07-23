const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { serialize, toBigInt } = require('../helpers/controllerHelpers');
const { logActivity, fromReq } = require('./auditController');
const { nextChildCode, isReportsToAllowed, ROOT_CODE } = require('../helpers/pcCodeHelper');

// ── Shared internals (reused by createEmployee) ─────────────────────────────

// The open (current) assignment for a code, or null.
async function openAssignmentForCode(pcCodeId, client = prisma) {
  return client.pccodeassignments.findFirst({
    where: { pcCodeId, endDate: null },
  });
}

// The open (current) assignment for an employee, or null.
async function openAssignmentForEmployee(employeeId, client = prisma) {
  return client.pccodeassignments.findFirst({
    where: { employeeId, endDate: null },
  });
}

// RM/RO tag of the current holder of a code (null if vacant or code missing).
async function currentHolderTag(pcCodeId, client = prisma) {
  const open = await openAssignmentForCode(pcCodeId, client);
  if (!open) return null;
  const emp = await client.employee.findUnique({
    where: { id: open.employeeId }, select: { rmRoType: true },
  });
  return emp?.rmRoType ?? null;
}

// Generate the next code for a new child under `parentId` (root if null).
async function generateChildCode(parentId, client = prisma) {
  const parent = parentId
    ? await client.pccodes.findUnique({ where: { id: parentId } })
    : await client.pccodes.findFirst({ where: { code: ROOT_CODE } });
  if (!parent) throw new Error('Parent PC code not found');

  const siblings = await client.pccodes.findMany({
    where: { reportsToId: parent.id }, select: { code: true },
  });
  return { parent, code: nextChildCode(parent.code, siblings.map(s => s.code)) };
}

/**
 * Move/assign an employee to a code. Enforces one-holder-per-code and one-code-per-staff.
 * Returns the new assignment. Throws Error (message) on rule violation.
 * Pass a transaction client for atomic create flows.
 */
async function assignEmployeeToCode(pcCodeId, employeeId, client = prisma) {
  const codeOpen = await openAssignmentForCode(pcCodeId, client);
  if (codeOpen && codeOpen.employeeId !== employeeId) {
    throw new Error('This PC code is already held by another employee');
  }
  if (codeOpen && codeOpen.employeeId === employeeId) {
    return codeOpen; // already the holder — no-op
  }

  // Close any existing open assignment for this employee (they hold one code at a time).
  await client.pccodeassignments.updateMany({
    where: { employeeId, endDate: null },
    data:  { endDate: new Date() },
  });

  return client.pccodeassignments.create({
    data: { pcCodeId, employeeId, startDate: new Date(), endDate: null },
  });
}

/**
 * Close any open PC-code assignment(s) for an employee — i.e. vacate the seat(s) they hold.
 * Used when an employee is terminated/resigned so they no longer occupy a position.
 * Returns the number of assignments closed.
 */
async function vacateEmployeeAssignments(employeeId, client = prisma) {
  const res = await client.pccodeassignments.updateMany({
    where: { employeeId, endDate: null },
    data:  { endDate: new Date() },
  });
  return res.count;
}

// ── Enrichment for list/organogram ──────────────────────────────────────────

// Map<pcCodeId(string) -> { name, employee_id, rmRoType }> of current holders.
async function holderMap(pcCodeIds) {
  if (pcCodeIds.length === 0) return {};
  const open = await prisma.pccodeassignments.findMany({
    where: { pcCodeId: { in: pcCodeIds }, endDate: null },
  });
  const empIds = [...new Set(open.map(a => a.employeeId))];
  const emps = empIds.length
    ? await prisma.employee.findMany({
        where: { id: { in: empIds } },
        select: { id: true, firstName: true, lastName: true, employee_id: true, rmRoType: true },
      })
    : [];
  const empById = {};
  emps.forEach(e => { empById[e.id.toString()] = e; });

  const map = {};
  for (const a of open) {
    const e = empById[a.employeeId.toString()];
    if (e) map[a.pcCodeId.toString()] = {
      name: `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(),
      employee_id: e.employee_id,
      rmRoType: e.rmRoType ?? null,
    };
  }
  return map;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

// GET /pc-codes  (optional ?vacant=1 to only list codes with no current holder)
const getAllPcCodes = asyncHandler(async (req, res) => {
  const codes = await prisma.pccodes.findMany({ orderBy: { code: 'asc' } });

  const nameById = {};
  codes.forEach(c => { nameById[c.id.toString()] = `${c.code} — ${c.name}`; });
  const holders = await holderMap(codes.map(c => c.id));

  let data = codes.map(c => ({
    ...serialize(c),
    reportsToName: c.reportsToId ? (nameById[c.reportsToId.toString()] ?? null) : null,
    currentEmployee: holders[c.id.toString()]?.name ?? null,
    currentEmployeeId: holders[c.id.toString()]?.employee_id ?? null,
  }));

  if (req.query.vacant === '1') {
    // Only active, unheld, non-root positions can be assigned to.
    data = data.filter(c => !c.currentEmployee && c.code !== ROOT_CODE && c.isActive !== false);
  }

  respond.ok(res, 'PC codes fetched', data);
});

// GET /pc-codes/organogram  (flat list; client builds the tree)
const getPcCodeOrganogram = asyncHandler(async (req, res) => {
  const codes = await prisma.pccodes.findMany({ orderBy: { code: 'asc' } });
  const holders = await holderMap(codes.map(c => c.id));

  respond.ok(res, 'PC code organogram retrieved', codes.map(c => ({
    id:            c.id.toString(),
    code:          c.code,
    name:          c.name,
    reports_to_id: c.reportsToId ? c.reportsToId.toString() : null,
    current_employee_name: holders[c.id.toString()]?.name ?? null,
    current_employee_id:   holders[c.id.toString()]?.employee_id ?? null,
    rm_ro_type:            holders[c.id.toString()]?.rmRoType ?? null,
  })));
});

// GET /pc-codes/:id
const getPcCodeById = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid PC code ID');
  const code = await prisma.pccodes.findUnique({ where: { id } });
  if (!code) return respond.notFound(res, 'PC code not found');

  const parent = code.reportsToId
    ? await prisma.pccodes.findUnique({ where: { id: code.reportsToId }, select: { code: true, name: true } })
    : null;
  const holders = await holderMap([code.id]);

  respond.ok(res, 'PC code fetched', {
    ...serialize(code),
    reportsToName: parent ? `${parent.code} — ${parent.name}` : null,
    currentEmployee: holders[code.id.toString()]?.name ?? null,
  });
});

// POST /pc-codes  { name, reportsToId? }  — code auto-generated
const createPcCode = asyncHandler(async (req, res) => {
  const { name, reportsToId } = req.body;
  if (!name?.trim()) return respond.badReq(res, 'Name is required');

  const parentId = reportsToId ? toBigInt(reportsToId) : null;
  if (reportsToId && !parentId) return respond.badReq(res, 'Invalid parent PC code');

  // RM/RO rule: the parent's current holder must be an RM (unless parenting under the root).
  if (parentId) {
    const parent = await prisma.pccodes.findUnique({ where: { id: parentId } });
    if (!parent) return respond.badReq(res, 'Parent PC code not found');
    if (parent.isActive === false) return respond.badReq(res, 'Cannot report to a deactivated position');
    if (parent.code !== ROOT_CODE) {
      const parentTag = await currentHolderTag(parentId);
      if (parentTag !== 'RM') {
        return respond.badReq(res, 'A position can only report to an RM-held position');
      }
    }
  }

  let code, parentRow;
  try {
    ({ code, parent: parentRow } = await generateChildCode(parentId));
  } catch (e) {
    return respond.badReq(res, e.message);
  }

  // A top-level code reports to the ROOT NODE (not null). Only the root itself has a null parent,
  // so the "one null-parent" invariant holds and the code generator counts siblings correctly.
  const created = await prisma.pccodes.create({
    data: { code, name: name.trim(), reportsToId: parentRow.id, isActive: true },
  });

  logActivity({ module: 'PcCode', action: 'create', entityId: String(created.id), entityName: `${code} — ${name.trim()}`, ...fromReq(req) });
  respond.created(res, 'PC code created', serialize(created));
});

// PUT /pc-codes/:id  { name? }  — rename only in v1 (reparenting deferred; see plan)
const updatePcCode = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid PC code ID');
  const { name } = req.body;

  const existing = await prisma.pccodes.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'PC code not found');

  const updated = await prisma.pccodes.update({
    where: { id },
    data:  { ...(name !== undefined && { name: name.trim() }) },
  });

  logActivity({ module: 'PcCode', action: 'update', entityId: String(id), entityName: existing.code, ...fromReq(req) });
  respond.ok(res, 'PC code updated', serialize(updated));
});

// Walk the reportsTo chain up from newParentId; true if it reaches `id` (would form a loop).
async function wouldCreateCycle(id, newParentId) {
  let current = newParentId;
  const visited = new Set();
  while (current) {
    const key = current.toString();
    if (current === id) return true;
    if (visited.has(key)) break;
    visited.add(key);
    const row = await prisma.pccodes.findUnique({ where: { id: current }, select: { reportsToId: true } });
    if (!row) break;
    current = row.reportsToId;
  }
  return false;
}

// PUT /pc-codes/:id/reparent  { reportsToId }  — change who a position reports to.
// reportsToId = null (or the root's id) makes it a top-level position (reports to the root).
// The code itself is kept stable; only the reporting line changes. RM/RO rule enforced.
const reparentPcCode = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid PC code ID');

  const existing = await prisma.pccodes.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'PC code not found');
  if (existing.code === ROOT_CODE) return respond.badReq(res, 'The root position cannot be moved');

  const root = await prisma.pccodes.findFirst({ where: { reportsToId: null } });

  // Empty / root selection => top-level (reports to the root node).
  let parentId = req.body.reportsToId ? toBigInt(req.body.reportsToId) : null;
  if (parentId && root && parentId === root.id) parentId = null; // normalise "under root" to top-level
  const effectiveParentId = parentId ?? (root ? root.id : null);

  if (parentId) {
    if (parentId === id) return respond.badReq(res, 'A position cannot report to itself');
    const parent = await prisma.pccodes.findUnique({ where: { id: parentId } });
    if (!parent) return respond.badReq(res, 'Parent position not found');
    if (parent.isActive === false) return respond.badReq(res, 'Cannot report to a deactivated position');
    if (await wouldCreateCycle(id, parentId))
      return respond.badReq(res, 'That move would create a circular reporting line');
    // RM/RO rule: a real (non-root) parent's current holder must be an RM.
    const parentTag = await currentHolderTag(parentId);
    if (parentTag !== 'RM') return respond.badReq(res, 'A position can only report to an RM-held position');
  }

  const updated = await prisma.pccodes.update({ where: { id }, data: { reportsToId: effectiveParentId } });
  logActivity({ module: 'PcCode', action: 'reparent', entityId: String(id), entityName: existing.code, ...fromReq(req) });
  respond.ok(res, parentId ? 'Reporting line updated' : 'Position moved to top level', serialize(updated));
});

// PUT /pc-codes/:id/active  { isActive }  — deactivate/reactivate a position.
// PC codes are never hard-deleted (they anchor the hierarchy and history); they are deactivated
// instead. A held position must be vacated before it can be deactivated; the root can't be
// deactivated.
const setPcCodeActive = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid PC code ID');

  const existing = await prisma.pccodes.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'PC code not found');

  const isActive = req.body.isActive === true || req.body.isActive === 'true';

  if (!isActive) {
    // Deactivating — apply the same safeguards the old delete had.
    if (existing.code === ROOT_CODE) return respond.badReq(res, 'The root position cannot be deactivated');

    const activeChildren = await prisma.pccodes.count({ where: { reportsToId: id, isActive: true } });
    if (activeChildren > 0) return respond.badReq(res, `This position has ${activeChildren} active sub-position(s) reporting to it`);

    const open = await openAssignmentForCode(id);
    if (open) return respond.badReq(res, 'This position is currently held — vacate it before deactivating');
  }

  const updated = await prisma.pccodes.update({ where: { id }, data: { isActive } });
  logActivity({ module: 'PcCode', action: isActive ? 'reactivate' : 'deactivate', entityId: String(id), entityName: existing.code, ...fromReq(req) });
  respond.ok(res, isActive ? 'PC code reactivated' : 'PC code deactivated', serialize(updated));
});

// POST /pc-codes/:id/assign  { employeeId }
const assignEmployee = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid PC code ID');
  const employeeId = toBigInt(req.body.employeeId);
  if (!employeeId) return respond.badReq(res, 'employeeId is required');

  const code = await prisma.pccodes.findUnique({ where: { id } });
  if (!code) return respond.notFound(res, 'PC code not found');
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!emp) return respond.notFound(res, 'Employee not found');

  try {
    const assignment = await assignEmployeeToCode(id, employeeId);
    logActivity({ module: 'PcCode', action: 'assign', entityId: String(id), entityName: code.code, ...fromReq(req) });
    respond.ok(res, 'Employee assigned to PC code', serialize(assignment));
  } catch (e) {
    respond.badReq(res, e.message);
  }
});

// POST /pc-codes/:id/vacate  — close the current open assignment
const vacatePcCode = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid PC code ID');

  const open = await openAssignmentForCode(id);
  if (!open) return respond.badReq(res, 'This PC code has no current holder');

  await prisma.pccodeassignments.update({ where: { id: open.id }, data: { endDate: new Date() } });
  logActivity({ module: 'PcCode', action: 'vacate', entityId: String(id), ...fromReq(req) });
  respond.ok(res, 'PC code vacated', null);
});

module.exports = {
  getAllPcCodes,
  getPcCodeOrganogram,
  getPcCodeById,
  createPcCode,
  updatePcCode,
  reparentPcCode,
  setPcCodeActive,
  assignEmployee,
  vacatePcCode,
  // reusable internals for createEmployee / lifecycle hooks
  assignEmployeeToCode,
  vacateEmployeeAssignments,
  generateChildCode,
  currentHolderTag,
  openAssignmentForEmployee,
};
