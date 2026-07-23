CREATE TABLE IF NOT EXISTS employeeapprovalstages (
  id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL,
  request_type VARCHAR(40) NOT NULL,
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

CREATE INDEX IF NOT EXISTS employeeapprovalstages_employee_id_stage_order_idx
  ON employeeapprovalstages (employee_id, stage_order);
CREATE INDEX IF NOT EXISTS employeeapprovalstages_status_idx
  ON employeeapprovalstages (status);
