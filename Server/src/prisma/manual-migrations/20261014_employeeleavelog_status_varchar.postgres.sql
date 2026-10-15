-- employeeleavelog.status_from / status_to: enum → VARCHAR(40). Idempotent.
--
-- The enum only allows Approved/Pending/Rejected/Cancellation Requested/Cancelled/Processing, but the
-- leave workflow logs statuses it does not contain ('Draft', 'Pending Approval', 'Pending HR Approval',
-- 'Pending Financial Approval'). On top of that, leaveController.writeLog bound the value as a text
-- parameter, which Postgres refuses for an enum column. Every insert failed and the error was
-- swallowed, so no leave approval history was ever recorded. Plain text holds any status.
--
-- USING …::text keeps any existing values (there are none in practice — the inserts all failed).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'employeeleavelog' AND column_name = 'status_from' AND data_type = 'USER-DEFINED') THEN
    ALTER TABLE employeeleavelog ALTER COLUMN status_from DROP DEFAULT;
    ALTER TABLE employeeleavelog ALTER COLUMN status_from TYPE VARCHAR(40) USING status_from::text;
    ALTER TABLE employeeleavelog ALTER COLUMN status_from SET DEFAULT 'Pending';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'employeeleavelog' AND column_name = 'status_to' AND data_type = 'USER-DEFINED') THEN
    ALTER TABLE employeeleavelog ALTER COLUMN status_to DROP DEFAULT;
    ALTER TABLE employeeleavelog ALTER COLUMN status_to TYPE VARCHAR(40) USING status_to::text;
    ALTER TABLE employeeleavelog ALTER COLUMN status_to SET DEFAULT 'Pending';
  END IF;
END $$;
