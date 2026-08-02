-- Postgres counterpart of 20260802_payroll_api_access_log.mysql.sql — see that file for why this
-- table exists. Same columns and indexes; BIGSERIAL replaces AUTO_INCREMENT, INTEGER replaces INT,
-- and indexes are separate statements rather than inline INDEX clauses.

CREATE TABLE IF NOT EXISTS payroll_api_access_log (
  id BIGSERIAL PRIMARY KEY,
  employee BIGINT,                            -- caller's numeric employee id (NULL if unresolved)
  employee_code VARCHAR(20),                  -- staff-facing code as resolved at call time
  employee_name VARCHAR(200),                 -- denormalised: survives later renames
  reference VARCHAR(100),                     -- the GL reference that was requested
  payroll_run BIGINT,                         -- resolved run id, NULL when the lookup missed
  outcome VARCHAR(20) NOT NULL,               -- ok | not_found | bad_request
  employee_count INTEGER,                     -- rows returned, so payload size is visible
  ip VARCHAR(45),
  user_agent VARCHAR(255),
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS payroll_api_access_log_employee_idx
  ON payroll_api_access_log (employee, created_at);
CREATE INDEX IF NOT EXISTS payroll_api_access_log_reference_idx
  ON payroll_api_access_log (reference);
CREATE INDEX IF NOT EXISTS payroll_api_access_log_created_at_idx
  ON payroll_api_access_log (created_at);
