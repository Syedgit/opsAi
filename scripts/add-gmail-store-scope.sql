-- Move Gmail from per-user to per-store (one inbox per business).
-- Safe-ish to re-run; destructive only if duplicate store_id would collide.

ALTER TABLE "gmail_connections" ADD COLUMN IF NOT EXISTS "store_id" TEXT;

-- Attach existing user-scoped rows to that user's first owned store.
UPDATE "gmail_connections" gc
SET "store_id" = sub.store_id
FROM (
  SELECT DISTINCT ON (us.user_id)
    us.user_id::text AS user_id,
    us.store_id
  FROM user_stores us
  WHERE us.role::text = 'OWNER'
  ORDER BY us.user_id, us.created_at ASC NULLS LAST
) sub
WHERE gc.store_id IS NULL
  AND gc.user_id::text = sub.user_id;

-- Drop rows we cannot place on a store.
DELETE FROM "gmail_connections" WHERE "store_id" IS NULL;

DROP INDEX IF EXISTS "gmail_connections_user_id_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gmail_connections_store_id_fkey'
  ) THEN
    ALTER TABLE "gmail_connections"
      ADD CONSTRAINT "gmail_connections_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "store_config"("store_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "gmail_connections_store_id_key" ON "gmail_connections"("store_id");
CREATE INDEX IF NOT EXISTS "gmail_connections_user_id_idx" ON "gmail_connections"("user_id");

ALTER TABLE "gmail_connections" ALTER COLUMN "store_id" SET NOT NULL;
