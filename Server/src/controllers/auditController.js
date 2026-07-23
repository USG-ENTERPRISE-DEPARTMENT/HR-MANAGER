const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { serialize } = require('../helpers/controllerHelpers');

function startOfDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayAfter(value) {
  const d = startOfDate(value);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ── Log helper (fire-and-forget, safe to call without await) ──────────────────
async function logActivity({ module, action, entityId = null, entityName = null, userId = null, userName = null, ip = null, details = null } = {}) {
  try {
    await prisma.auditlogs.create({
      data: {
        module: String(module),
        action: String(action),
        entity_id: entityId != null ? String(entityId) : null,
        entity_name: entityName != null ? String(entityName) : null,
        user_id: userId != null ? BigInt(userId) : null,
        user_name: userName != null ? String(userName) : null,
        ip_address: ip != null ? String(ip) : null,
        details: details != null ? JSON.stringify(details) : null,
      },
    });
  } catch (e) {
    console.error('[audit log]', e.message);
  }
}

// Convenience: extract user info from an Express req object
function fromReq(req) {
  return {
    userId:   req.user?.id   ?? null,
    userName: req.user?.username ?? null,
    ip:       req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null,
  };
}

// ── GET /audit-logs ───────────────────────────────────────────────────────────
const getAuditLogs = asyncHandler(async (req, res) => {
  const { module, user_id, date_from, date_to, search, page = '1', limit = '50' } = req.query;

  const AND = [];
  if (module) AND.push({ module: String(module) });
  if (user_id) AND.push({ user_id: BigInt(user_id) });
  if (date_from) AND.push({ created_at: { gte: startOfDate(String(date_from)) } });
  if (date_to) AND.push({ created_at: { lt: dayAfter(String(date_to)) } });
  if (search) {
    const contains = String(search);
    AND.push({
      OR: [
        { entity_name: { contains } },
        { user_name: { contains } },
        { action: { contains } },
        { module: { contains } },
      ],
    });
  }
  const where = AND.length ? { AND } : {};
  const pageNum  = Math.max(1, parseInt(page));
  const pageSize = Math.min(200, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * pageSize;

  const [total, rows] = await Promise.all([
    prisma.auditlogs.count({ where }),
    prisma.auditlogs.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: pageSize,
      skip,
      select: {
        id: true,
        module: true,
        action: true,
        entity_id: true,
        entity_name: true,
        user_id: true,
        user_name: true,
        ip_address: true,
        details: true,
        created_at: true,
      },
    }),
  ]);
  const logs = serialize(rows);

  respond.ok(res, 'Audit logs retrieved', { logs, total: Number(total), page: pageNum, limit: pageSize });
});

// ── Distinct modules list (for filter dropdown) ───────────────────────────────
const getAuditModules = asyncHandler(async (_req, res) => {
  const rows = await prisma.auditlogs.findMany({
    distinct: ['module'],
    orderBy: { module: 'asc' },
    select: { module: true },
  });
  respond.ok(res, 'Modules', rows.map(r => r.module));
});

module.exports = { logActivity, fromReq, getAuditLogs, getAuditModules };
