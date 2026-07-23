/**
 * Shared harness for the HR API smoke suite.
 *
 * Pure HTTP (global fetch, Node 18+/24) — no test framework, no DB coupling. Each module test gets a
 * `Suite` instance with authenticated request helpers, assertions, and a cleanup registry. The suite
 * only ever creates/edits records with a `ZZ_` name prefix and deletes everything it created, so it is
 * safe to run against a real database and safe to re-run.
 *
 *   BASE URL   — SMOKE_BASE_URL  (default http://localhost:3088/v1/api/hr)
 *   LOGIN      — SMOKE_EMAIL / SMOKE_PASSWORD (default superadmin@usg.com / pass1234)
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3088/v1/api/hr').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL || 'superadmin@usg.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'pass1234';

// Unique-ish prefix for this run so parallel/repeat runs don't collide on unique names.
const RUN_TAG = `ZZ_${Date.now().toString().slice(-6)}`;

const c = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m', bold: '\x1b[1m',
};
const paint = (s, col) => `${col}${s}${c.reset}`;

let _token = null;

/** Raw request. Returns { status, body } — body is parsed JSON (or text). Never throws on HTTP status. */
async function request(method, path, body, { auth = true, raw = false } = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (auth && _token) headers.Authorization = `Bearer ${_token}`;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
  } catch (e) {
    return { status: 0, body: { message: `network error: ${e.message}` }, ok: false };
  }
  let parsed = null;
  const text = await res.text().catch(() => '');
  if (raw) return { status: res.status, body: text, ok: res.ok };
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, ok: res.ok };
}

const api = {
  get:  (p, o)    => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b, o),
  put:  (p, b, o) => request('PUT', p, b, o),
  del:  (p, b, o) => request('DELETE', p, b, o),
};

/** GET /health — used to fail fast with a clear message if the server isn't up. */
async function preflight() {
  const r = await request('GET', '/health', undefined, { auth: false });
  if (r.status !== 200) {
    console.error(paint(`\n✖ Cannot reach the API at ${BASE} (GET /health → ${r.status || 'no response'}).`, c.red));
    console.error(paint('  Start the server first (npm run dev) and confirm SMOKE_BASE_URL.\n', c.yellow));
    return false;
  }
  return true;
}

/** Log in as the smoke user and cache the JWT. Returns true on success. */
async function login() {
  const r = await request('POST', '/login', { email: EMAIL, password: PASSWORD }, { auth: false });
  _token = r.body?.accessToken || r.body?.data?.accessToken || r.body?.token || null;
  if (r.status !== 200 || !_token) {
    console.error(paint(`\n✖ Login failed for ${EMAIL} (status ${r.status}). ${r.body?.message || ''}`, c.red));
    console.error(paint('  Seed the database (node src/prisma/seed.js) or set SMOKE_EMAIL/SMOKE_PASSWORD.\n', c.yellow));
    return false;
  }
  return true;
}

/** Per-module test context: assertions, request helpers, cleanup registry. */
class Suite {
  constructor(name) {
    this.name = name;
    this.passed = 0;
    this.failed = 0;
    this.failures = [];
    this._cleanups = []; // { path, label } — deleted in reverse (LIFO) at the end
    this.api = api;
    this.email = EMAIL;            // the smoke user's login email
    this.base = BASE;             // API base URL (for raw fetches with custom headers)
    this.tag = RUN_TAG;             // e.g. name things `${t.tag}_Foo`
    this.uniq = (base) => `${RUN_TAG}_${base}`;
  }

  check(name, cond, extra) {
    if (cond) {
      this.passed++;
      console.log('  ' + paint('PASS', c.green) + ' ' + name);
    } else {
      this.failed++;
      const detail = extra !== undefined ? paint(' ' + trunc(JSON.stringify(extra)), c.gray) : '';
      console.log('  ' + paint('FAIL', c.red) + ' ' + name + detail);
      this.failures.push(name);
    }
    return cond;
  }

  /** A create whose validity depends on site-specific config (e.g. the employee form's required
   *  fields). 2xx = pass; a 4xx validation error = a skip (still counts as pass, logged as skipped);
   *  only a 5xx server error fails. Returns the response. */
  createOrSkip(res, name) {
    if (res.status >= 200 && res.status < 300) { this.check(name + ' → 2xx', true); }
    else if (res.status >= 400 && res.status < 500) {
      this.passed++;
      console.log('  ' + paint('SKIP', c.yellow) + ' ' + name + paint(` — config/validation (${res.body?.message || res.status})`, c.gray));
    } else { this.check(name + ' (no server error)', false, { status: res.status, body: res.body }); }
    return res;
  }

  // Convenience assertions returning the response so callers can chain.
  expectStatus(res, code, name) {
    this.check(name || `${res.__method || ''} → ${code}`, res.status === code, { got: res.status, body: res.body });
    return res;
  }
  expectOk(res, name) {
    this.check(name || 'request ok (2xx)', res.status >= 200 && res.status < 300, { got: res.status, body: res.body?.message ?? res.body });
    return res;
  }

  /** Register a DELETE path to run during cleanup (LIFO). */
  track(path, label) { if (path) this._cleanups.push({ path, label }); }

  /** GET a list endpoint and return the first item's id (or one matching `filter`). Handles both
   *  `{ data: [...] }` and paginated `{ data: { records: [...] } }` shapes. Used for prerequisites
   *  (e.g. an existing employee) — never mutates. */
  async firstId(listPath, filter) {
    const r = await api.get(listPath);
    const d = r.body?.data;
    const arr = Array.isArray(d) ? d : Array.isArray(d?.records) ? d.records
      : Array.isArray(d?.employees) ? d.employees : [];
    const item = filter ? arr.find(filter) : arr[0];
    return item?.id ?? null;
  }

  async cleanup() {
    for (let i = this._cleanups.length - 1; i >= 0; i--) {
      const { path } = this._cleanups[i];
      try { await api.del(path); } catch { /* best-effort */ }
    }
    this._cleanups = [];
  }
}

function trunc(s, n = 220) { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; }

module.exports = { api, preflight, login, Suite, paint, colors: c, BASE, EMAIL, RUN_TAG };
