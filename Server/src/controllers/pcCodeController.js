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

// A PC code names a POSITION, not the person in it — so label it by the holder's job title, never
// their name (a name is confusing once they move or the seat is vacated). When the employee has no
// job title, fall back to a neutral "Position <code>" label so it still reads as a slot rather than
// a person, and never a bare, meaningless code.
//   employee: an employee row (or null) — only `jobTitleId` is needed.
//   code:     the seat's code, used to build the fallback label.
const genericPositionName = (code) => `Position ${code}`;

async function positionName(employee, code, client = prisma) {
  const jt = employee?.jobTitleId;
  if (jt != null) {
    const clv = await client.codeListValue
      .findUnique({ where: { id: Number(jt) }, select: { label: true } })
      .catch(() => null);
    if (clv?.label) return clv.label;
  }
  return genericPositionName(code);
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

/**
 * Re-seat an employee under a new supervisor after their supervisorId changes.
 *
 * The PC-code tree is a snapshot, separate from the live supervisorId, so it does NOT track
 * supervisor edits on its own. This keeps them in sync per the agreed model: the employee VACATES
 * their current seat and takes a FRESH seat created directly under the new supervisor's seat.
 * (Seats mirror the org one-per-person, so a spare vacant seat rarely exists — we always create one.)
 *
 * Rules / safety:
 *   - No-op if the employee holds no seat yet (e.g. not yet backfilled) — nothing to move.
 *   - No-op if the new supervisor has no seat of their own — there'd be nowhere valid to attach; the
 *     caller is told via the return value so it can be surfaced/logged rather than silently dropped.
 *   - The employee's OLD seat is left in the tree (now vacant) rather than deleted, preserving history
 *     and any codes that reported under it. Best-effort: never throws into the employee-update path.
 *
 * @returns {Promise<{moved:boolean, reason?:string, code?:string}>}
 */
async function reseatUnderSupervisor(employeeId, newSupervisorId, client = prisma) {
  const empId = employeeId != null ? BigInt(employeeId) : null;
  const supId = newSupervisorId != null ? BigInt(newSupervisorId) : null;
  if (empId == null) return { moved: false, reason: 'no employee' };

  // The employee must already occupy a seat — otherwise this isn't a "move", and creating one here
  // would race the inline-PC-code creation done at employee create. Leave un-backfilled staff alone.
  const ownOpen = await client.pccodeassignments.findFirst({ where: { employeeId: empId, endDate: null } });
  if (!ownOpen) return { moved: false, reason: 'employee holds no PC code' };

  // Self-supervision or cleared supervisor: nothing sensible to attach under — leave the seat as-is.
  if (supId == null || supId === empId) return { moved: false, reason: 'no new supervisor to attach under' };

  const supOpen = await client.pccodeassignments.findFirst({ where: { employeeId: supId, endDate: null } });
  if (!supOpen) return { moved: false, reason: 'new supervisor holds no PC code' };

  // Already correctly placed? (seat's parent is already the supervisor's seat) — nothing to do.
  const ownSeat = await client.pccodes.findUnique({ where: { id: ownOpen.pcCodeId }, select: { reportsToId: true } });
  if (ownSeat?.reportsToId && ownSeat.reportsToId === supOpen.pcCodeId) {
    return { moved: false, reason: 'already under this supervisor' };
  }

  const emp = await client.employee.findUnique({ where: { id: empId }, select: { jobTitleId: true } });

  // 1. Create a fresh seat directly under the supervisor's seat, named by the holder's job title.
  const { code } = await generateChildCode(supOpen.pcCodeId, client);
  const newSeat = await client.pccodes.create({
    data: { code, name: await positionName(emp, code, client), reportsToId: supOpen.pcCodeId, isActive: true },
  });

  // 2. Move the employee onto it (assignEmployeeToCode closes their old open assignment first, so the
  //    previous seat becomes vacant rather than double-held).
  await assignEmployeeToCode(newSeat.id, empId, client);

  return { moved: true, code };
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

  // ── "Ordinary root" detection ──────────────────────────────────────────────
  // A seat placed directly under the synthetic root because its holder has NO usable supervisor —
  // i.e. no supervisor at all, or a supervisor who is no longer an active/approved employee (they
  // resigned/were terminated). These aren't top-of-org by design; they're orphaned, so the UI flags
  // them for follow-up. The genuine top position (the self-supervising root occupant) is NOT flagged.
  const ordinaryRoot = await computeOrdinaryRoots(codes, holders);

  respond.ok(res, 'PC code organogram retrieved', codes.map(c => ({
    id:            c.id.toString(),
    code:          c.code,
    name:          c.name,
    reports_to_id: c.reportsToId ? c.reportsToId.toString() : null,
    current_employee_name: holders[c.id.toString()]?.name ?? null,
    current_employee_id:   holders[c.id.toString()]?.employee_id ?? null,
    rm_ro_type:            holders[c.id.toString()]?.rmRoType ?? null,
    is_ordinary_root:      ordinaryRoot.has(c.id.toString()),
  })));
});

// Returns the set of pcCode ids that are "ordinary roots" — seats whose holder has no active
// supervisor. Mirrors the backfill's isRoot rule so the chart and the backfill agree.
async function computeOrdinaryRoots(codes, holders) {
  const rootCode = codes.find(c => !c.reportsToId);
  const rootId = rootCode ? rootCode.id.toString() : null;
  if (!rootId) return new Set();

  // Only seats that hang directly off the synthetic root can be ordinary roots.
  const underRoot = codes.filter(c => c.reportsToId && c.reportsToId.toString() === rootId);
  if (!underRoot.length) return new Set();

  // Pull the open assignment holder (numeric employee id) + that employee's supervisor + status.
  const assigns = await prisma.pccodeassignments.findMany({
    where: { pcCodeId: { in: underRoot.map(c => c.id) }, endDate: null },
    select: { pcCodeId: true, employeeId: true },
  });
  const empByCode = {};
  for (const a of assigns) empByCode[a.pcCodeId.toString()] = a.employeeId;
  const holderEmployeeIds = [...new Set(Object.values(empByCode))];

  if (!holderEmployeeIds.length) return new Set();

  const emps = await prisma.employee.findMany({
    where: { id: { in: holderEmployeeIds } },
    select: { id: true, supervisorId: true },
  });
  const supByEmp = {};
  for (const e of emps) supByEmp[e.id.toString()] = e.supervisorId ? e.supervisorId.toString() : null;

  // Which supervisors are still active + approved? (A supervisor who is not is treated as absent.)
  const supIds = [...new Set(Object.values(supByEmp).filter(Boolean))];
  const activeSupSet = new Set();
  if (supIds.length) {
    const sups = await prisma.employee.findMany({
      where: { id: { in: supIds.map(s => BigInt(s)) }, lifecycleStatus: 'ACTIVE', approvalStatus: 'APPROVED' },
      select: { id: true },
    });
    for (const s of sups) activeSupSet.add(s.id.toString());
  }

  const result = new Set();
  for (const c of underRoot) {
    const empId = empByCode[c.id.toString()];
    if (empId == null) continue;                       // vacant seat — not flagged
    const supId = supByEmp[empId.toString()];
    // Ordinary root = no supervisor, or the supervisor isn't an active/approved employee. A holder
    // who reports to themselves is the intended root occupant (their seat is the ROOT code, which is
    // excluded above since it has no parent), so this naturally does not flag them.
    if (!supId || supId === empId.toString() || !activeSupSet.has(supId)) {
      result.add(c.id.toString());
    }
  }
  return result;
}

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
  reseatUnderSupervisor,
  positionName,
  genericPositionName,
  generateChildCode,
  currentHolderTag,
  openAssignmentForEmployee,
};
