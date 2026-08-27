-- MySQL counterpart of 20260827_payrollruns_template_snapshot.postgres.sql — see that file for why.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so re-running this fails with
--   ERROR 1060 (42S21): Duplicate column name 'template_snapshot'
-- which is safe to ignore: it means the column is already there.

ALTER TABLE payrollruns ADD COLUMN template_snapshot TEXT NULL;
