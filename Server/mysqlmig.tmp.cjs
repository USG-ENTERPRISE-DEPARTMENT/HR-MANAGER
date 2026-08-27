// Apply the two pending manual migrations to the local MySQL, idempotently.
// MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so each statement is guarded by an
// information_schema check instead of relying on catching error 1060.
require('dotenv').config();
const { prisma } = require('./src/helpers/dbQueryHelper');

const WANTED = [
  { table: 'payslip_settings', column: 'payslip_columns',   ddl: 'ALTER TABLE payslip_settings ADD COLUMN payslip_columns TEXT NULL' },
  { table: 'payrollcolumns',   column: 'payslip_section',   ddl: 'ALTER TABLE payrollcolumns ADD COLUMN payslip_section VARCHAR(20) NULL' },
  { table: 'payrollcolumns',   column: 'payslip_in_total',  ddl: 'ALTER TABLE payrollcolumns ADD COLUMN payslip_in_total TINYINT(1) NOT NULL DEFAULT 0' },
  { table: 'payrollruns',      column: 'template_snapshot', ddl: 'ALTER TABLE payrollruns ADD COLUMN template_snapshot TEXT NULL' },
];

(async () => {
  const db = await prisma.$queryRawUnsafe('SELECT DATABASE() AS d');
  console.log('target database:', db[0].d);

  for (const w of WANTED) {
    const found = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, w.table, w.column);
    const exists = Number(found[0].n) > 0;
    if (exists) { console.log(`  skip   ${w.table}.${w.column} (already present)`); continue; }
    await prisma.$executeRawUnsafe(w.ddl);
    console.log(`  added  ${w.table}.${w.column}`);
  }

  console.log('\nresulting definitions:');
  for (const w of WANTED) {
    const r = await prisma.$queryRawUnsafe(
      `SELECT column_name, column_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, w.table, w.column);
    const c = r[0];
    console.log(c
      ? `  ${w.table}.${c.column_name ?? c.COLUMN_NAME} : ${c.column_type ?? c.COLUMN_TYPE} null=${c.is_nullable ?? c.IS_NULLABLE} default=${(c.column_default ?? c.COLUMN_DEFAULT) ?? '-'}`
      : `  ${w.table}.${w.column} : MISSING`);
  }
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message.split('\n').filter(Boolean).slice(-3).join(' | ')); process.exit(1); });
