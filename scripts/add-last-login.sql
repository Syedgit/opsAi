-- Owner last login, for the CEO usage page. Safe to run more than once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
