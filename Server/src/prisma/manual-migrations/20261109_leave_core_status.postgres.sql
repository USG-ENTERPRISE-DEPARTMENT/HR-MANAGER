-- Tell core banking when an employee goes on leave and comes back. Idempotent.
--
-- employeeleaves.returned_on: the day HR recorded an early return. A leave with a value no longer counts
--   as current, so the employee goes back to ACTIVE before the leave's end date.
-- employee_core_status: the staffStatus last accepted by core banking, per employee, so the scheduled
--   job only sends a change and picks up anything it missed. Kept out of the employee table on purpose:
--   the app reads it with raw SQL, so the employee screens do not depend on it.

BEGIN;

ALTER TABLE employeeleaves ADD COLUMN IF NOT EXISTS returned_on DATE NULL;

CREATE TABLE IF NOT EXISTS employee_core_status (
  employee     BIGINT       NOT NULL PRIMARY KEY,
  staff_status VARCHAR(20)  NOT NULL,
  updated_at   TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
