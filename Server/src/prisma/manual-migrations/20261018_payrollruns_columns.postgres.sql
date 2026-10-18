-- payrollruns.columns: the run's own payroll-column list (JSON array of payrollcolumns ids). Idempotent.
--
-- The legacy payroll stored, on every run, exactly which columns it calculated (payroll.columns).
-- Without it, generating a run calculated every enabled column in the run's calculation group — back-pay
-- columns, 13th-month columns, even another group's NASSIT — so a duplicated run's net pay no longer
-- matched the run it was copied from. NULL keeps the old behaviour (all enabled columns, group-scoped).

ALTER TABLE payrollruns ADD COLUMN IF NOT EXISTS columns TEXT NULL;
