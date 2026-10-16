import { useEffect, useRef } from 'react';
import api from './api';

// ─────────────────────────────────────────────────────────────────────────────
// Realtime updates from the server (Server-Sent Events) — see Server/src/helpers/realtime.js.
//
// One shared connection per tab, opened while a signed-in page is mounted. Events:
//   notification        → a notification was just created for this user (bell + toast)
//   change:<topic>      → data in <topic> changed ('medical', 'leave', 'payroll', 'transfers',
//                         'training') — by anyone, web or mobile. Pages refetch; the event itself
//                         carries no record data.
//
// Reconnects itself with exponential back-off. Each stream needs a fresh one-time ticket, so the
// browser's own EventSource auto-reconnect (which would replay a used ticket) is never relied on.
// Polling elsewhere (notifications every 20s) remains as the fallback if the stream is down.
// ─────────────────────────────────────────────────────────────────────────────

type Handler = (data: any) => void;
const listeners = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
let users = 0;                 // mounted consumers; the connection lives while > 0
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(key: string, data: any) {
  listeners.get(key)?.forEach((h) => { try { h(data); } catch { /* a bad handler must not break others */ } });
}

function parse(e: MessageEvent) {
  try { return JSON.parse(e.data); } catch { return {}; }
}

function scheduleReconnect() {
  if (!users || timer) return;
  const delay = Math.min(30000, 1000 * 2 ** attempt++);
  timer = setTimeout(() => { timer = null; void connect(); }, delay);
}

async function connect() {
  if (!users || source) return;
  try {
    const r = await api.post('/realtime/ticket');
    const ticket = r.data?.data?.ticket;
    if (!ticket || !users) { scheduleReconnect(); return; }
    const es = new EventSource(`${api.defaults.baseURL ?? ''}/realtime/stream?ticket=${encodeURIComponent(ticket)}`);
    source = es;
    es.addEventListener('ready', () => { attempt = 0; emit('status', { connected: true }); });
    es.addEventListener('notification', (e) => emit('notification', parse(e as MessageEvent)));
    es.addEventListener('change', (e) => {
      const d = parse(e as MessageEvent);
      if (d.topic) emit(`change:${d.topic}`, d);
    });
    es.onerror = () => {
      // Close and reconnect with a NEW ticket — the used one would be refused (401) forever.
      es.close();
      if (source === es) source = null;
      emit('status', { connected: false });
      scheduleReconnect();
    };
  } catch {
    scheduleReconnect();   // e.g. ticket request failed (offline, token refresh in progress)
  }
}

function acquire() {
  users++;
  if (users === 1) { attempt = 0; void connect(); }
}

function release() {
  users = Math.max(0, users - 1);
  if (users) return;
  if (timer) { clearTimeout(timer); timer = null; }
  source?.close();
  source = null;
}

function on(key: string, handler: Handler) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(handler);
  return () => { listeners.get(key)?.delete(handler); };
}

/** Subscribe to a realtime event while the component is mounted. Always calls the latest handler. */
function useRealtimeEvent(key: string, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    acquire();
    const off = on(key, (d) => ref.current(d));
    return () => { off(); release(); };
  }, [key]);
}

/** Refetch when `topic` changes anywhere (web or mobile), e.g. useRealtimeRefresh('medical', load). */
export function useRealtimeRefresh(topic: string, refresh: () => void) {
  useRealtimeEvent(`change:${topic}`, () => refresh());
}

/** React to a notification being created for the signed-in user. */
export function useRealtimeNotification(handler: Handler) {
  useRealtimeEvent('notification', handler);
}
