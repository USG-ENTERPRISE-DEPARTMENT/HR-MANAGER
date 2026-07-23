import api from './api';
import { getCurrentUser, updateUser } from './auth';

// The theme preference is stored per-user on the server (users.theme) and travels
// inside the AppUser session payload, so a reload applies it synchronously with no flash.

/** Apply a theme to the document. Falls back to the current user's saved preference. */
export function applyTheme(theme?: 'dark' | 'light' | null): void {
  const t = theme ?? getCurrentUser()?.theme;
  document.documentElement.classList.toggle('dark', t === 'dark');
}

/** Persist the chosen theme: update the DOM, the cached session user, and the server. */
export function setTheme(theme: 'dark' | 'light'): void {
  applyTheme(theme);
  const user = getCurrentUser();
  if (user) updateUser({ ...user, theme });
  api.put('/user/theme', { theme }).catch(() => { /* session cache still holds it until next login */ });
}
