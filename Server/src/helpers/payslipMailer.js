// ─────────────────────────────────────────────────────────────────────────────
// Payslip email delivery — queue + background worker.
//
// When a payroll run reaches 'Completed', enqueueRunPayslips() records one row per employee in
// payslip_email_queue. It does NOT send anything: completing a run must never wait on, or fail
// because of, a mail server. processQueue() (scheduled every minute in cronHelper.js) then sends
// due rows in small, rate-limited batches.
//
// Guarantees:
//   * Opt-in. Nothing is queued or sent unless Settings → Controls → "Email payslips when a payroll
//     run is completed" (app_controls `payroll_email_payslips` = '1') is on. Global email and the
//     Payroll notification switch are honoured too. Switching the setting off pauses sending; rows
//     already queued wait, and resume if it is switched back on.
//   * At most once per employee per run: UNIQUE(run_id, employee_id) + insert-if-absent.
//   * Safe with several server processes: a row is claimed with a conditional UPDATE before it is
//     sent, so two workers can never send the same row. A claim abandoned by a crash is released
//     after CLAIM_TIMEOUT_MIN.
//   * Failures are retried with exponential back-off up to MAX_ATTEMPTS, then marked 'failed' with
//     the error — visible on the run, and re-queueable via retryFailed().
//   * Never throws into its callers: enqueue/process log their own errors.
// ─────────────────────────────────────────────────────────────────────────────
const { prisma } = require('./dbQueryHelper');
const { Prisma } = require('@prisma/client');

const SETTING_KEY       = 'payroll_email_payslips';
const BATCH_SIZE        = 25;   // rows per worker tick (ticks are a minute apart)
const MAX_ATTEMPTS      = 5;
const CLAIM_TIMEOUT_MIN = 15;
const PER_SECOND        = 2;    // SMTP send rate

const isPg = () => (prisma._activeProvider ?? 'postgresql') === 'postgresql';

// "NOW() ± n minutes", computed by the DATABASE. Every queue timestamp is written and compared with
// the database clock; mixing in times computed in Node would skew retries by any timezone difference
// between the app server and the database session.
const nowPlusMinutes = (n) => (isPg()
  ? Prisma.sql`(NOW() + (${Number(n)} * INTERVAL '1 minute'))`
  : Prisma.sql`DATE_ADD(NOW(), INTERVAL ${Number(n)} MINUTE)`);

// Placeholder addresses created by the legacy migration (<code>@imported.local) are not mailboxes.
const deliverable = (email) => !!email && /@/.test(email) && !/@imported\.local$/i.test(email);

async function isEnabled() {
  const row = await prisma.settings.findFirst({
    where: { name: SETTING_KEY, category: 'app_controls' }, select: { value: true },
  }).catch(() => null);
  return row?.value === '1';
}

/** Create the queue table if the manual migration has not been applied yet (Postgres only). */
let tableReady = false;
async function ensureTable() {
  if (tableReady) return true;
  try {
    if (isPg()) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS payslip_email_queue (
          id BIGSERIAL PRIMARY KEY, run_id BIGINT NOT NULL, employee_id BIGINT NOT NULL,
          email VARCHAR(150), status VARCHAR(10) NOT NULL DEFAULT 'pending',
          attempts INT NOT NULL DEFAULT 0, last_error VARCHAR(500),
          next_attempt_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          claimed_at TIMESTAMP(0), sent_at TIMESTAMP(0),
          created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT payslip_email_queue_run_employee_key UNIQUE (run_id, employee_id))`);
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS payslip_email_queue_due_idx ON payslip_email_queue (status, next_attempt_at)');
    } else {
      await prisma.$queryRawUnsafe('SELECT 1 FROM payslip_email_queue LIMIT 1');
    }
    tableReady = true;
  } catch (err) {
    console.error('[payslip-mail] queue table unavailable — apply manual-migrations/20261013_payslip_email_queue:', err.message);
  }
  return tableReady;
}

/**
 * Queue a completed run's payslips for emailing. Safe to call more than once for the same run.
 * @returns {Promise<{queued:number, skipped:number, reason?:string}>}
 */
async function enqueueRunPayslips(runId) {
  try {
    if (!(await isEnabled())) return { queued: 0, skipped: 0, reason: 'disabled' };
    if (!(await ensureTable())) return { queued: 0, skipped: 0, reason: 'no queue table' };
    const id = BigInt(runId);

    // A payment type that does not produce payslips (e.g. an allowance-only run) sends nothing.
    const [run] = await prisma.$queryRaw`
      SELECT pr.status, pt.generate_payslip FROM payrollruns pr
        LEFT JOIN paymenttype pt ON pt.id = pr.payment_type_id WHERE pr.id = ${id} LIMIT 1`;
    if (!run || run.status !== 'Completed') return { queued: 0, skipped: 0, reason: 'run not completed' };
    if (run.generate_payslip === false || run.generate_payslip === 0) {
      return { queued: 0, skipped: 0, reason: 'payment type does not generate payslips' };
    }

    // One row per employee in the run; insert-if-absent so a repeat call changes nothing.
    const conflict = isPg() ? Prisma.sql`ON CONFLICT (run_id, employee_id) DO NOTHING` : Prisma.empty;
    const insertVerb = isPg() ? Prisma.sql`INSERT` : Prisma.sql`INSERT IGNORE`;
    const queued = await prisma.$executeRaw`
      ${insertVerb} INTO payslip_email_queue (run_id, employee_id, email, status)
      SELECT x.payroll, x.employee, x.email, 'pending' FROM (
        SELECT DISTINCT pd.payroll, pd.employee,
               COALESCE(NULLIF(TRIM(e.work_email), ''), NULLIF(TRIM(e.email), '')) AS email
          FROM payrolldata pd JOIN employee e ON e.id = pd.employee
         WHERE pd.payroll = ${id}) x
      ${conflict}`;

    // Rows with no real mailbox are recorded as skipped (with the reason) rather than attempted.
    const pending = await prisma.$queryRaw`
      SELECT id, email FROM payslip_email_queue WHERE run_id = ${id} AND status = 'pending'`;
    const undeliverable = pending.filter(r => !deliverable(r.email)).map(r => r.id);
    if (undeliverable.length) {
      await prisma.$executeRaw`
        UPDATE payslip_email_queue
           SET status = 'skipped', last_error = 'No deliverable email address on the employee record', updated_at = NOW()
         WHERE id IN (${Prisma.join(undeliverable)})`;
    }
    const result = { queued: Number(queued) - undeliverable.length, skipped: undeliverable.length };
    console.log(`[payslip-mail] run ${runId}: ${result.queued} payslip(s) queued, ${result.skipped} skipped (no email)`);
    return result;
  } catch (err) {
    console.error(`[payslip-mail] could not queue payslips for run ${runId}:`, err.message);
    return { queued: 0, skipped: 0, reason: err.message };
  }
}

// Minutes to wait before attempt n+1: 2, 4, 8, 16 … capped at an hour.
const backoffMinutes = (attempts) => Math.min(60, 2 ** attempts);

let running = false;

/** Send due payslips. Scheduled every minute; overlapping ticks in one process are skipped. */
async function processQueue() {
  if (running) return { sent: 0, failed: 0 };
  running = true;
  let mailer = null;
  const stats = { sent: 0, failed: 0, retried: 0, skipped: 0 };
  try {
    if (!(await isEnabled()) || !(await ensureTable())) return stats;
    const { notifyEnabled, openBulkMailer, sendPayslipEmail } = require('./emailHelper');
    if (!(await notifyEnabled('payroll'))) return stats;

    // Release claims abandoned by a crash or restart mid-send.
    await prisma.$executeRaw`
      UPDATE payslip_email_queue SET status = 'pending', claimed_at = NULL, updated_at = NOW()
       WHERE status = 'sending' AND claimed_at < ${nowPlusMinutes(-CLAIM_TIMEOUT_MIN)}`;

    const due = await prisma.$queryRaw`
      SELECT id FROM payslip_email_queue
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY id LIMIT ${BATCH_SIZE}`;
    if (!due.length) return stats;

    mailer = await openBulkMailer({ perSecond: PER_SECOND });
    if (!mailer) return stats; // email switched off globally — rows stay pending

    const { renderPayslip, PayslipError } = require('../controllers/payslipController');
    for (const { id } of due) {
      // Claim: only one worker can flip pending → sending for a given row.
      const claimed = await prisma.$executeRaw`
        UPDATE payslip_email_queue SET status = 'sending', claimed_at = NOW(), updated_at = NOW()
         WHERE id = ${id} AND status = 'pending'`;
      if (Number(claimed) !== 1) continue;

      const [row] = await prisma.$queryRaw`
        SELECT id, run_id, employee_id, email, attempts FROM payslip_email_queue WHERE id = ${id}`;
      const attempts = Number(row.attempts) + 1;
      try {
        const slip = await renderPayslip(String(row.run_id), String(row.employee_id));
        await sendPayslipEmail(mailer, {
          to: row.email, name: slip.empName || 'Colleague', runName: slip.run.name,
          period: slip.period, pdf: slip.buffer, filename: slip.filename,
        });
        await prisma.$executeRaw`
          UPDATE payslip_email_queue
             SET status = 'sent', attempts = ${attempts}, sent_at = NOW(), last_error = NULL, claimed_at = NULL, updated_at = NOW()
           WHERE id = ${id}`;
        stats.sent++;
      } catch (err) {
        const message = String(err?.message || err).slice(0, 480);
        // A payslip that cannot exist (employee gone, payslips disabled) will never succeed — skip.
        const permanent = err instanceof PayslipError;
        const giveUp = permanent || attempts >= MAX_ATTEMPTS;
        const status = permanent ? 'skipped' : giveUp ? 'failed' : 'pending';
        await prisma.$executeRaw`
          UPDATE payslip_email_queue
             SET status = ${status}, attempts = ${attempts}, last_error = ${message},
                 next_attempt_at = ${nowPlusMinutes(backoffMinutes(attempts))}, claimed_at = NULL, updated_at = NOW()
           WHERE id = ${id}`;
        if (status === 'failed') stats.failed++;
        else if (status === 'skipped') stats.skipped++;
        else stats.retried++;
        console.error(`[payslip-mail] row ${id} (run ${row.run_id}, employee ${row.employee_id}) attempt ${attempts}: ${message}`);
      }
    }
    if (stats.sent || stats.failed || stats.retried) {
      console.log(`[payslip-mail] sent ${stats.sent}, will retry ${stats.retried}, failed ${stats.failed}, skipped ${stats.skipped}`);
    }
    return stats;
  } catch (err) {
    console.error('[payslip-mail] worker tick failed:', err.message);
    return stats;
  } finally {
    if (mailer) { try { mailer.close(); } catch { /* ignore */ } }
    running = false;
  }
}

/** Per-status counts and the failed/skipped rows (with reasons) for one run. */
async function runSummary(runId) {
  if (!(await ensureTable())) return { enabled: await isEnabled(), counts: {}, problems: [] };
  const id = BigInt(runId);
  const counts = Object.fromEntries((await prisma.$queryRaw`
    SELECT status, COUNT(*) AS n FROM payslip_email_queue WHERE run_id = ${id} GROUP BY status`)
    .map(r => [r.status, Number(r.n)]));
  const problems = (await prisma.$queryRaw`
    SELECT q.employee_id, q.email, q.status, q.attempts, q.last_error,
           e.employee_id AS staff_code, TRIM(CONCAT(COALESCE(e.firstName,''), ' ', COALESCE(e.lastName,''))) AS emp_name
      FROM payslip_email_queue q LEFT JOIN employee e ON e.id = q.employee_id
     WHERE q.run_id = ${id} AND q.status IN ('failed', 'skipped')
     ORDER BY q.status, q.employee_id LIMIT 500`).map(r => ({
       employeeId: String(r.employee_id), staffCode: r.staff_code ?? '', name: r.emp_name ?? '',
       email: r.email ?? '', status: r.status, attempts: Number(r.attempts), error: r.last_error ?? '',
     }));
  return { enabled: await isEnabled(), counts, problems };
}

/** Put a run's failed rows back in the queue (fresh attempt count). */
async function retryFailed(runId) {
  if (!(await ensureTable())) return 0;
  return Number(await prisma.$executeRaw`
    UPDATE payslip_email_queue
       SET status = 'pending', attempts = 0, next_attempt_at = NOW(), last_error = NULL, updated_at = NOW()
     WHERE run_id = ${BigInt(runId)} AND status = 'failed'`);
}

module.exports = { enqueueRunPayslips, processQueue, runSummary, retryFailed, isEnabled, SETTING_KEY };
