-- whatsapp_group_provisions + enum (aligned with prisma/schema.prisma).
-- Prefer: npx prisma db push   or   npx prisma migrate dev

DO $$
BEGIN
  CREATE TYPE "WhatsAppGroupProvisionStatus" AS ENUM ('PENDING_WEBHOOK', 'LINKED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "whatsapp_group_provisions" (
  "id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "created_by_user_id" TEXT,
  "status" "WhatsAppGroupProvisionStatus" NOT NULL DEFAULT 'PENDING_WEBHOOK',
  "subject" TEXT NOT NULL,
  "description" TEXT,
  "join_approval_mode" TEXT NOT NULL DEFAULT 'auto_approve',
  "meta_request_id" TEXT,
  "whatsapp_group_id" TEXT,
  "invite_link" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "whatsapp_group_provisions_pkey" PRIMARY KEY ("id")
);

-- FK to store_config (store_id is PK on store_config in Prisma)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_group_provisions_store_id_fkey'
  ) THEN
    ALTER TABLE "whatsapp_group_provisions"
      ADD CONSTRAINT "whatsapp_group_provisions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "store_config"("store_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_group_provisions_meta_request_id_key"
  ON "whatsapp_group_provisions" ("meta_request_id");

CREATE INDEX IF NOT EXISTS "whatsapp_group_provisions_store_id_idx"
  ON "whatsapp_group_provisions" ("store_id");

CREATE INDEX IF NOT EXISTS "whatsapp_group_provisions_status_idx"
  ON "whatsapp_group_provisions" ("status");
