-- Let a payroll run name its report template. See 20261110_payrollrun_template.postgres.sql.
-- Re-running fails with "Duplicate column" — harmless.

ALTER TABLE payrollruns ADD COLUMN template_id BIGINT NULL;
