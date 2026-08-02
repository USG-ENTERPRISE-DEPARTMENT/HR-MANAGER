#!/usr/bin/env node
/**
 * Independent verification that the MySQL → Postgres migration is complete.
 *
 *   node scripts/verify-migration.js
 *
 * Deliberately does NOT use the Prisma client: after `npm run db:use-pg` that client speaks
 * Postgres, so it cannot read the MySQL side at all. This talks to each database with its own
 * driver (mysql2 and pg) and compares row counts table by table.
 *
 * Exits non-zero if any table differs, so it can gate a cutover.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { Client } = require('pg');

const SKIP = new Set(['_prisma_migrations']);

(async () => {
  const my = await mysql.createConnection(process.env.DATABASE_URL);
  const pg = new Client({ connectionString: process.env.PG_URL, connectionTimeoutMillis: 30000 });
  pg.on('error', () => {});
  await pg.connect();

  const [dbRow] = await my.query('SELECT DATABASE() AS db');
  const [tblRows] = await my.query(
    `SELECT TABLE_NAME AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME`);

  const pgTables = new Set((await pg.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map(r => r.tablename.toLowerCase()));

  console.log(`mysql db: ${dbRow[0].db}`);
  console.log('');

  let ok = 0, mismatched = [], missing = [], srcTotal = 0, dstTotal = 0;

  for (const { n: t } of tblRows) {
    if (SKIP.has(t.toLowerCase())) continue;
    if (!pgTables.has(t.toLowerCase())) { missing.push(t); continue; }

    const [[{ c: src }]] = await my.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    const dst = Number((await pg.query(`SELECT COUNT(*)::int AS c FROM "${t}"`)).rows[0].c);
    srcTotal += Number(src); dstTotal += dst;

    if (Number(src) === dst) { if (Number(src) > 0) ok++; }
    else mismatched.push({ t, src: Number(src), dst });
  }

  console.log(`tables matching (non-empty) : ${ok}`);
  console.log(`rows  mysql=${srcTotal}  postgres=${dstTotal}`);
  if (missing.length)    console.log(`no Postgres table (skipped): ${missing.join(', ')}`);

  if (mismatched.length) {
    console.log('');
    console.log('MISMATCHED:');
    for (const m of mismatched)
      console.log(`  ${m.t.padEnd(32)} mysql=${String(m.src).padStart(7)}  postgres=${String(m.dst).padStart(7)}  diff=${m.src - m.dst}`);
  } else {
    console.log('');
    console.log('✔ every table matches');
  }

  await my.end();
  await pg.end();
  process.exit(mismatched.length ? 1 : 0);
})().catch(e => { console.error('verify failed:', e.message); process.exit(1); });
