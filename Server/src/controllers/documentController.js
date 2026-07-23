const path         = require('path');
const fs           = require('fs');
const respond      = require('../helpers/respondHelper');
const { tmsg }     = require('../helpers/messageStore');
const asyncHandler = require('../middleware/asyncHandler');
const { UPLOAD_DIR } = require('../middleware/upload');
const { prisma }   = require('../helpers/dbQueryHelper');
const { upsertSetting } = require('../helpers/settingsHelper');

const { toBigInt, s } = require('../helpers/controllerHelpers');

// Batch-resolve the document-type rows referenced by a set of employeedocuments (replaces the
// LEFT JOIN documents in the old raw queries). Returns Map<string(document id) → {name, details}>.
async function documentTypeMap(docs) {
  const ids = [...new Set(docs.map(d => d.document).filter(v => v != null))];
  if (!ids.length) return new Map();
  const types = await prisma.documents
    .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, details: true } })
    .catch(() => []);
  return new Map(types.map(t => [String(t.id), t]));
}

// Batch-resolve employee display names referenced by a set of employeedocuments (replaces the
// JOIN employee). Returns Map<string(employee id) → "First Last">.
async function employeeNameMap(docs) {
  const ids = [...new Set(docs.map(d => d.employee).filter(v => v != null))];
  if (!ids.length) return new Map();
  const emps = await prisma.employee
    .findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
    .catch(() => []);
  return new Map(emps.map(e => [String(e.id), `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim()]));
}

// POST /employees/documents/upload
const uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) return respond.badReq(res, 'No file provided');
  respond.ok(res, 'Document uploaded', { filename: req.file.filename });
});

// GET /documents/:filename  — served inline so images/PDFs render in the browser
const downloadDocument = asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const safe = path.basename(filename);
  const filePath = path.join(UPLOAD_DIR, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Document not found' });
  }

  const mimeMap = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png',  '.gif': 'image/gif', '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  };
  const ext         = path.extname(safe).toLowerCase();
  const contentType = mimeMap[ext] || 'application/octet-stream';

  // disposition param: inline = view in browser, attachment = force download
  const disposition = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${safe}"`);
  res.sendFile(filePath);
});

// GET /documents/my-shared
// Company documents shared with the current user (via department or employee ID)
const getMySharedDocs = asyncHandler(async (req, res) => {
  const userId = toBigInt(req.user?.id);
  if (!userId) return respond.ok(res, 'Not authenticated', []);

  // Resolve employee ID from users table
  const userRow = await prisma.users
    .findUnique({ where: { id: userId }, select: { employeeId: true } })
    .catch(() => null);

  const empId = userRow?.employeeId;
  if (!empId) return respond.ok(res, 'No employee record linked', []);

  const empIdStr = String(empId);

  // Get employee's department
  const emp = await prisma.employee
    .findUnique({ where: { id: toBigInt(empId) }, select: { departmentId: true } })
    .catch(() => null);

  const deptId = emp?.departmentId ? String(emp.departmentId) : null;

  const allDocs = await prisma.companydocuments.findMany({
    where: { status: 'Active' },
    orderBy: { id: 'desc' },
  }).catch(() => []);

  const visible = allDocs.filter(doc => {
    const depts  = (doc.share_departments || '').split(',').map(x => x.trim()).filter(Boolean);
    const emps   = (doc.share_employees   || '').split(',').map(x => x.trim()).filter(Boolean);
    const levels = (doc.share_userlevel   || '').split(',').map(x => x.trim()).filter(Boolean);

    if (!depts.length && !emps.length && !levels.length) return true; // unscoped = all
    if (levels.includes('All'))  return true;
    if (depts.includes('All'))   return true;
    if (deptId && depts.includes(deptId)) return true;
    if (emps.includes(empIdStr)) return true;
    return false;
  });

  respond.ok(res, 'Shared documents', s(visible));
});

// GET /documents/my-personal
// Employee documents uploaded for the current user
const getMyPersonalDocs = asyncHandler(async (req, res) => {
  const empId = req.user?.employeeId;
  if (!empId) return respond.ok(res, 'No employee record linked', []);

  // employeedocuments LEFT JOIN documents (for the type name/details). Exclude archived docs — the
  // old raw query compared to 'Archived', which was never a valid enum value (it stored as ''); the
  // real archived state is 'Inactive'. NULL status is still included.
  const docs = await prisma.employeedocuments.findMany({
    where: { employee: toBigInt(empId), OR: [{ status: null }, { status: { not: 'Inactive' } }] },
    orderBy: { date_added: 'desc' },
  }).catch(() => []);
  const typeMap = await documentTypeMap(docs);
  const rows = docs.map(d => ({
    ...d,
    document_type_name:    typeMap.get(String(d.document))?.name ?? null,
    document_type_details: typeMap.get(String(d.document))?.details ?? null,
  }));

  respond.ok(res, 'Personal documents', s(rows));
});

// GET /documents/settings
const getDocumentSettings = asyncHandler(async (req, res) => {
  const rows = await prisma.settings
    .findMany({ where: { category: 'document_settings' }, select: { name: true, value: true } })
    .catch(() => []);
  const map = { allow_document_download: 'No' };
  for (const r of rows) if (r.name in map) map[r.name] = r.value ?? map[r.name];
  respond.ok(res, 'Document settings', map);
});

// PUT /documents/settings
const updateDocumentSettings = asyncHandler(async (req, res) => {
  const KEYS = ['allow_document_download'];
  await prisma.$transaction(async (tx) => {
    for (const key of KEYS) {
      if (req.body[key] === undefined) continue;
      await upsertSetting(tx, key, 'document_settings', String(req.body[key]));
    }
  });
  respond.ok(res, 'Document settings saved');
});

// GET /documents/company
const getCompanyDocs = asyncHandler(async (req, res) => {
  const rows = await prisma.companydocuments
    .findMany({ where: { status: 'Active' }, orderBy: { id: 'desc' } })
    .catch(() => []);
  respond.ok(res, 'Company documents', s(rows));
});

// POST /documents/company
const createCompanyDoc = asyncHandler(async (req, res) => {
  const { name, details, share_departments, share_employees, share_userlevel, attachment, valid_until } = req.body;
  if (!name) return respond.badReq(res, 'Name is required');
  const created = await prisma.companydocuments.create({
    data: {
      name,
      details:           details || null,
      share_departments: share_departments || null,
      share_employees:   share_employees || null,
      share_userlevel:   share_userlevel || null,
      attachment:        attachment || null,
      valid_until:       valid_until ? new Date(valid_until) : null,
      status:            'Active',
    },
  });
  respond.ok(res, 'Company document created', { id: String(created.id) });
});

// PUT /documents/company/:id
const updateCompanyDoc = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid id');
  const { name, details, share_departments, share_employees, share_userlevel, attachment, valid_until } = req.body;
  await prisma.companydocuments.updateMany({
    where: { id },
    data: {
      name,
      details:           details || null,
      share_departments: share_departments || null,
      share_employees:   share_employees || null,
      share_userlevel:   share_userlevel || null,
      attachment:        attachment || null,
      valid_until:       valid_until ? new Date(valid_until) : null,
    },
  });
  respond.ok(res, 'Company document updated');
});

// DELETE /documents/company/:id  — soft-delete via status
const deleteCompanyDoc = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid id');
  // Soft-delete: 'Inactive' is the valid enum archive state (the old raw 'Archived' stored as '').
  await prisma.companydocuments.updateMany({ where: { id }, data: { status: 'Inactive' } });
  respond.ok(res, 'Company document deleted');
});

// ─── Employee document admin CRUD ─────────────────────────────────────────────

// Upsert a document type by name and return its ID
async function resolveDocTypeId(name) {
  if (!name) return null;
  const existing = await prisma.documents
    .findFirst({ where: { name }, select: { id: true } })
    .catch(() => null);
  if (existing) return existing.id;
  const created = await prisma.documents.create({ data: { name }, select: { id: true } });
  return created.id;
}

// GET /documents/employee
const getEmployeeDocs = asyncHandler(async (req, res) => {
  // employeedocuments INNER JOIN employee (name) LEFT JOIN documents (type name), status Active.
  const docs = await prisma.employeedocuments.findMany({
    where: { status: 'Active' },
    orderBy: { id: 'desc' },
    select: {
      id: true, employee: true, date_added: true, valid_until: true,
      place_of_issue: true, details: true, attachment: true, expire_notification_last: true, document: true,
    },
  }).catch(() => []);

  const empMap  = await employeeNameMap(docs);
  const typeMap = await documentTypeMap(docs);
  const rows = docs
    .filter(d => empMap.has(String(d.employee)))                 // INNER JOIN: only docs with an employee
    .map(({ document, ...d }) => ({
      ...d,
      employee_name:      empMap.get(String(d.employee)),
      document_type_name: typeMap.get(String(document))?.name ?? null,
    }));
  respond.ok(res, 'Employee documents', s(rows));
});

// POST /documents/employee
const createEmployeeDoc = asyncHandler(async (req, res) => {
  const { employee, documentType, dateOfIssue, placeOfIssue, expiryDate, details, attachment } = req.body;
  if (!employee) return respond.badReq(res, 'Employee is required');
  const docTypeId = await resolveDocTypeId(documentType);
  const created = await prisma.employeedocuments.create({
    data: {
      employee:       toBigInt(employee),
      document:       docTypeId,
      date_added:     dateOfIssue ? new Date(dateOfIssue) : new Date(),
      valid_until:    expiryDate ? new Date(expiryDate) : null,
      place_of_issue: placeOfIssue || null,
      details:        details || null,
      attachment:     attachment || null,
      status:         'Active',
    },
  });
  respond.ok(res, 'Employee document created', { id: String(created.id) });
});

// PUT /documents/employee/:id
const updateEmployeeDoc = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid id');
  const { employee, documentType, dateOfIssue, placeOfIssue, expiryDate, details, attachment } = req.body;
  const docTypeId = await resolveDocTypeId(documentType);
  await prisma.employeedocuments.updateMany({
    where: { id },
    data: {
      employee:       toBigInt(employee),
      document:       docTypeId,
      date_added:     dateOfIssue ? new Date(dateOfIssue) : undefined, // required column — leave as-is if absent
      valid_until:    expiryDate ? new Date(expiryDate) : null,
      place_of_issue: placeOfIssue || null,
      details:        details || null,
      attachment:     attachment || null,
    },
  });
  respond.ok(res, 'Employee document updated');
});

// DELETE /documents/employee/:id  — soft-delete
const deleteEmployeeDoc = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid id');
  // Soft-delete: 'Inactive' is the valid enum archive state (the old raw 'Archived' stored as '').
  await prisma.employeedocuments.updateMany({ where: { id }, data: { status: 'Inactive' } });
  respond.ok(res, 'Employee document deleted');
});

// POST /documents/employee/notify-expired
// Finds all expired employee documents not yet notified, sends emails, marks as notified
const notifyExpiredDocs = asyncHandler(async (req, res) => {
  const { sendDocumentExpiryEmail } = require('../helpers/emailHelper');
  const today = new Date().toISOString().slice(0, 10);

  // Active docs past their valid_until that haven't been notified yet (INNER JOIN employee for contact,
  // LEFT JOIN documents for the type name — both resolved via batched lookups below).
  const expired = await prisma.employeedocuments.findMany({
    where: {
      status:                   'Active',
      valid_until:              { not: null, lte: new Date(today) },
      expire_notification_last: null,
    },
    select: { id: true, valid_until: true, employee: true, document: true },
  }).catch(() => []);

  const empRows = await prisma.employee
    .findMany({ where: { id: { in: [...new Set(expired.map(d => d.employee))] } },
      select: { id: true, firstName: true, lastName: true, work_email: true } })
    .catch(() => []);
  const empMap  = new Map(empRows.map(e => [String(e.id), e]));
  const typeMap = await documentTypeMap(expired);

  let sent = 0;
  for (const doc of expired) {
    const emp = empMap.get(String(doc.employee));
    if (!emp) continue;                                         // INNER JOIN employee
    if (emp.work_email) {
      await sendDocumentExpiryEmail({
        to:           emp.work_email,
        employeeName: `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(),
        docType:      typeMap.get(String(doc.document))?.name || 'Document',
        expiryDate:   doc.valid_until,
      }).catch(() => {});
      sent++;
    }
    await prisma.employeedocuments
      .updateMany({ where: { id: doc.id }, data: { expire_notification_last: Math.floor(Date.now() / 1000) } })
      .catch(() => {});
  }

  respond.ok(res, tmsg('document.notified_expired', { sent, total: expired.length }), { notified: sent, total: expired.length });
});

module.exports = {
  uploadDocument,
  downloadDocument,
  getMySharedDocs,
  getMyPersonalDocs,
  getDocumentSettings,
  updateDocumentSettings,
  getCompanyDocs,
  createCompanyDoc,
  updateCompanyDoc,
  deleteCompanyDoc,
  getEmployeeDocs,
  createEmployeeDoc,
  updateEmployeeDoc,
  deleteEmployeeDoc,
  notifyExpiredDocs,
};
