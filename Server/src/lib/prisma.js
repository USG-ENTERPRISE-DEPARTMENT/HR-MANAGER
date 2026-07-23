const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const alreadyInitialised = !!globalForPrisma.prisma;

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['query', 'error', 'warn'],
});

// Auto-audit every model create/update/delete with field-level diffs (registered once).
if (!alreadyInitialised) {
  try {
    const { makeAuditMiddleware } = require('../helpers/auditMiddleware');
    prisma.$use(makeAuditMiddleware(prisma));
  } catch (e) {
    console.error('[prisma] failed to register audit middleware:', e.message);
  }
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = { prisma };