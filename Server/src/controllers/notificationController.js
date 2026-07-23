const { prisma }   = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond      = require('../helpers/respondHelper');

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
  const userId = BigInt(req.user.id);
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
  const userId = BigInt(req.user.id);
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
  const userId = BigInt(req.user.id);
  await prisma.notifications.updateMany({
    where: { toUser: userId, status: 'Unread' },
    data:  { status: 'Read' },
  });
  return respond.ok(res, 'All marked read');
});

// DELETE /notifications/:id — remove one of the caller's notifications.
const remove = asyncHandler(async (req, res) => {
  const userId = BigInt(req.user.id);
  let id;
  try { id = BigInt(req.params.id); } catch { return respond.badReq(res, 'Invalid id'); }
  await prisma.notifications.deleteMany({ where: { id, toUser: userId } });
  return respond.ok(res, 'Notification cleared');
});

// DELETE /notifications — clear all of the caller's notifications.
const clearAll = asyncHandler(async (req, res) => {
  const userId = BigInt(req.user.id);
  await prisma.notifications.deleteMany({ where: { toUser: userId } });
  return respond.ok(res, 'Notifications cleared');
});

module.exports = { list, markRead, markAllRead, remove, clearAll };
