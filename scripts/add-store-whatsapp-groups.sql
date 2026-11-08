-- store_whatsapp_groups (aligned with prisma/schema.prisma).
-- Maps a Meta group id to a store. Needed for dashboard "Connected" and group wrap-ups.
-- Prefer: npx prisma db push   or   npx prisma db execute --file scripts/add-store-whatsapp-groups.sql

CREATE TABLE IF NOT EXISTS "store_whatsapp_groups" (
  "id" TEXT NOT NULL,
  "whatsapp_group_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "store_whatsapp_groups_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_whatsapp_groups_store_id_fkey'
  ) THEN
    ALTER TABLE "store_whatsapp_groups"
      ADD CONSTRAINT "store_whatsapp_groups_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "store_config"("store_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "store_whatsapp_groups_whatsapp_group_id_key"
  ON "store_whatsapp_groups" ("whatsapp_group_id");

CREATE INDEX IF NOT EXISTS "store_whatsapp_groups_store_id_idx"
  ON "store_whatsapp_groups" ("store_id");

CREATE INDEX IF NOT EXISTS "store_whatsapp_groups_whatsapp_group_id_idx"
  ON "store_whatsapp_groups" ("whatsapp_group_id");
