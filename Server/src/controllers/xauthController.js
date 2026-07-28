const axios = require('axios');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../middleware/asyncHandler');
const helper = require('../helpers/dbQueryHelper');

const xauthBaseUrl = () => (process.env.XAUTH_BASE_URL || 'http://10.203.14.15:8080').replace(/\/$/, '');
// PostgreSQL's legacy `employeeid` is the numeric employee relation, so its schema uses
// `xauth_employeeid` for the external identifier. MySQL uses the required `employeeid` column.
const xauthColumn = () => helper.prisma?._activeProvider === 'postgresql' ? 'xauth_employeeid' : 'employeeid';

function configured() {
  return Boolean(process.env.XAUTH_APP_KEY && process.env.XAUTH_APP_SECRET);
}

function sendUnavailable(res) {
  return res.status(503).json({ status: '503', message: 'Staff single sign-on is not configured.' });
}

async function issueLocalSession(res, user) {
  const rolesResult = await helper.selectRecordsWithQuery(`
    SELECT r.id, r.name
    FROM roles r
    INNER JOIN model_has_roles mhr ON mhr.role_id = r.id
    WHERE mhr.model_id = ? AND mhr.model_type = 'users' AND r.status = '1'
    ORDER BY r.name ASC
  `, [String(user.id)]);
  const roles = rolesResult.data || [];

  let rolePermissions = [];
  if (roles.length) {
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

  const directResult = await helper.selectRecordsWithQuery(`
    SELECT DISTINCT p.id, p.name
    FROM permissions p
    INNER JOIN model_has_permissions mhp ON mhp.permission_id = p.id
    WHERE mhp.model_id = ? AND mhp.model_type = 'users'
    ORDER BY p.name ASC
  `, [String(user.id)]);
  const permissions = Array.from(new Set([...rolePermissions, ...(directResult.data || [])].map(p => p.name))).sort();

  const accessToken = jwt.sign(
    { id: user.id, email: user.email }, process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
  );
  const refreshToken = jwt.sign(
    { id: user.id, email: user.email }, process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' },
  );
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await helper.dynamicInsert('refresh_tokens', {
    user_id: user.id, token: refreshToken, expires_at: expiresAt, revoked: false,
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    status: '200', message: 'Login successful', accessToken,
    data: {
      ...user, password: undefined, userType: 'employee', roles: roles.map(role => role.name),
      permissions, isStageApprover: false,
    },
  });
}

// Redirect the browser to Staff360's hosted sign-in page. The app secret never leaves this server.
const initiate = (req, res) => {
  if (!configured()) return sendUnavailable(res);
  return res.redirect(302, `${xauthBaseUrl()}/api/v1/xauth/signin/initiate?app_key=${encodeURIComponent(process.env.XAUTH_APP_KEY)}`);
};

// The frontend callback posts the opaque token here. This endpoint verifies it server-side,
// maps it to the local employee/user record, then creates the normal HR-MANAGER session.
const exchange = asyncHandler(async (req, res) => {
  if (!configured()) return sendUnavailable(res);
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).json({ status: '400', message: 'Missing authentication token.' });

  let decoded;
  try {
    const response = await axios.post(`${xauthBaseUrl()}/api/v1/xauth/decode`, {
      token, appKey: process.env.XAUTH_APP_KEY, appSecret: process.env.XAUTH_APP_SECRET,
    }, { timeout: Number(process.env.XAUTH_TIMEOUT_MS || 10000) });
    decoded = response.data?.data;
  } catch {
    return res.status(401).json({ status: '401', message: 'Staff single sign-on could not be verified.' });
  }

  const employeeid = typeof decoded?.employeeid === 'string' ? decoded.employeeid.trim() : '';
  if (!employeeid) return res.status(401).json({ status: '401', message: 'Staff single sign-on returned no employee ID.' });

  // First honour the mandatory XAuth identity mapping. For pre-existing accounts, safely backfill
  // it only where their linked employee record has the same authoritative staff identifier.
  const identityColumn = xauthColumn();
  let result = await helper.selectRecordsWithQuery(`
    SELECT u.id, u.username, u.status, u.employeeId, u.theme, u.${identityColumn} AS xauthEmployeeid,
           e.email, e.firstName, e.lastName, e.phone
    FROM users u LEFT JOIN employee e ON e.id = u.employeeId
    WHERE u.${identityColumn} = ? LIMIT 1
  `, [employeeid]);
  let user = result.data?.[0];

  if (!user) {
    result = await helper.selectRecordsWithQuery(`
      SELECT u.id, u.username, u.status, u.employeeId, u.theme, u.${identityColumn} AS xauthEmployeeid,
             e.email, e.firstName, e.lastName, e.phone
      FROM users u INNER JOIN employee e ON e.id = u.employeeId
      WHERE e.employee_id = ? LIMIT 1
    `, [employeeid]);
    user = result.data?.[0];
    if (user) {
      await helper.dynamicUpdateWithId('users', { [identityColumn]: employeeid }, user.id);
      user.xauthEmployeeid = employeeid;
    }
  }

  if (!user) {
    const employeeResult = await helper.selectRecordsWithQuery(`
      SELECT id, email, firstName, lastName, phone FROM employee WHERE employee_id = ? LIMIT 1
    `, [employeeid]);
    const employee = employeeResult.data?.[0];
    if (!employee) return res.status(403).json({ status: '403', message: 'Your staff record has not been provisioned for this portal.' });

    const created = await helper.dynamicInsert('users', {
      username: decoded.username || employeeid, employeeId: helper.safeBigInt(employee.id), [identityColumn]: employeeid, status: '1',
    });
    if (created.status === 'error') throw new Error('Unable to create local XAuth user');
    user = { ...created.data, email: employee.email, firstName: employee.firstName, lastName: employee.lastName, phone: employee.phone };
  }

  if (user.status !== '1') return res.status(403).json({ status: '403', message: 'Account is deactivated. Contact administrator.' });
  return issueLocalSession(res, user);
});

module.exports = { initiate, exchange };
