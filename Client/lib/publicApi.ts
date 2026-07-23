import axios from 'axios';

// Tokenless axios client for the public portals (careers, scheduling, kiosk,
// self-onboarding). These pages run before authentication, so unlike `lib/api`
// this instance has no auth interceptors and only hits `/public/*` routes.
export const publicApi = axios.create({ baseURL: '/v1/api/hr' });

/** Default brand colour used by the public portals when none is configured. */
export const BRAND_BLUE = '#1d4ed8';

/** Resolve a stored logo filename (or absolute URL) into a usable image src. */
export function resolveLogoUrl(raw?: string): string | null {
  if (!raw) return null;
  return raw.startsWith('http') ? raw : `/v1/api/hr/documents/${raw}`;
}
