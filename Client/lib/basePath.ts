/// <reference types="vite/client" />
/**
 * App base-path helpers.
 *
 * The app can be served either at the domain root ("/") or under a sub-path such as "/xhrm/".
 * The sub-path is configured once via the `VITE_BASE_PATH` env var, which Vite bakes into
 * `import.meta.env.BASE_URL` (always starts and ends with "/"). Everything path-related derives
 * from that single source of truth, so no route/link needs to hardcode "/xhrm".
 *
 *   import.meta.env.BASE_URL   →  "/"        or  "/xhrm/"
 *   APP_BASE (stripped)        →  ""         or  "/xhrm"
 */

const RAW_BASE = import.meta.env.BASE_URL || '/';

/** The base with any trailing slash removed: "" at root, "/xhrm" under a sub-path. */
export const APP_BASE = RAW_BASE.replace(/\/+$/, '');

/**
 * Strip the app base from a browser pathname so internal route matching (portals) can work with
 * clean logical paths like "/careers/ABC" regardless of where the app is mounted.
 */
export function appPath(pathname: string = window.location.pathname): string {
  if (APP_BASE && (pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`))) {
    const rest = pathname.slice(APP_BASE.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return pathname || '/';
}

/** Turn a logical path ("/careers/ABC") into a real one including the base ("/xhrm/careers/ABC"). */
export function withBase(path: string): string {
  return `${RAW_BASE}${path.replace(/^\/+/, '')}`;
}

/** Build an absolute, shareable URL (origin + base + path) for the current host. */
export function appUrl(path: string): string {
  return `${window.location.origin}${withBase(path)}`;
}
