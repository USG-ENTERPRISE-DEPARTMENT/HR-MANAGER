/**
 * prisma/seed.js
 *
 * Seeds the database with:
 *  - Roles: super-admin, admin, hr-manager, employee
 *  - All permissions grouped by feature area (mirrors the UI chip groups)
 *  - Every permission assigned to super-admin
 *  - Admin: user + role + permission + system management
 *  - HR Manager: all HR, leave, salary, payroll, documents, reports
 *  - Employee: self-service read + apply leave
 *  - A default super-admin user (employee + users record)
 *
 * Safe to re-run — uses upsert / INSERT IGNORE throughout.
 *
 * Run with:
 *   npx prisma db seed
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const GUARD = 'api';
const NOW   = new Date();

// ─────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────
const ROLES = [
  { name: 'super-admin', description: 'Full system access — all permissions granted',            is_system: true  },
  { name: 'admin',       description: 'Manages users, roles, permissions and system setup',      is_system: true  },
  { name: 'hr-manager',  description: 'Full HR access: employees, leave, salary, payroll, docs', is_system: false },
  { name: 'employee',    description: 'Self-service: view own profile, apply for leave',          is_system: false },
];

// ─────────────────────────────────────────────────────────
// Permissions grouped by feature area.
// MUST stay in sync with Client/lib/permissionGroups.ts (the single source of truth for the app's
// permission keys). super-admin receives every key in this object.
// ─────────────────────────────────────────────────────────
const PERMISSIONS = {
  'Dashboard': ['view_dashboard'],

  'Users & Access': [
    'view_users', 'create_users', 'edit_users', 'deactivate_users',
    'activate_users', 'change_user_password', 'manage_roles',
  ],

  'Employees': [
    'view_employees', 'create_employees', 'edit_employees',
    'approve_employees', 'change_employee_status', 'manage_onboarding',
    'view_employee_transfers', 'create_employee_transfers',
    'approve_employee_transfers', 'manage_employee_transfers',
  ],

  'Employee Relations': [
    'manage_skills', 'manage_certifications', 'manage_education',
    'manage_languages', 'manage_dependents', 'manage_emergency_contacts',
  ],

  'Company': [
    'view_company_structure', 'create_company_structure',
    'edit_company_structure', 'delete_company_structure',
  ],

  'Documents': [
    'view_documents', 'create_documents', 'edit_documents', 'delete_documents',
  ],

  'Leave Setup': [
    'view_leave_setup', 'manage_leave_types', 'manage_leave_periods', 'manage_holidays',
    'manage_work_week', 'manage_leave_groups', 'manage_leave_rules', 'manage_leave_approvals',
  ],

  'Salary': [
    'view_salary_setup', 'manage_salary_component_types', 'manage_salary_components',
    'manage_employee_salary_components', 'manage_notch_setup', 'manage_payment_types',
    'manage_notch_movements',
  ],

  'Payroll': [
    'view_payroll', 'manage_payroll_employees', 'process_payroll', 'approve_payroll',
    'export_payroll_reports', 'manage_payroll_columns', 'manage_calculation_groups',
    'manage_report_templates',
  ],

  'Reports': ['generate_reports', 'export_reports'],

  'System': [
    'view_app_settings', 'manage_app_settings', 'view_settings', 'manage_settings', 'view_audit_logs',
  ],

  'Recruitment': [
    'view_recruitment', 'manage_jobs', 'manage_candidates', 'manage_applications', 'manage_interviews',
  ],

  'Performance': [
    'view_performance', 'create_performance', 'delete_performance', 'review_performance',
  ],

  'Medical': [
    'view_medical', 'create_medical', 'edit_medical', 'delete_medical',
    'approve_medical', 'manage_medical_limits', 'manage_hospitals', 'reset_medical_utilization',
  ],

  'Attendance': ['view_attendance', 'manage_attendance'],

  'Training': ['view_training', 'create_training', 'delete_training', 'approve_training'],

  'AI Assistant': ['use_ai_assistant', 'view_ai_insights'],
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS).flat();

// ─────────────────────────────────────────────────────────
// Role → permission assignments
// ─────────────────────────────────────────────────────────
const ROLE_PERMISSIONS = {
  // super-admin gets EVERY permission that exists.
  'super-admin': ALL_PERMISSIONS,

  'admin': [
    ...PERMISSIONS['Dashboard'],
    // User & role management (manage_roles lives in Users & Access)
    ...PERMISSIONS['Users & Access'],
    // System, settings & audit
    ...PERMISSIONS['System'],
    // Preserve the existing read-only employee access; transfer rights are additive.
    'view_employees',
    'view_employee_transfers', 'create_employee_transfers',
    'approve_employee_transfers', 'manage_employee_transfers',
  ],

  'hr-manager': [
    ...PERMISSIONS['Dashboard'],
    // Full employee lifecycle
    ...PERMISSIONS['Employees'],
    ...PERMISSIONS['Employee Relations'],
    // Company structure
    ...PERMISSIONS['Company'],
    // Documents
    ...PERMISSIONS['Documents'],
    // Leave
    ...PERMISSIONS['Leave Setup'],
    // Salary setup
    ...PERMISSIONS['Salary'],
    // Payroll
    ...PERMISSIONS['Payroll'],
    // Reports
    ...PERMISSIONS['Reports'],
    // HR operational areas
    ...PERMISSIONS['Recruitment'],
    ...PERMISSIONS['Performance'],
    ...PERMISSIONS['Medical'],
    ...PERMISSIONS['Attendance'],
    ...PERMISSIONS['Training'],
    // Read-only user/role access
    'view_users',
  ],

  'employee': [
    ...PERMISSIONS['Dashboard'],
    'view_documents',
  ],
};

// ─────────────────────────────────────────────────────────
// Ensure tables the login controller needs actually exist.
// ─────────────────────────────────────────────────────────
// Legacy defensive schema patch (MySQL-dialect DDL). On a schema managed by `prisma db push`
// or migrations (both MySQL and Postgres), these tables/columns already exist — so every
// statement is best-effort and its failure is ignored. The backtick identifiers make these
// MySQL-only; on Postgres they simply error-and-skip (the schema is already in place).
async function ensureTables() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS \`employee\` (
       \`id\` BIGINT NOT NULL AUTO_INCREMENT,
       \`firstName\` VARCHAR(100) NOT NULL DEFAULT '',
       \`lastName\` VARCHAR(100) NOT NULL DEFAULT '',
       \`email\` VARCHAR(100) NOT NULL DEFAULT '',
       \`phone\` VARCHAR(20) NULL,
       \`status\` CHAR(1) NOT NULL DEFAULT '1',
       PRIMARY KEY (\`id\`),
       UNIQUE INDEX \`employee_email_unique\` (\`email\`)
     ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    'ALTER TABLE `users` ADD COLUMN `employeeId` BIGINT NULL',
    'ALTER TABLE `users` ADD COLUMN `posted_by`  BIGINT NULL DEFAULT 0',
    "ALTER TABLE `users` ADD COLUMN `status` CHAR(1) NOT NULL DEFAULT '1'",
    `CREATE TABLE IF NOT EXISTS \`refresh_tokens\` (
       \`id\` BIGINT NOT NULL AUTO_INCREMENT,
       \`user_id\` BIGINT NOT NULL,
       \`token\` TEXT NOT NULL,
       \`expires_at\` DATETIME NOT NULL,
       \`revoked\` BOOLEAN NOT NULL DEFAULT false,
       \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (\`id\`)
     ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ];
  for (const sql of stmts) {
    try { await prisma.$executeRawUnsafe(sql); } catch { /* already exists / not applicable on this provider */ }
  }
}

async function main() {
  console.log('🌱 Starting seed...\n');

  // ── 0. Ensure required tables ────────────────────────
  console.log('🛠  Ensuring schema is ready...');
  await ensureTables();
  console.log('   ✔ Tables verified\n');

  // ── 1. Upsert roles ──────────────────────────────────
  console.log('📋 Seeding roles...');
  const createdRoles = {};

  for (const { name, description, is_system } of ROLES) {
    const role = await prisma.roles.upsert({
      where:  { name_guard_name: { name, guard_name: GUARD } },
      update: { updated_at: NOW },
      create: { name, guard_name: GUARD, description, is_system, created_at: NOW, updated_at: NOW },
    });
    createdRoles[name] = role;
    console.log(`   ✔ ${name} (id: ${role.id})`);
  }

  // ── 2. Upsert permissions ────────────────────────────
  console.log('\n🔑 Seeding permissions...');
  const createdPermissions = {};
  let totalPerms = 0;

  for (const [group, perms] of Object.entries(PERMISSIONS)) {
    console.log(`\n   [${group}]`);
    for (const permName of perms) {
      const perm = await prisma.permissions.upsert({
        where:  { name_guard_name: { name: permName, guard_name: GUARD } },
        update: { updated_at: NOW },
        create: { name: permName, guard_name: GUARD, created_at: NOW, updated_at: NOW },
      });
      createdPermissions[permName] = perm;
      console.log(`      ✔ ${permName}`);
      totalPerms++;
    }
  }

  // ── 3. Assign permissions to each role ───────────────
  console.log('\n🛡️  Assigning permissions to roles...');

  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = createdRoles[roleName];
    const unique = [...new Set(permNames)];

    for (const permName of unique) {
      const perm = createdPermissions[permName];
      if (!perm) continue;
      await prisma.role_has_permissions.upsert({
        where:  { permission_id_role_id: { permission_id: perm.id, role_id: role.id } },
        update: {},
        create: { permission_id: perm.id, role_id: role.id },
      });
    }
    console.log(`   ✔ ${roleName} → ${unique.length} permissions`);
  }

  // ── 4. Seed super-admin employee record ──────────────
  console.log('\n👑 Seeding super-admin user...');

  // Portable (works on MySQL + Postgres): email is @unique, so upsert on it.
  const emp = await prisma.employee.upsert({
    where:  { email: 'superadmin@usg.com' },
    update: { firstName: 'Super', lastName: 'Admin', status: '1' },
    create: { firstName: 'Super', lastName: 'Admin', email: 'superadmin@usg.com', phone: '0000000000', status: '1' },
    select: { id: true },
  });
  const empId = emp.id;
  console.log(`   ✔ Employee ready (id: ${empId})`);

  // ── 5. Seed super-admin users record ─────────────────
  const salt           = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash('pass1234', salt);

  // Portable: find-then-update/create (username has no unique constraint in the schema).
  const existingUser = await prisma.users.findFirst({
    where: { username: 'superadmin@usg.com' },
    select: { id: true },
  });

  let userId;
  if (existingUser) {
    userId = existingUser.id;
    await prisma.users.update({
      where: { id: userId },
      data:  { password: hashedPassword, employeeId: empId, status: '1' },
    });
    console.log('   ✔ User already existed — password and employeeId reset');
  } else {
    const newUser = await prisma.users.create({
      data: { username: 'superadmin@usg.com', password: hashedPassword, employeeId: empId, posted_by: 0n, status: '1' },
      select: { id: true },
    });
    userId = newUser.id;
    console.log(`   ✔ User created (id: ${userId})`);
  }

  // ── 6. Assign super-admin role to user ───────────────
  const userIdStr = userId.toString();
  try {
    await prisma.model_has_roles.create({
      data: {
        role_id:    createdRoles['super-admin'].id,
        model_id:   userIdStr,
        model_type: 'users',
      },
    });
    console.log('   ✔ super-admin role assigned');
  } catch {
    console.log('   ⚠ Role already assigned — skipping');
  }

  // ── Summary ───────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log('━'.repeat(60));
  console.log('  Roles       :', ROLES.map(r => r.name).join(', '));
  console.log('  Permissions :', totalPerms, 'across', Object.keys(PERMISSIONS).length, 'groups');
  console.log('');
  console.log('  Permission groups:');
  for (const [group, perms] of Object.entries(PERMISSIONS)) {
    console.log(`    ${group.padEnd(25)} ${perms.length} permissions`);
  }
  console.log('');
  console.log('  Login with  :');
  console.log('    Username → superadmin@usg.com');
  console.log('    Password → pass1234');
  console.log('━'.repeat(60));
  console.log('  ⚠  Change the default password after first login!\n');
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
