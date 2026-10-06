-- ─────────────────────────────────────────────────────────────────────────────
-- Add nassit_num to employee  (MYSQL)
--
-- The old IceHRM production table (hrmdata_rcb.employees) carries nassit_num for 973 of its
-- 1,281 employees; the HR-MANAGER `employee` table has no equivalent column, so without this
-- the number is lost at migration and the NASSIT statutory report can never be built.
--
-- Deliberately NULLABLE and NOT UNIQUE. In the production data 5 NASSIT numbers are shared by
-- 11 employees, and 2 of those groups have more than one ACTIVE employee:
--   * E1108199303110016 - one person (SHERIFF JOHN KAMARA) holding two employee records,
--     P2022037 (the original, 73 payroll runs) and UTB00523 (an empty shell from the UTB merge)
--   * N2504198104220026 - two different people (ABIBATU JOLLEY, IDRISSA KOROMA) sharing one
--     number, which is a data-entry error
-- A UNIQUE constraint would abort the migration on these rows. The duplicates are reported by
-- the migration dry run so HR can correct them in the app; they are not resolved by guessing here.
--
-- VARCHAR(20) matches the legacy column width; observed values are 16-18 characters.
--
-- NOTE: MySQL/MariaDB has no "ADD COLUMN IF NOT EXISTS" in every supported version, so this is
-- written to be run ONCE. Re-running it errors with "Duplicate column name 'nassit_num'", which
-- is harmless - it means the column is already there.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `employee` ADD COLUMN `nassit_num` VARCHAR(20) NULL;

-- Lookups for the NASSIT report are by number; not unique, for the reasons above.
CREATE INDEX `employee_nassit_num_idx` ON `employee` (`nassit_num`);
