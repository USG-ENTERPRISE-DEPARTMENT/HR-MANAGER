-- Tell core banking when an employee goes on leave and comes back.
-- See 20261109_leave_core_status.postgres.sql. Re-running fails with "Duplicate column" on the first
-- statement — harmless.

ALTER TABLE employeeleaves ADD COLUMN returned_on DATE NULL;

CREATE TABLE IF NOT EXISTS employee_core_status (
  employee     BIGINT      NOT NULL PRIMARY KEY,
  staff_status VARCHAR(20) NOT NULL,
  updated_at   DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
