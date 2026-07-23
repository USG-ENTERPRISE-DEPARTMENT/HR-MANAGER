# API smoke tests

Per-module black-box tests that hit the **running** API over HTTP (auth + routing + permission guards
+ validation — the same path the frontend action buttons use). Use them to verify a module works after
a change, or to confirm the app behaves identically on **MySQL and Postgres**, instead of clicking
through every screen by hand.

No test framework, no extra dependencies — plain Node (global `fetch`).

## Run

The API server must be running and the database seeded (a `super-admin` login must exist).

```bash
npm run smoke                 # run every module (exit code 1 if any check fails)
node smoke/run.js salary      # run one module
node smoke/run.js salary leave payroll   # run several
node smoke/run.js --list      # list module names
```

Config via env (defaults shown):

```
SMOKE_BASE_URL=http://localhost:3050/v1/api/hr
SMOKE_EMAIL=superadmin@usg.com
SMOKE_PASSWORD=pass1234
```

## What it does

- Logs in once as the super-admin (which has every permission, so it clears all guards).
- For each module: verifies the read/list endpoints, then does a **create → read → update → delete**
  round-trip on temporary records **prefixed `ZZ_`**, and asserts a few business rules (e.g. duplicate
  → 409, out-of-range → 400).
- Every created record is deleted afterward (even if a check fails), so it's safe to run against a real
  database and safe to re-run. It never touches pre-existing data.

`PASS` / `FAIL` per check, a per-module subtotal, and a summary table. `SKIP` appears where a create is
gated by site-specific config (e.g. the employee form's required-field settings) — those still count as
passing.

## Add / extend a module

Drop a file in `smoke/modules/<name>.js` exporting `async function run(t)`. `t` gives you:

- `t.api.get/post/put/del(path, body?)` → `{ status, body }` (auth attached automatically)
- `t.check(name, cond, extra?)`, `t.expectOk(res)`, `t.createOrSkip(res, name)`
- `t.uniq('Foo')` → a unique `ZZ_…_Foo` name; `t.track('/thing/:id')` → delete it during cleanup
- `t.firstId('/employees')` → an existing record's id, for prerequisites (never mutates)
