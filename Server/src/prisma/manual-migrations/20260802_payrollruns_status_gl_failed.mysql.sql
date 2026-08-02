-- MySQL counterpart of 20260802_payrollruns_status_gl_failed.postgres.sql — see that file for why.
--
-- MySQL has no "add one member" syntax for ENUM, so the full member list is restated with
-- 'GL Failed' appended. Order is preserved and no existing value is removed, so stored rows are
-- unaffected. Keep this list identical to the payrollruns_status enum in schema.prisma.

ALTER TABLE payrollruns MODIFY COLUMN status
  ENUM('Draft','Processing','Pending Approval','Rejected','Approved','Completed','GL Failed')
  NULL DEFAULT 'Draft';
