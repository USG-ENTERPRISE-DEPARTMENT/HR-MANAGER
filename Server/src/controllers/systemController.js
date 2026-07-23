const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const { tmsg }     = require('../helpers/messageStore');

function validateListCode(code) {
    if (!code?.trim()) return 'Code is required';
    if (!/^[A-Z0-9_]{1,20}$/i.test(code.trim()))
        return 'Code must be 1–20 uppercase letters, digits, or underscores';
    return null;
}

// CodeList / CodeListValue ids are integers; route params arrive as strings. Coerce safely
// (returns null for non-numeric input so handlers can reject with a 400/404).
function toInt(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
}

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Get active values for a code list by its CODE string
             Used by select-field pickers throughout the app
   @route   GET /api/system/code-lists/by-code/:code/values
   @access  Private
───────────────────────────────────────────────────────────────────────────── */
const getActiveValuesByCode = asyncHandler(async (req, res) => {
    const code = req.params.code;
    if (!code) return respond.badReq(res, 'Code is required');

    try {
        const list = await prisma.CodeList.findFirst({
            where: { code, isActive: true },
        });
        if (!list) return respond.notFound(res, tmsg('system.codelist_not_found', { code }));

        const values = await prisma.CodeListValue.findMany({
            where:   { codeListId: list.id, isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
            select:  { id: true, label: true, code: true, description: true, sortOrder: true, isActive: true },
        });
        return respond.ok(res, tmsg('system.values_retrieved', { code }), values);
    } catch (err) {
        return respond.error(res, 'Failed to fetch values', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Get all values for a code list (active + inactive)
   @route   GET /api/system/code-lists/:id/values
   @access  Private
───────────────────────────────────────────────────────────────────────────── */
const getCodeListValues = asyncHandler(async (req, res) => {
    // Route: GET /system/code-lists/:code/values/all  (param named :code but is the code string)
    const codeStr = req.params.code;

    const list = await prisma.CodeList.findUnique({ where: { code: codeStr } });
    if (!list) return respond.notFound(res, 'Code list not found');

    try {
        const values = await prisma.CodeListValue.findMany({
            where:   { codeListId: list.id },
            orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        });
        return respond.ok(res, 'Code list values retrieved successfully', values);
    } catch (err) {
        return respond.error(res, 'Failed to fetch code list values', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Add a value to a code list
   @route   POST /api/system/code-lists/:code/values
   @access  Private (admin / super-admin)

   Body: { label, code?, description?, sortOrder?, isTeacher? }

   NOTE: isTeacher is only meaningful for values in the JOBT code list.
         When true, new employees hired with this job title will
         automatically get a teacher profile created for them.
───────────────────────────────────────────────────────────────────────────── */
const createCodeListValue = asyncHandler(async (req, res) => {
    const codeVal = req.params.code;
    const { label, code, description, sortOrder } = req.body;

    if (!label?.trim()) return respond.badReq(res, 'Label is required');

    const list = await prisma.CodeList.findUnique({ where: { code: codeVal } });
    if (!list)          return respond.notFound(res, 'Code list not found');
    if (!list.isActive) return respond.badReq(res, tmsg('system.codelist_inactive', { name: list.name }));

    // If a value code is provided, validate its format and uniqueness within the list
    const upperCode = code?.trim().toUpperCase() || null;
    if (upperCode) {
        if (!/^[A-Z0-9_]{1,20}$/.test(upperCode))
            return respond.badReq(res, 'Value code must be 1–20 uppercase letters, digits, or underscores');

        const codeClash = await prisma.CodeListValue.findFirst({
            where: { codeListId: list.id, code: upperCode },
        });
        if (codeClash) return respond.badReq(res, tmsg('system.code_exists', { code: upperCode }));
    }

    // Duplicate label check within the same list
    const labelClash = await prisma.CodeListValue.findFirst({
        where: { codeListId: list.id, label: { equals: label.trim() } },
    });
    if (labelClash) return respond.badReq(res, tmsg('system.label_exists', { label: label.trim() }));

    // Default sort order: append after the last existing value
    let resolvedSortOrder = sortOrder !== undefined ? Number(sortOrder) : null;
    if (resolvedSortOrder === null || isNaN(resolvedSortOrder)) {
        const last = await prisma.CodeListValue.findFirst({
            where:   { codeListId: list.id },
            orderBy: { sortOrder: 'desc' },
            select:  { sortOrder: true },
        });
        resolvedSortOrder = (last?.sortOrder ?? -1) + 1;
    }

    try {
        const value = await prisma.CodeListValue.create({
            data: {
                codeListId:  list.id,
                label:       label.trim(),
                code:        upperCode,
                description: description?.trim() || null,
                sortOrder:   resolvedSortOrder,
                isActive:    true,
            },
        });
        return respond.created(res, 'Value added successfully', value);
    } catch (err) {
        return respond.error(res, 'Failed to add value', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Update a code list value
   @route   PUT /api/system/code-lists/:id/values/:valueId
   @access  Private (admin / super-admin)

   Body: { label?, code?, description?, sortOrder?, isActive?, isTeacher? }

   NOTE: Toggling isTeacher does NOT retroactively create or delete teacher
         profiles for existing employees with this job title — only new hires
         are affected. Use the dedicated teacher-profile endpoints on the
         employee controller for manual adjustments.
───────────────────────────────────────────────────────────────────────────── */
const updateCodeListValue = asyncHandler(async (req, res) => {
    // Route: PUT /system/code-lists/:valueId/:id
    // :valueId = codeListId, :id = value record id
    const id = toInt(req.params.id);
    const codeListId = toInt(req.params.valueId);
    if (id === null || codeListId === null) return respond.badReq(res, 'Invalid id');
    const { label, code, description, sortOrder, isActive } = req.body;

    const value = await prisma.CodeListValue.findUnique({ where: { id } });
    if (!value)                         return respond.notFound(res, 'Value not found');
    if (value.codeListId !== codeListId) return respond.badReq(res, 'Value does not belong to this code list');

    const data = {};

    if (label !== undefined) {
        const clash = await prisma.CodeListValue.findFirst({
            where: { codeListId, label: label.trim(), id: { not: id } },
        });
        if (clash) return respond.badReq(res, tmsg('system.label_exists', { label: label.trim() }));
        data.label = label.trim();
    }

    if (code !== undefined) {
        const upperCode = code?.trim().toUpperCase() || null;
        if (upperCode) {
            if (!/^[A-Z0-9_]{1,20}$/.test(upperCode))
                return respond.badReq(res, 'Value code must be 1–20 uppercase letters, digits, or underscores');
            const clash = await prisma.CodeListValue.findFirst({
                where: { codeListId, code: upperCode, id: { not: id } },
            });
            if (clash) return respond.badReq(res, tmsg('system.code_exists', { code: upperCode }));
        }
        data.code = upperCode;
    }

    if (description !== undefined) data.description = description?.trim() || null;

    if (sortOrder !== undefined) {
        const val = Number(sortOrder);
        if (isNaN(val)) return respond.badReq(res, 'sortOrder must be a number');
        data.sortOrder = val;
    }

    if (isActive !== undefined) {
        if (typeof isActive !== 'boolean')
            return respond.badReq(res, 'isActive must be a boolean');
        data.isActive = isActive;
    }

    if (Object.keys(data).length === 0) return respond.badReq(res, 'No changes provided');

    try {
        const updated = await prisma.CodeListValue.update({ where: { id }, data });
        return respond.ok(res, 'Value updated successfully', updated);
    } catch (err) {
        return respond.error(res, 'Failed to update value', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Deactivate a code list value (soft delete — never hard delete,
             since the value may be referenced by existing records)
   @route   PUT /api/system/code-lists/:id/values/:valueId/deactivate
   @access  Private (admin / super-admin)
───────────────────────────────────────────────────────────────────────────── */
const deactivateCodeListValue = asyncHandler(async (req, res) => {
    const id = toInt(req.params.id);
    const valueId = toInt(req.params.valueId);
    if (id === null || valueId === null) return respond.badReq(res, 'Invalid id');

    const value = await prisma.CodeListValue.findUnique({ where: { id: valueId } });
    if (!value)                  return respond.notFound(res, 'Value not found');
    if (value.codeListId !== id) return respond.badReq(res, 'Value does not belong to this code list');
    if (!value.isActive)         return respond.badReq(res, tmsg('system.already_inactive', { label: value.label }));

    try {
        const updated = await prisma.CodeListValue.update({
            where: { id: valueId },
            data:  { isActive: false },
        });
        return respond.ok(res, tmsg('system.deactivated', { label: value.label }), updated);
    } catch (err) {
        return respond.error(res, 'Failed to deactivate value', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Get all code lists (active and inactive) with value counts
   @route   GET /api/system/code-lists
   @access  Private
───────────────────────────────────────────────────────────────────────────── */
const getAllCodeLists = asyncHandler(async (req, res) => {
    try {
        const lists = await prisma.CodeList.findMany({
            orderBy: { name: 'asc' },
            include: {
                _count: { select: { values: true } },
            },
        });
        return respond.ok(res, 'Code lists retrieved successfully', lists);
    } catch (err) {
        return respond.error(res, 'Failed to fetch code lists', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Get a single code list by ID (with its values)
   @route   GET /api/system/code-lists/:id
   @access  Private
───────────────────────────────────────────────────────────────────────────── */
const getCodeListById = asyncHandler(async (req, res) => {
    const id = toInt(req.params.id);
    if (id === null) return respond.notFound(res, 'Code list not found');
    try {
        const list = await prisma.CodeList.findUnique({
            where:   { id },
            include: {
                values: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
                _count:  { select: { values: true } },
            },
        });
        if (!list) return respond.notFound(res, 'Code list not found');
        return respond.ok(res, 'Code list retrieved successfully', list);
    } catch (err) {
        return respond.error(res, 'Failed to fetch code list', err);
    }
});


/* ─────────────────────────────────────────────────────────────────────────
   @desc    Create a new code list
   @route   POST /api/system/code-lists
   @access  Private (admin / super-admin)

   Body: { name, code, description? }
───────────────────────────────────────────────────────────────────────────── */
const createCodeList = asyncHandler(async (req, res) => {
    const { name, code, description } = req.body;

    if (!name?.trim()) return respond.badReq(res, 'Name is required');

    const codeErr = validateListCode(code);
    if (codeErr) return respond.badReq(res, codeErr);

    const upperCode = code.trim().toUpperCase();

    const [nameTaken, codeTaken] = await Promise.all([
        prisma.CodeList.findFirst({ where: { name: name.trim() } }),
        prisma.CodeList.findFirst({ where: { code: upperCode } }),
    ]);

    if (nameTaken) return respond.badReq(res, tmsg('system.codelist_name_exists', { name: name.trim() }));
    if (codeTaken) return respond.badReq(res, tmsg('system.code_used_by', { code: upperCode, name: codeTaken.name }));

    try {
        const list = await prisma.CodeList.create({
            data: {
                name:        name.trim(),
                code:        upperCode,
                description: description?.trim() || null,
                isActive:    true,
            },
            include: {
                _count: { select: { values: true } },
            },
        });
        return respond.created(res, 'Code list created successfully', list);
    } catch (err) {
        return respond.error(res, 'Failed to create code list', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    Update a code list's name / description
             (Code is immutable once set — values across the app reference it)
   @route   PUT /api/system/code-lists/:id
   @access  Private (admin / super-admin)

   Body: { name?, description? }
───────────────────────────────────────────────────────────────────────────── */
const updateCodeList = asyncHandler(async (req, res) => {
    const id = toInt(req.params.id);
    if (id === null) return respond.notFound(res, 'Code list not found');
    const { name, description } = req.body;

    const list = await prisma.CodeList.findUnique({ where: { id } });
    if (!list) return respond.notFound(res, 'Code list not found');

    const data = {};

    if (name !== undefined) {
        if (!name.trim()) return respond.badReq(res, 'Name cannot be empty');
        const clash = await prisma.CodeList.findFirst({
            where: { name: name.trim(), id: { not: id } },
        });
        if (clash) return respond.badReq(res, tmsg('system.codelist_name_exists', { name: name.trim() }));
        data.name = name.trim();
    }

    if (description !== undefined) {
        data.description = description?.trim() || null;
    }

    if (Object.keys(data).length === 0) return respond.badReq(res, 'No changes provided');

    try {
        const updated = await prisma.CodeList.update({
            where:   { id },
            data,
            include: { _count: { select: { values: true } } },
        });
        return respond.ok(res, 'Code list updated successfully', updated);
    } catch (err) {
        return respond.error(res, 'Failed to update code list', err);
    }
});

/* ─────────────────────────────────────────────────────────────────────────
   @desc    activate a code list value (soft delete — never hard delete,
             since the value may be referenced by existing records)
   @route   PUT /api/system/code-lists/:id/values/:valueId/activate
   @access  Private (admin / super-admin)
───────────────────────────────────────────────────────────────────────────── */
const activateCodeListValue = asyncHandler(async (req, res) => {
    const id = toInt(req.params.id);
    const valueId = toInt(req.params.valueId);
    if (id === null || valueId === null) return respond.badReq(res, 'Invalid id');

    const value = await prisma.CodeListValue.findUnique({ where: { id: valueId } });
    if (!value)                  return respond.notFound(res, 'Value not found');
    if (value.codeListId !== id) return respond.badReq(res, 'Value does not belong to this code list');
    if (value.isActive)         return respond.badReq(res, tmsg('system.already_active', { label: value.label }));

    try {
        const updated = await prisma.CodeListValue.update({
            where: { id: valueId },
            data:  { isActive: true },
        });
        return respond.ok(res, tmsg('system.activated', { label: value.label }), updated);
    } catch (err) {
        return respond.error(res, 'Failed to activate value', err);
    }
});


module.exports = {
    getCodeListValues,
    getActiveValuesByCode,
    createCodeListValue,
    updateCodeListValue,
    deactivateCodeListValue,
    getAllCodeLists,
    getCodeListById,
    createCodeList,
    updateCodeList,
    activateCodeListValue
}