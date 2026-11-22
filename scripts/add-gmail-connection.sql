-- Per-business Gmail read-only connector (OAuth refresh token). One inbox per store.
-- users.id / store_config.store_id types: UUID user, VARCHAR store_id.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "gmail_connections" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "google_email" TEXT NOT NULL,
  "refresh_token_enc" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "alert_rules_json" JSONB,
  "last_sync_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "gmail_connections_store_id_key" ON "gmail_connections"("store_id");
CREATE INDEX IF NOT EXISTS "gmail_connections_status_idx" ON "gmail_connections"("status");
CREATE INDEX IF NOT EXISTS "gmail_connections_user_id_idx" ON "gmail_connections"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gmail_connections_user_id_fkey'
  ) THEN
    ALTER TABLE "gmail_connections"
      ADD CONSTRAINT "gmail_connections_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gmail_connections_store_id_fkey'
  ) THEN
    ALTER TABLE "gmail_connections"
      ADD CONSTRAINT "gmail_connections_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "store_config"("store_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "gmail_connections" ADD COLUMN IF NOT EXISTS "alert_rules_json" JSONB;
ALTER TABLE "gmail_connections" ADD COLUMN IF NOT EXISTS "store_id" TEXT;
