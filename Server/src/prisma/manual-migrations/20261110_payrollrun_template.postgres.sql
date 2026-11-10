-- Let a payroll run name its report template. Idempotent.
--
-- payrollruns.template_id: the payslip_settings row chosen on the run form. When set, the run's report,
--   payslips and snapshot use THAT template instead of the one matched by payment type + group, and a
--   run of a new kind (e.g. the first Rent Allowance run for Management) takes its columns from it.
--   NULL = match automatically, as before.

ALTER TABLE payrollruns ADD COLUMN IF NOT EXISTS template_id BIGINT NULL;
