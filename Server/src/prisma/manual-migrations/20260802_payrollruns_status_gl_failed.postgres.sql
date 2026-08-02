-- Add the missing 'GL Failed' member to payrollruns_status.
--
-- finalizePayroll sets a run to 'GL Failed' when the journal cannot be posted to the general ledger,
-- so the run can be retried later without regenerating it (retryGLPosting gates on exactly this
-- status). The value was never added to the enum in either provider, so that write fails:
--   Postgres -> ERROR 22P02, invalid input value for enum payrollruns_status: "GL Failed"
--   MySQL    -> silently coerced to '' in non-strict mode
-- Either way the run is left un-marked and the retry path is unreachable.
--
-- Note: ALTER TYPE ... ADD VALUE cannot run inside a transaction block on PostgreSQL < 12, and its
-- effect is not visible to other statements in the same transaction. Run this statement on its own.

ALTER TYPE payrollruns_status ADD VALUE IF NOT EXISTS 'GL Failed';
