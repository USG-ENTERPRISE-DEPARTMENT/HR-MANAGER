CREATE TABLE IF NOT EXISTS employeeapprovalstages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  employee_id BIGINT NOT NULL,
  request_type VARCHAR(40) NOT NULL,
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
  INDEX employeeapprovalstages_employee_id_stage_order_idx (employee_id, stage_order),
  INDEX employeeapprovalstages_status_idx (status)
);
