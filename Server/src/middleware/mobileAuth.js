// ─────────────────────────────────────────────────────────────────────────────
// Mobile self-service authentication (`/v1/api/hr/me/*`)
//
// ⚠️  ACCEPTED RISK — READ BEFORE CHANGING THIS FILE
// Callers authenticate with a SHARED API key plus a caller-supplied employee id. The key ships
// inside the mobile APK and is therefore extractable. Anyone holding it can pass any employee id
// and read that employee's salary, payslips, medical claims and personal data. This trade-off was
// chosen deliberately over per-user Bearer tokens; it is not an oversight.
//
// Because identity is not cryptographically bound to a user, the three controls below are what keep
// the exposure bounded. Do not remove them without replacing the auth model:
//   1. The key lives in `app_settings` and is rotatable from the UI (never in .env, never hardcoded),
//      so a leak is answered by a rotation rather than a redeploy.
//   2. Every request is written to the audit log with employee id and source IP, so misuse is
//      detectable after the fact.
//   3. Requests are rate limited per IP, so enumerating sequential employee ids is slow and visible.
//
// Deploy over HTTPS only — the key and every payload are otherwise plaintext on the wire.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { prisma } = require('../helpers/dbQueryHelper');
const { toBigInt } = require('../helpers/controllerHelpers');
const { resolveUserForEmployee } = require('../helpers/selfEmployee');
const { logActivity } = require('../controllers/auditController');
const respond = require('../helpers/respondHelper');
const asyncHandler = require('./asyncHandler');

const SETTING_KEY = 'mobile_api_key';

const clientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null;

// ── API key ──────────────────────────────────────────────────────────────────
// Generated lazily on first read so a fresh install works without manual setup. Mirrors the
// attendance device-key pattern in attendanceController.
async function getMobileApiKey() {
  // A FAILED read and "no key stored" are different outcomes and must not be conflated. Swallowing
  // the error here used to return null, which fell through to minting a replacement key and
  // overwriting the real one — so a transient DB hiccup (or a query issued while the connection was
  // still coming up, e.g. right after a deploy) silently rotated the key and locked out every mobile
  // client. Let a read error propagate: the caller returns 401 for that request, which is recoverable,
  // whereas a rotated key is not.
  const row = await prisma.app_settings
    .findUnique({ where: { setting_key: SETTING_KEY }, select: { setting_value: true } });

  if (row?.setting_value) return row.setting_value;

  // Genuinely absent (fresh install) — create one. `create` rather than `upsert` so that if a
  // concurrent request created it first, this loses the race and re-reads that value instead of
  // overwriting it.
  const key = crypto.randomBytes(24).toString('hex');
  try {
    await prisma.app_settings.create({
      data: { setting_key: SETTING_KEY, setting_value: key },
    });
    return key;
  } catch {
    // Unique-constraint violation (someone else won) or a write failure — re-read and use whatever
    // is actually stored rather than returning a key that was never persisted.
    const existing = await prisma.app_settings
      .findUnique({ where: { setting_key: SETTING_KEY }, select: { setting_value: true } });
    if (existing?.setting_value) return existing.setting_value;
    throw new Error('Mobile API key could not be read or created');
  }
}

// Constant-time compare so a wrong key can't be recovered by timing the response.
function keyMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;          // length alone is not secret
  return crypto.timingSafeEqual(a, b);
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// Deliberately dependency-free: a fixed window per IP, held in memory. Sufficient for the
// single-process deployment this runs in. If the API is ever scaled to multiple instances or put
// behind several nodes, replace this with a shared store (Redis) — per-process counters would
// otherwise multiply the effective limit by the instance count.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const hits = new Map();   // ip -> { count, resetAt }

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (rec.resetAt <= now) hits.delete(ip);
}, WINDOW_MS).unref();     // unref so this timer never holds the process open

function rateLimit(req, res, next) {
  const ip = clientIp(req) ?? 'unknown';
  const now = Date.now();
  const rec = hits.get(ip);

  if (!rec || rec.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  rec.count += 1;
  if (rec.count > MAX_PER_WINDOW) {
    res.set('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
    return res.status(429).json({ status: '429', message: 'Too many requests. Slow down and retry shortly.' });
  }
  next();
}

// ── API key only ─────────────────────────────────────────────────────────────
// For server-to-server callers that authenticate with the shared key but have no employee identity
// — the core banking system posting back a payroll decision, for example. `mobileAuth` below builds
// on this and additionally resolves the employee.
//
// Note this is a WEAKER check than mobileAuth: there is no second factor at all, just the key. Only
// mount it on routes that neither read nor return an individual's data.
const apiKeyOnly = asyncHandler(async (req, res, next) => {
  const provided = req.headers['x-api-key'];
  if (!provided) return res.status(401).json({ status: '401', message: 'Missing API key' });

  const expected = await getMobileApiKey();
  if (!keyMatches(provided, expected)) {
    logActivity({
      module: 'MobileAPI', action: 'auth_failed', ip: clientIp(req),
      details: { path: req.originalUrl, reason: 'invalid api key' },
    });
    return res.status(401).json({ status: '401', message: 'Invalid API key' });
  }
  next();
});

// ── Authenticate + resolve the employee ──────────────────────────────────────
const mobileAuth = asyncHandler(async (req, res, next) => {
  const provided = req.headers['x-api-key'];
  if (!provided) return res.status(401).json({ status: '401', message: 'Missing API key' });

  const expected = await getMobileApiKey();
  if (!keyMatches(provided, expected)) {
    logActivity({
      module: 'MobileAPI', action: 'auth_failed', ip: clientIp(req),
      details: { path: req.originalUrl, reason: 'invalid api key' },
    });
    return res.status(401).json({ status: '401', message: 'Invalid API key' });
  }

  // Employee id: header first, then body/query so form posts and simple GETs both work.
  const raw = req.headers['x-employee-id'] ?? req.body?.employeeId ?? req.query?.employeeId;
  if (raw == null || String(raw).trim() === '') {
    return respond.badReq(res, 'Missing employee id (send the x-employee-id header)');
  }

  // Accept EITHER the numeric database id (12) or the staff-facing employee code (EMP-2026-0012).
  // The code is what appears on an employee's record and what staff actually know, so a mobile app
  // will almost always have that rather than the internal id — rejecting it would be a trap.
  const value = String(raw).trim();
  const numericId = toBigInt(value);

  // Employee codes are NOT always non-numeric — many are bare digits (e.g. '2016001'). So a value that
  // parses as a number is ambiguous: it may be the database id OR the code. Try the id first (exact,
  // indexed), then fall back to the code; a non-numeric value only ever matches a code. Treating the
  // two as mutually exclusive made every employee with an all-digit code unreachable.
  let rows = numericId != null
    ? await prisma.$queryRaw`
        SELECT e.id, e.status, e.firstName, e.lastName, e.employee_id, e.supervisorid,
               e.email, e.work_email
          FROM employee e WHERE e.id = ${numericId} LIMIT 1`.catch(() => [])
    : [];

  if (!rows.length) {
    rows = await prisma.$queryRaw`
      SELECT e.id, e.status, e.firstName, e.lastName, e.employee_id, e.supervisorid,
             e.email, e.work_email
        FROM employee e WHERE e.employee_id = ${value} LIMIT 1`.catch(() => []);
  }

  const emp = rows[0];
  if (!emp) {
    // Name both accepted forms — "not found" is otherwise indistinguishable from "wrong format".
    return respond.notFound(res, `No employee found for "${value}". Send either the numeric employee id (e.g. 12) or the employee code (e.g. 2016001).`);
  }
  if (emp.status !== '1') return respond.forbidden(res, 'This employee record is not active');

  req.self = {
    id:           String(emp.id),
    code:         emp.employee_id ?? null,
    name:         [emp.firstName, emp.lastName].filter(Boolean).join(' '),
    supervisorId: emp.supervisorid ? String(emp.supervisorid) : null,
  };

  // The delegated controllers read `req.user` for audit attribution and approval-stage checks.
  // There is no JWT on this path, so synthesise it from the employee's linked account — audit rows
  // then attribute to a real user rather than to null.
  //
  // `email`/`username` matter beyond attribution: several self-service branches (e.g.
  // medicalController.getStaffMedical) resolve "my records" by matching req.user.email against
  // employee.email/work_email, or req.user.username against employee.employee_id. Populating all
  // three from the resolved employee makes those branches select this employee deterministically
  // instead of falling through to an empty result.
  const account = await resolveUserForEmployee(emp.id);
  req.user = {
    id:          account?.id ? String(account.id) : null,
    username:    account?.username ?? req.self.code ?? null,
    email:       emp.email ?? emp.work_email ?? null,
    employeeId:  String(emp.id),
    roles:       [],          // mobile callers get no roles …
    permissions: [],          // … and no permissions: /me/* is self-scoped by construction
    viaMobileApi: true,
  };

  logActivity({
    module: 'MobileAPI',
    action: `${req.method} ${req.path}`,
    entityId: req.self.id,
    entityName: req.self.code ?? req.self.name,
    userId: req.user.id,
    userName: req.user.username,
    ip: clientIp(req),
  });

  next();
});

module.exports = { mobileAuth, apiKeyOnly, rateLimit, getMobileApiKey, SETTING_KEY };
