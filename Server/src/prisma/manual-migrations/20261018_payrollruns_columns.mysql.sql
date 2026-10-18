-- payrollruns.columns: the run's own payroll-column list (JSON array of payrollcolumns ids).
-- See 20261018_payrollruns_columns.postgres.sql. Re-running fails with "Duplicate column" — harmless.

ALTER TABLE payrollruns ADD COLUMN columns TEXT NULL;
