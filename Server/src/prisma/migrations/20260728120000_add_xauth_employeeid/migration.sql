-- XAuth's authoritative staff identifier. Nullable for existing local/admin accounts;
-- populated for every account that authenticates through XAuth.
ALTER TABLE `users` ADD COLUMN `employeeid` VARCHAR(20) NULL;
CREATE UNIQUE INDEX `users_employeeid_key` ON `users`(`employeeid`);
