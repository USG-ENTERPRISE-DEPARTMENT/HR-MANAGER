const axios          = require('axios');
const fs             = require('fs');
const path           = require('path');
const { getApiConfig } = require('../controllers/apiIntegrationController');

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
// account number is accepted and then has to be traced and unwound at the bank. The core system
// exposes a validator; every posting is screened through it first.
//
// Endpoint defaults to the GL URL's own host (they are the same service) so a deployment that moves
// the core API does not need a second setting. Override with GL_VALIDATE_URL or gl_extra.validate_url.
function validateUrlFrom(cfg, extra) {
  const explicit = process.env.GL_VALIDATE_URL || extra.validate_url;
  if (explicit) return explicit;
  if (!cfg.gl_url) return null;
  try {
    const u = new URL(cfg.gl_url);
    // …/account/performBulkPayment → …/account/validateNormalAccounts
    return `${u.origin}${u.pathname.replace(/\/[^/]*$/, '/validateNormalAccounts')}`;
  } catch { return null; }
}

/**
 * Ask the core system which of `accounts` do not exist.
 *
 * Returns a Set of invalid account numbers, or null when the check could not be performed (not
 * configured, unreachable, or an unexpected response). Null means "unknown", NOT "all valid" — the
 * caller decides what to do with that, and must never treat it as a pass.
 */
async function invalidAccounts(accounts, cfg, extra, headers) {
  const list = [...new Set(accounts.filter(Boolean).map(String))];
  if (!list.length) return new Set();

  const url = validateUrlFrom(cfg, extra);
  if (!url) return null;

  try {
    const res = await axios.post(url, { accountList: list }, {
      headers, timeout: Number(cfg.gl_timeout) || 30000,
    });
    const code = String(res.data?.responseCode ?? '');
    if (code && code !== '00' && code !== '000' && code !== '0') {
      glLog('VALIDATE REJECTED', { url, responseCode: code, message: res.data?.message ?? null });
      return null;
    }
    const invalid = res.data?.data?.invalidAccounts;
    if (!Array.isArray(invalid)) {
      glLog('VALIDATE UNEXPECTED SHAPE', { url, body: res.data });
      return null;
    }
    return new Set(invalid.map(String));
  } catch (e) {
    glLog('VALIDATE TRANSPORT FAILURE', {
      url, message: e.message, status: e.response?.status ?? null, body: e.response?.data ?? null,
    });
    return null;
  }
}

/**
 * Describe an account in the terms the user will recognise.
 *
 * Journal lines carry a narration built by the caller — "Basic Salary - Jane Doe" for a payroll
 * component, "Net Pay - Jane Doe" for the cash leg, "Medical - Jane Doe - Malaria" for a claim. That
 * narration is the only place the GL component name or employee name survives into this helper, so
 * it is what gets reported back. `employeeCode` is included when the line carries one.
 */
function describeAccounts(invalidSet, debitAccounts, creditAccounts) {
  const byAccount = new Map();
  const add = (acct, narration, empCode, side) => {
    if (!acct || !invalidSet.has(String(acct))) return;
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
    return {
      account:       e.account,
      // 'employee' → an employee bank account; 'component' → a payroll/medical GL account.
      kind:          isNetPay ? 'employee' : 'component',
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
  // Screen every account in the journal against the core system before sending. Runs after the
  // headers are built so it reuses the same credentials as the posting itself.
  //
  // Any unrecognised account stops the posting outright — the bulk-payment API is never called.
  // Posting to an account the core system does not know produces entries that have to be traced and
  // unwound by hand at the bank, so a refusal the user can act on is always the better outcome.
  //
  // GL_VALIDATE_ACCOUNTS=off disables the check entirely (escape hatch for an environment where the
  // validator is unavailable); anything else, including unset, enforces it.
  //
  // A check that could not be COMPLETED (endpoint down, unexpected response) does not block: an
  // unreachable validator must not stop payroll, and the posting's own error handling still applies.
  // That case is logged loudly so it is never mistaken for a clean pass.
  if (String(process.env.GL_VALIDATE_ACCOUNTS ?? '').toLowerCase() !== 'off') {
    const accounts = [
      ...(debitAccounts  || []).map(d => d.debitAccount),
      ...(creditAccounts || []).map(c => c.creditAccount),
    ];
    const invalid = await invalidAccounts(accounts, cfg, extra, headers);

    if (invalid === null) {
      glLog(`VALIDATE SKIPPED ${referenceNo}`, 'Account validation unavailable — posting proceeded unchecked.');
      console.warn(`[gl validate] ${referenceNo}: validator unavailable, posting unchecked`);
    } else if (invalid.size) {
      const details = describeAccounts(invalid, debitAccounts, creditAccounts);
      glLog(`BLOCKED ${referenceNo} — invalid accounts`, { invalid: [...invalid], details });
      console.error(`[gl validate] ${referenceNo}: blocked — ${invalid.size} invalid account(s)`);

      const err = new Error(
        `GL posting blocked — ${invalid.size} account(s) are not recognised by the core system. `
        + `Nothing was sent to the GL.`,
      );
      // The UI renders these as a table; the message above is the summary line only, so it stays
      // readable when a run has dozens of bad accounts.
      err.glInvalidAccounts = details;
      throw err;
    }
  }

  // Field order mirrors the bank's documented payload. `terminal` reuses the X-FORWARDED-FOR value
  // when unset — both identify the originating machine, and it is already configured.
  // `postedBy` is the SYSTEM identifier (POSTING_POSTED_BY, e.g. 'HRMS'), not the approving user;
  // it falls back to approvedBy only when nothing is configured.
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
    postedBy:      extra.posted_by || process.env.POSTING_POSTED_BY || approvedBy,
  };

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

module.exports = { postToGL };
