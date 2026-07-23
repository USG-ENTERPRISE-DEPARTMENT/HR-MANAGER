-- Admin-editable overrides for system response messages.
CREATE TABLE IF NOT EXISTS `message_overrides` (
  `id`            BIGINT NOT NULL AUTO_INCREMENT,
  `message_key`   VARCHAR(255) NOT NULL,
  `override_text` TEXT NOT NULL,
  `enabled`       BOOLEAN NOT NULL DEFAULT TRUE,
  `updated_at`    DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_message_key` (`message_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
