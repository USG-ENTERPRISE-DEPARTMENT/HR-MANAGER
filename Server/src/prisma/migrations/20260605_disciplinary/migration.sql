CREATE TABLE IF NOT EXISTS employee_disciplinary (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  employee       BIGINT NOT NULL,
  incident_date  DATE NOT NULL,
  incident_type  VARCHAR(100) NOT NULL,
  description    TEXT NOT NULL,
  severity       VARCHAR(20) NOT NULL DEFAULT 'Medium',
  action_taken   TEXT NULL,
  witnesses      TEXT NULL,
  status         VARCHAR(30) NOT NULL DEFAULT 'Open',
  resolution     TEXT NULL,
  resolved_date  DATE NULL,
  raised_by      BIGINT NULL,
  raised_by_name VARCHAR(200) NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
