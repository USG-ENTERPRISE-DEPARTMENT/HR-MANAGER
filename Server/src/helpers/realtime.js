// ─────────────────────────────────────────────────────────────────────────────
// Realtime push to the web app — Server-Sent Events (SSE).
//
// One long-lived GET per open browser tab (GET /realtime/stream). The server pushes two events:
//   • notification  — to ONE user, the moment a notification is created for them (notificationHelper)
//   • change        — to EVERYONE connected: "topic X changed, refetch" (e.g. 'medical', 'leave').
//                      Carries no record data — clients refetch through their normal, permission-
//                      checked APIs — so broadcasting it cannot leak anything.
//
// SSE rather than WebSockets: traffic is server → browser only, it is plain HTTP (works through the
// existing proxy), and the browser reconnects by itself. Connections live in memory, which is correct
// for a SINGLE server process — the deployment runs one (no PM2 cluster). Running several processes
// would need a shared relay (e.g. Redis pub/sub) so an event raised in one reaches tabs held by another.
//
// Auth: EventSource cannot send an Authorization header, so the client first exchanges its access
// token for a one-time TICKET (POST /realtime/ticket, behind checkToken) and opens the stream with
// ?ticket=… . A ticket is single-use and expires after TICKET_TTL_MS, so a leaked URL is useless.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const TICKET_TTL_MS   = 60 * 1000;
const HEARTBEAT_MS    = 25 * 1000;   // below typical proxy idle timeouts (60s)
const MAX_PER_USER    = 10;          // tabs per user — bounds memory if a client misbehaves

const tickets = new Map();           // ticket -> { userId, expires }
const clients = new Map();           // userId(string) -> Set<res>

function issueTicket(userId) {
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { userId: String(userId), expires: Date.now() + TICKET_TTL_MS });
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

/** Consume a ticket: returns its userId, or null when unknown / expired / already used. */
function redeemTicket(ticket) {
  const t = tickets.get(String(ticket || ''));
  tickets.delete(String(ticket || ''));
  return t && t.expires > Date.now() ? t.userId : null;
}

function send(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`); } catch { /* closed */ }
}

/** Attach an SSE response to a user. Returns false if the per-user cap is reached. */
function subscribe(userId, req, res) {
  const key = String(userId);
  const set = clients.get(key) ?? new Set();
  if (set.size >= MAX_PER_USER) return false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',        // tell nginx-style proxies not to buffer the stream
  });
  res.write('retry: 5000\n\n');        // browser reconnect delay if the stream drops
  send(res, 'ready', { at: new Date().toISOString() });

  set.add(res);
  clients.set(key, set);
  req.on('close', () => {
    set.delete(res);
    if (!set.size) clients.delete(key);
  });
  return true;
}

/** Push an event to every open tab of one user. */
function publishToUser(userId, event, data) {
  const set = clients.get(String(userId));
  if (set) for (const res of set) send(res, event, data);
}

/** Push an event to every connected tab. */
function publishToAll(event, data) {
  for (const set of clients.values()) for (const res of set) send(res, event, data);
}

// Coalesce bursts: one bulk import or a 400-row payroll run would otherwise send 400 identical
// "medical changed" events. Each topic is flushed at most once per window.
const pending = new Set();
let flushTimer = null;
function publishChange(topic) {
  if (!topic) return;
  pending.add(topic);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const topics = [...pending];
    pending.clear();
    flushTimer = null;
    for (const t of topics) publishToAll('change', { topic: t, at: new Date().toISOString() });
  }, 300);
}

// Heartbeat keeps idle connections open through proxies and detects dead sockets; also sweeps
// expired tickets so the map cannot grow from tickets that were issued but never redeemed.
setInterval(() => {
  for (const set of clients.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch { /* closed */ } }
  const now = Date.now();
  for (const [t, v] of tickets) if (v.expires <= now) tickets.delete(t);
}, HEARTBEAT_MS).unref();

// Which "change" topic a request path belongs to. Paths are relative to /v1/api/hr and include the
// mobile API's /me/… equivalents, so a change made from the mobile app refreshes open web pages too.
const TOPIC_RULES = [
  [/^\/(me\/)?medical\b/,                 'medical'],
  [/^\/(me\/)?leave\b/,                   'leave'],
  [/^\/employee-transfers\b/,             'transfers'],
  [/^\/out-of-station\b/,                 'outofstation'],
  [/^\/end-of-service\b/,                 'endofservice'],
  [/^\/payroll\/runs\b/,                  'payroll'],
  [/^\/(me\/)?training\b/,                'training'],
  [/^\/me\/approvals\/(leave|medical|training)/, (m) => m[1]],
];
function topicForPath(path) {
  for (const [re, topic] of TOPIC_RULES) {
    const m = re.exec(path);
    if (m) return typeof topic === 'function' ? topic(m) : topic;
  }
  return null;
}

/**
 * Express middleware: after any SUCCESSFUL write (POST/PUT/PATCH/DELETE, status < 400) whose path
 * maps to a topic, broadcast `change` for it. One hook covers web and mobile callers alike, so new
 * endpoints under those prefixes are covered without remembering to emit.
 */
function changeBroadcaster(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const topic = topicForPath(req.path);
  if (topic) res.on('finish', () => { if (res.statusCode < 400) publishChange(topic); });
  next();
}

const stats = () => ({ users: clients.size, connections: [...clients.values()].reduce((n, s) => n + s.size, 0) });

module.exports = { issueTicket, redeemTicket, subscribe, publishToUser, publishToAll, publishChange, changeBroadcaster, topicForPath, stats };
