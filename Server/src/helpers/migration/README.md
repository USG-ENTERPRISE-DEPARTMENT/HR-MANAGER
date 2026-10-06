# Legacy data migration (`hrmdata_rcb` → HR-MANAGER)

Migrates the old IceHRM production database into the HR-MANAGER schema. Driven from
**Settings → System → Migration** (`manage_settings` permission).

| File | Role |
|---|---|
| `migrationPlan.js` | Pure declaration: what moves, in what order, what is excluded. No I/O. |
| `migrationAnalyzer.js` | Read-only dry run. Reports what *would* happen. |
| `migrationLoader.js` | The step that **writes**. |

The dry run and the loader read the same plan, so they cannot describe different migrations.

## Go-live checklist

A fresh production database is **not** ready for the migration straight after `prisma db push`.
Each of these was discovered by rehearsing against a copy, and each would have failed the real run.

1. **Seed the application's own configuration first.**
   `prisma db push` creates the *tables* but none of the seeded data. With no rows in `codelist` /
   `codelistvalue`, every lookup silently maps to null — no error, just empty columns.
   The migration maps legacy lookups onto these by label; it does not create the lists.

2. **Apply the manual migrations in `../prisma/manual-migrations/`.**
   `db push` does not recreate indexes added by hand. The loader needs
   `payrollemployees_employee_frequency_key` (unique on `employee, pay_frequency`) for its upsert,
   and `employee.nassit_num` must exist or NASSIT numbers are dropped.

3. **Then run the migration** — dry run first, read the exception list, then execute.

## Things the source data will do to you

- **`employee.email` is NOT NULL and UNIQUE**, but 509 legacy employees have no address and 233
  share one switchboard address. The loader synthesises `<staffcode>@imported.local`, following
  the convention an earlier import already established. `work_email` and `personal_email` are
  unique too, so duplicates there are nulled — first holder keeps the address.
- **NOT NULL columns with defaults** (`firstname`, `lastname`, `approvalstatus`,
  `lifecyclestatus`) still reject an explicit NULL. A default only applies when the column is
  omitted, so each needs its own fallback.
- **Postgres folded the Prisma camelCase column names to lower case.** `"firstName"` does not
  exist; `firstname` does.
- **414 duplicate `(employee, pay_frequency)` pairs** exist in the source, which predates the
  unique index. A batched upsert cannot touch the same row twice, so they are collapsed —
  latest wins.
- **`employeesalary.pay_frequency` is an enum** (`Hourly`…`Monthly`), not a number.
- **Amounts are stored as `varchar` with up to 6 decimal places.** MySQL's `SUM()` coerces them to
  float and loses precision; a naive reconciliation shows a ~0.19 difference on 196bn that is not
  really there. Compare with `SUM(CAST(amount AS DECIMAL(30,6)))`.
- **`staffmedical_hist.id` has no default** — the id must be supplied.
- **Gender is four spellings for two genders** (`M`/`Male`, `F`/`Female`); religion and gender are
  free text in the source but codelist **ids** in the target.
- **`posted_by` / `approved_by` mean different things in the two systems.** In the legacy medical
  tables they hold **employee** ids (1,833 of 1,833 join to `employees`; only 7 coincidentally
  match a user id), but this application reads them as **user** ids and shows the linked
  employee's name. Copying the numbers across would label every record with the wrong person, so
  the loader translates legacy employee id → staff code → migrated employee → that employee's user
  account, creating a **disabled** (`status = '0'`) account where none exists purely so the name
  displays. Only four people appear across the whole medical history.
- **Legacy ids that point at nothing:** `nationality = 241` (750 employees) is mapped to
  Sierra Leonean by a recorded fix in the plan; `title = 52/53/54` points at an empty `titles`
  table and is left null rather than guessed.

## Re-running: `ON CONFLICT` is not enough

Four tables have **no unique constraint** to conflict against, so `ON CONFLICT DO NOTHING` matches
nothing and a re-run appends the whole table again:

| table | constraint | first rehearsal re-run |
|---|---|---|
| `payrolldata` | primary key on `id` only | 628,478 → **882,478** |
| `employeesalary` | primary key on `id` only | 10,422 → **20,844** |
| `staffmedical` | primary key on `id` only | doubled |
| `staffmedical_hist` | **no constraints at all** | 2,166 → **4,332** |

`staffmedical_hist` is the trap: it has no primary key, so supplying the legacy id explicitly does
*not* make the conflict clause work. Only `payrollemployees` has a real natural key
(`employee, pay_frequency`) and genuinely upserts.

The loader therefore **deletes the rows it owns before reloading them** — scoped to the migrated
runs and migrated employees, so rows entered in the target by other means are untouched.

Verify idempotency by running the migration **twice** and comparing counts; do not assume it.

## Three databases, three settings — keep them distinct

```
PG_URL                   the app runs and AUTHENTICATES here      → xhrm
MIGRATION_REHEARSAL_URL  the rehearsal target it WRITES to        → xhrm_migration_test
MIGRATION_REFERENCE_URL  where app CONFIG is copied from          → xhrm
```

Pointing `PG_URL` at the migration target breaks two things at once, both silently:

- **You cannot start a migration.** The app authenticates against `PG_URL`; if that is the
  database being emptied, there is no account to log in with — but the migration is what creates
  one. `POST /migration/execute` returns `401 User no longer exists`.
- **Configuration seeding stops.** A database cannot be its own reference, so roles, permissions
  and component types are skipped without an error.

It is tempting to repoint `PG_URL` at the rehearsal database to look at the migrated data. That
works for browsing, but put it back before running another migration.

Note these live in `.env`, not `.env.development` — dotenv loads the former.

## The load runs in the API process

`POST /migration/execute` returns `202` immediately and the loader continues in the background of
the Node process; the UI polls `GET /migration/job`. That means:

- **Restarting or redeploying the server mid-migration kills the load.** Nothing is corrupted —
  the loader is idempotent and completed steps stay loaded — but it stops where it was and must
  be run again. Do not deploy during a migration.
- Progress lives in memory, so a server restart also loses the progress report (not the data).
- A load takes about ten minutes; if the process is behind a supervisor that restarts on idle or
  memory pressure, check that first if a run stops early.

For a go-live migration, run it when nothing else will restart the server.

## Performance: batch everything

The target is across a network link with **~550ms round-trip latency**, so the cost of a load is
the *number of statements*, not the number of rows.

| | per-row | batched |
|---|---|---|
| notches (415) | 360s | 14s |
| employees (1,280) | 11 min | 8s |
| payrolldata (628k) | ~96 h (projected) | ~9 min |

`insertMany()` exists for this. **Never add a per-row INSERT to this loader.**

## Verification

Row counts alone are not enough — reconcile the money:

```
total payroll   196,699,913,596.989   source and target, to the cent
```

Also check: no orphaned payroll rows, no duplicate staff codes, supervisor links resolved,
gender/religion resolved to ids, NASSIT numbers carried.

## Identity

**Employees are identified by `employee_id` alone.** All 1,280 are unique, so nothing is collapsed
and every employee imports.

Do not reintroduce name-based duplicate detection. An earlier rule paired on first+last name and
dropped the side with no payroll/medical history; measurement showed no UTB-coded employee has
*any* payrolldata or medical row (they are configured on the payroll roster but were never paid
through this system), so the history test had zero discriminating power and the name match was
making the whole decision. Names collide heavily — MOHAMED KAMARA is 21 different people — and the
rule would have dropped 85 records, 76 of them ACTIVE.

Shared names and shared NASSIT numbers are **reported for human review** and drive no behaviour.
