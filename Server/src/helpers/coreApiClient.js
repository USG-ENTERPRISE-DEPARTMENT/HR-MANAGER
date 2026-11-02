const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { encrypt, decrypt } = require('./encryption');

// Client for the new core banking API ("HR CBS APIs").
//
//   1. POST /auth { username, password }  → a token
//   2. every other call sends  Authorization: Bearer <token>, X-API-Key, X-API-Secret
//   3. request bodies are encrypted with encryption.js and the encryption key; replies are decrypted
//      the same way.
//
// Configuration (Server/.env):
//   CORE_API_URL           e.g. http://10.32.11.88:8188
//   CORE_API_USERNAME / CORE_API_PASSWORD   the JWT credentials
//   CORE_API_KEY / CORE_API_SECRET          sent as X-API-Key / X-API-Secret
//   CORE_API_ENC_KEY       the AES key used by encryption.js
//   CORE_API_ENVELOPE      how an encrypted body is sent: payload (default) → {"payload":"<b64>"},
//                          raw → the base64 text itself
//   CORE_API_TIMEOUT       ms, default 30000
//   CORE_API_USER_AGENT    how HR Manager identifies itself, default HRManager/1.0. The gateway refuses
//                          requests that look like API testing tools (axios's default User-Agent does)
//
// Every step is written to Server/logs/core-api.log (CORE_API_LOG_FILE to move it, CORE_API_LOG=off
// to stop it): the plain request, the encrypted body actually sent, the headers (secrets masked),
// the raw reply and the decrypted reply or why it could not be decrypted.

const LOG_ENABLED = String(process.env.CORE_API_LOG ?? '').toLowerCase() !== 'off';
const LOG_PATH    = process.env.CORE_API_LOG_FILE
  ? path.resolve(process.env.CORE_API_LOG_FILE)
  : path.join(__dirname, '..', '..', 'logs', 'core-api.log');

function coreLog(section, body) {
  if (!LOG_ENABLED) return;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    fs.appendFileSync(LOG_PATH, `\n===== ${new Date().toISOString()} — ${section} =====\n${text}\n`, 'utf8');
  } catch (e) {
    console.error('[core api log] could not write', LOG_PATH, '-', e.message);
  }
}

/** Show enough of a secret to tell which one was used, never the whole value. */
function mask(v) {
  const s = String(v ?? '');
  if (!s) return '(not set)';
  return s.length <= 4 ? '****' : `${s.slice(0, 2)}${'*'.repeat(s.length - 4)}${s.slice(-2)}`;
}
const maskToken = t => (t ? `${String(t).slice(0, 12)}…(${String(t).length} chars)` : '(none)');

function config() {
  return {
    url:      String(process.env.CORE_API_URL || '').replace(/\/+$/, ''),
    username: process.env.CORE_API_USERNAME || '',
    password: process.env.CORE_API_PASSWORD || '',
    apiKey:   process.env.CORE_API_KEY      || '',
    apiSecret: process.env.CORE_API_SECRET  || '',
    encKey:   process.env.CORE_API_ENC_KEY  || '',
    envelope: (process.env.CORE_API_ENVELOPE || 'payload').toLowerCase(),
    timeout:  Number(process.env.CORE_API_TIMEOUT) || 30000,
    userAgent: process.env.CORE_API_USER_AGENT || 'HRManager/1.0',
  };
}

/** Encrypt a request body as configured. Returns what goes on the wire. */
function encryptBody(data, cfg) {
  const cipherText = encrypt(JSON.stringify(data), cfg.encKey);
  return cfg.envelope === 'raw' ? cipherText : { payload: cipherText };
}

/**
 * Decrypt a reply. The API answers {"payload":"<b64>", "encoding":...}; a bare string is tried too.
 * Some replies (seen on HTTP 500) are encrypted twice — the decrypted text is itself an envelope — so
 * layers are peeled until the content is no longer one (at most 5).
 * Never throws: returns { ok, data, error, layers } so the caller (and the log) sees what happened.
 */
function decryptReply(raw, cfg) {
  const isEnvelope = v => typeof v === 'string' || typeof v?.payload === 'string';
  if (!isEnvelope(raw)) return { ok: false, error: 'Reply has no encrypted payload', data: raw };
  let data = raw;
  let layers = 0;
  while (isEnvelope(data) && layers < 5) {
    const cipherText = typeof data === 'string' ? data : data.payload;
    let text;
    try { text = decrypt(cipherText, cfg.encKey); }
    catch (e) {
      // A string that is not ciphertext, after at least one layer, is just the plain reply.
      if (layers > 0) break;
      return { ok: false, error: `Could not decrypt with encryption.js: ${e.message}`, data: raw };
    }
    layers++;
    try { data = JSON.parse(text); } catch { data = text; break; }
  }
  return { ok: true, data, layers };
}

/** One logged, encrypted call. Returns { status, raw, decrypted } and never hides the raw reply. */
async function send(label, method, endpoint, data, headers, cfg) {
  const url  = `${cfg.url}${endpoint}`;
  let body;
  try { body = data === undefined ? undefined : encryptBody(data, cfg); }
  catch (e) {
    coreLog(`${label} NOT SENT — encryption failed`, { url, error: e.message, keyLength: Buffer.byteLength(cfg.encKey, 'utf8') });
    throw e;
  }
  const shownHeaders = {
    ...headers,
    ...(headers['X-API-Key']     ? { 'X-API-Key':     mask(headers['X-API-Key']) } : {}),
    ...(headers['X-API-Secret']  ? { 'X-API-Secret':  mask(headers['X-API-Secret']) } : {}),
    ...(headers.Authorization    ? { Authorization:   `Bearer ${maskToken(headers.Authorization.replace(/^Bearer /, ''))}` } : {}),
  };
  coreLog(`${label} REQUEST → ${method.toUpperCase()} ${url}`, {
    headers: shownHeaders,
    envelope: cfg.envelope,
    plainBody: label === 'AUTH' ? { username: mask(data?.username), password: mask(data?.password) } : data,
    encryptedBodySent: body,
  });

  let res;
  try {
    res = await axios({
      method, url, headers, data: body, timeout: cfg.timeout, maxBodyLength: Infinity,
      validateStatus: () => true,   // log every status ourselves rather than lose the body to a throw
    });
  } catch (e) {
    coreLog(`${label} TRANSPORT FAILURE`, { url, message: e.message, code: e.code ?? null });
    throw e;
  }

  const decrypted = decryptReply(res.data, cfg);
  // A token in the log could be replayed until it expires, so only its start and length are kept.
  const loggable = decrypted.ok
    ? JSON.parse(JSON.stringify(decrypted.data ?? null).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, t => maskToken(t)))
    : undefined;
  coreLog(`${label} RESPONSE (HTTP ${res.status})`, {
    rawReply: res.data,
    decrypted: loggable,
    decryptError: decrypted.ok ? undefined : decrypted.error,
  });
  return { status: res.status, raw: res.data, decrypted };
}

// ── Token ─────────────────────────────────────────────────────────────────────
// A token lives 30 minutes. It is fetched once, reused by every call, and renewed shortly before it
// runs out; a 401 mid-life (revoked, or the provider restarted) forces one fresh login and a retry.
let cachedToken = null;   // { token, expiresAt }
let pendingAuth = null;   // the login in flight, shared by every call that needs a token meanwhile

const TOKEN_LIFETIME_MS = 30 * 60_000;   // used when the token carries no exp/iat
const TOKEN_RENEW_EARLY_MS = 2 * 60_000;

/** Pull a token out of a decrypted /auth reply, whichever field it comes in. */
function tokenFrom(d) {
  if (!d || typeof d !== 'object') return typeof d === 'string' && /^eyJ/.test(d) ? d : null;
  const inner = d.data && typeof d.data === 'object' ? d.data : {};
  return d.token || d.accessToken || d.access_token || inner.token || inner.accessToken || inner.access_token
      || (typeof d.data === 'string' ? d.data : null);
}

/**
 * When to stop using a token, on THIS machine's clock. The lifetime is read as exp − iat and counted
 * from when the token arrived, rather than comparing exp to our clock: the issuer's clock runs ~97s
 * ahead of ours, so trusting exp directly would keep sending a token the gateway already rejects.
 * Renewed two minutes early either way.
 */
function expiryOf(token, receivedAt = Date.now()) {
  let lifetime = TOKEN_LIFETIME_MS;
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.exp && claims.iat && claims.exp > claims.iat) lifetime = (claims.exp - claims.iat) * 1000;
    else if (claims.exp) lifetime = Math.min(TOKEN_LIFETIME_MS, claims.exp * 1000 - receivedAt);
  } catch {}
  return receivedAt + Math.max(lifetime - TOKEN_RENEW_EARLY_MS, 30_000);
}

/** The current token, logging in only when there is none or it is about to expire. */
async function authenticate({ force = false } = {}) {
  if (!force && cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  // Calls that arrive while a login is in flight wait for it instead of starting their own — a payroll
  // run fires many calls together, and they would otherwise all log in at the moment the token lapses.
  if (!pendingAuth) pendingAuth = login().finally(() => { pendingAuth = null; });
  return pendingAuth;
}

async function login() {
  const cfg = config();
  if (!cfg.url)    throw new Error('CORE_API_URL is not set');
  if (!cfg.encKey) throw new Error('CORE_API_ENC_KEY is not set');

  const headers = { 'Content-Type': cfg.envelope === 'raw' ? 'text/plain' : 'application/json', Accept: 'application/json', 'User-Agent': cfg.userAgent };
  if (cfg.apiKey)    headers['X-API-Key']    = cfg.apiKey;
  if (cfg.apiSecret) headers['X-API-Secret'] = cfg.apiSecret;

  const sentAt = Date.now();
  const r = await send('AUTH', 'post', '/auth', { username: cfg.username, password: cfg.password }, headers, cfg);
  const token = r.decrypted.ok ? tokenFrom(r.decrypted.data) : null;
  if (r.status >= 400 || !token) {
    // An unencrypted reply (e.g. the proxy's own 503) still carries a readable message — prefer it.
    const why = r.decrypted.ok
      ? (r.decrypted.data?.message || JSON.stringify(r.decrypted.data).slice(0, 200))
      : (r.raw?.message || r.decrypted.error);
    coreLog('AUTH FAILED', { httpStatus: r.status, reason: why });
    throw new Error(`Core API authentication failed (HTTP ${r.status}): ${why}`);
  }
  // Counted from when the request went out, so time spent waiting for the reply is not added to its life.
  cachedToken = { token, expiresAt: expiryOf(token, sentAt) };
  coreLog('AUTH OK', { token: maskToken(token), expiresAt: new Date(cachedToken.expiresAt).toISOString() });
  return token;
}

/** Authenticated, encrypted call. Re-authenticates once on 401. */
async function call(method, endpoint, data) {
  const cfg = config();
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await authenticate({ force: attempt > 0 });
    const headers = {
      'Content-Type': cfg.envelope === 'raw' ? 'text/plain' : 'application/json', Accept: 'application/json',
      'User-Agent': cfg.userAgent,
      Authorization: `Bearer ${token}`,
      ...(cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {}),
      ...(cfg.apiSecret ? { 'X-API-Secret': cfg.apiSecret } : {}),
    };
    const r = await send(endpoint, method, endpoint, data, headers, cfg);
    if (r.status === 401 && attempt === 0) {
      // Drop the token only if it is still the one that was refused — another call may already have
      // replaced it, and that fresh token should be reused rather than thrown away.
      if (cachedToken?.token === token) cachedToken = null;
      coreLog(`${endpoint} TOKEN REFUSED (HTTP 401)`, 'Logging in again and retrying once.');
      continue;
    }
    return r;
  }
}

/**
 * Is the new core API set up? Everything needed to log in must be present. CORE_API_ENABLED=off
 * switches back to the old separate services (GL posting, account validator, employee sync).
 */
function isConfigured() {
  if (String(process.env.CORE_API_ENABLED ?? '').toLowerCase() === 'off') return false;
  const c = config();
  return !!(c.url && c.username && c.password && c.apiKey && c.apiSecret);
}

/** The API's success codes: '000' on /auth; the others are accepted as the old services used them. */
function isSuccess(body) {
  return ['000', '00', '0', '200'].includes(String(body?.responseCode ?? '')) || body?.success === true;
}

/** Full URL of an endpoint, for logs and messages. */
function urlOf(endpoint) { return `${config().url}${endpoint}`; }

module.exports = {
  authenticate, call, coreLog, isConfigured, isSuccess, urlOf,
  CORE_API_LOG_PATH: LOG_PATH, _internal: { encryptBody, decryptReply, tokenFrom },
};
