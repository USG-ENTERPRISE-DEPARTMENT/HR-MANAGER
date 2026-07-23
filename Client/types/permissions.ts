// ─────────────────────────────────────────────────────────────
// API Response Shapes — two different shapes from your backend
// ─────────────────────────────────────────────────────────────

// ── POST /login ──────────────────────────────────────────────
// roles = string[], permissions = pre-resolved flat array
export interface LoginResponseData {
  id:            string;        // CUID from users table
  firstName:     string;        // from JOIN employee
  lastName:      string;
  middleName:    string | null;
  employeeId:    string;
  phone:         string;
  email:         string;
  status:        '0' | '1';
  userType?:     'employee' | 'guardian' | 'student' | 'admin';
  roles:         string[];      // e.g. ["admin", "Supervisor"] — names only
  permissions:   string[];      // already resolved by backend
  theme?:        string | null; // saved UI theme preference ('dark' | 'light')
  isStageApprover?: boolean;     // named in the payroll approval flow (by user or role)
}

// ─────────────────────────────────────────────────────────────
// GET /user/:id  — roles are objects with nested permissions
// ─────────────────────────────────────────────────────────────

export interface ApiPermission {
  id: string;
  name: string;         // e.g. "view_students"
  guard_name: string;
}

export interface ApiRole {
  id: string;
  name: string;         // e.g. "super-admin", "admin", "staff"
  guard_name: string;
  description: string | null;
  is_system: boolean;
  status: '0' | '1';
  created_at: string;
  updated_at: string;
  permissions: ApiPermission[];
}

export interface ApiUser {
  id: number;
  firstname: string;
  middlename: string | null;
  lastname: string;
  name: string;
  employee_id: string;
  phone: string;
  email: string;
  qualification: string | null;
  status: '0' | '1';
  posted_by: number;
  roles: {
    id: number;
    name: string;
    permissions: string[];   // flat string array e.g. ["view_students", "create_users"]
  }[];
  direct_permissions: string[];  // flat string array, prefix "!" means revoke
  theme?: string | null;         // saved UI theme preference ('dark' | 'light')
}

// ─────────────────────────────────────────────────────────────
// Internal App Types (normalized for use in components)
// ─────────────────────────────────────────────────────────────

export interface AppRole {
  id: number;
  name: string;
  isSystem: boolean;
  status: '0' | '1';
  permissions: string[];
}

export interface AppUser {
  id: number;
  name: string;
  firstname: string;
  lastname: string;
  email: string;
  employeeId?: string;
  guardianId?: string;
  studentId?: string;
  userType: 'employee' | 'guardian' | 'student' | 'admin';
  phone: string;
  status: '0' | '1';
  role: AppRole;               // primary role (first in roles array)
  allRoles: AppRole[];         // all assigned roles
  directPermissions: string[]; // direct overrides — prefix "!" to revoke
  resolvedPermissions: Set<string>; // final computed set, ready to use
  theme?: 'dark' | 'light' | null;  // saved UI theme preference (per user, server-backed)
  isStageApprover?: boolean;        // named in the payroll approval flow → may reach Central Approval
}