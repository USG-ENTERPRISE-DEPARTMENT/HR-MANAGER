-- Run when this deployment uses the PostgreSQL schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS xauth_employeeid VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_xauth_employeeid ON users(xauth_employeeid);
