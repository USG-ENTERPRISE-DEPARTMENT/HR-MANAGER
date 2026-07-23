/**
 * prisma/seedSettings.js
 *
 * Seeds all application settings tables with safe defaults.
 * Safe to re-run — uses INSERT IGNORE / upsert-style logic throughout
 * so existing user-configured values are never overwritten.
 *
 * Covers:
 *  - app_settings  (SMTP email config — falls back to .env values)
 *  - settings      (leave allowance, approval flow, threshold, calendar,
 *                   document, medical WHT, medical GL, API integration)
 *
 * Run with:
 *   node Server/src/prisma/seedSettings.js
 * or add to the prisma.seed script in package.json.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upsertAppSetting(key, value) {
  await prisma.$executeRawUnsafe(
    'INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES (?, ?)',
    key, value
  );
}

async function upsertSetting(name, value, category) {
  const existing = await prisma.$queryRawUnsafe(
    'SELECT id FROM settings WHERE name = ? AND category = ? LIMIT 1', name, category
  ).catch(() => []);
  if (!existing.length) {
    const id = BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 99999));
    await prisma.$executeRawUnsafe(
      'INSERT INTO settings (id, name, value, category) VALUES (?, ?, ?, ?)',
      id, name, value, category
    );
  }
  // Existing values are left untouched — user may have changed them intentionally.
}

// ── 1. app_settings — SMTP email ─────────────────────────────────────────────

async function seedAppSettings() {
  console.log('\n📧 Seeding app_settings (email)...');
  const defaults = [
    ['email_enabled',     '1'],
    ['email_smtp_host',   process.env.SMTP_HOST   || ''],
    ['email_smtp_port',   process.env.SMTP_PORT   || '587'],
    ['email_smtp_secure', process.env.SMTP_SECURE || 'false'],
    ['email_smtp_user',   process.env.SMTP_USER   || ''],
    ['email_smtp_pass',   process.env.SMTP_PASS   || ''],
    ['email_from',        process.env.SMTP_FROM   || process.env.SMTP_USER || ''],
  ];
  for (const [k, v] of defaults) {
    await upsertAppSetting(k, v);
    console.log(`   ✔ ${k}`);
  }
}

// ── 2. settings — leave allowance (category='leave_allowance') ────────────────

async function seedLeaveAllowanceSettings() {
  console.log('\n🏖️  Seeding leave allowance settings...');
  const defaults = [
    ['leave_allow_enabled',       'No'],
    ['leave_allow_tax_gl',        ''],
    ['leave_allow_debit_gl',      ''],
    ['leave_allow_annual_factor', '0.3'],
    ['leave_allow_tax_rate',      '0.3'],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'leave_allowance');
    console.log(`   ✔ ${k}`);
  }
}

// ── 3. settings — leave approval flow (category='leave_approval_flow') ────────

async function seedLeaveApprovalFlowSettings() {
  console.log('\n✅ Seeding leave approval flow settings...');
  const defaults = [
    ['leave_supervisor_approval', 'No'],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'leave_approval_flow');
    console.log(`   ✔ ${k}`);
  }
}

// ── 4. settings — threshold approval (category='leave_threshold_approval') ────

async function seedLeaveThresholdSettings() {
  console.log('\n💰 Seeding leave threshold approval settings...');
  const defaults = [
    ['threshold_enabled',   'No'],
    ['threshold_amount',    '0'],
    ['threshold_approvers', '[]'],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'leave_threshold_approval');
    console.log(`   ✔ ${k}`);
  }
}

// ── 5. settings — leave calendar (category='leave_calendar') ─────────────────

async function seedLeaveCalendarSettings() {
  console.log('\n📅 Seeding leave calendar settings...');
  const defaults = [
    ['calendar_show_all', 'No'],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'leave_calendar');
    console.log(`   ✔ ${k}`);
  }
}

// ── 6. settings — document (category='document_settings') ────────────────────

async function seedDocumentSettings() {
  console.log('\n📄 Seeding document settings...');
  const defaults = [
    ['allow_document_download', 'No'],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'document_settings');
    console.log(`   ✔ ${k}`);
  }
}

// ── 7. settings — medical WHT (category='medical') ───────────────────────────

async function seedMedicalSettings() {
  console.log('\n🏥 Seeding medical WHT settings...');
  const defaults = [
    ['wht_rate_hospital', '0'],
    ['wht_rate_pharmacy', '0'],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'medical');
    console.log(`   ✔ ${k}`);
  }
}

// ── 8. settings — medical GL (category='medical_gl') ─────────────────────────

async function seedMedicalGlSettings() {
  console.log('\n🏦 Seeding medical GL settings...');
  const defaults = [
    ['medical_expense_gl', ''],
    ['medical_wht_gl',     ''],
    ['medical_gl_branch',  ''],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'medical_gl');
    console.log(`   ✔ ${k}`);
  }
}

// ── 9. settings — API integration (category='api') ───────────────────────────

async function seedApiSettings() {
  console.log('\n🔌 Seeding API integration settings...');
  const defaults = [
    ['gl_url',                      process.env.POSTING_API_URL    || ''],
    ['gl_api_key',                  process.env.POSTING_API_KEY    || ''],
    ['gl_api_secret',               process.env.POSTING_API_SECRET || ''],
    ['gl_bearer_token',             ''],
    ['gl_basic_user',               ''],
    ['gl_basic_pass',               ''],
    ['gl_timeout',                  '30000'],
    ['gl_extra',                    '{}'],
    ['employee_sync_url',           process.env.EMPLOYEE_SYNC_URL  || ''],
    ['employee_sync_timeout',       '10000'],
    ['employee_sync_api_key',       ''],
    ['employee_sync_api_secret',    ''],
    ['employee_sync_bearer_token',  ''],
    ['employee_sync_basic_user',    ''],
    ['employee_sync_basic_pass',    ''],
    ['employee_sync_extra',         '{}'],
  ];
  for (const [k, v] of defaults) {
    await upsertSetting(k, v, 'api');
    console.log(`   ✔ ${k}`);
  }
}

// ── 10. expensescategories + expensespaymentmethods ──────────────────────────

async function seedExpenseLookups() {
  console.log('\n💳 Seeding expense categories...');
  const categories = [
    { name: 'Accommodation',             expense_gl: '' },
    { name: 'Meals & Beverages',         expense_gl: '' },
    { name: 'Local Transportation',      expense_gl: '' },
    { name: 'International Transportation', expense_gl: '' },
    { name: 'Communication',             expense_gl: '' },
    { name: 'Office Supplies',           expense_gl: '' },
    { name: 'Training / Conference',     expense_gl: '' },
    { name: 'Entertainment',             expense_gl: '' },
    { name: 'Visa / Immigration',        expense_gl: '' },
    { name: 'Medical (Travel)',          expense_gl: '' },
    { name: 'Miscellaneous',             expense_gl: '' },
  ];
  const now = new Date();
  for (const cat of categories) {
    const existing = await prisma.$queryRawUnsafe(
      'SELECT id FROM expensescategories WHERE name = ? LIMIT 1', cat.name
    ).catch(() => []);
    if (!existing.length) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO expensescategories (name, expense_gl, created, updated) VALUES (?, ?, ?, ?)',
        cat.name, cat.expense_gl, now, now
      );
    }
    console.log(`   ✔ ${cat.name}`);
  }

  console.log('\n💳 Seeding expense payment methods...');
  const methods = ['Cash', 'Bank Transfer', 'Company Credit Card', 'Personal Credit Card', 'Cheque'];
  for (const name of methods) {
    const existing = await prisma.$queryRawUnsafe(
      'SELECT id FROM expensespaymentmethods WHERE name = ? LIMIT 1', name
    ).catch(() => []);
    if (!existing.length) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO expensespaymentmethods (name, created, updated) VALUES (?, ?, ?)',
        name, now, now
      );
    }
    console.log(`   ✔ ${name}`);
  }
}

// ── 11. payfrequencies — pay cycle reference data ────────────────────────────

async function seedPayFrequencies() {
  console.log('\n📆 Seeding pay frequencies...');
  const defaults = [
    { name: 'Weekly',       description: 'Pay every week',       sort_order: 1 },
    { name: 'Bi-Weekly',    description: 'Pay every two weeks',  sort_order: 2 },
    { name: 'Semi-Monthly', description: 'Pay twice per month',  sort_order: 3 },
    { name: 'Monthly',      description: 'Pay once per month',   sort_order: 4 },
    { name: 'Quarterly',    description: 'Pay every quarter',    sort_order: 5 },
    { name: 'Yearly',       description: 'Pay once per year',    sort_order: 6 },
  ];
  for (const row of defaults) {
    const existing = await prisma.$queryRawUnsafe(
      'SELECT id FROM payfrequencies WHERE name = ? LIMIT 1', row.name
    ).catch(() => []);
    if (!existing.length) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO payfrequencies (name, description, sort_order, is_active) VALUES (?, ?, ?, 1)',
        row.name, row.description, row.sort_order
      );
    }
    console.log(`   ✔ ${row.name}`);
  }
}

// ── 12. module_settings — one row per module, default enabled ─────────────────

async function seedModuleSettings() {
  console.log('\n🧩 Seeding module settings...');
  const modules = [
    'Employees', 'LeaveManagement', 'Payroll', 'Insights',
    'Company', 'Recruitment', 'Documents', 'Admin',
    'Medical', 'Performance', 'TravelExpense',
  ];
  for (const moduleId of modules) {
    await prisma.$executeRawUnsafe(
      'INSERT IGNORE INTO module_settings (module_id, enabled) VALUES (?, 1)',
      moduleId
    );
    console.log(`   ✔ ${moduleId}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding application settings...\n');

  await seedAppSettings();
  await seedLeaveAllowanceSettings();
  await seedLeaveApprovalFlowSettings();
  await seedLeaveThresholdSettings();
  await seedLeaveCalendarSettings();
  await seedDocumentSettings();
  await seedMedicalSettings();
  await seedMedicalGlSettings();
  await seedApiSettings();
  await seedExpenseLookups();
  await seedPayFrequencies();
  await seedModuleSettings();

  console.log('\n✅ Settings seed complete!');
  console.log('   All values use INSERT IGNORE — existing user settings were preserved.');
}

main()
  .catch(e => {
    console.error('❌ seedSettings failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
