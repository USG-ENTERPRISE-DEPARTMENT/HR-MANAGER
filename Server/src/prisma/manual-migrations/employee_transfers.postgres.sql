CREATE TABLE IF NOT EXISTS employeetransfers (
  id BIGSERIAL PRIMARY KEY,
  transfer_number VARCHAR(40) NOT NULL UNIQUE,
  employee BIGINT NOT NULL,
  transfer_type VARCHAR(50) NOT NULL,
  reason TEXT,
  effective_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Draft',
  current_department BIGINT,
  proposed_department BIGINT,
  current_branch BIGINT,
  proposed_branch BIGINT,
  current_unit BIGINT,
  proposed_unit BIGINT,
  current_outlet BIGINT,
  proposed_outlet BIGINT,
  current_job_title VARCHAR(36),
  proposed_job_title VARCHAR(36),
  current_supervisor BIGINT,
  proposed_supervisor BIGINT,
  current_paygrade BIGINT,
  proposed_paygrade BIGINT,
  current_notch BIGINT,
  proposed_notch BIGINT,
  current_values TEXT,
  proposed_values TEXT,
  supporting_document VARCHAR(255),
  initiated_by BIGINT,
  submitted_at TIMESTAMP(0),
  approved_at TIMESTAMP(0),
  effective_at TIMESTAMP(0),
  rejected_reason TEXT,
  cancelled_reason TEXT,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS employeetransfers_employee_idx ON employeetransfers(employee);
CREATE INDEX IF NOT EXISTS employeetransfers_status_idx ON employeetransfers(status);
CREATE INDEX IF NOT EXISTS employeetransfers_effective_date_idx ON employeetransfers(effective_date);

ALTER TABLE employeetransfers ADD COLUMN IF NOT EXISTS current_values TEXT;
ALTER TABLE employeetransfers ADD COLUMN IF NOT EXISTS proposed_values TEXT;

CREATE TABLE IF NOT EXISTS employeetransferstages (
  id BIGSERIAL PRIMARY KEY,
  transfer_id BIGINT NOT NULL,
  stage_order INTEGER NOT NULL,
  stage_name VARCHAR(100) NOT NULL,
  approver_type VARCHAR(20) NOT NULL,
  approver_id VARCHAR(100) NOT NULL,
  approver_label VARCHAR(150),
  status VARCHAR(20) NOT NULL DEFAULT 'Pending',
  acted_by BIGINT,
  acted_at TIMESTAMP(0),
  comment VARCHAR(500),
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS employeetransferstages_transfer_order_idx ON employeetransferstages(transfer_id, stage_order);
CREATE INDEX IF NOT EXISTS employeetransferstages_status_idx ON employeetransferstages(status);

INSERT INTO permissions (name, guard_name, created_at, updated_at) VALUES
  ('view_employee_transfers', 'api', NOW(), NOW()),
  ('create_employee_transfers', 'api', NOW(), NOW()),
  ('approve_employee_transfers', 'api', NOW(), NOW()),
  ('manage_employee_transfers', 'api', NOW(), NOW())
ON CONFLICT (name, guard_name) DO NOTHING;

INSERT INTO role_has_permissions (permission_id, role_id)
SELECT p.id, r.id
FROM permissions p
JOIN roles r ON r.name IN ('super-admin', 'admin', 'hr-manager') AND r.guard_name = 'api'
WHERE p.name IN ('view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers')
  AND p.guard_name = 'api'
ON CONFLICT (permission_id, role_id) DO NOTHING;
