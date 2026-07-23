const crypto = require('crypto');
const helper = require('../helpers/dbQueryHelper');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { tmsg } = require('../helpers/messageStore');
const { sendWelcomeEmail } = require('../helpers/emailHelper');
const { logActivity, fromReq } = require('./auditController');

/**
 * Is this user named in a given approval flow setting? True when a `user` stage targets their id, or a
 * `role` stage targets one of their role names (matched by label or id). Used to surface Central Approval
 * to stage approvers who lack a blanket `approve_*` permission. Never throws — a missing/invalid config
 * just means "not a stage approver".
 */
async function isNamedInFlow(settingName, userId, roleNames) {
  try {
    const res = await helper.selectRecordsWithQuery(
      `SELECT value FROM settings WHERE name = ? AND category = 'app_controls' LIMIT 1`,
      [settingName],
    );
    const raw = res?.data?.[0]?.value;
    if (!raw) return false;
    const stages = JSON.parse(raw);
    if (!Array.isArray(stages)) return false;
    const roles = new Set((roleNames || []).map(String));
    return stages.some(s => {
      if (!s) return false;
      if (s.approverType === 'user') return String(s.approverId) === String(userId);
      if (s.approverType === 'role') return roles.has(String(s.approverLabel)) || roles.has(String(s.approverId));
      return false;
    });
  } catch { return false; }
}

/** A stage approver in any configured workflow can reach Central Approval. */
async function isStageApproverAnyModule(userId, roleNames) {
  const [payroll, medical, leave, transfer] = await Promise.all([
    isNamedInFlow('payroll_approval_flow', userId, roleNames),
    isNamedInFlow('medical_approval_flow', userId, roleNames),
    isNamedInFlow('leave_approval_flow',   userId, roleNames),
    isNamedInFlow('employee_approval_flow', userId, roleNames),
    isNamedInFlow('employee_transfer_approval_flow', userId, roleNames),
  ]);
  return payroll || medical || leave || transfer;
}



// ─────────────────────────────────────────────
// @desc    Register a new user
// @route   POST /register
// @access  Private (Admin only)
// ─────────────────────────────────────────────
const registerUser = asyncHandler(async (req, res) => {
  const {
    employeeId,               // required — CUID of the existing employee record
    username,
    firstname, middlename, lastname, phone, email,
    status = '1', posted_by = 0,
    roles = [], permissions = [],
  } = req.body;

  // employeeId and username are required
  const validation = helper.checkForNullOrEmpty([
    { name: 'Employee',  value: employeeId },
    { name: 'Username',  value: username },
  ]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  // At least one role must be provided
  if (!Array.isArray(roles) || roles.length === 0) {
    return res.status(400).json({ status: '400', message: 'At least one role is required' });
  }

  // Verify the employee exists
  const empCheck = await helper.selectRecordsWithQuery(
    `SELECT id FROM employee WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  if (!empCheck.data?.length) {
    return res.status(404).json({ status: '404', message: 'Employee not found' });
  }

  // Ensure no account already exists for this employee
  const dupCheck = await helper.selectRecordsWithQuery(
    `SELECT id FROM users WHERE employeeId = ? LIMIT 1`,
    [employeeId]
  );
  if (dupCheck.data?.length) {
    return res.status(409).json({ status: '409', message: 'A user account already exists for this employee' });
  }

  // Validate role IDs
  const rolePlaceholders = roles.map(() => '?').join(',');
  const rolesCheck = await helper.selectRecordsWithQuery(
    `SELECT id FROM roles WHERE id IN (${rolePlaceholders})`,
    roles
  );
  if (!rolesCheck.data || rolesCheck.data.length !== roles.length) {
    return res.status(400).json({ status: '400', message: 'One or more role IDs are invalid' });
  }

  // Validate permission IDs (if any)
  if (permissions.length > 0) {
    const permPlaceholders = permissions.map(() => '?').join(',');
    const permsCheck = await helper.selectRecordsWithQuery(
      `SELECT id FROM permissions WHERE id IN (${permPlaceholders})`,
      permissions
    );
    if (!permsCheck.data || permsCheck.data.length !== permissions.length) {
      return res.status(400).json({ status: '400', message: 'One or more permission IDs are invalid' });
    }
  }

  // Optionally update employee profile fields if provided
  const empUpdate = {};
  if (firstname)     empUpdate.firstName     = firstname;
  if (middlename)    empUpdate.middleName     = middlename;
  if (lastname)      empUpdate.lastName       = lastname;
  if (phone)         empUpdate.phone          = phone;
  if (email)         empUpdate.email          = email;

  if (Object.keys(empUpdate).length > 0) {
    await helper.dynamicUpdateWithId('employee', empUpdate, employeeId);
  }

  // Fetch employee email for welcome email
  const empData = await helper.selectRecordsWithQuery(
    `SELECT CONCAT_WS(' ', firstName, lastName) AS name, work_email, email FROM employee WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const emp = empData.data?.[0] ?? {};
  const recipientEmail = emp.work_email || emp.email;

  // Generate random password
  const plainPassword  = crypto.randomBytes(8).toString('hex');
  const salt           = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(plainPassword, salt);

  // Create the users record (only valid columns)
  const result = await helper.dynamicInsert('users', {
    employeeId,
    username:   username || email,
    password:   hashedPassword,
    posted_by,
    status,
  });
  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  const newUserId = result.data.id;

  // Assign roles
  for (const roleId of roles) {
    await helper.selectRecordsWithQuery(
      `INSERT INTO model_has_roles (role_id, model_id, model_type) VALUES (?, ?, 'users')`,
      [roleId, String(newUserId)]
    );
  }

  // Assign direct permissions
  for (const permissionId of permissions) {
    await helper.selectRecordsWithQuery(
      `INSERT INTO model_has_permissions (permission_id, model_id, model_type) VALUES (?, ?, 'users')`,
      [permissionId, String(newUserId)]
    );
  }

  // Send welcome email (non-blocking — don't fail registration if email fails)
  if (recipientEmail) {
    sendWelcomeEmail({
      to:       recipientEmail,
      name:     emp.name || username,
      username: username || email,
      password: plainPassword,
    }).catch((err) => console.error('Welcome email failed:', err.message));
  }

  // Return the new user with employee profile
  const newUser = await helper.selectRecordsWithQuery(`
    SELECT u.id, u.status, u.username, u.employeeId,
           e.email, e.firstName, e.lastName, e.middleName, e.phone
    FROM users u
    JOIN employee e ON e.id = u.employeeId
    WHERE u.id = ?
    LIMIT 1
  `, [newUserId]);

  const userData = newUser.data?.[0] ?? {};
  logActivity({ module: 'Users', action: 'create', entityId: String(newUserId), entityName: userData.username || username, ...fromReq(req) });
  res.status(201).json({ status: '201', message: 'User registered successfully', data: userData });
});


// ─────────────────────────────────────────────
// @desc    Login user
// @route   POST /login
// @access  Public
// ─────────────────────────────────────────────
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validate fields
  const validation = helper.checkForNullOrEmpty([
    { name: 'Email or username', value: email },
    { name: 'Password',          value: password },
  ]);
  if (validation.status === 'error') {
    return res.status(400).json({ status: '400', message: validation.message });
  }

  // Find user by username OR employee email (LEFT JOIN so username-only accounts still match)
  const userResult = await helper.selectRecordsWithQuery(`
    SELECT u.id, u.username, u.password, u.status, u.employeeId, u.theme,
           e.email, e.firstName, e.lastName, e.phone
    FROM users u
    LEFT JOIN employee e ON e.id = u.employeeId
    WHERE u.username = ? OR e.email = ? OR e.work_email = ?
    LIMIT 1
  `, [email, email, email]);
  if (userResult.status === 'error' || !userResult.data?.length) {
    return res.status(401).json({ status: '401', message: 'Invalid email or password' });
  }

  const user = userResult.data[0];

  // Check if account is active
  if (user.status !== '1') {
    return res.status(403).json({ status: '403', message: 'Account is deactivated. Contact administrator.' });
  }

  // Compare password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ status: '401', message: 'Invalid email or password' });
  }

  // ── Fetch roles ────────────────────────────────────────
  // Only ACTIVE roles grant access — a deactivated role contributes no permissions until reactivated.
  const rolesResult = await helper.selectRecordsWithQuery(`
    SELECT r.id, r.name
    FROM roles r
    INNER JOIN model_has_roles mhr ON mhr.role_id = r.id
    WHERE mhr.model_id = ? AND mhr.model_type = 'users' AND r.status = '1'
    ORDER BY r.name ASC
  `, [String(user.id)]);

  const roles = rolesResult.data ?? [];

  // ── Fetch permissions from roles ───────────────────────
  let permissionsFromRoles = [];
  if (roles.length > 0) {
    const placeholders = roles.map(() => '?').join(',');
    const rolePermsResult = await helper.selectRecordsWithQuery(`
      SELECT DISTINCT p.id, p.name
      FROM permissions p
      INNER JOIN role_has_permissions rhp ON rhp.permission_id = p.id
      WHERE rhp.role_id IN (${placeholders})
      ORDER BY p.name ASC
    `, roles.map(r => r.id));

    permissionsFromRoles = rolePermsResult.data ?? [];
  }

  // ── Fetch direct permissions assigned to user ──────────
  const directPermsResult = await helper.selectRecordsWithQuery(`
    SELECT DISTINCT p.id, p.name
    FROM permissions p
    INNER JOIN model_has_permissions mhp ON mhp.permission_id = p.id
    WHERE mhp.model_id = ? AND mhp.model_type = 'users'
    ORDER BY p.name ASC
  `, [String(user.id)]);

  const directPermissions = directPermsResult.data ?? [];

  // ── Merge and deduplicate all permissions ──────────────
  const permissionMap = new Map();
  [...permissionsFromRoles, ...directPermissions].forEach(p => {
    permissionMap.set(p.id.toString(), p.name);
  });
  const allPermissions = Array.from(permissionMap.values()).sort();

  // ── Generate tokens ────────────────────────────────────
  const accessToken = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { id: user.id, email: user.email },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );

  // ── Store refresh token in DB ──────────────────────────
  const refreshTokenExpiry = new Date();
  refreshTokenExpiry.setDate(refreshTokenExpiry.getDate() + 7);

  await helper.dynamicInsert('refresh_tokens', {
    user_id:    user.id,
    token:      refreshToken,
    expires_at: refreshTokenExpiry,
    revoked:    false,
  });

  // ── Send refresh token as httpOnly cookie ──────────────
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });

  const { password: _, ...userWithoutPassword } = user;

  // ── Stage-approver flag ─────────────────────────────────
  // A user named in a configured approval flow (by user id, or one of their role names) can reach
  // Central Approval even without a blanket `approve_*` permission — stage assignment grants access.
  const isStageApprover = await isStageApproverAnyModule(String(user.id), roles.map(r => r.name));

  res.status(200).json({
    status:  '200',
    message: 'Login successful',
    accessToken,
    data: {
      ...userWithoutPassword,
      userType:    userWithoutPassword.employeeId ? 'employee' : 'admin',
      roles:       roles.map(r => r.name),
      permissions: allPermissions,
      isStageApprover,
    },
  });
});


// ─────────────────────────────────────────────
// @desc    Logout user — revoke refresh token
// @route   POST /logout
// @access  Private
// ─────────────────────────────────────────────
const logoutUser = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    // Revoke the token in the DB
    const tokenResult = await helper.selectRecordsWithCondition('refresh_tokens', {
      token: refreshToken,
    });

    if (tokenResult.status === 'success' && tokenResult.data.length > 0) {
      await helper.dynamicUpdateWithId(
        'refresh_tokens',
        { revoked: true },
        tokenResult.data[0].id
      );
    }
  }

  // Clear the cookie regardless
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  res.status(200).json({ status: '200', message: 'Logged out successfully' });
});


// ─────────────────────────────────────────────
// @desc    Purge stale refresh tokens — called by cron.
//          Deletes rows that are expired, OR revoked and older than a short grace window (so reuse
//          detection still has a brief audit trail). Every refresh rotates in a new row and revokes the
//          old one, so without this the table grows unbounded.
// ─────────────────────────────────────────────
const purgeStaleRefreshTokens = async () => {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days
  const result = await helper.prisma.refresh_tokens.deleteMany({
    where: {
      OR: [
        { expires_at: { lt: now } },
        { AND: [{ revoked: true }, { created_at: { lt: graceCutoff } }] },
      ],
    },
  });
  return result.count;
};


// ─────────────────────────────────────────────
// @desc    Get all users (with their roles)
// @route   GET /
// @access  Private (Admin only)
// ─────────────────────────────────────────────
const getAllUsers = asyncHandler(async (req, res) => {
  // Portable across MySQL/Postgres: fetch flat rows and aggregate roles/permissions in JS
  // (avoids MySQL-only GROUP_CONCAT). Response shape is preserved exactly — `roles` and
  // `direct_permissions` are JSON-array STRINGS of sorted, distinct names, e.g. '["admin","hr"]'.
  const result = await helper.selectRecordsWithQuery(`
    SELECT u.id, u.username, u.employeeId, u.status, u.posted_by,
           e.firstName, e.lastName, e.middleName,
           CONCAT_WS(' ', e.firstName, e.lastName) AS name,
           e.phone, e.email
    FROM users u
    JOIN employee e ON e.id = u.employeeId
    WHERE u.status IN ('1', '0')
  `);

  if (result.status === 'error') {
    console.error('Database error:', result.message);
    return res.status(404).json({ status: '404', message: 'No users found', data: [] });
  }

  const [rolesRes, permsRes] = await Promise.all([
    helper.selectRecordsWithQuery(`
      SELECT mhr.model_id AS user_id, r.name
      FROM model_has_roles mhr JOIN roles r ON r.id = mhr.role_id
      WHERE mhr.model_type = 'users'`),
    helper.selectRecordsWithQuery(`
      SELECT mhp.model_id AS user_id, p.name
      FROM model_has_permissions mhp JOIN permissions p ON p.id = mhp.permission_id
      WHERE mhp.model_type = 'users'`),
  ]);

  // user_id → sorted, distinct name[] → JSON-array string (matches the old GROUP_CONCAT output)
  const jsonByUser = (rows) => {
    const m = {};
    for (const r of rows || []) (m[String(r.user_id)] ??= new Set()).add(r.name);
    const out = {};
    for (const [uid, set] of Object.entries(m)) out[uid] = JSON.stringify([...set].sort());
    return out;
  };
  const rolesByUser = jsonByUser(rolesRes.data);
  const permsByUser = jsonByUser(permsRes.data);

  const data = result.data.map(u => ({
    ...u,
    roles:              rolesByUser[String(u.id)] ?? '[]',
    direct_permissions: permsByUser[String(u.id)] ?? '[]',
  }));

  res.status(200).json({
    status:  '200',
    message: 'Users retrieved successfully',
    count:   data.length,
    data,
  });
});


// ─────────────────────────────────────────────
// @desc    Get single user by ID 
//          → includes roles + permissions per role
//          → includes direct permissions assigned to user
// @route   GET /:id
// @access  Private
// ─────────────────────────────────────────────
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Portable across MySQL/Postgres: fetch flat rows and assemble roles/permissions in JS
  // (avoids MySQL-only GROUP_CONCAT + hand-rolled JSON). Response shape is preserved exactly:
  //   roles = [{ name, id, permissions: [sorted names] }]  (sorted by role name)
  //   direct_permissions = [sorted permission names]
  const result = await helper.selectRecordsWithQuery(`
    SELECT u.id, u.username, u.employeeId, u.status, u.posted_by,
           e.firstName, e.middleName, e.lastName,
           CONCAT_WS(' ', e.firstName, e.lastName) AS name,
           e.phone, e.email
    FROM users u
    JOIN employee e ON e.id = u.employeeId
    WHERE u.id = ?
  `, [Number(id)]);

  if (result.status === 'error' || !result.data?.length) {
    return res.status(404).json({ status: '404', message: 'User not found' });
  }

  const user = result.data[0];

  // Roles for this user, each with the permissions granted via that role.
  const [roleRows, rolePermRows, directRows] = await Promise.all([
    helper.selectRecordsWithQuery(`
      SELECT r.id AS role_id, r.name AS role_name
      FROM model_has_roles mhr JOIN roles r ON r.id = mhr.role_id
      WHERE mhr.model_id = ? AND mhr.model_type = 'users'`, [String(id)]),
    helper.selectRecordsWithQuery(`
      SELECT rhp.role_id AS role_id, p.name
      FROM role_has_permissions rhp JOIN permissions p ON p.id = rhp.permission_id
      JOIN model_has_roles mhr ON mhr.role_id = rhp.role_id
      WHERE mhr.model_id = ? AND mhr.model_type = 'users'`, [String(id)]),
    helper.selectRecordsWithQuery(`
      SELECT p.name
      FROM model_has_permissions mhp JOIN permissions p ON p.id = mhp.permission_id
      WHERE mhp.model_id = ? AND mhp.model_type = 'users'`, [String(id)]),
  ]);

  const permsByRole = {};
  for (const r of rolePermRows.data || []) (permsByRole[String(r.role_id)] ??= new Set()).add(r.name);

  // Distinct roles, sorted by name; each with sorted distinct permission names.
  const seenRole = new Set();
  const roles = (roleRows.data || [])
    .filter(r => !seenRole.has(String(r.role_id)) && seenRole.add(String(r.role_id)))
    .sort((a, b) => String(a.role_name).localeCompare(String(b.role_name)))
    .map(r => ({
      name: r.role_name,
      id: r.role_id,
      permissions: [...(permsByRole[String(r.role_id)] ?? new Set())].sort(),
    }));

  const directPermissions = [...new Set((directRows.data || []).map(p => p.name))].sort();

  res.status(200).json({
    status: '200',
    message: 'User retrieved successfully',
    data: {
      ...user,
      roles,
      direct_permissions: directPermissions
    }
  });
});


// ─────────────────────────────────────────────
// @desc    Update user
// @route   PUT /:id
// @access  Private
// ─────────────────────────────────────────────
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    firstname,
    middlename,
    lastname,
    phone,
    email,
    status,
    roles,
    permissions,
    posted_by,
    username,
  } = req.body;

  // ───────────────────────────
  // Check user exists (get employeeId for subsequent employee update)
  // ───────────────────────────
  const existing = await helper.selectRecordsWithCondition('users', { id });
  if (existing.status === 'error' || existing.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'User not found' });
  }
  const { employeeId } = existing.data[0];

  // ───────────────────────────
  // Check email/phone conflict on employee table
  // ───────────────────────────
  if (email || phone) {
    const conflict = await helper.selectRecordsWithQuery(
      `SELECT id FROM employee WHERE (email = ? OR phone = ?) AND id != ?`,
      [email ?? '', phone ?? '', employeeId]
    );
    if (conflict.data && conflict.data.length > 0) {
      return res.status(409).json({ status: '409', message: 'Email or phone already in use by another employee' });
    }
  }

  // ───────────────────────────
  // Update employee profile fields
  // ───────────────────────────
  const employeeData = {};
  if (firstname)     employeeData.firstName     = firstname;
  if (middlename)    employeeData.middleName     = middlename;
  if (lastname)      employeeData.lastName       = lastname;
  if (phone)         employeeData.phone          = phone;
  if (email)         employeeData.email          = email;

  if (Object.keys(employeeData).length > 0) {
    const empResult = await helper.dynamicUpdateWithId('employee', employeeData, employeeId);
    if (empResult.status === 'error') {
      return res.status(500).json({ status: '500', message: empResult.message });
    }
  }

  // ───────────────────────────
  // Update users-only fields (status, username, posted_by)
  // ───────────────────────────
  const userData = {};
  if (status !== undefined && status !== null) userData.status    = status;
  if (username)                                userData.username  = username;
  if (posted_by)                               userData.posted_by = posted_by;

  if (Object.keys(userData).length > 0) {
    const result = await helper.dynamicUpdateWithId('users', userData, id);
    if (result.status === 'error') {
      return res.status(500).json({ status: '500', message: result.message });
    }
  }

  // ───────────────────────────
  // 🔥 SYNC ROLES
  // ───────────────────────────
  if (Array.isArray(roles)) {

    // Validate roles exist
    if (roles.length > 0) {
      const placeholders = roles.map(() => '?').join(',');
      const roleCheck = await helper.selectRecordsWithQuery(
        `SELECT id FROM roles WHERE id IN (${placeholders})`,
        roles
      );

      if (!roleCheck.data || roleCheck.data.length !== roles.length) {
        return res.status(400).json({
          status: '400',
          message: 'One or more role IDs are invalid'
        });
      }
    }

    // Remove existing roles
    await helper.selectRecordsWithQuery(
      `DELETE FROM model_has_roles WHERE model_id = ? AND model_type = 'users'`,
      [id]
    );

    // Insert new roles
    for (const roleId of roles) {
      await helper.selectRecordsWithQuery(
        `INSERT INTO model_has_roles (role_id, model_id, model_type) VALUES (?, ?, 'users')`,
        [Number(roleId), String(id)]
      );
    }
  }

  // ───────────────────────────
  // 🔥 SYNC DIRECT PERMISSIONS
  // ───────────────────────────
  if (Array.isArray(permissions)) {

    if (permissions.length > 0) {
      const placeholders = permissions.map(() => '?').join(',');
      const permCheck = await helper.selectRecordsWithQuery(
        `SELECT id FROM permissions WHERE id IN (${placeholders})`,
        permissions
      );

      if (!permCheck.data || permCheck.data.length !== permissions.length) {
        return res.status(400).json({
          status: '400',
          message: 'One or more permission IDs are invalid'
        });
      }
    }

    // Remove existing direct permissions
    await helper.selectRecordsWithQuery(
      `DELETE FROM model_has_permissions WHERE model_id = ? AND model_type = 'users'`,
      [id]
    );

    // Insert new permissions
    for (const permissionId of permissions) {
      await helper.selectRecordsWithQuery(
        `INSERT INTO model_has_permissions (permission_id, model_id, model_type) VALUES (?, ?, 'users')`,
        [Number(permissionId), String(id)]
      );
    }
  }

  // ───────────────────────────
  // Return updated user
  // ───────────────────────────
  const updatedUser = await helper.selectRecordsWithQuery(`
    SELECT u.id, u.status, u.username, u.employeeId,
           e.email, e.firstName, e.lastName, e.middleName, e.phone
    FROM users u
    JOIN employee e ON e.id = u.employeeId
    WHERE u.id = ?
    LIMIT 1
  `, [id]);

  if (!updatedUser.data?.length) {
    return res.status(404).json({ status: '404', message: 'User not found after update' });
  }

  res.status(200).json({
    status:  '200',
    message: 'User updated successfully',
    data:    updatedUser.data[0],
  });
});


// ─────────────────────────────────────────────
// @desc    Change password
// @route   PUT /:id/change-password
// @access  Private
// ─────────────────────────────────────────────
const changePassword = asyncHandler(async (req, res) => {
  const id = req.params.id ?? req.user?.id;
  const { currentPassword, newPassword } = req.body;

  const isSelf = String(id) === String(req.user.id);
  const isAdmin = req.user.roles.includes('super-admin') || req.user.roles.includes('admin') || req.user.permissions.includes('change_user_password');

  if (isSelf) {
    const validation = helper.checkForNullOrEmpty([
      { name: 'Current Password', value: currentPassword },
      { name: 'New Password',     value: newPassword },
    ]);
    if (validation.status === 'error') {
      return res.status(400).json({ status: '400', message: validation.message });
    }
    // Prevent reusing the same password
    if (currentPassword === newPassword) {
      return res.status(400).json({ status: '400', message: 'New password must be different from current password' });
    }
  } else {
    // Admin resetting someone else's password
    if (!isAdmin) {
      return res.status(403).json({ status: '403', message: 'Unauthorized to change this user\'s password' });
    }
    const validation = helper.checkForNullOrEmpty([
      { name: 'New Password',     value: newPassword },
    ]);
    if (validation.status === 'error') {
      return res.status(400).json({ status: '400', message: validation.message });
    }
  }

  // Get user with password
  const userResult = await helper.selectRecordsWithCondition('users', { id: id });
  if (userResult.status === 'error' || userResult.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'User not found' });
  }

  const user = userResult.data[0];

  if (isSelf) {
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ status: '401', message: 'Current password is incorrect' });
    }
  }

  // Hash and save new password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  const result = await helper.dynamicUpdateWithId('users', { password: hashedPassword }, id);
  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  // Revoke all existing refresh tokens so user must log in again
  await helper.prisma.refresh_tokens.updateMany({
    where:  { user_id: id, revoked: false },
    data:   { revoked: true },
  });

  res.status(200).json({ status: '200', message: 'Password changed successfully. Please log in again.' });
});


// ─────────────────────────────────────────────
// @desc    Deactivate user (soft delete)
// @route   PUT /:id/deactivate
// @access  Private (Admin only)
// ─────────────────────────────────────────────
const deactivateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await helper.selectRecordsWithCondition('users', { id: id });
  if (existing.status === 'error' || existing.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'User not found' });
  }

  if (existing.data[0].status === '0') {
    return res.status(409).json({ status: '409', message: 'User is already deactivated' });
  }

  const result = await helper.dynamicUpdateWithId('users', { status: '0' }, id);
  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  // Revoke all refresh tokens for this user
  await helper.prisma.refresh_tokens.updateMany({
    where: { user_id: id, revoked: false },
    data:  { revoked: true },
  });

  logActivity({ module: 'Users', action: 'deactivate', entityId: String(id), entityName: existing.data[0].username, ...fromReq(req) });
  res.status(200).json({ status: '200', message: 'User deactivated successfully' });
});


// ─────────────────────────────────────────────
// @desc    Reactivate user
// @route   PUT /:id/activate
// @access  Private (Admin only)
// ─────────────────────────────────────────────
const activateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await helper.selectRecordsWithCondition('users', { id: id });
  if (existing.status === 'error' || existing.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'User not found' });
  }

  if (existing.data[0].status === '1') {
    return res.status(409).json({ status: '409', message: 'User is already active' });
  }

  const result = await helper.dynamicUpdateWithId('users', { status: '1' }, id);
  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  logActivity({ module: 'Users', action: 'activate', entityId: String(id), entityName: existing.data[0].username, ...fromReq(req) });
  res.status(200).json({ status: '200', message: 'User activated successfully' });
});



// ─────────────────────────────────────────────
// @desc    Activate or deactivate a role (kept for backwards compat)
// @route   PUT /api/roles/:id/status
// @access  Admin
// ─────────────────────────────────────────────
const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validation = helper.checkForNullOrEmpty([
    { name: 'User ID', value: id },
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

  const userExists = await helper.selectRecordsWithCondition('users', { id: id });
  if (userExists.data.length === 0) {
    return res.status(404).json({ status: '404', message: 'User not found' });
  }

  if (userExists.data[0].is_system) {
    return res.status(403).json({ status: '403', message: 'Cannot change status of a system user' });
  }

  const result = await helper.dynamicUpdateWithId('users', { status }, id);
  if (result.status === 'error') {
    return res.status(500).json({ status: '500', message: result.message });
  }

  const statusText = status === '1' ? 'activated' : 'deactivated';
  res.status(200).json({ status: '200', message: tmsg('user.status_changed', { status: statusText }), data: result.data });
});


// ─────────────────────────────────────────────
// @desc    Get the currently authenticated user
//          with their linked entity (employee / guardian / student)
// @route   GET /me
// @access  Private
// ─────────────────────────────────────────────
const EMPLOYEE_PROFILE_INCLUDE = {
  jobTitle:       { select: { id: true, label: true, code: true } },
  department:     { select: { id: true, label: true, code: true } },
  employmentType: { select: { id: true, label: true, code: true } },
  nationality:    { select: { id: true, label: true, code: true } },
  religion:       { select: { id: true, label: true, code: true } },
  emergencyContacts: {
    orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
  },
  teacher: {
    select: {
      id: true,
      staffNumber: true,
      teachersubject: {
        select: {
          id: true,
          subject:    { select: { id: true, name: true, code: true } },
          gradelevel: { select: { id: true, name: true } },
        },
      },
      gradelevel: { select: { id: true, name: true } },
    },
  },
  statusHistory: {
    orderBy: { changedAt: 'desc' },
    take: 20,
  },
};

const getMe = asyncHandler(async (req, res) => {
  const { id } = req.user;

  const user = await helper.prisma.users.findUnique({ where: { id: BigInt(id) } });
  if (!user) return respond.notFound(res, 'User not found');

  // `users.employee`/`employeeId` are scalar FK ids (no Prisma relation), and the employee profile
  // lookups (jobTitle, department, …) aren't relations either — resolve them manually via the same
  // CodeListValue / companystructures lookups the employee endpoints use. Portable on MySQL + PG.
  const empFk = user.employeeId ?? user.employee ?? null;
  let employee = null;
  if (empFk != null) {
    const e = await helper.prisma.employee.findUnique({ where: { id: BigInt(empFk) } });
    if (e) {
      // CodeListValue-backed lookups (integer ids) → { id, label, code, value }
      const clvIds = [e.titleId, e.genderId, e.nationalityId, e.religionId, e.jobTitleId, e.employmentStatusId].filter(Boolean);
      const clvMap = {};
      if (clvIds.length) {
        const vals = await helper.prisma.codeListValue.findMany({
          where: { id: { in: clvIds } }, select: { id: true, label: true, code: true },
        });
        vals.forEach(v => { clvMap[v.id] = { ...v, value: v.label }; });
      }
      // companystructures-backed lookups (bigint ids) → { id, label, code, value }
      const structIds = [e.departmentId, e.branchId, e.unitId, e.outletId].filter(v => v != null);
      const structMap = {};
      if (structIds.length) {
        const structs = await helper.prisma.companystructures.findMany({
          where: { id: { in: structIds } }, select: { id: true, title: true, comp_code: true },
        });
        structs.forEach(s => { structMap[s.id.toString()] = { id: s.id.toString(), label: s.title, value: s.title, code: s.comp_code }; });
      }
      const clv    = fk => fk ? (clvMap[fk] ?? null) : null;
      const struct = fk => (fk != null) ? (structMap[fk.toString()] ?? null) : null;
      employee = {
        ...e,
        title:            clv(e.titleId),
        gender:           clv(e.genderId),
        jobTitle:         clv(e.jobTitleId),
        employmentType:   clv(e.employmentStatusId),
        nationality:      clv(e.nationalityId),
        religion:         clv(e.religionId),
        department:       struct(e.departmentId),
        branch:           struct(e.branchId),
      };
    }
  }

  const userType = employee ? 'employee' : 'admin';
  const { password: _, ...safe } = user;
  return respond.ok(res, 'OK', { ...safe, employee, userType });
});


// ─────────────────────────────────────────────
// @desc    Persist the current user's UI theme preference (dark | light)
// @route   PUT /user/theme
// @access  Private
// ─────────────────────────────────────────────
const updateUserTheme = asyncHandler(async (req, res) => {
  const { theme } = req.body;
  if (!['dark', 'light'].includes(theme)) {
    return res.status(400).json({ status: '400', message: 'Invalid theme' });
  }
  await helper.prisma.users.updateMany({ where: { id: helper.safeBigInt(req.user.id) }, data: { theme } });
  return respond.ok(res, 'Theme saved');
});


module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  purgeStaleRefreshTokens,
  getAllUsers,
  getUserById,
  updateUser,
  changePassword,
  deactivateUser,
  activateUser,
  updateUserStatus,
  getMe,
  updateUserTheme,
};
