#!/usr/bin/env node
/**
 * Create (or recreate) the migration rehearsal database.
 *
 * The rehearsal database is the throwaway target the legacy migration writes into, so it can be
 * loaded, inspected and thrown away without touching anything real. This script gets it to the
 * point where `POST /migration/execute` can run against it:
 *
 *   1. CREATE DATABASE on the same server as MIGRATION_REHEARSAL_URL (or PG_URL)
 *   2. push the Postgres Prisma schema into it, so every table exists
 *   3. apply the *.postgres.sql manual migrations, which the schema does not cover
 *
 *   node scripts/create-rehearsal-db.js                 # create if missing, then set up
 *   node scripts/create-rehearsal-db.js --drop          # DESTROY and recreate from scratch
 *   node scripts/create-rehearsal-db.js --schema-only   # skip creation, just (re)apply the schema
 *   node scripts/create-rehearsal-db.js --dry-run       # report what it would do
 *
 * Deliberate design points
 * ────────────────────────
 * • `prisma db push` rather than `migrate deploy`: the rehearsal database is disposable and needs
 *   no migration history, and push creates the whole schema in one step from the same file the
 *   application uses, so it cannot drift from it.
 * • --drop refuses to run against anything that is not the configured rehearsal database. Dropping
 *   is irreversible and the live and rehearsal URLs differ only by database name, so the guard is
 *   proportionate: a typo in .env must not be able to destroy production.
 * • Manual migrations are applied in filename order, which is their date prefix. Each is wrapped in
 *   its own transaction and an "already exists" error is treated as satisfied, so re-running is
 *   safe.
 */
require('dotenv').config();
const { Client } = require('pg');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const DROP        = has('--drop');
const SCHEMA_ONLY = has('--schema-only');
const DRY_RUN     = has('--dry-run');

const SCHEMA_FILE   = path.join(__dirname, '..', 'src', 'prisma', 'schema.postgres.prisma');
const MANUAL_DIR    = path.join(__dirname, '..', 'src', 'prisma', 'manual-migrations');

/** Split a connection string into {adminUrl, database}: the admin URL points at `postgres`. */
function splitUrl(url) {
  const u = new URL(url);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('No database name in the connection string');
  const admin = new URL(url);
  admin.pathname = '/postgres';
  return { adminUrl: admin.toString(), database, host: u.hostname, port: u.port || '5432' };
}

/**
 * Connect with retries.
 *
 * The remote Postgres this project uses drops and refuses connections intermittently; without
 * retries a transient blip reads as a hard failure and the operator re-runs by hand.
 */
async function connect(connectionString, attempts = 10) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    const c = new Client({ connectionString, connectionTimeoutMillis: 20000, query_timeout: 600000 });
    c.on('error', () => {});
    try { await c.connect(); return c; }
    catch (e) {
      last = e;
      try { await c.end(); } catch {}
      if (i < attempts) {
        process.stdout.write(`   connection attempt ${i} failed (${e.message.split('\n')[0]}), retrying…\n`);
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  }
  throw last;
}

(async () => {
  const url = process.env.MIGRATION_REHEARSAL_URL || process.env.PG_URL;
  if (!url) {
    console.error('No MIGRATION_REHEARSAL_URL (or PG_URL) is set. Add one to .env and try again.');
    process.exit(1);
  }

  const { adminUrl, database, host, port } = splitUrl(url);
  const safe = url.replace(/:[^:@/]*@/, ':***@');

  console.log('Rehearsal database');
  console.log('   target : ' + safe);
  console.log('   server : ' + host + ':' + port);
  console.log('   name   : ' + database);
  if (DRY_RUN) console.log('   MODE   : dry run, nothing will be changed');
  console.log('');

  // A --drop against the live database would be unrecoverable, and the two URLs differ only by
  // name, so refuse unless this really is the configured rehearsal target.
  if (DROP && process.env.MIGRATION_REHEARSAL_URL && url !== process.env.MIGRATION_REHEARSAL_URL) {
    console.error('REFUSING --drop: the resolved URL is not MIGRATION_REHEARSAL_URL.');
    process.exit(1);
  }
  if (DROP && process.env.PG_URL && url === process.env.PG_URL) {
    console.error('REFUSING --drop: MIGRATION_REHEARSAL_URL is the same as PG_URL — that is the live database.');
    console.error('Set MIGRATION_REHEARSAL_URL to a separate database first.');
    process.exit(1);
  }

  if (!SCHEMA_ONLY) {
    const admin = await connect(adminUrl);
    const exists = async () =>
      (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rowCount > 0;

    if (DROP && await exists()) {
      if (DRY_RUN) {
        console.log('would DROP DATABASE "' + database + '"');
      } else {
        console.log('dropping "' + database + '" …');
        // Existing sessions block a drop; close them first so this does not fail on an open psql.
        await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`, [database]).catch(() => {});
        await admin.query(`DROP DATABASE "${database}"`);
        console.log('   dropped.');
      }
    }

    if (await exists() && !DROP) {
      console.log('"' + database + '" already exists — leaving it in place.');
      console.log('   (use --drop to destroy and recreate it)');
    } else if (!DRY_RUN) {
      console.log('creating "' + database + '" …');
      await admin.query(`CREATE DATABASE "${database}"`);
      console.log('   created.');
    } else {
      console.log('would CREATE DATABASE "' + database + '"');
    }
    await admin.end();
    console.log('');
  }

  if (DRY_RUN) {
    console.log('would run: prisma db push --schema ' + path.relative(process.cwd(), SCHEMA_FILE));
    const sqls = fs.existsSync(MANUAL_DIR)
      ? fs.readdirSync(MANUAL_DIR).filter(f => f.endsWith('.postgres.sql')).sort()
      : [];
    console.log('would apply ' + sqls.length + ' manual migration(s)');
    return;
  }

  // ── Schema ─────────────────────────────────────────────────────────────────
  //
  // db push reads the URL from the schema's datasource, which is `env("PG_URL")`, so PG_URL is
  // overridden for this child process only — nothing else in the session is repointed. Prisma also
  // loads .env itself, but an already-set environment variable wins over the file, so the override
  // holds.
  //
  // The push creates the whole schema in one statement-heavy pass and takes around three minutes
  // against this remote server. The timeout is deliberately generous: execFileSync's default would
  // kill a run that was succeeding, which is exactly what it did the first time.
  console.log('pushing the Postgres schema … (around three minutes against a remote server)');
  try {
    // Prisma's CLI is invoked through its own entry script rather than the `npx` wrapper: on
    // Windows, spawning the `.cmd` shim without a shell fails outright with EINVAL.
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'),
       'db', 'push', '--schema', SCHEMA_FILE, '--skip-generate', '--accept-data-loss'],
      {
        stdio: 'inherit',
        env: { ...process.env, PG_URL: url },
        cwd: path.join(__dirname, '..'),
        timeout: 20 * 60 * 1000,
      });
  } catch (e) {
    console.error('\nprisma db push failed — the database exists but has no tables yet.');
    console.error(e.message.split('\n')[0]);
    process.exit(1);
  }
  console.log('');

  // ── Manual migrations ──────────────────────────────────────────────────────
  // Applied in filename order (their date prefix). These carry changes the schema file does not:
  // enum values, extra indexes, and columns added by hand after the schema was generated.
  const files = fs.existsSync(MANUAL_DIR)
    ? fs.readdirSync(MANUAL_DIR).filter(f => f.endsWith('.postgres.sql')).sort()
    : [];
  if (!files.length) {
    console.log('no manual migrations to apply.');
  } else {
    console.log('applying ' + files.length + ' manual migration(s) …');
    const c = await connect(url);
    let applied = 0, already = 0, failed = 0;
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MANUAL_DIR, f), 'utf8');
      try {
        await c.query('BEGIN');
        await c.query(sql);
        await c.query('COMMIT');
        applied++;
        console.log('   applied  ' + f);
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        // Two kinds of "failure" are really success on a FRESH database:
        //
        //   • the object already exists — db push created what the file adds; and
        //   • a data-conversion script whose guard short-circuited. codelist_cuid_to_int converts
        //     existing cuid keys to int, but the schema already creates them as int, so its guard
        //     returns early and its later statements reference a scratch table it never built.
        //     Nothing is wrong: there was no legacy data to convert.
        if (/already exists|duplicate/i.test(err.message)) {
          already++;
          console.log('   present  ' + f);
        } else if (/relation "_[a-z]+map" does not exist/i.test(err.message)) {
          already++;
          console.log('   n/a      ' + f + ' (nothing to convert on a fresh database)');
        } else {
          failed++;
          console.log('   FAILED   ' + f + ' — ' + err.message.split('\n')[0]);
        }
      }
    }
    await c.end();
    console.log('');
    console.log('   ' + applied + ' applied, ' + already + ' already present, ' + failed + ' failed');
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const c = await connect(url);
  const t = await c.query(
    `SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_schema = 'public'`);
  await c.end();

  console.log('');
  console.log('Done. "' + database + '" has ' + t.rows[0].n + ' tables and is ready for a migration run.');
  console.log('Next: open Settings → System → Migration and run against the Rehearsal target.');
})().catch((e) => {
  console.error('\nFailed: ' + e.message);
  process.exit(1);
});
