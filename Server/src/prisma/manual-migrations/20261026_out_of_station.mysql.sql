-- Out of Station allowance. See 20261026_out_of_station.postgres.sql for what each table holds.
-- CREATE TABLE / INSERT IGNORE are safe to re-run; the CREATE INDEX lines fail with "Duplicate key
-- name" on a re-run, which is harmless.

CREATE TABLE IF NOT EXISTS outofstation_rates (
  id          BIGINT        NOT NULL PRIMARY KEY,
  paygrade_id BIGINT        NOT NULL,
  daily_rate  DECIMAL(14,2) NOT NULL,
  updated_by  BIGINT        NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY outofstation_rates_paygrade_key (paygrade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outofstation_requests (
  id               BIGINT        NOT NULL PRIMARY KEY,
  request_number   VARCHAR(20)   NOT NULL,
  employee         BIGINT        NOT NULL,
  purpose          VARCHAR(255)  NOT NULL,
  location         VARCHAR(150)  NOT NULL,
  date_start       DATE          NOT NULL,
  date_end         DATE          NOT NULL,
  days             INT           NOT NULL,
  paygrade_id      BIGINT        NULL,
  daily_rate       DECIMAL(14,2) NOT NULL,
  amount           DECIMAL(14,2) NOT NULL,
  account_no       VARCHAR(50)   NULL,
  branch           VARCHAR(100)  NULL,
  status           VARCHAR(30)   NOT NULL DEFAULT 'Draft',
  approval_level   INT           NOT NULL DEFAULT 0,
  requested_by     BIGINT        NULL,
  submitted_by     BIGINT        NULL,
  submitted_at     DATETIME      NULL,
  approved_by      BIGINT        NULL,
  approved_at      DATETIME      NULL,
  rejection_reason VARCHAR(500)  NULL,
  document_ref     VARCHAR(100)  NULL,
  payment_log      TEXT          NULL,
  posted_at        DATETIME      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY outofstation_requests_number_key (request_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX outofstation_requests_employee_idx ON outofstation_requests (employee);
CREATE INDEX outofstation_requests_status_idx   ON outofstation_requests (status);
CREATE INDEX outofstation_requests_dates_idx    ON outofstation_requests (date_start, date_end);

CREATE TABLE IF NOT EXISTS outofstation_log (
  id          BIGINT       NOT NULL PRIMARY KEY,
  request_id  BIGINT       NOT NULL,
  user_id     BIGINT       NULL,
  action      VARCHAR(500) NOT NULL,
  status_from VARCHAR(30)  NULL,
  status_to   VARCHAR(30)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY outofstation_log_request_idx (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (name, guard_name, created_at, updated_at) VALUES
  ('view_out_of_station',    'api', NOW(), NOW()),
  ('approve_out_of_station', 'api', NOW(), NOW()),
  ('manage_out_of_station',  'api', NOW(), NOW());

INSERT IGNORE INTO role_has_permissions (permission_id, role_id)
SELECT p.id, r.id
FROM permissions p
JOIN roles r ON r.name IN ('super-admin', 'admin', 'hr-manager') AND r.guard_name = 'api'
WHERE p.name IN ('view_out_of_station', 'approve_out_of_station', 'manage_out_of_station')
  AND p.guard_name = 'api';
