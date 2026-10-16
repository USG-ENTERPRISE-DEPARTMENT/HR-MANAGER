// Request log written to server.log at the repo root.
//   • Incoming: every request to this server — method, path, status, duration, user, client IP.
//     Bodies are not logged (passwords, base64 photos).
//   • Outgoing: every axios call this server makes (GL posting, GL validation, employee sync, …)
//     with headers, payload and response, so X-FORWARDED-FOR and what the bank returned can be seen.
// Credentials (Authorization, x-api-key, x-api-secret, cookies) are masked.
// Set SERVER_LOG_FILE to relocate it, or SERVER_LOG=off to disable. Logging never breaks a request.
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

const ENABLED  = String(process.env.SERVER_LOG ?? '').toLowerCase() !== 'off';
const LOG_PATH = process.env.SERVER_LOG_FILE
  ? path.resolve(process.env.SERVER_LOG_FILE)
  : path.join(__dirname, '..', '..', '..', 'server.log');
const MAX_BODY = 20000;   // chars per logged body — a full payroll GL batch can be very large

const SECRET_HEADERS = new Set(['authorization', 'x-api-key', 'x-api-secret', 'cookie', 'set-cookie']);

let stream = null;
function write(line) {
  if (!ENABLED) return;
  try {
    if (!stream) {
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      stream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
      stream.on('error', e => { console.error('[server log] could not write', LOG_PATH, '-', e.message); });
    }
    stream.write(`${new Date().toISOString()} ${line}\n`);
  } catch (e) {
    console.error('[server log] could not write', LOG_PATH, '-', e.message);
  }
}

function maskHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (v == null || typeof v === 'function' || typeof v === 'object') continue;   // skip axios' per-method groups
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

function fmtBody(b) {
  if (b == null || b === '') return '';
  let s;
  try { s = typeof b === 'string' ? b : JSON.stringify(b, (_k, v) => typeof v === 'bigint' ? String(v) : v); }
  catch { s = String(b); }
  return s.length > MAX_BODY ? `${s.slice(0, MAX_BODY)}… [truncated, ${s.length} chars]` : s;
}

/** Express middleware: one line per incoming request, written when the response finishes. */
function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms   = Number(process.hrtime.bigint() - start) / 1e6;
    const user = req.user?.username ?? '-';
    const ip   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? '-';
    write(`IN  ${req.method} ${req.originalUrl} → ${res.statusCode} ${ms.toFixed(0)}ms user=${user} ip=${ip}`);
  });
  next();
}

// ── Outgoing (axios) ──────────────────────────────────────────────────────────
axios.interceptors.request.use(cfg => {
  cfg.metadata = { start: Date.now() };
  write(`OUT → ${String(cfg.method).toUpperCase()} ${cfg.url}\n    headers: ${JSON.stringify(maskHeaders(typeof cfg.headers?.toJSON === 'function' ? cfg.headers.toJSON() : cfg.headers))}`
    + (cfg.data != null ? `\n    payload: ${fmtBody(cfg.data)}` : ''));
  return cfg;
});

axios.interceptors.response.use(
  r => {
    const ms = Date.now() - (r.config?.metadata?.start ?? Date.now());
    write(`OUT ← ${String(r.config?.method).toUpperCase()} ${r.config?.url} → ${r.status} ${ms}ms\n    response: ${fmtBody(r.data)}`);
    return r;
  },
  err => {
    const c  = err.config || {};
    const ms = Date.now() - (c.metadata?.start ?? Date.now());
    write(`OUT ✗ ${String(c.method).toUpperCase()} ${c.url} → ${err.response?.status ?? 'no response'} ${ms}ms`
      + ` ${err.message}` + (err.response?.data != null ? `\n    response: ${fmtBody(err.response.data)}` : ''));
    return Promise.reject(err);
  },
);

module.exports = { requestLogger, LOG_PATH };
