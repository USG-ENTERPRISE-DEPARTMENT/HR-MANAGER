CREATE TABLE IF NOT EXISTS employeetransfers (
  id BIGINT NOT NULL AUTO_INCREMENT,
  transfer_number VARCHAR(40) NOT NULL,
  employee BIGINT NOT NULL,
  transfer_type VARCHAR(50) NOT NULL,
  reason TEXT NULL,
  effective_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Draft',
  current_department BIGINT NULL,
  proposed_department BIGINT NULL,
  current_branch BIGINT NULL,
  proposed_branch BIGINT NULL,
  current_unit BIGINT NULL,
  proposed_unit BIGINT NULL,
  current_outlet BIGINT NULL,
  proposed_outlet BIGINT NULL,
  current_job_title VARCHAR(36) NULL,
  proposed_job_title VARCHAR(36) NULL,
  current_supervisor BIGINT NULL,
  proposed_supervisor BIGINT NULL,
  current_paygrade BIGINT NULL,
  proposed_paygrade BIGINT NULL,
  current_notch BIGINT NULL,
  proposed_notch BIGINT NULL,
  current_values LONGTEXT NULL,
  proposed_values LONGTEXT NULL,
  supporting_document VARCHAR(255) NULL,
  initiated_by BIGINT NULL,
  submitted_at DATETIME NULL,
  approved_at DATETIME NULL,
  effective_at DATETIME NULL,
  rejected_reason TEXT NULL,
  cancelled_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY employeetransfers_transfer_number_key (transfer_number),
  KEY employeetransfers_employee_idx (employee),
  KEY employeetransfers_status_idx (status),
  KEY employeetransfers_effective_date_idx (effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE employeetransfers ADD COLUMN IF NOT EXISTS current_values LONGTEXT NULL;
ALTER TABLE employeetransfers ADD COLUMN IF NOT EXISTS proposed_values LONGTEXT NULL;

CREATE TABLE IF NOT EXISTS employeetransferstages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  transfer_id BIGINT NOT NULL,
  stage_order INT NOT NULL,
  stage_name VARCHAR(100) NOT NULL,
  approver_type VARCHAR(20) NOT NULL,
  approver_id VARCHAR(100) NOT NULL,
  approver_label VARCHAR(150) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  acted_by BIGINT NULL,
  acted_at DATETIME NULL,
  comment VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY employeetransferstages_transfer_order_idx (transfer_id, stage_order),
  KEY employeetransferstages_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (name, guard_name, created_at, updated_at) VALUES
  ('view_employee_transfers', 'api', NOW(), NOW()),
  ('create_employee_transfers', 'api', NOW(), NOW()),
  ('approve_employee_transfers', 'api', NOW(), NOW()),
  ('manage_employee_transfers', 'api', NOW(), NOW());

INSERT IGNORE INTO role_has_permissions (permission_id, role_id)
SELECT p.id, r.id
FROM permissions p
JOIN roles r ON r.name IN ('super-admin', 'admin', 'hr-manager') AND r.guard_name = 'api'
WHERE p.name IN ('view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers')
  AND p.guard_name = 'api';
