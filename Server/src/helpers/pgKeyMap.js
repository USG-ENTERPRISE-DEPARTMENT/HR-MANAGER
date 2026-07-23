// Postgres returns raw-query result columns in lower-case (it folds unquoted identifiers), whereas
// the schema's columns are @map'd to lower-case but the app reads the camelCase *field* names
// (e.g. `row.employeeId`, `row.firstName`). MySQL returns the camelCase names as written, so the
// app works there directly. To keep raw-query results identical across providers, we rename any
// lower-cased DB column key back to its camelCase Prisma field name.
//
// The map is derived from Prisma's DMMF (`field.dbName` = the @map target, `field.name` = the
// camelCase field), so it stays in sync with the schema automatically. On MySQL this is a no-op
// (keys already match the field names, so nothing is renamed).
const { Prisma } = require('@prisma/client');

// camelCase SQL aliases used in raw queries (e.g. `SELECT COALESCE(MAX(id),0)+1 AS nextId`). Postgres
// lower-cases these in the result set; the code reads the camelCase form. They are not Prisma fields so
// the DMMF map below can't cover them — list them explicitly. Keyed by the lower-cased form.
const ALIAS_SUPPLEMENT = {
  nextid: 'nextId',
  nextitemid: 'nextItemId',
  nextorder: 'nextOrder',
  totalenabled: 'totalEnabled',
  componenttypename: 'componentTypeName',
};

let _map = null;
function dbToField() {
  if (_map) return _map;
  _map = Object.create(null);
  Object.assign(_map, ALIAS_SUPPLEMENT);
  try {
    // Any column name that some model uses as a LITERAL field name (e.g. `name`, `status`,
    // `staff_id`) is a legitimate lower-case column — a raw query may select it directly, so it
    // must never be renamed. Collect those to exclude ambiguous/colliding mappings.
    const literalNames = new Set();
    for (const model of Prisma.dmmf.datamodel.models)
      for (const f of model.fields)
        if (f.kind === 'scalar') literalNames.add(f.name);

    for (const model of Prisma.dmmf.datamodel.models) {
      for (const f of model.fields) {
        // Map only scalar columns @map'd to a purely case-differing name (camelCase → lower),
        // and only when the lower-cased column isn't a real field name anywhere (avoids hijacking
        // generic columns like `name`/`status` that legacy PascalCase models @map).
        if (f.kind === 'scalar' && f.dbName && f.dbName.toLowerCase() !== f.name) {
          const db = f.dbName.toLowerCase();
          if (!literalNames.has(f.dbName) && !literalNames.has(db)) _map[db] = f.name;
        }
      }
    }
  } catch { /* dmmf unavailable — leave map empty (no renaming) */ }
  return _map;
}

// Return the camelCase field name for a (possibly lower-cased) result key, or the key unchanged.
function fieldFor(key) {
  const m = dbToField();
  return m[key] || m[String(key).toLowerCase()] || key;
}

module.exports = { fieldFor, dbToField };
