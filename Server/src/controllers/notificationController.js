const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');

// Notifications are addressed to a USER account (`toUser`). Mobile (/me/*) callers authenticate by
// employee id and may have no account at all, in which case req.user.id is null — and BigInt(null)
// throws a TypeError, turning every notification call into a 500. Resolve to null instead so those
// endpoints degrade to "nothing addressed to you" rather than failing.
const callerUserId = (req) => {
  const raw = req.user?.id;
  if (raw == null || raw === '') return null;
  try { return BigInt(raw); } catch { return null; }
};

// Serialize BigInt-containing rows for JSON.
function clean(rows) {
  return rows.map(r => ({
    id:      String(r.id),
    message: r.message,
    action:  r.action,
    type:    r.type,
    status:  r.status,
    time:    r.time,
  }));
}

// GET /notifications — newest 50 for the current user + unread count.
const list = asyncHandler(async (req, res) => {
  const userId = callerUserId(req);
  if (userId == null) return respond.ok(res, 'Notifications', { items: [], unreadCount: 0 });
  const rows = await prisma.notifications.findMany({
    where:   { toUser: userId },
    orderBy: { id: 'desc' },
    take:    50,
  });
  const unreadCount = await prisma.notifications.count({
    where: { toUser: userId, status: 'Unread' },
  });
  return respond.ok(res, 'Notifications', { items: clean(rows), unreadCount });
});

// PUT /notifications/:id/read — mark one as read (only if it belongs to the caller).
const markRead = asyncHandler(async (req, res) => {
  const userId = callerUserId(req);
  if (userId == null) return respond.ok(res, 'Marked read');
  let id;
  try { id = BigInt(req.params.id); } catch { return respond.badReq(res, 'Invalid id'); }
  await prisma.notifications.updateMany({
    where: { id, toUser: userId },
    data:  { status: 'Read' },
  });
  return respond.ok(res, 'Marked read');
});

// PUT /notifications/read-all — mark all the caller's notifications as read.
const markAllRead = asyncHandler(async (req, res) => {
  const userId = callerUserId(req);
  if (userId == null) return respond.ok(res, 'All marked read');
  await prisma.notifications.updateMany({
    where: { toUser: userId, status: 'Unread' },
    data:  { status: 'Read' },
  });
  return respond.ok(res, 'All marked read');
});

// DELETE /notifications/:id — remove one of the caller's notifications.
const remove = asyncHandler(async (req, res) => {
  const userId = callerUserId(req);
  if (userId == null) return respond.ok(res, 'Notification cleared');
  let id;
  try { id = BigInt(req.params.id); } catch { return respond.badReq(res, 'Invalid id'); }
  await prisma.notifications.deleteMany({ where: { id, toUser: userId } });
  return respond.ok(res, 'Notification cleared');
});

// DELETE /notifications — clear all of the caller's notifications.
const clearAll = asyncHandler(async (req, res) => {
  const userId = callerUserId(req);
  if (userId == null) return respond.ok(res, 'Notifications cleared');
  await prisma.notifications.deleteMany({ where: { toUser: userId } });
  return respond.ok(res, 'Notifications cleared');
});

module.exports = { list, markRead, markAllRead, remove, clearAll };
