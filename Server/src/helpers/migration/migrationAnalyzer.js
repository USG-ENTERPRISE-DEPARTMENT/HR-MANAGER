// ─────────────────────────────────────────────────────────────────────────────
// Migration dry run — reports what WOULD happen, writing nothing.
//
// Every function here is read-only against both databases. That is the point: the operator runs
// this until the exception list is acceptable, and only then runs the loader. The loader will
// consume the same plan (migrationPlan.js), so the dry run cannot describe a different migration
// from the one that executes.
//
// Connects to the legacy source with mysql2 directly rather than through Prisma: the source
// schema is not in any Prisma schema file, and never should be — it is a foreign database being
// read, not part of this application.
// ─────────────────────────────────────────────────────────────────────────────
const mysql = require('mysql2/promise');
const { prisma } = require('../dbQueryHelper');
const plan = require('./migrationPlan');

/** Open a read-only connection to the legacy database. */
async function connectSource(cfg = {}) {
  const conn = await mysql.createConnection({
    host:     cfg.host     ?? process.env.MIGRATION_SOURCE_HOST     ?? 'localhost',
    port:     Number(cfg.port ?? process.env.MIGRATION_SOURCE_PORT  ?? 3306),
    user:     cfg.user     ?? process.env.MIGRATION_SOURCE_USER     ?? 'root',
    password: cfg.password ?? process.env.MIGRATION_SOURCE_PASSWORD ?? '',
    database: cfg.database ?? process.env.MIGRATION_SOURCE_DB       ?? 'hrmdata_rcb',
    // Large tables are read with streaming elsewhere; keep the default row cap sane here.
    supportBigNumbers: true,
    bigNumberStrings:  true,
  });
  return conn;
}

const one = async (conn, sql, params = []) => (await conn.query(sql, params))[0][0];
const all = async (conn, sql, params = []) => (await conn.query(sql, params))[0];

/**
 * Preflight: can we reach the source, does it look like the expected database, how big is it.
 */
async function preflight(cfg = {}) {
  const started = Date.now();
  let conn;
  try {
    conn = await connectSource(cfg);
    const db = cfg.database ?? process.env.MIGRATION_SOURCE_DB ?? 'hrmdata_rcb';

    const tables = await all(conn,
      `SELECT table_name AS t, table_rows AS r FROM information_schema.tables
        WHERE table_schema = ? ORDER BY table_name`, [db]);

    const expected = ['employees', 'payroll', 'payrolldata', 'payrollcolumns', 'staffmedical'];
    const present  = new Set(tables.map(t => String(t.t).toLowerCase()));
    const missing  = expected.filter(t => !present.has(t));

    const size = await one(conn,
      `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 1) AS mb
         FROM information_schema.tables WHERE table_schema = ?`, [db]);

    const scratch = tables.filter(t => plan.isScratchTable(t.t));

    return {
      ok: missing.length === 0,
      database: db,
      reachable: true,
      sizeMb: Number(size?.mb ?? 0),
      tableCount: tables.length,
      missingExpectedTables: missing,
      scratchTableCount: scratch.length,
      scratchTables: scratch.map(t => ({ name: t.t, rows: Number(t.r || 0) })),
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, reachable: false, error: err.message, elapsedMs: Date.now() - started };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/**
 * Employee analysis: duplicates, unresolvable lookups, and what would actually import.
 */
async function analyseEmployees(conn) {
  const total = (await one(conn, 'SELECT COUNT(*) AS n FROM employees')).n;

  // Rows that cannot be keyed. employee_id is the only natural key the target has.
  const noKey = (await one(conn,
    `SELECT COUNT(*) AS n FROM employees WHERE employee_id IS NULL OR TRIM(employee_id) = ''`)).n;

  const dupCodes = await all(conn,
    `SELECT employee_id AS code, COUNT(*) AS n FROM employees
      WHERE employee_id IS NOT NULL AND TRIM(employee_id) <> ''
      GROUP BY employee_id HAVING n > 1`);

  // ── Data-quality signals: REPORTED, never acted on ──────────────────────
  // Identity is employee_id alone (see migrationPlan.employeeKey), all 1,280 are unique, and
  // nothing is collapsed or dropped. Every employee imports.
  //
  // These two lists are FYI for HR, not duplicate detection. Both signals were tested against the
  // data and found unreliable for deciding identity:
  //   - Shared names collide constantly in this workforce (MOHAMED KAMARA, IBRAHIM KAMARA...),
  //     and one UTB record matched two different people who each had 1,500+ payroll rows.
  //   - A shared NASSIT number looks official but is not conclusive either: P2022037/UTB00523
  //     share one and were initially taken for the same person, which turned out to be wrong.
  // So they are surfaced for a human to judge, and drive no automatic behaviour whatsoever.
  const sharedNassit = await all(conn, `
    SELECT e.nassit_num AS num,
           GROUP_CONCAT(e.employee_id ORDER BY e.employee_id)  AS codes,
           GROUP_CONCAT(CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,''))
                        ORDER BY e.employee_id SEPARATOR ' | ') AS names,
           COUNT(*) AS n,
           SUM(CASE WHEN TRIM(REPLACE(e.status,'''','')) = 'Active' THEN 1 ELSE 0 END) AS active
      FROM employees e
     WHERE e.nassit_num IS NOT NULL AND TRIM(e.nassit_num) <> ''
     GROUP BY e.nassit_num HAVING n > 1
     ORDER BY active DESC, n DESC`);

  const sharedName = await all(conn, `
    SELECT CONCAT(COALESCE(a.first_name,''),' ',COALESCE(a.last_name,'')) AS nm,
           COUNT(*) AS pairs
      FROM employees a
      JOIN employees b
        ON a.first_name = b.first_name AND a.last_name = b.last_name AND a.id < b.id
     GROUP BY nm ORDER BY pairs DESC`);

  // ── Employees carrying no data at all ──────────────────────────────────
  const noData = await all(conn, `
    SELECT id, employee_id, CONCAT(COALESCE(first_name,''),' ',COALESCE(last_name,'')) AS nm, status
      FROM employees e
     WHERE NOT EXISTS (SELECT 1 FROM payrolldata    WHERE employee = e.id)
       AND NOT EXISTS (SELECT 1 FROM employeesalary WHERE employee = e.id)
       AND NOT EXISTS (SELECT 1 FROM staffmedical   WHERE employee = e.id)`);

  // ── Gender ─────────────────────────────────────────────────────────────
  const genders = await all(conn,
    `SELECT gender AS v, COUNT(*) AS n FROM employees
      WHERE gender IS NOT NULL AND TRIM(gender) <> '' GROUP BY gender`);
  const genderMap = genders.map(g => ({
    raw: g.v, count: Number(g.n), mapsTo: plan.normaliseGender(g.v),
  }));

  // ── Lookups that will not resolve ──────────────────────────────────────
  // Dangling ids are reported BEFORE and AFTER the recorded fixes in migrationPlan, so the report
  // shows both the raw damage in the source and what is actually left to deal with.
  const unresolved = {};
  for (const [col, tbl] of [
    ['nationality', 'nationality'], ['job_title', 'jobtitles'],
    ['employment_status', 'employmentstatus'], ['pay_grade', 'paygrades'],
  ]) {
    const dangling = await all(conn, `
      SELECT e.\`${col}\` AS legacy_id, COUNT(*) AS n FROM employees e
       LEFT JOIN ${tbl} t ON t.id = e.\`${col}\`
       WHERE e.\`${col}\` IS NOT NULL AND TRIM(e.\`${col}\`) <> '' AND t.id IS NULL
       GROUP BY e.\`${col}\``);
    const blank = await one(conn,
      `SELECT COUNT(*) AS n FROM employees WHERE \`${col}\` IS NULL OR TRIM(\`${col}\`) = ''`);

    const fixes = plan.LEGACY_LOOKUP_FIXES[col] ?? {};
    const fixed  = dangling.filter(d => fixes[String(d.legacy_id)] != null);
    const stillBad = dangling.filter(d => fixes[String(d.legacy_id)] == null);

    unresolved[col] = {
      danglingId: dangling.reduce((s, d) => s + Number(d.n), 0),
      fixedByPlan: fixed.reduce((s, d) => s + Number(d.n), 0),
      stillUnresolved: stillBad.reduce((s, d) => s + Number(d.n), 0),
      blank: Number(blank.n),
      detail: dangling.map(d => ({
        legacyId: d.legacy_id,
        employees: Number(d.n),
        mappedTo: fixes[String(d.legacy_id)] ?? null,
      })),
    };
  }

  // ── NASSIT ─────────────────────────────────────────────────────────────
  const nassit = await one(conn,
    `SELECT COUNT(*) AS have FROM employees WHERE nassit_num IS NOT NULL AND TRIM(nassit_num) <> ''`);
  const nassitDups = await all(conn, `
    SELECT e.nassit_num AS num, COUNT(*) AS n,
           SUM(CASE WHEN TRIM(REPLACE(e.status,'''','')) = 'Active' THEN 1 ELSE 0 END) AS active,
           GROUP_CONCAT(e.employee_id ORDER BY e.employee_id) AS codes
      FROM employees e
     WHERE e.nassit_num IS NOT NULL AND TRIM(e.nassit_num) <> ''
     GROUP BY e.nassit_num HAVING n > 1`);

  return {
    total: Number(total),
    // The ONLY reason an employee does not import is that it has no employee_id to key on.
    // Nothing is dropped as a duplicate: identity is employee_id, and all of them are unique.
    wouldImport: Number(total) - Number(noKey),
    skipped: {
      noEmployeeId: Number(noKey),
    },
    duplicateCodes: dupCodes.map(d => ({ code: d.code, count: Number(d.n) })),
    // Review lists for HR. These drive no behaviour — see the note where they are built.
    reviewLists: {
      sharedNassit: sharedNassit.map(d => ({
        number: d.num, employees: Number(d.n), active: Number(d.active),
        codes: d.codes, names: d.names,
      })),
      sharedName: sharedName.map(d => ({ name: String(d.nm).trim(), pairs: Number(d.pairs) })),
    },
    employeesWithNoData: { count: noData.length, sample: noData.slice(0, 20) },
    genderMapping: genderMap,
    unresolvedLookups: unresolved,
    nassit: {
      withNumber: Number(nassit.have),
      duplicates: nassitDups.map(d => ({
        number: d.num, employees: Number(d.n), active: Number(d.active), codes: d.codes,
      })),
    },
  };
}

/**
 * Payroll analysis — where the bulk of the data and the bulk of the problems are.
 */
async function analysePayroll(conn) {
  const runs = await one(conn, 'SELECT COUNT(*) AS n FROM payroll');
  const span = await one(conn, 'SELECT MIN(date_start) AS lo, MAX(date_end) AS hi FROM payroll');
  const byYear = await all(conn,
    `SELECT YEAR(date_start) AS y, COUNT(*) AS n FROM payroll
      WHERE date_start IS NOT NULL GROUP BY YEAR(date_start) ORDER BY y`);
  const byStatus = await all(conn, 'SELECT status, COUNT(*) AS n FROM payroll GROUP BY status');

  const dataTotal = await one(conn, 'SELECT COUNT(*) AS n FROM payrolldata');

  // Rows whose payroll run was deleted — the 20% the user chose to exclude.
  const orphanRun = await one(conn, `
    SELECT COUNT(*) AS n, ROUND(SUM(pd.amount), 2) AS amt
      FROM payrolldata pd LEFT JOIN payroll p ON p.id = pd.payroll
     WHERE p.id IS NULL`);
  const orphanRunDetail = await all(conn, `
    SELECT pd.payroll AS run_id, COUNT(*) AS n, ROUND(SUM(pd.amount), 2) AS amt
      FROM payrolldata pd LEFT JOIN payroll p ON p.id = pd.payroll
     WHERE p.id IS NULL GROUP BY pd.payroll ORDER BY n DESC`);

  const orphanEmp = await one(conn, `
    SELECT COUNT(*) AS n FROM payrolldata pd
     LEFT JOIN employees e ON e.id = pd.employee WHERE e.id IS NULL`);
  const orphanCol = await one(conn, `
    SELECT COUNT(*) AS n FROM payrolldata pd
     LEFT JOIN payrollcolumns pc ON pc.id = pd.payroll_item WHERE pc.id IS NULL`);

  // What actually survives every exclusion.
  const clean = await one(conn, `
    SELECT COUNT(*) AS n, ROUND(SUM(pd.amount), 2) AS amt
      FROM payrolldata pd
      JOIN payroll        p  ON p.id  = pd.payroll
      JOIN employees      e  ON e.id  = pd.employee
      JOIN payrollcolumns pc ON pc.id = pd.payroll_item`);

  return {
    runs: {
      total: Number(runs.n),
      from: span.lo, to: span.hi,
      byYear: byYear.map(r => ({ year: r.y, runs: Number(r.n) })),
      byStatus: byStatus.map(r => ({ status: r.status, runs: Number(r.n) })),
    },
    payrolldata: {
      total: Number(dataTotal.n),
      wouldImport: Number(clean.n),
      wouldImportAmount: Number(clean.amt || 0),
      excluded: {
        deletedRun:     { rows: Number(orphanRun.n), amount: Number(orphanRun.amt || 0) },
        missingEmployee:{ rows: Number(orphanEmp.n) },
        missingColumn:  { rows: Number(orphanCol.n) },
      },
      deletedRunDetail: orphanRunDetail.map(r => ({
        runId: r.run_id, rows: Number(r.n), amount: Number(r.amt || 0),
      })),
    },
  };
}

/** Medical analysis — expected clean, but verified rather than assumed. */
async function analyseMedical(conn) {
  const out = {};
  for (const t of ['staffmedical', 'staffmedical_hist', 'medicallimit', 'medicalcondition', 'medicalsymptom']) {
    const c = await one(conn, `SELECT COUNT(*) AS n FROM ${t}`).catch(() => ({ n: null }));
    out[t] = { rows: c.n === null ? null : Number(c.n) };
  }
  for (const t of ['staffmedical', 'staffmedical_hist']) {
    const o = await one(conn,
      `SELECT COUNT(*) AS n FROM ${t} x LEFT JOIN employees e ON e.id = x.employee WHERE e.id IS NULL`)
      .catch(() => ({ n: null }));
    out[t].orphanEmployee = o.n === null ? null : Number(o.n);
  }
  return out;
}

/** What is already in the target, so the operator can see it is (or is not) empty. */
const TARGET_TABLES = ['employee', 'payrollruns', 'payrolldata', 'codelistvalue', 'companystructures', 'staffmedical'];

/**
 * Open a connection to an alternate Postgres target (a rehearsal database), or return null to use
 * the application's own Prisma client.
 *
 * Rehearsing against a copy is the safe way to run a real load: the live target holds GL-posted
 * payroll runs, so it must never be the practice ground.
 */
async function connectTarget(targetUrl) {
  if (!targetUrl) return null;
  const { Client } = require('pg');
  const client = new Client({ connectionString: targetUrl });
  await client.connect();
  return client;
}

async function analyseTarget(targetUrl = null) {
  const alt = await connectTarget(targetUrl);
  // Query through whichever connection is in play, normalising the two drivers' result shapes.
  const run = alt
    ? async (sql) => (await alt.query(sql)).rows
    : async (sql) => prisma.$queryRawUnsafe(sql);

  try {
    const provider = alt ? 'postgresql' : (prisma?._activeProvider ?? 'unknown');
    const counts = {};
    for (const t of TARGET_TABLES) {
      try {
        const r = await run(`SELECT COUNT(*) AS n FROM ${t}`);
        counts[t] = Number(r[0].n ?? r[0].N ?? 0);
      } catch (e) {
        counts[t] = null;                       // table absent on this provider
      }
    }
    const hasNassit = await run(
      `SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_name = 'employee' AND column_name = 'nassit_num'`)
      .then(r => Number(r[0].n ?? 0) > 0).catch(() => false);

    return {
      provider,
      // Named so the operator can see at a glance WHICH database was measured — the whole point
      // of a rehearsal is defeated if the report silently describes a different one.
      database: alt ? (targetUrl.split('/').pop() || '').split('?')[0] : null,
      isRehearsalTarget: !!alt,
      counts,
      nassitColumnPresent: hasNassit,
      isEmpty: Object.values(counts).every(v => !v),
    };
  } finally {
    if (alt) await alt.end().catch(() => {});
  }
}

/**
 * Full dry run. Writes nothing.
 */
async function dryRun(cfg = {}) {
  const started = Date.now();
  const pre = await preflight(cfg);
  if (!pre.ok) return { ok: false, preflight: pre, elapsedMs: Date.now() - started };

  let conn;
  try {
    conn = await connectSource(cfg);
    const [employees, payroll, medical, target] = [
      await analyseEmployees(conn),
      await analysePayroll(conn),
      await analyseMedical(conn),
      await analyseTarget(cfg.targetUrl ?? null),
    ];

    const warnings = [];
    if (!target.nassitColumnPresent) {
      warnings.push('The employee.nassit_num column is missing. Run 20260929_employee_nassit_num.<provider>.sql before loading, or NASSIT numbers will be dropped.');
    }
    if (!target.isEmpty) {
      warnings.push(`The target is not empty (employee=${target.counts.employee}). The loader matches on employee_id and will update rather than duplicate, but confirm this is intended.`);
    }
    if (!target.isRehearsalTarget) {
      // The live target holds GL-posted payroll runs; practising against it is the one mistake
      // this whole feature exists to prevent.
      warnings.push('This report describes the LIVE target database. For a trial load, point at a rehearsal database instead.');
    }
    const sharedNames = employees.reviewLists.sharedName.length;
    const sharedNassitActive = employees.reviewLists.sharedNassit.filter(d => d.active > 1).length;
    if (sharedNames || sharedNassitActive) {
      warnings.push(`For review after the load (nothing is skipped): ${sharedNames} names are held by more than one employee, and ${sharedNassitActive} NASSIT numbers are shared by more than one ACTIVE employee. Neither is reliable enough to decide identity automatically, so every record imports.`);
    }
    for (const [field, info] of Object.entries(employees.unresolvedLookups)) {
      if (info.stillUnresolved > 0) {
        const ids = info.detail.filter(d => !d.mappedTo).map(d => d.legacyId).join(', ');
        warnings.push(`${field}: ${info.stillUnresolved} employees point at legacy id(s) ${ids} which do not exist and have no mapping. These import as null.`);
      }
      if (info.fixedByPlan > 0) {
        const m = info.detail.filter(d => d.mappedTo).map(d => `${d.legacyId} -> "${d.mappedTo}" (${d.employees})`).join('; ');
        warnings.push(`${field}: ${info.fixedByPlan} employees resolved by a recorded mapping: ${m}.`);
      }
    }

    return {
      ok: true,
      preflight: pre,
      target,
      employees,
      payroll,
      medical,
      scopes: plan.SCOPES,
      warnings,
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

module.exports = { preflight, dryRun, connectSource, analyseTarget };
