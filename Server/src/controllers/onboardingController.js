const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');
const { s }        = require('../helpers/controllerHelpers');
const { notifyUsersWithPermission } = require('../helpers/notificationHelper');
const { isFieldVisible } = require('../config/employeeFormFields');
const { upsertSetting: upsertSettingShared } = require('../helpers/settingsHelper');
const crypto       = require('crypto');
const os           = require('os');

// First non-internal IPv4 address of this machine, so shared onboarding links
// use the LAN IP (reachable from a phone) instead of localhost.
function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '';
}

// Self-Onboarding: a public, tokenised intake form whose fields HR configures.
// Config (field list + share token + enabled flag) lives in the `settings` table
// under category 'onboarding'. Public submissions land in `onboarding_submission`
// as draft intake records until HR converts one into an employee.

// Code lists whose options the public form may need (mirrors onboardingFields.ts).
const PUBLIC_CODE_LISTS = ['TIT', 'GEN', 'NAT', 'REG', 'CT'];

// ── settings helpers (category='onboarding') ─────────────────────────────────

async function readSetting(name) {
  const row = await prisma.settings
    .findFirst({ where: { name, category: 'onboarding' }, select: { value: true } })
    .catch(() => null);
  return row ? (row.value ?? '') : null;
}

async function writeSetting(name, value) {
  await upsertSettingShared(null, name, 'onboarding', String(value ?? ''));
}

// Minimum fields needed to identify a submission — always shown and required.
// Mirrors ALWAYS_ON_KEYS in Client/lib/onboardingFields.ts.
const ALWAYS_ON_KEYS = ['firstName', 'lastName', 'work_email'];

const DEFAULT_CONFIG = {
  enabledFields:  [...ALWAYS_ON_KEYS],
  requiredFields: [...ALWAYS_ON_KEYS],
};

// Reads the employee-form field config (Settings → Controls → Employee Form). That config is the
// master gate: a field hidden there is not available on self-onboarding either.
async function readEmployeeFieldCfg() {
  const row = await prisma.settings
    .findFirst({ where: { name: 'employee_form_fields', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  if (!row?.value) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}

async function readConfig() {
  const raw = await readSetting('onboarding_config');
  let base = { ...DEFAULT_CONFIG };
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      base = {
        enabledFields:  Array.isArray(parsed.enabledFields)  ? parsed.enabledFields  : DEFAULT_CONFIG.enabledFields,
        requiredFields: Array.isArray(parsed.requiredFields) ? parsed.requiredFields : DEFAULT_CONFIG.requiredFields,
      };
    } catch { base = { ...DEFAULT_CONFIG }; }
  }
  // Apply the master gate — drop any field hidden in the employee-form controls.
  const empCfg = await readEmployeeFieldCfg();
  const enabledFields  = base.enabledFields.filter(k => isFieldVisible(empCfg, k));
  const requiredFields = base.requiredFields.filter(k => isFieldVisible(empCfg, k) && enabledFields.includes(k));
  return { enabledFields, requiredFields };
}

async function getOrCreateToken() {
  let token = await readSetting('onboarding_token');
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    await writeSetting('onboarding_token', token);
  }
  return token;
}

async function readBranding() {
  const row = await prisma.payslip_settings
    .findFirst({ select: { company_name: true, company_logo_url: true, accent_color: true } })
    .catch(() => null);
  return row ?? {};
}

async function readCodeLists() {
  const out = {};
  for (const code of PUBLIC_CODE_LISTS) {
    const list = await prisma.CodeList.findFirst({ where: { code, isActive: true } }).catch(() => null);
    if (!list) { out[code] = []; continue; }
    const values = await prisma.CodeListValue.findMany({
      where:   { codeListId: list.id, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select:  { id: true, label: true },
    }).catch(() => []);
    out[code] = values.map(v => ({ value: v.id, label: v.label }));
  }
  return out;
}

// ── Admin endpoints (permissionGuard manage_onboarding) ──────────────────────

// GET /onboarding/config
const getConfig = asyncHandler(async (req, res) => {
  const config  = await readConfig();
  const token   = await getOrCreateToken();
  const enabled = (await readSetting('onboarding_enabled')) !== '0'; // default ON
  return respond.ok(res, 'Onboarding config', { config, token, enabled, serverIp: lanIp() });
});

// PUT /onboarding/config  { enabledFields, requiredFields, enabled }
const saveConfig = asyncHandler(async (req, res) => {
  const { enabledFields, requiredFields, enabled } = req.body;
  if (enabledFields !== undefined || requiredFields !== undefined) {
    const cfg = {
      enabledFields:  Array.isArray(enabledFields)  ? enabledFields  : [],
      requiredFields: Array.isArray(requiredFields) ? requiredFields : [],
    };
    await writeSetting('onboarding_config', JSON.stringify(cfg));
  }
  if (enabled !== undefined) {
    await writeSetting('onboarding_enabled', enabled ? '1' : '0');
  }
  return respond.ok(res, 'Onboarding config saved');
});

// POST /onboarding/token/regenerate
const regenerateToken = asyncHandler(async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  await writeSetting('onboarding_token', token);
  return respond.ok(res, 'Link regenerated', { token });
});

// GET /onboarding/submissions
const listSubmissions = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT id, data, files, status, employee_id, created, updated
       FROM onboarding_submission ORDER BY created DESC`.catch(() => []);
  const list = rows.map(r => ({
    id:          String(r.id),
    status:      r.status,
    employee_id: r.employee_id ? String(r.employee_id) : null,
    created:     r.created,
    updated:     r.updated,
    data:        safeJson(r.data, {}),
    files:       safeJson(r.files, {}),
  }));
  return respond.ok(res, 'Submissions', list);
});

// POST /onboarding/submissions/:id/convert  { employee_id }
const convertSubmission = asyncHandler(async (req, res) => {
  const id  = BigInt(req.params.id);
  const eid = req.body.employee_id ? BigInt(req.body.employee_id) : null;
  await prisma.$executeRaw`UPDATE onboarding_submission SET status='Converted', employee_id=${eid} WHERE id=${id}`;
  return respond.ok(res, 'Submission converted');
});

// DELETE /onboarding/submissions/:id
const deleteSubmission = asyncHandler(async (req, res) => {
  const id = BigInt(req.params.id);
  await prisma.$executeRaw`DELETE FROM onboarding_submission WHERE id=${id}`;
  return respond.ok(res, 'Submission removed');
});

// ── Public endpoints (no auth) ───────────────────────────────────────────────

// GET /public/onboarding/:token
const publicGetForm = asyncHandler(async (req, res) => {
  const token   = await readSetting('onboarding_token');
  const enabled = (await readSetting('onboarding_enabled')) !== '0';
  if (!token || req.params.token !== token || !enabled) {
    return respond.ok(res, 'Onboarding form', { available: false });
  }
  const config    = await readConfig();
  const branding  = await readBranding();
  const codeLists = await readCodeLists();
  return respond.ok(res, 'Onboarding form', {
    available: true,
    branding:  s(branding),
    enabledFields:  config.enabledFields,
    requiredFields: config.requiredFields,
    codeLists,
  });
});

// POST /public/onboarding/:token/apply  (multipart — file fields via upload.any())
const publicSubmit = asyncHandler(async (req, res) => {
  const token   = await readSetting('onboarding_token');
  const enabled = (await readSetting('onboarding_enabled')) !== '0';
  if (!token || req.params.token !== token || !enabled) {
    return respond.badReq(res, 'This onboarding form is not available.');
  }

  const config  = await readConfig();
  const allowed = new Set(config.enabledFields);

  // Keep only enabled, non-empty text values
  const data = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allowed.has(k) && v !== undefined && v !== null && String(v).trim() !== '') {
      data[k] = String(v);
    }
  }

  // Uploaded files → { fieldKey: storedFilename } (only enabled fields)
  const files = {};
  for (const f of (req.files || [])) {
    if (allowed.has(f.fieldname)) files[f.fieldname] = f.filename;
  }

  // Always-on identity fields must be present
  for (const key of ALWAYS_ON_KEYS) {
    if (!data[key]) return respond.badReq(res, 'First name, last name and email are required.');
  }

  await prisma.$executeRaw`INSERT INTO onboarding_submission (data, files, status, created, updated)
     VALUES (${JSON.stringify(data)}, ${JSON.stringify(files)}, 'New', NOW(), NOW())`;

  const who = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'Someone';
  notifyUsersWithPermission('manage_onboarding', {
    message: `${who} submitted a self-onboarding form`,
    action: 'SelfOnboarding', type: 'onboarding',
  });

  return respond.created(res, 'Submission received', { ok: true });
});

function safeJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = {
  getConfig, saveConfig, regenerateToken,
  listSubmissions, convertSubmission, deleteSubmission,
  publicGetForm, publicSubmit,
};
