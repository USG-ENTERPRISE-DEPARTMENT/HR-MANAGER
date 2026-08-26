-- MySQL counterpart of 20260826_payslip_layout.postgres.sql — see that file for why each column
-- exists.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so re-running this fails with
--   ERROR 1060 (42S21): Duplicate column name '...'
-- That error is safe to ignore: it means the column is already present. Run each statement
-- separately so one duplicate does not abort the rest.
--
-- Prisma maps Boolean to TINYINT(1) on MySQL, so payslip_in_total is declared that way to keep the
-- generated client identical across providers.

ALTER TABLE payslip_settings ADD COLUMN payslip_columns TEXT NULL;

ALTER TABLE payrollcolumns   ADD COLUMN payslip_section  VARCHAR(20) NULL;
ALTER TABLE payrollcolumns   ADD COLUMN payslip_in_total TINYINT(1) NOT NULL DEFAULT 0;
