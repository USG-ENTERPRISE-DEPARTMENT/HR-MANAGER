-- Record WHEN core banking confirmed a payroll payment, and by whom.
--
-- finalized_at means "when HR posted the journal" — nothing recorded when the bank actually
-- confirmed, so the confirmation time existed only in the audit trail and could not be reported on.
--
-- bank_confirmed_by is deliberately nullable and carries meaning either way:
--   NULL     -> confirmed through the bank's API callback (the actor is the bank, not a user)
--   user id  -> someone used "Mark as Paid" in the UI
-- That distinction is how a bank-confirmed run is told apart from a human assertion.
--
-- Pairs with 20260813_payrollruns_status_bank_pending.postgres.sql; run both before deploying.

ALTER TABLE payrollruns ADD COLUMN IF NOT EXISTS bank_confirmed_at TIMESTAMP(0) NULL;
ALTER TABLE payrollruns ADD COLUMN IF NOT EXISTS bank_confirmed_by BIGINT NULL;
