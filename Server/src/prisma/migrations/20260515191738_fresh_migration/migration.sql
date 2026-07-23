/*
  Warnings:

  - You are about to drop the column `meta` on the `permissions` table. All the data in the column will be lost.
  - You are about to drop the column `module_id` on the `permissions` table. All the data in the column will be lost.
  - You are about to drop the column `permission` on the `permissions` table. All the data in the column will be lost.
  - You are about to drop the column `user_level` on the `permissions` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `permissions` table. All the data in the column will be lost.
  - You are about to drop the column `default_module` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `googleUserData` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `lang` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `login_hash` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `user_level` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `user_roles` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name,guard_name]` on the table `permissions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `guard_name` to the `permissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `permissions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `permissions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `permissions` DROP COLUMN `meta`,
    DROP COLUMN `module_id`,
    DROP COLUMN `permission`,
    DROP COLUMN `user_level`,
    DROP COLUMN `value`,
    ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `guard_name` VARCHAR(255) NOT NULL,
    ADD COLUMN `name` VARCHAR(255) NOT NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL,
    MODIFY `id` BIGINT NOT NULL AUTO_INCREMENT,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `users` DROP COLUMN `default_module`,
    DROP COLUMN `email`,
    DROP COLUMN `googleUserData`,
    DROP COLUMN `lang`,
    DROP COLUMN `login_hash`,
    DROP COLUMN `user_level`,
    DROP COLUMN `user_roles`;

-- CreateTable
CREATE TABLE `roles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `guard_name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `status` CHAR(1) NOT NULL DEFAULT '1',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_name_guard_name_unique`(`name`, `guard_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_has_permissions` (
    `permission_id` BIGINT NOT NULL,
    `role_id` BIGINT NOT NULL,

    INDEX `role_has_permissions_role_id_fk`(`role_id`),
    PRIMARY KEY (`permission_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_has_permissions` (
    `permission_id` BIGINT NOT NULL,
    `model_type` VARCHAR(255) NOT NULL,
    `model_id` VARCHAR(191) NOT NULL,

    INDEX `model_has_permissions_model_id_model_type_index`(`model_id`, `model_type`),
    PRIMARY KEY (`permission_id`, `model_id`, `model_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_has_roles` (
    `role_id` BIGINT NOT NULL,
    `model_type` VARCHAR(255) NOT NULL,
    `model_id` VARCHAR(191) NOT NULL,

    INDEX `model_has_roles_model_id_model_type_index`(`model_id`, `model_type`),
    PRIMARY KEY (`role_id`, `model_id`, `model_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `permissions_name_guard_name_unique` ON `permissions`(`name`, `guard_name`);

-- AddForeignKey
ALTER TABLE `role_has_permissions` ADD CONSTRAINT `role_has_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `role_has_permissions` ADD CONSTRAINT `role_has_permissions_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `model_has_permissions` ADD CONSTRAINT `model_has_permissions_permission_id_foreign` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `model_has_roles` ADD CONSTRAINT `model_has_roles_role_id_foreign` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
