-- Performance Codes (positions) + staff occupancy assignments. Idempotent.

CREATE TABLE IF NOT EXISTS pccodes (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(12) NOT NULL,
  name VARCHAR(150) NOT NULL,
  reportstoid BIGINT,
  isactive BOOLEAN NOT NULL DEFAULT TRUE,
  createdat TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedat TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS pccodes_code_key ON pccodes(code);
CREATE INDEX IF NOT EXISTS pccodes_reportsto_idx ON pccodes(reportstoid);

CREATE TABLE IF NOT EXISTS pccodeassignments (
  id BIGSERIAL PRIMARY KEY,
  pccodeid BIGINT NOT NULL,
  employeeid BIGINT NOT NULL,
  startdate DATE NOT NULL DEFAULT CURRENT_DATE,
  enddate DATE,
  createdat TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pccodeassignments_pccode_idx ON pccodeassignments(pccodeid);
CREATE INDEX IF NOT EXISTS pccodeassignments_employee_idx ON pccodeassignments(employeeid);

-- RM/RO tag on employee (nullable; enforced required at app layer on create).
ALTER TABLE employee ADD COLUMN IF NOT EXISTS rmrotype VARCHAR(2);

-- Seed the root position once (12-digit code scheme).
INSERT INTO pccodes (code, name, reportstoid, isactive, createdat, updatedat)
SELECT '000000000000', 'Root', NULL, TRUE, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM pccodes WHERE reportstoid IS NULL);

INSERT INTO permissions (name, guard_name, created_at, updated_at) VALUES
  ('view_pc_code', 'api', NOW(), NOW()),
  ('create_pc_code', 'api', NOW(), NOW()),
  ('edit_pc_code', 'api', NOW(), NOW()),
  ('delete_pc_code', 'api', NOW(), NOW()),
  ('assign_pc_code', 'api', NOW(), NOW())
ON CONFLICT (name, guard_name) DO NOTHING;

INSERT INTO role_has_permissions (permission_id, role_id)
SELECT p.id, r.id
FROM permissions p
JOIN roles r ON r.name IN ('super-admin', 'admin', 'hr-manager') AND r.guard_name = 'api'
WHERE p.name IN ('view_pc_code', 'create_pc_code', 'edit_pc_code', 'delete_pc_code', 'assign_pc_code')
  AND p.guard_name = 'api'
ON CONFLICT (permission_id, role_id) DO NOTHING;
