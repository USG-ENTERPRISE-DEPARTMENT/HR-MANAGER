ALTER TABLE performance_goal
  ADD COLUMN IF NOT EXISTS comment      TEXT          NULL,
  ADD COLUMN IF NOT EXISTS document_ref VARCHAR(150)  NULL;
