import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getToken, updateToken, updateUser, logout, broadcastToken } from './auth';

const BASE_URL = '/v1/api/hr';

// ─────────────────────────────────────────────────────────────────────────────
// Main API instance — used for all app requests
// ─────────────────────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL:         BASE_URL,
  withCredentials: true,  // sends the httpOnly refresh token cookie automatically
  headers:         { 'Content-Type': 'application/json' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Separate instance used ONLY for the token refresh call.
// Using a separate instance means a failed refresh won't re-trigger the
// response interceptor on the main `api` — preventing an infinite loop.
// ─────────────────────────────────────────────────────────────────────────────
export const refreshApi = axios.create({
  baseURL:         BASE_URL,
  withCredentials: true,  // must be true so the refresh cookie is sent
  headers:         { 'Content-Type': 'application/json' },
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST interceptor — attaches the in-memory access token to every request
// ─────────────────────────────────────────────────────────────────────────────
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken(); // reads from memory, not localStorage
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE interceptor — silent token refresh on 401
//
// Flow:
//   1. Request fails with 401 (access token expired)
//   2. Call /user/refresh-token — browser sends the httpOnly cookie automatically
//   3. Store the new access token in memory via updateToken()
//   4. Replay all queued + original requests with the new token
//   5. If refresh also fails → logout() and redirect to login
// ─────────────────────────────────────────────────────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject:  (err: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!)
  );
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,

  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // Only handle 401s
    if (error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // Public routes (login, register) should never trigger a token refresh.
    // A 401 here means wrong credentials, not an expired session.
    const PUBLIC_ROUTES = ['/login', '/register'];
    const reqUrl = original.url ?? '';
    if (PUBLIC_ROUTES.some(p => reqUrl.endsWith(p))) {
      return Promise.reject(error);
    }

    // Already retried once — refresh token is also dead, log out
    if (original._retry) {
      logout();
      return Promise.reject(error);
    }

    // Another refresh is already in progress — queue this request
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((newToken) => {
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        })
        .catch(() => {
          logout();
          return Promise.reject(error);
        });
    }

    original._retry = true;
    isRefreshing    = true;

    try {
      const res = await refreshApi.get<{ accessToken: string; data?: any }>(
        '/user/refresh-token'
      );

      const newToken = res.data?.accessToken;
      if (!newToken) throw new Error('No token in refresh response');

      // Store new token in memory only — no localStorage
      updateToken(newToken);
      // Tell sibling tabs to adopt this token instead of firing their own refresh.
      broadcastToken(newToken);

      // If the server returned fresh user data, update sessionStorage + notify App
      if (res.data?.data) {
        const { normalizeFromLogin } = await import('./permissions');
        updateUser(normalizeFromLogin(res.data.data));
      }

      // Update default header so requests made outside the interceptor also work
      api.defaults.headers.common.Authorization = `Bearer ${newToken}`;

      processQueue(null, newToken);

      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);

    } catch (refreshError) {
      processQueue(refreshError, null);
      // Only redirect to login if the user actually had a session.
      // Avoids a redirect loop when the refresh fires for an unauthenticated user.
      const { getCurrentUser } = await import('./auth');
      if (getCurrentUser()) {
        logout();
      }
      // Return the original 401 error, not the refresh-token error,
      // so callers (e.g. Login.tsx) see "Invalid credentials" not "Invalid refresh token".
      return Promise.reject(error);

    } finally {
      isRefreshing = false;
    }
  }
);

export default api;