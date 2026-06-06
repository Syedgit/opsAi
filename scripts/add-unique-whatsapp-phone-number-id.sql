-- Aligns DB with Prisma @unique on StoreConfig.whatsappPhoneNumberId.
-- Run after whatsapp_phone_number_id column exists. Fails if duplicate non-null IDs exist.

CREATE UNIQUE INDEX IF NOT EXISTS store_config_whatsapp_phone_number_id_key
  ON store_config (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;
