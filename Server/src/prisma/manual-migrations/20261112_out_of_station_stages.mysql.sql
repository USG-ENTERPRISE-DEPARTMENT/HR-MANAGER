-- Out of Station: configurable approval stages. See 20261112_out_of_station_stages.postgres.sql.
-- CREATE TABLE / UPDATE / DELETE are safe to re-run; the CREATE INDEX line fails with "Duplicate key
-- name" on a re-run, which is harmless.

CREATE TABLE IF NOT EXISTS outofstation_stages (
  id             BIGINT       NOT NULL PRIMARY KEY,
  request_id     BIGINT       NOT NULL,
  stage_order    INT          NOT NULL,
  stage_name     VARCHAR(150) NOT NULL,
  approver_type  VARCHAR(10)  NOT NULL,
  approver_id    VARCHAR(64)  NOT NULL,
  approver_label VARCHAR(200) NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'Pending',
  acted_by       BIGINT       NULL,
  acted_at       DATETIME     NULL,
  comment        TEXT         NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX outofstation_stages_request_idx ON outofstation_stages (request_id, stage_order);

UPDATE outofstation_requests SET status = 'Pending Approval' WHERE status = 'Pending HR Approval';

DELETE FROM settings WHERE category = 'out_of_station' AND name = 'oos_supervisor_approval';
