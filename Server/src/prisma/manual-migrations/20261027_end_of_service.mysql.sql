-- End of Service Benefit. See 20261027_end_of_service.postgres.sql for what each table holds.
-- CREATE TABLE / INSERT IGNORE are safe to re-run; the CREATE INDEX lines fail with "Duplicate key
-- name" on a re-run, which is harmless.

CREATE TABLE IF NOT EXISTS eos_bands (
  id            BIGINT        NOT NULL PRIMARY KEY,
  up_to_years   INT           NULL,
  days_per_year DECIMAL(8,2)  NOT NULL,
  updated_by    BIGINT        NULL,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO eos_bands (id, up_to_years, days_per_year)
SELECT v.id, v.up_to_years, v.days_per_year
FROM (SELECT 1 AS id, 3 AS up_to_years, 30 AS days_per_year
      UNION ALL SELECT 2, 6, 33 UNION ALL SELECT 3, 9, 36
      UNION ALL SELECT 4, 12, 39 UNION ALL SELECT 5, NULL, 42) v
WHERE NOT EXISTS (SELECT 1 FROM eos_bands);

CREATE TABLE IF NOT EXISTS eos_pf_list (
  id         BIGINT        NOT NULL PRIMARY KEY,
  employee   BIGINT        NOT NULL,
  amount     DECIMAL(14,2) NOT NULL,
  note       VARCHAR(255)  NULL,
  updated_by BIGINT        NULL,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY eos_pf_list_employee_key (employee)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eos_settlements (
  id                BIGINT        NOT NULL PRIMARY KEY,
  settlement_number VARCHAR(20)   NOT NULL,
  employee          BIGINT        NOT NULL,
  exit_reason       VARCHAR(50)   NOT NULL,
  notified_date     DATE          NULL,
  effective_date    DATE          NOT NULL,
  hire_date         DATE          NULL,
  service_years     INT           NOT NULL DEFAULT 0,
  service_months    INT           NOT NULL DEFAULT 0,
  counted_years     INT           NOT NULL DEFAULT 0,
  days_per_year     DECIMAL(8,2)  NOT NULL DEFAULT 0,
  divisor           DECIMAL(8,2)  NOT NULL DEFAULT 261,
  annual_gross      DECIMAL(14,2) NOT NULL DEFAULT 0,
  gross_overridden  TINYINT(1)    NOT NULL DEFAULT 0,
  eligible          TINYINT(1)    NOT NULL DEFAULT 1,
  eosb_amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_additions   DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_deductions  DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  notice_given      TINYINT(1)    NOT NULL DEFAULT 1,
  salary_paid       TINYINT(1)    NOT NULL DEFAULT 0,
  leave_paid        TINYINT(1)    NOT NULL DEFAULT 0,
  rent_paid         TINYINT(1)    NOT NULL DEFAULT 1,
  clothing_paid     TINYINT(1)    NOT NULL DEFAULT 0,
  account_no        VARCHAR(50)   NULL,
  branch            VARCHAR(100)  NULL,
  next_of_kin       VARCHAR(150)  NULL,
  notes             TEXT          NULL,
  status            VARCHAR(30)   NOT NULL DEFAULT 'Draft',
  created_by        BIGINT        NULL,
  submitted_at      DATETIME      NULL,
  approved_by       BIGINT        NULL,
  approved_at       DATETIME      NULL,
  rejection_reason  VARCHAR(500)  NULL,
  document_ref      VARCHAR(100)  NULL,
  payment_log       TEXT          NULL,
  posted_at         DATETIME      NULL,
  exit_applied_at   DATETIME      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY eos_settlements_number_key (settlement_number),
  KEY eos_settlements_employee_idx (employee),
  KEY eos_settlements_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eos_settlement_lines (
  id            BIGINT        NOT NULL PRIMARY KEY,
  settlement_id BIGINT        NOT NULL,
  line_type     VARCHAR(10)   NOT NULL,
  item_code     VARCHAR(30)   NOT NULL,
  description   VARCHAR(255)  NOT NULL,
  basis         VARCHAR(255)  NULL,
  amount        DECIMAL(14,2) NOT NULL,
  gl_account    VARCHAR(50)   NULL,
  sort_order    INT           NOT NULL DEFAULT 0,
  KEY eos_settlement_lines_settlement_idx (settlement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eos_settlement_stages (
  id             BIGINT       NOT NULL PRIMARY KEY,
  settlement_id  BIGINT       NOT NULL,
  stage_order    INT          NOT NULL,
  stage_name     VARCHAR(100) NOT NULL,
  approver_type  VARCHAR(10)  NOT NULL,
  approver_id    VARCHAR(50)  NOT NULL,
  approver_label VARCHAR(150) NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'Pending',
  acted_by       BIGINT       NULL,
  acted_at       DATETIME     NULL,
  comment        VARCHAR(500) NULL,
  KEY eos_settlement_stages_settlement_idx (settlement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eos_log (
  id            BIGINT       NOT NULL PRIMARY KEY,
  settlement_id BIGINT       NOT NULL,
  user_id       BIGINT       NULL,
  action        VARCHAR(500) NOT NULL,
  status_from   VARCHAR(30)  NULL,
  status_to     VARCHAR(30)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY eos_log_settlement_idx (settlement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (name, guard_name, created_at, updated_at) VALUES
  ('view_end_of_service',    'api', NOW(), NOW()),
  ('approve_end_of_service', 'api', NOW(), NOW()),
  ('manage_end_of_service',  'api', NOW(), NOW());

INSERT IGNORE INTO role_has_permissions (permission_id, role_id)
SELECT p.id, r.id
FROM permissions p
JOIN roles r ON r.name IN ('super-admin', 'admin', 'hr-manager') AND r.guard_name = 'api'
WHERE p.name IN ('view_end_of_service', 'approve_end_of_service', 'manage_end_of_service')
  AND p.guard_name = 'api';
