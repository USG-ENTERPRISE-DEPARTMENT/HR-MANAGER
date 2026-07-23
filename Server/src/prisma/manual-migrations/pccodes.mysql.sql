-- Performance Codes (positions) + staff occupancy assignments. Idempotent.

CREATE TABLE IF NOT EXISTS pccodes (
  id BIGINT NOT NULL AUTO_INCREMENT,
  code VARCHAR(12) NOT NULL,
  name VARCHAR(150) NOT NULL,
  reportsToId BIGINT NULL,
  isActive TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY pccodes_code_key (code),
  KEY pccodes_reportsto_idx (reportsToId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pccodeassignments (
  id BIGINT NOT NULL AUTO_INCREMENT,
  pcCodeId BIGINT NOT NULL,
  employeeId BIGINT NOT NULL,
  startDate DATE NOT NULL DEFAULT (CURRENT_DATE),
  endDate DATE NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY pccodeassignments_pccode_idx (pcCodeId),
  KEY pccodeassignments_employee_idx (employeeId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RM/RO tag on employee (nullable; enforced required at app layer on create).
ALTER TABLE employee ADD COLUMN IF NOT EXISTS rmRoType VARCHAR(2) NULL;

-- Seed the root position once (12-digit code scheme).
INSERT INTO pccodes (code, name, reportsToId, isActive, createdAt, updatedAt)
SELECT '000000000000', 'Root', NULL, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM pccodes WHERE reportsToId IS NULL);

INSERT IGNORE INTO permissions (name, guard_name, created_at, updated_at) VALUES
  ('view_pc_code', 'api', NOW(), NOW()),
  ('create_pc_code', 'api', NOW(), NOW()),
  ('edit_pc_code', 'api', NOW(), NOW()),
  ('delete_pc_code', 'api', NOW(), NOW()),
  ('assign_pc_code', 'api', NOW(), NOW());

INSERT IGNORE INTO role_has_permissions (permission_id, role_id)
SELECT p.id, r.id
FROM permissions p
JOIN roles r ON r.name IN ('super-admin', 'admin', 'hr-manager') AND r.guard_name = 'api'
WHERE p.name IN ('view_pc_code', 'create_pc_code', 'edit_pc_code', 'delete_pc_code', 'assign_pc_code')
  AND p.guard_name = 'api';
