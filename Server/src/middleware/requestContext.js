// Per-request context via AsyncLocalStorage so deep layers (e.g. the Prisma audit middleware,
// which has no access to `req`) can know who is performing an action. The store holds a reference
// to the Express `req`; the acting user/ip are read lazily at write-time (after auth has populated
// req.user). The context propagates across awaits, including Prisma calls.
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

/** Express middleware: open an async context carrying the request for the whole lifecycle. */
function withRequest(req, _res, next) {
  als.run({ req }, () => next());
}

/** Best-effort actor info for audit rows. Safe to call anywhere. */
function currentActor() {
  const req = als.getStore()?.req;
  if (!req) return { userId: null, userName: null, ip: null };
  return {
    userId:   req.user?.id ?? null,
    userName: req.user?.username ?? req.user?.name ?? null,
    ip:       req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null,
  };
}

module.exports = { als, withRequest, currentActor };
