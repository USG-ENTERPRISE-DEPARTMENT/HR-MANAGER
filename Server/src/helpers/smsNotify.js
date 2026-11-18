// SMS via the Central Notification System (CNS v2).
// Spec: CNS_DOCS_v2.0.pdf and the swagger at http://10.32.11.90:8185/cns/swagger-ui/index.html
//
//   CNS_BASE_URL       e.g. http://10.32.11.90:8185/cns  (the service is mounted under /cns)
//   CNS_APP_KEY        the HR system's App key (sent as the x-app-key header); without it CNS answers 401
//   SMS_ACTIVITY_CODE  activity code registered for this alert under our source
//   SMS_USE_TEMPLATE   true → send only `params` and let the activity code's CNS template word the SMS;
//                      otherwise (default) also send sms_msg_body, which CNS uses verbatim (template override)
//   SMS_SENDER_ID      optional sender ID; must be on CNS's sender-id whitelist or CNS rejects with 400
//   SMS_COUNTRY_CODE   e.g. +232 — replaces a leading 0 on local numbers (stored as 076xxxxxx)
//
// Endpoints used: POST /api/v1/notification/send/sms (one) and /api/v1/notification/send/bulk/sms (many).
// CNS queues the request and answers 202 with { responseCode: "000", data: { notification_id … } };
// delivery is asynchronous, so success here means "accepted", not "delivered" (see CNS history).
//
// Everything here is fire-and-forget: it never throws. Nothing is sent while CNS_BASE_URL,
// CNS_APP_KEY or the activity code is unset.

const crypto = require('crypto');

const TIMEOUT_MS = 10000;
const SEND_PATH  = '/api/v1/notification/send/sms';
const BULK_PATH  = '/api/v1/notification/send/bulk/sms';

/**
 * Turn a stored phone into something CNS accepts (digits only, optional leading +), or '' when it
 * isn't a usable number. Handles what HR records actually hold:
 *   "076558974"               → +23276558974   (local, leading 0)
 *   "78120772"                → +23278120772   (local, 0 dropped)
 *   "23276558974"/"0023276…"  → +23276558974
 *   "079369910, 077836209"    → first number only (39 records hold two numbers split by , / ;)
 *   "0243069666"              → passed as-is (10-digit foreign-style; CNS reads it as its default country)
 *   "076", "8855928"          → ''  (placeholders / truncated)
 * SMS_COUNTRY_CODE (+232) and SMS_NATIONAL_DIGITS (8) describe the local numbering plan.
 */
function normalizePhone(raw) {
  // Several numbers in one field → the first usable one.
  for (const part of String(raw ?? '').split(/[,/;|]|\bor\b/i)) {
    const n = normalizeOne(part);
    if (n) return n;
  }
  return '';
}

function normalizeOne(part) {
  let p = String(part).replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  p = p.replace(/(?!^)\+/g, '');
  const digits = p.replace(/\D/g, '');
  if (!digits) return '';

  const cc  = (process.env.SMS_COUNTRY_CODE || '').replace(/\D/g, '');
  const len = parseInt(process.env.SMS_NATIONAL_DIGITS || '8', 10);
  if (cc && digits.startsWith(cc) && (p.startsWith('+') || digits.length > len + 1)) {
    return digits.length === cc.length + len ? `+${digits}` : ''; // local plan, wrong length → unusable
  }
  if (p.startsWith('+')) return digits.length >= 10 ? `+${digits}` : '';
  if (cc) {
    if (digits.startsWith(cc) && digits.length === cc.length + len) return `+${digits}`;
    if (digits.length === len + 1 && digits.startsWith('0')) return `+${cc}${digits.slice(1)}`;
    if (digits.length === len && !digits.startsWith('0')) return `+${cc}${digits}`;
  }
  // Not the local plan: hand over a plausible full number untouched and let CNS decide.
  return digits.length >= 10 ? digits : '';
}

function config() {
  const base = (process.env.CNS_BASE_URL || '').trim().replace(/\/+$/, '');
  const key  = (process.env.CNS_APP_KEY || '').trim();
  return {
    base, key,
    activityCode: (process.env.SMS_ACTIVITY_CODE || '').trim(),
    useTemplate:  /^(1|true|yes)$/i.test(process.env.SMS_USE_TEMPLATE || ''),
    senderId:     (process.env.SMS_SENDER_ID || '').trim(),
    ready:        !!(base && key),
  };
}

/**
 * Build one CNS SmsSendRequest. `msg` = { to, body?, params?: {PLACEHOLDER: value}, metadata?, activityCode? }.
 * Returns null when the message can't be sent (no number, placeholder number, no content).
 */
function buildRequest(msg, cfg) {
  const to = normalizePhone(msg.to);
  if (to.replace(/\D/g, '').length < 8) return null; // skip placeholders like "076"
  const activity_code = (msg.activityCode || cfg.activityCode || '').trim();
  if (!activity_code) return null;
  const params = Object.entries(msg.params || {})
    .filter(([, v]) => v != null)
    .map(([placeholder, value]) => ({ placeholder, value: String(value) }));
  const req = {
    activity_code,
    sms_recipient: to,
    params,
    notification_id: crypto.randomUUID(), // idempotency key — CNS rejects a repeat of the same id
    metadata: { sendby: 'HRMS', ...(msg.metadata || {}) },
  };
  if (msg.body && !cfg.useTemplate) req.sms_msg_body = msg.body;
  else if (!params.length) return null; // template mode with nothing to interpolate and no body
  if (cfg.senderId) req.sender_id = cfg.senderId;
  return req;
}

async function post(cfg, path, payload, label) {
  try {
    const res = await fetch(cfg.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-key': cfg.key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
    const code = json?.responseCode;
    if (!res.ok || (code && code !== '000' && code !== '202')) {
      // 400 bad payload / sender id · 401 bad app key · 403 source inactive or activity code not on our source
      console.error(`[sms] ${label} rejected: HTTP ${res.status} ${json ? [json.message, json.errorMessage].filter(Boolean).join(' — ') : text.slice(0, 200)}`);
      return false;
    }
    // CNS still answers 202/"000" when it rejects a message (e.g. malformed number) — the verdict is in data.
    const items = Array.isArray(json?.data) ? json.data : (json?.data ? [json.data] : []);
    const bad = items.filter(d => /^(rejected|failed|blocked)$/i.test(d?.status || ''));
    if (bad.length) {
      console.error(`[sms] ${label}: ${bad.length}/${items.length} rejected by CNS — ${bad.map(d => d.error || d.status).join('; ')}`);
      return bad.length < items.length;
    }
    return true;
  } catch (err) {
    console.error(`[sms] ${label} failed:`, err.message);
    return false;
  }
}

/**
 * Send one SMS. `bodyOrMsg` is either the message text, or { body, params, metadata, activityCode }.
 * Resolves true when CNS accepted it, false otherwise. Never throws.
 */
async function sendSms(recipient, bodyOrMsg) {
  const cfg = config();
  if (!cfg.ready) return false;
  const msg = typeof bodyOrMsg === 'string' ? { body: bodyOrMsg } : (bodyOrMsg || {});
  const req = buildRequest({ ...msg, to: recipient }, cfg);
  if (!req) return false;
  return post(cfg, SEND_PATH, req, `to ${req.sms_recipient}`);
}

/**
 * Send several SMS in one request (CNS bulk endpoint). `messages` = [{ to, body, params, metadata }].
 * A single message goes through the single-send endpoint. Never throws.
 */
async function sendSmsBulk(messages) {
  const cfg = config();
  if (!cfg.ready) return false;
  const reqs = (messages || []).map(m => buildRequest(m, cfg)).filter(Boolean);
  if (!reqs.length) return false;
  if (reqs.length === 1) return post(cfg, SEND_PATH, reqs[0], `to ${reqs[0].sms_recipient}`);
  return post(cfg, BULK_PATH, reqs, `bulk of ${reqs.length}`);
}

module.exports = { sendSms, sendSmsBulk, normalizePhone, buildRequest };
