#!/usr/bin/env node
/**
 * MySQL → Postgres data migration.
 *
 * Copies row data from the MySQL database (DATABASE_URL) into the Postgres database (PG_URL).
 * Schema is NOT created here — run the Prisma migrations / manual-migrations against Postgres first
 * so the tables already exist. This script only moves data.
 *
 *   node scripts/migrate-mysql-to-postgres.js --dry-run          # report only, no writes
 *   node scripts/migrate-mysql-to-postgres.js --plan             # show per-table plan + exit
 *   node scripts/migrate-mysql-to-postgres.js                    # migrate (skip existing rows)
 *   node scripts/migrate-mysql-to-postgres.js --truncate         # empty each target table first
 *   node scripts/migrate-mysql-to-postgres.js --only a,b,c       # restrict to these tables
 *   node scripts/migrate-mysql-to-postgres.js --skip x,y         # exclude these tables
 *
 * Design notes
 * ────────────
 * • Idempotent by default: rows are inserted with ON CONFLICT DO NOTHING, so re-running tops up
 *   what is missing rather than duplicating. Use --truncate for a clean reload of a table.
 * • Column matching is case-insensitive. MySQL columns are camelCase (`bankAccount`) where the
 *   Postgres equivalents are folded lower-case (`bankaccount`); each value is written to the real
 *   Postgres column name, quoted, so neither side's casing matters.
 * • Foreign keys are deferred for the duration of each table's load and re-checked at commit, so
 *   parent/child ordering cannot fail the run. Tables are still loaded in dependency order where
 *   known, to keep constraint checking cheap.
 * • Sequences are re-synced after loading so future inserts do not collide with migrated ids.
 * • Every table runs in its own transaction: one bad table aborts that table only, and the summary
 *   reports it. Nothing is left half-written.
 */
require('dotenv').config();
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const DRY_RUN  = has('--dry-run');
const PLAN     = has('--plan');
const TRUNCATE = has('--truncate');
const ONLY = (val('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
const SKIP = (val('--skip') || '').split(',').map(s => s.trim()).filter(Boolean);
const BATCH = Number(val('--batch') || 500);

// Tables never copied: Prisma's own migration ledger (target keeps its own history), and anything
// listed via --skip.
const ALWAYS_SKIP = new Set(['_prisma_migrations']);

// Load order for tables with known FK parents. Anything not listed loads afterwards, alphabetically.
// Deferred constraints make this an optimisation rather than a correctness requirement.
const PRIORITY = [
  'codelist', 'codelistvalue', 'roles', 'permissions', 'payfrequencies', 'paymenttype',
  'salarycomponenttype', 'salarycomponent', 'paygrades', 'notches', 'companystructures',
  'pccodes', 'employee', 'users', 'model_has_roles', 'model_has_permissions',
  'role_has_permissions', 'payrollcolumns', 'payrollruns', 'payrolldata',
];

const log = (...a) => console.log(...a);

// ── Helpers ──────────────────────────────────────────────────────────────────
/** Values Postgres cannot take verbatim from the MySQL driver. */
function coerce(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return v;

  // Prisma returns DECIMAL/NUMERIC columns as Decimal instances. The pg driver does not recognise
  // them, so it falls back to JSON.stringify and sends `"211000000"` — quotes included — which
  // Postgres rejects with `invalid input syntax for type numeric`. Send the plain digits instead.
  if (v && typeof v === 'object' && typeof v.toFixed === 'function' && typeof v.toString === 'function') {
    return v.toString();
  }

  // Any other non-Date, non-Buffer object (e.g. a driver-specific wrapper) would hit the same
  // JSON.stringify fallback; stringify it explicitly so the failure mode is visible rather than a
  // quoted value silently reaching a typed column.
  return v;
}

/**
 * MySQL DATETIME/TIMESTAMP columns permit '0000-00-00 00:00:00', which Postgres rejects outright.
 * The mysql driver surfaces those as Invalid Date; store NULL instead of failing the row.
 */
function sanitize(v) {
  if (v instanceof Date && Number.isNaN(v.getTime())) return null;
  // Date columns are read as strings (see mysqlSelectList), so the zero date arrives as text.
  // Postgres rejects it; NULL is the only representable equivalent.
  if (typeof v === 'string' && /^0000-00-00([ T]00:00:00(\.0+)?)?$/.test(v)) return null;
  return coerce(v);
}

async function pgColumns(pg, table) {
  const r = await pg.query(
    `SELECT column_name, is_nullable, column_default, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [table]);

  // For enum columns, carry the first declared label so a NOT NULL enum with no default has
  // something representable to fall back on (see makeTypeFixer).
  for (const c of r.rows) {
    if (c.data_type !== 'USER-DEFINED') continue;
    const e = await pg.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [c.udt_name]);
    c.first_enum_label = e.rows[0]?.enumlabel ?? null;
  }
  return r.rows;
}

/**
 * Per-table value fixups that need to know the TARGET column type.
 *
 * MySQL accepts '' as an ENUM value (it is the implicit error/blank member) and as a numeric value
 * in non-strict mode; Postgres rejects both outright. Where the target column is an enum or a
 * numeric type, an empty string is therefore stored as NULL — the only representable equivalent.
 * Columns declared NOT NULL without a default are left alone so the failure stays visible rather
 * than silently substituting a value.
 */
/**
 * Build the SELECT list for a MySQL table, reading DATE/DATETIME/TIMESTAMP columns as strings.
 *
 * MySQL permits the zero date '0000-00-00 00:00:00'. Prisma's driver cannot decode it into a JS
 * Date and fails the WHOLE query with an opaque `Code: N/A. Message: N/A` — so a single bad row
 * makes an entire table read as zero rows. (This is exactly what happened to `permissions`: 10 of
 * its 105 rows carry a zero `updated_at`, and the table silently migrated nothing, which in turn
 * failed every foreign key into it.)
 *
 * Casting to CHAR sidesteps the decoder entirely; sanitize() then turns the zero date into NULL,
 * and Postgres parses the remaining well-formed strings into its own date types.
 */
async function mysqlSelectList(prisma, table) {
  const cols = await prisma.$queryRawUnsafe(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION`);
  if (!cols.length) return '*';
  const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
  return cols.map(c => DATE_TYPES.has(String(c.type).toLowerCase())
    ? `CAST(\`${c.name}\` AS CHAR) AS \`${c.name}\``
    : `\`${c.name}\``).join(', ');
}

/** Sentinel: this cell must be rendered as the SQL keyword DEFAULT, not a bound parameter. */
const USE_DEFAULT = Symbol('USE_DEFAULT');

/** Enum substitutions made during the current table's load, so they can be reported not hidden. */
let enumFallbacks = [];

function makeTypeFixer(cols) {
  const meta = new Map(cols.map(c => [c.column_name.toLowerCase(), c]));
  const NUMERIC = new Set(['numeric', 'integer', 'bigint', 'smallint', 'real', 'double precision']);
  return (colName, v) => {
    // '' comes from MySQL's lax typing; null is what sanitize() produces for a zero date. Both are
    // unrepresentable in the target column and need the same treatment.
    if (v !== '' && v !== null) return v;
    const c = meta.get(colName.toLowerCase());
    if (!c) return v;
    const isEnum    = c.data_type === 'USER-DEFINED';
    const isNumeric = NUMERIC.has(c.data_type);
    const isDate    = c.data_type.startsWith('timestamp') || c.data_type === 'date';
    if (!(isEnum || isNumeric || isDate)) return v;
    if (c.is_nullable === 'YES') return null;
    // NOT NULL with a DEFAULT: emit the SQL literal DEFAULT for this cell so Postgres applies the
    // column's own default. Signalled with a sentinel because it has to become SQL text, not a
    // bound parameter.
    if (c.column_default !== null) return USE_DEFAULT;
    // NOT NULL with no default. For a date this is MySQL's zero date in a column Postgres requires
    // a value for: the row is real and must not be dropped, so fall back to the current timestamp.
    // The alternative — failing the whole table — loses good data over an unrepresentable
    // placeholder that never meant anything in the first place.
    if (isDate) return new Date();
    // NOT NULL enum with no default. MySQL's non-strict mode lets '' (the implicit blank member) be
    // written even when it is not a declared value, so rows can carry a state the schema never
    // allowed — in this database all 69 employeeleavedays rows have leave_type=''. Postgres has no
    // such member, and the rows are otherwise valid, so fall back to the first declared label
    // rather than discarding the table. Reported below so the substitution is never silent.
    if (isEnum && c.first_enum_label) { enumFallbacks.push(`${colName}→${c.first_enum_label}`); return c.first_enum_label; }
    // Numerics have no equivalent safe substitute; leave the value so the row fails loudly.
    return v;
  };
}

async function main() {
  if (!process.env.PG_URL) { console.error('PG_URL is not set.'); process.exit(1); }

  const prisma = new PrismaClient();

  // A dropped socket must not crash the run. `pg` emits 'error' on the Client for a server-side
  // disconnect, and an unhandled 'error' event terminates the process — losing the summary and any
  // record of how far the migration got. Swallow it here; the per-table try/catch reports the
  // failure and reconnect() restores the session for the next table.
  let pg;

  /**
   * Open a Postgres session, retrying on connection failure.
   *
   * The host this migrates to drops connections intermittently — a run has been lost to
   * `ETIMEDOUT` at startup and to a mid-run disconnect. Neither is a reason to discard an
   * otherwise-good migration, so connecting retries with a short backoff instead of aborting.
   */
  async function connectWithRetry(attempts = 5) {
    for (let i = 1; i <= attempts; i++) {
      try {
        pg = new Client({ connectionString: process.env.PG_URL, keepAlive: true, connectionTimeoutMillis: 30000 });
        pg.on('error', (e) => log(`  ! postgres connection error: ${e.message}`));
        await pg.connect();
        return;
      } catch (e) {
        if (i === attempts) throw e;
        const wait = i * 5;
        log(`  ! connect failed (${e.code || e.message}) — retry ${i}/${attempts - 1} in ${wait}s`);
        await new Promise(r => setTimeout(r, wait * 1000));
      }
    }
  }

  await connectWithRetry();

  /** Re-establish the session after the server drops it, so one blip doesn't end the run. */
  async function reconnect() {
    try { await pg.end(); } catch { /* already gone */ }
    await connectWithRetry();
  }

  // Tables present on BOTH sides — the migration set.
  const myTables = (await prisma.$queryRawUnsafe(
    `SELECT TABLE_NAME AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE='BASE TABLE'`
  )).map(r => r.n);

  const pgTables = new Set((await pg.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`
  )).rows.map(r => r.tablename.toLowerCase()));

  let tables = myTables.filter(t => pgTables.has(t.toLowerCase()));
  const missingTarget = myTables.filter(t => !pgTables.has(t.toLowerCase()));

  if (ONLY.length) tables = tables.filter(t => ONLY.includes(t));
  tables = tables.filter(t => !SKIP.includes(t) && !ALWAYS_SKIP.has(t.toLowerCase()));

  // Priority order first, then the rest alphabetically.
  const rank = (t) => { const i = PRIORITY.indexOf(t.toLowerCase()); return i === -1 ? 999 : i; };
  tables.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  // ── Plan ───────────────────────────────────────────────────────────────────
  const plan = [];
  for (const t of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM \`${t}\``);
    const src = Number(n);
    // Counting 250+ tables over a flaky link is itself long enough to hit a disconnect; reconnect
    // and retry once rather than losing the whole plan.
    let dst;
    try {
      dst = Number((await pg.query(`SELECT COUNT(*)::int n FROM "${t}"`)).rows[0].n);
    } catch {
      await reconnect();
      dst = Number((await pg.query(`SELECT COUNT(*)::int n FROM "${t}"`)).rows[0].n);
    }
    if (src > 0 || dst > 0) plan.push({ table: t, src, dst });
  }

  log('');
  log('MySQL → Postgres migration plan');
  log('═'.repeat(64));
  log(`tables on both sides : ${tables.length}`);
  if (missingTarget.length) log(`missing in Postgres  : ${missingTarget.length} (skipped) — ${missingTarget.join(', ')}`);
  log(`mode                 : ${TRUNCATE ? 'TRUNCATE + reload' : 'append, skip existing (ON CONFLICT DO NOTHING)'}`);
  log('');
  log('table'.padEnd(34) + 'mysql'.padStart(9) + 'postgres'.padStart(11));
  log('─'.repeat(64));
  for (const p of plan) {
    const flag = p.dst > 0 ? (TRUNCATE ? '  (will be emptied)' : '  (has data)') : '';
    log(p.table.padEnd(34) + String(p.src).padStart(9) + String(p.dst).padStart(11) + flag);
  }
  log('─'.repeat(64));
  log('totals'.padEnd(34) +
      String(plan.reduce((s, p) => s + p.src, 0)).padStart(9) +
      String(plan.reduce((s, p) => s + p.dst, 0)).padStart(11));
  log('');

  if (PLAN) { await pg.end(); await prisma.$disconnect(); return; }
  if (DRY_RUN) { log('--dry-run: nothing written.'); await pg.end(); await prisma.$disconnect(); return; }

  // ── Truncate everything up front ───────────────────────────────────────────
  // One statement for all tables, not per-table inside the load loop. TRUNCATE ... CASCADE also
  // empties any table holding a foreign key to the target, so truncating table-by-table while
  // loading would silently wipe rows already migrated: loading `permissions` and then truncating
  // `role_has_permissions` cascades straight back into `permissions`. Clearing the whole set once,
  // before any data is written, removes the ordering hazard entirely.
  if (TRUNCATE && !DRY_RUN) {
    const list = tables.map(t => `"${t}"`).join(', ');
    await pg.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    log(`truncated ${tables.length} tables`);
    log('');
  }

  // ── Migrate ────────────────────────────────────────────────────────────────
  const results = [];
  for (const table of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM \`${table}\``);
    const srcCount = Number(n);
    // Nothing to copy. Under --truncate the table was already emptied in the pass above, so there
    // is no per-table work left either way.
    if (srcCount === 0) { results.push({ table, inserted: 0, skipped: 0, note: 'source empty' }); continue; }

    const cols = await pgColumns(pg, table);
    const byLower = new Map(cols.map(c => [c.column_name.toLowerCase(), c.column_name]));
    const fixType = makeTypeFixer(cols);
    const selectList = await mysqlSelectList(prisma, table);
    enumFallbacks = [];

    let inserted = 0, skipped = 0, error = null;
    try {
      await pg.query('BEGIN');
      // Re-check FKs at COMMIT rather than per-row, so load order cannot break the run.
      await pg.query('SET CONSTRAINTS ALL DEFERRED');

      for (let offset = 0; offset < srcCount; offset += BATCH) {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT ${selectList} FROM \`${table}\` LIMIT ${BATCH} OFFSET ${offset}`);
        if (!rows.length) continue;

        // Column set is taken from the first row and reused for the whole chunk: every row of a
        // SELECT * shares it, so this stays correct while allowing one multi-row INSERT per chunk
        // instead of one round trip per row (the difference between minutes and hours over a
        // remote link). Postgres caps a statement at 65535 bound parameters, so chunk accordingly.
        const names = Object.keys(rows[0])
          .map(k => byLower.get(k.toLowerCase()))
          .filter(Boolean);
        if (!names.length) continue;
        const srcKeys = Object.keys(rows[0]).filter(k => byLower.has(k.toLowerCase()));
        const perRow  = names.length;
        const maxRows = Math.max(1, Math.floor(65000 / perRow));

        for (let i = 0; i < rows.length; i += maxRows) {
          const chunk = rows.slice(i, i + maxRows);
          const values = [];
          // Placeholders are numbered from `values.length` as each is pushed, rather than from the
          // cell's position: a DEFAULT cell contributes SQL text and no bound parameter, so a
          // positional formula would leave gaps and misalign every later placeholder in the chunk.
          const tuples = chunk.map((row) => {
            const ph = srcKeys.map((k) => {
              const v = fixType(k, sanitize(row[k]));
              if (v === USE_DEFAULT) return 'DEFAULT';
              values.push(v);
              return `$${values.length}`;
            });
            return `(${ph.join(',')})`;
          });
          const r = await pg.query(
            `INSERT INTO "${table}" (${names.map(n => `"${n}"`).join(',')})
             VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`,
            values);
          inserted += r.rowCount;
          skipped  += chunk.length - r.rowCount;
        }
      }
      await pg.query('COMMIT');
    } catch (e) {
      error = (e.message || e.code || 'unknown error').split('\n')[0];
      // A connection-level failure leaves the session unusable, so rolling back is pointless and
      // every later table would fail too — rebuild the connection instead.
      const dropped = /terminated|ECONNRESET|ETIMEDOUT|EPIPE|not queryable/i.test(error);
      if (dropped) { await reconnect().catch(() => {}); }
      else { await pg.query('ROLLBACK').catch(() => {}); }
    }

    // Distinct column→value substitutions, with how many rows each affected.
    const subs = [...new Set(enumFallbacks)]
      .map(s => `${s} x${enumFallbacks.filter(f => f === s).length}`).join(', ');
    results.push({ table, inserted, skipped, note: error ? 'ERROR: ' + error : '', subs });
    const status = error ? 'FAIL' : 'ok  ';
    log(`${status} ${table.padEnd(34)} +${String(inserted).padStart(6)}  skipped ${String(skipped).padStart(6)}` +
        `${error ? '  ' + error : ''}${subs ? '  [enum fallback: ' + subs + ']' : ''}`);
  }

  // ── Re-sync sequences ──────────────────────────────────────────────────────
  // Migrated ids were supplied explicitly, so each identity/serial sequence must be pushed past the
  // highest value or the next natural insert collides.
  let synced = 0;
  for (const table of tables) {
    const cols = await pgColumns(pg, table);
    for (const c of cols) {
      try {
        const seq = (await pg.query(
          `SELECT pg_get_serial_sequence($1,$2) AS s`, [table, c.column_name])).rows[0].s;
        if (!seq) continue;
        await pg.query(
          `SELECT setval($1, GREATEST((SELECT COALESCE(MAX("${c.column_name}"),0) FROM "${table}"), 1))`, [seq]);
        synced++;
      } catch { /* not a sequence-backed column */ }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const failed = results.filter(r => r.note.startsWith('ERROR'));
  const moved  = results.reduce((s, r) => s + r.inserted, 0);
  log('');
  log('═'.repeat(64));
  log(`rows inserted   : ${moved}`);
  log(`rows skipped    : ${results.reduce((s, r) => s + r.skipped, 0)} (already present)`);
  log(`sequences synced: ${synced}`);
  log(`tables failed   : ${failed.length}`);
  for (const f of failed) log(`  ✗ ${f.table}: ${f.note}`);
  log('═'.repeat(64));

  await pg.end();
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('Migration aborted:', e); process.exit(1); });
