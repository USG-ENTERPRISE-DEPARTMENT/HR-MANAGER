import { AppUser } from '@/types/permissions';

// ─────────────────────────────────────────────────────────────────────────────
// Auth persistence uses localStorage so sessions survive page reloads AND
// browser restarts. For an internal HR system on a corporate network this
// trade-off (XSS-readable vs. persistent sessions) is acceptable.
//
// logout() wipes both keys, so the session ends immediately on explicit logout.
// ─────────────────────────────────────────────────────────────────────────────
const USER_KEY  = 'hr_current_user';

// The access token lives in memory only (not localStorage) to reduce XSS exposure — on reload, initAuth
// re-mints it from the httpOnly refresh cookie. The user object stays in localStorage for instant paint.
let _accessToken: string | null = null;

type UserChangeListener = (user: AppUser) => void;
const _userChangeListeners = new Set<UserChangeListener>();

export function onUserChange(fn: UserChangeListener): () => void {
  _userChangeListeners.add(fn);
  return () => _userChangeListeners.delete(fn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tab coordination — one tab's refresh/logout propagates to the others, so
// tabs don't each fire their own refresh (which reuse-detection could escalate to
// a global logout) and a logout in one tab clears them all.
// ─────────────────────────────────────────────────────────────────────────────
type AuthMessage = { type: 'token'; token: string } | { type: 'logout' };
const authChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hr-auth') : null;

if (authChannel) {
  authChannel.onmessage = (e: MessageEvent<AuthMessage>) => {
    const msg = e.data;
    if (msg?.type === 'token' && msg.token) {
      // Adopt a token another tab just minted — no need to refresh again here.
      _accessToken = msg.token;
      scheduleProactiveRefresh(msg.token);
    } else if (msg?.type === 'logout') {
      clearRefreshTimer();
      _accessToken = null;
      storageRemove(USER_KEY);
      window.location.replace('/');
    }
  };
}

/** Broadcast a freshly minted access token to sibling tabs so they adopt it instead of refreshing too. */
export function broadcastToken(token: string): void {
  authChannel?.postMessage({ type: 'token', token });
}

// ─────────────────────────────────────────────────────────────────────────────
// Proactive refresh — refresh ~60s before the access token expires, so requests
// rarely hit an expired token. The reactive 401 interceptor remains the safety net.
// ─────────────────────────────────────────────────────────────────────────────
const REFRESH_LEAD_MS = 60_000;   // refresh this long before exp
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function clearRefreshTimer(): void {
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null; }
}

/** Read a JWT's `exp` (epoch ms), or null if absent/unparseable. */
function getTokenExpMs(token: string): number | null {
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return null;
    const json = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload: { exp?: number } = JSON.parse(json);
    return payload.exp ? payload.exp * 1000 : null;
  } catch { return null; }
}

/** Schedule a background refresh shortly before the given token expires. */
function scheduleProactiveRefresh(token: string): void {
  clearRefreshTimer();
  const expMs = getTokenExpMs(token);
  if (!expMs) return;
  const delay = expMs - Date.now() - REFRESH_LEAD_MS;
  if (delay <= 0) return; // already within the lead window — the reactive path will handle it
  _refreshTimer = setTimeout(() => { void proactiveRefresh(); }, delay);
}

/** Fire a silent refresh via the dedicated refresh instance and adopt the new token. */
async function proactiveRefresh(): Promise<void> {
  try {
    const { refreshApi } = await import('./api');
    const res = await refreshApi.get<{ accessToken?: string; data?: any }>('/user/refresh-token');
    const token = res.data?.accessToken;
    if (!token) return;
    updateToken(token);
    broadcastToken(token);
    if (res.data?.data) {
      const { normalizeFromLogin } = await import('./permissions');
      updateUser(normalizeFromLogin(res.data.data));
    }
  } catch { /* reactive 401 path remains the safety net */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// User serialisation — Set<string> doesn't survive JSON round-trips.
// ─────────────────────────────────────────────────────────────────────────────
interface SerializedUser extends Omit<AppUser, 'resolvedPermissions'> {
  resolvedPermissions: string[];
}

function serializeUser(user: AppUser): string {
  const s: SerializedUser = {
    ...user,
    resolvedPermissions: Array.from(user.resolvedPermissions),
  };
  return JSON.stringify(s);
}

function deserializeUser(raw: string): AppUser {
  const parsed: SerializedUser = JSON.parse(raw);
  return {
    ...parsed,
    resolvedPermissions: new Set(parsed.resolvedPermissions),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT expiry check
// ─────────────────────────────────────────────────────────────────────────────
export function isTokenExpired(token: string): boolean {
  try {
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return true;
    const json = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload: { exp?: number } = JSON.parse(json);
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers — safe wrappers so private-mode / quota errors don't crash
// ─────────────────────────────────────────────────────────────────────────────
function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function storageRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Persist a session after login or silent token refresh. Token stays in memory only. */
export function setSession(token: string, user: AppUser): void {
  _accessToken = token;
  storageSet(USER_KEY, serializeUser(user));
  scheduleProactiveRefresh(token);
}

/**
 * Clear all auth data and navigate to the login screen.
 * Also cleans up any legacy sessionStorage keys from older builds.
 */
export async function logout(): Promise<void> {
  clearRefreshTimer();
  // Revoke the refresh token server-side (clears the httpOnly cookie + DB row) before wiping the client.
  // Best-effort: never let a failed/blocked request keep the user "logged in" locally. Dynamic import
  // avoids a circular dependency (api.ts imports from auth.ts).
  try {
    const { default: api } = await import('./api');
    await api.post('/logout');
  } catch { /* ignore — proceed to clear locally regardless */ }

  _accessToken = null;
  storageRemove(USER_KEY);
  // Clean up legacy keys from older builds (access token was previously persisted to these).
  try { localStorage.removeItem('hr_access_token'); } catch { /* ignore */ }
  try { sessionStorage.removeItem('access_token');  } catch { /* ignore */ }
  try { sessionStorage.removeItem('current_user');  } catch { /* ignore */ }
  authChannel?.postMessage({ type: 'logout' });
  window.location.replace('/');
}

/**
 * Returns a valid in-memory access token, or null. The token is never persisted, so after a reload
 * memory is empty until initAuth re-mints it from the refresh cookie.
 * Never calls logout() — callers rely on the 401 interceptor for silent refresh.
 */
export function getToken(): string | null {
  if (_accessToken && !isTokenExpired(_accessToken)) return _accessToken;
  return null;
}

/** Update token after a silent refresh (memory only) and reschedule the proactive refresh. */
export function updateToken(token: string): void {
  _accessToken = token;
  scheduleProactiveRefresh(token);
}

/** Update stored user and notify subscribers. */
export function updateUser(user: AppUser): void {
  storageSet(USER_KEY, serializeUser(user));
  _userChangeListeners.forEach(fn => fn(user));
}

/**
 * Returns the stored AppUser, or null.
 * Never calls logout() — corrupted storage is silently cleared instead.
 */
export function getCurrentUser(): AppUser | null {
  try {
    const raw = storageGet(USER_KEY);
    if (!raw) return null;
    return deserializeUser(raw);
  } catch {
    storageRemove(USER_KEY);
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!getToken() && !!getCurrentUser();
}

// ─────────────────────────────────────────────────────────────────────────────
// initAuth — call once before rendering (main.tsx).
//
// The access token is memory-only, so a reload always starts with no token and
// must re-mint one from the httpOnly refresh cookie:
//   1. Call /user/refresh-token — the browser sends the cookie automatically.
//   2. Success → store the fresh token in memory + restore/refresh the user.
//   3. Failure (no/expired/revoked cookie) → return null → show login screen.
// The stored user object gives an instant first paint; a valid cookie confirms it.
// ─────────────────────────────────────────────────────────────────────────────
export async function initAuth(): Promise<AppUser | null> {
  try {
    const { refreshApi }         = await import('./api');
    const { normalizeFromLogin } = await import('./permissions');

    const res = await refreshApi.get<{ accessToken?: string; data?: any }>('/user/refresh-token');
    const { accessToken, data } = res.data ?? {};

    if (!accessToken) return null;

    if (data) {
      // Full user payload returned — update everything
      const appUser = normalizeFromLogin(data);
      setSession(accessToken, appUser);
      return appUser;
    }

    // Token-only refresh response (server's handleRefreshToken) — reuse the stored user
    const existingUser = storageGet(USER_KEY);
    if (existingUser) {
      try {
        const appUser = deserializeUser(existingUser);
        _accessToken = accessToken;
        scheduleProactiveRefresh(accessToken);
        return appUser;
      } catch {
        storageRemove(USER_KEY);
      }
    }

    return null;

  } catch {
    storageRemove(USER_KEY);
    return null;
  }
}
