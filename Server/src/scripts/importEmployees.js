/*
 * One-off importer: legacy `employees` (phpMyAdmin dump, DB `hrmdata`) -> app `employee` table.
 *
 * Usage:
 *   node src/scripts/importEmployees.js [path-to-dump.sql]
 *
 *   - With a file arg: drops/recreates the staging `employees` table and loads the dump's
 *     CREATE TABLE + INSERTs (the trigger/DELIMITER section is stripped — it isn't needed and
 *     can't run over a multi-statement connection).
 *   - Without a file arg: assumes the staging `employees` table is already populated (e.g. you
 *     imported the dump via phpMyAdmin) and only runs the mapping pass.
 *
 * Safe to re-run: rows whose employee_id already exists in `employee` are skipped.
 *
 * Mapping notes:
 *   - `email` is REQUIRED + UNIQUE in the app but the legacy data has no clean unique email
 *     (work_email is shared by dozens of staff). We synthesise `<employee_id>@imported.local`
 *     for it, and keep the real address in `work_email` only when it is genuinely unique.
 *   - Lookup/FK id columns (titleId, genderId, religionId, nationalityId, jobTitleId,
 *     employmentStatusId, staff_level, staff_role, branchId, departmentId, unitId, outletId,
 *     paygradeId, notcheId) are NOT populated: the legacy numeric codes don't match this
 *     system's cuid-based lookups. Re-map them later once the lookup tables are populated.
 *   - Rows with a NULL/blank employee_id are skipped (e.g. the legacy "Union Admin" system row).
 */
const fs = require('fs');
const mysql = require('mysql2/promise');

const DB = { host: 'localhost', user: 'root', database: 'xhrm', multipleStatements: true };

async function loadStaging(conn, file) {
  const sql = fs.readFileSync(file, 'utf8');
  // Keep everything before the trigger section (CREATE TABLE + all INSERTs).
  const head = sql.split(/^DELIMITER/m)[0];
  await conn.query('SET SESSION sql_mode = ""');
  await conn.query('DROP TABLE IF EXISTS `employees`');
  await conn.query(head);
  await conn.query('COMMIT');
  const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM employees');
  console.log(`Staging loaded from ${file}: ${n} rows`);
}

async function migrate(conn) {
  await conn.query("SET SESSION sql_mode = ''"); // permissive: tolerate legacy date/length quirks
  // Align staging collation with the `employee` table so cross-table employee_id/email
  // comparisons don't raise "Illegal mix of collations".
  await conn.query('ALTER TABLE `employees` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');

  const [[before]] = await conn.query('SELECT COUNT(*) n FROM employee');

  // Insert plain-data columns. Lookup/FK ids deliberately omitted (see header).
  const [res] = await conn.query(`
    INSERT INTO employee (
      firstName, lastName, middleName, email, phone, mobilePhone,
      status, approvalStatus, lifecycleStatus,
      address1, city, country, dateOfBirth, employee_id,
      hireDate, confirmationDate, retirement_date, termination_date, approved_date,
      bankAccount, driverLicenseNum, driverLicenseExp,
      nationalIdNumber, nationalIdExpiry, ssn_num,
      father_name, mother_name, spouse_name, place_of_birth,
      fit_and_proper, medicalClearance, policeClearance, marital_status,
      nxt_kin_fname, nxt_kin_phone, nxt_kin_email, nxt_kin_address,
      personal_email, work_email, profile_imagebase64,
      staff_level, staff_role,
      createdAt, updatedAt
    )
    SELECT
      LEFT(s.first_name,100), LEFT(s.last_name,100), LEFT(NULLIF(TRIM(s.middle_name),''),100),
      CONCAT(LOWER(s.employee_id), '@imported.local'),
      LEFT(COALESCE(NULLIF(TRIM(s.mobile_phone),''), NULLIF(TRIM(s.home_phone),'')),20),
      LEFT(NULLIF(TRIM(s.mobile_phone),''),30),
      CASE WHEN s.status = 'Active' THEN '1' ELSE '0' END,
      CASE WHEN s.approval_status = 'Approved' THEN 'APPROVED' ELSE 'PENDING' END,
      CASE WHEN s.status = 'Active' THEN 'ACTIVE' ELSE 'RESIGNED' END,
      NULLIF(TRIM(s.address1),''), LEFT(NULLIF(TRIM(s.city),''),100), LEFT(NULLIF(TRIM(s.country),''),100),
      s.birthday, s.employee_id,
      COALESCE(s.start_date, s.recruitment_date), s.confirmation_date, s.retirement_date, s.termination_date, s.approved_date,
      LEFT(NULLIF(TRIM(s.bank_acc_no),''),50), LEFT(NULLIF(TRIM(s.driving_license),''),30), s.driving_license_exp_date,
      LEFT(NULLIF(TRIM(s.nic_num),''),50), s.nin_expiry_date, LEFT(NULLIF(TRIM(s.ssn_num),''),20),
      LEFT(NULLIF(TRIM(s.father_name),''),50), LEFT(NULLIF(TRIM(s.mother_name),''),50),
      LEFT(NULLIF(TRIM(s.spouse_name),''),100), LEFT(NULLIF(TRIM(s.place_of_birth),''),50),
      LEFT(NULLIF(TRIM(s.fit_and_proper),''),150), LEFT(NULLIF(TRIM(s.medicalClearance),''),150),
      LEFT(NULLIF(TRIM(s.policeClearance),''),150), LEFT(NULLIF(TRIM(s.marital_status),''),20),
      LEFT(NULLIF(TRIM(s.nxt_kin_fname),''),100), LEFT(NULLIF(TRIM(s.nxt_kin_phone),''),20),
      LEFT(NULLIF(TRIM(s.nxt_kin_email),''),100), LEFT(NULLIF(TRIM(s.nxt_kin_address),''),255),
      -- personal_email / work_email only when genuinely unique (UNIQUE columns)
      CASE WHEN NULLIF(TRIM(s.private_email),'') IS NOT NULL
             AND (SELECT COUNT(*) FROM employees x WHERE LOWER(NULLIF(TRIM(x.private_email),'')) = LOWER(NULLIF(TRIM(s.private_email),''))) = 1
             AND NOT EXISTS (SELECT 1 FROM employee e2 WHERE e2.personal_email = NULLIF(TRIM(s.private_email),''))
           THEN LEFT(NULLIF(TRIM(s.private_email),''),100) ELSE NULL END,
      CASE WHEN NULLIF(TRIM(s.work_email),'') IS NOT NULL
             AND (SELECT COUNT(*) FROM employees x WHERE LOWER(NULLIF(TRIM(x.work_email),'')) = LOWER(NULLIF(TRIM(s.work_email),''))) = 1
             AND NOT EXISTS (SELECT 1 FROM employee e2 WHERE e2.work_email = NULLIF(TRIM(s.work_email),''))
           THEN LEFT(NULLIF(TRIM(s.work_email),''),100) ELSE NULL END,
      s.profile_imagebase64,
      LEFT(NULLIF(TRIM(s.staff_level),''),36), LEFT(NULLIF(TRIM(s.staff_role),''),36),
      NOW(), NOW()
    FROM employees s
    WHERE NULLIF(TRIM(s.employee_id),'') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.employee_id = s.employee_id)
  `);

  // Second pass: resolve reporting line. Legacy `supervisor` is the OLD employee id; map it to
  // the newly-inserted employee via the supervisor's employee_id. Only fills employees whose
  // supervisor is still unset — never overwrites reporting lines curated in the app.
  const [sup] = await conn.query(`
    UPDATE employee e
      JOIN employees s   ON s.employee_id  = e.employee_id
      JOIN employees sup ON sup.id         = s.supervisor
      JOIN employee esup ON esup.employee_id = sup.employee_id
    SET e.supervisorId = esup.id
    WHERE s.supervisor IS NOT NULL
      AND e.supervisorId IS NULL
  `);

  const [[after]] = await conn.query('SELECT COUNT(*) n FROM employee');
  const [[skipNull]] = await conn.query("SELECT COUNT(*) n FROM employees WHERE NULLIF(TRIM(employee_id),'') IS NULL");
  const [[staged]] = await conn.query('SELECT COUNT(*) n FROM employees');

  console.log('--- migration summary ---');
  console.log('staging rows           :', staged.n);
  console.log('employee before        :', before.n);
  console.log('inserted               :', res.affectedRows);
  console.log('employee after         :', after.n);
  console.log('skipped (blank emp id) :', skipNull.n);
  console.log('supervisor links set   :', sup.affectedRows);
}

(async () => {
  const file = process.argv[2];
  const conn = await mysql.createConnection(DB);
  try {
    if (file) await loadStaging(conn, file);
    const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM employees');
    if (n === 0) {
      console.error('Staging `employees` is empty. Pass the dump file path, or import it into the `employees` table first.');
      process.exit(2);
    }
    await migrate(conn);
  } finally {
    await conn.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
