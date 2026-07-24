// Single authoritative way to answer "which employee record does this user account belong to?".
//
// This lookup was previously copy-pasted as a raw `SELECT employeeId, employee FROM users` in
// leaveController (twice) and as an email/username fallback in payslipController, so the web
// self-service screens could disagree about who the caller is. Both spellings of the column are
// still tolerated here because the schema carries `employeeId` while some rows/queries use
// `employee` — dropping either would silently unlink accounts.
const { prisma } = require('./dbQueryHelper');
const { toBigInt } = require('./controllerHelpers');

/**
 * Resolve the employee id linked to a user account.
 * @returns {Promise<string|null>} employee.id as a string, or null when the account has no link.
 */
async function resolveOwnEmployee(userId) {
  const id = toBigInt(userId);
  if (id == null) return null;

  const rows = await prisma.$queryRaw`
    SELECT employeeId, employee FROM users WHERE id = ${id} LIMIT 1`.catch(() => []);

  const link = rows[0]?.employeeId ?? rows[0]?.employee;
  return link ? String(link) : null;
}

/**
 * Reverse of the above: the user account linked to an employee record. The mobile API authenticates
 * by employee id, but the controllers it delegates to expect a `req.user` (for audit attribution and
 * approval-stage checks), so it needs to walk this direction.
 */
async function resolveUserForEmployee(employeeId) {
  const id = toBigInt(employeeId);
  if (id == null) return null;

  const rows = await prisma.$queryRaw`
    SELECT id, username, status FROM users WHERE employeeId = ${id} LIMIT 1`.catch(() => []);

  return rows[0] ?? null;
}

module.exports = { resolveOwnEmployee, resolveUserForEmployee };
