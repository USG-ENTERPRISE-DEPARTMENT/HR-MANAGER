const axios          = require('axios');
const fs             = require('fs');
const path           = require('path');
const { getApiConfig } = require('../controllers/apiIntegrationController');
const coreApi          = require('./coreApiClient');
const { prisma }       = require('./dbQueryHelper');
const { als }          = require('../middleware/requestContext');

/**
 * Staff code (employee.employee_id, e.g. P2001002) of the user logged in on the current request.
 * Read from the request context so every postToGL caller gets it without threading `req` through.
 * Returns null outside a request, or when the user has no linked employee (admin-only accounts).
 */
async function loggedInEmployeeCode() {
  const empId = als.getStore()?.req?.user?.employeeId;
  if (empId == null) return null;
  const emp = await prisma.employee
    .findUnique({ where: { id: BigInt(empId) }, select: { employee_id: true } })
    .catch(() => null);
  return emp?.employee_id || null;
}

/**
 * Is GL account validation switched on?
 *
 * Settings → App Controls (`gl_validate_accounts`) is authoritative and defaults to ON, so an
 * install that never touches the setting keeps screening accounts. GL_VALIDATE_ACCOUNTS=off in the
 * environment still forces it off, which keeps the pre-existing escape hatch working for deployments
 * that set it before this switch existed.
 */
async function validationEnabled() {
  if (String(process.env.GL_VALIDATE_ACCOUNTS ?? '').toLowerCase() === 'off') return false;
  const row = await prisma.settings
    .findFirst({ where: { name: 'gl_validate_accounts', category: 'app_controls' }, select: { value: true } })
    .catch(() => null);
  return row ? row.value === '1' : true;   // never saved → on
}

// ── GL posting audit log ─────────────────────────────────────────────────────
// Every GL call (payroll + medical) is appended to Server/logs/gl-postings.log as one pretty-printed
// block per attempt: the exact JSON sent, then the response or the error. This is a diagnostic aid for
// reconciling with the bank — the authoritative record stays in the DB (document_ref/payment_log).
//
// Set GL_LOG_FILE to relocate it, or GL_LOG=off to disable. Logging never breaks a posting: every
// write is wrapped, and a failure here is reported but swallowed.
const GL_LOG_ENABLED = String(process.env.GL_LOG ?? '').toLowerCase() !== 'off';
const GL_LOG_PATH    = process.env.GL_LOG_FILE
  ? path.resolve(process.env.GL_LOG_FILE)
  : path.join(__dirname, '..', '..', 'logs', 'gl-postings.log');

function glLog(section, body) {
  if (!GL_LOG_ENABLED) return;
  try {
    fs.mkdirSync(path.dirname(GL_LOG_PATH), { recursive: true });
    const stamp = new Date().toISOString();
    fs.appendFileSync(
      GL_LOG_PATH,
      `\n===== ${stamp} — ${section} =====\n${typeof body === 'string' ? body : JSON.stringify(body, null, 2)}\n`,
      'utf8',
    );
  } catch (e) {
    console.error('[gl log] could not write', GL_LOG_PATH, '-', e.message);
  }
}

// ── Account validation ───────────────────────────────────────────────────────
// The GL accepts a payload without checking that the accounts in it exist, so a posting to a bad
// account number is accepted and then has to be traced and unwound at the bank. Every posting is
// screened through the core system's bulk-account-status-validator first.
//
// That service returns a STATUS per account rather than a simple valid/invalid list:
//   N  NORMAL             — the only status a payroll credit may be posted to
//   DO DORMANT            — the account exists but cannot receive a credit
//   NF ACCOUNT NOT FOUND  — no such account
// Anything else is treated as blocking too: an unrecognised status must never be assumed postable.
//
// It is a SEPARATE service from the GL posting API — different host, port and credentials — so it is
// configured independently (Settings → API, or GL_VALIDATE_URL / _KEY / _SECRET).

// Statuses that may be posted to. Deliberately an allowlist: a status the bank adds later blocks
// until someone decides it is safe, rather than silently passing.
const POSTABLE_STATUSES = new Set(['N']);

function validateUrlFrom(cfg, extra) {
  return cfg.gl_validate_url || process.env.GL_VALIDATE_URL || extra.validate_url || null;
}

/**
 * Normalise the validator's `data` into a Map of account → { status, description }.
 *
 * Two shapes come back from the same endpoint:
 *   • many accounts → keyed by account number: { "008220...": { status, description }, ... }
 *   • ONE account   → the status object itself: { status, description }
 * The single-account form has no account number in it at all, so it is matched positionally against
 * the one account that was asked about. Missing this collapses a one-account journal into "shape not
 * understood" and skips the check entirely — and a journal touching a single distinct account is
 * completely ordinary (one employee, or several sharing a component account).
 */
function parseStatuses(data, list) {
  const out = new Map();
  if (!data || typeof data !== 'object') return out;

  if (typeof data.status === 'string') {
    // Single-account form. Only meaningful when exactly one account was submitted.
    if (list.length === 1) out.set(String(list[0]), { status: data.status, description: data.description ?? null });
    return out;
  }

  for (const [acct, v] of Object.entries(data)) {
    // `{ o_result: null }` comes back for an empty request — not an account entry.
    if (!v || typeof v !== 'object' || typeof v.status !== 'string') continue;
    out.set(String(acct), { status: v.status, description: v.description ?? null });
  }
  return out;
}

/**
 * Turn the core API's `{ validAccounts, invalidAccounts }` into the same Map invalidAccounts returns.
 * Only an account named in validAccounts passes; one in neither list is blocked as NO_RESPONSE, for the
 * same reason as below — silence is not evidence that an account is good.
 */
function listVerdicts({ validAccounts, invalidAccounts: invalid }, list, tag) {
  const valid = new Set(validAccounts.map(a => String(a).trim()));
  const bad   = new Set(invalid.map(a => String(a).trim()));
  const out = new Map();
  const unanswered = [];
  for (const acct of list) {
    if (bad.has(acct))        out.set(acct, { status: 'INVALID', description: 'The core banking system reports this account as invalid' });
    else if (!valid.has(acct)) { unanswered.push(acct); out.set(acct, { status: 'NO_RESPONSE', description: 'The validator returned no status for this account' }); }
  }
  glLog(`VALIDATE RESULT${tag}`, {
    submitted:    list.length,
    blockedCount: out.size,
    blocked:      [...out.entries()].map(([a, s]) => ({ account: a, status: s.status })),
    unanswered:   unanswered.length ? unanswered : undefined,
  });
  return out;
}

/**
 * The core API's `{ valid…, invalid… }` lists, whatever the provider calls them: validateNormalAccounts
 * uses validAccounts/invalidAccounts, and validateBranchCodes is expected to follow suit
 * (validBranches/invalidBranches, validBranchCodes/…). Null when the reply carries no such pair.
 */
function pickVerdictLists(data) {
  if (!data || typeof data !== 'object') return null;
  const keys = Object.keys(data);
  const validKey   = keys.find(k => /^valid/i.test(k)   && Array.isArray(data[k]));
  const invalidKey = keys.find(k => /^invalid/i.test(k) && Array.isArray(data[k]));
  return validKey && invalidKey ? { valid: data[validKey], invalid: data[invalidKey] } : null;
}

/**
 * Ask the core API which branch codes in a journal it does not recognise (POST /validateBranchCodes).
 *
 * Same contract as invalidAccounts: a Map of code → { status, description } for every branch that
 * must NOT be posted to, or null when the check could not be completed. A code the reply leaves out
 * is blocked as NO_RESPONSE. Core API only — the old services had no branch check.
 *
 * The body key is `branches` — the endpoint itself answers with that format ({"branches":["code1"]});
 * CORE_API_BRANCH_KEY overrides it should that change.
 */
async function invalidBranches(branches, referenceNo = '') {
  const tag  = referenceNo ? ` ${referenceNo}` : '';
  const list = [...new Set(branches.map(b => String(b ?? '').trim()).filter(Boolean))];
  if (!list.length) return new Map();

  const listKey = process.env.CORE_API_BRANCH_KEY || 'branches';
  glLog(`BRANCH VALIDATE REQUEST${tag} → POST ${coreApi.urlOf('/validateBranchCodes')}`, { [listKey]: list });

  let r;
  try {
    r = await coreApi.call('post', '/validateBranchCodes', { [listKey]: list });
  } catch (e) {
    glLog(`BRANCH VALIDATE TRANSPORT FAILURE${tag}`, { message: e.message });
    return null;
  }
  glLog(`BRANCH VALIDATE RESPONSE${tag} (HTTP ${r.status})`, r.decrypted.ok ? r.decrypted.data : { error: r.decrypted.error, raw: r.raw });

  // Read the lists whatever the HTTP status — the account endpoint answers 500 when any entry is
  // invalid, and this one is assumed to behave the same.
  const lists = r.decrypted.ok ? pickVerdictLists(r.decrypted.data?.data) : null;
  if (!lists) {
    glLog(`BRANCH VALIDATE UNUSABLE${tag}`, {
      expected: 'data: { validBranches: [...], invalidBranches: [...] } (or similarly named lists)',
      status: r.status, body: r.decrypted.ok ? r.decrypted.data : r.decrypted.error,
    });
    return null;
  }

  const valid = new Set(lists.valid.map(b => String(b).trim()));
  const bad   = new Set(lists.invalid.map(b => String(b).trim()));
  const out = new Map();
  for (const code of list) {
    if (bad.has(code))         out.set(code, { status: 'INVALID', description: 'The core banking system does not recognise this branch code' });
    else if (!valid.has(code)) out.set(code, { status: 'NO_RESPONSE', description: 'The branch validator returned no status for this branch code' });
  }
  glLog(`BRANCH VALIDATE RESULT${tag}`, { submitted: list.length, blockedCount: out.size, blocked: [...out.keys()] });
  return out;
}

/**
 * The home branch of every employee on a journal, keyed by staff code (the lines' `employeeCode`).
 *
 * The core system also checks the EMPLOYEE's own branch during bulk payment — not just the branch on
 * the line, which comes from the payroll column — so these codes are validated alongside the lines'.
 * Employees with no branch set contribute nothing. Returns null if the lookup itself fails, which the
 * caller treats like the validator being unavailable.
 */
async function employeeBranches(debitAccounts, creditAccounts) {
  const codes = [...new Set([...(debitAccounts || []), ...(creditAccounts || [])]
    .map(l => String(l?.employeeCode ?? '').trim()).filter(Boolean))];
  const out = new Map();
  if (!codes.length) return out;
  try {
    const emps = await prisma.employee.findMany({
      where:  { employee_id: { in: codes } },
      select: { employee_id: true, firstName: true, lastName: true, branchId: true },
    });
    const ids = [...new Set(emps.map(e => e.branchId).filter(v => v != null))];
    const structures = ids.length
      ? await prisma.companystructures.findMany({ where: { id: { in: ids } }, select: { id: true, comp_code: true, title: true } })
      : [];
    const byId = new Map(structures.map(s => [String(s.id), s]));
    for (const e of emps) {
      const s = e.branchId != null ? byId.get(String(e.branchId)) : null;
      const branch = String(s?.comp_code ?? '').trim();
      if (!branch) continue;
      out.set(String(e.employee_id), {
        branch, branchTitle: s.title ?? null,
        name: [e.firstName, e.lastName].filter(Boolean).join(' '),
      });
    }
    return out;
  } catch (e) {
    glLog('BRANCH LOOKUP FAILURE', { message: e.message, employees: codes.length });
    return null;
  }
}

/**
 * Where each blocked branch code was used, in the same shape as describeAccounts so the existing
 * "GL posting blocked" report can show it (kind 'branch'): the journal lines that carry it, and the
 * employees whose own branch it is.
 */
function describeBranches(blocked, debitAccounts, creditAccounts, empBranches = new Map()) {
  const lines = [
    ...(debitAccounts  || []).map(d => ({ branch: d.debitBranch,  narration: d.debitNarration,  employeeCode: d.employeeCode, side: 'debit'  })),
    ...(creditAccounts || []).map(c => ({ branch: c.creditBranch, narration: c.creditNarration, employeeCode: c.employeeCode, side: 'credit' })),
  ];
  return [...blocked.entries()].map(([code, s]) => {
    const used   = lines.filter(l => String(l.branch ?? '').trim() === code);
    const labels = [...new Set(used.map(l => l.narration).filter(Boolean).map(String))];
    const homed  = [...empBranches.entries()].filter(([, b]) => b.branch === code);
    const sourceNames = [...new Set(labels.map(x => x.split(' - ')[0].trim()).filter(Boolean))];
    if (homed.length) {
      const title = homed[0][1].branchTitle;
      sourceNames.push(`Employee branch${title ? ` (${title})` : ''} — ${homed.length} employee${homed.length === 1 ? '' : 's'}`);
    }
    return {
      account:       code,
      kind:          'branch',
      status:        s.status,
      description:   s.description,
      sourceNames,
      employeeNames: [...new Set([
        ...labels.map(x => x.split(' - ').slice(1).join(' - ').trim()),
        ...homed.map(([, b]) => b.name),
      ].filter(Boolean))],
      employeeCodes: [...new Set([...used.map(l => l.employeeCode), ...homed.map(([c]) => c)].filter(Boolean).map(String))],
      sides:         [...new Set(used.map(l => l.side))],
      labels,
    };
  });
}

/**
 * Ask the core system which of `accounts` cannot be posted to.
 *
 * Returns a Map of account → { status, description } for every account that is NOT postable, or null
 * when the check could not be performed (not configured, unreachable, or an unexpected response).
 * Null means "unknown", NOT "all valid" — the caller decides what to do with that, and must never
 * treat it as a pass.
 */
async function invalidAccounts(accounts, cfg, extra, _headers, referenceNo = '') {
  const tag = referenceNo ? ` ${referenceNo}` : '';
  // Blank entries are dropped before sending: an empty string makes the validator answer HTTP 500
  // for the whole batch, which would block a posting over a field that was simply not filled in.
  const list = [...new Set(accounts.map(a => String(a ?? '').trim()).filter(Boolean))];
  if (!list.length) return new Map();

  const url = validateUrlFrom(cfg, extra);
  if (!url) {
    glLog(`VALIDATE SKIPPED${tag}`, 'No validator URL configured (set gl_validate_url in Settings → API, or GL_VALIDATE_URL).');
    return null;
  }

  // This service has its own credentials — it does NOT accept the GL posting key. Omitting the
  // secret returns 401.
  const headers = { 'Content-Type': 'application/json' };
  const key    = cfg.gl_validate_key    || process.env.GL_VALIDATE_KEY    || '';
  const secret = cfg.gl_validate_secret || process.env.GL_VALIDATE_SECRET || '';
  if (key)    headers['x-api-key']    = key;
  if (secret) headers['x-api-secret'] = secret;

  // Log the request before sending, matching the posting flow: when the call hangs or the process
  // dies mid-flight there is still a record of exactly what was asked. Auth headers are not logged.
  glLog(`VALIDATE REQUEST${tag} → POST ${url}`, { accounts: list });

  let res;
  if (cfg.core_api_enabled) {
    // New core API: encrypted, token-authenticated; its own log (logs/core-api.log) has the wire detail.
    // `res` is shaped like an axios response so the checks below are shared with the old validator.
    try {
      // The core API itself answers that the list key is `accounts` ({"accounts":["acct1","acct2"]});
      // `accountList` is refused with 400. CORE_API_VALIDATE_KEY overrides it should that change.
      const listKey = process.env.CORE_API_VALIDATE_KEY || 'accounts';
      const r = await coreApi.call('post', '/validateNormalAccounts', { [listKey]: list });
      // The core API answers with two lists, and sends HTTP 500 + responseCode '001' whenever ANY account
      // is invalid ("1 of 1 accounts invalid."). That is a real answer, not a failure, so the lists are
      // read whatever the HTTP status.
      const lists = r.decrypted.ok ? r.decrypted.data?.data : null;
      if (lists && Array.isArray(lists.validAccounts) && Array.isArray(lists.invalidAccounts)) {
        glLog(`VALIDATE RESPONSE${tag} (HTTP ${r.status})`, r.decrypted.data);
        return listVerdicts(lists, list, tag);
      }
      if (!r.decrypted.ok || r.status >= 400) {
        glLog(`VALIDATE TRANSPORT FAILURE${tag}`, {
          url, status: r.status, body: r.decrypted.ok ? r.decrypted.data : r.decrypted.error,
        });
        return null;
      }
      res = { status: r.status, data: r.decrypted.data };
    } catch (e) {
      glLog(`VALIDATE TRANSPORT FAILURE${tag}`, { url, message: e.message });
      return null;
    }
  } else {
    try {
      res = await axios.post(url, { accounts: list }, {
        headers, timeout: Number(cfg.gl_timeout) || 30000,
      });
    } catch (e) {
      glLog(`VALIDATE TRANSPORT FAILURE${tag}`, {
        url, message: e.message, status: e.response?.status ?? null, body: e.response?.data ?? null,
      });
      return null;
    }
  }

  // The raw response, always — this is the record that shows whether the validator actually screened
  // the accounts or answered with something the parsing below could not use.
  glLog(`VALIDATE RESPONSE${tag} (HTTP ${res.status})`, res.data);

  // This service reports success as `success: true` with responseCode 200 (a NUMBER, not the '000'
  // string the posting API uses), so both are accepted — as is the core API's '000'.
  const code = String(res.data?.responseCode ?? '');
  const ok   = coreApi.isSuccess(res.data);
  if (!ok) {
    glLog(`VALIDATE REJECTED${tag}`, { url, responseCode: code, message: res.data?.message ?? null });
    return null;
  }

  const statuses = parseStatuses(res.data?.data, list);
  if (!statuses.size) {
    glLog(`VALIDATE UNEXPECTED SHAPE${tag}`, {
      url,
      expected: 'data keyed by account number, or a single {status, description}',
      submitted: list.length,
      body: res.data,
    });
    return null;
  }

  const bad = new Map();
  const unanswered = [];
  for (const acct of list) {
    const s = statuses.get(acct);
    // An account the validator did not answer for is not evidence that it is good.
    if (!s) { unanswered.push(acct); bad.set(acct, { status: 'NO_RESPONSE', description: 'The validator returned no status for this account' }); continue; }
    if (!POSTABLE_STATUSES.has(String(s.status).toUpperCase())) bad.set(acct, s);
  }

  glLog(`VALIDATE RESULT${tag}`, {
    submitted:    list.length,
    blockedCount: bad.size,
    blocked:      [...bad.entries()].map(([a, s]) => ({ account: a, status: s.status, description: s.description })),
    unanswered:   unanswered.length ? unanswered : undefined,
    note: bad.size === list.length && list.length > 0
      ? 'Every submitted account was blocked — verify the validator is screening rather than rejecting the whole request.'
      : undefined,
  });

  return bad;
}

/**
 * Describe an account in the terms the user will recognise.
 *
 * Journal lines carry a narration built by the caller — "Basic Salary - Jane Doe" for a payroll
 * component, "Net Pay - Jane Doe" for the cash leg, "Medical - Jane Doe - Malaria" for a claim. That
 * narration is the only place the GL component name or employee name survives into this helper, so
 * it is what gets reported back. `employeeCode` is included when the line carries one.
 *
 * `blocked` is a Map of account → { status, description } from the validator. The status is carried
 * into each entry because the fix differs by reason: a DORMANT account has to be reactivated at the
 * bank, an ACCOUNT NOT FOUND is a wrong number to correct here.
 */
function describeAccounts(blocked, debitAccounts, creditAccounts) {
  const byAccount = new Map();
  const add = (acct, narration, empCode, side) => {
    if (!acct || !blocked.has(String(acct))) return;
    const key = String(acct);
    if (!byAccount.has(key)) {
      byAccount.set(key, { account: key, labels: new Set(), employeeCodes: new Set(), sides: new Set() });
    }
    const entry = byAccount.get(key);
    if (narration) entry.labels.add(String(narration));
    if (empCode) entry.employeeCodes.add(String(empCode));
    entry.sides.add(side);
  };
  for (const d of debitAccounts  || []) add(d.debitAccount,  d.debitNarration,  d.employeeCode, 'debit');
  for (const c of creditAccounts || []) add(c.creditAccount, c.creditNarration, c.employeeCode, 'credit');

  return [...byAccount.values()].map(e => {
    const labels = [...e.labels];
    // Narrations are built as "<component> - <employee>"; the leading segment is the GL component
    // (e.g. "Salary Basic"), and "Net Pay" marks the cash leg paid to an employee's own bank
    // account. That distinction is what tells the user WHERE to go and fix the number: a component's
    // GL account lives in Payroll Setup, an employee's bank account on their record.
    const isNetPay = labels.some(l => /^net pay\b/i.test(l));
    const sources  = [...new Set(labels.map(l => String(l).split(' - ')[0].trim()).filter(Boolean))];
    const people   = [...new Set(labels.map(l => String(l).split(' - ').slice(1).join(' - ').trim()).filter(Boolean))];
    const s = blocked.get(e.account) ?? {};
    return {
      account:       e.account,
      // 'employee' → an employee bank account; 'component' → a payroll/medical GL account.
      kind:          isNetPay ? 'employee' : 'component',
      // Why the bank refused this account — 'NF' (not found), 'DO' (dormant), or whatever new code
      // the core system introduces. The UI renders `description` as the reason column.
      status:        s.status ?? null,
      description:   s.description ?? null,
      sourceNames:   sources,           // GL component names, e.g. ["Salary Basic", "Lunch"]
      employeeNames: people,            // employee names taken from the narration
      employeeCodes: [...e.employeeCodes],
      sides:         [...e.sides],
      labels,                           // raw narrations, kept for the log and as a fallback
    };
  });
}

/**
 * Post a bulk payment to the GL system.
 *
 * Debit/credit line shape (`employeeCode` is omitted on lines that belong to no single employee,
 * e.g. the hospital and WHT credits on a medical claim):
 *   debit:  { debitAmount, debitAccount, debitCurrency, debitNarration, debitProdRef, debitBranch, employeeCode? }
 *   credit: { creditAmount, creditAccount, creditCurrency, creditNarration, creditProdRef, creditBranch, employeeCode? }
 *
 * @param {object}   opts
 * @param {string}   opts.approvedBy      User who approved the posting.
 * @param {string}   opts.referenceNo     Caller-generated reference (e.g. `PR<id><ts>`).
 * @param {object[]} opts.debitAccounts   Debit lines, shape above.
 * @param {object[]} opts.creditAccounts  Credit lines, shape above.
 * @param {string}  [opts.description]    Human-readable summary of the batch; falls back to gl_extra.
 * @param {string}  [opts.branch]         Top-level posting branch; falls back to gl_extra then '000'.
 * @param {string}  [opts.terminal]       Terminal identifier; falls back to gl_extra then X-FORWARDED-FOR.
 * @returns {{ documentRef: string, raw: object }}
 */
async function postToGL({
  approvedBy, referenceNo, debitAccounts, creditAccounts,
  description, branch, terminal,
}) {
  const cfg = await getApiConfig();
  const url = cfg.gl_url;
  if (!url) throw new Error('GL API URL not configured');

  // ── Empty-account gate (last line of defence, all callers) ───────────────────
  // Every line must carry an account number. The GL does not check, so a line with a blank account
  // posts as-is and has to be traced and unwound by hand at the bank.
  //
  // This gate is NOT redundant with the account validator below. The validator drops blanks from the
  // list it submits — it has to, because a single empty string makes that service answer HTTP 500
  // for the whole batch and would block an entire payroll over one unfilled field. Dropping them
  // there means a blank account is never *screened*, so without this check it would sail through
  // validation and straight into the posting. Refuse it here instead.
  //
  // Callers that build journals (payroll, medical) already skip accountless lines where they can
  // name the employee or component responsible; this catches anything they miss.
  const blankLines = [];
  (debitAccounts || []).forEach((d, i) => {
    if (!String(d?.debitAccount ?? '').trim()) {
      blankLines.push({ side: 'debit', line: i + 1, narration: d?.debitNarration ?? null, employeeCode: d?.employeeCode ?? null, amount: d?.debitAmount ?? null });
    }
  });
  (creditAccounts || []).forEach((c, i) => {
    if (!String(c?.creditAccount ?? '').trim()) {
      blankLines.push({ side: 'credit', line: i + 1, narration: c?.creditNarration ?? null, employeeCode: c?.employeeCode ?? null, amount: c?.creditAmount ?? null });
    }
  });
  if (blankLines.length) {
    glLog(`BLOCKED ${referenceNo} — blank account numbers`, { count: blankLines.length, lines: blankLines });
    console.error(`[gl] ${referenceNo}: blocked — ${blankLines.length} line(s) have no account number`);
    // Reuse the invalid-accounts channel so the UI renders these in the same table it already has,
    // with an empty `account` and a reason that says what is wrong.
    const err = new Error(
      `GL posting blocked — ${blankLines.length} journal line(s) have no account number. `
      + `Nothing was sent to the GL.`,
    );
    err.glInvalidAccounts = blankLines.map(l => {
      const labels  = l.narration ? [String(l.narration)] : [];
      const isNetPay = labels.some(x => /^net pay\b/i.test(x));
      return {
        account:       '',
        kind:          isNetPay ? 'employee' : 'component',
        status:        'MISSING',
        description:   isNetPay
          ? 'No bank account on this employee record'
          : 'No GL account configured for this payroll component',
        sourceNames:   labels.map(x => x.split(' - ')[0].trim()).filter(Boolean),
        employeeNames: labels.map(x => x.split(' - ').slice(1).join(' - ').trim()).filter(Boolean),
        employeeCodes: l.employeeCode ? [String(l.employeeCode)] : [],
        sides:         [l.side],
        labels,
      };
    });
    throw err;
  }

  // ── Balance gate (last line of defence, all callers) ─────────────────────────
  // The GL accepts whatever it is sent without verifying that debits equal credits, so an unbalanced
  // batch posts silently and then has to be unwound by hand at the bank. Refuse to send one. Callers
  // that build journals (payroll, medical) also check earlier, where they can name the specific cause.
  const sum = (rows, field) => (rows || []).reduce((s, r) => s + (parseFloat(r?.[field]) || 0), 0);
  const drTotal = Math.round((sum(debitAccounts,  'debitAmount')  + Number.EPSILON) * 100) / 100;
  const crTotal = Math.round((sum(creditAccounts, 'creditAmount') + Number.EPSILON) * 100) / 100;
  const drift   = Math.round((drTotal - crTotal + Number.EPSILON) * 100) / 100;
  if (Math.abs(drift) > 0.01) {
    glLog(`BLOCKED ${referenceNo} — unbalanced`, {
      totalDebits: drTotal, totalCredits: crTotal, difference: drift,
      debitLines: (debitAccounts || []).length, creditLines: (creditAccounts || []).length,
    });
    const err = new Error(
      `GL posting blocked — journal does not balance. Debits ${drTotal.toFixed(2)} vs credits ` +
      `${crTotal.toFixed(2)} (difference ${drift.toFixed(2)}). Nothing was sent to the GL.`,
    );
    err.glImbalance = { totalDr: drTotal, totalCr: crTotal, diff: drift };
    throw err;
  }

  let extra = {};
  try { extra = JSON.parse(cfg.gl_extra || '{}'); } catch {}

  const headers = { 'Content-Type': 'application/json' };
  const forwardedFor = cfg.gl_forwarded_for || extra.x_forwarded_for || extra.forwarded_for;
  if (forwardedFor) headers['X-FORWARDED-FOR'] = String(forwardedFor);
  if (cfg.gl_bearer_token) {
    headers['Authorization'] = `Bearer ${cfg.gl_bearer_token}`;
  } else if (cfg.gl_basic_user) {
    const creds = Buffer.from(`${cfg.gl_basic_user}:${cfg.gl_basic_pass}`).toString('base64');
    headers['Authorization'] = `Basic ${creds}`;
  } else {
    if (cfg.gl_api_key)    headers['x-api-key']    = cfg.gl_api_key;
    if (cfg.gl_api_secret) headers['x-api-secret'] = cfg.gl_api_secret;
  }

  // ── Account validation gate ─────────────────────────────────────────────────
  // Screen every account in the journal against the core system's account-status validator before
  // sending. Only accounts reported NORMAL may be posted to: a DORMANT or missing account produces
  // entries that have to be traced and unwound by hand at the bank, so a refusal the user can act on
  // is always the better outcome.
  //
  // Any non-NORMAL account stops the posting outright — the bulk-payment API is never called.
  //
  // Turn it off in Settings → App Controls ("Validate GL accounts before posting"), or with
  // GL_VALIDATE_ACCOUNTS=off in the environment. Off means unpostable accounts are sent anyway —
  // intended for environments still being set up.
  //
  // A check that could not be COMPLETED (endpoint down, unexpected response) does not block: an
  // unreachable validator must not stop payroll, and the posting's own error handling still applies.
  // That case is logged loudly so it is never mistaken for a clean pass.
  if (await validationEnabled()) {
    // ── Branch gate (core API) ────────────────────────────────────────────────
    // Checked before the accounts: every branch on a journal line (from the payroll column / GL
    // settings) AND the home branch of every employee on the journal — the core system checks both
    // during bulk payment. An unrecognised branch blocks the whole posting, exactly like an
    // unrecognised account. A check that could not be completed is treated like the account validator
    // being down: logged loudly, posting continues.
    if (cfg.core_api_enabled) {
      const empBranches = await employeeBranches(debitAccounts, creditAccounts);
      const branchCodes = [
        ...(debitAccounts  || []).map(d => d.debitBranch),
        ...(creditAccounts || []).map(c => c.creditBranch),
        ...[...(empBranches ?? new Map()).values()].map(b => b.branch),
      ];
      const badBranches = empBranches === null ? null : await invalidBranches(branchCodes, referenceNo);
      if (badBranches === null) {
        glLog(`BRANCH VALIDATE SKIPPED ${referenceNo}`, 'Branch validation unavailable — posting proceeded with branches unchecked.');
        console.warn(`[gl validate] ${referenceNo}: branch validator unavailable, branches unchecked`);
      } else if (badBranches.size) {
        const details = describeBranches(badBranches, debitAccounts, creditAccounts, empBranches);
        glLog(`BLOCKED ${referenceNo} — invalid branch codes`, { blocked: details.map(d => ({ branch: d.account, status: d.status, usedFor: d.sourceNames })) });
        console.error(`[gl validate] ${referenceNo}: blocked — ${badBranches.size} invalid branch code(s)`);
        const err = new Error(
          `GL posting blocked — ${badBranches.size} branch code(s) are not recognised by the core banking system `
          + `(${[...badBranches.keys()].join(', ')}). Nothing was sent to the GL.`,
        );
        err.glInvalidAccounts = details;
        throw err;
      }
    }

    const accounts = [
      ...(debitAccounts  || []).map(d => d.debitAccount),
      ...(creditAccounts || []).map(c => c.creditAccount),
    ];
    const blocked = await invalidAccounts(accounts, cfg, extra, headers, referenceNo);

    if (blocked === null) {
      glLog(`VALIDATE SKIPPED ${referenceNo}`, 'Account validation unavailable — posting proceeded unchecked.');
      console.warn(`[gl validate] ${referenceNo}: validator unavailable, posting unchecked`);
    } else if (blocked.size) {
      const details = describeAccounts(blocked, debitAccounts, creditAccounts);
      glLog(`BLOCKED ${referenceNo} — unpostable accounts`, {
        blocked: [...blocked.entries()].map(([a, s]) => ({ account: a, status: s.status, description: s.description })),
        details,
      });
      console.error(`[gl validate] ${referenceNo}: blocked — ${blocked.size} unpostable account(s)`);

      // Summarise by reason so the headline says WHY, not just how many. The per-account table in
      // `details` carries the specifics.
      const byReason = {};
      for (const s of blocked.values()) {
        const label = s.description || s.status || 'unknown status';
        byReason[label] = (byReason[label] ?? 0) + 1;
      }
      const reasonSummary = Object.entries(byReason)
        .map(([label, n]) => `${n} ${String(label).toLowerCase()}`).join(', ');

      const err = new Error(
        `GL posting blocked — ${blocked.size} account(s) cannot be posted to (${reasonSummary}). `
        + `Nothing was sent to the GL.`,
      );
      // The UI renders these as a table; the message above is the summary line only, so it stays
      // readable when a run has dozens of bad accounts.
      err.glInvalidAccounts = details;
      throw err;
    }
  } else {
    // Recorded on every posting so an unchecked batch is never silent in the audit trail — this is
    // the log you want when reconciling a posting that turned out to reference a bad account.
    glLog(`VALIDATE DISABLED ${referenceNo}`, 'Account validation is switched off — posting sent without screening accounts.');
    console.warn(`[gl validate] ${referenceNo}: validation disabled, posting unchecked`);
  }

  // Field order mirrors the bank's documented payload. `terminal` reuses the X-FORWARDED-FOR value
  // when unset — both identify the originating machine, and it is already configured.
  // `postedBy` is the staff code of the logged-in user. Accounts with no linked employee fall back
  // to the configured system identifier (gl_extra.posted_by / POSTING_POSTED_BY), then approvedBy.
  const postedBy = await loggedInEmployeeCode()
    || extra.posted_by || process.env.POSTING_POSTED_BY || approvedBy;
  const payload = {
    approvedBy,
    channelCode:   extra.channel_code || 'HRP',
    transType:     extra.trans_type   || '1504',
    terminal:      terminal    || extra.terminal    || forwardedFor || '',
    description:   description || extra.description || 'HR posting',
    branch:        branch      || extra.branch      || '000',
    debitAccounts,
    creditAccounts,
    referenceNo,
    postedBy,
  };

  if (cfg.core_api_enabled) {
    return postViaCoreApi({ payload, referenceNo, url });
  }

  // Log the request before sending: a timeout or a crash mid-flight must still leave a record of
  // exactly what was going to the bank. Auth headers are deliberately not logged.
  glLog(`REQUEST ${referenceNo} → PUT ${url}`, payload);

  let res;
  try {
    res = await axios({
      method:        'put',
      maxBodyLength: Infinity,
      url,
      headers,
      data:    payload,
      timeout: Number(cfg.gl_timeout) || 30000,
    });
  } catch (e) {
    glLog(`TRANSPORT FAILURE ${referenceNo}`, {
      message: e.message,
      status:  e.response?.status ?? null,
      body:    e.response?.data ?? null,
    });
    throw e;
  }

  const data = res.data || {};
  glLog(`RESPONSE ${referenceNo} (HTTP ${res.status})`, data);

  const code = String(data.responseCode ?? '');
  if (code && code !== '00' && code !== '000' && code !== '0') {
    const err = new Error(`GL error ${code}: ${data.message || 'Unknown error'}`);
    err.glResponse = data;
    glLog(`REJECTED ${referenceNo}`, { responseCode: code, message: data.message ?? null });
    throw err;
  }
  return {
    documentRef: data.documentRef || data.document_ref || data.referenceNo || referenceNo,
    raw: data,
  };
}

/**
 * Send a checked, balanced journal through the new core API's /bulkPayment (PerformBulkPaymentHR).
 *
 * The body is exactly the payload the old .90 posting API received — same fields, same order, same
 * types. Only the transport differs: POST, encrypted, with the core API's token and key/secret.
 * Same contract as the old path: returns { documentRef, raw } or throws with glResponse attached.
 */
async function postViaCoreApi({ payload, referenceNo, url }) {
  const body = payload;

  glLog(`REQUEST ${referenceNo} → POST ${url} (core API)`, body);

  let r;
  try {
    r = await coreApi.call('post', '/bulkPayment', body);
  } catch (e) {
    glLog(`TRANSPORT FAILURE ${referenceNo}`, { message: e.message });
    throw e;
  }
  const data = r.decrypted.ok ? (r.decrypted.data || {}) : {};
  glLog(`RESPONSE ${referenceNo} (HTTP ${r.status})`, r.decrypted.ok ? data : { error: r.decrypted.error, raw: r.raw });

  if (!r.decrypted.ok || r.status >= 400 || !coreApi.isSuccess(data)) {
    const code = String(data.responseCode ?? r.status);
    const err = new Error(`GL error ${code}: ${data.message || r.decrypted.error || 'Unknown error'}`);
    err.glResponse = r.decrypted.ok ? data : r.raw;
    glLog(`REJECTED ${referenceNo}`, { responseCode: code, message: data.message ?? r.decrypted.error ?? null });
    throw err;
  }
  const inner = data.data && typeof data.data === 'object' ? data.data : {};
  return {
    documentRef: inner.documentRef || inner.document_ref || inner.referenceNo
              || data.documentRef || data.document_ref || data.referenceNo || referenceNo,
    raw: data,
  };
}

module.exports = { postToGL };
