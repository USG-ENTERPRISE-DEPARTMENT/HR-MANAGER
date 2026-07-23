/**
 * seedPermissions.js
 *
 * Seeds all canonical HR permissions and sets canonical role-permission
 * assignments for the four system roles.
 *
 * Safe to re-run — permissions are inserted by name (skip if exists), and
 * role assignments are synced (add missing, remove stale) against the
 * canonical lists defined below.
 *
 * Run with:
 *   node Server/src/prisma/seedPermissions.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Canonical permission definitions ─────────────────────────────────────────
// These must stay in sync with PERMISSION_GROUPS in UserCreationForm.tsx.

const PERMISSIONS = [
  // Users & Access
  'view_users', 'create_users', 'edit_users', 'deactivate_users', 'activate_users', 'change_user_password', 'manage_roles',
  // Employees
  'view_employees', 'create_employees', 'edit_employees', 'approve_employees', 'change_employee_status', 'manage_onboarding',
  'view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers',
  // Employee Relations
  'manage_skills', 'manage_certifications', 'manage_education', 'manage_languages', 'manage_dependents', 'manage_emergency_contacts',
  // Company
  'view_company_structure', 'create_company_structure', 'edit_company_structure', 'delete_company_structure',
  // PC Codes (positions)
  'view_pc_code', 'create_pc_code', 'edit_pc_code', 'delete_pc_code', 'assign_pc_code',
  // Documents
  'view_documents', 'create_documents', 'edit_documents', 'delete_documents',
  // Leave
  // Leave Setup
  'view_leave_setup', 'manage_leave_types', 'manage_leave_periods', 'manage_holidays',
  'manage_work_week', 'manage_leave_groups', 'manage_leave_rules', 'manage_leave_approvals',
  // Salary
  'view_salary_setup', 'manage_salary_component_types', 'manage_salary_components',
  'manage_employee_salary_components', 'manage_notch_setup', 'manage_payment_types', 'manage_notch_movements',
  // Payroll
  'view_payroll', 'manage_payroll_employees', 'process_payroll', 'approve_payroll',
  'export_payroll_reports', 'manage_payroll_columns', 'manage_calculation_groups', 'manage_report_templates',
  // Reports
  'generate_reports', 'export_reports',
  // System (App Settings + Settings pages + Audit logs)
  'view_app_settings', 'manage_app_settings', 'view_settings', 'manage_settings', 'view_audit_logs',
  // Dashboard (Overview) — gated; assign to let a user see the Overview page
  'view_dashboard',
  // Recruitment
  'view_recruitment', 'manage_jobs', 'manage_candidates', 'manage_applications', 'manage_interviews',
  // Performance
  'view_performance', 'create_performance', 'delete_performance', 'review_performance',
  // Medical (admin)
  'view_medical', 'create_medical', 'edit_medical', 'delete_medical', 'approve_medical',
  'manage_medical_limits', 'manage_hospitals', 'reset_medical_utilization',
  // Attendance (admin)
  'view_attendance', 'manage_attendance',
  // Training (admin)
  'view_training', 'create_training', 'delete_training', 'approve_training',
  // AI Assistant
  'use_ai_assistant', 'view_ai_insights',
];

// ── Role definitions ──────────────────────────────────────────────────────────
// Roles not listed here are left untouched.

const ROLES = [
  {
    name: 'super-admin',
    guard_name: 'api',
    description: 'Full system access — all permissions',
    is_system: true,
    // Gets every canonical permission in PERMISSIONS above
    permissions: '__ALL__',
  },
  {
    name: 'admin',
    guard_name: 'api',
    description: 'System administration — users, roles, settings',
    is_system: true,
    permissions: [
      // Users & Access
      'view_users', 'create_users', 'edit_users', 'deactivate_users', 'activate_users', 'change_user_password', 'manage_roles',
      // System (App Settings + Settings pages + Audit logs)
      'view_app_settings', 'manage_app_settings', 'view_settings', 'manage_settings', 'view_audit_logs',
      // Employees (view + management)
      'view_employees', 'create_employees', 'edit_employees', 'approve_employees', 'change_employee_status', 'manage_onboarding',
      'view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers',
      // Company structure (view + management)
      'view_company_structure', 'create_company_structure', 'edit_company_structure', 'delete_company_structure',
      // PC Codes (positions)
      'view_pc_code', 'create_pc_code', 'edit_pc_code', 'delete_pc_code', 'assign_pc_code',
      // Documents (view + management)
      'view_documents', 'create_documents', 'edit_documents', 'delete_documents',
      // Dashboard (Overview)
      'view_dashboard',
      // Recruitment, Performance, Medical, Attendance, Training (admin scope)
      'view_recruitment', 'manage_jobs', 'manage_candidates', 'manage_applications', 'manage_interviews',
      'view_performance', 'create_performance', 'delete_performance', 'review_performance',
      'view_medical', 'create_medical', 'edit_medical', 'delete_medical', 'approve_medical', 'manage_medical_limits', 'manage_hospitals', 'reset_medical_utilization',
      'view_attendance', 'manage_attendance',
      'view_training', 'create_training', 'delete_training', 'approve_training',
      'use_ai_assistant', 'view_ai_insights',
    ],
  },
  {
    name: 'hr-manager',
    guard_name: 'api',
    description: 'HR operations — employees, leave, payroll, salary',
    is_system: true,
    permissions: [
      // Employees
      'view_employees', 'create_employees', 'edit_employees', 'approve_employees', 'change_employee_status', 'manage_onboarding',
      'view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers',
      // Employee Relations
      'manage_skills', 'manage_certifications', 'manage_education', 'manage_languages', 'manage_dependents', 'manage_emergency_contacts',
      // Company
      'view_company_structure', 'create_company_structure', 'edit_company_structure', 'delete_company_structure',
      // PC Codes (positions)
      'view_pc_code', 'create_pc_code', 'edit_pc_code', 'delete_pc_code', 'assign_pc_code',
      // Documents
      'view_documents', 'create_documents', 'edit_documents', 'delete_documents',
      // Leave Setup
      'view_leave_setup', 'manage_leave_types', 'manage_leave_periods', 'manage_holidays',
      'manage_work_week', 'manage_leave_groups', 'manage_leave_rules', 'manage_leave_approvals',
      // Salary
      'view_salary_setup', 'manage_salary_component_types', 'manage_salary_components',
      'manage_employee_salary_components', 'manage_notch_setup', 'manage_payment_types', 'manage_notch_movements',
      // Payroll
      'view_payroll', 'manage_payroll_employees', 'process_payroll', 'approve_payroll',
      'export_payroll_reports', 'manage_payroll_columns', 'manage_calculation_groups', 'manage_report_templates',
      // Reports
      'generate_reports', 'export_reports',
      // Settings page (view + manage) + audit logs
      'view_settings', 'manage_settings', 'view_audit_logs',
      // Users (read-only)
      'view_users',
      // Dashboard (Overview)
      'view_dashboard',
      // Recruitment, Performance, Medical, Attendance, Training (HR scope)
      'view_recruitment', 'manage_jobs', 'manage_candidates', 'manage_applications', 'manage_interviews',
      'view_performance', 'create_performance', 'delete_performance', 'review_performance',
      'view_medical', 'create_medical', 'edit_medical', 'delete_medical', 'approve_medical', 'manage_medical_limits', 'manage_hospitals', 'reset_medical_utilization',
      'view_attendance', 'manage_attendance',
      'view_training', 'create_training', 'delete_training', 'approve_training',
      'use_ai_assistant', 'view_ai_insights',
    ],
  },
  {
    name: 'employee',
    guard_name: 'api',
    description: 'Self-service employee access',
    is_system: false,
    permissions: [
      // Documents
      'view_documents',
      // Company (org chart)
      'view_company_structure',
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function newId() {
  return BigInt(Date.now() + Math.floor(Math.random() * 100_000));
}

async function upsertPermission(name) {
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM permissions WHERE name=? AND guard_name='api' LIMIT 1`, name
  ).catch(() => []);
  if (existing.length) return BigInt(existing[0].id);

  const id = newId();
  await prisma.$executeRawUnsafe(
    `INSERT INTO permissions (id, name, guard_name, created_at, updated_at) VALUES (?,?,'api',NOW(),NOW())`,
    id, name
  );
  return id;
}

async function upsertRole(role) {
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM roles WHERE name=? AND guard_name=? LIMIT 1`, role.name, role.guard_name
  ).catch(() => []);
  if (existing.length) return BigInt(existing[0].id);

  const id = newId();
  await prisma.$executeRawUnsafe(
    `INSERT INTO roles (id, name, guard_name, description, is_system, created_at, updated_at)
     VALUES (?,?,?,?,?,NOW(),NOW())`,
    id, role.name, role.guard_name, role.description ?? null, role.is_system ? 1 : 0
  );
  console.log(`  INSERT role: ${role.name} (id=${id})`);
  return id;
}

async function syncRolePermissions(roleId, permNameList, permMap) {
  const desired = new Set(
    permNameList.map((n) => {
      const id = permMap[n];
      if (!id) console.warn(`    WARN: permission "${n}" not in DB — skipping`);
      return id ? String(id) : null;
    }).filter(Boolean)
  );

  const current = await prisma.$queryRawUnsafe(
    `SELECT permission_id FROM role_has_permissions WHERE role_id=?`, roleId
  ).catch(() => []);
  const currentSet = new Set(current.map((r) => String(r.permission_id)));

  const toAdd    = [...desired].filter((id) => !currentSet.has(id));
  const toRemove = [...currentSet].filter((id) => !desired.has(id));

  for (const permId of toAdd) {
    await prisma.$executeRawUnsafe(
      `INSERT IGNORE INTO role_has_permissions (permission_id, role_id) VALUES (?,?)`,
      BigInt(permId), roleId
    ).catch(() => {});
  }
  for (const permId of toRemove) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM role_has_permissions WHERE role_id=? AND permission_id=?`,
      roleId, BigInt(permId)
    ).catch(() => {});
  }

  return { added: toAdd.length, removed: toRemove.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Permissions Seeder ===\n');

  // 1. Upsert all canonical permissions and build name→id map
  console.log(`Permissions (${PERMISSIONS.length} canonical):`);
  const permMap = {};
  for (const name of PERMISSIONS) {
    const id = await upsertPermission(name);
    permMap[name] = id;
    process.stdout.write('.');
  }
  console.log(`\n  ✓ ${PERMISSIONS.length} permissions in place\n`);

  // 2. Upsert roles and sync their permission assignments
  console.log('Roles & permission assignments:');
  for (const roleDef of ROLES) {
    const roleId = await upsertRole(roleDef);

    const permList =
      roleDef.permissions === '__ALL__'
        ? PERMISSIONS
        : roleDef.permissions;

    const { added, removed } = await syncRolePermissions(roleId, permList, permMap);
    const total = (
      roleDef.permissions === '__ALL__'
        ? PERMISSIONS.length
        : roleDef.permissions.length
    );
    console.log(`  ${roleDef.name}: ${total} permissions  (+${added} added, -${removed} removed)`);
  }

  console.log('\n✓ Permissions seeding complete.\n');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
