-- ─────────────────────────────────────────────────────────────────────────────
-- Migrate staff: legacy `employees` (old table) → app `employee` (new table)
-- Run in phpMyAdmin against the xhrm database (select the DB, open SQL tab, paste all, Go).
--
-- Idempotent / safe to re-run:
--   • only inserts staff whose employee_id is NOT already in `employee`
--   • rows with a blank employee_id are skipped (e.g. the "Union Admin" system row)
--   • the supervisor pass only FILLS blanks — it never overwrites a reporting line
--   • email is synthesised as <staff-no>@imported.local (email is required + unique);
--     the real work/private email is kept only when it is genuinely unique
--   • lookup ids (department/branch/unit/outlet, job title, paygrade, notch, gender…)
--     are intentionally NOT mapped — legacy codes don't match this system's lookups
-- ─────────────────────────────────────────────────────────────────────────────

SET SESSION sql_mode = '';

-- Align collations so employee_id/email comparisons don't error (one-time; harmless to repeat)
ALTER TABLE `employees` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1) Insert staff that are not yet in the new table
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
  AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.employee_id = s.employee_id);

-- 2) Reporting line: legacy `supervisor` holds the OLD employees.id — resolve it to the new
--    employee via the supervisor's staff number. Fills blanks only; never overwrites.
UPDATE employee e
  JOIN employees s   ON s.employee_id    = e.employee_id
  JOIN employees sup ON sup.id           = s.supervisor
  JOIN employee esup ON esup.employee_id = sup.employee_id
SET e.supervisorId = esup.id
WHERE s.supervisor IS NOT NULL
  AND e.supervisorId IS NULL;

-- 3) Verify — legacy staff still missing from the new table (expect 0 rows)
SELECT s.employee_id, s.first_name, s.last_name, s.status
FROM employees s
WHERE NULLIF(TRIM(s.employee_id),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM employee e WHERE e.employee_id = s.employee_id);
