const helper = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const { tmsg } = require('../helpers/messageStore');

// Resolve a mixed array of permission names and/or numeric IDs to a deduped list of
// numeric permission ID strings. The client sends permission NAMES (e.g. 'manage_roles'),
// so we look those up here — this keeps role saves working regardless of whether the
// client managed to map names → IDs first.
async function resolvePermissionIds(perms) {
  if (!Array.isArray(perms) || perms.length === 0) return [];
  const ids = [];
  const names = [];
  for (const p of perms) {
    if (p === null || p === undefined || p === '') continue;
    if (!isNaN(Number(p))) ids.push(String(p));
    else if (typeof p === 'string') names.push(p);
  }
  if (names.length > 0) {
    const placeholders = names.map(() => '?').join(',');
    const r = await helper.selectRecordsWithQuery(
      `SELECT id FROM permissions WHERE name IN (${placeholders})`, names
    );
    for (const row of (r.data ?? [])) ids.push(String(row.id));
  }
  return [...new Set(ids)];
}



// ─────────────────────────────────────────────
// @desc    Assign a role to a user
// @route   POST /api/roles/assign
// @access  Admin
// ─────────────────────────────────────────────
const assignRoleToUser = asyncHandler(async (req, res) => {
  const { userId, roleId } = req.body;

  const validation = helper.checkForNullOrEmpty([
    { name: 'User ID', value: userId },
    { name: 'Role ID', value: roleId },
  ]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  const userIdBig = helper.safeBigInt(userId);
  const roleIdBig = helper.safeBigInt(roleId);
  if (!userIdBig || !roleIdBig) {
    return res.status(400).json({ status: '400', message: 'Invalid User ID or Role ID' });
  }

  const existing = await helper.selectRecordsWithQuery(`
    SELECT * FROM model_has_roles 
    WHERE model_id = ? AND role_id = ? AND model_type = 'users'
  `, [userId, roleId]);

  if (existing.data.length > 0) {
    return res.status(409).json({ status: '409', message: 'Role already assigned to this user' });
  }

  const result = await helper.dynamicInsert('model_has_roles', {
    role_id: roleIdBig,
    model_id: userIdBig,
    model_type: 'users',
  });

  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  res.status(201).json({ status: '201', message: 'Role assigned successfully' });
});

// ─────────────────────────────────────────────
// @desc    Remove a role from a user
// @route   DELETE /api/roles/revoke
// @access  Admin
// ─────────────────────────────────────────────
const revokeRoleFromUser = asyncHandler(async (req, res) => {
  const { userId, roleId } = req.body;

  const validation = helper.checkForNullOrEmpty([
    { name: 'User ID', value: userId },
    { name: 'Role ID', value: roleId },
  ]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  const userIdBig = helper.safeBigInt(userId);
  const roleIdBig = helper.safeBigInt(roleId);
  if (!userIdBig || !roleIdBig) {
    return res.status(400).json({ status: '400', message: 'Invalid User ID or Role ID' });
  }

  const result = await helper.deleteRecordsWithCondition('model_has_roles', {
    model_id: userIdBig,
    role_id: roleIdBig,
    model_type: 'users',
  });

  if (result.status === 'error') {
    return res.status(404).json({ status: '404', message: result.message });
  }

  res.status(200).json({ status: '200', message: 'Role revoked successfully' });
});

// ─────────────────────────────────────────────
// @desc    Assign a direct permission to a user
// @route   POST /api/permissions/assign
// @access  Admin
// ─────────────────────────────────────────────
const assignPermissionToUser = asyncHandler(async (req, res) => {
  const { userId, permissionId } = req.body;

  const validation = helper.checkForNullOrEmpty([
    { name: 'User ID', value: userId },
    { name: 'Permission ID', value: permissionId },
  ]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  const userIdBig = helper.safeBigInt(userId);
  const permIdBig = helper.safeBigInt(permissionId);
  if (!userIdBig || !permIdBig) {
    return res.status(400).json({ status: '400', message: 'Invalid User ID or Permission ID' });
  }

  const existing = await helper.selectRecordsWithQuery(`
    SELECT * FROM model_has_permissions 
    WHERE model_id = ? AND permission_id = ? AND model_type = 'users'
  `, [userId, permissionId]);

  if (existing.data.length > 0) {
    return res.status(409).json({ status: '409', message: 'Permission already assigned to this user' });
  }

  const result = await helper.dynamicInsert('model_has_permissions', {
    permission_id: permIdBig,
    model_id: userIdBig,
    model_type: 'users',
  });

  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  res.status(201).json({ status: '201', message: 'Permission assigned successfully' });
});

// ─────────────────────────────────────────────
// @desc    Revoke a direct permission from a user
// @route   DELETE /api/permissions/revoke
// @access  Admin
// ─────────────────────────────────────────────
const revokePermissionFromUser = asyncHandler(async (req, res) => {
  const { userId, permissionId } = req.body;

  const validation = helper.checkForNullOrEmpty([
    { name: 'User ID', value: userId },
    { name: 'Permission ID', value: permissionId },
  ]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  const userIdBig = helper.safeBigInt(userId);
  const permIdBig = helper.safeBigInt(permissionId);
  if (!userIdBig || !permIdBig) {
    return res.status(400).json({ status: '400', message: 'Invalid User ID or Permission ID' });
  }

  const result = await helper.deleteRecordsWithCondition('model_has_permissions', {
    model_id: userIdBig,
    permission_id: permIdBig,
    model_type: 'users',
  });

  if (result.status === 'error') {
    return res.status(404).json({ status: '404', message: result.message });
  }

  res.status(200).json({ status: '200', message: 'Permission revoked successfully' });
});

// ─────────────────────────────────────────────
// @desc    Get all roles with their permissions
// @route   GET /api/roles
// @access  Admin
// ─────────────────────────────────────────────
const getAllRoles = asyncHandler(async (req, res) => {
  const rolesResult = await helper.selectRecordsWithCondition('roles', {});

  if (rolesResult.status === 'error') {
    return res.status(200).json({ status: '200', data: [] });
  }

  const rolesWithPermissions = await Promise.all(
    rolesResult.data.map(async (role) => {
      const permissionsResult = await helper.selectRecordsWithQuery(`
        SELECT p.id, p.name, p.guard_name
        FROM permissions p
        INNER JOIN role_has_permissions rhp ON rhp.permission_id = p.id
        WHERE rhp.role_id = ?
      `, [role.id]);

      return {
        ...role,
        permissions: permissionsResult.data ?? [],
      };
    })
  );

  res.status(200).json({ status: '200', data: rolesWithPermissions });
});

// ─────────────────────────────────────────────
// @desc    Get all permissions
// @route   GET /api/permissions
// @access  Admin
// ─────────────────────────────────────────────
const getAllPermissions = asyncHandler(async (req, res) => {
  const result = await helper.selectRecordsWithCondition('permissions', {});

  res.status(200).json({
    status: '200',
    data: result.data ?? [],
  });
});

// ─────────────────────────────────────────────
// @desc    Get a user's roles and permissions
// @route   GET /api/users/:id/access
// @access  Admin
// ─────────────────────────────────────────────
const getUserAccess = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const rolesResult = await helper.selectRecordsWithQuery(`
    SELECT r.id, r.name
    FROM roles r
    INNER JOIN model_has_roles mhr ON mhr.role_id = r.id
    WHERE mhr.model_id = ? AND mhr.model_type = 'users'
  `, [id]);

  const permissionsResult = await helper.selectRecordsWithQuery(`
    SELECT DISTINCT p.id, p.name
    FROM permissions p
    LEFT JOIN role_has_permissions rhp ON rhp.permission_id = p.id
    LEFT JOIN model_has_roles mhr ON mhr.role_id = rhp.role_id AND mhr.model_type = 'users' AND mhr.model_id = ?
    LEFT JOIN model_has_permissions mhp ON mhp.permission_id = p.id AND mhp.model_type = 'users' AND mhp.model_id = ?
    WHERE mhr.model_id IS NOT NULL OR mhp.model_id IS NOT NULL
  `, [id, id]);

  res.status(200).json({
    status: '200',
    data: {
      roles: rolesResult.data ?? [],
      permissions: permissionsResult.data ?? [],
    },
  });
});

// ─────────────────────────────────────────────
// @desc    Create a new role with permissions
// @route   POST /api/roles
// @access  Admin
// ─────────────────────────────────────────────
const addRole = asyncHandler(async (req, res) => {
  const { name, guard_name = 'api', description, is_system } = req.body;
  const permission_ids = req.body.permission_ids ?? req.body.permissions;

  const validation = helper.checkForNullOrEmpty([
    { name: 'Role Name', value: name },
    { name: 'Guard Name', value: guard_name },
  ]);

  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  // Check if role already exists
  const existing = await helper.selectRecordsWithQuery(
    `SELECT id FROM roles WHERE name = ?`,
    [name]
  );
  if (existing.data.length > 0) {
    return res.status(409).json({ status: '409', message: 'A role with this name already exists' });
  }

  // Create the role
  const result = await helper.dynamicInsert('roles', {
    name,
    guard_name,
    description: description ?? null,
    is_system: is_system ?? false,
  });

  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  const newRoleId = result.data?.insertId ?? result.data?.id ?? result.insertId;

  // Assign permissions — accept names or IDs, resolve to numeric IDs
  if (Array.isArray(permission_ids) && permission_ids.length > 0 && newRoleId) {
    const resolvedIds = await resolvePermissionIds(permission_ids);
    if (resolvedIds.length > 0) {
      await Promise.all(
        resolvedIds.map((permId) =>
          helper.dynamicInsert('role_has_permissions', {
            role_id: helper.safeBigInt(newRoleId),
            permission_id: helper.safeBigInt(permId),
          })
        )
      );
    }
  }

  // Return created role with permissions (two queries — no JSON_ARRAYAGG)
  const [roleResult, permResult] = await Promise.all([
    helper.selectRecordsWithCondition('roles', { id: helper.safeBigInt(newRoleId) }),
    helper.selectRecordsWithQuery(
      `SELECT p.id, p.name FROM permissions p
       INNER JOIN role_has_permissions rhp ON rhp.permission_id = p.id
       WHERE rhp.role_id = ?`,
      [newRoleId]
    ),
  ]);

  const role = roleResult.data?.[0] ?? { id: newRoleId };
  role.permissions = permResult.data ?? [];

  res.status(201).json({
    status: '201',
    message: 'Role created successfully',
    data: role,
  });
});

// ─────────────────────────────────────────────
// @desc    Update role — name, description, status, and permissions in one call
// @route   PUT /api/roles/:id
// @access  Admin
// ─────────────────────────────────────────────
const updateRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, guard_name, description, status } = req.body;
  const permission_ids = req.body.permission_ids ?? req.body.permissions;

  const validation = helper.checkForNullOrEmpty([{ name: 'Role ID', value: id }]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  const roleIdBig = helper.safeBigInt(id);
  if (!roleIdBig) {
    return res.status(400).json({ status: '400', message: 'Invalid Role ID' });
  }

  // Fetch existing role
  const roleResult = await helper.selectRecordsWithCondition('roles', { id: roleIdBig });
  if (roleResult.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'Role not found' });
  }

  const existingRole = roleResult.data[0];
  if (existingRole.is_system) {
    return res.status(403).json({ status: '403', message: 'Cannot update a system role' });
  }

  // ── 1. Update scalar fields ──────────────────────────────────────────────
  const updateData = {};
  if (name        !== undefined && name        !== null) updateData.name        = name;
  if (guard_name  !== undefined && guard_name  !== null) updateData.guard_name  = guard_name;
  if (description !== undefined)                         updateData.description = description;
  if (status      !== undefined && status      !== null) {
    if (status !== '0' && status !== '1') {
      return res.status(400).json({ status: '400', message: 'Status must be "0" (inactive) or "1" (active)' });
    }
    updateData.status = status;
  }

  if (Object.keys(updateData).length > 0) {
    const updateResult = await helper.dynamicUpdateWithId('roles', updateData, roleIdBig, 'id');
    if (updateResult.status === 'error') {
      return res.status(500).json({ status: '500', message: updateResult.message });
    }
  }

  // ── 2. Sync permissions if permission_ids was supplied ───────────────────
  if (Array.isArray(permission_ids)) {
    const currentPermsResult = await helper.selectRecordsWithQuery(
      `SELECT permission_id FROM role_has_permissions WHERE role_id = ?`,
      [id]
    );

    const currentIds = (currentPermsResult.data ?? []).map((r) => String(r.permission_id));
    // Accept permission names or IDs from the client and resolve to numeric IDs
    const incomingIds = await resolvePermissionIds(permission_ids);

    const toAssign = incomingIds.filter((pid) => !currentIds.includes(pid));
    const toRevoke = currentIds.filter((pid) => !incomingIds.includes(pid));

    await Promise.all([
      ...toAssign.map((permissionId) => {
        const permIdBig = helper.safeBigInt(permissionId);
        if (!permIdBig) return Promise.resolve(); // skip invalid
        return helper.dynamicInsert('role_has_permissions', {
          role_id: roleIdBig,
          permission_id: permIdBig,
        });
      }),
      ...toRevoke.map((permissionId) => {
        const permIdBig = helper.safeBigInt(permissionId);
        if (!permIdBig) return Promise.resolve(); // skip invalid
        return helper.deleteRecordsWithCondition('role_has_permissions', {
          role_id: roleIdBig,
          permission_id: permIdBig,
        });
      }),
    ]);
  }

  // ── 3. Return updated role with current permissions ──────────────────────
  const [updatedRoleResult, updatedPermResult] = await Promise.all([
    helper.selectRecordsWithCondition('roles', { id: roleIdBig }),
    helper.selectRecordsWithQuery(
      `SELECT p.id, p.name FROM permissions p
       INNER JOIN role_has_permissions rhp ON rhp.permission_id = p.id
       WHERE rhp.role_id = ?`,
      [id]
    ),
  ]);

  const updatedRole = updatedRoleResult.data?.[0] ?? { id };
  updatedRole.permissions = updatedPermResult.data ?? [];

  res.status(200).json({
    status: '200',
    message: 'Role updated successfully',
    data: updatedRole,
  });
});

// ─────────────────────────────────────────────
// @desc    Delete a role
// @route   DELETE /api/roles/:id
// @access  Super Admin
// ─────────────────────────────────────────────
const deleteRole = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const validation = helper.checkForNullOrEmpty([{ name: 'Role ID', value: id }]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  const roleIdBig = helper.safeBigInt(id);
  if (!roleIdBig) {
    return res.status(400).json({ status: '400', message: 'Invalid Role ID' });
  }

  const roleExists = await helper.selectRecordsWithCondition('roles', { id: roleIdBig });
  if (roleExists.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'Role not found' });
  }

  if (roleExists.data[0].is_system) {
    return res.status(403).json({ status: '403', message: 'Cannot delete a system role' });
  }

  // Remove all permission assignments for this role first
  await helper.deleteRecordsWithCondition('role_has_permissions', { role_id: roleIdBig });

  const result = await helper.deleteRecordsWithCondition('roles', { id: roleIdBig });
  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  res.status(200).json({ status: '200', message: 'Role deleted successfully' });
});

// ─────────────────────────────────────────────
// @desc    Activate or deactivate a role (kept for backwards compat)
// @route   PUT /api/roles/:id/status
// @access  Admin
// ─────────────────────────────────────────────
const updateRoleStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validation = helper.checkForNullOrEmpty([
    { name: 'Role ID', value: id },
    { name: 'Status', value: status },
  ]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  if (status !== '0' && status !== '1') {
    return res.status(400).json({ status: '400', message: 'Status must be 0 (inactive) or 1 (active)' });
  }

  // const roleIdBig = helper.safeBigInt(id);
  // if (!roleIdBig) {
  //   return res.status(400).json({ status: '400', message: 'Invalid User ID' });
  // }

  const roleExists = await helper.selectRecordsWithCondition('roles', { id: parseInt(id) });
  if (roleExists.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'Role not found' });
  }

  if (roleExists.data[0].is_system) {
    return res.status(403).json({ status: '403', message: 'Cannot change status of a system role' });
  }

  const result = await helper.dynamicUpdateWithId('roles', { status }, parseInt(id));
  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  const statusText = status === '1' ? 'activated' : 'deactivated';
  res.status(200).json({ status: '200', message: tmsg('role.status_changed', { status: statusText }), data: result.data });
});


module.exports = {
  assignRoleToUser,
  revokeRoleFromUser,
  assignPermissionToUser,
  revokePermissionFromUser,
  getAllRoles,
  getAllPermissions,
  getUserAccess,
  addRole,
  deleteRole,
  updateRole,
  updateRoleStatus,
};