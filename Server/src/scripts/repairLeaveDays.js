/*
 * One-off repair: rebuild the day rows of leave applications that were saved with NONE.
 *
 * Until the fix in leaveController.leaveDaysWrite, applying for leave inserted each day with the
 * Prisma enum NAME ('Full_Day') via raw SQL; the database only accepts the label ('Full Day'), the
 * error was swallowed, and the leave was saved with zero employeeleavedays rows. Those leaves show
 * "0 working days" and — because balances are counted from these rows — deducted nothing.
 *
 * This recomputes each affected leave's working days with the same calculator the app uses (work
 * week + holidays) and inserts them. Only leaves with NO day rows are touched; anything that already
 * has days is left alone, so it is safe to re-run.
 *
 * Usage:
 *   node src/scripts/repairLeaveDays.js --dry-run   # list what would be repaired, write nothing
 *   node src/scripts/repairLeaveDays.js             # apply
 */
require('dotenv').config();
const { prisma } = require('../helpers/dbQueryHelper');
const { getWorkingDays, leaveDaysWrite } = require('../controllers/leaveController');

const DRY = process.argv.includes('--dry-run');
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

(async () => {
  const leaves = await prisma.$queryRaw`
    SELECT el.id, el.status, el.date_start, el.date_end,
           TRIM(CONCAT(COALESCE(e.firstName,''), ' ', COALESCE(e.lastName,''))) AS emp_name
      FROM employeeleaves el
      LEFT JOIN employee e ON e.id = el.employee
     WHERE el.date_start IS NOT NULL AND el.date_end IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM employeeleavedays d WHERE d.employee_leave = el.id)
     ORDER BY el.date_start`;

  console.log(`Leaves with no day rows: ${leaves.length}${DRY ? '  (dry run — nothing will be written)' : ''}\n`);
  let repaired = 0, daysAdded = 0, noWorkingDays = 0;
  for (const l of leaves) {
    const days = await getWorkingDays(iso(l.date_start), iso(l.date_end));
    console.log(`  ${String(l.id).padEnd(16)} ${String(l.status ?? '').padEnd(22)} ${iso(l.date_start)} → ${iso(l.date_end)}  ${String(days.length).padStart(3)} day(s)  ${l.emp_name ?? ''}`);
    if (!days.length) { noWorkingDays++; continue; }
    if (!DRY) {
      // Re-check inside the loop: never add days to a leave that gained some meanwhile.
      const [{ n }] = await prisma.$queryRaw`SELECT COUNT(*) AS n FROM employeeleavedays WHERE employee_leave = ${l.id}`;
      if (Number(n) > 0) continue;
      await leaveDaysWrite(l.id, days);
      // Distinct id bases per leave (leaveDaysWrite derives ids from the clock).
      await new Promise((r) => setTimeout(r, 2));
    }
    repaired++; daysAdded += days.length;
  }

  console.log(`\n${DRY ? 'Would repair' : 'Repaired'} ${repaired} leave(s), ${daysAdded} day row(s).`);
  if (noWorkingDays) console.log(`${noWorkingDays} leave(s) fall entirely on weekends/holidays and were left as they are.`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('❌ repair failed:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
