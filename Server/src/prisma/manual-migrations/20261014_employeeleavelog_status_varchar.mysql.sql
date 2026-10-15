-- employeeleavelog.status_from / status_to: ENUM → VARCHAR(40). Safe to re-run.
-- See 20261014_employeeleavelog_status_varchar.postgres.sql — the ENUM cannot hold statuses the leave
-- workflow logs ('Draft', 'Pending HR Approval', 'Pending Financial Approval', …).

ALTER TABLE employeeleavelog
  MODIFY COLUMN status_from VARCHAR(40) NULL DEFAULT 'Pending',
  MODIFY COLUMN status_to   VARCHAR(40) NULL DEFAULT 'Pending';
