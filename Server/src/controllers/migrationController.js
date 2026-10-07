// ─────────────────────────────────────────────────────────────────────────────
// Legacy data migration — HTTP surface.
//
// Drives the migration of `hrmdata_rcb` (the old IceHRM production database) into the
// HR-MANAGER schema. The rules live in helpers/migration/migrationPlan.js and the read-only
// analysis in helpers/migration/migrationAnalyzer.js; this file is only the API.
//
// Every endpoint here is READ-ONLY against both databases. The loader that actually writes is a
// separate step and is deliberately not wired up yet — the operator is meant to run the dry run,
// read the exception list, and only then execute.
//
// Source credentials come from MIGRATION_SOURCE_* environment variables by default. A request may
// override host/port/user/database, but NOT silently persist them: nothing here writes settings.
// ─────────────────────────────────────────────────────────────────────────────
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { logActivity, fromReq } = require('./auditController');
const analyzer = require('../helpers/migration/migrationAnalyzer');
const plan = require('../helpers/migration/migrationPlan');

/**
 * Pull optional source-connection overrides off the request.
 *
 * The password is accepted but never echoed back in any response, and never logged.
 */
function sourceConfig(req) {
  const b = req.body ?? {};
  const cfg = {};
  for (const k of ['host', 'port', 'user', 'password', 'database']) {
    if (b[k] !== undefined && b[k] !== null && String(b[k]).trim() !== '') cfg[k] = b[k];
  }
  if (b.target === 'rehearsal') cfg.targetUrl = rehearsalUrl();
  return cfg;
}

/**
 * Connection string for the rehearsal database.
 *
 * Derived from PG_URL by swapping only the database name, and NEVER accepted from the request: a
 * caller-supplied connection string would let anyone with this permission point the migration at
 * an arbitrary host. The request may only choose between 'live' and 'rehearsal'.
 */
function rehearsalUrl() {
  const base = process.env.MIGRATION_REHEARSAL_URL;
  if (base) return base;
  const pg = process.env.PG_URL;
  if (!pg) return null;
  return pg.replace(/\/([^/?]+)(\?|$)/, '/xhrm_migration_test$2');
}

// GET /migration/plan
// The declared plan: what would move, in what order, and which scopes are on. Static — it reads
// no database at all, so the UI can render the shape of the migration before connecting.
const getPlan = asyncHandler(async (req, res) => {
  respond.ok(res, 'Migration plan', {
    scopes: plan.SCOPES,
    steps: plan.STEPS.map(s => ({
      key: s.key,
      source: s.source,
      target: s.target,
      scope: s.scope,
      enabled: !!plan.SCOPES[s.scope]?.enabled,
      naturalKey: s.naturalKey ?? null,
      dependsOn: s.dependsOn ?? [],
      large: !!s.large,
    })),
    // Surfaced so the UI can explain WHY a value is being rewritten rather than appearing to
    // invent data — see the note in migrationPlan.js.
    lookupFixes: plan.LEGACY_LOOKUP_FIXES,
  });
});

// POST /migration/preflight
// Can we reach the source database, and does it look like the one we expect? Cheap (~300ms), so
// the UI can call it on page load and whenever the connection details change.
const postPreflight = asyncHandler(async (req, res) => {
  const result = await analyzer.preflight(sourceConfig(req));
  logActivity({ module: 'Migration', action: 'preflight', ...fromReq(req),
    details: { database: result.database, ok: result.ok, reachable: result.reachable } });

  if (!result.ok) {
    return respond.badReq(res, result.reachable
      ? `Connected, but the database does not look like the expected source (missing: ${(result.missingExpectedTables || []).join(', ')})`
      : `Could not connect to the source database: ${result.error}`);
  }
  respond.ok(res, 'Source database reachable', result);
});

// GET /migration/target
// What is currently in the target. Lets the operator confirm it is empty before a go-live load.
// ?target=rehearsal inspects the rehearsal database instead of the live one.
const getTarget = asyncHandler(async (req, res) => {
  const url = req.query.target === 'rehearsal' ? rehearsalUrl() : null;
  if (req.query.target === 'rehearsal' && !url) {
    return respond.badReq(res, 'No rehearsal database is configured (set MIGRATION_REHEARSAL_URL or PG_URL)');
  }
  respond.ok(res, 'Target state', await analyzer.analyseTarget(url));
});

// POST /migration/dry-run
// The whole point of this feature: a full transform that writes NOTHING and reports exactly what
// would happen, including every excluded row and every value that cannot be mapped.
//
// Takes ~20s against the production-sized source (787k payroll rows), so it is a POST the
// operator triggers deliberately rather than something that runs on page load.
const postDryRun = asyncHandler(async (req, res) => {
  const started = Date.now();
  const result = await analyzer.dryRun(sourceConfig(req));

  if (!result.ok) {
    logActivity({ module: 'Migration', action: 'dry_run_failed', ...fromReq(req),
      details: { error: result.preflight?.error } });
    return respond.badReq(res, result.preflight?.reachable
      ? 'The source database is reachable but does not look like the expected source'
      : `Could not connect to the source database: ${result.preflight?.error}`);
  }

  logActivity({ module: 'Migration', action: 'dry_run', ...fromReq(req), details: {
    database:      result.preflight.database,
    employees:     result.employees.wouldImport,
    payrollRows:   result.payroll.payrolldata.wouldImport,
    warnings:      result.warnings.length,
    elapsedMs:     Date.now() - started,
  }});

  respond.ok(res, 'Dry run complete — nothing was written', result);
});

// POST /migration/execute
// Deliberately not implemented yet. Returning a clear 400 beats leaving a route that half-works:
// the loader must not exist as a half-wired endpoint someone can trigger by accident.
// POST /migration/execute
// Runs the loader. THIS WRITES.
//
// Three deliberate guards, because this is the one irreversible action in the feature:
//
//   1. `target` must be stated explicitly. There is no default — a caller that forgets the field
//      gets an error rather than a surprise write to production.
//   2. Running against 'live' additionally requires `confirm: "MIGRATE LIVE"`. The live database
//      holds GL-posted payroll runs, so the extra step is proportionate.
//   3. Only one run at a time. Two concurrent loaders would interleave inserts and corrupt the
//      id maps each one builds.
//
// The request is answered only when the load finishes: a 600k-row load takes ~10 minutes, and a
// fire-and-forget response would leave the operator unable to tell success from a crash.
// The live state of the run in progress (or the last one to finish). The loader emits an event
// per step, and per batch for the large tables; they are folded into this object so the UI can
// poll GET /migration/job and show real progress instead of a ten-minute spinner.
let job = null;

/** Steps in the order the loader runs them, with the row counts the dry run predicts. */
const STEP_ORDER = [
  { key: 'seed',             label: 'Reference code lists' },
  { key: 'codelists',        label: 'Code lists' },
  { key: 'structures',       label: 'Company structures' },
  { key: 'grades',           label: 'Pay grades and notches' },
  { key: 'employees',        label: 'Employees' },
  { key: 'access',           label: 'Roles, permissions and admin login' },
  { key: 'pccodes',          label: 'PC codes (positions)' },
  { key: 'components',       label: 'Salary components' },
  { key: 'notchcomponents',  label: 'Notch salary amounts' },
  { key: 'payrollconfig',    label: 'Payroll columns' },
  { key: 'payrollruns',      label: 'Payroll runs' },
  { key: 'payrollemployees', label: 'Payroll roster and salaries' },
  { key: 'payrollconfiguration', label: 'Pay frequencies and calculation groups' },
  { key: 'payrollcolumnrefs', label: 'Payroll column inputs' },
  { key: 'payrollcolumngroups', label: 'Payroll column groups' },
  { key: 'calculationrules', label: 'Calculation rules' },
  { key: 'gradecomponents',  label: 'Pay grade allowances' },
  { key: 'payrolldata',      label: 'Payroll history' },
  { key: 'medical',          label: 'Medical records' },
];

/**
 * A non-empty description of a failure. `err.message` alone is not enough: Node's AggregateError
 * (e.g. ECONNREFUSED on both IPv4 and IPv6 for "localhost") has an EMPTY message, which the UI read
 * as "no error" and reported a failed run as "Migration complete — 0 rows".
 */
function describeError(err) {
  if (!err) return 'Unknown error';
  const inner = Array.isArray(err.errors) && err.errors.length
    ? ` (${err.errors.map(e => e?.message || e?.code || String(e)).join('; ')})` : '';
  return (err.message || err.code || err.name || String(err)) + inner || 'Unknown error';
}

const postExecute = asyncHandler(async (req, res) => {
  const which = String(req.body?.target ?? '').toLowerCase();
  if (which !== 'rehearsal' && which !== 'live') {
    return respond.badReq(res, 'Specify target: "rehearsal" or "live".');
  }
  if (which === 'live' && req.body?.confirm !== 'MIGRATE LIVE') {
    return respond.badReq(res,
      'Migrating into the live database requires confirm: "MIGRATE LIVE". Run against the rehearsal database first.');
  }
  if (job?.running) {
    return respond.conflict(res, `A migration into ${job.target} is already running (started ${job.startedAt}).`);
  }

  const targetUrl = which === 'rehearsal' ? rehearsalUrl() : process.env.PG_URL;
  if (!targetUrl) return respond.badReq(res, `No connection string configured for the ${which} target.`);

  const { execute } = require('../helpers/migration/migrationLoader');

  job = {
    running: true,
    target: which,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
    currentStep: null,
    steps: STEP_ORDER.map(s => ({ ...s, state: 'pending', inserted: 0, updated: 0, skipped: 0, notes: [] })),
    error: null,
    elapsedMs: 0,
  };

  const touch = (key, patch) => {
    const s = job.steps.find(x => x.key === key);
    if (s) Object.assign(s, patch);
  };

  logActivity({ module: 'Migration', action: 'execute_start', ...fromReq(req), details: { target: which } });

  // Deliberately NOT awaited: a full load runs for about ten minutes, far longer than any sane
  // HTTP timeout. The response returns at once and the client polls GET /migration/job.
  execute({
    sourceCfg: sourceConfig(req),
    targetUrl,
    onProgress: (p) => {
      if (p.phase === 'start') {
        job.currentStep = p.step;
        touch(p.step, { state: 'running', startedMs: Date.now() });
      } else if (p.phase === 'progress') {
        // Emitted per batch by the large tables, so the UI can show a real percentage.
        touch(p.step, { done: p.done, total: p.total });
      } else if (p.phase === 'done') {
        touch(p.step, {
          state: 'done',
          inserted: p.inserted, updated: p.updated, skipped: p.skipped,
          elapsedMs: p.elapsedMs, notes: p.notes ?? [],
        });
      }
    },
  })
    .then((result) => {
      job.running = false;
      job.elapsedMs = result.elapsedMs;
      job.finishedAt = new Date().toISOString();
      logActivity({ module: 'Migration', action: 'execute_complete', ...fromReq(req), details: {
        target: which,
        elapsedMs: result.elapsedMs,
        steps: result.steps.map(s => ({ step: s.key, inserted: s.inserted, skipped: s.skipped })),
      }});
    })
    .catch((err) => {
      console.error('[migration] execute failed:', err);
      job.running = false;
      job.error = describeError(err);
      job.finishedAt = new Date().toISOString();
      if (job.currentStep) touch(job.currentStep, { state: 'failed' });
      logActivity({ module: 'Migration', action: 'execute_failed', ...fromReq(req),
        details: { target: which, error: err.message } });
    });

  // 202: accepted and running, not finished.
  res.status(202).json({ status: '202', message: `Migration into ${which} started`, data: { target: which } });
});

// GET /migration/job — live progress of the current or last run.
//
// Poll this while a migration is in flight. `elapsedMs` is computed on read so the caller sees
// time advancing even between step transitions; a failed run leaves whatever loaded in place,
// which is intentional — the loader is idempotent, so the fix is to correct the cause and re-run.
const getJob = asyncHandler(async (req, res) => {
  if (!job) return respond.ok(res, 'No migration has been run', { running: false, steps: [] });
  respond.ok(res, job.running ? 'Migration in progress' : 'Migration finished', {
    ...job,
    elapsedMs: job.running ? Date.now() - job.startedMs : job.elapsedMs,
  });
});

// GET /migration/status — kept for the simple "is anything running?" check.
const getStatus = asyncHandler(async (req, res) => {
  respond.ok(res, 'Migration status', job?.running
    ? { running: true, target: job.target, startedAt: job.startedAt, elapsedMs: Date.now() - job.startedMs }
    : { running: false });
});

module.exports = { getPlan, postPreflight, getTarget, postDryRun, postExecute, getStatus, getJob };
