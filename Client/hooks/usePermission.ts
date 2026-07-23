import { useMemo } from 'react';
import { AppUser } from '../types/permissions';
import { canAccessNav, canAccessAny } from '../lib/permissions';

/**
 * usePermission
 * 
 * Provides helper functions scoped to the current user.
 * 
 * Usage:
 *   const { can, canNav, canAny } = usePermission(currentUser);
 * 
 *   can('view_students')                        → boolean
 *   canNav('students')                          → boolean (uses NAV_PERMISSIONS map)
 *   canAny(['view_fees', 'view_fee_structure']) → boolean
 */
export function usePermission(user: AppUser) {
  return useMemo(() => ({
    /**
     * Check a raw backend permission key.
     * e.g. can('view_students')
     */
    can: (key: string): boolean => {
      if (!key) return true;
      return user.resolvedPermissions.has(key);
    },

    /**
     * Check a nav section key against the NAV_PERMISSIONS map.
     * e.g. canNav('fees-structure'), canNav('settings-super-admin')
     */
    canNav: (navKey: string): boolean => canAccessNav(user, navKey),

    /**
     * Check if user has ANY of the given raw permission keys.
     * e.g. canAny(['view_fees', 'create_fees'])
     */
    canAny: (keys: string[]): boolean => canAccessAny(user, keys),

    /**
     * The full resolved permission set for advanced use cases.
     */
    permissions: user.resolvedPermissions,
  }), [user]);
}