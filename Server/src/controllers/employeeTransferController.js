const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { s, toBigInt } = require('../helpers/controllerHelpers');
const { upsertSetting } = require('../helpers/settingsHelper');
const { notifyEmployee, notifyUser, notifyUsersWithPermission, notifyUsersWithRole } = require('../helpers/notificationHelper');
const { logActivity, fromReq } = require('./auditController');
const { reassignPendingSupervisorWork } = require('../helpers/supervisorHelper');
const { FIELD_BY_KEY, effectiveTransferFields } = require('../config/employeeFormFields');
const { syncEmployeeToExternalSystem } = require('./employeeController');

const FLOW_KEY = 'employee_transfer_approval_flow';
const EMPLOYEE_FLOW_KEY = 'employee_approval_flow';
const USE_EMPLOYEE_FLOW_KEY = 'employee_transfer_use_employee_approval_flow';
const ACTIVE_STATUSES = ['Draft', 'Pending Approval', 'Scheduled'];
const TRANSFER_FIELDS = [
  ['department', 'departmentId', 'current_department', 'proposed_department'],
  ['branch', 'branchId', 'current_branch', 'proposed_branch'],
  ['unit', 'unitId', 'current_unit', 'proposed_unit'],
  ['outlet', 'outletId', 'current_outlet', 'proposed_outlet'],
  ['jobTitle', 'jobTitleId', 'current_job_title', 'proposed_job_title'],
  ['supervisor', 'supervisorId', 'current_supervisor', 'proposed_supervisor'],
  ['paygrade', 'paygradeId', 'current_paygrade', 'proposed_paygrade'],
  ['notch', 'notcheId', 'current_notch', 'proposed_notch'],
];
const DEDICATED_BY_EMPLOYEE_FIELD = Object.fromEntries(TRANSFER_FIELDS.map((entry) => [entry[1], entry]));
const STRUCTURE_FIELDS = new Set(['departmentId', 'branchId', 'unitId', 'outletId']);
const CODE_VALUE_FIELDS = new Set(['titleId', 'genderId', 'nationalityId', 'religionId', 'employmentStatusId', 'jobTitleId', 'staff_level', 'staff_role', 'country']);
const BIGINT_FIELDS = new Set(['departmentId', 'branchId', 'unitId', 'outletId', 'supervisorId', 'paygradeId', 'notcheId']);
const DATE_FIELDS = new Set(['dateOfBirth', 'hireDate', 'confirmationDate', 'nationalIdExpiry', 'passportExpiry', 'driverLicenseExp']);

const hasPermission = (req, name) => (req.user?.permissions || []).includes(name);
const same = (a, b) => String(a ?? '') === String(b ?? '');
const asDate = value => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const todayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};
const nullableBigInt = value => value === '' || value == null ? null : toBigInt(value);
const nullableString = value => value === '' || value == null ? null : String(value);
const transferNumber = () => `TRF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
const employeeName = emp => `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() || emp?.employee_id || 'Employee';
const parseValues = value => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
};
const snapshotValue = value => {
  if (value == null || value === '') return null;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
};

async function readTransferFields() {
  const row = await prisma.settings.findFirst({
    where: { name: 'employee_transfer_fields', category: 'app_controls' }, select: { value: true },
  }).catch(() => null);
  let config = {};
  try { config = row?.value ? JSON.parse(row.value) : {}; } catch { config = {}; }
  return effectiveTransferFields(config);
}

async function readStoredFlow(key = FLOW_KEY) {
  const row = await prisma.settings.findFirst({
    where: { name: key, category: 'app_controls' },
    select: { value: true },
  }).catch(() => null);
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(stage => stage && String(stage.name || '').trim()
      && ['role', 'user'].includes(stage.approverType)
      && String(stage.approverId ?? '').trim()).map(stage => ({
        name: String(stage.name).trim(),
        approverType: stage.approverType,
        approverId: String(stage.approverId),
        approverLabel: stage.approverLabel == null ? null : String(stage.approverLabel),
      }));
  } catch { return []; }
}

async function usesEmployeeApprovalFlow() {
  const row = await prisma.settings.findFirst({
    where: { name: USE_EMPLOYEE_FLOW_KEY, category: 'app_controls' }, select: { value: true },
  }).catch(() => null);
  return row?.value === '1' || row?.value === 'true';
}

async function readFlow() {
  return readStoredFlow(await usesEmployeeApprovalFlow() ? EMPLOYEE_FLOW_KEY : FLOW_KEY);
}

function actorMatchesStage(req, stage) {
  const type = stage.approver_type ?? stage.approverType;
  const id = String(stage.approver_id ?? stage.approverId ?? '');
  const label = String(stage.approver_label ?? stage.approverLabel ?? '');
  if (type === 'user') return String(req.user?.id ?? '') === id;
  const roles = (req.user?.roles || []).map(String);
  return type === 'role' && (roles.includes(id) || (label && roles.includes(label)));
}

function notifyStage(stage, req, transfer) {
  const payload = {
    message: `Employee transfer ${transfer.transfer_number} awaits your approval (${stage.stage_name ?? stage.name})`,
    action: 'CentralApproval', type: 'employee_transfer', fromUser: req?.user?.id, employee: transfer.employee,
  };
  const type = stage.approver_type ?? stage.approverType;
  const id = stage.approver_id ?? stage.approverId;
  if (type === 'user') notifyUser(id, payload);
  else notifyUsersWithRole(id, payload, req?.user?.id, stage.approver_label ?? stage.approverLabel);
}

async function snapshotStages(tx, transferId, flow) {
  await tx.employeetransferstages.deleteMany({ where: { transfer_id: transferId } });
  if (!flow.length) return [];
  await tx.employeetransferstages.createMany({ data: flow.map((stage, index) => ({
    transfer_id: transferId,
    stage_order: index,
    stage_name: stage.name,
    approver_type: stage.approverType,
    approver_id: stage.approverId,
    approver_label: stage.approverLabel,
    status: 'Pending',
  })) });
  return flow;
}

async function loadTransfer(id) {
  return prisma.employeetransfers.findUnique({ where: { id } });
}

function valuesForRow(row, kind) {
  const parsed = parseValues(row[`${kind}_values`]);
  if (Object.keys(parsed).length) return parsed;
  return Object.fromEntries(TRANSFER_FIELDS.map(([, employeeField, currentField, proposedField]) => [
    employeeField, snapshotValue(row[kind === 'current' ? currentField : proposedField]),
  ]));
}

async function getNameMaps(rows) {
  const structureIds = [];
  const employeeIds = [];
  const codeValueIds = [];
  const paygradeIds = [];
  const notchIds = [];
  for (const row of rows) {
    employeeIds.push(row.employee);
    for (const values of [valuesForRow(row, 'current'), valuesForRow(row, 'proposed')]) {
      for (const [key, value] of Object.entries(values)) {
        if (value == null || value === '') continue;
        if (STRUCTURE_FIELDS.has(key)) structureIds.push(value);
        else if (key === 'supervisorId') employeeIds.push(value);
        else if (key === 'paygradeId') paygradeIds.push(value);
        else if (key === 'notcheId') notchIds.push(value);
        else if (CODE_VALUE_FIELDS.has(key)) codeValueIds.push(value);
      }
    }
  }
  const bigIds = values => [...new Set(values.filter(v => v != null && /^\d+$/.test(String(v))).map(v => String(v)))].map(BigInt);
  // CodeListValue ids are integers now — coerce for the `in` query.
  const intIds = values => [...new Set(values.filter(v => v != null && /^\d+$/.test(String(v))).map(v => Number(v)))];
  const [structures, employees, codeValues, paygrades, notches] = await Promise.all([
    bigIds(structureIds).length ? prisma.companystructures.findMany({ where: { id: { in: bigIds(structureIds) } }, select: { id: true, title: true, type: true } }) : [],
    bigIds(employeeIds).length ? prisma.employee.findMany({ where: { id: { in: bigIds(employeeIds) } }, select: { id: true, firstName: true, lastName: true, employee_id: true } }) : [],
    intIds(codeValueIds).length ? prisma.codeListValue.findMany({ where: { id: { in: intIds(codeValueIds) } }, select: { id: true, label: true } }).catch(() => []) : [],
    bigIds(paygradeIds).length ? prisma.paygrades.findMany({ where: { id: { in: bigIds(paygradeIds) } }, select: { id: true, name: true } }) : [],
    bigIds(notchIds).length ? prisma.notches.findMany({ where: { id: { in: bigIds(notchIds) } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    structures: new Map(structures.map(v => [String(v.id), v.title || v.type || `Structure ${v.id}`])),
    employees: new Map(employees.map(v => [String(v.id), employeeName(v)])),
    employeeCodes: new Map(employees.map(v => [String(v.id), v.employee_id || null])),
    codeValues: new Map(codeValues.map(v => [String(v.id), v.label || String(v.id)])),
    paygrades: new Map(paygrades.map(v => [String(v.id), v.name || `Pay grade ${v.id}`])),
    notches: new Map(notches.map(v => [String(v.id), v.name || `Notch ${v.id}`])),
  };
}

function decorate(row, maps, stages = []) {
  const currentValues = valuesForRow(row, 'current');
  const proposedValues = valuesForRow(row, 'proposed');
  const displayValue = (key, value) => {
    if (value == null || value === '') return 'Not assigned';
    const id = String(value);
    if (STRUCTURE_FIELDS.has(key)) return maps.structures.get(id) || id;
    if (key === 'supervisorId') return maps.employees.get(id) || id;
    if (key === 'paygradeId') return maps.paygrades.get(id) || id;
    if (key === 'notcheId') return maps.notches.get(id) || id;
    if (CODE_VALUE_FIELDS.has(key)) return maps.codeValues.get(id) || id;
    if (DATE_FIELDS.has(key)) return id.slice(0, 10);
    return id;
  };
  const keys = [...new Set([...Object.keys(currentValues), ...Object.keys(proposedValues)])];
  const changes = keys.map((key) => {
    const currentId = snapshotValue(currentValues[key]);
    const proposedId = snapshotValue(proposedValues[key]);
    return {
      field: key,
      label: FIELD_BY_KEY[key]?.label || key,
      currentId: currentId == null ? null : String(currentId),
      proposedId: proposedId == null ? null : String(proposedId),
      current: displayValue(key, currentId),
      proposed: displayValue(key, proposedId),
    };
  }).filter(change => !same(change.currentId, change.proposedId));
  return s({
    ...row,
    employee_name: maps.employees.get(String(row.employee)) || `Employee ${row.employee}`,
    employee_code: maps.employeeCodes.get(String(row.employee)) || null,
    changes,
    stages,
  });
}

async function decorateMany(rows, includeStages = false) {
  const maps = await getNameMaps(rows);
  let stagesByTransfer = new Map();
  if (includeStages && rows.length) {
    const stages = await prisma.employeetransferstages.findMany({
      where: { transfer_id: { in: rows.map(row => row.id) } }, orderBy: [{ transfer_id: 'asc' }, { stage_order: 'asc' }],
    });
    stagesByTransfer = stages.reduce((map, stage) => {
      const key = String(stage.transfer_id);
      map.set(key, [...(map.get(key) || []), s(stage)]);
      return map;
    }, new Map());
  }
  return rows.map(row => decorate(row, maps, stagesByTransfer.get(String(row.id)) || []));
}

function transferInput(body) {
  const input = { ...parseValues(body.proposed_values) };
  for (const [, employeeField, , proposedField] of TRANSFER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, proposedField)) input[employeeField] = body[proposedField];
  }
  return input;
}

function draftData(body, employee, existing = null, configuredFields = []) {
  const existingCurrent = existing ? valuesForRow(existing, 'current') : null;
  const fieldKeys = existing ? Object.keys(existingCurrent) : configuredFields.map((field) => field.key);
  const currentValues = existingCurrent || Object.fromEntries(fieldKeys.map((key) => [key, snapshotValue(employee[key])]));
  const proposedValues = existing ? { ...valuesForRow(existing, 'proposed') } : { ...currentValues };
  const input = transferInput(body);
  for (const key of fieldKeys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) proposedValues[key] = snapshotValue(input[key]);
  }
  const data = {
    employee: employee.id,
    transfer_type: String(body.transfer_type || existing?.transfer_type || '').trim(),
    reason: nullableString(body.reason ?? existing?.reason),
    effective_date: asDate(body.effective_date ?? existing?.effective_date),
    supporting_document: nullableString(body.supporting_document ?? existing?.supporting_document),
    current_values: JSON.stringify(currentValues),
    proposed_values: JSON.stringify(proposedValues),
  };
  for (const [, employeeField, currentField, proposedField] of TRANSFER_FIELDS) {
    const isString = employeeField === 'jobTitleId';
    data[currentField] = isString ? nullableString(currentValues[employeeField]) : nullableBigInt(currentValues[employeeField]);
    data[proposedField] = isString ? nullableString(proposedValues[employeeField]) : nullableBigInt(proposedValues[employeeField]);
  }
  return data;
}

function validateDraft(data, res) {
  if (!data.transfer_type) { respond.badReq(res, 'Transfer type is required'); return false; }
  if (!data.effective_date) { respond.badReq(res, 'A valid effective date is required'); return false; }
  const currentValues = parseValues(data.current_values);
  const proposedValues = parseValues(data.proposed_values);
  const changed = [...new Set([...Object.keys(currentValues), ...Object.keys(proposedValues)])]
    .some((key) => !same(currentValues[key], proposedValues[key]));
  if (!changed) { respond.badReq(res, 'Select at least one proposed change'); return false; }
  return true;
}

async function applyTransferRecord(transferId, actor = null) {
  let changedSupervisor;
  const updated = await prisma.$transaction(async tx => {
    const transfer = await tx.employeetransfers.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.status !== 'Scheduled') return transfer;
    const currentValues = valuesForRow(transfer, 'current');
    const proposedValues = valuesForRow(transfer, 'proposed');
    const updateData = {};
    for (const [key, value] of Object.entries(proposedValues)) {
      if (!FIELD_BY_KEY[key] || same(currentValues[key], value)) continue;
      if (BIGINT_FIELDS.has(key)) {
        if (value != null && value !== '' && !/^\d+$/.test(String(value))) throw new Error(`Invalid ${FIELD_BY_KEY[key].label}`);
        updateData[key] = nullableBigInt(value);
      } else if (DATE_FIELDS.has(key)) {
        updateData[key] = asDate(value);
      } else {
        updateData[key] = nullableString(value);
      }
    }
    if (!Object.keys(updateData).length) throw new Error('The transfer no longer contains any changes');
    if (Object.prototype.hasOwnProperty.call(updateData, 'supervisorId')) changedSupervisor = updateData.supervisorId;
    await tx.employee.update({ where: { id: transfer.employee }, data: updateData });
    return tx.employeetransfers.update({ where: { id: transfer.id }, data: { status: 'Effective', effective_at: new Date() } });
  });
  if (!updated || updated.status !== 'Effective') return updated;
  if (changedSupervisor !== undefined) await reassignPendingSupervisorWork(updated.employee, changedSupervisor);
  // Every activation path (approval of an already-due transfer, manual activation, and the hourly
  // scheduler) passes through here. Sync only after the local transaction commits so the external
  // system receives the complete post-transfer employee record. The existing sync helper records
  // success/failure on the employee and deliberately does not roll back an effective transfer when
  // the external service is temporarily unavailable; the normal employee Sync retry remains usable.
  await syncEmployeeToExternalSystem(updated.employee);
  notifyEmployee(updated.employee, {
    message: `Your employee transfer ${updated.transfer_number} is now effective`,
    action: 'PersonalInfo', type: 'employee_transfer', fromUser: actor?.id,
  });
  return updated;
}

exports.listTransfers = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.status && req.query.status !== 'All') where.status = String(req.query.status);
  if (req.query.employee !== undefined) {
    const employeeId = toBigInt(req.query.employee);
    if (!employeeId) return respond.badReq(res, 'Invalid employee ID');
    where.employee = employeeId;
  }
  const rows = await prisma.employeetransfers.findMany({ where, orderBy: { created_at: 'desc' } });
  respond.ok(res, 'Employee transfers retrieved', await decorateMany(rows, true));
});

exports.getTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const row = id && await loadTransfer(id);
  if (!row) return respond.notFound(res, 'Employee transfer not found');
  respond.ok(res, 'Employee transfer retrieved', (await decorateMany([row], true))[0]);
});

exports.createTransfer = asyncHandler(async (req, res) => {
  const employeeId = toBigInt(req.body.employee);
  if (!employeeId) return respond.badReq(res, 'Employee is required');
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return respond.notFound(res, 'Employee not found');
  const duplicate = await prisma.employeetransfers.findFirst({ where: { employee: employeeId, status: { in: ACTIVE_STATUSES } } });
  if (duplicate) return respond.badReq(res, `This employee already has an active transfer (${duplicate.transfer_number})`);
  const configuredFields = await readTransferFields();
  if (!configuredFields.length) return respond.badReq(res, 'No Employee Transfer fields are enabled in Control Setup');
  const data = draftData(req.body, employee, null, configuredFields);
  if (!validateDraft(data, res)) return;
  const created = await prisma.employeetransfers.create({ data: {
    ...data, transfer_number: transferNumber(), status: 'Draft', initiated_by: toBigInt(req.user?.id),
  } });
  logActivity({ module: 'Employee Transfers', action: 'Created', entityId: created.id, entityName: created.transfer_number, ...fromReq(req) });
  respond.created(res, 'Employee transfer draft created', (await decorateMany([created], true))[0]);
});

exports.updateTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const existing = id && await loadTransfer(id);
  if (!existing) return respond.notFound(res, 'Employee transfer not found');
  if (existing.status !== 'Draft') return respond.badReq(res, 'Only Draft transfers can be edited');
  if (!hasPermission(req, 'manage_employee_transfers') && String(existing.initiated_by) !== String(req.user?.id)) {
    return respond.forbidden(res, 'You can only edit transfer drafts you created');
  }
  const employee = await prisma.employee.findUnique({ where: { id: existing.employee } });
  const data = draftData(req.body, employee, existing);
  if (!validateDraft(data, res)) return;
  const updated = await prisma.employeetransfers.update({ where: { id }, data });
  logActivity({ module: 'Employee Transfers', action: 'Updated', entityId: id, entityName: updated.transfer_number, ...fromReq(req) });
  respond.ok(res, 'Employee transfer updated', (await decorateMany([updated], true))[0]);
});

exports.submitTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const transfer = id && await loadTransfer(id);
  if (!transfer) return respond.notFound(res, 'Employee transfer not found');
  if (transfer.status !== 'Draft') return respond.badReq(res, 'Only Draft transfers can be submitted');
  if (!hasPermission(req, 'manage_employee_transfers') && String(transfer.initiated_by) !== String(req.user?.id)) {
    return respond.forbidden(res, 'You can only submit transfer drafts you created');
  }
  const flow = await readFlow();
  const updated = await prisma.$transaction(async tx => {
    await snapshotStages(tx, id, flow);
    return tx.employeetransfers.update({ where: { id }, data: { status: 'Pending Approval', submitted_at: new Date(), rejected_reason: null } });
  });
  if (flow.length) notifyStage(flow[0], req, updated);
  else notifyUsersWithPermission('approve_employee_transfers', {
    message: `Employee transfer ${updated.transfer_number} awaits your approval`, action: 'CentralApproval',
    type: 'employee_transfer', fromUser: req.user?.id, employee: updated.employee,
  }, req.user?.id);
  logActivity({ module: 'Employee Transfers', action: 'Submitted', entityId: id, entityName: updated.transfer_number, ...fromReq(req) });
  respond.ok(res, 'Employee transfer submitted for approval', (await decorateMany([updated], true))[0]);
});

exports.listApprovals = asyncHandler(async (req, res) => {
  const rows = await prisma.employeetransfers.findMany({ where: { status: 'Pending Approval' }, orderBy: { submitted_at: 'asc' } });
  if (!rows.length) return respond.ok(res, 'Employee transfer approvals retrieved', []);
  const stages = await prisma.employeetransferstages.findMany({
    where: { transfer_id: { in: rows.map(row => row.id) } }, orderBy: [{ transfer_id: 'asc' }, { stage_order: 'asc' }],
  });
  const byTransfer = stages.reduce((map, stage) => {
    const key = String(stage.transfer_id);
    map.set(key, [...(map.get(key) || []), stage]); return map;
  }, new Map());
  const visible = rows.filter(row => {
    const pending = (byTransfer.get(String(row.id)) || []).find(stage => stage.status === 'Pending');
    return pending ? actorMatchesStage(req, pending) : hasPermission(req, 'approve_employee_transfers');
  });
  respond.ok(res, 'Employee transfer approvals retrieved', await decorateMany(visible, true));
});

exports.approveTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const transfer = id && await loadTransfer(id);
  if (!transfer) return respond.notFound(res, 'Employee transfer not found');
  if (transfer.status !== 'Pending Approval') return respond.badReq(res, 'This transfer is not awaiting approval');
  const stages = await prisma.employeetransferstages.findMany({ where: { transfer_id: id }, orderBy: { stage_order: 'asc' } });
  const pending = stages.filter(stage => stage.status === 'Pending');
  if (pending.length) {
    const current = pending[0];
    if (!actorMatchesStage(req, current)) return respond.forbidden(res, `Only ${current.approver_label || 'the assigned approver'} can approve this stage`);
    await prisma.employeetransferstages.update({ where: { id: current.id }, data: {
      status: 'Approved', acted_by: toBigInt(req.user?.id), acted_at: new Date(), comment: nullableString(req.body.comment),
    } });
    if (pending.length > 1) {
      notifyStage(pending[1], req, transfer);
      logActivity({ module: 'Employee Transfers', action: `Approved stage: ${current.stage_name}`, entityId: id, entityName: transfer.transfer_number, ...fromReq(req) });
      return respond.ok(res, `Stage "${current.stage_name}" approved; awaiting the next stage`, (await decorateMany([transfer], true))[0]);
    }
  } else if (!hasPermission(req, 'approve_employee_transfers')) {
    return respond.forbidden(res, 'You do not have permission to approve employee transfers');
  }
  let updated = await prisma.employeetransfers.update({ where: { id }, data: { status: 'Scheduled', approved_at: new Date() } });
  notifyEmployee(updated.employee, {
    message: `Your employee transfer ${updated.transfer_number} was approved and scheduled for ${updated.effective_date.toISOString().slice(0, 10)}`,
    action: 'PersonalInfo', type: 'employee_transfer', fromUser: req.user?.id,
  });
  if (updated.effective_date <= todayUtc()) updated = await applyTransferRecord(id, req.user);
  logActivity({ module: 'Employee Transfers', action: updated.status === 'Effective' ? 'Approved and activated' : 'Approved and scheduled', entityId: id, entityName: updated.transfer_number, ...fromReq(req) });
  respond.ok(res, updated.status === 'Effective' ? 'Employee transfer approved and activated' : 'Employee transfer approved and scheduled', (await decorateMany([updated], true))[0]);
});

exports.rejectTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const transfer = id && await loadTransfer(id);
  if (!transfer) return respond.notFound(res, 'Employee transfer not found');
  if (transfer.status !== 'Pending Approval') return respond.badReq(res, 'This transfer is not awaiting approval');
  const reason = String(req.body.reason || '').trim();
  if (!reason) return respond.badReq(res, 'A rejection reason is required');
  const stages = await prisma.employeetransferstages.findMany({ where: { transfer_id: id }, orderBy: { stage_order: 'asc' } });
  const current = stages.find(stage => stage.status === 'Pending');
  if (current && !actorMatchesStage(req, current)) return respond.forbidden(res, `Only ${current.approver_label || 'the assigned approver'} can reject this stage`);
  if (!current && !hasPermission(req, 'approve_employee_transfers')) return respond.forbidden(res, 'You do not have permission to reject employee transfers');
  const updated = await prisma.$transaction(async tx => {
    if (current) await tx.employeetransferstages.update({ where: { id: current.id }, data: {
      status: 'Rejected', acted_by: toBigInt(req.user?.id), acted_at: new Date(), comment: reason,
    } });
    await tx.employeetransferstages.updateMany({ where: { transfer_id: id, status: 'Pending' }, data: { status: 'Skipped' } });
    return tx.employeetransfers.update({ where: { id }, data: { status: 'Rejected', rejected_reason: reason } });
  });
  notifyEmployee(updated.employee, { message: `Your employee transfer ${updated.transfer_number} was rejected: ${reason}`, action: 'PersonalInfo', type: 'employee_transfer', fromUser: req.user?.id });
  logActivity({ module: 'Employee Transfers', action: 'Rejected', entityId: id, entityName: updated.transfer_number, details: { reason }, ...fromReq(req) });
  respond.ok(res, 'Employee transfer rejected', (await decorateMany([updated], true))[0]);
});

exports.cancelTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const transfer = id && await loadTransfer(id);
  if (!transfer) return respond.notFound(res, 'Employee transfer not found');
  if (!['Draft', 'Pending Approval', 'Scheduled'].includes(transfer.status)) return respond.badReq(res, 'This transfer can no longer be cancelled');
  const reason = String(req.body.reason || '').trim();
  if (!reason) return respond.badReq(res, 'A cancellation reason is required');
  const updated = await prisma.$transaction(async tx => {
    await tx.employeetransferstages.updateMany({ where: { transfer_id: id, status: 'Pending' }, data: { status: 'Skipped' } });
    return tx.employeetransfers.update({ where: { id }, data: { status: 'Cancelled', cancelled_reason: reason } });
  });
  notifyEmployee(updated.employee, { message: `Employee transfer ${updated.transfer_number} was cancelled: ${reason}`, action: 'PersonalInfo', type: 'employee_transfer', fromUser: req.user?.id });
  logActivity({ module: 'Employee Transfers', action: 'Cancelled', entityId: id, entityName: updated.transfer_number, details: { reason }, ...fromReq(req) });
  respond.ok(res, 'Employee transfer cancelled', (await decorateMany([updated], true))[0]);
});

exports.rescheduleTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const transfer = id && await loadTransfer(id);
  if (!transfer) return respond.notFound(res, 'Employee transfer not found');
  if (transfer.status !== 'Scheduled') return respond.badReq(res, 'Only Scheduled transfers can be rescheduled');
  const effectiveDate = asDate(req.body.effective_date);
  if (!effectiveDate) return respond.badReq(res, 'A valid effective date is required');
  const updated = await prisma.employeetransfers.update({ where: { id }, data: { effective_date: effectiveDate } });
  notifyEmployee(updated.employee, { message: `Employee transfer ${updated.transfer_number} was rescheduled to ${effectiveDate.toISOString().slice(0, 10)}`, action: 'PersonalInfo', type: 'employee_transfer', fromUser: req.user?.id });
  logActivity({ module: 'Employee Transfers', action: 'Rescheduled', entityId: id, entityName: updated.transfer_number, details: { effectiveDate }, ...fromReq(req) });
  respond.ok(res, 'Employee transfer rescheduled', (await decorateMany([updated], true))[0]);
});

exports.activateTransfer = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const transfer = id && await loadTransfer(id);
  if (!transfer) return respond.notFound(res, 'Employee transfer not found');
  if (transfer.status !== 'Scheduled') return respond.badReq(res, 'Only Scheduled transfers can be activated');
  if (transfer.effective_date > todayUtc()) return respond.badReq(res, 'This transfer is not due yet; reschedule it first if it should take effect today');
  const updated = await applyTransferRecord(id, req.user);
  logActivity({ module: 'Employee Transfers', action: 'Activated', entityId: id, entityName: updated.transfer_number, ...fromReq(req) });
  respond.ok(res, 'Employee transfer activated', (await decorateMany([updated], true))[0]);
});

exports.getApprovalFlow = asyncHandler(async (_req, res) => {
  respond.ok(res, 'Employee transfer approval flow retrieved', await readStoredFlow(FLOW_KEY));
});

exports.getApprovalSettings = asyncHandler(async (_req, res) => {
  const useEmployeeApprovalFlow = await usesEmployeeApprovalFlow();
  const [employeeStages, transferStages] = await Promise.all([
    readStoredFlow(EMPLOYEE_FLOW_KEY), readStoredFlow(FLOW_KEY),
  ]);
  const effectiveStages = useEmployeeApprovalFlow ? employeeStages : transferStages;
  respond.ok(res, 'Employee transfer approval settings retrieved', {
    useEmployeeApprovalFlow, employeeStages, effectiveStages,
  });
});

exports.saveApprovalSettings = asyncHandler(async (req, res) => {
  const useEmployeeApprovalFlow = req.body?.useEmployeeApprovalFlow === true
    || req.body?.useEmployeeApprovalFlow === 1 || req.body?.useEmployeeApprovalFlow === '1';
  await upsertSetting(null, USE_EMPLOYEE_FLOW_KEY, 'app_controls', useEmployeeApprovalFlow ? '1' : '0');
  logActivity({
    module: 'Employee Transfers', action: 'Approval source updated',
    details: { useEmployeeApprovalFlow }, ...fromReq(req),
  });
  respond.ok(res, useEmployeeApprovalFlow
    ? 'Employee transfers will use the shared employee approval flow'
    : 'Employee transfers will use their own approval flow', { useEmployeeApprovalFlow });
});

exports.saveApprovalFlow = asyncHandler(async (req, res) => {
  const stages = Array.isArray(req.body?.stages) ? req.body.stages : [];
  const clean = [];
  for (const stage of stages) {
    const name = String(stage?.name || '').trim();
    if (!name) return respond.badReq(res, 'Every stage needs a name');
    if (!['role', 'user'].includes(stage.approverType)) return respond.badReq(res, `Stage "${name}" has an invalid approver type`);
    if (!String(stage.approverId ?? '').trim()) return respond.badReq(res, `Stage "${name}" needs an approver`);
    clean.push({ name, approverType: stage.approverType, approverId: String(stage.approverId), approverLabel: nullableString(stage.approverLabel) });
  }
  await upsertSetting(null, FLOW_KEY, 'app_controls', JSON.stringify(clean));
  logActivity({ module: 'Employee Transfers', action: 'Approval flow updated', details: { stages: clean }, ...fromReq(req) });
  respond.ok(res, 'Employee transfer approval flow saved', clean);
});

exports.runDueTransfers = async () => {
  const due = await prisma.employeetransfers.findMany({ where: { status: 'Scheduled', effective_date: { lte: todayUtc() } }, select: { id: true } });
  let activated = 0;
  for (const row of due) {
    const updated = await applyTransferRecord(row.id).catch(error => {
      console.error(`[employee transfers] failed to activate ${row.id}:`, error.message); return null;
    });
    if (updated?.status === 'Effective') activated++;
  }
  return { due: due.length, activated };
};
