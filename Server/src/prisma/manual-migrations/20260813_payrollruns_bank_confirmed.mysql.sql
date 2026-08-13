-- MySQL counterpart of 20260813_payrollruns_bank_confirmed.postgres.sql — see that file for why.
--
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS. Re-running this on a database that already has the
-- columns fails with error 1060 (duplicate column name), which is safe to ignore — the same
-- behaviour as the attendance column migrations already in this project.
--
-- Pairs with 20260813_payrollruns_status_bank_pending.mysql.sql; run both before deploying.

ALTER TABLE payrollruns ADD COLUMN bank_confirmed_at DATETIME NULL;
ALTER TABLE payrollruns ADD COLUMN bank_confirmed_by BIGINT NULL;
