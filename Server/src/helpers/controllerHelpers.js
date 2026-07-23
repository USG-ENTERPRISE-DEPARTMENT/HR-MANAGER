const { prisma } = require('./dbQueryHelper');
const { fieldFor } = require('./pgKeyMap'); // normalise lower-cased Postgres result keys → camelCase field names

// Recursively convert BigInt / Date / Prisma Decimal to JSON-safe primitives.
// Handles three Decimal shapes:
//   • Prisma.Decimal class instance (constructor.name === 'Decimal')
//   • Decimal.js plain-object { s, e, d } produced by JSON round-trip
//   • Legacy toFixed-duck-typed objects (older Prisma builds)
function serialize(obj) {
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date)     return obj.toISOString();
  if (Array.isArray(obj))      return obj.map(serialize);
  if (obj !== null && typeof obj === 'object') {
    if (obj.constructor?.name === 'Decimal') return parseFloat(obj.toString());
    if (
      typeof obj.s === 'number' &&
      typeof obj.e === 'number' &&
      Array.isArray(obj.d) && obj.d.length > 0
    ) {
      // decimal.js shape: value = sign × 0.<digit groups> × 10^(e+1)
      // (first group unpadded, subsequent groups zero-padded to 7 digits)
      const digits = obj.d.map((g, i) => i === 0 ? String(g) : String(g).padStart(7, '0')).join('');
      const num    = (obj.s < 0 ? -1 : 1) * parseFloat(`0.${digits}`) * Math.pow(10, obj.e + 1);
      return isNaN(num) ? null : num;
    }
    if (typeof obj.toFixed === 'function') return parseFloat(obj.toString());
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[fieldFor(k)] = serialize(v);
    return out;
  }
  return obj;
}

// Short alias used throughout most controllers
const s = serialize;

// Convert any value to BigInt; returns null on failure or falsy input (except 0)
function toBigInt(val) {
  if (!val && val !== 0) return null;
  try { return BigInt(val); } catch { return null; }
}

// Convert a value bound for a DATE/DATETIME/TIMESTAMP column to a JS Date (or null). MySQL silently
// coerces a 'YYYY-MM-DD' string, but Postgres rejects a text param on a date/timestamp column — so raw
// SQL that binds dates must pass a Date. Used as query`... ${toDate(req.body.some_date)} ...`.
function toDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// Inline an ENUM value as a SQL string literal (Postgres auto-casts a string literal to its enum type;
// a bound text param does NOT). `value` is validated against `allowed` (falling back to `fallback`), so
// inlining it is injection-safe. Returns a Prisma.sql fragment for use inside a tagged query.
const { Prisma } = require('@prisma/client');
function enumSql(value, allowed, fallback) {
  const v = allowed.includes(value) ? value : fallback;
  return Prisma.raw(`'${String(v).replace(/'/g, "''")}'`);
}

// Run an ALTER TABLE / CREATE TABLE statement quietly — ignores duplicate-column and similar
// schema-patch errors. Intentionally uses $executeRawUnsafe: this is DDL (a dynamic runtime
// string, not parameterizable), so it can't be a tagged template. The statements are MySQL-dialect
// (AUTO_INCREMENT, ADD INDEX, backtick-free but MySQL types); on Postgres the schema is created by
// `prisma db push` / migrations, so these patches are redundant AND their MySQL syntax errors would
// spam the logs — skip them entirely when the active provider isn't MySQL.
async function safeAlter(sql) {
  if (prisma?._activeProvider && prisma._activeProvider !== 'mysql') return;
  try { await prisma.$executeRawUnsafe(sql); } catch {}
}

module.exports = { serialize, s, toBigInt, toDate, enumSql, safeAlter };
