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

// ── System currency ──────────────────────────────────────────────────────────
// Every employee is paid in the same currency, so there is exactly ONE source of truth: the
// `general_currency` control setting (Settings -> General). It is read here rather than from
// `payrollemployees.currency`, which was per-employee free text and drifted out of step with the
// system -- rows held "Cedis" and "GHS" while the system ran on Leones, and those values were sent
// to the bank as the journal currency on real postings.
//
// The setting has been stored two ways over time: the picker now saves a bare ISO code ("SLL"), but
// older installs hold a label ("Leones (SLL)"). Accept both and always return the bare code, since
// that is what the GL expects.
const CURRENCY_FALLBACK = "SLL";

/** Pull the ISO code out of either "SLL" or "Leones (SLL)". Returns null when nothing usable. */
function currencyCodeFrom(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const parenthesised = raw.match(/\(([A-Za-z]{3})\)\s*$/);   // "Leones (SLL)" -> SLL
  if (parenthesised) return parenthesised[1].toUpperCase();
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();     // already a bare code
  return null;                                                 // "Cedis", "" and other free text
}

/**
 * The currency every payroll/GL amount is denominated in.
 *
 * Falls back to the GL config and then SLL, so a posting never carries an empty currency. Callers
 * should treat this as authoritative and must not read a per-employee currency.
 */
async function getSystemCurrency(glExtraCurrency) {
  const row = await prisma.settings
    .findFirst({ where: { name: "general_currency", category: "app_controls" }, select: { value: true } })
    .catch(() => null);
  return currencyCodeFrom(row && row.value)
      || currencyCodeFrom(glExtraCurrency)
      || CURRENCY_FALLBACK;
}

module.exports = { genSettingsId, upsertSetting, getSystemCurrency, currencyCodeFrom };
