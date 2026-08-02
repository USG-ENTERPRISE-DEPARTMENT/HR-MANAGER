# MySQL → Postgres data migration

`scripts/migrate-mysql-to-postgres.js` copies row data from the MySQL database (`DATABASE_URL`)
into the Postgres database (`PG_URL`). Both connection strings are read from `Server/.env`.

It moves **data only**. Create the schema first — the tables must already exist in Postgres:

```bash
npx prisma db push --schema=src/prisma/schema.postgres.prisma
# plus any files in src/prisma/manual-migrations/*.postgres.sql
```

## Usage

```bash
# Show the per-table plan (row counts both sides) and exit — no writes
node scripts/migrate-mysql-to-postgres.js --plan

# Same as a normal run but writes nothing
node scripts/migrate-mysql-to-postgres.js --dry-run

# Full replace: empty each target table, then load MySQL's data (recommended)
node scripts/migrate-mysql-to-postgres.js --truncate

# Append: insert only rows whose ids are not already present
node scripts/migrate-mysql-to-postgres.js

# Restrict / exclude tables
node scripts/migrate-mysql-to-postgres.js --truncate --only employee,users
node scripts/migrate-mysql-to-postgres.js --truncate --skip auditlogs,attendance

# Rows fetched from MySQL per page (default 500)
node scripts/migrate-mysql-to-postgres.js --truncate --batch 1000
```

## Which mode do I want?

**`--truncate` (full replace)** — Postgres ends up an exact mirror of MySQL. Use this whenever
MySQL is the source of truth. It is also the only safe mode when both databases already hold data,
because primary keys can collide with *different* content on each side: in this project,
`permissions` id 1 was `create_users` on MySQL but `view_users` on Postgres. Appending in that
situation leaves `role_has_permissions` pointing at the wrong permissions — a silent
authorisation bug, not a visible error.

**Append (default)** — only safe when the target is empty, or when you know the id spaces do not
overlap. It skips any row whose key already exists, so divergent rows are silently kept.

## Behaviour worth knowing

- **Idempotent.** Inserts use `ON CONFLICT DO NOTHING`, so a re-run tops up what is missing rather
  than duplicating. With `--truncate` the result is deterministic no matter how many times it runs,
  which also means an interrupted run is repaired simply by running it again.
- **Per-table transactions.** Each table commits on its own. A failure aborts only that table
  (rolled back, reported in the summary); the rest still migrate. Nothing is left half-written.
- **Column casing is handled.** MySQL columns are camelCase (`bankAccount`) where Postgres folds
  them to lower case (`bankaccount`). Values are matched case-insensitively and written to the real
  Postgres column name, quoted.
- **Columns absent in Postgres are dropped** rather than failing the row.
- **Foreign keys are deferred** to commit time, so parent/child load order cannot break a run.
  Tables are still loaded parents-first where known (see `PRIORITY`) to keep checking cheap.
- **Invalid MySQL dates** (`0000-00-00 00:00:00`, which Postgres rejects) are stored as `NULL`.
  Date columns are read with `CAST(... AS CHAR)` for this reason, not just to convert them:
  Prisma's MySQL driver cannot decode the zero date and fails the **entire query** with an opaque
  `Raw query failed. Code: N/A. Message: N/A`. One bad row therefore makes a whole table read as
  zero rows, migrate nothing, and — because it stays empty — fail every foreign key pointing at it.
  This is not hypothetical: 10 of the 105 rows in `permissions` carry a zero `updated_at`, which
  silently emptied the table and broke `role_has_permissions` and `model_has_permissions`.
- **Sequences are re-synced** afterwards, so the next natural insert does not collide with a
  migrated id.
- **Batched inserts.** Rows go over in multi-row `INSERT`s capped at Postgres's 65535-parameter
  statement limit — one round trip per chunk instead of per row. This matters a great deal against
  a remote database.

## Tables that are skipped

- `_prisma_migrations` — the target keeps its own migration history.
- Any MySQL table with no Postgres counterpart. These are reported at the top of the plan. In this
  project that is `employeesalary_backup` and `monthly_rent_clean`, both leftover scratch tables
  that appear in neither Prisma schema nor anywhere in the application code.

## Substitutions it makes (and reports)

MySQL's non-strict mode allows values Postgres will not accept. Where a row is otherwise valid, the
script substitutes rather than discarding the table — and always says so in the output:

| Source value | Target column | Substituted with |
|---|---|---|
| `''` or zero date | nullable | `NULL` |
| `''` or zero date | `NOT NULL` with a default | the column's `DEFAULT` |
| zero date | `NOT NULL` date, no default | current timestamp |
| `''` | `NOT NULL` enum, no default | the enum's **first declared label**, logged as `[enum fallback: col→value xN]` |
| `''` | `NOT NULL` numeric | *nothing* — the row fails loudly |

The enum case is worth understanding. MySQL stores `''` as an ENUM's implicit blank member even
when it is not a declared value, so rows can hold a state the schema never permitted. In this
database **all 69 `employeeleavedays` rows have `leave_type = ''`** — the app inserts `d.type` from
the client and swallows the error with `.catch(() => {})`, so nothing ever surfaced. Postgres has
no blank member, so those rows migrate as `Full Day` (the first label, and the same fallback
`leaveController` uses elsewhere for this enum).

**If that default is wrong for your data, fix it after migrating** — the log tells you exactly which
column and how many rows:

```sql
-- inspect what was substituted
SELECT leave_type, COUNT(*) FROM employeeleavedays GROUP BY leave_type;
```

## If the run dies partway

The Postgres host has proved intermittently unreachable — runs have been lost both to `ETIMEDOUT`
while connecting and to a dropped socket mid-migration. The script now retries the initial connect
(5 attempts with backoff) and rebuilds the session when the server hangs up mid-run, so a brief
blip no longer ends the migration.

If it still dies, just run it again: `--truncate` makes the outcome identical no matter how many
times it runs. To finish only what's missing without redoing everything, use `--only` with the
tables that fell short:

```bash
node scripts/migrate-mysql-to-postgres.js --truncate --only permissions,role_has_permissions
```

## Verifying a run

The summary line reports failures, but confirm the row counts independently before treating
Postgres as the source of truth — a table that reads as empty migrates "successfully" with zero
rows:

```bash
node scripts/migrate-mysql-to-postgres.js --plan
```

Re-running `--plan` after a migration prints both sides again; every non-empty MySQL table should
now show an equal Postgres count. Anything still showing a gap needs looking at.

## After migrating

Point the app at Postgres and regenerate the client:

```bash
npm run db:use-pg     # prisma generate against schema.postgres.prisma
```

Stop the server first — Windows locks the query-engine DLL and `prisma generate` fails with
`EPERM` while it is running.
