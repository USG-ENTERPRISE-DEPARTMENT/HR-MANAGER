const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');

const API_CAT = 'api';

const ALL_KEYS = [
  'gl_url', 'gl_api_key', 'gl_api_secret', 'gl_bearer_token',
  'gl_basic_user', 'gl_basic_pass', 'gl_timeout', 'gl_forwarded_for', 'gl_extra',
  'employee_sync_url', 'employee_sync_timeout',
  'employee_sync_api_key', 'employee_sync_api_secret',
  'employee_sync_bearer_token', 'employee_sync_basic_user', 'employee_sync_basic_pass',
  'employee_sync_extra',
];

// ── Internal helpers ───────────────────────────────────────────────────────────

async function upsertSetting(name, value) {
  const existing = await prisma.settings.findFirst({
    where: { name, category: API_CAT },
    select: { id: true },
  }).catch(() => null);

  if (existing) {
    await prisma.settings.update({
      where: { id: existing.id },
      data: { value },
    });
  } else {
    await prisma.settings.create({
      data: {
        id: BigInt(Date.now()),
        name,
        value,
        category: API_CAT,
      },
    });
  }
}

async function readApiSettings() {
  const rows = await prisma.settings.findMany({
    where: { category: API_CAT },
    select: { name: true, value: true },
  }).catch(() => []);
  return Object.fromEntries(rows.map(r => [r.name, r.value ?? '']));
}

// ── Exported async helper — used by glHelper and employeeController ────────────

async function getApiConfig() {
  const db = await readApiSettings();
  return {
    gl_url:                db.gl_url                || process.env.POSTING_API_URL       || '',
    gl_api_key:            db.gl_api_key            || process.env.POSTING_API_KEY        || '',
    gl_api_secret:         db.gl_api_secret         || process.env.POSTING_API_SECRET     || '',
    gl_bearer_token:       db.gl_bearer_token       || '',
    gl_basic_user:         db.gl_basic_user         || '',
    gl_basic_pass:         db.gl_basic_pass         || '',
    gl_timeout:            db.gl_timeout            || '30000',
    gl_forwarded_for:      db.gl_forwarded_for      || process.env.POSTING_X_FORWARDED_FOR || '',
    gl_extra:              db.gl_extra              || '{}',
    employee_sync_url:          db.employee_sync_url          || process.env.EMPLOYEE_SYNC_URL || '',
    employee_sync_timeout:      db.employee_sync_timeout      || '10000',
    employee_sync_api_key:      db.employee_sync_api_key      || '',
    employee_sync_api_secret:   db.employee_sync_api_secret   || '',
    employee_sync_bearer_token: db.employee_sync_bearer_token || '',
    employee_sync_basic_user:   db.employee_sync_basic_user   || '',
    employee_sync_basic_pass:   db.employee_sync_basic_pass   || '',
    employee_sync_extra:        db.employee_sync_extra        || '{}',
  };
}

// ── Startup seed — insert from .env only if the DB row is missing ──────────────

(async () => {
  const seed = [
    ['gl_url',                process.env.POSTING_API_URL        || ''],
    ['gl_api_key',            process.env.POSTING_API_KEY        || ''],
    ['gl_api_secret',         process.env.POSTING_API_SECRET     || ''],
    ['gl_bearer_token',       ''],
    ['gl_basic_user',         ''],
    ['gl_basic_pass',         ''],
    ['gl_timeout',            '30000'],
    ['gl_forwarded_for',      process.env.POSTING_X_FORWARDED_FOR || ''],
    ['gl_extra',              JSON.stringify({
      channel_code: process.env.POSTING_CHANNEL_CODE     || 'HRP',
      trans_type:   process.env.POSTING_TRANS_TYPE       || '1504',
      currency:     process.env.POSTING_DEFAULT_CURRENCY || 'SLL',
      branch:       process.env.POSTING_DEFAULT_BRANCH   || '000',
    })],
    ['employee_sync_url',          process.env.EMPLOYEE_SYNC_URL || ''],
    ['employee_sync_timeout',      '10000'],
    ['employee_sync_api_key',      ''],
    ['employee_sync_api_secret',   ''],
    ['employee_sync_bearer_token', ''],
    ['employee_sync_basic_user',   ''],
    ['employee_sync_basic_pass',   ''],
    ['employee_sync_extra',        '{}'],
  ];

  for (let i = 0; i < seed.length; i++) {
    const [name, value] = seed[i];
    const existing = await prisma.settings.findFirst({
      where: { name, category: API_CAT },
      select: { id: true },
    }).catch(() => null);

    if (!existing) {
      await prisma.settings.create({
        data: {
          id: BigInt(Date.now()) * 100n + BigInt(i),
          name,
          value,
          category: API_CAT,
        },
      }).catch(() => {});
    }
  }
})();

// ── HTTP endpoints ─────────────────────────────────────────────────────────────

const getApiIntegrations = asyncHandler(async (req, res) => {
  const cfg = await getApiConfig();
  return respond.ok(res, 'API integration settings', cfg);
});

const updateApiIntegrations = asyncHandler(async (req, res) => {
  for (const key of ALL_KEYS) {
    if (req.body[key] !== undefined) {
      await upsertSetting(key, String(req.body[key]));
    }
  }
  return respond.ok(res, 'API integration settings saved');
});

module.exports = { getApiIntegrations, updateApiIntegrations, getApiConfig };
