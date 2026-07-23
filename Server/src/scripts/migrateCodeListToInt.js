/*
 * One-off migration: change codelist / codelistvalue primary keys from cuid VARCHAR to INT
 * AUTO_INCREMENT, preserving data and remapping every foreign-key reference.
 *
 *   node src/scripts/migrateCodeListToInt.js --dry-run   # map + verify, write nothing
 *   node src/scripts/migrateCodeListToInt.js             # apply
 *
 * NOTE: MySQL DDL (ALTER TABLE) auto-commits, so this is NOT wrapped in a transaction — instead
 * each step is idempotent (checks existence / re-runnable) so a re-run after a failure resumes
 * cleanly. Temp mapping tables use utf8mb4_unicode_ci to match the real columns' collation.
 *
 * FK columns remapped: active `employee` (×8) + relation/transfer tables. The legacy `employees`
 * table's staff_level/staff_role are VARCHAR(20) label text (excluded). Unmatched FK values
 * (text labels, empty strings, malformed cuids) become NULL — confirmed acceptable.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DRY = process.argv.includes('--dry-run');

const CLV_FKS = [
  ['employee', 'titleId'], ['employee', 'genderId'], ['employee', 'jobTitleId'],
  ['employee', 'nationalityId'], ['employee', 'religionId'], ['employee', 'employmentStatusId'],
  ['employee', 'staff_level'], ['employee', 'staff_role'],
  ['employeecertifications', 'certification_id'],
  ['employeeeducations', 'education_id'],
  ['employeelanguages', 'language_id'],
  ['employeeskills', 'skill_id'],
  ['employeetransfers', 'current_job_title'],
  ['employeetransfers', 'proposed_job_title'],
];

const COL = 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci';

async function columnType(table, col) {
  const r = await prisma.$queryRawUnsafe(
    `SELECT column_type ct FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, table, col);
  return r[0]?.ct ?? null;
}

async function main() {
  const x = (sql, ...a) => prisma.$executeRawUnsafe(sql, ...a);
  const q = (sql, ...a) => prisma.$queryRawUnsafe(sql, ...a);

  // Already migrated?
  if ((await columnType('codelistvalue', 'id')) === 'int') {
    console.log('codelistvalue.id is already INT — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  const lists = await q('SELECT id FROM codelist ORDER BY id');
  const values = await q('SELECT id FROM codelistvalue ORDER BY id');
  const listMap = new Map(lists.map((r, i) => [r.id, i + 1]));
  const valueMap = new Map(values.map((r, i) => [r.id, i + 1]));
  console.log(`codelist: ${lists.length} | codelistvalue: ${values.length}`);

  let orphanTotal = 0;
  for (const [table, col] of CLV_FKS) {
    const bad = await q(
      `SELECT COUNT(*) n FROM \`${table}\` WHERE \`${col}\` IS NOT NULL
         AND \`${col}\` COLLATE utf8mb4_unicode_ci NOT IN (SELECT id FROM codelistvalue)`);
    const n = Number(bad[0].n);
    if (n > 0) { orphanTotal += n; console.log(`  ⚠ ${table}.${col}: ${n} unmatched -> NULL`); }
  }
  console.log(`Total unmatched FK values -> NULL: ${orphanTotal}`);

  if (DRY) { console.log('\n[dry-run] verified, nothing written.'); await prisma.$disconnect(); return; }

  console.log('\nApplying…');

  // Mapping tables — PERMANENT (not TEMPORARY): Prisma pools connections, so a TEMPORARY table
  // created on one connection wouldn't be visible to the next query. Dropped at the end.
  // Collation matches the real columns so JOIN `=` works.
  await x('DROP TABLE IF EXISTS _clmap');
  await x(`CREATE TABLE _clmap (old_id VARCHAR(191) ${COL} PRIMARY KEY, new_id INT)`);
  for (const [o, n] of listMap) await x('INSERT INTO _clmap VALUES (?, ?)', o, n);

  await x('DROP TABLE IF EXISTS _cvmap');
  await x(`CREATE TABLE _cvmap (old_id VARCHAR(191) ${COL} PRIMARY KEY, new_id INT)`);
  for (const [o, n] of valueMap) await x('INSERT INTO _cvmap VALUES (?, ?)', o, n);

  // Drop FK (ignore if already dropped on a re-run).
  await x('ALTER TABLE codelistvalue DROP FOREIGN KEY codelistvalue_codeListId_fkey').catch(() => {});

  // FK columns: add int, populate, drop old, rename.
  for (const [table, col] of CLV_FKS) {
    if ((await columnType(table, col)) === 'int') { console.log(`  = ${table}.${col} already int`); continue; }
    if (await columnType(table, `${col}__int`)) await x(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}__int\``);
    await x(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}__int\` INT NULL`);
    await x(`UPDATE \`${table}\` t JOIN _cvmap m ON t.\`${col}\` COLLATE utf8mb4_unicode_ci = m.old_id SET t.\`${col}__int\` = m.new_id`);
    await x(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``);
    await x(`ALTER TABLE \`${table}\` CHANGE COLUMN \`${col}__int\` \`${col}\` INT NULL`);
    console.log(`  ✔ ${table}.${col}`);
  }

  // codelistvalue.codeListId — the two composite unique indexes reference this column, so drop
  // them first (re-added on the int column at the end).
  if ((await columnType('codelistvalue', 'codeListId')) !== 'int') {
    await x('ALTER TABLE codelistvalue DROP INDEX codelistvalue_codeListId_code_key').catch(() => {});
    await x('ALTER TABLE codelistvalue DROP INDEX codelistvalue_codeListId_label_key').catch(() => {});
    await x('ALTER TABLE codelistvalue ADD COLUMN codeListId__int INT NULL');
    await x('UPDATE codelistvalue v JOIN _clmap m ON v.codeListId COLLATE utf8mb4_unicode_ci = m.old_id SET v.codeListId__int = m.new_id');
    await x('ALTER TABLE codelistvalue DROP COLUMN codeListId');
    await x('ALTER TABLE codelistvalue CHANGE COLUMN codeListId__int codeListId INT NOT NULL');
    console.log('  ✔ codelistvalue.codeListId');
  }

  // PK: codelist
  if ((await columnType('codelist', 'id')) !== 'int') {
    await x('ALTER TABLE codelist ADD COLUMN id__int INT NULL');
    await x('UPDATE codelist c JOIN _clmap m ON c.id COLLATE utf8mb4_unicode_ci = m.old_id SET c.id__int = m.new_id');
    await x('ALTER TABLE codelist DROP PRIMARY KEY');
    await x('ALTER TABLE codelist DROP COLUMN id');
    await x('ALTER TABLE codelist CHANGE COLUMN id__int id INT NOT NULL');
    await x('ALTER TABLE codelist ADD PRIMARY KEY (id)');
    await x('ALTER TABLE codelist MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT');
    console.log('  ✔ codelist.id -> INT AUTO_INCREMENT');
  }

  // PK: codelistvalue
  if ((await columnType('codelistvalue', 'id')) !== 'int') {
    await x('ALTER TABLE codelistvalue ADD COLUMN id__int INT NULL');
    await x('UPDATE codelistvalue v JOIN _cvmap m ON v.id COLLATE utf8mb4_unicode_ci = m.old_id SET v.id__int = m.new_id');
    await x('ALTER TABLE codelistvalue DROP PRIMARY KEY');
    await x('ALTER TABLE codelistvalue DROP COLUMN id');
    await x('ALTER TABLE codelistvalue CHANGE COLUMN id__int id INT NOT NULL');
    await x('ALTER TABLE codelistvalue ADD PRIMARY KEY (id)');
    await x('ALTER TABLE codelistvalue MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT');
    console.log('  ✔ codelistvalue.id -> INT AUTO_INCREMENT');
  }

  // Re-add the composite unique indexes on the new int codeListId, the FK, and reset counters.
  await x('ALTER TABLE codelistvalue ADD UNIQUE INDEX codelistvalue_codeListId_code_key (codeListId, code)').catch(() => {});
  await x('ALTER TABLE codelistvalue ADD UNIQUE INDEX codelistvalue_codeListId_label_key (codeListId, label)').catch(() => {});
  await x(`ALTER TABLE codelist AUTO_INCREMENT = ${lists.length + 1}`);
  await x(`ALTER TABLE codelistvalue AUTO_INCREMENT = ${values.length + 1}`);
  await x('ALTER TABLE codelistvalue ADD CONSTRAINT codelistvalue_codeListId_fkey FOREIGN KEY (codeListId) REFERENCES codelist(id) ON UPDATE CASCADE').catch(() => {});

  // Clean up mapping tables.
  await x('DROP TABLE IF EXISTS _clmap');
  await x('DROP TABLE IF EXISTS _cvmap');

  console.log(`\n✅ Done. codelistvalue.id type: ${await columnType('codelistvalue', 'id')}`);
  await prisma.$disconnect();
}

main().catch(async e => { console.error('❌ failed:', e.message); await prisma.$disconnect(); process.exit(1); });
