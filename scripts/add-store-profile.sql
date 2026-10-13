-- Per-store settings the owner teaches opsAi (deposit rule, label dictionary, vendor nicknames).
-- Safe to run more than once. Run in the Supabase SQL editor before deploying the matching code.
ALTER TABLE store_config ADD COLUMN IF NOT EXISTS profile_json JSONB;
