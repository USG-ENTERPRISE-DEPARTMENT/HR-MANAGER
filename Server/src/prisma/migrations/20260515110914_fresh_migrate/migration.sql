-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NULL,
    `email` VARCHAR(100) NULL,
    `password` VARCHAR(100) NULL,
    `employee` BIGINT NULL,
    `default_module` BIGINT NULL,
    `user_level` ENUM('Admin', 'Employee', 'Manager', 'Restricted Admin', 'Restricted Manager', 'Restricted Employee') NULL,
    `user_roles` TEXT NULL,
    `last_login` DATETIME(0) NULL,
    `last_update` DATETIME(0) NULL,
    `created` DATETIME(0) NULL,
    `login_hash` VARCHAR(64) NULL,
    `lang` BIGINT NULL,
    `googleUserData` TEXT NULL,
    `wrong_password_count` INTEGER NULL DEFAULT 0,
    `last_wrong_attempt_at` DATETIME(0) NULL,
    `last_password_requested_at` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` BIGINT NOT NULL,
    `user_level` ENUM('Admin', 'Employee', 'Manager') NULL,
    `module_id` BIGINT NOT NULL,
    `permission` VARCHAR(200) NULL,
    `meta` VARCHAR(500) NULL,
    `value` VARCHAR(200) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `annualrent` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(20) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `applications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `job` BIGINT NOT NULL,
    `candidate` BIGINT NULL,
    `created` DATETIME(0) NULL,
    `referredByEmail` VARCHAR(200) NULL,
    `notes` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `archivedemployees` (
    `id` BIGINT NOT NULL,
    `ref_id` BIGINT NOT NULL,
    `employee_id` VARCHAR(50) NULL,
    `first_name` VARCHAR(100) NOT NULL DEFAULT '',
    `last_name` VARCHAR(100) NOT NULL DEFAULT '',
    `gender` VARCHAR(15) NULL,
    `ssn_num` VARCHAR(100) NULL DEFAULT '',
    `nic_num` VARCHAR(100) NULL DEFAULT '',
    `other_id` VARCHAR(100) NULL DEFAULT '',
    `work_email` VARCHAR(100) NULL,
    `joined_date` DATETIME(0) NULL,
    `confirmation_date` DATETIME(0) NULL,
    `supervisor` BIGINT NULL,
    `department` BIGINT NULL,
    `termination_date` DATETIME(0) NULL,
    `notes` TEXT NULL,
    `data` LONGTEXT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assettypes` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(35) NOT NULL,
    `description` TEXT NULL,
    `attachment` VARCHAR(100) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `department` VARCHAR(100) NOT NULL,
    `isInvalid` INTEGER NULL,
    `iAttState` INTEGER NULL,
    `iVerifyMethod` INTEGER NULL,
    `date` DATE NULL,
    `time` TIME(0) NULL,
    `time_stamp` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `in_time` DATETIME(0) NULL,
    `out_time` DATETIME(0) NULL,
    `note` VARCHAR(500) NULL,
    `image_in` LONGTEXT NULL,
    `image_out` LONGTEXT NULL,
    `map_lat` DECIMAL(10, 8) NULL,
    `map_lng` DECIMAL(10, 8) NULL,
    `map_snapshot` LONGTEXT NULL,
    `map_out_lat` DECIMAL(10, 8) NULL,
    `map_out_lng` DECIMAL(10, 8) NULL,
    `map_out_snapshot` LONGTEXT NULL,
    `in_ip` VARCHAR(25) NULL,
    `out_ip` VARCHAR(25) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auditlog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `time` DATETIME(0) NULL,
    `user` BIGINT NOT NULL,
    `ip` VARCHAR(100) NULL,
    `type` VARCHAR(100) NOT NULL,
    `employee` VARCHAR(300) NULL,
    `full_name` VARCHAR(50) NULL,
    `department` VARCHAR(300) NULL,
    `details` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `benifits` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(250) NOT NULL DEFAULT ''
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calls` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `job` BIGINT NOT NULL,
    `candidate` BIGINT NULL,
    `phone` VARCHAR(20) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `status` VARCHAR(100) NULL,
    `notes` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `first_name` VARCHAR(100) NOT NULL DEFAULT '',
    `middle_name` VARCHAR(50) NULL,
    `last_name` VARCHAR(100) NOT NULL DEFAULT '',
    `nationality` BIGINT NULL,
    `birthday` DATETIME(0) NULL,
    `gender` VARCHAR(15) NULL,
    `marital_status` ENUM('Married', 'Single', 'Divorced', 'Widowed', 'Other') NULL,
    `address1` VARCHAR(100) NULL DEFAULT '',
    `address2` VARCHAR(100) NULL DEFAULT '',
    `city` VARCHAR(150) NULL DEFAULT '',
    `country` CHAR(2) NULL,
    `province` BIGINT NULL,
    `postal_code` VARCHAR(20) NULL,
    `email` VARCHAR(200) NULL,
    `home_phone` VARCHAR(50) NULL,
    `mobile_phone` VARCHAR(50) NULL,
    `cv_title` VARCHAR(200) NOT NULL DEFAULT '',
    `cv` VARCHAR(150) NULL,
    `cvtext` TEXT NULL,
    `industry` TEXT NULL,
    `profileImage` VARCHAR(150) NULL,
    `head_line` TEXT NULL,
    `objective` TEXT NULL,
    `work_history` TEXT NULL,
    `health_history` TEXT NULL,
    `education` TEXT NULL,
    `skills` TEXT NULL,
    `referees` TEXT NULL,
    `linkedInUrl` VARCHAR(500) NULL,
    `linkedInData` TEXT NULL,
    `totalYearsOfExperience` INTEGER NULL,
    `totalMonthsOfExperience` INTEGER NULL,
    `htmlCVData` LONGTEXT NULL,
    `generatedCVFile` VARCHAR(150) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `expectedSalary` INTEGER NULL,
    `preferedPositions` TEXT NULL,
    `preferedJobtype` VARCHAR(60) NULL,
    `preferedCountries` TEXT NULL,
    `tags` TEXT NULL,
    `notes` TEXT NULL,
    `calls` TEXT NULL,
    `age` INTEGER NULL,
    `hash` VARCHAR(100) NULL,
    `linkedInProfileLink` VARCHAR(250) NULL,
    `linkedInProfileId` VARCHAR(50) NULL,
    `facebookProfileLink` VARCHAR(250) NULL,
    `facebookProfileId` VARCHAR(50) NULL,
    `twitterProfileLink` VARCHAR(250) NULL,
    `twitterProfileId` VARCHAR(50) NULL,
    `googleProfileLink` VARCHAR(250) NULL,
    `googleProfileId` VARCHAR(50) NULL,
    `hiringStage` BIGINT NULL,
    `jobId` BIGINT NULL,
    `source` ENUM('Sourced', 'Applied') NULL DEFAULT 'Sourced',
    `emailSent` INTEGER NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NULL,
    `description` VARCHAR(400) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clients` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `first_contact_date` DATE NULL,
    `created` DATETIME(0) NULL,
    `address` TEXT NULL,
    `contact_number` VARCHAR(25) NULL,
    `contact_email` VARCHAR(100) NULL,
    `company_url` VARCHAR(500) NULL,
    `status` ENUM('Active', 'Inactive') NULL DEFAULT 'Active',
    `code` VARCHAR(20) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companyassets` (
    `id` BIGINT NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `type` BIGINT NULL,
    `attachment` VARCHAR(100) NULL,
    `employee` BIGINT NULL,
    `department` BIGINT NULL,
    `description` TEXT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companydocuments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `valid_until` DATE NULL,
    `status` ENUM('Active', 'Inactive', 'Draft') NULL DEFAULT 'Active',
    `notify_employees` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `attachment` VARCHAR(100) NULL,
    `share_departments` VARCHAR(100) NULL,
    `share_employees` VARCHAR(100) NULL,
    `share_userlevel` VARCHAR(100) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companyloans` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companystructures` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` TINYTEXT NOT NULL,
    `comp_code` VARCHAR(20) NULL,
    `description` VARCHAR(100) NOT NULL,
    `address` TEXT NULL,
    `type` ENUM('Head Office', 'Branch', 'Department', 'Unit', 'Outlet', 'Other') NULL,
    `country` VARCHAR(2) NOT NULL DEFAULT '0',
    `parent2` BIGINT NULL,
    `parent` VARCHAR(20) NULL,
    `timezone` VARCHAR(100) NOT NULL DEFAULT 'Europe/London',
    `comp_reg` VARCHAR(50) NULL,
    `heads` VARCHAR(255) NULL,
    `nassit` VARCHAR(50) NULL,
    `tin` VARCHAR(50) NULL,
    `ref` VARCHAR(10) NULL,
    `posting_date` DATE NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approval_status` VARCHAR(20) NULL,

    UNIQUE INDEX `comp_code`(`comp_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `message` LONGTEXT NOT NULL,
    `type` VARCHAR(35) NOT NULL,
    `attachment` VARCHAR(100) NULL,
    `employee` BIGINT NOT NULL,
    `target` BIGINT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `timeint` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversationuserstatus` (
    `id` BIGINT NOT NULL,
    `employee` BIGINT NOT NULL,
    `status` VARCHAR(15) NULL,
    `seen_at` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `country` (
    `id` BIGINT NOT NULL,
    `code` CHAR(2) NOT NULL DEFAULT '',
    `namecap` VARCHAR(80) NULL DEFAULT '',
    `name` VARCHAR(80) NOT NULL DEFAULT '',
    `iso3` CHAR(3) NULL,
    `numcode` SMALLINT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `courses` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(300) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `category` VARCHAR(50) NULL,
    `description` TEXT NULL,
    `coordinator` BIGINT NULL,
    `trainer` VARCHAR(300) NULL,
    `trainer_info` TEXT NULL,
    `paymentType` ENUM('Company Sponsored', 'Paid by Employee') NULL DEFAULT 'Company Sponsored',
    `currency` VARCHAR(3) NULL,
    `cost` DECIMAL(12, 2) NULL DEFAULT 0.00,
    `status` ENUM('Active', 'Inactive') NULL DEFAULT 'Active',
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crons` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `class` VARCHAR(100) NOT NULL,
    `lastrun` DATETIME(0) NULL,
    `frequency` INTEGER NOT NULL,
    `time` VARCHAR(50) NOT NULL,
    `type` ENUM('Minutely', 'Hourly', 'Daily', 'Weekly', 'Monthly', 'Yearly') NULL DEFAULT 'Hourly',
    `status` ENUM('Enabled', 'Disabled') NULL DEFAULT 'Enabled'
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `currencytypes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(3) NOT NULL DEFAULT '',
    `name` VARCHAR(70) NOT NULL DEFAULT '',
    `numeric_code` BIGINT NULL,
    `xcg_rate` DECIMAL(20, 2) NULL DEFAULT 0.00,
    `imprest_gl` VARCHAR(50) NULL,
    `imprest_contra` VARCHAR(50) NULL,
    `description` VARCHAR(50) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customfields` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(20) NOT NULL,
    `name` VARCHAR(20) NOT NULL,
    `data` TEXT NULL,
    `display` ENUM('Form', 'Table and Form', 'Hidden') NULL DEFAULT 'Form',
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `field_type` VARCHAR(20) NULL,
    `field_label` VARCHAR(50) NULL,
    `field_validation` VARCHAR(50) NULL,
    `field_options` VARCHAR(500) NULL,
    `display_order` INTEGER NULL DEFAULT 0,
    `display_section` VARCHAR(50) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customfieldvalues` (
    `id` BIGINT NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `object_id` VARCHAR(60) NOT NULL,
    `value` TEXT NULL,
    `updated` DATETIME(0) NULL,
    `created` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dataentrybackups` (
    `id` BIGINT NOT NULL,
    `tableType` VARCHAR(200) NULL,
    `data` LONGTEXT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dataimport` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `dataType` VARCHAR(60) NOT NULL,
    `details` TEXT NULL,
    `columns` TEXT NULL,
    `updated` DATETIME(0) NULL,
    `created` DATETIME(0) NULL,
    `objectType` VARCHAR(60) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dataimportfiles` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `data_import_definition` VARCHAR(200) NOT NULL,
    `status` VARCHAR(15) NULL,
    `file` VARCHAR(100) NULL,
    `details` TEXT NULL,
    `updated` DATETIME(0) NULL,
    `created` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deductiongroup` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deductions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `deduct_gl` VARCHAR(50) NULL,
    `componentType` VARCHAR(250) NULL,
    `component` VARCHAR(250) NULL,
    `payrollColumn` INTEGER NULL,
    `rangeAmounts` TEXT NULL,
    `deduction_group` BIGINT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `expire_notification` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `expire_notification_month` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `expire_notification_week` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `expire_notification_day` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `sign` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `sign_label` VARCHAR(500) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `share_with_employee` ENUM('Yes', 'No') NULL DEFAULT 'Yes',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `educationlevel` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(250) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `educations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NULL,
    `description` VARCHAR(400) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emails` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `subject` VARCHAR(300) NOT NULL,
    `toEmail` VARCHAR(300) NOT NULL,
    `template` TEXT NULL,
    `params` TEXT NULL,
    `cclist` VARCHAR(500) NULL,
    `bcclist` VARCHAR(500) NULL,
    `error` VARCHAR(500) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `status` ENUM('Pending', 'Sent', 'Error') NULL DEFAULT 'Pending',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emergencycontacts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `relationship` VARCHAR(100) NULL,
    `home_phone` VARCHAR(15) NULL,
    `work_phone` VARCHAR(15) NULL,
    `mobile_phone` VARCHAR(15) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeapprovals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(100) NOT NULL,
    `element` BIGINT NOT NULL,
    `approver` BIGINT NULL,
    `level` INTEGER NULL DEFAULT 0,
    `status` INTEGER NULL DEFAULT 0,
    `active` INTEGER NULL DEFAULT 0,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeattendancesheets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `date_start` DATE NOT NULL,
    `date_end` DATE NOT NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Submitted') NULL DEFAULT 'Pending',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeecertifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `certification_id` BIGINT NULL,
    `employee` BIGINT NOT NULL,
    `institute` VARCHAR(400) NULL,
    `date_start` DATE NULL,
    `date_end` DATE NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeecompanyloans` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `loan` BIGINT NULL,
    `start_date` DATE NOT NULL,
    `last_installment_date` DATE NOT NULL,
    `period_months` BIGINT NULL,
    `currency` BIGINT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `monthly_installment` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('Approved', 'Repayment', 'Paid', 'Suspended') NULL DEFAULT 'Approved',
    `details` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeedatahistory` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(100) NOT NULL,
    `employee` BIGINT NOT NULL,
    `field` VARCHAR(100) NOT NULL,
    `old_value` VARCHAR(500) NULL,
    `new_value` VARCHAR(500) NULL,
    `description` VARCHAR(800) NULL,
    `user` BIGINT NULL,
    `updated` DATETIME(0) NULL,
    `created` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeedependents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `gender` TEXT NULL,
    `place_of_birth` VARCHAR(30) NULL,
    `address` INTEGER NULL,
    `relationship` ENUM('Child', 'Spouse', 'Parent', 'Other') NULL,
    `dob` DATE NULL,
    `id_number` VARCHAR(25) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeedocuments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `document` BIGINT NULL,
    `date_added` DATE NOT NULL,
    `valid_until` DATE NULL,
    `status` ENUM('Active', 'Inactive', 'Draft') NULL DEFAULT 'Active',
    `details` TEXT NULL,
    `attachment` VARCHAR(100) NULL,
    `place_of_issue` VARCHAR(50) NULL,
    `signature` TEXT NULL,
    `expire_notification_last` INTEGER NULL,
    `visible_to` ENUM('Owner', 'Manager', 'Admin') NULL DEFAULT 'Owner',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeeducations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `education_id` BIGINT NULL,
    `employee` BIGINT NOT NULL,
    `institute` VARCHAR(400) NULL,
    `date_start` DATE NULL,
    `date_end` DATE NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeethnicity` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `ethnicity` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeexpenses` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `expense_date` DATE NULL,
    `emp_acc_no` VARCHAR(50) NULL,
    `cost_unit` VARCHAR(50) NULL,
    `cost_dept` VARCHAR(50) NULL,
    `branch` VARCHAR(50) NULL,
    `business_purpose` VARCHAR(50) NULL,
    `description` VARCHAR(100) NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `items` VARCHAR(5000) NULL,
    `payment_method` BIGINT NULL,
    `ref_no` VARCHAR(50) NOT NULL,
    `payee` VARCHAR(500) NULL,
    `category` BIGINT NULL,
    `nontes` TEXT NULL,
    `notes` TEXT NULL,
    `amount` DECIMAL(10, 2) NULL,
    `currency` VARCHAR(20) NULL DEFAULT 'GHS',
    `attachment1` VARCHAR(100) NULL,
    `attachment2` VARCHAR(100) NULL,
    `attachment3` VARCHAR(100) NULL,
    `app_type` VARCHAR(10) NOT NULL DEFAULT 'EXP',
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `documentRef` VARCHAR(50) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeexperience` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `organisation` VARCHAR(20) NOT NULL,
    `date_start` DATE NOT NULL,
    `date_end` DATE NOT NULL,
    `position_held` VARCHAR(20) NOT NULL,
    `salary` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeforms` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `form` BIGINT NOT NULL,
    `status` ENUM('Pending', 'Completed') NULL DEFAULT 'Pending',
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeimmigrations` (
    `id` BIGINT NOT NULL,
    `employee` BIGINT NOT NULL,
    `document` BIGINT NULL,
    `documentname` VARCHAR(150) NOT NULL,
    `valid_until` DATE NOT NULL,
    `status` ENUM('Active', 'Inactive', 'Draft') NULL DEFAULT 'Active',
    `details` TEXT NULL,
    `attachment1` VARCHAR(100) NULL,
    `attachment2` VARCHAR(100) NULL,
    `attachment3` VARCHAR(100) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeimmigrationstatus` (
    `id` BIGINT NOT NULL,
    `employee` BIGINT NOT NULL,
    `status` BIGINT NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeimprest` (
    `id` BIGINT NOT NULL,
    `employee` BIGINT NOT NULL,
    `description` VARCHAR(20) NOT NULL,
    `currency` BIGINT NOT NULL,
    `funding` DECIMAL(10, 2) NULL DEFAULT 0.00,
    `attachment` VARCHAR(500) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeimprestgl` (
    `id` BIGINT NOT NULL,
    `currency` VARCHAR(50) NOT NULL,
    `imprest_acct` VARCHAR(50) NOT NULL,
    `imprest_acct_contra` VARCHAR(50) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeelanguages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `language_id` BIGINT NULL,
    `employee` BIGINT NOT NULL,
    `reading` ENUM('Elementary Proficiency', 'Limited Working Proficiency', 'Professional Working Proficiency', 'Full Professional Proficiency', 'Native or Bilingual Proficiency') NULL,
    `speaking` ENUM('Elementary Proficiency', 'Limited Working Proficiency', 'Professional Working Proficiency', 'Full Professional Proficiency', 'Native or Bilingual Proficiency') NULL,
    `writing` ENUM('Elementary Proficiency', 'Limited Working Proficiency', 'Professional Working Proficiency', 'Full Professional Proficiency', 'Native or Bilingual Proficiency') NULL,
    `understanding` ENUM('Elementary Proficiency', 'Limited Working Proficiency', 'Professional Working Proficiency', 'Full Professional Proficiency', 'Native or Bilingual Proficiency') NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeleavedays` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_leave` BIGINT NOT NULL,
    `leave_date` DATE NULL,
    `leave_type` ENUM('Full Day', 'Half Day - Morning', 'Half Day - Afternoon', '1 Hour - Morning', '2 Hours - Morning', '3 Hours - Morning', '1 Hour - Afternoon', '2 Hours - Afternoon', '3 Hours - Afternoon') NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeleavelog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_leave` BIGINT NOT NULL,
    `user_id` BIGINT NULL,
    `data` VARCHAR(500) NOT NULL,
    `status_from` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending',
    `status_to` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending',
    `created` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeleaves` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `leave_type` BIGINT NOT NULL,
    `posted_date` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `leave_period` BIGINT NOT NULL,
    `date_start` DATE NULL,
    `date_end` DATE NULL,
    `req_allowance` VARCHAR(20) NULL,
    `notice_date` DATE NOT NULL,
    `details` TEXT NULL,
    `position` VARCHAR(50) NULL,
    `emp_acc_no` VARCHAR(50) NULL,
    `allowance_rate` VARCHAR(10) NULL,
    `emp_notch` VARCHAR(10) NULL,
    `leave_gl` VARCHAR(50) NULL,
    `leave_name` VARCHAR(50) NULL,
    `department` VARCHAR(50) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending',
    `allowance_status` VARCHAR(20) NULL,
    `amount` VARCHAR(30) NULL,
    `documentref` VARCHAR(20) NULL,
    `attachment` VARCHAR(100) NULL,
    `approval_level` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeovertime` (
    `id` BIGINT NOT NULL,
    `employee` BIGINT NOT NULL,
    `start_time` DATETIME(0) NULL,
    `end_time` DATETIME(0) NULL,
    `category` BIGINT NOT NULL,
    `project` BIGINT NULL,
    `notes` TEXT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending'
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeprojects` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `project` BIGINT NULL,
    `date_start` DATE NULL,
    `date_end` DATE NULL,
    `status` ENUM('Current', 'Inactive', 'Completed') NULL DEFAULT 'Current',
    `details` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeereference` (
    `id` BIGINT NOT NULL,
    `employee` INTEGER NOT NULL,
    `referee` VARCHAR(50) NOT NULL,
    `designation` VARCHAR(50) NOT NULL,
    `organisation` VARCHAR(50) NOT NULL,
    `address` VARCHAR(50) NOT NULL,
    `period_known` VARCHAR(50) NOT NULL,
    `email` VARCHAR(50) NOT NULL,
    `phone` INTEGER NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` VARCHAR(50) NULL,
    `title` VARCHAR(50) NOT NULL,
    `first_name` VARCHAR(50) NOT NULL,
    `middle_name` VARCHAR(50) NULL,
    `last_name` VARCHAR(50) NOT NULL,
    `nationality` VARCHAR(50) NULL,
    `religion` VARCHAR(50) NULL,
    `birthday` DATE NOT NULL,
    `profile_image` TEXT NULL,
    `signature` TEXT NULL,
    `place_of_birth` VARCHAR(50) NULL,
    `spouse_name` VARCHAR(50) NULL,
    `father_name` VARCHAR(50) NULL,
    `mother_name` VARCHAR(50) NULL,
    `retirement_date` DATE NULL,
    `gender` VARCHAR(50) NULL,
    `marital_status` VARCHAR(20) NULL,
    `nxt_kin_fname` VARCHAR(50) NULL,
    `nxt_kin_email` VARCHAR(30) NULL,
    `nxt_kin_address` VARCHAR(30) NULL,
    `nxt_kin_phone` VARCHAR(20) NULL,
    `bank_name` VARCHAR(50) NULL,
    `bank_acc_no` VARCHAR(20) NULL,
    `customerNumber` VARCHAR(20) NULL,
    `tin_no` VARCHAR(20) NULL,
    `staff_level` VARCHAR(20) NULL,
    `staff_role` VARCHAR(20) NULL,
    `ssn_num` VARCHAR(20) NULL,
    `nassit_num` VARCHAR(20) NULL,
    `nic_num` VARCHAR(20) NULL,
    `nin_expiry_date` DATE NULL,
    `nin_issue_date` DATE NULL,
    `fit_and_proper` TEXT NULL,
    `policeClearance` TEXT NULL,
    `medicalClearance` TEXT NULL,
    `labour_card_num` VARCHAR(20) NULL,
    `other_id` VARCHAR(20) NULL,
    `driving_license` VARCHAR(20) NULL,
    `driving_license_exp_date` DATE NULL,
    `employment_status` BIGINT NULL,
    `job_title` BIGINT NULL,
    `pay_grade` BIGINT NULL,
    `notches` VARCHAR(10) NULL,
    `work_station_id` VARCHAR(20) NULL,
    `address1` TEXT NULL,
    `address2` TEXT NULL,
    `city` TEXT NULL,
    `country` VARCHAR(10) NULL,
    `province` BIGINT NULL,
    `postal_code` VARCHAR(10) NULL,
    `home_phone` VARCHAR(20) NULL,
    `mobile_phone` VARCHAR(20) NULL,
    `phone_country` VARCHAR(20) NULL,
    `work_phone` VARCHAR(20) NULL,
    `work_email` VARCHAR(50) NULL,
    `private_email` VARCHAR(50) NULL,
    `recruitment_date` DATE NULL,
    `confirmation_date` DATE NULL,
    `supervisor` BIGINT NULL,
    `indirect_supervisors` TEXT NULL,
    `department` VARCHAR(20) NULL,
    `branch` VARCHAR(191) NULL,
    `unit` VARCHAR(10) NULL,
    `outlet` VARCHAR(10) NULL,
    `start_date` DATE NULL,
    `probation_period` BIGINT NULL,
    `initials` VARCHAR(10) NULL,
    `severance_benefit` TEXT NULL,
    `custom5` TEXT NULL,
    `custom6` TEXT NULL,
    `custom7` TEXT NULL,
    `custom8` TEXT NULL,
    `custom9` TEXT NULL,
    `custom10` TEXT NULL,
    `termination_date` DATE NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Active',
    `ethnicity` BIGINT NULL,
    `immigration_status` BIGINT NULL,
    `approver1` BIGINT NULL,
    `approver2` BIGINT NULL,
    `approver3` BIGINT NULL,
    `previous_work_name` VARCHAR(50) NULL,
    `previous_work_address` VARCHAR(50) NULL,
    `previous_work_tel` VARCHAR(20) NULL,
    `prev_wk_start_date` DATE NULL,
    `prev_wk_end_date` DATE NULL,
    `termination_reason` TEXT NULL,
    `termination_status` VARCHAR(20) NULL,
    `reinstated_date` DATE NULL,
    `nxt_kin_mname` VARCHAR(30) NULL,
    `nxt_kin_lname` VARCHAR(30) NULL,
    `posted_by` BIGINT NULL,
    `approval_status` VARCHAR(20) NULL,
    `approved_date` DATE NULL,
    `approved_by` VARCHAR(30) NULL,
    `suspension_reason` TEXT NULL,
    `suspension_start_date` DATE NULL,
    `suspension_end_date` DATE NULL,
    `suspension_salary_rate` VARCHAR(10) NULL,
    `profile_imagebase64` TEXT NULL,
    `signature_base64` TEXT NULL,
    `service_name` VARCHAR(30) NULL,
    `years_of_service` VARCHAR(30) NULL,
    `service_description` VARCHAR(30) NULL,
    `benefits_rate` DECIMAL(10, 2) NULL DEFAULT 0.00,
    `total_benefits_rate` DECIMAL(30, 2) NULL DEFAULT 0.00,
    `posting_date` DATE NULL,

    UNIQUE INDEX `employee_id`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeesalary` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `component` BIGINT NOT NULL,
    `working_days` INTEGER NULL,
    `pay_frequency` ENUM('Hourly', 'Daily', 'Bi Weekly', 'Weekly', 'Semi Monthly', 'Monthly') NULL,
    `currency` BIGINT NULL,
    `amount` DECIMAL(30, 2) NULL,
    `amount_temp` DECIMAL(30, 2) NULL,
    `original_amount` DECIMAL(50, 0) NULL,
    `annual_rent` DECIMAL(60, 2) NULL DEFAULT 0.00,
    `ann_date` DATE NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeseverance` (
    `id` BIGINT NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `description` VARCHAR(50) NOT NULL,
    `benefit` VARCHAR(50) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeskills` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `skill_id` BIGINT NULL,
    `employee` BIGINT NOT NULL,
    `details` VARCHAR(400) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeetimeentry` (
    `id` BIGINT NOT NULL,
    `project` BIGINT NULL,
    `employee` BIGINT NOT NULL,
    `timesheet` BIGINT NOT NULL,
    `details` TEXT NULL,
    `created` DATETIME(0) NULL,
    `date_start` DATETIME(0) NULL,
    `time_start` VARCHAR(10) NOT NULL,
    `date_end` DATETIME(0) NULL,
    `time_end` VARCHAR(10) NOT NULL,
    `status` ENUM('Active', 'Inactive') NULL DEFAULT 'Active'
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeetimesheets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `date_start` DATE NOT NULL,
    `date_end` DATE NOT NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Submitted') NULL DEFAULT 'Pending',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeetrainingsessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `trainingSession` BIGINT NULL,
    `feedBack` VARCHAR(1500) NULL,
    `status` ENUM('Scheduled', 'Attended', 'Not-Attended', 'Completed') NULL DEFAULT 'Scheduled',
    `proof` VARCHAR(300) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeetravelrecords` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `imprest_gl` VARCHAR(50) NULL,
    `type` VARCHAR(200) NULL DEFAULT '',
    `purpose` VARCHAR(200) NULL,
    `ref_no` VARCHAR(20) NULL,
    `emp_acc_no` VARCHAR(50) NOT NULL,
    `cost_unit` VARCHAR(50) NULL,
    `cost_dept` VARCHAR(50) NULL,
    `branch` VARCHAR(10) NULL,
    `xcg_rate` DECIMAL(20, 2) NULL DEFAULT 0.00,
    `imprest_contra` VARCHAR(50) NULL,
    `travel_from` VARCHAR(200) NULL,
    `travel_to` VARCHAR(200) NULL,
    `travel_date` DATETIME(0) NULL,
    `return_date` DATETIME(0) NULL,
    `details` VARCHAR(500) NULL,
    `payment_method` VARCHAR(50) NULL,
    `funding` DECIMAL(10, 2) NULL,
    `local_eqv` DECIMAL(30, 2) NULL,
    `currency` VARCHAR(20) NULL DEFAULT 'GHS',
    `attachment1` VARCHAR(100) NULL,
    `attachment2` VARCHAR(100) NULL,
    `attachment3` VARCHAR(100) NULL,
    `comment` VARCHAR(100) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `beneficiary` BIGINT NULL,
    `beneficiary_acc` VARCHAR(50) NULL,
    `app_type` VARCHAR(10) NOT NULL DEFAULT 'IMP',
    `posting_date` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employementtype` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(250) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employmentstatus` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NULL,
    `description` VARCHAR(400) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ethnicity` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expensescategories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(500) NOT NULL,
    `expense_gl` VARCHAR(50) NOT NULL DEFAULT '0',
    `amount_limit` DECIMAL(60, 0) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `pre_approve` ENUM('Yes', 'No') NULL DEFAULT 'Yes',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expensespaymentmethods` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(500) NOT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `experiencelevel` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(250) NOT NULL DEFAULT ''
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fieldnamemappings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(20) NOT NULL,
    `name` VARCHAR(20) NOT NULL,
    `textOrig` VARCHAR(200) NULL,
    `textMapped` VARCHAR(200) NULL,
    `display` ENUM('Form', 'Table and Form', 'Hidden') NULL DEFAULT 'Form',
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `filename` VARCHAR(100) NOT NULL,
    `employee` BIGINT NULL,
    `file_group` VARCHAR(100) NOT NULL,
    `size` BIGINT NULL,
    `size_text` VARCHAR(20) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `forms` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(500) NULL,
    `items` TEXT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `dateh` DATE NULL,
    `status` ENUM('Full Day', 'Half Day') NULL DEFAULT 'Full Day',
    `country` BIGINT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `immigrationdocuments` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `required` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `alert_on_missing` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `alert_before_expiry` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `alert_before_day_number` INTEGER NOT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `immigrationstatus` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `industry` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(250) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interviews` (
    `id` BIGINT NOT NULL,
    `job` BIGINT NOT NULL,
    `candidate` BIGINT NULL,
    `level` VARCHAR(100) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `scheduled` DATETIME(0) NULL,
    `location` VARCHAR(500) NULL,
    `mapId` BIGINT NULL,
    `status` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `scheduleUpdated` INTEGER NULL DEFAULT 0,
    `interviewers` TEXT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `positionReason` VARCHAR(100) NULL,
    `shortDescription` TEXT NULL,
    `description` TEXT NULL,
    `requirements` TEXT NULL,
    `benefits` TEXT NULL,
    `country` BIGINT NULL,
    `location` VARCHAR(50) NULL,
    `companyName` VARCHAR(50) NULL,
    `company` BIGINT NULL,
    `department` VARCHAR(100) NULL,
    `code` VARCHAR(20) NULL,
    `employementType` BIGINT NULL,
    `hiringManager` BIGINT NULL,
    `showHiringManager` VARCHAR(50) NULL,
    `industry` BIGINT NULL,
    `postalCode` VARCHAR(20) NULL,
    `experienceLevel` BIGINT NULL,
    `jobFunction` BIGINT NULL,
    `educationLevel` BIGINT NULL,
    `currency` BIGINT NULL,
    `showSalary` ENUM('Yes', 'No') NULL,
    `salaryMin` BIGINT NULL,
    `salaryMax` BIGINT NULL,
    `keywords` TEXT NULL,
    `status` ENUM('Active', 'On hold', 'Closed') NULL,
    `closingDate` DATETIME(0) NULL,
    `attachment` VARCHAR(100) NULL,
    `display` VARCHAR(200) NOT NULL,
    `postedBy` BIGINT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobfunction` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(250) NOT NULL DEFAULT ''
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobtitles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(10) NULL,
    `name` VARCHAR(100) NULL,
    `category` VARCHAR(30) NULL,
    `description` VARCHAR(200) NULL,
    `specification` VARCHAR(400) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `languages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NULL,
    `description` VARCHAR(400) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leavegroupemployees` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NULL,
    `leave_group` BIGINT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leavegroups` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leaveperiods` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `date_start` DATE NULL,
    `date_end` DATE NULL,
    `status` ENUM('Active', 'Inactive') NULL DEFAULT 'Inactive',
    `country` BIGINT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leaverules` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `leave_type` BIGINT NOT NULL,
    `job_title` BIGINT NULL,
    `employment_status` BIGINT NULL,
    `employee` BIGINT NULL,
    `supervisor_leave_assign` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `employee_can_apply` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `apply_beyond_current` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `leave_accrue` ENUM('No', 'Yes') NULL DEFAULT 'No',
    `carried_forward` ENUM('No', 'Yes') NULL DEFAULT 'No',
    `default_per_year` DECIMAL(10, 3) NOT NULL,
    `carried_forward_percentage` INTEGER NULL DEFAULT 0,
    `carried_forward_leave_availability` INTEGER NULL DEFAULT 365,
    `propotionate_on_joined_date` ENUM('No', 'Yes') NULL DEFAULT 'No',
    `leave_group` BIGINT NULL,
    `max_carried_forward_amount` INTEGER NULL DEFAULT 0,
    `exp_days` INTEGER NULL,
    `leave_period` BIGINT NULL,
    `department` BIGINT NULL,
    `employee_leave_period` ENUM('Yes', 'No') NULL DEFAULT 'No',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leavestartingbalance` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `leave_type` BIGINT NOT NULL,
    `employee` BIGINT NULL,
    `leave_period` BIGINT NOT NULL,
    `amount` DECIMAL(10, 3) NOT NULL,
    `note` TEXT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leavetypes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `leave_gl` VARCHAR(50) NULL,
    `supervisor_leave_assign` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `employee_can_apply` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `apply_beyond_current` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `leave_accrue` ENUM('No', 'Yes') NULL DEFAULT 'No',
    `carried_forward` ENUM('No', 'Yes') NULL DEFAULT 'No',
    `default_per_year` DECIMAL(10, 3) NOT NULL,
    `carried_forward_percentage` INTEGER NULL DEFAULT 0,
    `carried_forward_leave_availability` INTEGER NULL DEFAULT 365,
    `propotionate_on_joined_date` ENUM('No', 'Yes') NULL DEFAULT 'No',
    `send_notification_emails` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `leave_group` BIGINT NULL,
    `leave_color` VARCHAR(10) NULL,
    `max_carried_forward_amount` INTEGER NULL DEFAULT 0,
    `employee_leave_period` ENUM('Yes', 'No') NULL DEFAULT 'No',

    UNIQUE INDEX `leavetypes_id_name`(`id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `migrations` (
    `id` BIGINT NOT NULL,
    `file` VARCHAR(50) NOT NULL,
    `version` INTEGER NOT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `status` ENUM('Pending', 'Up', 'Down', 'UpError', 'DownError') NULL DEFAULT 'Pending',
    `last_error` VARCHAR(500) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `modules` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `menu` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `icon` VARCHAR(50) NULL,
    `mod_group` VARCHAR(30) NOT NULL,
    `mod_order` INTEGER NULL,
    `status` ENUM('Enabled', 'Disabled') NULL DEFAULT 'Enabled',
    `version` VARCHAR(10) NULL DEFAULT '',
    `update_path` VARCHAR(500) NULL DEFAULT '',
    `user_levels` VARCHAR(500) NOT NULL,
    `user_roles` TEXT NULL,
    `user_roles_blacklist` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nationality` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notches` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `paygrade` VARCHAR(50) NOT NULL,
    `currency` VARCHAR(10) NULL,
    `amount` DECIMAL(20, 2) NULL DEFAULT 0.00,

    UNIQUE INDEX `name`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notchmovement` (
    `id` BIGINT NOT NULL,
    `date` DATE NOT NULL,
    `employees` VARCHAR(50) NOT NULL,
    `no_notches` VARCHAR(50) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `time` DATETIME(0) NULL,
    `fromUser` BIGINT NULL,
    `fromEmployee` BIGINT NULL,
    `toUser` BIGINT NOT NULL,
    `image` VARCHAR(500) NULL,
    `message` TEXT NULL,
    `action` TEXT NULL,
    `type` VARCHAR(100) NULL,
    `status` ENUM('Unread', 'Read') NULL DEFAULT 'Unread',
    `employee` BIGINT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overtimecategories` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(500) NOT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payfrequency` (
    `id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paygrades` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NULL,
    `currency` VARCHAR(3) NOT NULL,
    `min_salary` DECIMAL(12, 2) NULL DEFAULT 0.00,
    `max_salary` DECIMAL(12, 2) NULL DEFAULT 0.00,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NULL,
    `pay_period` BIGINT NOT NULL,
    `department` BIGINT NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `column_template` BIGINT NULL,
    `columns` VARCHAR(500) NULL,
    `pay_month` VARCHAR(8) NOT NULL,
    `date_start` DATE NULL,
    `date_end` DATE NULL,
    `status` ENUM('Draft', 'Completed', 'Processing', 'Rejected', 'Approved') NULL DEFAULT 'Draft',
    `payslipTemplate` BIGINT NULL,
    `deduction_group` BIGINT NULL,
    `documentRef` VARCHAR(50) NULL,
    `payment_log` VARCHAR(100) NULL,
    `posting_date` DATE NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finalized_date` DATE NULL,
    `verified_by` BIGINT NULL,
    `posted_by` VARCHAR(100) NOT NULL,
    `approved_by` VARCHAR(50) NULL,
    `approved_date` DATE NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payrollcolumns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NULL,
    `salarycomponent_gl` VARCHAR(50) NULL,
    `posting_column` VARCHAR(10) NULL,
    `payment_deduction` VARCHAR(20) NULL,
    `posting_branch` VARCHAR(20) NULL,
    `calculation_hook` VARCHAR(200) NULL,
    `salary_components` VARCHAR(500) NULL,
    `deductions` VARCHAR(500) NULL,
    `add_columns` VARCHAR(500) NULL,
    `sub_columns` VARCHAR(500) NULL,
    `colorder` INTEGER NULL,
    `editable` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `enabled` ENUM('Yes', 'No') NULL DEFAULT 'Yes',
    `default_value` VARCHAR(25) NULL,
    `calculation_columns` VARCHAR(500) NULL,
    `calculation_function` TEXT NULL,
    `deduction_group` BIGINT NULL,
    `function_type` ENUM('Simple', 'Advanced') NULL DEFAULT 'Simple',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payrollcolumntemplates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NULL,
    `columns` VARCHAR(500) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payrolldata` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payroll` BIGINT NOT NULL,
    `employee` BIGINT NOT NULL,
    `payroll_item` INTEGER NOT NULL,
    `amount` VARCHAR(25) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payrollemployees` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `pay_frequency` INTEGER NULL,
    `currency` BIGINT NULL,
    `deduction_exemptions` VARCHAR(250) NULL,
    `deduction_allowed` VARCHAR(250) NULL,
    `deduction_group` BIGINT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paysliptemplates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `data` LONGTEXT NULL,
    `status` ENUM('Show', 'Hide') NULL DEFAULT 'Show',
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `performancereviews` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `employee` BIGINT NULL,
    `coordinator` BIGINT NULL,
    `attendees` VARCHAR(50) NOT NULL,
    `form` BIGINT NULL,
    `status` VARCHAR(20) NOT NULL,
    `review_date` DATETIME(0) NULL,
    `review_period_start` DATETIME(0) NULL,
    `review_period_end` DATETIME(0) NULL,
    `self_assessment_due` DATETIME(0) NULL,
    `notes` TEXT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `probations` (
    `id` BIGINT NOT NULL,
    `name` INTEGER NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `client` BIGINT NULL,
    `details` TEXT NULL,
    `created` DATETIME(0) NULL,
    `status` ENUM('Active', 'On Hold', 'Completed', 'Dropped') NULL DEFAULT 'Active'
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `province` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(40) NOT NULL DEFAULT '',
    `code` CHAR(2) NOT NULL DEFAULT '',
    `country` CHAR(2) NOT NULL DEFAULT 'US'
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reportfiles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NULL,
    `name` VARCHAR(100) NOT NULL,
    `attachment` VARCHAR(100) NOT NULL,
    `created` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `parameters` TEXT NULL,
    `query` TEXT NULL,
    `paramOrder` VARCHAR(500) NOT NULL,
    `type` ENUM('Query', 'Class') NULL DEFAULT 'Query',
    `report_group` VARCHAR(500) NULL,
    `output` VARCHAR(15) NOT NULL DEFAULT 'CSV',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `restaccesstokens` (
    `id` BIGINT NOT NULL,
    `userId` BIGINT NOT NULL,
    `hash` VARCHAR(32) NULL,
    `token` VARCHAR(500) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviewfeedbacks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NULL,
    `review` BIGINT NULL,
    `subject` BIGINT NULL,
    `form` BIGINT NULL,
    `status` VARCHAR(20) NOT NULL,
    `dueon` DATETIME(0) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviewtemplates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(500) NULL,
    `items` TEXT NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salarycomponent` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `salarycomp_gl` VARCHAR(20) NULL,
    `branch` VARCHAR(50) NULL,
    `summary` VARCHAR(20) NULL,
    `processing_code` VARCHAR(20) NULL,
    `componentType` BIGINT NULL,
    `details` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salarycomponenttype` (
    `id` BIGINT NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(100) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `value` TEXT NULL,
    `description` TEXT NULL,
    `meta` TEXT NULL,
    `category` VARCHAR(15) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skills` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NULL,
    `description` VARCHAR(400) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staffinfraction` (
    `id` BIGINT NOT NULL,
    `employee` VARCHAR(20) NOT NULL,
    `branch` VARCHAR(20) NOT NULL,
    `date` DATE NOT NULL,
    `email` VARCHAR(30) NOT NULL,
    `ref_no` VARCHAR(25) NOT NULL,
    `header` VARCHAR(20) NOT NULL,
    `subscription` VARCHAR(20) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staffmedical` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` VARCHAR(20) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NULL,
    `admission_type` VARCHAR(20) NOT NULL,
    `type_of_illness` VARCHAR(100) NOT NULL,
    `medication_given` VARCHAR(100) NOT NULL,
    `cost` DECIMAL(30, 2) NOT NULL,
    `mode_of_payment` VARCHAR(50) NULL,
    `hospital` VARCHAR(50) NOT NULL,
    `physician` VARCHAR(50) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing', 'Submitted', 'Draft', 'Pending Approval') NULL DEFAULT 'Draft',
    `posted_by` VARCHAR(20) NULL,
    `createdAt` DATE NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATE NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approved_date` DATE NULL,
    `approved_by` VARCHAR(50) NULL,
    `attachment1` TEXT NULL,
    `attachment2` TEXT NULL,
    `attachment3` TEXT NULL,
    `reference` VARCHAR(50) NULL,
    `api_response` VARCHAR(100) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staffseverance` (
    `id` BIGINT NOT NULL,
    `employee_id` VARCHAR(20) NULL,
    `employee` VARCHAR(20) NULL,
    `age` INTEGER NULL,
    `separation_date` DATE NULL,
    `severance_group` VARCHAR(20) NULL,
    `service_years` INTEGER NULL,
    `annual_salary_enterprise` INTEGER NULL,
    `annual_salary_others` INTEGER NULL,
    `transition_period` INTEGER NULL,
    `entitlement_period` INTEGER NULL,
    `severance_pay_period` INTEGER NULL,
    `estimated_entitlement` INTEGER NULL,
    `weekly_base_salary` FLOAT NULL DEFAULT 0,
    `total_severance` FLOAT NULL DEFAULT 0,
    `notes` VARCHAR(100) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statuschangelogs` (
    `id` BIGINT NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `element` BIGINT NOT NULL,
    `user_id` BIGINT NULL,
    `data` VARCHAR(500) NOT NULL,
    `status_from` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending',
    `status_to` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL DEFAULT 'Pending',
    `created` DATETIME(0) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `supportedlanguages` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NULL,
    `description` VARCHAR(100) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(250) NOT NULL DEFAULT ''
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timezones` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL DEFAULT '',
    `details` VARCHAR(255) NOT NULL DEFAULT ''
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trainingsessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(300) NOT NULL,
    `course` BIGINT NOT NULL,
    `description` TEXT NULL,
    `scheduled` DATETIME(0) NULL,
    `dueDate` DATETIME(0) NULL,
    `deliveryMethod` ENUM('Classroom', 'Self Study', 'Online') NULL DEFAULT 'Classroom',
    `deliveryLocation` VARCHAR(500) NULL,
    `status` ENUM('Pending', 'Approved', 'Completed', 'Cancelled') NULL DEFAULT 'Pending',
    `attendanceType` ENUM('Sign Up', 'Assign') NULL DEFAULT 'Sign Up',
    `attachment` VARCHAR(300) NULL,
    `cost_of_training` VARCHAR(50) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `requireProof` ENUM('Yes', 'No') NULL DEFAULT 'Yes',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `userreports` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `details` TEXT NULL,
    `parameters` TEXT NULL,
    `query` TEXT NULL,
    `paramOrder` VARCHAR(500) NOT NULL,
    `type` ENUM('Query', 'Class') NULL DEFAULT 'Query',
    `report_group` VARCHAR(500) NULL,
    `output` VARCHAR(15) NOT NULL DEFAULT 'CSV',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `userroles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NULL,
    `additional_permissions` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workdays` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `status` ENUM('Full Day', 'Half Day', 'Non-working Day') NULL DEFAULT 'Full Day',
    `country` BIGINT NULL,

    UNIQUE INDEX `workdays_name_country`(`name`, `country`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `13_month_perm` (
    `AFF_ID` VARCHAR(8) NULL,
    `FIRST_NAME` VARCHAR(14) NULL,
    `MIDDLE_NAME` VARCHAR(27) NULL,
    `LAST_NAME` VARCHAR(16) NULL,
    `BASIC_SALARY` DECIMAL(8, 2) NULL,
    `new_basic` DECIMAL(8, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `13perm25` (
    `EMPLOYEE_ID` VARCHAR(8) NULL,
    `BASIC_SALARY` DECIMAL(9, 2) NULL,
    `TAX` DECIMAL(8, 3) NULL,

    UNIQUE INDEX `EMPLOYEE_ID`(`EMPLOYEE_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_numbers` (
    `id` BIGINT NOT NULL,
    `employee_id` VARCHAR(30) NOT NULL,
    `fullname` VARCHAR(50) NOT NULL,
    `account_number` VARCHAR(30) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounts_update` (
    `ID` VARCHAR(9) NULL,
    `BANK_ACC_NO` VARCHAR(13) NULL,

    UNIQUE INDEX `ID`(`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `benefits` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(20) NOT NULL,
    `description` VARCHAR(50) NULL,
    `notch` VARCHAR(10) NOT NULL,
    `general_ledger` VARCHAR(20) NOT NULL,
    `min_yrs_of_service` INTEGER NOT NULL,
    `max_yrs_of_service` INTEGER NOT NULL,
    `benefits_rate` VARCHAR(10) NOT NULL,
    `amount` DECIMAL(30, 2) NULL,
    `posting_date` DATE NULL DEFAULT CURRENT_TIMESTAMP(3)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `br_code` TEXT NOT NULL,
    `br_description` VARCHAR(30) NOT NULL,
    `address1` VARCHAR(50) NULL,
    `address2` VARCHAR(50) NULL,
    `address3` VARCHAR(50) NULL,
    `telephone` VARCHAR(20) NULL,
    `email` VARCHAR(30) NULL,
    `date_opened` VARCHAR(20) NULL,
    `posting_date` VARCHAR(20) NULL,
    `posted_by` VARCHAR(20) NULL,
    `posting_ip` VARCHAR(20) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `car_all_new` (
    `STAFF_ID` VARCHAR(8) NULL,
    `CAR` DECIMAL(7, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `car_new` (
    `STAFF ID` VARCHAR(8) NULL,
    `CAR` DECIMAL(7, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cars` (
    `STAFF_ID` VARCHAR(9) NULL,
    `CAR` VARCHAR(7) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cloth_allowance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `Employee_ID` VARCHAR(8) NULL,
    `Name` VARCHAR(40) NULL,
    `Branch` VARCHAR(20) NULL,
    `Amount` DECIMAL(30, 2) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cloth_allowance_contract` (
    `id` INTEGER NULL,
    `Employee_ID` VARCHAR(8) NULL,
    `Name` VARCHAR(22) NULL,
    `Branch` VARCHAR(20) NULL,
    `Amount` DECIMAL(6, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clothing_2024` (
    `staff_id` VARCHAR(8) NULL,
    `amount` DECIMAL(9, 2) NULL,

    UNIQUE INDEX `staff_id`(`staff_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clothung_all_26` (
    `employee_id` VARCHAR(100) NOT NULL,
    `amount` DECIMAL(9, 2) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company` (
    `id` BIGINT NULL,
    `name` VARCHAR(50) NULL,
    `description` VARCHAR(100) NULL,
    `logo` VARCHAR(100) NULL,
    `email` VARCHAR(20) NULL,
    `branch_code` VARCHAR(10) NULL,
    `address1` VARCHAR(20) NULL,
    `address2` VARCHAR(20) NULL,
    `address3` VARCHAR(20) NULL,
    `telephone` VARCHAR(20) NULL,
    `contact_person` VARCHAR(30) NULL,
    `swift_code` VARCHAR(20) NULL,
    `date_opened` DATE NULL,
    `city` VARCHAR(30) NULL,
    `zip_code` VARCHAR(10) NULL,
    `state_province` VARCHAR(30) NULL,
    `country` VARCHAR(20) NULL,
    `base_currency` VARCHAR(20) NULL,
    `time_zone` VARCHAR(30) NULL,
    `registration_no` VARCHAR(10) NULL,
    `fax` VARCHAR(20) NULL,
    `motto` VARCHAR(30) NULL,
    `bank_code` VARCHAR(10) NULL,
    `sort_code` VARCHAR(20) NULL,
    `website` VARCHAR(30) NULL,
    `tin_no` VARCHAR(20) NULL,
    `system_provider` VARCHAR(30) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_1` (
    `staff_id` VARCHAR(9) NULL,
    `contract` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `staff_id`(`staff_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_rent` (
    `Staff_ID` VARCHAR(8) NULL,
    `Amount` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `Staff_ID`(`Staff_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_all_1` (
    `Staff_ID` VARCHAR(8) NOT NULL,
    `Amount` DECIMAL(7, 2) NULL,

    PRIMARY KEY (`Staff_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dependentmedical` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` VARCHAR(20) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NULL,
    `dependant_name` VARCHAR(20) NOT NULL,
    `relation_to_dependent` VARCHAR(200) NULL,
    `dob` DATE NULL,
    `admission_type` VARCHAR(50) NOT NULL,
    `type_of_illness` VARCHAR(50) NOT NULL,
    `medication_given` VARCHAR(50) NOT NULL,
    `cost` DECIMAL(50, 2) NOT NULL,
    `mode_of_payment` VARCHAR(50) NULL,
    `hospital` VARCHAR(50) NOT NULL,
    `physician` VARCHAR(50) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing', 'Submitted', 'Draft', 'Pending Approval') NOT NULL DEFAULT 'Draft',
    `posted_by` VARCHAR(20) NULL,
    `approved_date` DATE NULL,
    `approved_by` VARCHAR(50) NULL,
    `attachment1` TEXT NULL,
    `attachment2` TEXT NULL,
    `attachment3` TEXT NULL,
    `reference` VARCHAR(50) NULL,
    `api_response` VARCHAR(200) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `displacement` (
    `STAFF_ID` VARCHAR(9) NULL,
    `DISPLACEMENT` VARCHAR(7) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `displacement_new` (
    `STAFF_ID` VARCHAR(8) NULL,
    `DISPLACEMENT` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `duty_2` (
    `STAFF_ID` VARCHAR(8) NULL,
    `DUTY_ALLOWANCE` DECIMAL(7, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `duty_allowance` (
    `STAFF_ID` VARCHAR(9) NULL,
    `DUTY_ALLOWANCE` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emaillog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `subject` VARCHAR(300) NOT NULL,
    `toEmail` VARCHAR(300) NOT NULL,
    `body` TEXT NULL,
    `cclist` VARCHAR(500) NULL,
    `bcclist` VARCHAR(500) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `status` ENUM('Pending', 'Sent', 'Failed') NULL DEFAULT 'Pending',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emp` (
    `id` BIGINT NOT NULL,
    `employee_id` VARCHAR(30) NOT NULL,
    `title` VARCHAR(10) NOT NULL,
    `first_name` VARCHAR(50) NOT NULL,
    `middle_name` VARCHAR(50) NULL,
    `last_name` VARCHAR(50) NOT NULL,
    `birthday` DATE NOT NULL,
    `gender` VARCHAR(10) NOT NULL,
    `bank_name` INTEGER NULL,
    `account_number` VARCHAR(50) NULL,
    `staff_level` VARCHAR(30) NULL,
    `employment_status` VARCHAR(30) NULL,
    `job_title` VARCHAR(30) NULL,
    `mobile_phone` VARCHAR(20) NULL,
    `office_email` VARCHAR(30) NULL,
    `private_email` VARCHAR(30) NULL,
    `supervisor` VARCHAR(30) NULL,
    `indirect_supervisor` VARCHAR(30) NULL,
    `department` VARCHAR(30) NULL,
    `branch` VARCHAR(30) NULL,
    `branch_code` VARCHAR(10) NULL,
    `unit` VARCHAR(30) NULL,
    `function` VARCHAR(30) NULL,
    `initial` VARCHAR(10) NULL,
    `approver1` INTEGER NULL,
    `approver2` INTEGER NULL,
    `approver3` INTEGER NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emp_id` (
    `id` BIGINT NOT NULL,
    `old_id` VARCHAR(20) NULL,
    `employee` VARCHAR(50) NULL,
    `doe` VARCHAR(20) NULL,
    `new_id` VARCHAR(20) NULL,
    `grade` VARCHAR(30) NOT NULL,
    `gender` VARCHAR(10) NOT NULL,
    `dob` DATE NOT NULL,
    `department` VARCHAR(50) NOT NULL,
    `account_number` VARCHAR(30) NOT NULL,
    `branch_code` VARCHAR(10) NOT NULL,
    `dept` VARCHAR(50) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_update` (
    `employee_id` VARCHAR(20) NULL,
    `first_name` VARCHAR(30) NULL,
    `middle_name` VARCHAR(30) NULL,
    `last_name` VARCHAR(30) NULL,
    `dob` DATE NULL,
    `gender` VARCHAR(30) NULL,
    `marital_status` VARCHAR(20) NULL,
    `job_title` VARCHAR(30) NULL,
    `pay_grade` VARCHAR(30) NULL,
    `notch` VARCHAR(10) NULL,
    `mobile_phone` VARCHAR(20) NULL,
    `work_email` VARCHAR(50) NULL,
    `private_email` VARCHAR(50) NULL,
    `recruitment_date` DATE NULL,
    `department` VARCHAR(50) NULL,
    `branch` VARCHAR(10) NULL,
    `supervisor` VARCHAR(50) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeebankdetails` (
    `id` BIGINT NOT NULL,
    `accountType` VARCHAR(50) NULL,
    `subProduct` VARCHAR(20) NOT NULL,
    `subSector` VARCHAR(20) NOT NULL,
    `subSegment` VARCHAR(20) NOT NULL,
    `noCrTrans` VARCHAR(20) NOT NULL,
    `noDbTrans` VARCHAR(20) NOT NULL,
    `totalCrTrans` VARCHAR(20) NOT NULL,
    `totalDbTrans` VARCHAR(20) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees_new` (
    `id` BIGINT NOT NULL,
    `employee_id` VARCHAR(50) NULL,
    `title` VARCHAR(50) NULL,
    `first_name` VARCHAR(100) NOT NULL DEFAULT '',
    `middle_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `nationality` VARCHAR(20) NULL,
    `religion` VARCHAR(50) NULL,
    `birthday` DATE NOT NULL,
    `profile_image` VARCHAR(100) NULL,
    `signature` VARCHAR(100) NULL,
    `place_of_birth` VARCHAR(50) NULL,
    `spouse_name` VARCHAR(50) NULL,
    `father_name` VARCHAR(50) NULL,
    `mother_name` VARCHAR(50) NULL,
    `retirement_date` DATE NULL,
    `gender` ENUM('Male', 'Female') NULL,
    `marital_status` ENUM('Married', 'Single', 'Divorced', 'Widowed', 'Other') NULL,
    `nxt_kin_fname` VARCHAR(20) NULL,
    `nxt_kin_email` VARCHAR(20) NULL,
    `nxt_kin_address` VARCHAR(20) NULL,
    `nxt_kin_phone` VARCHAR(100) NULL,
    `bank_name` VARCHAR(20) NULL,
    `bank_acc_no` VARCHAR(100) NULL,
    `customerNumber` VARCHAR(20) NULL,
    `tin_no` VARCHAR(25) NULL,
    `staff_level` VARCHAR(20) NULL,
    `staff_role` VARCHAR(30) NULL,
    `ssn_num` VARCHAR(100) NULL,
    `nassit_num` VARCHAR(100) NULL,
    `nic_num` VARCHAR(100) NULL,
    `nin_expiry_date` DATE NULL,
    `nin_issue_date` DATE NULL,
    `fit_and_proper` VARCHAR(100) NULL,
    `labour_card_num` VARCHAR(100) NULL,
    `other_id` VARCHAR(100) NULL,
    `driving_license` VARCHAR(100) NULL,
    `driving_license_exp_date` DATE NULL,
    `employment_status` BIGINT NULL,
    `job_title` BIGINT NULL,
    `pay_grade` BIGINT NULL,
    `notches` VARCHAR(50) NULL,
    `work_station_id` VARCHAR(100) NULL,
    `address1` VARCHAR(100) NULL,
    `address2` VARCHAR(100) NULL,
    `city` VARCHAR(150) NULL,
    `country` CHAR(2) NULL,
    `province` BIGINT NULL,
    `postal_code` VARCHAR(20) NULL,
    `home_phone` VARCHAR(50) NULL,
    `mobile_phone` VARCHAR(50) NULL,
    `phone_country` VARCHAR(10) NULL,
    `work_phone` VARCHAR(50) NULL,
    `work_email` VARCHAR(100) NULL,
    `private_email` VARCHAR(100) NULL,
    `recruitment_date` DATE NULL,
    `confirmation_date` DATE NULL,
    `supervisor` BIGINT NULL,
    `indirect_supervisors` VARCHAR(250) NULL,
    `department` BIGINT NULL,
    `branch` VARCHAR(50) NULL DEFAULT '000',
    `unit` VARCHAR(50) NULL,
    `start_date` DATE NULL,
    `probation_period` BIGINT NULL,
    `initials` VARCHAR(20) NULL,
    `severance_benefit` VARCHAR(250) NULL,
    `custom5` VARCHAR(250) NULL,
    `custom6` VARCHAR(250) NULL,
    `custom7` VARCHAR(250) NULL,
    `custom8` VARCHAR(250) NULL,
    `custom9` VARCHAR(250) NULL,
    `custom10` VARCHAR(250) NULL,
    `termination_date` DATE NULL,
    `notes` TEXT NULL,
    `status` ENUM('Active', 'Terminated', 'Suspended') NULL DEFAULT 'Active',
    `ethnicity` BIGINT NULL,
    `immigration_status` BIGINT NULL,
    `approver1` BIGINT NULL,
    `approver2` BIGINT NULL,
    `approver3` BIGINT NULL,
    `previous_work_name` VARCHAR(50) NULL,
    `previous_work_address` VARCHAR(50) NULL,
    `previous_work_tel` VARCHAR(50) NULL,
    `prev_wk_start_date` DATE NULL,
    `prev_wk_end_date` DATE NULL,
    `termination_reason` VARCHAR(100) NULL,
    `reinstated_date` DATE NULL,
    `nxt_kin_mname` VARCHAR(50) NULL,
    `nxt_kin_lname` VARCHAR(50) NULL,
    `posted_by` BIGINT NULL,
    `approval_status` VARCHAR(50) NULL,
    `approved_date` DATE NULL,
    `approved_by` VARCHAR(50) NULL,
    `suspension_reason` VARCHAR(100) NULL,
    `suspension_start_date` DATE NULL,
    `suspension_end_date` DATE NULL,
    `suspension_salary_rate` VARCHAR(20) NULL,
    `profile_imagebase64` VARCHAR(100) NULL,
    `signature_base64` VARCHAR(100) NULL,
    `service_name` VARCHAR(20) NULL,
    `years_of_service` VARCHAR(10) NULL,
    `service_description` VARCHAR(50) NULL,
    `benefits_rate` DECIMAL(10, 2) NULL DEFAULT 0.00,
    `total_benefits_rate` DECIMAL(30, 2) NULL DEFAULT 0.00,
    `posting_date` DATE NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeesalary_old` (
    `id` BIGINT NOT NULL,
    `employee` BIGINT NOT NULL,
    `component` BIGINT NOT NULL,
    `working_days` INTEGER NULL,
    `pay_frequency` ENUM('Hourly', 'Daily', 'Bi Weekly', 'Weekly', 'Semi Monthly', 'Monthly') NULL,
    `currency` BIGINT NULL,
    `amount` DECIMAL(30, 2) NULL,
    `amount_temp` DECIMAL(30, 2) NULL,
    `original_amount` DECIMAL(50, 0) NULL,
    `annual_rent` DECIMAL(60, 2) NULL DEFAULT 0.00,
    `ann_date` DATE NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeteammembers` (
    `id` BIGINT NOT NULL,
    `team` BIGINT NULL,
    `member` BIGINT NULL,
    `role` VARCHAR(60) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employeeteams` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NULL,
    `description` TEXT NULL,
    `lead` BIGINT NULL,
    `department` BIGINT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emps` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `doe` DATE NOT NULL,
    `old_id` VARCHAR(30) NOT NULL,
    `new_id` VARCHAR(30) NOT NULL,
    `grade` VARCHAR(50) NOT NULL,
    `gender` VARCHAR(10) NOT NULL,
    `dob` DATE NOT NULL,
    `dept` VARCHAR(30) NOT NULL,
    `account_number` VARCHAR(30) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emps_contract` (
    `id` BIGINT NOT NULL,
    `first_name` VARCHAR(30) NOT NULL,
    `middle_name` VARCHAR(30) NOT NULL,
    `last_name` VARCHAR(30) NOT NULL,
    `doe` DATE NOT NULL,
    `emp_id` VARCHAR(30) NOT NULL,
    `grade` VARCHAR(30) NOT NULL,
    `gender` VARCHAR(10) NOT NULL,
    `dob` DATE NOT NULL,
    `account_number` VARCHAR(50) NOT NULL,
    `new_emp_id` VARCHAR(10) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expensesbusinesspurpose` (
    `id` BIGINT NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `name` VARCHAR(50) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `full_emp` (
    `employee_id` VARCHAR(8) NULL,

    UNIQUE INDEX `employee_id`(`employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gender` (
    `id` BIGINT NOT NULL,
    `code` VARCHAR(20) NULL,
    `name` VARCHAR(20) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hiringpipeline` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NULL,
    `type` ENUM('Short Listed', 'Phone Screen', 'Assessment', 'Interview', 'Offer', 'Hired', 'Rejected', 'Archived') NULL DEFAULT 'Short Listed',
    `notes` TEXT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hospitalclaims` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hospital` BIGINT NULL,
    `items` LONGTEXT NOT NULL,
    `total_amount` DECIMAL(30, 2) NOT NULL,
    `withholding_tax` DECIMAL(30, 2) NOT NULL DEFAULT 0.00,
    `category` INTEGER NOT NULL,
    `total_credit_amount` DECIMAL(30, 2) NOT NULL DEFAULT 0.00,
    `comment` TEXT NOT NULL,
    `posted_by` BIGINT NOT NULL,
    `posted_date` DATE NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(20) NOT NULL DEFAULT 'Draft',
    `approved_date` DATE NULL,
    `approved_by` BIGINT NULL,
    `reference_no` VARCHAR(20) NULL,
    `response` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hospitalclaims_hist` (
    `id` INTEGER NOT NULL,
    `hospital` BIGINT NULL,
    `items` LONGTEXT NOT NULL,
    `total_amount` DECIMAL(30, 2) NOT NULL,
    `withholding_tax` DECIMAL(30, 2) NOT NULL DEFAULT 0.00,
    `category` INTEGER NOT NULL,
    `total_credit_amount` DECIMAL(30, 2) NOT NULL DEFAULT 0.00,
    `comment` TEXT NOT NULL,
    `posted_by` BIGINT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Draft',
    `approved_date` DATE NULL,
    `approved_by` BIGINT NULL,
    `reference_no` VARCHAR(20) NULL,
    `response` TEXT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leaveallowance` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `leave_type` VARCHAR(20) NOT NULL,
    `leave_period` VARCHAR(50) NOT NULL,
    `allowance_rate` VARCHAR(10) NOT NULL,
    `note` VARCHAR(100) NULL,
    `posting_date` DATE NOT NULL,
    `posted_by` VARCHAR(50) NULL,
    `approved_date` DATE NULL,
    `approved_by` VARCHAR(50) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `live_rokel_cost_center_to_be_loaded_this_saturday` (
    `id` VARCHAR(3) NULL,
    `employee_id` VARCHAR(8) NULL,
    `branch_code` VARCHAR(3) NULL,
    `dept_code` VARCHAR(2) NULL,

    UNIQUE INDEX `employee_id`(`employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `long_service` (
    `STAFF_ID` VARCHAR(8) NULL,
    `AMOUNT` DECIMAL(8, 2) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lunch` (
    `STAFF_ID` VARCHAR(9) NULL,
    `LUNCH` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `STAFF ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lunch_all` (
    `STAFF_ID` VARCHAR(8) NULL,
    `LUNCH` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `STAFF ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `management_staff` (
    `STAFF_ID` VARCHAR(8) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `maritalstatus` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NULL,
    `name` VARCHAR(20) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medicalcondition` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medicallimit` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `grade` VARCHAR(30) NOT NULL,
    `amount` DECIMAL(30, 2) NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `posting_date` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `status` VARCHAR(20) NULL,
    `approved_by` VARCHAR(50) NULL,
    `approved_date` DATE NULL,

    UNIQUE INDEX `grade`(`grade`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `medicalsymptom` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mid_month_jan` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `gross` DECIMAL(30, 2) NOT NULL,
    `tax` DECIMAL(30, 2) NOT NULL,
    `net` DECIMAL(30, 2) NOT NULL,
    `account_number` VARCHAR(30) NOT NULL,
    `emp_id` BIGINT NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `month_bonus_cont` (
    `aff_id` VARCHAR(8) NULL,
    `first_name` VARCHAR(10) NULL,
    `middle_name` VARCHAR(6) NULL,
    `last_name` VARCHAR(12) NULL,
    `amount` DECIMAL(20, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nat_fees` (
    `staff_id` VARCHAR(8) NULL,
    `Amount` DECIMAL(30, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `new_grades` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(50) NULL,
    `recruitment_date` DATE NULL,
    `new_id` VARCHAR(20) NULL,
    `notch` VARCHAR(20) NULL,
    `notch_id` VARCHAR(10) NOT NULL,
    `gender` VARCHAR(20) NULL,
    `birthday` DATE NULL,
    `department` VARCHAR(50) NULL,
    `account_number` VARCHAR(50) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `new_paystructure` (
    `id` BIGINT NOT NULL,
    `amount` VARCHAR(30) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `new_rent` (
    `id` INTEGER NULL,
    `name` VARCHAR(25) NULL,
    `old` INTEGER NULL,
    `new` INTEGER NULL,
    `backlog` INTEGER NULL,
    `account_number` VARCHAR(20) NULL,
    `emp_id` BIGINT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `new_salaries` (
    `id` BIGINT NOT NULL,
    `employee` VARCHAR(100) NOT NULL,
    `account_no` VARCHAR(100) NOT NULL,
    `basic_salary` VARCHAR(75) NOT NULL,
    `car_allowance` VARCHAR(50) NOT NULL,
    `honorarium` DECIMAL(10, 2) NOT NULL,
    `transport` DECIMAL(10, 2) NOT NULL,
    `lunch` DECIMAL(10, 2) NOT NULL,
    `rent_witheld` DECIMAL(10, 2) NOT NULL,
    `monthly_rent` DECIMAL(10, 2) NOT NULL,
    `nassit` DECIMAL(10, 2) NOT NULL,
    `medical_excess` DECIMAL(10, 2) NOT NULL,
    `union_dues` DECIMAL(10, 2) NOT NULL,
    `basic_after_nassit` DECIMAL(10, 2) NOT NULL,
    `total_allowance` DECIMAL(10, 2) NOT NULL,
    `gross_salary` DECIMAL(10, 2) NOT NULL,
    `taxable_basic` DECIMAL(10, 2) NOT NULL,
    `taxable_income` DECIMAL(10, 2) NOT NULL,
    `paye` DECIMAL(10, 2) NOT NULL,
    `taxable_allowance` DECIMAL(10, 2) NOT NULL,
    `total_deduction` DECIMAL(10, 2) NOT NULL,
    `net_salary` DECIMAL(10, 2) NOT NULL,
    `date_created` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `no_department` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` VARCHAR(50) NOT NULL,
    `first_name` VARCHAR(50) NOT NULL,
    `middle_name` VARCHAR(50) NULL,
    `last_name` VARCHAR(50) NOT NULL,
    `department` BIGINT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notches_4` (
    `ID` VARCHAR(9) NULL,
    `NOTCH` VARCHAR(3) NULL,

    UNIQUE INDEX `ID`(`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paygrades_1` (
    `ID` VARCHAR(9) NULL,
    `pay_grade` INTEGER NULL,

    UNIQUE INDEX `ID`(`ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paymenttype` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(100) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quarter` (
    `employee_id` VARCHAR(8) NULL,

    UNIQUE INDEX `employee_id`(`employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registeredhospitals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` TEXT NOT NULL,
    `account` VARCHAR(30) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `account`(`account`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rent` (
    `Staff_ID` VARCHAR(8) NULL,
    `Amount` DECIMAL(9, 2) NULL,

    UNIQUE INDEX `Staff_ID`(`Staff_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rent2022` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `component` VARCHAR(10) NOT NULL,
    `amount` DECIMAL(30, 2) NOT NULL,
    `account_number` VARCHAR(20) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rent_1` (
    `AFF_ID` VARCHAR(8) NULL,
    `FIRST NAME` VARCHAR(14) NULL,
    `MIDDLE NAME` VARCHAR(27) NULL,
    `LAST NAME` VARCHAR(16) NULL,
    ` 2023_RENT` DECIMAL(8, 2) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rent_cont` (
    `AFF_ID` VARCHAR(8) NULL,
    `FIRST NAME` VARCHAR(10) NULL,
    `2023_RENT` DECIMAL(8, 2) NULL,

    UNIQUE INDEX `AFF_ID`(`AFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salaries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `component` VARCHAR(50) NULL DEFAULT 'All Notches',
    `state` VARCHAR(50) NOT NULL,
    `percentage_change` VARCHAR(20) NOT NULL,
    `date` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salaries1` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(10) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sewing_cont` (
    `aff_id` VARCHAR(8) NULL,
    `first_name` VARCHAR(10) NULL,
    `total` VARCHAR(8) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sewing_perm` (
    `AFF_ID` VARCHAR(8) NULL,
    `FIRST_NAME` VARCHAR(10) NULL,
    ` TOTAL` VARCHAR(8) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `special` (
    `STAFF_ID` VARCHAR(9) NULL,
    `SPECIAL_ALLOWANCE` DECIMAL(6, 2) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `special_all` (
    `STAFF_ID` VARCHAR(8) NULL,
    `SPECIAL` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_upgrade` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `branch` VARCHAR(50) NOT NULL,
    `account_number` VARCHAR(20) NOT NULL,
    `old_id` VARCHAR(20) NOT NULL,
    `new_id` VARCHAR(20) NOT NULL,
    `pay_grade` VARCHAR(10) NOT NULL,
    `notch` VARCHAR(10) NOT NULL,
    `employee` BIGINT NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staffmedical_hist` (
    `id` BIGINT NOT NULL,
    `employee` VARCHAR(20) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NULL,
    `admission_type` VARCHAR(20) NOT NULL,
    `type_of_illness` VARCHAR(100) NOT NULL,
    `medication_given` VARCHAR(100) NOT NULL,
    `cost` DECIMAL(30, 2) NOT NULL,
    `mode_of_payment` VARCHAR(50) NULL,
    `hospital` VARCHAR(50) NOT NULL,
    `physician` VARCHAR(50) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing', 'Submitted', 'Draft', 'Pending Approval') NULL DEFAULT 'Draft',
    `posted_by` VARCHAR(20) NULL,
    `approved_date` DATE NULL,
    `approved_by` VARCHAR(50) NULL,
    `attachment1` TEXT NULL,
    `attachment2` TEXT NULL,
    `attachment3` TEXT NULL,
    `reference` VARCHAR(50) NULL,
    `api_response` VARCHAR(100) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `systemdata` (
    `id` BIGINT NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `value` TEXT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_branch` (
    `id` BIGINT NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `description` VARCHAR(100) NOT NULL,
    `meta` VARCHAR(20) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `temp` (
    `id` BIGINT NOT NULL,
    `employee` VARCHAR(100) NOT NULL,
    `account_no` VARCHAR(100) NOT NULL,
    `basic_salary` DECIMAL(20, 2) NOT NULL,
    `car_allowance` DECIMAL(20, 2) NOT NULL,
    `honorarium` DECIMAL(20, 2) NOT NULL,
    `transport` DECIMAL(20, 2) NOT NULL,
    `lunch` DECIMAL(20, 2) NOT NULL,
    `rent_witheld` DECIMAL(20, 2) NOT NULL,
    `monthly_rent` DECIMAL(20, 2) NOT NULL,
    `nassit` DECIMAL(20, 2) NOT NULL,
    `medical_excess` DECIMAL(20, 2) NOT NULL,
    `union_dues` DECIMAL(20, 2) NOT NULL,
    `basic_after_nassit` DECIMAL(20, 2) NOT NULL,
    `total_allowance` DECIMAL(20, 2) NOT NULL,
    `gross_salary` DECIMAL(20, 2) NOT NULL,
    `taxable_income` DECIMAL(20, 2) NOT NULL,
    `taxable_allowance` DECIMAL(20, 2) NOT NULL,
    `total_deduction` DECIMAL(20, 2) NOT NULL,
    `net_salary` DECIMAL(20, 2) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `titles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport` (
    `STAFF_ID` VARCHAR(9) NULL,
    `TRANSPORT` DECIMAL(7, 2) NULL,

    UNIQUE INDEX `STAFF_ID`(`STAFF_ID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `upload` (
    `first_name` VARCHAR(9) NULL,
    `middle_name` VARCHAR(9) NULL,
    `last_name` VARCHAR(10) NULL,
    `dob` VARCHAR(10) NULL,
    `employee_id` VARCHAR(9) NULL,
    `nationality` INTEGER NULL,
    `SSN` VARCHAR(17) NULL,
    `marital_status` VARCHAR(7) NULL,
    `gender` VARCHAR(1) NULL,
    `pay_grade` VARCHAR(2) NULL,
    `doe` VARCHAR(10) NULL,
    `date_appiont` VARCHAR(10) NULL,
    `supervisor` VARCHAR(9) NULL,
    `sup` INTEGER NULL,
    `staff_category` VARCHAR(15) NULL,
    `bank_name` VARCHAR(21) NULL,
    `address1` VARCHAR(36) NULL,
    `address2` VARCHAR(22) NULL,
    `employment_type` INTEGER NULL,
    `notch` VARCHAR(14) NULL,
    `bank_account` VARCHAR(20) NULL,
    `mobile_phone` VARCHAR(9) NULL,
    `email` VARCHAR(29) NULL,
    `branch` VARCHAR(3) NULL,
    `department` VARCHAR(3) NULL,

    UNIQUE INDEX `employee_id`(`employee_id`),
    UNIQUE INDEX `bank_account`(`bank_account`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `codelist` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `codelist_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `codelistvalue` (
    `id` VARCHAR(191) NOT NULL,
    `codeListId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `codelistvalue_codeListId_code_key`(`codeListId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vw_departments` (
    `id` BIGINT NULL,
    `title` TINYTEXT NULL,
    `comp_code` VARCHAR(20) NULL,
    `description` TEXT NULL,
    `address` TEXT NULL,
    `type` ENUM('Head Office', 'Branch', 'Department', 'Unit', 'Outlet', 'Other') NULL,
    `country` VARCHAR(2) NULL,
    `parent` BIGINT NULL,
    `timezone` VARCHAR(100) NULL,
    `comp_reg` VARCHAR(50) NULL,
    `heads` VARCHAR(255) NULL,
    `nassit` VARCHAR(50) NULL,
    `tin` VARCHAR(50) NULL,
    `ref` VARCHAR(10) NULL,
    `posting_date` DATE NULL,
    `approval_status` VARCHAR(20) NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vw_employeeimprest` (
    `id` BIGINT NULL,
    `employee` BIGINT NULL,
    `imprest_gl` VARCHAR(50) NULL,
    `type` VARCHAR(200) NULL,
    `purpose` VARCHAR(200) NULL,
    `ref_no` VARCHAR(20) NULL,
    `emp_acc_no` VARCHAR(50) NULL,
    `cost_unit` VARCHAR(50) NULL,
    `cost_dept` VARCHAR(50) NULL,
    `branch` VARCHAR(10) NULL,
    `xcg_rate` DECIMAL(20, 2) NULL,
    `imprest_contra` VARCHAR(50) NULL,
    `travel_from` VARCHAR(200) NULL,
    `travel_to` VARCHAR(200) NULL,
    `travel_date` DATETIME(0) NULL,
    `return_date` DATETIME(0) NULL,
    `details` VARCHAR(500) NULL,
    `payment_method` VARCHAR(50) NULL,
    `funding` DECIMAL(10, 2) NULL,
    `local_eqv` DECIMAL(30, 2) NULL,
    `currency` VARCHAR(20) NULL,
    `attachment1` VARCHAR(100) NULL,
    `attachment2` VARCHAR(100) NULL,
    `attachment3` VARCHAR(100) NULL,
    `comment` VARCHAR(100) NULL,
    `created` DATETIME(0) NULL,
    `updated` DATETIME(0) NULL,
    `beneficiary` BIGINT NULL,
    `beneficiary_acc` VARCHAR(50) NULL,
    `app_type` VARCHAR(10) NULL,
    `posting_date` DATETIME(0) NULL,
    `status` ENUM('Approved', 'Pending', 'Rejected', 'Cancellation Requested', 'Cancelled', 'Processing') NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workinjuries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee` BIGINT NOT NULL,
    `injury_type` VARCHAR(50) NOT NULL,
    `details` VARCHAR(100) NULL,
    `injury_date` DATE NULL,
    `off_start_date` DATE NULL,
    `off_end_date` DATE NULL,
    `status` VARCHAR(10) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `codelistvalue` ADD CONSTRAINT `codelistvalue_codeListId_fkey` FOREIGN KEY (`codeListId`) REFERENCES `codelist`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
