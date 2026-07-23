/**
 * seedLeaves.js
 *
 * Seeds the database with a comprehensive set of leave types and sample
 * leave rules. Safe to re-run — existing records with the same name are
 * skipped via INSERT IGNORE / SELECT + conditional insert.
 *
 * Run with:
 *   node Server/src/prisma/seedLeaves.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Leave type definitions ──────────────────────────────────────────────────

const LEAVE_TYPES = [
  {
    name:                             'Annual Leave',
    leave_color:                      '#2563eb',
    default_per_year:                 21,
    carried_forward:                  'Yes',
    carried_forward_percentage:       100,
    max_carried_forward_amount:       5,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'Yes',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Sick Leave',
    leave_color:                      '#ef4444',
    default_per_year:                 14,
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Casual Leave',
    leave_color:                      '#f59e0b',
    default_per_year:                 7,
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Maternity Leave',
    leave_color:                      '#ec4899',
    default_per_year:                 84,   // 12 weeks
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'Yes',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Paternity Leave',
    leave_color:                      '#6366f1',
    default_per_year:                 5,
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Compassionate / Bereavement Leave',
    leave_color:                      '#64748b',
    default_per_year:                 5,
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Study / Exam Leave',
    leave_color:                      '#0ea5e9',
    default_per_year:                 10,
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Marriage Leave',
    leave_color:                      '#d946ef',
    default_per_year:                 5,
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Unpaid Leave',
    leave_color:                      '#94a3b8',
    default_per_year:                 30,
    carried_forward:                  'No',
    carried_forward_percentage:       0,
    max_carried_forward_amount:       0,
    carried_forward_leave_availability: 365,
    leave_accrue:                     'No',
    employee_can_apply:               'No',   // admin/supervisor assigns only
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'Yes',
    propotionate_on_joined_date:      'No',
    send_notification_emails:         'Yes',
    leave_allowance:                  'No',
    leave_allowance_once:             'No',
  },
  {
    name:                             'Long Service Leave',
    leave_color:                      '#10b981',
    default_per_year:                 10,
    carried_forward:                  'Yes',
    carried_forward_percentage:       100,
    max_carried_forward_amount:       30,
    carried_forward_leave_availability: 730,  // 2 years to use carried days
    leave_accrue:                     'Yes',
    employee_can_apply:               'Yes',
    supervisor_leave_assign:          'Yes',
    apply_beyond_current:             'No',
    propotionate_on_joined_date:      'Yes',
    send_notification_emails:         'Yes',
    leave_allowance:                  'Yes',  // typically paid out
    leave_allowance_once:             'Yes',  // once per period
  },
];

// ── Leave rule definitions (applied per leave type by name) ─────────────────
// These rules override the leave-type defaults for specific matching criteria.
// Criteria left as null are wildcards (match any).

const LEAVE_RULES = [
  // Annual Leave: junior employees (no specific job title) get 14 days instead of 21
  {
    leave_type_name:            'Annual Leave',
    default_per_year:           14,
    employee_can_apply:         'Yes',
    supervisor_leave_assign:    'Yes',
    apply_beyond_current:       'No',
    leave_accrue:               'No',
    carried_forward:            'Yes',
    carried_forward_percentage: 50,
    max_carried_forward_amount: 3,
    carried_forward_leave_availability: 365,
    propotionate_on_joined_date: 'Yes',
    leave_allowance:            'No',
    leave_allowance_once:       'No',
  },
  // Sick Leave: beyond-balance allowed for confirmed employees
  {
    leave_type_name:            'Sick Leave',
    default_per_year:           14,
    employee_can_apply:         'Yes',
    supervisor_leave_assign:    'Yes',
    apply_beyond_current:       'Yes',
    leave_accrue:               'No',
    carried_forward:            'No',
    carried_forward_percentage: 0,
    max_carried_forward_amount: 0,
    carried_forward_leave_availability: 365,
    propotionate_on_joined_date: 'No',
    leave_allowance:            'No',
    leave_allowance_once:       'No',
  },
  // Long Service Leave: accrual + carry-forward rule for senior staff
  {
    leave_type_name:            'Long Service Leave',
    default_per_year:           15,
    employee_can_apply:         'Yes',
    supervisor_leave_assign:    'Yes',
    apply_beyond_current:       'No',
    leave_accrue:               'Yes',
    carried_forward:            'Yes',
    carried_forward_percentage: 100,
    max_carried_forward_amount: 45,
    carried_forward_leave_availability: 730,
    propotionate_on_joined_date: 'Yes',
    leave_allowance:            'Yes',
    leave_allowance_once:       'Yes',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function newId() {
  return BigInt(Date.now() + Math.floor(Math.random() * 100000));
}

async function insertLeaveType(lt) {
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM leavetypes WHERE name=? LIMIT 1`, lt.name
  ).catch(() => []);
  if (existing.length) {
    console.log(`  SKIP (exists): ${lt.name}`);
    return BigInt(existing[0].id);
  }

  const id = newId();
  await prisma.$executeRawUnsafe(`
    INSERT INTO leavetypes
      (id, name, leave_color, default_per_year, carried_forward, carried_forward_percentage,
       max_carried_forward_amount, carried_forward_leave_availability, leave_accrue,
       employee_can_apply, supervisor_leave_assign, apply_beyond_current,
       propotionate_on_joined_date, send_notification_emails,
       leave_allowance, leave_allowance_once)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    lt.name,
    lt.leave_color,
    lt.default_per_year,
    lt.carried_forward,
    lt.carried_forward_percentage,
    lt.max_carried_forward_amount,
    lt.carried_forward_leave_availability,
    lt.leave_accrue,
    lt.employee_can_apply,
    lt.supervisor_leave_assign,
    lt.apply_beyond_current,
    lt.propotionate_on_joined_date,
    lt.send_notification_emails,
    lt.leave_allowance,
    lt.leave_allowance_once,
  );
  console.log(`  INSERT: ${lt.name} (id=${id})`);
  return id;
}

async function insertLeaveRule(leaveTypeId, rule) {
  // One default rule per leave type is enough for seeding — skip if exists
  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM leaverules WHERE leave_type=? AND job_title IS NULL AND employment_status IS NULL AND employee IS NULL LIMIT 1`,
    leaveTypeId
  ).catch(() => []);
  if (existing.length) {
    console.log(`    SKIP rule (exists for type ${leaveTypeId})`);
    return;
  }

  const id = newId();
  await prisma.$executeRawUnsafe(`
    INSERT INTO leaverules
      (id, leave_type, default_per_year, employee_can_apply, supervisor_leave_assign,
       apply_beyond_current, leave_accrue, carried_forward, carried_forward_percentage,
       max_carried_forward_amount, carried_forward_leave_availability,
       propotionate_on_joined_date, leave_allowance, leave_allowance_once)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    leaveTypeId,
    rule.default_per_year,
    rule.employee_can_apply,
    rule.supervisor_leave_assign,
    rule.apply_beyond_current,
    rule.leave_accrue,
    rule.carried_forward,
    rule.carried_forward_percentage,
    rule.max_carried_forward_amount,
    rule.carried_forward_leave_availability,
    rule.propotionate_on_joined_date,
    rule.leave_allowance,
    rule.leave_allowance_once,
  );
  console.log(`    INSERT rule id=${id}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Leave Seeder ===\n');

  // Build a name→id map as we insert types
  const typeIdMap = {};

  console.log('Leave Types:');
  for (const lt of LEAVE_TYPES) {
    const id = await insertLeaveType(lt);
    typeIdMap[lt.name] = id;
  }

  console.log('\nLeave Rules:');
  for (const rule of LEAVE_RULES) {
    const typeId = typeIdMap[rule.leave_type_name];
    if (!typeId) {
      console.log(`  WARN: leave type "${rule.leave_type_name}" not found — skipping rule`);
      continue;
    }
    console.log(`  Rule for "${rule.leave_type_name}" (type id=${typeId}):`);
    await insertLeaveRule(typeId, rule);
  }

  console.log('\n✓ Leave seeding complete.\n');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
