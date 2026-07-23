// Shared helper for the `settings` key/value table. That table has NO unique(name, category)
// constraint and NO id default, so Prisma `upsert` can't be used — this emulates it with an
// update-in-place then conditional insert (manually generating the BigInt id, preserving the
// original scheme). `client` may be the prisma singleton or a $transaction handle so callers can
// batch several keys atomically; pass null/undefined to use the shared client.
const { prisma } = require('./dbQueryHelper');

const genSettingsId = () => BigInt(Date.now() + Math.floor(Math.random() * 9999));

async function upsertSetting(client, name, category, value) {
  const db = client || prisma;
  const { count } = await db.settings.updateMany({ where: { name, category }, data: { value } });
  if (count === 0) await db.settings.create({ data: { id: genSettingsId(), name, value, category } });
}

module.exports = { genSettingsId, upsertSetting };
