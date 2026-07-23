CREATE TABLE IF NOT EXISTS module_settings (
  id         BIGINT       AUTO_INCREMENT PRIMARY KEY,
  module_id  VARCHAR(50)  NOT NULL,
  enabled    TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_module_id (module_id)
);

-- Seed all known modules as enabled (safe to re-run — INSERT IGNORE skips existing rows)
INSERT IGNORE INTO module_settings (module_id, enabled) VALUES
  ('Employees',      1),
  ('LeaveManagement',1),
  ('Payroll',        1),
  ('Insights',       1),
  ('Company',        1),
  ('Recruitment',    1),
  ('Documents',      1),
  ('Admin',          1),
  ('Medical',        1),
  ('Performance',    1),
  ('TravelExpense',  1);
