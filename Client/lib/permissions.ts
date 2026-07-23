import { LoginResponseData, ApiUser, AppUser, AppRole } from '../types/permissions';
import { NAV_PERMISSIONS } from './permissionKeys';

// ─────────────────────────────────────────────────────────────
// normalizeFromLogin
//
// Handles POST /login response shape:
//   roles: string[]          → names only, no permissions inside
//   permissions: string[]    → already resolved by the backend
//
// Since the backend already resolves permissions for us on login,
// we use that directly as resolvedPermissions. No merging needed.
// direct_permissions is not available at login — treated as empty.
// ─────────────────────────────────────────────────────────────
export function normalizeFromLogin(data: LoginResponseData): AppUser {
  const allRoles: AppRole[] = data.roles.map((name, i) => ({
    id: i,           // no id from login response, use index as placeholder
    name,
    isSystem: false, // unknown at login, update if needed after /user/:id fetch
    status: '1' as const,
    permissions: [], // not provided per-role at login
  }));

  const primaryRole = allRoles[0] ?? {
    id: 0, name: 'unknown', isSystem: false, status: '1' as const, permissions: []
  };

  return {
    id:                  data.id as unknown as number,  // CUID stored as string; typed number for compat
    name:                `${data.firstName} ${data.lastName}`,
    firstname:           data.firstName,
    lastname:            data.lastName,
    email:               data.email,
    employeeId:          data.employeeId || undefined,
    userType:            data.userType ?? (data.employeeId ? 'employee' : 'admin'),
    phone:               data.phone,
    status:              data.status,
    role:                primaryRole,
    allRoles,
    directPermissions:   [],                          // not in login response
    resolvedPermissions: new Set(data.permissions),   // use backend-resolved set directly
    theme:               data.theme === 'dark' ? 'dark' : data.theme === 'light' ? 'light' : null,
    isStageApprover:     data.isStageApprover === true,
  };
}

// ─────────────────────────────────────────────────────────────
// normalizeFromUserEndpoint
//
// Handles GET /user/:id response shape:
//   roles: { id, name, permissions: string[] }[]
//   direct_permissions: string[]   (prefix "!" = revoke)
//
// We union all role permissions, then apply direct overrides.
// ─────────────────────────────────────────────────────────────
export function normalizeFromUserEndpoint(apiUser: ApiUser): AppUser {
  const allRoles: AppRole[] = apiUser.roles.map(r => ({
    id:          r.id,
    name:        r.name,
    isSystem:    false,
    status:      '1' as const,
    permissions: r.permissions,
  }));

  const primaryRole = allRoles[0] ?? {
    id: 0, name: 'unknown', isSystem: false, status: '1' as const, permissions: []
  };

  const rolePermissions = allRoles.flatMap(r => r.permissions);

  const resolvedPermissions = resolvePermissions(
    rolePermissions,
    apiUser.direct_permissions
  );

  return {
    id:                  apiUser.id,
    name:                apiUser.name,
    firstname:           apiUser.firstname,
    lastname:            apiUser.lastname,
    email:               apiUser.email,
    employeeId:          apiUser.employee_id || undefined,
    userType:            apiUser.employee_id ? 'employee' : 'admin',
    phone:               apiUser.phone,
    status:              apiUser.status,
    role:                primaryRole,
    allRoles,
    directPermissions:   apiUser.direct_permissions,
    resolvedPermissions,
    theme:               apiUser.theme === 'dark' ? 'dark' : apiUser.theme === 'light' ? 'light' : null,
  };
}

// ─────────────────────────────────────────────────────────────
// resolvePermissions
//
// Merges role permissions with direct overrides:
//   "permission_name"  → GRANT  (add)
//   "!permission_name" → REVOKE (remove)
// ─────────────────────────────────────────────────────────────
export function resolvePermissions(
  rolePermissions: string[],
  directPermissions: string[]
): Set<string> {
  const resolved = new Set<string>(rolePermissions);

  for (const perm of directPermissions) {
    if (perm.startsWith('!')) {
      resolved.delete(perm.slice(1));  // revoke
    } else {
      resolved.add(perm);              // grant
    }
  }

  return resolved;
}

// ─────────────────────────────────────────────────────────────
// canAccessNav — check a nav key against NAV_PERMISSIONS map
// 
// Returns true ONLY if:
//   1. navKey exists in NAV_PERMISSIONS, AND
//   2. EITHER: has empty permission array (explicitly open)
//      OR: user has at least one of the required permissions
//
// Default: DENY access (security-first approach)
// ─────────────────────────────────────────────────────────────
export function canAccessNav(user: AppUser, navKey: string): boolean {
  // If navKey not in map, DENY by default
  if (!(navKey in NAV_PERMISSIONS)) return false;
  
  const required = NAV_PERMISSIONS[navKey];

  // Empty array = explicitly open view
  if (required.length === 0) return true;

  // Central Approval: a payroll stage approver reaches it even without a blanket approve_* permission,
  // because being named in the approval flow grants access to action their assigned runs.
  if (navKey === 'CentralApproval' && user.isStageApprover) return true;

  // Check if user has ANY of the required permissions
  return required.some(k => user.resolvedPermissions.has(k));
}

export function canAccessAny(user: AppUser, keys: string[]): boolean {
  // Empty keys array = must have at least one permission to check, DENY by default
  if (!keys || keys.length === 0) return false;
  return keys.some(k => user.resolvedPermissions.has(k));
}