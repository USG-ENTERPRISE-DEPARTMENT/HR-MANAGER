const cron = require('node-cron');
const leaveCtrl = require('../controllers/leaveController');
const attendanceCtrl = require('../controllers/attendanceController');
const userCtrl = require('../controllers/userController');
const transferCtrl = require('../controllers/employeeTransferController');
const aiRag = require('./aiRag');

// Runs daily at 03:00 — purges expired / long-revoked refresh tokens so the table doesn't grow unbounded
// (every token refresh rotates in a new row and revokes the old one).
cron.schedule('0 3 * * *', () => {
  userCtrl.purgeStaleRefreshTokens()
    .then(n => { if (n) console.log(`[cron] Purged ${n} stale refresh token(s)`); })
    .catch(err => console.error('[cron] Refresh-token purge failed:', err.message));
});

// Runs daily at 06:00 — posts GL for all approved leaves whose start date has arrived
cron.schedule('0 6 * * *', () => {
  leaveCtrl.runDailyLeaveGL().catch(err =>
    console.error('[cron] Daily leave GL run failed:', err.message)
  );
});

// Runs every 15 minutes — marks no-shows as Absent once each shift's closing time
// has passed (day workers after the day end time, night workers after the night
// end time the following morning). Skips weekends/holidays/leave; a late punch
// self-heals an Absent row.
cron.schedule('*/15 * * * *', () => {
  attendanceCtrl.runAutoAbsentSweep().catch(err =>
    console.error('[cron] Attendance auto-absent sweep failed:', err.message)
  );
});

// Runs daily at 08:00 — emails yesterday's attendance summary digest (when enabled)
cron.schedule('0 8 * * *', () => {
  attendanceCtrl.runDailyDigest().catch(err =>
    console.error('[cron] Attendance digest failed:', err.message)
  );
});

// Runs hourly — makes approved employee transfers effective on their scheduled date.
cron.schedule('10 * * * *', () => {
  transferCtrl.runDueTransfers()
    .then(({ activated }) => { if (activated) console.log(`[cron] Activated ${activated} employee transfer(s)`); })
    .catch(err => console.error('[cron] Employee-transfer activation failed:', err.message));
});

// AI knowledge index — build shortly after startup (once the server and a locally-starting
// Ollama have settled), then re-check every 30 minutes. ensureIndexed() no-ops when the index is
// already built or when Ollama is unavailable, so this self-heals if Ollama comes up later and
// costs nothing once the index exists.
setTimeout(() => {
  aiRag.ensureIndexed().catch(err => console.error('[ai] startup auto-index failed:', err.message));
}, 8000);
cron.schedule('*/30 * * * *', () => {
  aiRag.ensureIndexed().catch(err => console.error('[ai] scheduled auto-index failed:', err.message));
});

console.log('[cron] Daily leave GL (06:00), attendance auto-absent, attendance digest (08:00), employee transfers (hourly) scheduled');
console.log('[cron] AI knowledge auto-index scheduled (startup + every 30m)');
