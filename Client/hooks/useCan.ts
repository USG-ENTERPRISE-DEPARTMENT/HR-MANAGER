import { getCurrentUser } from '@/lib/auth';

/**
 * useCan
 *
 * Lightweight permission helper for gating UI inside management pages.
 * Reads the current user's resolved permission set (the same source used
 * across the app, e.g. LeaveSetup.tsx) and exposes:
 *
 *   const { can, canAny } = useCan();
 *   can('edit_employees')            → boolean
 *   canAny(['process_payroll', ...]) → boolean
 *
 * View access (seeing the page) is handled by NAV_PERMISSIONS / canAccessNav.
 * This hook is for the action tier: showing/hiding action buttons once the
 * page is already visible.
 */
export function useCan() {
  const user = getCurrentUser();
  const can = (perm: string): boolean => user?.resolvedPermissions.has(perm) ?? false;
  const canAny = (perms: string[]): boolean => perms.some(can);
  return { can, canAny };
}
