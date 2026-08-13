-- MySQL counterpart of 20260813_payrollruns_status_bank_pending.postgres.sql — see that file for why.
--
-- MySQL has no "add one member" syntax for ENUM, so the full member list is restated with
-- 'Bank Pending' appended. MySQL stores ENUM as an ordinal, so the new member MUST go last: adding
-- it mid-list would silently remap every stored row. Order is preserved and no existing value is
-- removed, so stored rows are unaffected.
--
-- Keep this list byte-identical, in order, to the payrollruns_status enum in schema.prisma.

ALTER TABLE payrollruns MODIFY COLUMN status
  ENUM('Draft','Processing','Pending Approval','Rejected','Approved','Completed','GL Failed','Bank Pending')
  NULL DEFAULT 'Draft';
