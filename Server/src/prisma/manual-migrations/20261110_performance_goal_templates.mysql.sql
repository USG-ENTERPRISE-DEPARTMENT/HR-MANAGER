-- Goal templates for performance cycles. See 20261110_performance_goal_templates.postgres.sql.
-- Re-running fails with "Duplicate column" / "Duplicate key name" on the ALTER and INDEX lines — harmless.

CREATE TABLE IF NOT EXISTS performance_goal_template (
  id          BIGINT        NOT NULL PRIMARY KEY,
  name        VARCHAR(150)  NOT NULL,
  description TEXT          NULL,
  created_by  BIGINT        NULL,
  created_at  DATETIME(0)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME(0)   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS performance_goal_template_item (
  id          BIGINT        NOT NULL PRIMARY KEY,
  template_id BIGINT        NOT NULL,
  title       VARCHAR(200)  NOT NULL,
  description TEXT          NULL,
  weight      INT           NULL,
  target      VARCHAR(300)  NULL,
  sort_order  INT           NOT NULL DEFAULT 0,
  KEY performance_goal_template_item_template_idx (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE performance_goal ADD COLUMN template_id      BIGINT NULL;
ALTER TABLE performance_goal ADD COLUMN template_item_id BIGINT NULL;
CREATE INDEX performance_goal_template_idx ON performance_goal (template_id, cycle_id);
