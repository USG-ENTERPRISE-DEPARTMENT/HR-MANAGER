-- Outbox for emailing payslips when a payroll run is completed. Idempotent.
-- See 20261013_payslip_email_queue.postgres.sql for the design notes.

CREATE TABLE IF NOT EXISTS payslip_email_queue (
  id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id          BIGINT       NOT NULL,
  employee_id     BIGINT       NOT NULL,
  email           VARCHAR(150) NULL,
  status          VARCHAR(10)  NOT NULL DEFAULT 'pending',
  attempts        INT          NOT NULL DEFAULT 0,
  last_error      VARCHAR(500) NULL,
  next_attempt_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at      DATETIME     NULL,
  sent_at         DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY payslip_email_queue_run_employee_key (run_id, employee_id),
  KEY payslip_email_queue_due_idx (status, next_attempt_at),
  KEY payslip_email_queue_run_idx (run_id)
);
