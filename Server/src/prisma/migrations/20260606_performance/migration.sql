CREATE TABLE IF NOT EXISTS performance_cycle (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(150) NOT NULL,
  type             VARCHAR(30)  NOT NULL DEFAULT 'Annual',
  period_start     DATE         NOT NULL,
  period_end       DATE         NOT NULL,
  self_due         DATE         NULL,
  supervisor_due   DATE         NULL,
  hr_due           DATE         NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'Draft',
  notes            TEXT         NULL,
  created_by       BIGINT       NULL,
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_review (
  id                  BIGINT       AUTO_INCREMENT PRIMARY KEY,
  cycle_id            BIGINT       NOT NULL,
  employee            BIGINT       NOT NULL,
  supervisor          BIGINT       NULL,
  hr_reviewer         BIGINT       NULL,
  status              VARCHAR(30)  NOT NULL DEFAULT 'Not Started',
  self_score          DECIMAL(4,2) NULL,
  self_comments       TEXT         NULL,
  self_submitted      DATETIME     NULL,
  supervisor_score    DECIMAL(4,2) NULL,
  supervisor_comments TEXT         NULL,
  supervisor_reviewed DATETIME     NULL,
  strengths           TEXT         NULL,
  improvements        TEXT         NULL,
  hr_score            DECIMAL(4,2) NULL,
  hr_comments         TEXT         NULL,
  hr_reviewed         DATETIME     NULL,
  overall_score       DECIMAL(4,2) NULL,
  development_plan    TEXT         NULL,
  created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_review (cycle_id, employee)
);

CREATE TABLE IF NOT EXISTS performance_goal (
  id            BIGINT       AUTO_INCREMENT PRIMARY KEY,
  employee      BIGINT       NOT NULL,
  cycle_id      BIGINT       NULL,
  title         VARCHAR(200) NOT NULL,
  description   TEXT         NULL,
  weight        INT          NULL,
  target        VARCHAR(300) NULL,
  progress_note TEXT         NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'Active',
  due_date      DATE         NULL,
  achievement   VARCHAR(30)  NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_competency (
  id          BIGINT       AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  category    VARCHAR(100) NOT NULL,
  description TEXT         NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS performance_comp_rating (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  review_id          BIGINT NOT NULL,
  competency_id      BIGINT NOT NULL,
  self_rating        INT    NULL,
  supervisor_rating  INT    NULL,
  hr_rating          INT    NULL,
  self_comment       TEXT   NULL,
  supervisor_comment TEXT   NULL,
  hr_comment         TEXT   NULL
);
