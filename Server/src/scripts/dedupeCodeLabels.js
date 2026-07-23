/*
 * Make CodeListValue labels unique within each CodeList.
 *
 * Every duplicate-label group in this DB is exactly two rows: an older value with `code = NULL`
 * (which carries the existing references) and a newer canonical value WITH a proper code. We keep
 * the coded value (so every value ends up with a code), repoint all references from the null-code
 * duplicate onto it across every string column in the schema, then delete the duplicate.
 *
 * After this runs, add `@@unique([codeListId, label])` to schema.prisma and `prisma db push`.
 *
 * Usage:  node src/scripts/dedupeCodeLabels.js
 * Safe to re-run (no-op once labels are unique).
 */
const mysql = require('mysql2/promise');
const DB = { host: 'localhost', user: 'root', database: 'xhrm' };

(async () => {
  const c = await mysql.createConnection(DB);
  try {
    // 1. Duplicate groups → pick survivor (coded) + loser (null-code).
    const [groups] = await c.query(`
      SELECT codeListId, label FROM codelistvalue
      GROUP BY codeListId, label HAVING COUNT(*) > 1`);
    if (groups.length === 0) { console.log('No duplicate labels — nothing to do.'); return; }

    const pairs = []; // { loser, survivor, listId, label }
    for (const g of groups) {
      const [vals] = await c.query(
        'SELECT id, code FROM codelistvalue WHERE codeListId=? AND label=? ORDER BY (code IS NOT NULL) DESC, sortOrder ASC',
        [g.codeListId, g.label]);
      const survivor = vals[0];           // prefers a non-null code
      for (const loser of vals.slice(1)) pairs.push({ loser: loser.id, survivor: survivor.id, label: g.label });
    }
    console.log(`Duplicate groups: ${groups.length} | values to merge away: ${pairs.length}`);

    // 2. Candidate reference columns: every char/varchar column wide enough to hold a cuid,
    //    excluding the code-list tables' own identity/relation columns.
    const [cols] = await c.query(`
      SELECT TABLE_NAME t, COLUMN_NAME col
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND DATA_TYPE IN ('char','varchar')
        AND CHARACTER_MAXIMUM_LENGTH >= 25
        AND NOT (TABLE_NAME='codelistvalue' AND COLUMN_NAME IN ('id','codeListId'))
        AND NOT (TABLE_NAME='codelist' AND COLUMN_NAME='id')`, [DB.database]);

    // 3. Repoint references loser -> survivor across all candidate columns.
    let repointed = 0;
    for (const { loser, survivor } of pairs) {
      for (const { t, col } of cols) {
        const [r] = await c.query('UPDATE `' + t + '` SET `' + col + '`=? WHERE `' + col + '`=?', [survivor, loser]);
        if (r.affectedRows) { repointed += r.affectedRows; console.log(`   repointed ${r.affectedRows} in ${t}.${col}`); }
      }
    }

    // 4. Delete the duplicates.
    const loserIds = pairs.map((p) => p.loser);
    const [del] = await c.query('DELETE FROM codelistvalue WHERE id IN (?)', [loserIds]);

    // 5. Verify.
    const [[{ remaining }]] = await c.query(`
      SELECT COUNT(*) remaining FROM (
        SELECT 1 FROM codelistvalue GROUP BY codeListId, label HAVING COUNT(*)>1) x`);
    console.log('--- summary ---');
    console.log('references repointed :', repointed);
    console.log('duplicates deleted   :', del.affectedRows);
    console.log('duplicate groups left:', remaining);
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
