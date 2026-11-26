// Keeps Staff 360's copy of HR-MANAGER's roles in step with the local `roles` table.
//
// Staff 360 assigns our roles to staff and hands them back on XAuth login
// (decode → currentApplicationAccess.roles). For that to work, every role created, changed or
// deleted here must be mirrored there through the XAuth Roles API. We always send OUR role id as
// `roleId`, so the ids Staff 360 returns at login map straight back onto local `roles.id`.
//
// All calls are server-side only: they carry the app key + secret as headers.

const axios = require('axios');
const helper = require('./dbQueryHelper');

const baseUrl = () => (process.env.XAUTH_BASE_URL || 'http://10.32.11.53:8282').replace(/\/$/, '');

// Sync runs whenever XAuth credentials are configured, unless explicitly switched off
// (XAUTH_ROLE_SYNC=false), e.g. on a dev box sharing the production app key.
function enabled() {
  if (String(process.env.XAUTH_ROLE_SYNC || '').toLowerCase() === 'false') return false;
  return Boolean(process.env.XAUTH_APP_KEY && process.env.XAUTH_APP_SECRET);
}

// Role codes are derived from the role name: "HR Manager" → "HR-MANAGER". Staff 360 stores codes
// upper case and matches them case-insensitively, so we do the same.
function roleCodeFor(name) {
  return String(name || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const activeFlag = (status) => (String(status) === '0' ? 'N' : 'Y');

// Staff 360 records who made each change: the actor's staff id (employee.employee_id), falling back
// to their local username when they have no linked employee (e.g. the built-in admin account).
async function actorStaffId(user) {
  if (!user) return 'SYSTEM';
  if (user.employeeId) {
    const r = await helper.selectRecordsWithQuery(
      'SELECT employee_id FROM employee WHERE id = ? LIMIT 1',
      [helper.safeBigInt(user.employeeId)],
    );
    const staffId = r.data?.[0]?.employee_id;
    if (staffId) return String(staffId);
  }
  return String(user.username || user.id || 'SYSTEM');
}

// One request to the Roles API. Never throws: returns { ok, status, message, data } so callers can
// decide whether a failure blocks the local change or is just reported back.
async function call(method, path, { body, params } = {}) {
  if (!enabled()) return { ok: true, skipped: true, status: 0, message: 'Role sync disabled' };
  try {
    const res = await axios({
      method,
      url: `${baseUrl()}/api/v1/xauth/roles${path}`,
      data: body,
      params,
      headers: {
        'X-API-Key': process.env.XAUTH_APP_KEY,
        'X-API-Secret': process.env.XAUTH_APP_SECRET,
        'Content-Type': 'application/json',
      },
      timeout: Number(process.env.XAUTH_TIMEOUT_MS || 10000),
      validateStatus: () => true,
    });
    const payload = res.data || {};
    // A 2xx with success:false is still a failure; trust the envelope over the status code.
    const ok = res.status >= 200 && res.status < 300 && payload.success !== false;
    const message = payload.message || payload.data?.respMessage || `Staff 360 returned HTTP ${res.status}`;
    if (!ok) console.warn(`[xauth-role-sync] ${method} ${path} → ${res.status}: ${message}`);
    return { ok, status: res.status, message, data: payload.data };
  } catch (err) {
    console.warn(`[xauth-role-sync] ${method} ${path} failed: ${err.message}`);
    return { ok: false, status: 0, message: `Staff 360 unreachable: ${err.message}` };
  }
}

const listRoles = () => call('GET', '');
const getRole = (roleId) => call('GET', `/${encodeURIComponent(roleId)}`);

function createRole(role, userName) {
  return call('POST', '', {
    body: {
      roleId: String(role.id),
      roleName: role.name,
      roleCode: roleCodeFor(role.name),
      activeStatus: activeFlag(role.status),
      userName,
    },
  });
}

// Pushes the role's current name/code/status. If Staff 360 has never heard of it (404), create it,
// so a role that predates the integration, or whose create failed, heals itself on its next edit.
async function updateRole(role, userName) {
  const result = await call('PUT', `/${encodeURIComponent(String(role.id))}`, {
    body: {
      roleName: role.name,
      roleCode: roleCodeFor(role.name),
      activeStatus: activeFlag(role.status),
      userName,
    },
  });
  if (result.status === 404) return createRole(role, userName);
  return result;
}

function deleteRole(roleId, userName) {
  return call('DELETE', `/${encodeURIComponent(String(roleId))}`, { params: { userName } });
}

// Full reconcile: every local role is created or updated in Staff 360. Roles Staff 360 holds that
// no longer exist locally are reported (deleting them is left to an explicit decision, since
// Staff 360 refuses to delete a role still assigned to staff).
async function reconcileAll(userName) {
  const local = await helper.selectRecordsWithQuery('SELECT id, name, status FROM roles ORDER BY id', []);
  const localRoles = local.data || [];

  const remote = await listRoles();
  if (!remote.ok) return { ok: false, message: remote.message, results: [] };
  if (remote.skipped) return { ok: true, skipped: true, message: remote.message, results: [] };

  const remoteById = new Map((Array.isArray(remote.data) ? remote.data : []).map(r => [String(r.roleId), r]));
  const results = [];

  for (const role of localRoles) {
    const id = String(role.id);
    const existing = remoteById.get(id);
    const wanted = { roleName: role.name, roleCode: roleCodeFor(role.name), activeStatus: activeFlag(role.status) };
    let action = 'unchanged';
    let r = { ok: true };
    if (!existing) {
      action = 'created';
      r = await createRole(role, userName);
    } else if (
      existing.roleName !== wanted.roleName
      || String(existing.roleCode || '').toUpperCase() !== wanted.roleCode
      || existing.activeStatus !== wanted.activeStatus
    ) {
      action = 'updated';
      r = await updateRole(role, userName);
    }
    remoteById.delete(id);
    results.push({ roleId: id, roleName: role.name, action, ok: r.ok, message: r.ok ? undefined : r.message });
  }

  const orphans = [...remoteById.values()].map(r => ({ roleId: String(r.roleId), roleName: r.roleName, roleCode: r.roleCode }));
  return { ok: results.every(r => r.ok), results, orphans };
}

module.exports = {
  enabled, roleCodeFor, actorStaffId,
  listRoles, getRole, createRole, updateRole, deleteRole, reconcileAll,
};
