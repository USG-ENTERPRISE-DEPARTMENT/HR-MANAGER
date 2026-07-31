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
