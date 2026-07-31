const axios = require('axios');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../middleware/asyncHandler');
const helper = require('../helpers/dbQueryHelper');

// Base address of the Staff360 (XAuth) server. The trailing slash is stripped so we can safely
// append paths like `/api/v1/...` without ending up with a double slash.
const xauthBaseUrl = () => (process.env.XAUTH_BASE_URL || 'http://10.203.14.15:8080').replace(/\/$/, '');

// The XAuth staff identifier is stored in ONE place only: employee.employee_id. We deliberately do
// NOT keep a copy on the users table — the link from an XAuth login to a local account is resolved
// by joining the decoded staff id to employee.employee_id, then to the user via users.employeeId.

// True only when both XAuth credentials are present in the environment. Without them we cannot
// talk to Staff360 at all, so every route checks this first.
function configured() {
  return Boolean(process.env.XAUTH_APP_KEY && process.env.XAUTH_APP_SECRET);
}

// Standard reply when SSO is switched off / not set up on this environment.
function sendUnavailable(res) {
  return res.status(503).json({ status: '503', message: 'Staff single sign-on is not configured.' });
}

// Once we know WHO the user is, this builds the normal HR-MANAGER login response:
// gather their roles + permissions, sign the tokens, save the refresh token, and reply.
async function issueLocalSession(res, user) {
  // 1. Roles currently assigned to this user (active roles only).
  const rolesResult = await helper.selectRecordsWithQuery(`
    SELECT r.id, r.name
    FROM roles r
    INNER JOIN model_has_roles mhr ON mhr.role_id = r.id
    WHERE mhr.model_id = ? AND mhr.model_type = 'users' AND r.status = '1'
    ORDER BY r.name ASC
  `, [String(user.id)]);
  const roles = rolesResult.data || [];

  // 2. Permissions that come indirectly, through those roles.
  let rolePermissions = [];
  if (roles.length) {
    // One `?` per role id, e.g. "?,?,?" — so the IN (...) list matches the values below.
    const placeholders = roles.map(() => '?').join(',');
    const result = await helper.selectRecordsWithQuery(`
      SELECT DISTINCT p.id, p.name
      FROM permissions p
      INNER JOIN role_has_permissions rhp ON rhp.permission_id = p.id
      WHERE rhp.role_id IN (${placeholders})
      ORDER BY p.name ASC
    `, roles.map(role => role.id));
    rolePermissions = result.data || [];
  }

  // 3. Permissions granted straight to the user, bypassing roles.
  const directResult = await helper.selectRecordsWithQuery(`
    SELECT DISTINCT p.id, p.name
    FROM permissions p
    INNER JOIN model_has_permissions mhp ON mhp.permission_id = p.id
    WHERE mhp.model_id = ? AND mhp.model_type = 'users'
    ORDER BY p.name ASC
  `, [String(user.id)]);
  // Merge both permission lists into one de-duplicated, alphabetically sorted list of names.
  const permissions = Array.from(new Set([...rolePermissions, ...(directResult.data || [])].map(p => p.name))).sort();

  // Short-lived token the frontend sends on every API call.
  const accessToken = jwt.sign(
    { id: user.id, email: user.email }, process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
  );
  // Long-lived token used to silently get a new access token when the short one expires.
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email }, process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' },
  );
  // Keep a copy of the refresh token in the DB (valid 7 days) so it can be checked or revoked later.
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await helper.dynamicInsert('refresh_tokens', {
    user_id: user.id, token: refreshToken, expires_at: expiresAt, revoked: false,
  });
  // Send the refresh token as an httpOnly cookie so browser JavaScript can never read it.
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // Final payload for the frontend. `password: undefined` makes sure the hash is never sent out.
  return res.json({
    status: '200', message: 'Login successful', accessToken,
    data: {
      ...user, password: undefined, userType: 'employee', roles: roles.map(role => role.name),
      permissions, isStageApprover: false,
    },
  });
}

// STEP 1 of the login flow.
// Redirect the browser to Staff360's hosted sign-in page. Only the public app key goes in the URL —
// the app secret never leaves this server.
const initiate = (req, res) => {
  if (!configured()) return sendUnavailable(res);
  return res.redirect(302, `${xauthBaseUrl()}/api/v1/xauth/signin/initiate?app_key=${encodeURIComponent(process.env.XAUTH_APP_KEY)}`);
};

// STEP 2 of the login flow.
// After Staff360 signs the user in it sends them back with a meaningless-looking token.
// The frontend posts that token here; we verify it with Staff360, map it to the local
// employee/user record, then create the normal HR-MANAGER session.
const exchange = asyncHandler(async (req, res) => {
  if (!configured()) return sendUnavailable(res);
  // Only accept a non-empty string token; anything else is a bad request.
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).json({ status: '400', message: 'Missing authentication token.' });

  // Ask Staff360 to decode the token for us. Because we send the app secret, only this server can
  // do it — a stolen token is useless on its own.
  let decoded;
  try {
    const response = await axios.post(`${xauthBaseUrl()}/api/v1/xauth/decode`, {
      token, appKey: process.env.XAUTH_APP_KEY, appSecret: process.env.XAUTH_APP_SECRET,
    }, { timeout: Number(process.env.XAUTH_TIMEOUT_MS || 10000) });
    decoded = response.data?.data;
  } catch {
    // Network error, timeout, or Staff360 rejected the token — all treated as "not logged in".
    return res.status(401).json({ status: '401', message: 'Staff single sign-on could not be verified.' });
  }

  // Accept either the documented `staffId` or the legacy `employeeid` field from the decode response.
  const staffId = typeof (decoded?.staffId ?? decoded?.employeeid) === 'string'
    ? String(decoded.staffId ?? decoded.employeeid).trim()
    : '';
  if (!staffId) return res.status(401).json({ status: '401', message: 'Staff single sign-on returned no staff ID.' });

  // Resolve the local account by the staff id held ONLY on the employee record: match
  // employee.employee_id, then find the user linked to that employee via users.employeeId.
  // Happy path: the employee already has a local user account.
  let result = await helper.selectRecordsWithQuery(`
    SELECT u.id, u.username, u.status, u.employeeId, u.theme,
           e.email, e.firstName, e.lastName, e.phone
    FROM employee e INNER JOIN users u ON u.employeeId = e.id
    WHERE e.employee_id = ? LIMIT 1
  `, [staffId]);
  let user = result.data?.[0];

  if (!user) {
    // Employee exists but has no local user yet — auto-provision one. The staff id is NOT copied
    // onto the users row; only the numeric employeeId link is stored, so the identifier stays in
    // exactly one place (employee.employee_id).
    const employeeResult = await helper.selectRecordsWithQuery(`
      SELECT id, email, firstName, lastName, phone FROM employee WHERE employee_id = ? LIMIT 1
    `, [staffId]);
    const employee = employeeResult.data?.[0];
    // No employee row either: they are a valid Staff360 user but unknown to HR-MANAGER.
    if (!employee) return res.status(403).json({ status: '403', message: 'Your staff record has not been provisioned for this portal.' });

    // Create the minimal user row and link it to the employee.
    const created = await helper.dynamicInsert('users', {
      username: decoded.username || staffId, employeeId: helper.safeBigInt(employee.id), status: '1',
    });
    if (created.status === 'error') throw new Error('Unable to create local XAuth user');
    // Merge in the employee's contact details so the session response looks the same either way.
    user = { ...created.data, email: employee.email, firstName: employee.firstName, lastName: employee.lastName, phone: employee.phone };
  }

  // Even a valid Staff360 login is refused if the local account has been disabled.
  if (user.status !== '1') return res.status(403).json({ status: '403', message: 'Account is deactivated. Contact administrator.' });
  // Identity confirmed — hand over to the shared session builder.
  return issueLocalSession(res, user);
});

module.exports = { initiate, exchange };
