ALTER TABLE performance_goal
  ADD COLUMN IF NOT EXISTS actual_result    TEXT         NULL AFTER target,
  ADD COLUMN IF NOT EXISTS employee_score   DECIMAL(5,2) NULL AFTER actual_result,
  ADD COLUMN IF NOT EXISTS supervisor_score DECIMAL(5,2) NULL AFTER employee_score,
  ADD COLUMN IF NOT EXISTS hr_score         DECIMAL(5,2) NULL AFTER supervisor_score;
