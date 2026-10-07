// ─────────────────────────────────────────────────────────────────────────────
// Migration loader — the step that WRITES.
//
// Reads `hrmdata_rcb` (legacy IceHRM, MySQL) and loads it into a HR-MANAGER Postgres database,
// following the rules declared in migrationPlan.js. The dry run (migrationAnalyzer.js) reports
// what this will do; both read the same plan so they cannot disagree.
//
// Design rules, each one earned from the data:
//
//   * IDEMPOTENT. Every insert is ON CONFLICT DO UPDATE against a natural key, so a re-run after
//     a partial failure repairs rather than duplicates. Go-live targets an empty database, but
//     rehearsals and retries must be safe.
//   * ORIGINAL IDS ARE NOT PRESERVED. The target has no legacy-id column, so every foreign key is
//     remapped through an in-memory id map built as each step runs. `employee_id` (staff code) is
//     the only natural key employees have.
//   * NOTHING IS INVENTED. A value that cannot be resolved is written as NULL and counted, never
//     guessed. The one exception is the recorded nationality fix in the plan, and the synthesised
//     e-mail below — both deliberate and both reported.
//   * BATCHED. payrolldata is 628k rows; it is streamed and inserted in chunks so memory stays
//     flat and a failure does not lose the whole run.
// ─────────────────────────────────────────────────────────────────────────────
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const plan = require('./migrationPlan');

const BATCH = 1000;

/* ── small helpers ──────────────────────────────────────────────────────── */

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Legacy dates arrive as Date or as the zero-dates MySQL allows; both must become NULL or a date. */
const date = (v) => {
  if (!v) return null;
  const s = String(v);
  if (s.startsWith('0000') || s.startsWith('0001')) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const int = (v) => {
  const n = Number(clean(v));
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/**
 * The target requires employee.email to be NOT NULL and UNIQUE, but in the source 509 employees
 * have no address at all and 233 share `rokelsl@rokelbank.sl`. A straight copy fails on the
 * second duplicate.
 *
 * A previous import into this system already solved it with `<employee_id>@imported.local`,
 * keeping the real address in work_email — so this follows that established convention rather
 * than inventing a second one. The staff code is unique, so the result is unique too.
 */
const syntheticEmail = (code) => `${String(code).toLowerCase()}@imported.local`;

/**
 * Collapse irregular whitespace in a name.
 *
 * 161 of the 392 legacy notch names carry stray spacing — leading spaces (" GS2/1  UTB") and
 * doubled internal ones ("B4B - Notch  4.5") — which makes lists look ragged and the half-notches
 * appear indented. Only whitespace is touched; the wording is left exactly as it is.
 */
const tidyName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Keep a tidied name unique, because `notches.name` carries a UNIQUE index in this schema.
 *
 * Two Band 1 notches differ ONLY by an extra space — "B1 - Notch  10.5" at 132,970.51 and
 * "B1 - Notch 10.5" at 159,564.62 — so tidying both produces the same string and the insert is
 * rejected. They are genuinely different pay points (neither currently has employees), so the
 * second keeps its amount as a disambiguator rather than being merged away or left ragged.
 */
function uniqueName(base, taken, amount) {
  if (!taken.has(base.toLowerCase())) return base;
  const withAmount = `${base} (${Number(amount ?? 0).toFixed(2)})`;
  if (!taken.has(withAmount.toLowerCase())) return withAmount;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) n++;
  return `${base} (${n})`;
}

/**
 * Which side of the payslip a payroll column falls on.
 *
 * The legacy system stores this as the codes B001 / B002; the current design stores the readable
 * words "Payment" / "Deduction" directly on `payrollcolumns`, which is where the application now
 * reads it from. Copying the codes across verbatim leaves every migrated column with a value the
 * app does not recognise, so they are translated here.
 *
 * Anything unrecognised is passed through unchanged rather than guessed at, so an unexpected value
 * stays visible in the data instead of being silently rewritten.
 */
const paymentDeduction = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^B0*1$/i.test(s) || /^payment$/i.test(s))   return 'Payment';
  if (/^B0*2$/i.test(s) || /^deduction$/i.test(s)) return 'Deduction';
  return s;
};

/**
 * Translate a legacy `calculation_function` into the target's formula language.
 *
 * The legacy engine wrote a bare `X` to mean "this column's own base amount". The target expresses
 * formulas as `{comp:id}` / `{col:id}` tokens and has no notion of `X`, so a copied `X` reaches
 * safeEval as an undefined variable, evaluates to 0, and OVERWRITES the correct value that
 * calcColumn's step 1 already computed by summing the column's linked salary components.
 *
 * Dropping it is the faithful translation, not a shortcut: step 1 computes exactly what `X` meant.
 * Verified against legacy run 334 — all 442 employees were paid Basic Salary equal to their notch
 * amount (3,867,376.09 in total), which is what summing the linked Basic Salary component yields.
 *
 * All 16 affected columns are Basic-Salary-type (Basic Salary, 13th Month Basic, Basic UTB, Casual
 * Labour …). Anything OTHER than a bare `X` is passed through untouched so a real formula is never
 * silently discarded — it would show up as a wrong figure rather than disappearing quietly.
 */
const calculationFunction = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^x$/i.test(s)) return null;
  return s;
};

/**
 * Read a legacy JSON array of ids, e.g. `["8","9","10"]`, into a string[].
 *
 * Tolerant of null, '', the literal '[]', and of a bare comma-separated string in case any row
 * predates the JSON format.
 */
const jsonIdList = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s || s === '[]' || s === 'null') return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
  } catch { /* fall through to CSV */ }
  return s.replace(/^\[|\]$/g, '').split(',').map(v => v.replace(/["']/g, '').trim()).filter(Boolean);
};

/**
 * Target columns for the employee insert, in the order the value arrays are built.
 *
 * Written unquoted and lower case on purpose: Postgres folded the Prisma camelCase names when the
 * schema was created, so `firstName` does not exist but `firstname` does.
 */
const EMPLOYEE_COLUMNS = [
  'employee_id', 'email', 'firstname', 'middlename', 'lastname',
  'dateofbirth', 'hiredate', 'confirmationdate', 'termination_date', 'retirement_date',
  'departmentid', 'branchid', 'unitid', 'outletid',
  'jobtitleid', 'employmentstatusid', 'nationalityid', 'paygradeid', 'notcheid',
  'genderid', 'religionid', 'titleid',
  'nassit_num', 'ssn_num', 'work_email', 'personal_email', 'mobilephone', 'phone',
  'bankaccount', 'address1', 'city', 'country', 'place_of_birth', 'marital_status',
  'lifecyclestatus', 'approvalstatus', 'approved_date',
  'father_name', 'mother_name', 'spouse_name', 'staff_level', 'staff_role',
  'status',
];

/* ── the loader ─────────────────────────────────────────────────────────── */

class MigrationRun {
  constructor({ sourceCfg = {}, targetUrl, scopes = plan.SCOPES, onProgress = () => {} }) {
    if (!targetUrl) throw new Error('A target database URL is required.');
    this.sourceCfg = sourceCfg;
    this.targetUrl = targetUrl;
    this.scopes = scopes;
    this.onProgress = onProgress;

    // legacy id -> new id, per entity. Built as steps run; later steps depend on earlier ones.
    this.map = {
      employee: new Map(),
      structure: new Map(),      // keyed by BOTH legacy id and comp_code: the source mixes them
      paygrade: new Map(),
      notch: new Map(),
      payrollColumn: new Map(),
      payrollRun: new Map(),
      codelist: new Map(),           // 'Job Titles:MANAGER' -> codelistvalue.id
      salaryComponent: new Map(),    // legacy salarycomponent.id -> target id
      calculationGroup: new Map(),   // legacy deductiongroup.id -> calculationgroups.id
      payFrequency: new Map(),       // legacy payfrequency.id -> payfrequencies.id
      payrollColumnName: new Map(),  // target payrollcolumns.id -> name (savedcalculations.target_name)
    };
    this.stats = [];
    this.warnings = [];
  }

  async connect() {
    // Each connection is labelled on failure: a bare "ECONNREFUSED" does not say whether the source
    // MySQL or the target Postgres refused, or which host was tried (the source defaults to localhost).
    const src = {
      host: this.sourceCfg.host ?? process.env.MIGRATION_SOURCE_HOST ?? 'localhost',
      port: Number(this.sourceCfg.port ?? process.env.MIGRATION_SOURCE_PORT ?? 3306),
      database: this.sourceCfg.database ?? process.env.MIGRATION_SOURCE_DB ?? 'hrmdata_rcb',
    };
    try {
      this.my = await mysql.createConnection({
        ...src,
        user: this.sourceCfg.user ?? process.env.MIGRATION_SOURCE_USER ?? 'root',
        password: this.sourceCfg.password ?? process.env.MIGRATION_SOURCE_PASSWORD ?? '',
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
    } catch (err) {
      throw new Error(`Cannot connect to the SOURCE MySQL at ${src.host}:${src.port}/${src.database} — ${err.message || err.code}`);
    }
    try {
      this.pg = new Client({ connectionString: this.targetUrl });
      await this.pg.connect();
    } catch (err) {
      let where = 'the target';
      try { const u = new URL(this.targetUrl); where = `${u.hostname}:${u.port || 5432}${u.pathname}`; } catch {}
      throw new Error(`Cannot connect to the TARGET Postgres at ${where} — ${err.message || err.code}`);
    }
  }

  async close() {
    if (this.my) await this.my.end().catch(() => {});
    if (this.pg) await this.pg.end().catch(() => {});
  }

  src(sql, params = []) { return this.my.query(sql, params).then(r => r[0]); }
  tgt(sql, params = []) { return this.pg.query(sql, params).then(r => r.rows); }

  /**
   * Insert many rows using as few statements as possible.
   *
   * The target is across a network link with ~550ms round-trip latency, so the cost of a load is
   * the NUMBER OF STATEMENTS, not the number of rows. A per-row loop projected to 96 hours for
   * the 628k payroll rows; batching brings it under 20 minutes. Never add a per-row INSERT here.
   *
   * Postgres caps a statement at 65535 bind parameters, so the chunk size is capped by column
   * count as well as by BATCH.
   */
  async insertMany(table, columns, rows, conflict = 'ON CONFLICT DO NOTHING', stepKey = null) {
    if (!rows.length) return 0;
    const perChunk = Math.max(1, Math.min(BATCH, Math.floor(60000 / columns.length)));
    let written = 0;

    for (let i = 0; i < rows.length; i += perChunk) {
      const chunk = rows.slice(i, i + perChunk);
      const values = chunk.map((_, r) =>
        `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(',')})`).join(',');
      await this.tgt(
        `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values} ${conflict}`,
        chunk.flat());
      written += chunk.length;
      // Reported per batch so the UI can show a real percentage rather than a spinner. Harmless
      // when no step key is given (small tables that finish in one statement).
      if (stepKey) this.onProgress({ phase: 'progress', step: stepKey, done: written, total: rows.length });
    }
    return written;
  }

  step(key, label) {
    const entry = { key, label, inserted: 0, updated: 0, skipped: 0, notes: [], startedAt: Date.now() };
    this.stats.push(entry);
    this.onProgress({ phase: 'start', step: key, label });
    return entry;
  }

  done(entry, extra = {}) {
    entry.elapsedMs = Date.now() - entry.startedAt;
    Object.assign(entry, extra);
    this.onProgress({ phase: 'done', step: entry.key, ...entry });
  }

  /* ── 1. Code lists ────────────────────────────────────────────────────── */
  // Old lookup tables become codelistvalue rows, matched BY LABEL against the codelists the
  // target already ships with. Nothing new is created if a label already exists.
  async loadCodelists() {
    const e = this.step('codelists', 'Code lists');

    const lists = await this.tgt(`SELECT cl.id, cl.name FROM codelist cl`);
    const byName = new Map(lists.map(r => [String(r.name).toLowerCase(), r.id]));

    const sources = [
      ['jobtitles',        'name', 'Job Titles'],
      ['employmentstatus', 'name', 'Employment Status'],
      ['nationality',      'name', 'Nationalities'],
    ];

    for (const [table, col, listName] of sources) {
      const listId = byName.get(listName.toLowerCase());
      if (!listId) { e.notes.push(`codelist "${listName}" not found in target — skipped`); continue; }

      const rows = await this.src(`SELECT id, \`${col}\` AS label FROM ${table}`);
      // Existing values, so we reuse rather than duplicate.
      const existing = await this.tgt(
        `SELECT id, label FROM codelistvalue WHERE codelistid = $1`, [listId]);
      const have = new Map(existing.map(r => [String(r.label).trim().toLowerCase(), r.id]));

      for (const r of rows) {
        const label = clean(r.label);
        if (!label) { e.skipped++; continue; }
        const k = label.toLowerCase();
        let id = have.get(k);
        if (!id) {
          const ins = await this.tgt(
            `INSERT INTO codelistvalue (codelistid, label, isactive, sortorder, createdat, updatedat)
             VALUES ($1, $2, true, 0, NOW(), NOW())
             ON CONFLICT DO NOTHING RETURNING id`, [listId, label]);
          if (ins.length) { id = ins[0].id; e.inserted++; }
          else {
            const again = await this.tgt(
              `SELECT id FROM codelistvalue WHERE codelistid = $1 AND LOWER(TRIM(label)) = $2`,
              [listId, k]);
            id = again[0]?.id;
          }
          if (id) have.set(k, id);
        } else e.updated++;

        if (id) this.map.codelist.set(`${listName}:${String(r.id)}`, id);
      }
      // Label-keyed entries too, so the recorded nationality fix (241 -> "Sierra Leonean") can
      // resolve by label rather than by legacy id.
      for (const [k, id] of have) this.map.codelist.set(`${listName}#${k}`, id);
    }

    // Gender, Religion and Marital Status have no legacy lookup table to import — the source
    // stores them as free text while the target stores codelist ids. Nothing is created here;
    // the target's existing values are simply indexed BY LABEL so employees can resolve against
    // them. Without this the byLabel() lookups in loadEmployees find nothing and the columns
    // silently stay null.
    const labelOnly = await this.tgt(`
      SELECT cl.name AS list, cv.id, cv.label
        FROM codelistvalue cv JOIN codelist cl ON cl.id = cv.codelistid
       WHERE cl.name IN ('Gender', 'Religion', 'Marital Status', 'Titles')`);
    for (const row of labelOnly) {
      this.map.codelist.set(`${row.list}#${String(row.label).trim().toLowerCase()}`, row.id);
    }
    e.notes.push(`${labelOnly.length} label-only codelist values indexed (Gender, Religion, Marital Status, Titles)`);

    this.done(e);
  }

  /* ── 1b. Access control ───────────────────────────────────────────────── */
  //
  // Roles, permissions and at least one usable login. Without these the migrated database is
  // unreachable: nobody can sign in, and every permission guard would refuse anyway.
  //
  // This is NOT legacy data — the old system's user and permission model is different and is not
  // carried across. It is copied from the CURRENT application database, which is the definition of
  // what this app's roles and permissions are. Nothing is invented: if a reference database is not
  // reachable the step reports that and does not fabricate a login.
  //
  // The admin's password hash is copied as-is, so the account keeps whatever password it already
  // has. No password is ever generated or logged here.
  async loadAccessControl() {
    const e = this.step('access', 'Roles, permissions and admin login');

    const referenceUrl = process.env.MIGRATION_REFERENCE_URL || process.env.PG_URL;
    if (!referenceUrl || referenceUrl === this.targetUrl) {
      e.notes.push('No separate reference database configured — skipped');
      this.done(e);
      return;
    }

    const { Client } = require('pg');
    const ref = new Client({ connectionString: referenceUrl, connectionTimeoutMillis: 20000 });
    try {
      await ref.connect();
    } catch (err) {
      e.notes.push(`Reference database unreachable (${err.message.split('\n')[0]}) — no login was created`);
      this.done(e);
      return;
    }

    try {
      const copy = async (table, columns, orderBy = 'id') => {
        const rows = (await ref.query(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${orderBy}`)).rows;
        if (!rows.length) return 0;
        // Ids are preserved: role_has_permissions and model_has_roles join on them, and keeping
        // them identical to the reference database makes the two comparable.
        const n = await this.insertMany(table, columns,
          rows.map(r => columns.map(c => r[c])), 'ON CONFLICT DO NOTHING');
        return n;
      };

      const roles = await copy('roles',
        ['id', 'name', 'guard_name', 'description', 'is_system', 'status', 'created_at', 'updated_at']);
      const perms = await copy('permissions', ['id', 'name', 'guard_name', 'created_at', 'updated_at']);
      const rhp = await copy('role_has_permissions', ['permission_id', 'role_id'], 'role_id');

      // Sequences must be moved past the copied ids, or the next insert collides.
      for (const t of ['roles', 'permissions']) {
        await this.tgt(
          `SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT MAX(id) FROM ${t}), 1))`)
          .catch(() => {});
      }

      // The admin account, matched to a migrated employee by staff code where possible.
      const adminUser = process.env.MIGRATION_ADMIN_USER || 'superadmin@usg.com';
      const admin = (await ref.query('SELECT * FROM users WHERE username = $1', [adminUser])).rows[0];
      if (!admin) {
        e.notes.push(`No user "${adminUser}" in the reference database — no login was created`);
      } else {
        // employeeid points at the reference database's employee table, whose ids do not survive
        // migration. Re-resolve it by staff code; leave null rather than point at the wrong person.
        //
        // Null is normal for a system account: the default superadmin is linked to UNIONADMIN,
        // which exists only in this application and not in the legacy source, so there is nothing
        // to link to. The login works either way — employeeid only drives self-service screens.
        let employeeId = null;
        let adminCode = null;
        if (admin.employeeid) {
          const code = (await ref.query('SELECT employee_id FROM employee WHERE id = $1', [admin.employeeid])).rows[0];
          adminCode = code?.employee_id ?? null;
          if (adminCode) {
            const match = await this.tgt('SELECT id FROM employee WHERE employee_id = $1', [adminCode]);
            employeeId = match[0]?.id ?? null;
          }
        }

        const ins = await this.tgt(`
          INSERT INTO users (username, password, employee, employeeid, status, theme, posted_by, created)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          ON CONFLICT DO NOTHING
          RETURNING id`,
          [admin.username, admin.password, admin.employee, employeeId,
           admin.status ?? '1', admin.theme ?? 'light', admin.posted_by ?? '0']);

        let userId = ins[0]?.id;
        if (!userId) {
          const found = await this.tgt('SELECT id FROM users WHERE username = $1', [admin.username]);
          userId = found[0]?.id;
        }

        if (userId) {
          // Same roles the account holds in the reference database.
          const refRoles = (await ref.query(
            `SELECT role_id FROM model_has_roles WHERE model_id = $1 AND model_type = 'users'`,
            [admin.id])).rows;
          for (const r of refRoles) {
            await this.tgt(
              `INSERT INTO model_has_roles (role_id, model_type, model_id)
               VALUES ($1,'users',$2) ON CONFLICT DO NOTHING`, [r.role_id, userId]);
          }
          await this.tgt(
            `SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))`)
            .catch(() => {});
          e.inserted++;
          e.notes.push(`Login "${admin.username}" created with ${refRoles.length} role(s) and its existing password`);
          if (!employeeId) {
            e.notes.push(adminCode
              ? `Not linked to an employee record: ${adminCode} is not in the legacy source (normal for a system account)`
              : 'Not linked to an employee record (normal for a system account)');
          }
        }
      }

      e.inserted += roles + perms + rhp;
      e.notes.push(`${roles} roles, ${perms} permissions, ${rhp} role-permission links`);
    } finally {
      await ref.end().catch(() => {});
    }

    this.done(e);
  }

  /* ── 2. Company structures ────────────────────────────────────────────── */
  // The source `type` column already holds the exact strings the target enum uses
  // ("Head Office", "Branch", ...), so it passes through unchanged.
  //
  // Employees reference structures inconsistently: `branch` holds a comp_code (751 rows) while
  // `department` is mostly a legacy id (560) with some comp_codes (243). The map is therefore
  // keyed by both, so either encoding resolves.
  async loadStructures() {
    const e = this.step('structures', 'Company structures');
    const rows = await this.src(
      `SELECT id, title, comp_code, description, address, type, country, parent2, approval_status
         FROM companystructures ORDER BY id`);

    // Batched, like every other step — see insertMany. A structure with no comp_code cannot be
    // matched on conflict, so those are inserted plainly and matched back by title.
    const values = rows.map(r => {
      const title = clean(r.title) ?? clean(r.comp_code) ?? `Structure ${r.id}`;
      return [title, clean(r.comp_code), clean(r.description) ?? title, clean(r.address),
              clean(r.type), clean(r.country) ?? '0', clean(r.approval_status)];
    });
    e.inserted += await this.insertMany('companystructures',
      ['title', 'comp_code', 'description', 'address', 'type', 'country', 'approval_status'],
      values,
      `ON CONFLICT (comp_code) DO UPDATE
          SET title = EXCLUDED.title, description = EXCLUDED.description, address = EXCLUDED.address`, 'structures');

    // Read the ids back in one query and key the map by BOTH legacy id and comp_code: employees
    // reference structures inconsistently (branch by code, department mostly by id).
    const loaded = await this.tgt(`SELECT id, title, comp_code FROM companystructures`);
    const byCode = new Map(loaded.filter(x => x.comp_code).map(x => [String(x.comp_code), x.id]));
    const byTitle = new Map(loaded.map(x => [String(x.title).trim().toLowerCase(), x.id]));
    for (const r of rows) {
      const code = clean(r.comp_code);
      const title = clean(r.title) ?? code ?? `Structure ${r.id}`;
      const id = (code && byCode.get(code)) ?? byTitle.get(title.trim().toLowerCase());
      if (!id) { e.skipped++; continue; }
      this.map.structure.set(`id:${String(r.id)}`, id);
      if (code) this.map.structure.set(`code:${code}`, id);
    }

    // parent2 is a self-reference, so it can only be set once every row exists. Done as a single
    // statement rather than one UPDATE per row — the target is remote and latency dominates.
    const links = rows
      .map(r => ({ parent: r.parent2 ? this.map.structure.get(`id:${String(r.parent2)}`) : null,
                   self: this.map.structure.get(`id:${String(r.id)}`) }))
      .filter(l => l.parent && l.self);
    if (links.length) {
      const vals = links.map((_, i) => `($${i * 2 + 1}::bigint,$${i * 2 + 2}::bigint)`).join(',');
      await this.tgt(
        `UPDATE companystructures s SET parent2 = v.parent
           FROM (VALUES ${vals}) AS v(parent, self) WHERE s.id = v.self`,
        links.flatMap(l => [l.parent, l.self]));
    }

    this.done(e);
  }

  /* ── 3. Pay grades and notches ────────────────────────────────────────── */
  // The target is a REMOTE database, so a query per row is dominated by round-trip latency — an
  // earlier version issued one SELECT and one INSERT per notch and took 6 minutes for 415 rows.
  // Everything here reads the whole target table once, then inserts only what is missing.
  async loadGrades() {
    const e = this.step('grades', 'Pay grades and notches');

    const existingGrades = await this.tgt(`SELECT id, name FROM paygrades`);
    const gradeByName = new Map(existingGrades.map(r => [String(r.name).trim().toLowerCase(), r.id]));

    // currency and the salary band are carried across, not just the name — they are what the Pay
    // Grades screen shows. An earlier version inserted the name alone, leaving every grade at
    // 0.00 in the app.
    for (const r of await this.src(`SELECT id, name, currency, min_salary, max_salary FROM paygrades ORDER BY id`)) {
      const name = tidyName(clean(r.name));
      if (!name) { e.skipped++; continue; }
      let id = gradeByName.get(name.toLowerCase());
      if (!id) {
        // paygrades.currency is NOT NULL (default ''), so a blank source value becomes '' rather
        // than null — passing null violates the constraint.
        const ins = await this.tgt(
          `INSERT INTO paygrades (name, currency, min_salary, max_salary)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [name, clean(r.currency) ?? '', r.min_salary ?? 0, r.max_salary ?? 0]);
        id = ins[0].id; gradeByName.set(name.toLowerCase(), id); e.inserted++;
      } else {
        // Refresh on a re-run, so a grade loaded by an earlier version is repaired — including
        // its name, which may still carry the legacy whitespace.
        await this.tgt(
          `UPDATE paygrades SET name = $1, currency = $2, min_salary = $3, max_salary = $4 WHERE id = $5`,
          [name, clean(r.currency) ?? '', r.min_salary ?? 0, r.max_salary ?? 0, id]);
        e.updated++;
      }
      this.map.paygrade.set(String(r.id), id);
    }

    const existingNotches = await this.tgt(`SELECT id, name, paygradeid, amount FROM notches`);
    // The AMOUNT is part of the key, not just the name and grade.
    //
    // Names are normalised on the way in (see tidyName), and two Band 1 notches differ ONLY by an
    // extra space — "B1 - Notch  10.5" at 132,970.51 and "B1 - Notch 10.5" at 159,564.62. Keying
    // on the normalised name alone would silently merge them and lose a real pay point.
    const notchKey = (name, grade, amount) =>
      `${tidyName(name).toLowerCase()}|${grade ?? ''}|${Number(amount ?? 0).toFixed(2)}`;
    const notchByKey = new Map(
      existingNotches.map(r => [notchKey(r.name, r.paygradeid, r.amount), r.id]));

    // `amount` and `currency` are carried across, not just the name: `notches.amount` IS the
    // notch's salary and it is what the Pay Grades screen displays. An earlier version inserted
    // only (name, paygradeid), which left every notch showing 0.00 in the app even though the
    // amount had been written to notch_components.
    const toInsert = [];
    const toRefresh = [];
    // notches.name is UNIQUE, so every name this step writes — whether inserted or refreshed —
    // has to stay distinct after tidying. See uniqueName.
    const takenNames = new Set(existingNotches.map(r => tidyName(r.name).toLowerCase()));
    for (const r of await this.src(`SELECT id, name, paygrade, amount, currency FROM notches ORDER BY id`)) {
      const tidied = tidyName(clean(r.name));
      if (!tidied) { e.skipped++; continue; }
      const grade = r.paygrade ? this.map.paygrade.get(String(r.paygrade)) ?? null : null;
      const existing = notchByKey.get(notchKey(tidied, grade, r.amount));
      // A name already held by a DIFFERENT notch must be disambiguated before it is written.
      const name = existing ? tidied : uniqueName(tidied, takenNames, r.amount);
      takenNames.add(name.toLowerCase());
      if (existing) {
        // Refresh an existing notch so a re-run repairs values written by an earlier version.
        // Collected and applied in ONE statement below: 392 individual UPDATEs against a remote
        // database took five minutes.
        // The NAME is refreshed too, so a notch loaded before names were normalised gets its
        // stray whitespace cleaned up on a re-run rather than staying ragged forever.
        // Only rename when no OTHER notch already holds the tidied name, or the UNIQUE index
        // rejects the update. Where it clashes the ragged name is kept — correct data matters
        // more than tidy spacing.
        const clash = [...notchByKey.entries()]
          .some(([k, id]) => id !== existing && k.startsWith(`${tidied.toLowerCase()}|`));
        toRefresh.push({
          id: existing,
          name: clash ? null : name,
          amount: r.amount ?? 0,
          currency: clean(r.currency),
        });
        this.map.notch.set(String(r.id), existing);
        e.updated++;
      } else {
        toInsert.push({ legacyId: String(r.id), name, grade, amount: r.amount ?? 0, currency: clean(r.currency) });
      }
    }

    // Apply every refresh in ONE statement — see the note above.
    for (let i = 0; i < toRefresh.length; i += BATCH) {
      const chunk = toRefresh.slice(i, i + BATCH);
      const vals = chunk
        .map((_, j) => `($${j * 4 + 1}::bigint, $${j * 4 + 2}::varchar, $${j * 4 + 3}::numeric, $${j * 4 + 4}::varchar)`)
        .join(',');
      await this.tgt(
        `UPDATE notches n
            SET name = COALESCE(v.name, n.name),
                amount = v.amount,
                currency = COALESCE(v.currency, n.currency)
           FROM (VALUES ${vals}) AS v(id, name, amount, currency)
          WHERE n.id = v.id`,
        chunk.flatMap(x => [x.id, x.name, x.amount, x.currency]));
    }

    // One multi-row INSERT rather than 400 single ones.
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      const vals = chunk.map((_, j) => `($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4})`).join(',');
      const params = chunk.flatMap(c => [c.name, c.grade, c.amount, c.currency]);
      const ins = await this.tgt(
        `INSERT INTO notches (name, paygradeid, amount, currency) VALUES ${vals}
         RETURNING id, name, paygradeid`, params);
      // RETURNING preserves insertion order, so results line up with the chunk.
      ins.forEach((row, j) => this.map.notch.set(chunk[j].legacyId, row.id));
      e.inserted += ins.length;
    }

    this.done(e);
  }

  /* ── 4. Employees ─────────────────────────────────────────────────────── */
  async loadEmployees() {
    const e = this.step('employees', 'Employees');

    const rows = await this.src(`
      SELECT id, employee_id, first_name, middle_name, last_name, gender, status,
             birthday, recruitment_date, confirmation_date, termination_date,
             department, branch, unit, outlet, supervisor,
             job_title, employment_status, pay_grade, notches, nationality,
             religion, nassit_num, ssn_num, work_email, private_email, mobile_phone, home_phone,
             bank_acc_no, address1, city, country, place_of_birth, marital_status,
             approval_status, approved_date, father_name, mother_name, spouse_name,
             retirement_date, staff_level, staff_role
        FROM employees ORDER BY id`);

    const structure = (v) => {
      const s = clean(v);
      if (!s) return null;
      return this.map.structure.get(`code:${s}`) ?? this.map.structure.get(`id:${s}`) ?? null;
    };
    const codeList = (listName, legacyId, fixField) => {
      const direct = this.map.codelist.get(`${listName}:${String(clean(legacyId) ?? '')}`);
      if (direct) return direct;
      // Fall back to a recorded fix for a dangling legacy id (e.g. nationality 241).
      const label = fixField ? plan.resolveLookup(fixField, legacyId, {}) : null;
      return label ? this.map.codelist.get(`${listName}#${label.toLowerCase()}`) ?? null : null;
    };

    // Gender, Religion and Titles are stored in the source as free text or as ids into tables
    // that no longer matter, but the target codelists already contain the right labels — so these
    // resolve BY LABEL. Gender is normalised first because the source holds four spellings for
    // two genders ("M"/"Male", "F"/"Female").
    const byLabel = (listName, value) => {
      const v = clean(value);
      return v ? this.map.codelist.get(`${listName}#${v.toLowerCase()}`) ?? null : null;
    };

    let synthesisedEmails = 0;
    let clearedWorkEmail = 0;
    // The target enforces UNIQUE on email, work_email AND personal_email. In the source,
    // 267 employees share a work_email (233 of them the switchboard address
    // rokelsl@rokelbank.sl) and a few share a private one. A duplicate cannot be written to a
    // unique column, so the FIRST holder keeps the address and later ones get NULL — the address
    // is shared rather than personal, so nothing identifying is lost.
    const seenEmail = new Set();
    const seenWork = new Set();
    const seenPersonal = new Set();
    const pending = [];                    // supervisor links, resolved after all rows exist
    const values = [];                     // value arrays, inserted in batches below
    const legacyByCode = new Map();        // staff code -> legacy employees.id
    const supervisorByCode = new Map();    // staff code -> legacy supervisor id

    for (const r of rows) {
      const code = plan.employeeKey(r);
      if (!code) { e.skipped++; e.notes.push(`legacy id ${r.id} has no employee_id`); continue; }

      // email is NOT NULL + UNIQUE in the target; see syntheticEmail for why this is needed.
      let email = clean(r.work_email) ?? clean(r.private_email);
      if (!email || seenEmail.has(email.toLowerCase())) { email = syntheticEmail(code); synthesisedEmails++; }
      seenEmail.add(email.toLowerCase());

      // Same uniqueness rule for the two optional address columns.
      let workEmail = clean(r.work_email);
      if (workEmail && seenWork.has(workEmail.toLowerCase())) { workEmail = null; clearedWorkEmail++; }
      else if (workEmail) seenWork.add(workEmail.toLowerCase());

      let personalEmail = clean(r.private_email);
      if (personalEmail && seenPersonal.has(personalEmail.toLowerCase())) personalEmail = null;
      else if (personalEmail) seenPersonal.add(personalEmail.toLowerCase());

      // Values in the same order as EMPLOYEE_COLUMNS below.
      //
      // firstname, lastname, approvalstatus and lifecyclestatus are NOT NULL *with defaults*. A
      // column default only applies when the column is omitted — passing an explicit NULL still
      // violates the constraint — so each one needs its own fallback here.
      //
      // Gender is normalised before lookup ("M"/"Male" -> "Male") because the source holds four
      // spellings for two genders; religion is free text matching the target labels. The SOURCE
      // stores both as text while the TARGET stores codelist ids, so this is where that
      // conversion happens. Title is NOT mapped: the source holds ids 52/53/54 into a `titles`
      // table that is EMPTY, so there is nothing to resolve against and a guess would be worse
      // than a null.
      values.push([
        code, email, clean(r.first_name) ?? '', clean(r.middle_name), clean(r.last_name) ?? '',
        date(r.birthday), date(r.recruitment_date), date(r.confirmation_date),
        date(r.termination_date), date(r.retirement_date),
        structure(r.department), structure(r.branch), structure(r.unit), structure(r.outlet),
        codeList('Job Titles', r.job_title), codeList('Employment Status', r.employment_status),
        codeList('Nationalities', r.nationality, 'nationality'),
        r.pay_grade ? this.map.paygrade.get(String(r.pay_grade)) ?? null : null,
        r.notches ? this.map.notch.get(String(r.notches)) ?? null : null,
        byLabel('Gender', plan.normaliseGender(r.gender)),
        byLabel('Religion', r.religion),
        null,
        clean(r.nassit_num), clean(r.ssn_num), workEmail, personalEmail,
        clean(r.mobile_phone), clean(r.home_phone),
        clean(r.bank_acc_no), clean(r.address1), clean(r.city), clean(r.country),
        clean(r.place_of_birth), clean(r.marital_status),
        plan.normaliseLifecycle(r.status) ?? 'PENDING',
        (clean(r.approval_status) ?? 'APPROVED').toUpperCase(),
        date(r.approved_date),
        clean(r.father_name), clean(r.mother_name), clean(r.spouse_name),
        int(r.staff_level), int(r.staff_role),
        plan.normaliseLifecycle(r.status) === 'ACTIVE' ? '1' : '0',
      ]);
      legacyByCode.set(code, String(r.id));
      if (clean(r.supervisor)) supervisorByCode.set(code, String(r.supervisor));
    }

    // Batched for the same reason as everywhere else: at ~550ms round-trip latency, a per-row
    // INSERT took 11 minutes for 1,280 employees.
    e.inserted += await this.insertMany('employee', EMPLOYEE_COLUMNS, values,
      `ON CONFLICT (employee_id) DO UPDATE SET
         firstname = EXCLUDED.firstname, lastname = EXCLUDED.lastname,
         middlename = EXCLUDED.middlename, nassit_num = EXCLUDED.nassit_num,
         departmentid = EXCLUDED.departmentid, branchid = EXCLUDED.branchid,
         jobtitleid = EXCLUDED.jobtitleid, employmentstatusid = EXCLUDED.employmentstatusid,
         nationalityid = EXCLUDED.nationalityid, genderid = EXCLUDED.genderid,
         religionid = EXCLUDED.religionid, paygradeid = EXCLUDED.paygradeid,
         notcheid = EXCLUDED.notcheid, lifecyclestatus = EXCLUDED.lifecyclestatus,
         updatedat = NOW()`, 'employees');

    // Read the ids back in one query rather than using RETURNING per row.
    for (const row of await this.tgt(`SELECT id, employee_id FROM employee`)) {
      const legacy = legacyByCode.get(String(row.employee_id).trim().toUpperCase());
      if (legacy) this.map.employee.set(legacy, row.id);
    }
    for (const [code, supervisorLegacyId] of supervisorByCode) {
      const self = this.map.employee.get(legacyByCode.get(code));
      if (self) pending.push({ self, supervisor: supervisorLegacyId });
    }

    // Supervisors are employees, so they can only be linked once every employee row exists.
    // Batched into multi-row UPDATEs: 1,162 single statements against a remote database is slow
    // enough to dominate the whole step.
    const links = pending
      .map(p => ({ sup: this.map.employee.get(p.supervisor), self: p.self }))
      .filter(l => l.sup);
    let linked = 0;
    for (let i = 0; i < links.length; i += BATCH) {
      const chunk = links.slice(i, i + BATCH);
      const vals = chunk.map((_, j) => `($${j * 2 + 1}::bigint,$${j * 2 + 2}::bigint)`).join(',');
      await this.tgt(
        `UPDATE employee e SET supervisorid = v.sup
           FROM (VALUES ${vals}) AS v(sup, self) WHERE e.id = v.self`,
        chunk.flatMap(l => [l.sup, l.self]));
      linked += chunk.length;
    }

    e.notes.push(`${synthesisedEmails} employees given a placeholder e-mail (<code>@imported.local)`);
    e.notes.push(`${clearedWorkEmail} work e-mails cleared as duplicates of a shared address (the first holder keeps it)`);
    e.notes.push(`${linked} supervisor links resolved`);
    this.done(e);
  }

  /* ── 4b. Salary components ────────────────────────────────────────────── */
  //
  // The salary rows carry a `component` id, so without this table the app cannot name any of them.
  //
  // Where each amount actually comes from — measured against payrolldata, not assumed:
  //   * Basic Salary is driven by `notches.amount`. In the latest real run (AUG 2026, Permanent
  //     Staff) it matched for 442 of 442 employees, while `employeesalary` matched the paid Basic
  //     0 times in 21,212 rows. So Basic is notch-linked and its per-employee rows are noise.
  //   * Deductions and a few allowances DO come from `employeesalary` (Medical Scheme 86%,
  //     Senior Staff Assoc 88%, Union Dues 60% — the shortfall is historical drift, not a
  //     different source).
  //   * The rest (rent, rice, overtime, casual labour) are computed by payroll column formulas and
  //     carry no stored amount at all. The user confirmed these keep being formula-driven; the
  //     components exist for naming and GL mapping only.
  //
  // Payment vs deduction is NOT stored on the component. In the current design that lives
  // directly on the payroll column (`payrollcolumns.payment_deduction` = "Payment"/"Deduction"),
  // which is where the application reads it from — only 3 of 16 components in the live database
  // carry a `componenttype` at all. The legacy `componentType` is also unmaintained and wrong
  // (Medical Scheme and Union Contribution are both marked Payment despite being deductions), so
  // it is deliberately not copied.
  async loadSalaryComponents() {
    const e = this.step('components', 'Salary components');

    const existing = await this.tgt(`SELECT id, name FROM salarycomponent`);
    const byName = new Map(existing.map(r => [String(r.name).trim().toLowerCase(), r.id]));

    const src = await this.src(`
      SELECT id, name, salarycomp_gl, branch, summary, processing_code, details
        FROM salarycomponent
       WHERE id IN (SELECT DISTINCT component FROM employeesalary)
          OR id IN (SELECT DISTINCT component FROM employeesalary)
       ORDER BY id`);

    let reused = 0;
    const toInsert = [];
    for (const r of src) {
      const name = clean(r.name);
      if (!name) { e.skipped++; continue; }
      // Reuse a component the target already has, so the 7 overlapping names do not duplicate.
      if (byName.has(name.toLowerCase())) { reused++; continue; }
      toInsert.push([name, clean(r.salarycomp_gl), clean(r.branch), clean(r.summary),
        clean(r.processing_code), clean(r.details),
        // Only Basic Salary is notch-linked, and the data proves it: 442/442 in the latest run.
        /^basic salary$/i.test(name)]);
    }

    e.inserted += await this.insertMany('salarycomponent',
      ['name', 'salarycomp_gl', 'branch', 'summary', 'processing_code', 'details',
       'is_notch_linked'],
      toInsert, 'ON CONFLICT DO NOTHING', 'components');

    await this.tgt(
      `SELECT setval(pg_get_serial_sequence('salarycomponent','id'), GREATEST((SELECT MAX(id) FROM salarycomponent), 1))`)
      .catch(() => {});

    // Map legacy component id -> target id, for employeesalary and notch_components.
    for (const row of await this.tgt(`SELECT id, name FROM salarycomponent`)) {
      byName.set(String(row.name).trim().toLowerCase(), row.id);
    }
    for (const r of src) {
      const name = clean(r.name);
      const id = name ? byName.get(name.toLowerCase()) : null;
      if (id) this.map.salaryComponent.set(String(r.id), id);
    }

    e.notes.push(`${toInsert.length} created, ${reused} already present and reused`);
    e.notes.push('Payment/deduction is set on the payroll columns, not on components');
    this.done(e);
  }

  /* ── 4c. Notch-linked amounts ─────────────────────────────────────────── */
  //
  // Basic Salary lives on the notch in both systems, so this is a direct copy rather than a
  // restructure: legacy `notches.amount` becomes a `notch_components` row for Basic Salary.
  async loadNotchComponents() {
    const e = this.step('notchcomponents', 'Notch salary amounts');

    const basic = await this.tgt(
      `SELECT id FROM salarycomponent WHERE LOWER(TRIM(name)) = 'basic salary'`);
    const basicId = basic[0]?.id;
    if (!basicId) {
      e.notes.push('No Basic Salary component in the target — skipped');
      this.done(e);
      return;
    }

    // Clear what this migration owns before reloading: notch_components has no natural key.
    const notchIds = [...new Set(this.map.notch.values())];
    if (notchIds.length) {
      await this.tgt(
        `DELETE FROM notch_components WHERE notch_id = ANY($1::bigint[]) AND component_id = $2`,
        [notchIds, basicId]);
    }

    const rows = [];
    for (const r of await this.src(`SELECT id, amount FROM notches WHERE amount IS NOT NULL`)) {
      const notchId = this.map.notch.get(String(r.id));
      if (!notchId) { e.skipped++; continue; }
      rows.push([notchId, basicId, r.amount ?? 0, null]);
    }

    e.inserted += await this.insertMany('notch_components',
      ['notch_id', 'component_id', 'amount', 'working_days'],
      rows, 'ON CONFLICT DO NOTHING', 'notchcomponents');

    e.notes.push(`Basic Salary attached to ${rows.length} notches (verified: 442/442 employees in the latest real run were paid their notch amount)`);

    // Basic Salary belongs on the NOTCH, so its per-employee rows are removed rather than left to
    // clutter the exceptions screen with values that were never used.
    //
    // The legacy rows are not overrides: measured against the latest real run, 444 of 444
    // employees were paid their NOTCH amount and none matched their employeesalary row. The
    // per-employee values are also implausible as salaries — 808.04 appears against notches
    // ranging from 6,548 to 21,587, so it is a leftover rather than anyone's pay.
    //
    // Deleted only where the notch actually supplies the amount, so nobody loses their basic pay.
    const cleared = await this.tgt(`
      DELETE FROM employeesalary es
       USING employee e, notch_components nc
       WHERE es.employee = e.id
         AND es.component = $1
         AND nc.notch_id = e.notcheid
         AND nc.component_id = $1
      RETURNING 1`, [basicId]);
    if (cleared.length) {
      e.notes.push(`${cleared.length.toLocaleString()} per-employee Basic Salary rows removed — the notch supplies it`);
    }

    // Same for any pay-grade row: Basic Salary is notch-linked, so a grade-level amount would
    // compete with the notch for the same component.
    const gradeRows = await this.tgt(
      `DELETE FROM paygrade_components WHERE component_id = $1 RETURNING 1`, [basicId]);
    if (gradeRows.length) {
      e.notes.push(`${gradeRows.length} pay-grade Basic Salary rows removed — it is notch-linked`);
    }

    this.done(e);
  }

  /* ── 5. Payroll configuration ─────────────────────────────────────────── */
  async loadPayrollConfig() {
    const e = this.step('payrollconfig', 'Payroll columns');

    // Read the target once, insert what is missing in one statement, then read the ids back —
    // rather than a SELECT and an INSERT per column. See insertMany for why.
    const existing = await this.tgt(`SELECT id, name FROM payrollcolumns`);
    const byName = new Map(existing.map(r => [String(r.name).trim().toLowerCase(), r.id]));

    const src = await this.src(`
      SELECT id, name, salarycomponent_gl, posting_column, payment_deduction, posting_branch,
             colorder, editable, enabled, default_value, calculation_function, function_type
        FROM payrollcolumns ORDER BY id`);

    const toInsert = [];
    for (const r of src) {
      const name = clean(r.name);
      if (!name) { e.skipped++; continue; }
      if (byName.has(name.toLowerCase())) { e.updated++; continue; }
      toInsert.push([name, clean(r.salarycomponent_gl), clean(r.posting_column),
        paymentDeduction(r.payment_deduction), clean(r.posting_branch), int(r.colorder),
        clean(r.editable), clean(r.enabled), clean(r.default_value),
        calculationFunction(r.calculation_function), clean(r.function_type)]);
    }
    e.inserted += await this.insertMany('payrollcolumns',
      ['name', 'salarycomponent_gl', 'posting_column', 'payment_deduction', 'posting_branch',
       'colorder', 'editable', 'enabled', 'default_value', 'calculation_function', 'function_type'],
      toInsert, 'ON CONFLICT DO NOTHING', 'payrollconfig');

    for (const row of await this.tgt(`SELECT id, name FROM payrollcolumns`)) {
      byName.set(String(row.name).trim().toLowerCase(), row.id);
    }
    for (const r of src) {
      const name = clean(r.name);
      const id = name ? byName.get(name.toLowerCase()) : null;
      if (id) {
        this.map.payrollColumn.set(String(r.id), id);
        // Name kept too: savedcalculations stores target_name alongside target_id.
        this.map.payrollColumnName.set(String(id), name);
      }
    }

    this.done(e);
  }

  /* ── 6. Payroll runs ──────────────────────────────────────────────────── */
  async loadPayrollRuns() {
    const e = this.step('payrollruns', 'Payroll runs');

    // Runs have no natural unique key in the target, so they are matched on (name, date_start).
    // Batched like everything else — a per-row insert-then-select took ~1s per run.
    const existing = await this.tgt(`SELECT id, name, date_start FROM payrollruns`);
    const runKey = (name, start) =>
      `${String(name).trim().toLowerCase()}|${start ? new Date(start).toISOString().slice(0, 10) : ''}`;
    const byKey = new Map(existing.map(r => [runKey(r.name, r.date_start), r.id]));

    const src = await this.src(`
      SELECT id, name, pay_period, date_start, date_end, status, deduction_group,
             documentRef, payment_log, posting_date, finalized_date, approved_by, approved_date
        FROM payroll ORDER BY id`);

    const toInsert = [];
    for (const r of src) {
      const name = clean(r.name) ?? `Run ${r.id}`;
      if (byKey.has(runKey(name, date(r.date_start)))) { e.updated++; continue; }
      toInsert.push([name, int(r.pay_period), date(r.date_start), date(r.date_end),
        clean(r.status) ?? 'Draft', int(r.deduction_group), clean(r.documentRef),
        clean(r.payment_log), date(r.finalized_date) ?? date(r.posting_date),
        int(r.approved_by), date(r.approved_date)]);
    }
    e.inserted += await this.insertMany('payrollruns',
      ['name', 'pay_frequency', 'date_start', 'date_end', 'status', 'deduction_group',
       'document_ref', 'payment_log', 'finalized_at', 'approved_by', 'approved_at'],
      toInsert, 'ON CONFLICT DO NOTHING', 'payrollruns');

    for (const row of await this.tgt(`SELECT id, name, date_start FROM payrollruns`)) {
      byKey.set(runKey(row.name, row.date_start), row.id);
    }
    for (const r of src) {
      const name = clean(r.name) ?? `Run ${r.id}`;
      const id = byKey.get(runKey(name, date(r.date_start)));
      if (id) this.map.payrollRun.set(String(r.id), id);
      else e.skipped++;
    }

    this.done(e);
  }

  /* ── 7. Payroll roster and salaries ───────────────────────────────────── */
  /* ── 6b. Payroll configuration ────────────────────────────────────────── */
  //
  // Pay frequencies and calculation groups. The roster rows already carry these ids, but the
  // lookup tables they point at are empty after a migration, so the UI shows nothing.
  //
  // IDS ARE NOT COPIED — they are matched BY NAME and the roster is rewritten, because the two
  // systems number frequencies differently:
  //
  //   source 1 Bi Weekly  -> app 2 Bi-Weekly        source 2 Weekly -> app 1 Weekly
  //   source 5 Yearly     -> app 6 Yearly           (app id 5 is Quarterly)
  //
  // Copying ids would have labelled 1,055 Yearly employees as Quarterly and swapped Weekly with
  // Bi-Weekly. Matching ignores case, spaces and hyphens so "Bi Weekly" meets "Bi-Weekly".
  //
  // The app reads `payfrequencies` (plural) and `calculationgroups`; the singular `payfrequency`
  // and `deductiongroup` tables are legacy leftovers and are deliberately left alone.
  async loadPayrollConfiguration() {
    const e = this.step('payrollconfiguration', 'Pay frequencies and calculation groups');

    const matchKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // ── Pay frequencies ────────────────────────────────────────────────
    const existingFreq = await this.tgt(`SELECT id, name FROM payfrequencies`);
    const freqByKey = new Map(existingFreq.map(r => [matchKey(r.name), r.id]));

    // Seed the application's own list first if the target has none — it is configuration, like
    // roles and codelists, not legacy data.
    if (!existingFreq.length) {
      const seeded = await this.copyFromReference(
        'payfrequencies', ['id', 'name', 'description', 'sort_order', 'is_active']);
      if (seeded) {
        for (const r of await this.tgt(`SELECT id, name FROM payfrequencies`)) {
          freqByKey.set(matchKey(r.name), r.id);
        }
        e.notes.push(`${seeded} pay frequencies seeded from the reference database`);
      }
    }

    const freqMap = new Map();                 // legacy id -> target id
    let freqCreated = 0;
    for (const r of await this.src(`SELECT id, name FROM payfrequency ORDER BY id`)) {
      const name = clean(r.name);
      if (!name) continue;
      let id = freqByKey.get(matchKey(name));
      if (!id) {
        // A legacy frequency the application does not have is created rather than dropped.
        const ins = await this.tgt(
          `INSERT INTO payfrequencies (name, description, sort_order, is_active)
           VALUES ($1, $1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM payfrequencies), TRUE)
           RETURNING id`, [name]);
        id = ins[0].id;
        freqByKey.set(matchKey(name), id);
        freqCreated++;
      }
      freqMap.set(String(r.id), id);
      // Shared with the calculation-rules step, whose exemption update must match the rewritten row.
      this.map.payFrequency.set(String(r.id), id);
    }

    // ── Calculation groups (the legacy "deduction groups") ─────────────
    const existingGrp = await this.tgt(`SELECT id, name FROM calculationgroups`);
    const grpByKey = new Map(existingGrp.map(r => [matchKey(r.name), r.id]));

    const grpMap = new Map();
    let grpCreated = 0;
    for (const r of await this.src(`SELECT id, name, description FROM deductiongroup ORDER BY id`)) {
      const name = clean(r.name);
      if (!name) continue;
      let id = grpByKey.get(matchKey(name));
      if (!id) {
        const ins = await this.tgt(
          `INSERT INTO calculationgroups (name, details, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW()) RETURNING id`, [name, clean(r.description) ?? name]);
        id = ins[0].id;
        grpByKey.set(matchKey(name), id);
        grpCreated++;
      }
      grpMap.set(String(r.id), id);
      // Shared with the calculation-rules step, which attaches each rule to its group.
      this.map.calculationGroup.set(String(r.id), id);
    }

    for (const t of ['payfrequencies', 'calculationgroups']) {
      await this.tgt(
        `SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT MAX(id) FROM ${t}), 1))`)
        .catch(() => {});
    }

    // ── Rewrite the roster to the new ids ──────────────────────────────
    // Done from the SOURCE rows rather than by translating what is already in the target: running
    // this twice must not re-translate an id that has already been rewritten.
    const roster = [];
    for (const r of await this.src(
      `SELECT employee, pay_frequency, deduction_group FROM payrollemployees`)) {
      const emp = this.map.employee.get(String(r.employee));
      if (!emp) continue;
      roster.push({
        employee: emp,
        freq: freqMap.get(String(clean(r.pay_frequency) ?? '')) ?? null,
        group: grpMap.get(String(clean(r.deduction_group) ?? '')) ?? null,
        legacyFreq: int(r.pay_frequency),
      });
    }

    let rewritten = 0;
    for (let i = 0; i < roster.length; i += BATCH) {
      const chunk = roster.slice(i, i + BATCH);
      const vals = chunk
        .map((_, j) => `($${j * 4 + 1}::bigint, $${j * 4 + 2}::int, $${j * 4 + 3}::int, $${j * 4 + 4}::bigint)`)
        .join(',');
      const res = await this.tgt(
        `UPDATE payrollemployees pe
            SET pay_frequency = COALESCE(v.new_freq, pe.pay_frequency),
                deduction_group = COALESCE(v.new_group, pe.deduction_group)
           FROM (VALUES ${vals}) AS v(employee, legacy_freq, new_freq, new_group)
          WHERE pe.employee = v.employee AND pe.pay_frequency = v.legacy_freq
        RETURNING 1`,
        chunk.flatMap(x => [x.employee, x.legacyFreq, x.freq, x.group]));
      rewritten += res.length;
    }

    // ── Rewrite the payroll RUNS too ───────────────────────────────────
    //
    // `payrollruns` carries the same two ids, and leaving them at their legacy values breaks
    // generation outright: a run then selects employees by a frequency and group that either do
    // not exist or — worse — now mean something else. Before this, 77 runs pointed at group 10,
    // which after remapping resolves to "UTB Calculation Group", and 6 Yearly runs showed as
    // Quarterly. Generation failed with "No employees found for this pay frequency".
    //
    // Keyed on the run's NAME and start date rather than its id, since run ids are reassigned on
    // insert; the legacy pair is matched so a re-run cannot translate an already-translated value.
    const runRows = [];
    for (const r of await this.src(
      `SELECT name, date_start, pay_period, deduction_group FROM payroll`)) {
      const name = clean(r.name);
      if (!name) continue;
      runRows.push({
        name,
        start: date(r.date_start),
        legacyFreq: int(r.pay_period),
        freq: freqMap.get(String(clean(r.pay_period) ?? '')) ?? null,
        group: grpMap.get(String(clean(r.deduction_group) ?? '')) ?? null,
      });
    }

    let runsFixed = 0;
    for (let i = 0; i < runRows.length; i += BATCH) {
      const chunk = runRows.slice(i, i + BATCH);
      const vals = chunk
        .map((_, j) => `($${j * 5 + 1}::varchar,$${j * 5 + 2}::date,$${j * 5 + 3}::int,$${j * 5 + 4}::int,$${j * 5 + 5}::bigint)`)
        .join(',');
      const res = await this.tgt(
        `UPDATE payrollruns pr
            SET pay_frequency  = COALESCE(v.new_freq, pr.pay_frequency),
                deduction_group = COALESCE(v.new_group, pr.deduction_group)
           FROM (VALUES ${vals}) AS v(name, start_date, legacy_freq, new_freq, new_group)
          WHERE pr.name = v.name
            AND pr.date_start IS NOT DISTINCT FROM v.start_date
            AND pr.pay_frequency IS NOT DISTINCT FROM v.legacy_freq
        RETURNING 1`,
        chunk.flatMap(x => [x.name, x.start, x.legacyFreq, x.freq, x.group]));
      runsFixed += res.length;
    }

    e.inserted += freqCreated + grpCreated;
    e.notes.push(`${freqMap.size} pay frequencies mapped by name (${freqCreated} created); ids differ between the systems, so the roster was rewritten`);
    e.notes.push(`${grpMap.size} calculation groups mapped (${grpCreated} created)`);
    e.notes.push(`${rewritten.toLocaleString()} roster rows pointed at the new ids`);
    e.notes.push(`${runsFixed.toLocaleString()} payroll runs pointed at the new ids`);

    // ── Payslip templates ──────────────────────────────────────────────
    // Application configuration, not legacy data, so these come from the reference database.
    //
    // Only the GLOBAL template is copied. The others are scoped to a calculation group and a
    // payment type, and those ids do not survive migration — a template carrying a stale
    // deduction_group_id would silently render for the wrong staff. Payment types have no legacy
    // equivalent at all, so those templates are reported for someone to re-point in the app.
    const templates = await this.tgt(`SELECT COUNT(*)::int n FROM payslip_settings`);
    if (!templates[0].n) {
      const copied = await this.copyFromReference('payslip_settings',
        ['company_name', 'company_address', 'company_logo_url', 'header_note', 'footer_note',
         'accent_color', 'show_emp_id', 'show_department', 'show_position', 'show_bank_account',
         'template_name', 'visible_columns', 'net_columns', 'payslip_columns'],
        `WHERE deduction_group_id IS NULL AND payment_type_id IS NULL`);
      if (copied) {
        e.inserted += copied;
        e.notes.push(`${copied} global payslip template copied from the reference database`);
      } else {
        e.notes.push('No global payslip template could be copied — create one under Payroll → Report Templates');
      }
    }

    // ── Per-group report templates, from the legacy `paysliptemplates` ──
    //
    // The legacy source has one template per staff category (Permanent, Contract, Management,
    // Senior Management, UTB), each a JSON array of ordered entries. Without them every run falls
    // back to the single global template, so a Management payroll shows Permanent Staff's columns —
    // or, where someone has since made a stub group-scoped template, almost no columns at all.
    //
    // Only `type: "Payroll Column"` entries carry a column; the rest are logos, separators and free
    // text, which the target renders from its own settings. `status` is "Show"/"Hide", and the array
    // order IS the display order, so it is preserved exactly rather than re-sorted by colorder.
    //
    // Matched to a calculation group by NAME ("Management Staff Payslip Template" -> "Management
    // Staff"), because the legacy template table carries no group id at all.
    const tplSrc = await this.src(`SELECT id, name, data FROM paysliptemplates ORDER BY id`);
    if (tplSrc.length) {
      // legacy group name (normalised) -> target calculationgroups.id
      const groupByName = new Map();
      for (const g of await this.src(`SELECT id, name FROM deductiongroup`)) {
        const target = this.map.calculationGroup.get(String(g.id));
        if (target) groupByName.set(String(g.name).trim().toLowerCase(), target);
      }

      const existing = new Set((await this.tgt(
        `SELECT template_name FROM payslip_settings WHERE template_name IS NOT NULL`))
        .map(r => String(r.template_name).trim().toLowerCase()));

      // Legacy column ids whose name is a "Net Salary" variant. The target renders net pay itself,
      // from each column's include_in_net flag (see loadPayrollColumnRefs), so a Net Salary column
      // on the template would print the same figure twice — once as a line and once as Net Pay.
      //
      // The COLUMN still migrates, with its history: 25,722 rows across 137 completed runs hold the
      // net figure as actually paid, and a reprinted payslip must show that rather than a figure
      // recomputed from today's flags. It is only dropped from the template layout.
      const legacyNetColumns = new Set(
        (await this.src(`SELECT id FROM payrollcolumns WHERE name LIKE 'Net Salary%'`))
          .map(r => String(r.id)));

      // legacy column id -> its legacy deduction_group, for scoping a template by its columns when
      // the name cannot be matched. Read from the source because the target's payrollcolumn_groups
      // is not populated until a later step.
      const sourceColumnGroup = new Map();
      for (const row of await this.src(
        `SELECT id, deduction_group FROM payrollcolumns
          WHERE deduction_group IS NOT NULL AND deduction_group <> 0`)) {
        sourceColumnGroup.set(String(row.id), String(row.deduction_group));
      }

      let made = 0, unmatched = 0, droppedCols = 0, droppedNet = 0, byColumns = 0;
      for (const t of tplSrc) {
        const name = clean(t.name);
        if (!name || existing.has(name.toLowerCase())) continue;

        let parsed = null;
        try { parsed = JSON.parse(t.data || '[]'); } catch { /* reported below */ }
        if (!Array.isArray(parsed)) { e.skipped++; continue; }

        const columnIds = [];
        const legacyColumnIds = [];
        for (const entry of parsed) {
          if (String(entry?.type) !== 'Payroll Column') continue;
          if (String(entry?.status) === 'Hide') continue;
          const legacyId = String(entry?.payrollColumn ?? '').trim();
          if (!legacyId || legacyId === 'NULL') continue;
          if (legacyNetColumns.has(legacyId)) { droppedNet++; continue; }
          const target = this.map.payrollColumn.get(legacyId);
          // A column that never migrated is dropped rather than guessed at — leaving a stale id in
          // visible_columns would render a blank column with no way to tell why.
          if (!target) { droppedCols++; continue; }
          columnIds.push(String(target));
          legacyColumnIds.push(legacyId);
        }
        if (!columnIds.length) { e.skipped++; continue; }

        // "Management Staff Payslip Template" -> "management staff", matching the calculation group.
        const groupKey = name.toLowerCase()
          .replace(/\s*payslip\s*template\s*$/, '')
          .replace(/\s*payslip\s*$/, '')
          .trim();
        let groupId = groupByName.get(groupKey) ?? null;

        // Fall back to the group the template's own COLUMNS belong to.
        //
        // Not every name is derivable: "UTB Payslip UTB" normalises to "utb payslip utb" because
        // its suffix sits mid-name, while the group is "UTB Calculation Group UTB". Left unscoped
        // the run falls through to the global Default template, which lists Permanent Staff columns
        // — on a UTB run that renders 0 of 18 columns with data, i.e. an empty report.
        //
        // Read from the SOURCE columns' own `deduction_group` rather than the target's
        // payrollcolumn_groups, because that table is populated by a later step. Requiring a clear
        // majority keeps a template that mixes groups unscoped rather than mis-assigned, and that is
        // evidence from the data rather than a guess at the name.
        if (!groupId && legacyColumnIds.length) {
          const tally = new Map();
          for (const legacyId of legacyColumnIds) {
            const legacyGroup = sourceColumnGroup.get(String(legacyId));
            const target = legacyGroup ? this.map.calculationGroup.get(String(legacyGroup)) : null;
            if (target) tally.set(String(target), (tally.get(String(target)) ?? 0) + 1);
          }
          const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
          const rest = ranked.slice(1).reduce((sum, [, n]) => sum + n, 0);
          if (ranked.length && ranked[0][1] > rest) {
            groupId = ranked[0][0];
            byColumns++;
          }
        }
        if (!groupId) unmatched++;

        await this.tgt(
          `INSERT INTO payslip_settings (template_name, deduction_group_id, visible_columns, payslip_columns)
           VALUES ($1, $2, $3, $3)`,
          [name, groupId, JSON.stringify(columnIds)]);
        made++;
      }

      e.inserted += made;
      if (made) e.notes.push(`${made} per-group report templates built from the legacy payslip templates`);
      if (droppedNet) e.notes.push(`${droppedNet} Net Salary column(s) left off the templates — the payslip renders Net Pay itself; the columns and their history are still migrated`);
      if (byColumns) e.notes.push(`${byColumns} template(s) scoped by the group their columns belong to, the name not being derivable`);
      if (unmatched) e.notes.push(`${unmatched} template(s) could not be matched to a calculation group — imported unscoped, set the group in the app`);
      if (droppedCols) e.notes.push(`${droppedCols} template column(s) dropped — the payroll column did not migrate`);
    }

    this.done(e);
  }

  /**
   * Copy a configuration table from the reference database, preserving ids.
   *
   * Used for lists the application ships with rather than anything the legacy system owns.
   * Returns the number of rows copied, or 0 when no reference database is available.
   */
  async copyFromReference(table, columns, where = '') {
    const referenceUrl = process.env.MIGRATION_REFERENCE_URL || process.env.PG_URL;
    if (!referenceUrl || referenceUrl === this.targetUrl) return 0;

    const { Client } = require('pg');
    const ref = new Client({ connectionString: referenceUrl, connectionTimeoutMillis: 20000 });
    try {
      await ref.connect();
      const rows = (await ref.query(`SELECT ${columns.join(',')} FROM ${table} ${where} ORDER BY id`)).rows;
      if (!rows.length) return 0;
      await this.insertMany(table, columns,
        rows.map(r => columns.map(c => r[c])), 'ON CONFLICT DO NOTHING');
      await this.tgt(
        `SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`)
        .catch(() => {});
      return rows.length;
    } catch {
      return 0;                                 // reported by the caller's own counts
    } finally {
      await ref.end().catch(() => {});
    }
  }

  /* ── 6c. Calculation rules ────────────────────────────────────────────── */
  //
  // The legacy `deductions` table IS the calculation rules — 102 of them, each holding a
  // `rangeAmounts` JSON array of bands: the PAYE tax ladder, NASSIT 10%, Transport 10%, Rent 35%.
  //
  // The target expresses the same thing across two tables: `savedcalculations` (the rule, its
  // target and its calculation group) and `calculationprocessitems` (one row per band). So the
  // JSON array is unrolled rather than translated — the formulas themselves are already
  // compatible, `((X)*0.15)` appearing verbatim on both sides.
  //
  // Three links are established here, and all of them matter:
  //   1. rule -> payroll column   (`payrollcolumns.calculation_rule`)
  //   2. rule -> calculation group
  //   3. employee exemptions      (`payrollemployees.deduction_exemptions` holds legacy rule ids
  //      that must be rewritten, or 150 employees silently lose their exemptions)
  /* ── Payroll column -> components and column links ────────────────────── */
  //
  // The legacy system stored a column's inputs as JSON arrays of ids inside payrollcolumns itself:
  // `salary_components` (which salary components feed it), `add_columns` and `sub_columns` (other
  // columns to add or subtract). The target normalises these into `payrollcolumn_components` and
  // `payrollcolumn_links` — attachColumnRefs' own comment says they "replace the old
  // salary_components / add_columns / sub_columns CSVs".
  //
  // Without this step every column resolves `componentNames = []` and `links = []`, so the whole
  // payslip arithmetic evaluates to ZERO: Total Allowance (a sum of 10 allowance columns), Gross
  // Salary (Basic + Total Allowance), Gross After NASSIT, Taxable Income, Total Deductions and Net
  // Salary are all built purely from links. Row counts look fine and every money figure is 0.
  //
  // Runs straight after the columns themselves, since it only needs the payrollColumn id map.
  async loadPayrollColumnRefs() {
    const e = this.step('payrollcolumnrefs', 'Payroll column inputs');

    const src = await this.src(
      `SELECT id, salary_components, add_columns, sub_columns FROM payrollcolumns`);

    // Stored as a JSON array of id strings, e.g. ["8","9","10"] — see jsonIdList.
    const idList = jsonIdList;

    const compRows = [];
    const linkRows = [];
    let unresolvedComps = 0;
    let unresolvedLinks = 0;

    for (const r of src) {
      const colId = this.map.payrollColumn.get(String(r.id));
      if (!colId) { e.skipped++; continue; }

      for (const legacyComp of idList(r.salary_components)) {
        const compId = this.map.salaryComponent.get(legacyComp);
        // A component that never migrated cannot be guessed at — dropping the reference is right,
        // and it is counted so the operator sees it rather than finding a silent zero later.
        if (!compId) { unresolvedComps++; continue; }
        compRows.push([Number(colId), String(compId)]);
      }

      for (const [field, operation] of [['add_columns', 'add'], ['sub_columns', 'subtract']]) {
        for (const legacyTarget of idList(r[field])) {
          const targetId = this.map.payrollColumn.get(legacyTarget);
          if (!targetId) { unresolvedLinks++; continue; }
          // A column adding itself would recurse forever in calcColumn; it guards against this, but
          // there is no reason to store it.
          if (Number(targetId) === Number(colId)) continue;
          linkRows.push([Number(colId), Number(targetId), operation]);
        }
      }
    }

    const comps = await this.insertMany('payrollcolumn_components',
      ['payrollcolumn_id', 'component_id'], compRows,
      'ON CONFLICT (payrollcolumn_id, component_id) DO NOTHING', 'payrollcolumnrefs');
    const links = await this.insertMany('payrollcolumn_links',
      ['payrollcolumn_id', 'target_column_id', 'operation'], linkRows,
      'ON CONFLICT (payrollcolumn_id, target_column_id, operation) DO NOTHING', 'payrollcolumnrefs');

    // ── Net pay: derive the basis from the Gross / Total Deductions columns ──
    //
    // The target computes net pay from each column's own `include_in_net` flag rather than from a
    // per-template list (the Net Pay picker was removed from the editor for exactly this reason:
    // what makes up net pay is a property of the column, not of a template).
    //
    // The schema defaults the flag to TRUE, so a migration that never sets it leaves all 194
    // columns flagged — including every running total. The payslip then sums Basic Salary AND Gross
    // Salary AND Gross After NASSIT AND Total Allowance, counting the same money four times on the
    // earnings side, and Total Deductions on top of the PAYE and NASSIT lines it already contains.
    // payslipController warns about precisely this: one run showed 163,545.00 against a true net of
    // 81,472.50.
    //
    // The legacy aggregates already state the answer, per group, so it is read from them rather
    // than guessed. "Gross Salary - MGT" = Basic Salary + Total Allowance - MGT, and
    // "Total Deductions - MGT" = Junior Staff Association + Medical Scheme + NASSIT (5%) + PAYE +
    // Senior Staff Association + Union Dues — six columns, and that is the complete list. Expanding
    // each aggregate to the LEAF columns underneath it gives exactly the set that makes up net pay.
    //
    // Excluded automatically, which a simpler rule gets wrong:
    //   * tax THRESHOLDS — "Allowance Tax Free - MGT" is a flat 200.00 typed as a Deduction, but it
    //     feeds the PAYE calculation and is not money withheld; no Total Deductions column
    //     references it. Counting it cost every employee 100.00 of net.
    //   * the NASSIT employer leg (10% Payt / 10% Deduc), which nets to zero for the employee.
    //   * the 13th-month and backlog one-offs, which carry no calculation group in the source and
    //     so fire on every run — three "13th month PAYE - 2025" variants each deducted the same
    //     1,011,020.27 from one Management run.
    const netBasis = await this.tgt(`
      WITH RECURSIVE roots AS (
        -- Every Gross / Total Deductions style aggregate, whatever its group suffix.
        SELECT id FROM payrollcolumns
         WHERE enabled = 'Yes'
           AND (name ILIKE 'gross salary%' OR name ILIKE 'total deductions%')
      ),
      expanded AS (
        SELECT l.target_column_id AS id
          FROM payrollcolumn_links l JOIN roots r ON r.id = l.payrollcolumn_id
        UNION
        SELECT l.target_column_id
          FROM payrollcolumn_links l JOIN expanded x ON x.id = l.payrollcolumn_id
      ),
      leaves AS (
        -- Only the leaves hold real amounts; the intermediate aggregates are already counted.
        SELECT x.id FROM expanded x
         WHERE NOT EXISTS (SELECT 1 FROM payrollcolumn_links l WHERE l.payrollcolumn_id = x.id)
      )
      UPDATE payrollcolumns pc
         SET include_in_net = (pc.id IN (SELECT id FROM leaves))
       WHERE pc.enabled = 'Yes'
      RETURNING pc.id, pc.include_in_net`);

    const inNet = netBasis.filter(r => r.include_in_net).length;

    e.inserted += comps + links;
    e.notes.push(`${comps} component links, ${links} column links`);
    e.notes.push(`${inNet} columns make up net pay, derived from what the Gross and Total Deductions columns reference`);
    if (unresolvedComps) e.notes.push(`${unresolvedComps} component references dropped — component did not migrate`);
    if (unresolvedLinks) e.notes.push(`${unresolvedLinks} column references dropped — target column did not migrate`);

    this.done(e);
  }

  /* ── Payroll column -> calculation group ──────────────────────────────── */
  //
  // Each legacy payroll column carries ONE `deduction_group`; the target normalises the same idea
  // into `payrollcolumn_groups` (many groups per column). Without this step every migrated column
  // is ungrouped, and the payroll engine treats an ungrouped column as universal — so all 195
  // columns fire for every employee instead of the 25 the legacy system actually paid.
  //
  // Runs after loadPayrollConfiguration, which is what builds the calculationGroup id map.
  //
  // The 12 columns that genuinely have no group are left ungrouped on purpose: universal is what
  // the legacy system meant by a null group, and the target spells that the same way.
  async loadPayrollColumnGroups() {
    const e = this.step('payrollcolumngroups', 'Payroll column groups');

    const src = await this.src(
      `SELECT id, deduction_group FROM payrollcolumns WHERE deduction_group IS NOT NULL AND deduction_group <> 0`);

    const toInsert = [];
    for (const r of src) {
      const colId = this.map.payrollColumn.get(String(r.id));
      const grpId = this.map.calculationGroup.get(String(r.deduction_group));
      // A column whose group never made it across must stay ungrouped rather than be guessed at:
      // attaching it to the wrong group would silently pay the wrong people.
      if (!colId || !grpId) { e.skipped++; continue; }
      toInsert.push([Number(colId), String(grpId)]);
    }

    e.inserted += await this.insertMany('payrollcolumn_groups',
      ['payrollcolumn_id', 'group_id'], toInsert,
      'ON CONFLICT (payrollcolumn_id, group_id) DO NOTHING', 'payrollcolumngroups');

    if (e.skipped) e.notes.push(`${e.skipped} columns left ungrouped — their group did not migrate`);
    e.notes.push('Columns with no legacy group stay universal, as they were before');

    this.done(e);
  }

  async loadCalculationRules() {
    const e = this.step('calculationrules', 'Calculation rules');

    // Legacy condition words -> the target's enum-style strings. Verified against all 124 bands:
    // every condition in the source maps, none are unknown.
    const COND = {
      gt: 'GREATER_THAN',
      gte: 'GREATER_THAN_OR_EQUAL',
      lt: 'LESS_THAN',
      lte: 'LESS_THAN_OR_EQUAL',
      'No Lower Limit': 'NO_LOWER_LIMIT',
      'No Upper Limit': 'NO_UPPER_LIMIT',
    };
    const cond = (v, fallback) => COND[String(v ?? '').trim()] ?? fallback;
    const limit = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n !== 0 ? n : null;
    };

    // Clear what this migration owns: savedcalculations has no natural key, so a re-run would
    // otherwise append a second copy of every rule.
    const existingRules = await this.tgt(`SELECT id, name FROM savedcalculations`);
    if (existingRules.length) {
      await this.tgt(`DELETE FROM calculationprocessitems
                       WHERE saved_calculation_id = ANY($1::bigint[])`,
        [existingRules.map(r => r.id)]);
      await this.tgt(`DELETE FROM savedcalculations WHERE id = ANY($1::bigint[])`,
        [existingRules.map(r => r.id)]);
      e.notes.push(`${existingRules.length} existing rules cleared before reload`);
    }

    const src = await this.src(`
      SELECT id, name, payrollColumn, deduction_group, rangeAmounts
        FROM deductions ORDER BY id`);

    const ruleMap = new Map();                  // legacy deduction id -> savedcalculations.id
    let bands = 0, unlinked = 0, noBands = 0, componentBased = 0;

    // Target salary components by normalised name, for the rules whose base is a COMPONENT rather
    // than a column (see below). The group suffix is stripped so "Lunch Allowance - MGT" and
    // "Lunch Allowance - Permanent" both resolve to the "Lunch Allowance" component.
    const componentKey = (s) => String(s ?? '').toLowerCase()
      .replace(/\s*-\s*(snr\s*mgt|mgt|management|permanent|contract|perm|utb)\s*$/i, '')
      .replace(/\s+/g, ' ').trim();
    const targetComponents = new Map();
    for (const row of await this.tgt(`SELECT id, name FROM salarycomponent`)) {
      targetComponents.set(componentKey(row.name), { id: row.id, name: row.name });
    }
    // legacy rule id -> the column that declares it via payrollcolumns.deductions, so a rule with
    // no base column can be matched to a component by THAT column's name.
    const ruleOwnerColumn = new Map();
    const srcColumns = await this.src(
      `SELECT id, name, salary_components, deductions FROM payrollcolumns`);
    for (const row of srcColumns) {
      for (const rid of jsonIdList(row.deductions)) {
        if (!ruleOwnerColumn.has(rid)) ruleOwnerColumn.set(rid, row.name);
      }
    }

    // Base name -> the component a SIBLING column links explicitly via salary_components.
    //
    // Name matching alone is not enough: "Car Allowance - MGT" normalises to "car allowance" but
    // the component is called "Car Allowance1", so it would never match and the column would pay
    // ZERO (437,421.26 missing from one AUG management run). Its sibling "Car Allowance"
    // (Permanent) does carry salary_components = ["33"], and the legacy data proves the link —
    // 6,474.03 x 1.21 = 7,833.58, exactly what was paid. Taking the component from the sibling is
    // evidence from the source, not a guess at the name.
    const componentBySiblingLink = new Map();
    for (const row of srcColumns) {
      const [legacyComp] = jsonIdList(row.salary_components);
      if (!legacyComp) continue;
      const targetComp = this.map.salaryComponent.get(legacyComp);
      if (!targetComp) continue;
      const key = componentKey(row.name);
      if (!componentBySiblingLink.has(key)) {
        componentBySiblingLink.set(key, { id: targetComp, legacy: legacyComp });
      }
    }
    // Target component names, for filling target_name once an id is known.
    const componentNameById = new Map();
    for (const row of await this.tgt(`SELECT id, name FROM salarycomponent`)) {
      componentNameById.set(String(row.id), row.name);
    }

    for (const r of src) {
      const name = clean(r.name);
      if (!name) { e.skipped++; continue; }

      // `deductions.payrollColumn` is the rule's BASE — the value that substitutes for X — not the
      // column it computes. When it is set, X is that column's amount.
      const columnId = r.payrollColumn
        ? this.map.payrollColumn.get(String(r.payrollColumn)) ?? null
        : null;

      // When it is NULL the legacy engine took X from the employee's salary COMPONENT of the same
      // name as the column that invokes the rule: "Stewards Allowance - MGT" invokes rule 139
      // (X+(X*0.21)) and X is the employee's "Stewards Allowance" component. Verified on the latest
      // run of each group — Management 5/5, 7/7, 3/3, 4/4, 62/62 and Permanent 419/419, 7/7, with
      // Transport 441/442 (one manual override). Earlier runs differ only because the uplift rates
      // changed over the years.
      let targetType = 'column';
      let targetId   = columnId;
      let targetName = columnId ? (this.map.payrollColumnName.get(String(columnId)) ?? null) : null;

      if (!columnId) {
        const owner = ruleOwnerColumn.get(String(r.id));
        const key   = owner ? componentKey(owner) : null;
        // Prefer the component a sibling column links EXPLICITLY; fall back to an exact name match.
        const sibling = key ? componentBySiblingLink.get(key) : null;
        const comp = sibling
          ? { id: sibling.id, name: componentNameById.get(String(sibling.id)) ?? null }
          : (key ? targetComponents.get(key) : null);
        if (comp?.id) {
          targetType = 'component';
          targetId   = comp.id;
          targetName = comp.name;
          componentBased++;
        } else {
          unlinked++;
        }
      }

      const groupId = r.deduction_group
        ? this.map.calculationGroup.get(String(r.deduction_group)) ?? null
        : null;

      const ins = await this.tgt(`
        INSERT INTO savedcalculations
          (name, target_type, target_id, target_name, calculation_group_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id`,
        // target_type is NOT NULL (default 'component'), and a default only applies when the column
        // is omitted — an explicit null is still rejected — so a rule with neither base keeps
        // 'column' with a null target_id for someone to point in the app.
        [name, targetType, targetId, targetName, groupId]);

      const ruleId = ins[0].id;
      ruleMap.set(String(r.id), ruleId);

      let list = [];
      try { list = JSON.parse(r.rangeAmounts || '[]'); } catch { /* reported below */ }
      if (!Array.isArray(list) || !list.length) { noBands++; continue; }

      const items = list.map((b, i) => [
        ruleId,
        cond(b.lowerCondition, 'NO_LOWER_LIMIT'),
        limit(b.lowerLimit),
        cond(b.upperCondition, 'NO_UPPER_LIMIT'),
        limit(b.upperLimit),
        clean(b.amount) ?? '0',
        i,
      ]);
      bands += await this.insertMany('calculationprocessitems',
        ['saved_calculation_id', 'lower_limit_condition', 'lower_limit',
         'upper_limit_condition', 'upper_limit', 'value', 'sort_order'],
        items, 'ON CONFLICT DO NOTHING');
    }

    await this.tgt(
      `SELECT setval(pg_get_serial_sequence('savedcalculations','id'), GREATEST((SELECT MAX(id) FROM savedcalculations), 1))`)
      .catch(() => {});

    // ── Link each payroll column to the rule that COMPUTES it ──────────
    //
    // The two directions are different fields, and confusing them silently corrupts every figure:
    //
    //   * `deductions.payrollColumn`  — the rule's INPUT: what substitutes for X. Eleven rules all
    //     carry payrollColumn = 1 (Basic Salary): Lunch 5%, Rent 35%, Transport 10%, NASSIT … They
    //     obviously cannot all be "the rule that computes Basic Salary". Writing this as the output
    //     link made the engine scale Basic Salary by 0.1, so it came out at a tenth of the notch.
    //   * `payrollcolumns.deductions` — the rule's OUTPUT: the rule that produces THIS column. A
    //     JSON array, in practice always exactly one id, on 94 enabled columns.
    //
    // calcColumn applies `col.calculation_rule` and resolves X from the rule's own target, so these
    // map straight across. Without this link the allowance columns compute to zero: "Stewards
    // Allowance - MGT" paid 2,424.46 in legacy (component 2,003.69 x 1.21) but nothing here.
    let linked = 0;
    const links = [];
    for (const row of await this.src(
      `SELECT id, deductions FROM payrollcolumns
        WHERE deductions IS NOT NULL AND TRIM(deductions) NOT IN ('', '[]')`)) {
      const columnId = this.map.payrollColumn.get(String(row.id));
      if (!columnId) continue;
      // Only the first id is used: the target carries one rule per column, and every legacy row
      // measured holds exactly one.
      const [legacyRule] = jsonIdList(row.deductions);
      const ruleId = legacyRule ? ruleMap.get(legacyRule) : null;
      if (ruleId) links.push({ columnId, ruleId });
    }
    for (let i = 0; i < links.length; i += BATCH) {
      const chunk = links.slice(i, i + BATCH);
      const vals = chunk.map((_, j) => `($${j * 2 + 1}::int,$${j * 2 + 2}::bigint)`).join(',');
      const res = await this.tgt(
        `UPDATE payrollcolumns pc SET calculation_rule = v.rule
           FROM (VALUES ${vals}) AS v(col, rule) WHERE pc.id = v.col RETURNING 1`,
        chunk.flatMap(l => [Number(l.columnId), l.ruleId]));
      linked += res.length;
    }

    // ── Rewrite employee exemptions to the new rule ids ────────────────
    //
    // `deduction_exemptions` is a JSON array of legacy rule ids, e.g. ["82","81","95"]. Carried
    // across unchanged they point at nothing, so 150 employees would silently lose the exemptions
    // that stop them being deducted twice. Read from the SOURCE so a re-run cannot double-translate.
    const exemptions = [];
    for (const r of await this.src(
      `SELECT employee, pay_frequency, deduction_exemptions FROM payrollemployees
        WHERE deduction_exemptions IS NOT NULL AND TRIM(deduction_exemptions) <> ''`)) {
      const emp = this.map.employee.get(String(r.employee));
      if (!emp) continue;
      let ids = [];
      try { ids = JSON.parse(r.deduction_exemptions || '[]'); } catch { continue; }
      if (!Array.isArray(ids) || !ids.length) continue;
      const mapped = ids.map(x => ruleMap.get(String(x))).filter(Boolean).map(String);
      if (!mapped.length) continue;
      // The legacy frequency id is carried so the update can target the SAME roster row. An
      // employee may sit on several pay frequencies, and the exemption belongs to the row it was
      // set on — matching on employee alone would spread it across all of them.
      const freq = this.map.payFrequency.get(String(clean(r.pay_frequency) ?? '')) ?? int(r.pay_frequency);
      exemptions.push({ emp, freq, json: JSON.stringify(mapped) });
    }

    let exemptRows = 0;
    for (let i = 0; i < exemptions.length; i += BATCH) {
      const chunk = exemptions.slice(i, i + BATCH);
      const vals = chunk
        .map((_, j) => `($${j * 3 + 1}::bigint,$${j * 3 + 2}::int,$${j * 3 + 3}::varchar)`)
        .join(',');
      const res = await this.tgt(
        `UPDATE payrollemployees pe SET deduction_exemptions = v.json
           FROM (VALUES ${vals}) AS v(employee, freq, json)
          WHERE pe.employee = v.employee
            AND pe.pay_frequency IS NOT DISTINCT FROM v.freq
        RETURNING 1`,
        chunk.flatMap(x => [x.emp, x.freq, x.json]));
      exemptRows += res.length;
    }

    e.inserted += ruleMap.size;
    e.notes.push(`${ruleMap.size} rules with ${bands} bands (PAYE ladder, NASSIT, allowances)`);
    e.notes.push(`${linked} payroll columns linked to the rule that computes them`);
    if (componentBased) e.notes.push(`${componentBased} rules take their base from a salary component rather than a column`);
    if (unlinked) e.notes.push(`${unlinked} rules have no base at all — they were not wired up in the legacy system either; set one in the app`);
    if (noBands) e.notes.push(`${noBands} rules carry no bands`);
    e.notes.push(`${exemptRows} employees had their calculation exemptions re-pointed at the new rule ids`);
    this.done(e);
  }

  /* ── 7b. Promote uniform allowances to the pay grade ──────────────────── */
  //
  // Runs AFTER employeesalary is loaded, and restructures what was just written: where every
  // employee on a pay grade holds the same positive amount for a component, that becomes ONE
  // `paygrade_components` row and the per-employee rows are removed. Measured on the real data,
  // 2,585 per-employee rows collapse into 114 grade rows.
  //
  // Two rules make this safe:
  //
  //   * ZERO-amount rows are never touched. A component assigned at zero is an ENROLMENT MARKER —
  //     the payroll column formula computes the real value — and at least 477 of the 1,621 zero
  //     rows belong to employees who were genuinely paid (Overtime Earning 100%, Car Allowance1
  //     86%, Basic Salary 57%). Deleting those would silently stop paying people.
  //   * The reconciliation below is a HARD GATE. Every employee's total across the promoted
  //     components must be identical before and after; if a single one differs the whole step is
  //     rolled back. The restructure may reorganise where an amount lives, never what it is.
  async loadGradeComponents() {
    const e = this.step('gradecomponents', 'Pay grade allowances');

    // Totals per employee BEFORE, limited to components that are candidates for promotion.
    const before = await this.tgt(`
      SELECT es.employee, ROUND(SUM(es.amount), 2) AS total
        FROM employeesalary es
        JOIN employee e ON e.id = es.employee
       WHERE es.amount > 0 AND es.excluded IS NOT TRUE AND e.paygradeid IS NOT NULL
       GROUP BY es.employee`);
    const beforeMap = new Map(before.map(r => [String(r.employee), String(r.total)]));

    await this.tgt('BEGIN');
    try {
      // A (component, grade) pair qualifies when every positive amount on that grade is the same.
      //
      // A pay-grade row applies to EVERYONE on the grade, so promoting a component that only most
      // of them hold would grant it to the rest. Rather than refuse those cases — which blocked 71
      // pairs covering 1,302 rows, most of them short by a single person — the employees who do
      // NOT hold the component get an explicit exclusion row instead.
      //
      // That is the model the payroll engine already implements (see buildSalaryByEmp): pay grade,
      // then notch, then per-employee exceptions where `excluded` removes the component entirely.
      // So "everyone on Band 4B pays Medical Scheme, except this one person" is expressed exactly
      // as intended, and nobody's pay changes.
      const pairs = await this.tgt(`
        SELECT es.component, e.paygradeid AS grade, MIN(es.amount) AS amount,
               COUNT(*)::int AS rows_replaced
          FROM employeesalary es
          JOIN employee e ON e.id = es.employee
         WHERE es.amount > 0 AND e.paygradeid IS NOT NULL
         GROUP BY es.component, e.paygradeid
        HAVING COUNT(DISTINCT es.amount) = 1`);

      if (!pairs.length) {
        await this.tgt('ROLLBACK');
        e.notes.push('No component is uniform across a pay grade — nothing promoted');
        this.done(e);
        return;
      }

      await this.insertMany('paygrade_components',
        ['paygrade_id', 'component_id', 'amount', 'working_days'],
        pairs.map(p => [p.grade, p.component, p.amount, null]),
        `ON CONFLICT (paygrade_id, component_id) DO UPDATE SET amount = EXCLUDED.amount`,
        'gradecomponents');

      // Everyone on a promoted grade who does NOT already hold that component gets an exclusion,
      // so the grade row does not silently start paying (or deducting from) them.
      const excluded = await this.tgt(`
        INSERT INTO employeesalary (employee, component, amount, excluded)
        SELECT e.id, pc.component_id, NULL, TRUE
          FROM employee e
          JOIN paygrade_components pc ON pc.paygrade_id = e.paygradeid
         WHERE NOT EXISTS (
                 SELECT 1 FROM employeesalary es
                  WHERE es.employee = e.id AND es.component = pc.component_id)
        RETURNING 1`);
      if (excluded.length) {
        e.notes.push(`${excluded.length.toLocaleString()} employees excluded from a grade component they did not hold`);
      }

      // Employees holding the component at ZERO are a separate case: the zero row is an enrolment
      // marker whose value a payroll formula computes, so it must not be turned into an exclusion
      // — that would stop the formula paying them. But it does not override the grade amount
      // either (the engine skips blank amounts so `default_value` can still fire), which would
      // leave the grade quietly paying them something they never had.
      //
      // Setting `excluded` on the existing zero row keeps the row — and therefore the enrolment —
      // while stopping the grade amount from reaching them. On this data that is 291 employees.
      const neutralised = await this.tgt(`
        UPDATE employeesalary es
           SET excluded = TRUE
          FROM employee e, paygrade_components pc
         WHERE es.employee = e.id
           AND pc.paygrade_id = e.paygradeid
           AND pc.component_id = es.component
           AND (es.amount = 0 OR es.amount IS NULL)
           AND es.excluded IS NOT TRUE
        RETURNING 1`);
      if (neutralised.length) {
        e.notes.push(`${neutralised.length.toLocaleString()} zero-amount enrolments kept but excluded from the grade amount`);
      }

      // Remove only the rows the grade now covers: same component, same grade, positive amount.
      const removed = await this.tgt(`
        DELETE FROM employeesalary es
         USING employee e, paygrade_components pc
         WHERE e.id = es.employee
           AND pc.paygrade_id = e.paygradeid
           AND pc.component_id = es.component
           AND es.amount > 0
           AND ABS(es.amount - pc.amount) < 0.005
        RETURNING 1`);

      // Totals AFTER = what is left per-employee, plus what the grade supplies MINUS anything the
      // employee is excluded from. This mirrors the payroll engine's own precedence (pay grade,
      // then per-employee exceptions where `excluded` removes the component), so the comparison
      // measures what the employee is actually paid rather than what the tables happen to contain.
      const after = await this.tgt(`
        SELECT emp AS employee, ROUND(SUM(total), 2) AS total FROM (
          SELECT es.employee AS emp, SUM(es.amount) AS total
            FROM employeesalary es JOIN employee e ON e.id = es.employee
           WHERE es.amount > 0 AND es.excluded IS NOT TRUE AND e.paygradeid IS NOT NULL
           GROUP BY es.employee
          UNION ALL
          SELECT e.id AS emp, SUM(pc.amount) AS total
            FROM employee e
            JOIN paygrade_components pc ON pc.paygrade_id = e.paygradeid
           WHERE e.paygradeid IS NOT NULL
             AND NOT EXISTS (
                   SELECT 1 FROM employeesalary es
                    WHERE es.employee = e.id AND es.component = pc.component_id
                      AND es.excluded IS TRUE)
           GROUP BY e.id
        ) x GROUP BY emp`);

      const mismatched = after.filter(r => {
        const was = beforeMap.get(String(r.employee));
        return was !== undefined && Math.abs(Number(was) - Number(r.total)) > 0.005;
      });

      if (mismatched.length) {
        await this.tgt('ROLLBACK');
        e.notes.push(`ROLLED BACK: ${mismatched.length} employees' totals would have changed`);
        this.done(e);
        return;
      }

      await this.tgt('COMMIT');
      e.inserted += pairs.length;
      e.notes.push(`${removed.length.toLocaleString()} per-employee rows replaced by ${pairs.length} pay-grade rows`);
      e.notes.push(`Reconciled: all ${after.length} employees' totals unchanged`);
    } catch (err) {
      await this.tgt('ROLLBACK').catch(() => {});
      throw err;
    }

    // Zero-amount rows are reported, never removed — see the note above.
    const zeros = await this.tgt(`
      SELECT COUNT(*)::int n FROM employeesalary WHERE amount = 0 OR amount IS NULL`);
    if (zeros[0].n) {
      e.notes.push(`${zeros[0].n} zero-amount rows left in place: these enrol an employee on a component whose value a payroll formula computes`);
    }

    this.done(e);
  }

  async loadPayrollEmployees() {
    const e = this.step('payrollemployees', 'Payroll roster and salaries');

    // The source holds 414 duplicate (employee, pay_frequency) pairs — 828 rows — because it
    // predates the unique index the target enforces. A single INSERT cannot apply ON CONFLICT DO
    // UPDATE to the same row twice ("cannot affect row a second time"), so the duplicates are
    // collapsed here, keeping the LAST occurrence as the current configuration.
    const rosterByKey = new Map();
    let rosterDupes = 0;
    for (const r of await this.src(
      `SELECT id, employee, pay_frequency, currency, deduction_exemptions, deduction_allowed, deduction_group
         FROM payrollemployees ORDER BY id`)) {
      const emp = this.map.employee.get(String(r.employee));
      if (!emp) { e.skipped++; continue; }
      const key = `${emp}|${int(r.pay_frequency) ?? ''}`;
      if (rosterByKey.has(key)) rosterDupes++;
      rosterByKey.set(key, [emp, int(r.pay_frequency), clean(r.currency),
        clean(r.deduction_exemptions), clean(r.deduction_allowed), int(r.deduction_group)]);
    }
    const roster = [...rosterByKey.values()];
    if (rosterDupes) {
      e.notes.push(`${rosterDupes} duplicate (employee, pay frequency) rows collapsed — the latest one wins`);
    }

    // Clear the roster rows this migration owns before reloading.
    //
    // The ON CONFLICT below looks idempotent, but it is not: it matches on (employee,
    // pay_frequency), and loadPayrollConfiguration REWRITES pay_frequency to the new id afterwards.
    // On a second run the legacy frequency no longer matches the rewritten row, the conflict never
    // fires, and a duplicate is inserted carrying an untranslated group id — which the rewrite then
    // cannot fix either, because it only matches rows still holding the legacy value. The roster
    // ends up a mix of translated and untranslated ids, silently pointing employees at the WRONG
    // calculation group (legacy 10 "Permanent Staff" resolves to new 10 "UTB").
    //
    // Scoped to migrated employees so a roster row added by hand in the app is left alone.
    const owned = [...this.map.employee.values()];
    if (owned.length) {
      for (let i = 0; i < owned.length; i += BATCH) {
        const chunk = owned.slice(i, i + BATCH);
        await this.tgt(
          `DELETE FROM payrollemployees WHERE employee IN (${chunk.map((_, j) => `$${j + 1}`).join(',')})`,
          chunk);
      }
    }

    e.inserted += await this.insertMany(
      'payrollemployees',
      ['employee', 'pay_frequency', 'currency', 'deduction_exemptions', 'deduction_allowed', 'deduction_group'],
      roster,
      `ON CONFLICT (employee, pay_frequency) DO UPDATE
          SET currency = EXCLUDED.currency, deduction_group = EXCLUDED.deduction_group`, 'payrollemployees');

    // employeesalary has no unique key beyond its id either, so ON CONFLICT cannot dedupe and a
    // re-run doubles the table (a rehearsal produced 20,844 rows instead of 10,422). Clear the
    // rows this migration owns — those belonging to migrated employees — before reloading.
    const empIds = [...new Set(this.map.employee.values())];
    if (empIds.length) {
      const del = await this.tgt(
        `DELETE FROM employeesalary WHERE employee = ANY($1::bigint[]) RETURNING 1`, [empIds]);
      if (del.length) e.notes.push(`${del.length.toLocaleString()} existing salary rows cleared before reload`);
    }

    const salaries = [];
    let salarySkipped = 0;
    for (const r of await this.src(
      `SELECT employee, component, amount, pay_frequency, currency FROM employeesalary`)) {
      const emp = this.map.employee.get(String(r.employee));
      if (!emp) { salarySkipped++; continue; }
      // pay_frequency is the SAME enum on both sides ('Hourly'...'Monthly'), so it passes through
      // as text — running it through int() turned "Bi Weekly" into 0 and broke the insert.
      // currency here is a bigint id, unlike payrollemployees.currency which is text.
      // Component ids are remapped like every other foreign key — the legacy ids do not survive.
      // A row whose component cannot be resolved is skipped rather than pointed at the wrong one.
      const comp = this.map.salaryComponent.get(String(r.component)) ?? null;
      if (!comp) { salarySkipped++; continue; }
      salaries.push([emp, comp, r.amount ?? 0, clean(r.pay_frequency), int(r.currency)]);
    }
    const salaryRows = await this.insertMany(
      'employeesalary',
      ['employee', 'component', 'amount', 'pay_frequency', 'currency'],
      salaries, 'ON CONFLICT DO NOTHING', 'payrollemployees');

    e.notes.push(`${salaryRows} salary rows loaded, ${salarySkipped} skipped (employee not migrated)`);
    this.done(e);
  }

  /* ── 8. Payroll data — the big one ────────────────────────────────────── */
  // 787k source rows, of which ~628k survive the exclusions. Streamed and inserted in batches so
  // memory stays flat; the three JOINs enforce the exclusions declared in the plan.
  async loadPayrollData() {
    const e = this.step('payrolldata', 'Payroll history');

    // payrolldata has NO unique constraint beyond its primary key, so ON CONFLICT DO NOTHING
    // cannot dedupe and a re-run would append the whole table again — a rehearsal produced
    // 882,478 rows instead of 628,478, with 243,360 duplicated (run, employee, column) groups.
    //
    // The correct model is one row per (run, employee, column) — the live database has zero
    // duplicate groups — so the rows this migration owns are cleared first. Only rows belonging
    // to migrated runs are removed: anything entered in the target by other means is left alone.
    const runIds = [...new Set(this.map.payrollRun.values())];
    if (runIds.length) {
      const del = await this.tgt(
        `DELETE FROM payrolldata WHERE payroll = ANY($1::bigint[]) RETURNING 1`, [runIds]);
      if (del.length) e.notes.push(`${del.length.toLocaleString()} existing rows for these runs cleared before reload`);
    }

    const total = await this.src(`
      SELECT COUNT(*) AS n FROM payrolldata pd
        JOIN payroll        p  ON p.id  = pd.payroll
        JOIN employees      em ON em.id = pd.employee
        JOIN payrollcolumns pc ON pc.id = pd.payroll_item`);
    const expected = Number(total[0].n);

    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      const vals = [];
      const params = [];
      batch.forEach((row, i) => {
        const b = i * 4;
        vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
        params.push(row.payroll, row.employee, row.item, row.amount);
      });
      await this.tgt(
        `INSERT INTO payrolldata (payroll, employee, payroll_item, amount)
         VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`, params);
      e.inserted += batch.length;
      batch = [];
      this.onProgress({ phase: 'progress', step: 'payrolldata', done: e.inserted, total: expected });
    };

    const stream = this.my.connection
      ? this.my.connection.query(`
          SELECT pd.payroll, pd.employee, pd.payroll_item, pd.amount
            FROM payrolldata pd
            JOIN payroll        p  ON p.id  = pd.payroll
            JOIN employees      em ON em.id = pd.employee
            JOIN payrollcolumns pc ON pc.id = pd.payroll_item`)
      : null;

    if (stream) {
      await new Promise((resolve, reject) => {
        const queue = [];
        let draining = false;
        stream.on('result', (row) => {
          const run = this.map.payrollRun.get(String(row.payroll));
          const emp = this.map.employee.get(String(row.employee));
          const col = this.map.payrollColumn.get(String(row.payroll_item));
          if (!run || !emp || !col) { e.skipped++; return; }
          batch.push({ payroll: run, employee: emp, item: col, amount: row.amount ?? 0 });
          if (batch.length >= BATCH && !draining) {
            draining = true;
            this.my.connection.pause();
            flush().then(() => { draining = false; this.my.connection.resume(); }).catch(reject);
          }
        });
        stream.on('error', reject);
        stream.on('end', () => { flush().then(resolve).catch(reject); });
        void queue;
      });
    }

    e.notes.push(`${expected.toLocaleString()} rows passed the exclusion filters in the source`);
    this.done(e, { expected });
  }

  /* ── 9. Medical ───────────────────────────────────────────────────────── */
  // staffmedical is column-identical old->new, but the target stores `employee` as VARCHAR, so
  // the remapped id is written as text.
  async loadMedical() {
    const e = this.step('medical', 'Medical records');

    // ── Who posted and who approved ────────────────────────────────────────
    //
    // The two systems use the same column names for different things: in the legacy database
    // `posted_by` and `approved_by` hold EMPLOYEE ids (1,833 of 1,833 join to employees, while
    // only 7 coincidentally match a user id), but this application reads them as USER ids —
    // medicalController's userMap looks them up in `users` and shows the linked employee's name.
    //
    // Copying the numbers across would label every record with the wrong person, so they are
    // translated: legacy employee id -> staff code -> migrated employee -> that employee's user
    // account. Only three people appear across the whole history, and a display-only account is
    // created for each. An actor that cannot be translated is left NULL rather than guessed at.
    const actorIds = new Set();
    for (const t of ['staffmedical', 'staffmedical_hist']) {
      for (const r of await this.src(
        `SELECT DISTINCT posted_by, approved_by FROM ${t}
          WHERE posted_by IS NOT NULL OR approved_by IS NOT NULL`)) {
        if (clean(r.posted_by)) actorIds.add(String(r.posted_by).trim());
        if (clean(r.approved_by)) actorIds.add(String(r.approved_by).trim());
      }
    }

    const actorToUser = new Map();            // legacy employee id -> target users.id
    const numericIds = [...actorIds].filter(v => /^\d+$/.test(v));
    if (numericIds.length) {
      const codes = await this.src(
        `SELECT id, employee_id FROM employees WHERE id IN (${numericIds.map(() => '?').join(',')})`,
        numericIds);

      for (const row of codes) {
        const code = clean(row.employee_id);
        if (!code) continue;
        const emp = await this.tgt('SELECT id FROM employee WHERE employee_id = $1', [code]);
        const empId = emp[0]?.id;
        if (!empId) continue;

        // Reuse an existing account, otherwise create one purely so the name can be displayed.
        // status '0' means it cannot be logged into: these are historical actors, not people
        // being granted access by the migration.
        let user = await this.tgt('SELECT id FROM users WHERE employeeid = $1', [empId]);
        if (!user.length) {
          user = await this.tgt(`
            INSERT INTO users (username, password, employeeid, status, theme, posted_by, created)
            VALUES ($1, '', $2, '0', 'light', '0', NOW())
            ON CONFLICT DO NOTHING RETURNING id`, [code, empId]);
          if (!user.length) user = await this.tgt('SELECT id FROM users WHERE username = $1', [code]);
        }
        if (user[0]?.id) actorToUser.set(String(row.id), user[0].id);
      }
      await this.tgt(
        `SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT MAX(id) FROM users), 1))`)
        .catch(() => {});
      e.notes.push(`${actorToUser.size} historical actor(s) linked to user accounts so names display`);
    }
    // Returned as text: both columns are varchar in the target, and userMap coerces with Number().
    const actor = (v) => {
      const id = actorToUser.get(String(clean(v) ?? ''));
      return id == null ? null : String(id);
    };

    // Same re-run hazard as payrolldata, and it applies to BOTH medical tables.
    //
    // staffmedical_hist has no primary key and no constraints AT ALL, so supplying the legacy id
    // does not make ON CONFLICT DO NOTHING dedupe — there is nothing for it to conflict against.
    // An earlier version assumed the explicit id was enough and the table doubled on a re-run
    // (2,166 -> 4,332). Both tables are therefore cleared for the migrated employees first.
    const medEmpIds = [...new Set(this.map.employee.values())].map(String);
    if (medEmpIds.length) {
      for (const table of ['staffmedical', 'staffmedical_hist']) {
        const del = await this.tgt(
          `DELETE FROM ${table} WHERE employee = ANY($1::varchar[]) RETURNING 1`, [medEmpIds]);
        if (del.length) e.notes.push(`${table}: ${del.length.toLocaleString()} existing rows cleared before reload`);
      }
    }

    for (const [table, label] of [['staffmedical', 'claims'], ['staffmedical_hist', 'history']]) {
      // staffmedical_hist.id has NO default (in live as well as here) — the application supplies
      // it — so the legacy id is carried through for that table. staffmedical has a sequence and
      // gets a fresh id like every other table.
      const needsId = table === 'staffmedical_hist';
      let skipped = 0;
      const rows = [];
      for (const r of await this.src(`
        SELECT id, employee, from_date, to_date, admission_type, type_of_illness, medication_given,
               cost, mode_of_payment, hospital, physician, status, approved_date, reference,
               posted_by, approved_by
          FROM ${table}`)) {
        const emp = this.map.employee.get(String(r.employee));
        if (!emp) { skipped++; continue; }
        const vals = [String(emp), date(r.from_date), date(r.to_date),
          clean(r.admission_type) ?? 'Unknown', clean(r.type_of_illness) ?? 'Unknown',
          clean(r.medication_given) ?? 'Unknown', r.cost ?? 0, clean(r.mode_of_payment),
          clean(r.hospital) ?? 'Unknown', clean(r.physician),
          clean(r.status) ?? 'Approved', date(r.approved_date), clean(r.reference),
          // Translated from legacy employee id to a target user id — see the note above.
          actor(r.posted_by), actor(r.approved_by)];
        rows.push(needsId ? [int(r.id), ...vals] : vals);
      }
      const cols = ['employee', 'from_date', 'to_date', 'admission_type', 'type_of_illness',
        'medication_given', 'cost', 'mode_of_payment', 'hospital', 'physician',
        'status', 'approved_date', 'reference', 'posted_by', 'approved_by'];
      const n = await this.insertMany(table,
        needsId ? ['id', ...cols] : cols, rows, 'ON CONFLICT DO NOTHING', 'medical');
      e.inserted += n;
      e.skipped += skipped;
      e.notes.push(`${table}: ${n} ${label} loaded${skipped ? `, ${skipped} skipped` : ''}`);
    }

    // ── Medical limits ─────────────────────────────────────────────────────
    //
    // The per-grade cap on what the scheme pays. `grade` holds a legacy PAYGRADE ID, not a name, so
    // it is remapped; the target keeps the original text in `grade` and adds `paygrade_id` as the
    // real reference. A limit whose pay grade did not migrate is skipped rather than pointed at the
    // wrong band — paying against the wrong cap is worse than having none.
    const limitRows = [];
    let limitSkipped = 0;
    for (const r of await this.src(
      `SELECT id, grade, amount, start_date, end_date, posting_date, status, approved_by, approved_date
         FROM medicallimit ORDER BY id`)) {
      const paygradeId = this.map.paygrade.get(String(r.grade));
      if (!paygradeId) { limitSkipped++; continue; }
      limitRows.push([String(r.grade), r.amount, r.start_date, r.end_date, r.posting_date,
        clean(r.status), actor(r.approved_by), r.approved_date, paygradeId]);
    }
    if (limitRows.length) {
      await this.tgt(`DELETE FROM medicallimit`).catch(() => {});
      const n = await this.insertMany('medicallimit',
        ['grade', 'amount', 'start_date', 'end_date', 'posting_date', 'status',
         'approved_by', 'approved_date', 'paygrade_id'],
        limitRows, 'ON CONFLICT DO NOTHING', 'medical');
      e.inserted += n;
      e.notes.push(`medicallimit: ${n} per-grade limits loaded${limitSkipped ? `, ${limitSkipped} skipped (pay grade not migrated)` : ''}`);
    }

    // ── Registered hospitals ───────────────────────────────────────────────
    //
    // Ids are preserved: hospitalclaims.hospital references them, and keeping them identical means
    // the claims need no translation. `type` is NOT NULL in the target and has no legacy
    // equivalent, so it takes the schema's own default rather than an invented value.
    const hospitals = await this.src(
      `SELECT id, name, account, created_at, updated_at FROM registeredhospitals ORDER BY id`);
    if (hospitals.length) {
      await this.tgt(`DELETE FROM hospitalclaims`).catch(() => {});
      await this.tgt(`DELETE FROM hospitalclaims_hist`).catch(() => {});
      await this.tgt(`DELETE FROM registeredhospitals`).catch(() => {});
      const n = await this.insertMany('registeredhospitals',
        ['id', 'name', 'account', 'created_at', 'updated_at'],
        hospitals.map(r => [Number(r.id), clean(r.name), clean(r.account),
          r.created_at ?? new Date(), r.updated_at]),
        'ON CONFLICT (id) DO NOTHING', 'medical');
      await this.tgt(
        `SELECT setval(pg_get_serial_sequence('registeredhospitals','id'), GREATEST((SELECT MAX(id) FROM registeredhospitals), 1))`)
        .catch(() => {});
      e.inserted += n;
      e.notes.push(`registeredhospitals: ${n} hospitals loaded`);
    }

    // ── Hospital claims ────────────────────────────────────────────────────
    //
    // `items` is a JSON array of line items carrying EMPLOYEE ids, so the ids inside the blob are
    // translated alongside the row's own columns — left alone they would point at whichever
    // employee now holds that id. Verified against the source: 1,567 items across 175 claims, no
    // parse failures and no unknown employee ids.
    //
    // `hospital` needs no mapping because the hospital ids above are preserved.
    // The two systems name the SAME fields differently, so an item copied verbatim renders blank:
    // the claim screen reads `amount`, `type`, `narration` and `employee_id`, while the legacy blob
    // carries `medical_amount`, `staff_or_dependent`, `notes` and `employee`. Left untranslated
    // every line shows 0.00 — the amount is there, just under a key nothing reads.
    //
    //   legacy                  ->  target
    //   employee                ->  employee_id   (and remapped to the migrated id)
    //   medical_amount          ->  amount
    //   notes                   ->  narration
    //   staff_or_dependent      ->  type          ("Staff"/"Dependent" -> 'self'/'dependent')
    //   staff_dependant_name    ->  dependent_name
    //
    // `staff_dependant` is the RELATIONSHIP, not a name — it reads "Son" on all 4,179 items
    // including the Staff ones — so it is kept as-is rather than used as `dependent_name`.
    // Measured across both claim tables: 4,176 "Staff" and 3 "Dependent".
    const translateItems = (raw) => {
      let arr;
      try { arr = JSON.parse(raw || '[]'); } catch { return { json: raw, unresolved: 0 }; }
      if (!Array.isArray(arr)) return { json: raw, unresolved: 0 };
      let unresolved = 0;
      const out = arr.map((item) => {
        const legacy = String(item?.employee ?? '').trim();
        const mapped = legacy ? this.map.employee.get(legacy) : null;
        // An item whose employee did not migrate keeps its name and amount so the claim still
        // totals correctly; only the id is cleared, so nothing links to the wrong person.
        if (legacy && !mapped) unresolved++;

        const isDependent = /depend/i.test(String(item?.staff_or_dependent ?? ''));
        return {
          ...item,
          // Both spellings are kept: `employee_id` is what the claim screen reads, and `employee`
          // stays so anything still looking for the legacy key keeps working.
          employee:       mapped ? String(mapped) : '',
          employee_id:    mapped ? String(mapped) : '',
          employee_name:  item?.employee_name ?? '',
          type:           isDependent ? 'dependent' : 'self',
          dependent_name: item?.staff_dependant_name ?? '',
          narration:      item?.notes ?? '',
          amount:         item?.medical_amount ?? '0',
        };
      });
      return { json: JSON.stringify(out), unresolved };
    };

    for (const [table, label] of [['hospitalclaims', 'claims'], ['hospitalclaims_hist', 'claim history']]) {
      // hospitalclaims_hist has no posted_date column; the two tables are otherwise identical.
      const hasPostedDate = table === 'hospitalclaims';
      const src = await this.src(
        `SELECT id, hospital, items, total_amount, withholding_tax, category, total_credit_amount,
                comment, posted_by, ${hasPostedDate ? 'posted_date,' : ''} status, approved_date,
                approved_by, reference_no, response
           FROM ${table} ORDER BY id`);
      if (!src.length) continue;

      let unresolvedItems = 0;
      const rows = src.map((r) => {
        const items = translateItems(r.items);
        unresolvedItems += items.unresolved;
        return [
          Number(r.id), r.hospital == null ? null : Number(r.hospital), items.json,
          r.total_amount ?? 0, r.withholding_tax ?? 0, r.category ?? 0, r.total_credit_amount ?? 0,
          clean(r.comment) ?? '',
          // posted_by / approved_by are employee ids in the legacy data, as everywhere else in this
          // step; actor() turns them into the user accounts the application reads.
          actor(r.posted_by) ?? '0',
          ...(hasPostedDate ? [r.posted_date] : []),
          clean(r.status) ?? '', r.approved_date, actor(r.approved_by),
          clean(r.reference_no), clean(r.response),
        ];
      });

      const cols = ['id', 'hospital', 'items', 'total_amount', 'withholding_tax', 'category',
        'total_credit_amount', 'comment', 'posted_by',
        ...(hasPostedDate ? ['posted_date'] : []),
        'status', 'approved_date', 'approved_by', 'reference_no', 'response'];
      // `hospitalclaims_hist` has NO primary key or unique constraint at all — the same quirk as
      // staffmedical_hist — so `ON CONFLICT (id)` is rejected outright ("no unique or exclusion
      // constraint matching the ON CONFLICT specification"). Both tables are cleared above, so no
      // conflict clause is needed; hospitalclaims keeps one because it does have a primary key.
      const conflict = table === 'hospitalclaims' ? 'ON CONFLICT (id) DO NOTHING' : '';
      const n = await this.insertMany(table, cols, rows, conflict, 'medical');
      await this.tgt(
        `SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`)
        .catch(() => {});
      e.inserted += n;
      e.notes.push(`${table}: ${n} ${label} loaded${unresolvedItems ? `, ${unresolvedItems} line item(s) had an employee that did not migrate` : ''}`);
    }

    this.done(e);
  }

  /* ── 0. Reference code lists ──────────────────────────────────────────── */
  // Every legacy lookup (title, gender, job title, staff level, structure type…) is matched BY LABEL
  // onto a code list the target must already have. On an unseeded database none exist, so every
  // employee would import with those links NULL and the employee form's dropdowns would be empty.
  // Seeding is idempotent (existing ids are kept), so it is safe on a database that is already seeded.
  async seedReferenceData() {
    const e = this.step('seed', 'Reference code lists');
    const { seedCodeLists } = require('../../prisma/seedCodeLists');
    try {
      const { lists, values } = await seedCodeLists({ url: this.targetUrl, quiet: true });
      e.notes.push(`${lists} code lists checked (${values} values) — missing ones created, existing ids kept`);
    } catch (err) {
      // Stop here: loading on top of missing code lists silently writes NULL lookups.
      throw new Error(`Seeding code lists into the target failed — ${err.message || err.code}`);
    }
    this.done(e);
  }

  /* ── 4c. PC codes (positions) ─────────────────────────────────────────── */
  // The legacy system has no positions, but it does have the supervisor tree (loaded above), which
  // is exactly what the app derives PC codes from. This runs the same backfill an operator would run
  // by hand (scripts/backfillPcCodes.js): one seat per active employee, mirroring who reports to
  // whom, plus the RM/RO tag. Idempotent — employees who already hold a seat keep it.
  //
  // Not fatal: a problem here (e.g. the pccodes tables were never created on this database) is
  // reported on the step, and the payroll and medical load carries on — positions can be backfilled
  // afterwards with `node src/scripts/backfillPcCodes.js`.
  async loadPcCodes() {
    const e = this.step('pccodes', 'PC codes (positions)');
    const { backfillPcCodes } = require('../../scripts/backfillPcCodes');
    try {
      const r = await backfillPcCodes({ url: this.targetUrl, quiet: true });
      e.inserted += r.assignmentsCreated;
      e.notes.push(`${r.codesCreated} positions created and ${r.assignmentsCreated} employees seated` +
        (r.alreadyAssigned ? `, ${r.alreadyAssigned} already held a position` : ''));
      e.notes.push(`${r.rm} RM (supervise someone) · ${r.ro} RO · ${r.tagsSet} RM/RO tags set`);
      if (r.excluded) e.notes.push(`${r.excluded} ${r.excludedPrefixes.join('/')} staff left out by design — their positions are set up separately`);
      if (r.skippedCycle) e.notes.push(`${r.skippedCycle} employees in a supervisor loop were not placed — assign them from the PC Codes screen`);
      if (r.note) e.notes.push(r.note);
    } catch (err) {
      e.skipped++;
      e.notes.push(`Not assigned: ${err.message || err.code} — run node src/scripts/backfillPcCodes.js after fixing`);
    }
    this.done(e);
  }

  /* ── orchestration ────────────────────────────────────────────────────── */
  async run() {
    const started = Date.now();
    await this.connect();
    try {
      await this.seedReferenceData();
      await this.loadCodelists();
      await this.loadStructures();
      await this.loadGrades();
      await this.loadEmployees();
      // After employees, so the admin login can be linked to its migrated employee record.
      await this.loadAccessControl();
      // Needs employees, their supervisor links and job titles — all loaded above.
      await this.loadPcCodes();
      // Components must exist before employeesalary and notch amounts can reference them.
      await this.loadSalaryComponents();
      if (this.scopes.payroll?.enabled) {
        await this.loadPayrollConfig();
        await this.loadPayrollRuns();
        await this.loadPayrollEmployees();
        // Frequencies and calculation groups, then rewrite the roster ids to match.
        await this.loadPayrollConfiguration();
        // A column's inputs: which salary components feed it and which other columns it adds or
        // subtracts. Without it Gross, Total Deductions and Net Salary all compute as zero.
        await this.loadPayrollColumnRefs();
        // Needs the columns and the groups above. Without it every column is ungrouped, which the
        // payroll engine reads as universal — 195 columns per employee instead of 25.
        await this.loadPayrollColumnGroups();
        // Needs the payroll columns AND the calculation groups above: every rule attaches to both,
        // and employee exemptions are re-pointed at the new rule ids here.
        await this.loadCalculationRules();
        // Grade promotion first, then the notch step — loadNotchComponents clears Basic Salary's
        // per-employee and pay-grade rows, and running it last stops the promotion re-creating
        // them. Basic Salary is notch-linked, so the notch is the only place it should live.
        await this.loadGradeComponents();
        await this.loadNotchComponents();
        await this.loadPayrollData();
      }
      if (this.scopes.medical?.enabled) await this.loadMedical();

      return {
        ok: true,
        target: (this.targetUrl.split('/').pop() || '').split('?')[0],
        steps: this.stats,
        warnings: this.warnings,
        elapsedMs: Date.now() - started,
      };
    } finally {
      await this.close();
    }
  }
}

async function execute(opts) {
  return new MigrationRun(opts).run();
}

module.exports = { execute, MigrationRun };
