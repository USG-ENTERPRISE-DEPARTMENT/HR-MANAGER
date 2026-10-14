-- Outbox for emailing payslips when a payroll run is completed. Idempotent.
--
-- Completing a run only INSERTS rows here; helpers/payslipMailer.js sends them in the background, so
-- a slow or failing mail server can never block or roll back the payroll itself.
--
-- status: pending → sending → sent | failed | skipped
--   * UNIQUE (run_id, employee_id) makes enqueueing idempotent: re-confirming a run, a double click
--     or a retry never emails anyone twice.
--   * `sending` + claimed_at lets a worker claim a row atomically and lets a crashed claim be
--     recovered after a timeout.
--   * next_attempt_at drives retry back-off; attempts/last_error record why a send failed.

CREATE TABLE IF NOT EXISTS payslip_email_queue (
  id              BIGSERIAL PRIMARY KEY,
  run_id          BIGINT       NOT NULL,
  employee_id     BIGINT       NOT NULL,
  email           VARCHAR(150),
  status          VARCHAR(10)  NOT NULL DEFAULT 'pending',
  attempts        INT          NOT NULL DEFAULT 0,
  last_error      VARCHAR(500),
  next_attempt_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at      TIMESTAMP(0),
  sent_at         TIMESTAMP(0),
  created_at      TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payslip_email_queue_run_employee_key UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS payslip_email_queue_due_idx ON payslip_email_queue (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS payslip_email_queue_run_idx ON payslip_email_queue (run_id);
