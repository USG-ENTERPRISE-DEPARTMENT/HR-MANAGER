const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { tmsg } = require('../helpers/messageStore');
const { logActivity, fromReq } = require('./auditController');

const { serialize } = require('../helpers/controllerHelpers');

// Prisma enum value → display label
const TYPE_LABEL = {
  Head_Office: 'Head Office',
  Branch:      'Branch',
  Department:  'Department',
  Unit:        'Unit',
  Outlet:      'Outlet',
  Other:       'Other',
};

// Display label (from COMPS code list) → Prisma enum value
const LABEL_TO_ENUM = Object.fromEntries(
  Object.entries(TYPE_LABEL).map(([k, v]) => [v, k])
);

// Traverse parent chain to detect circular references
async function wouldCreateCycle(structureId, newParentId) {
  let current = newParentId;
  const visited = new Set();
  while (current) {
    const key = current.toString();
    if (current === structureId) return true;
    if (visited.has(key)) break;
    visited.add(key);
    const row = await prisma.companystructures.findUnique({
      where: { id: current },
      select: { parent2: true },
    });
    if (!row) break;
    current = row.parent2;
  }
  return false;
}

// GET /company/structures
const getAllCompanyStructures = asyncHandler(async (req, res) => {
  const structures = await prisma.companystructures.findMany({
    orderBy: { id: 'asc' },
  });

  const idToTitle = {};
  for (const s of structures) idToTitle[s.id.toString()] = s.title;

  // `heads` stores the head/manager's employee id — resolve it to a display name.
  const headIds = [...new Set(
    structures.map(s => s.heads).filter(h => h && /^\d+$/.test(h)).map(h => BigInt(h))
  )];
  const headNameById = {};
  if (headIds.length > 0) {
    const emps = await prisma.employee.findMany({
      where: { id: { in: headIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    emps.forEach(e => { headNameById[e.id.toString()] = `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim(); });
  }

  const data = structures.map(s => ({
    ...serialize(s),
    typeLabel:    s.type    ? (TYPE_LABEL[s.type] ?? s.type)              : null,
    parentTitle:  s.parent2 ? (idToTitle[s.parent2.toString()] ?? null)  : null,
    // Resolved manager/head name (falls back to the raw value if it isn't a known employee id).
    managerName:  s.heads ? (headNameById[s.heads] ?? (/^\d+$/.test(s.heads) ? null : s.heads)) : null,
  }));

  respond.ok(res, 'Company structures fetched', data);
});

// GET /company/structures/types  — read COMPS code list
const getStructureTypes = asyncHandler(async (req, res) => {
  const list = await prisma.codeList.findFirst({
    where: { code: 'COMPS' },
    include: {
      values: {
        where:   { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  respond.ok(res, 'Structure types fetched', list ? list.values : []);
});

// GET /company/structures/:id
const getCompanyStructureById = asyncHandler(async (req, res) => {
  const id = BigInt(req.params.id);
  const structure = await prisma.companystructures.findUnique({ where: { id } });
  if (!structure) return respond.notFound(res, 'Structure not found');

  const parentRow = structure.parent2
    ? await prisma.companystructures.findUnique({ where: { id: structure.parent2 }, select: { title: true } })
    : null;

  respond.ok(res, 'Structure fetched', {
    ...serialize(structure),
    typeLabel:   structure.type ? (TYPE_LABEL[structure.type] ?? structure.type) : null,
    parentTitle: parentRow?.title ?? null,
  });
});

// POST /company/structures
const createCompanyStructure = asyncHandler(async (req, res) => {
  const { title, comp_code, description, address, type, parent2, heads } = req.body;

  if (!title?.trim()) return respond.badReq(res, 'Title is required');

  if (comp_code?.trim()) {
    const conflict = await prisma.companystructures.findUnique({ where: { comp_code: comp_code.trim() } });
    if (conflict) return respond.conflict(res, tmsg('company.code_in_use', { code: comp_code.trim() }));
  }

  const parentId = parent2 ? BigInt(parent2) : null;
  if (parentId) {
    const parentExists = await prisma.companystructures.findUnique({ where: { id: parentId } });
    if (!parentExists) return respond.badReq(res, 'Parent structure not found');
  }

  const enumType = type ? (LABEL_TO_ENUM[type] ?? type) : null;

  const structure = await prisma.companystructures.create({
    data: {
      title:       title.trim(),
      comp_code:   comp_code?.trim()   || null,
      description: description?.trim() || '',
      address:     address?.trim()     || null,
      type:        enumType || undefined,
      parent2:     parentId,
      heads:       heads?.trim()     || null,
    },
  });

  logActivity({ module: 'Company', action: 'create', entityId: String(structure.id), entityName: structure.title, ...fromReq(req) });
  respond.created(res, 'Structure created', serialize(structure));
});

// PUT /company/structures/:id
const updateCompanyStructure = asyncHandler(async (req, res) => {
  const id = BigInt(req.params.id);
  const { title, comp_code, description, address, type, parent2, heads } = req.body;

  const existing = await prisma.companystructures.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'Structure not found');

  if (comp_code?.trim() && comp_code.trim() !== existing.comp_code) {
    const conflict = await prisma.companystructures.findUnique({ where: { comp_code: comp_code.trim() } });
    if (conflict) return respond.conflict(res, tmsg('company.code_in_use', { code: comp_code.trim() }));
  }

  const parentId = parent2 ? BigInt(parent2) : null;
  if (parentId) {
    if (parentId === id) return respond.badReq(res, 'A structure cannot be its own parent');
    const parentExists = await prisma.companystructures.findUnique({ where: { id: parentId } });
    if (!parentExists) return respond.badReq(res, 'Parent structure not found');
    if (await wouldCreateCycle(id, parentId))
      return respond.badReq(res, 'This parent assignment would create a circular reference');
  }

  const enumType = type !== undefined ? (type ? (LABEL_TO_ENUM[type] ?? type) : null) : undefined;

  const updated = await prisma.companystructures.update({
    where: { id },
    data: {
      ...(title       !== undefined && { title:       title.trim() }),
      ...(comp_code   !== undefined && { comp_code:   comp_code?.trim()   || null }),
      ...(description !== undefined && { description: description?.trim() || '' }),
      ...(address     !== undefined && { address:     address?.trim()     || null }),
      ...(type        !== undefined && { type:        enumType }),
      ...(parent2     !== undefined && { parent2:     parentId }),
      ...(heads       !== undefined && { heads:       heads?.trim()       || null }),
    },
  });

  logActivity({ module: 'Company', action: 'update', entityId: String(id), entityName: existing.title, ...fromReq(req) });
  respond.ok(res, 'Structure updated', serialize(updated));
});

// DELETE /company/structures/:id
const deleteCompanyStructure = asyncHandler(async (req, res) => {
  const id = BigInt(req.params.id);

  const existing = await prisma.companystructures.findUnique({ where: { id } });
  if (!existing) return respond.notFound(res, 'Structure not found');

  const childCount = await prisma.companystructures.count({ where: { parent2: id } });
  if (childCount > 0)
    return respond.badReq(res, tmsg('company.structure_has_children', { count: childCount }));

  await prisma.companystructures.delete({ where: { id } });
  logActivity({ module: 'Company', action: 'delete', entityId: String(id), entityName: existing.title, ...fromReq(req) });
  respond.ok(res, 'Structure deleted', null);
});

module.exports = {
  getAllCompanyStructures,
  getStructureTypes,
  getCompanyStructureById,
  createCompanyStructure,
  updateCompanyStructure,
  deleteCompanyStructure,
};
