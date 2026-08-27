-- MySQL counterpart of 20260827_payrollemployees_unique_per_frequency.postgres.sql — see that file
-- for why.
--
-- MySQL 8 has no "CREATE UNIQUE INDEX IF NOT EXISTS", so re-running this fails with
--   ERROR 1061 (42000): Duplicate key name 'payrollemployees_employee_frequency_key'
-- which is safe to ignore: it means the index is already there.
--
-- MySQL also treats NULLs as distinct in a unique index, so the same caveat applies: rows with a
-- NULL pay_frequency are not covered. The API requires one on create and update.

CREATE UNIQUE INDEX payrollemployees_employee_frequency_key
  ON payrollemployees (employee, pay_frequency);
