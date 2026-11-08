-- Launch billing: 14-day trial, then Store 25 USD / month. Safe to run more than once.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'store';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_status TEXT DEFAULT 'trial';
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

UPDATE users
SET plan = COALESCE(plan, 'store'),
    plan_status = COALESCE(plan_status, 'trial')
WHERE plan IS NULL OR plan_status IS NULL;

-- Existing accounts get a fresh 14-day trial so going live does not lock anyone out.
UPDATE users
SET trial_ends_at = NOW() + INTERVAL '14 days'
WHERE trial_ends_at IS NULL OR (plan_status = 'trial' AND trial_ends_at < NOW());
