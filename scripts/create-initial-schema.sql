-- Create initial database schema for opsAi
-- Run this FIRST if tables don't exist yet

-- Step 1: Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NULL, -- Nullable for OAuth users
  name VARCHAR(255) NULL,
  picture VARCHAR(500) NULL,
  provider VARCHAR(50) DEFAULT 'email',
  provider_id VARCHAR(255) NULL,
  provider_data JSONB NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_provider_provider_id ON users(provider, provider_id);

-- Step 2: Create store_config table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS store_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id VARCHAR(50) UNIQUE NOT NULL,
  store_name VARCHAR(255) NOT NULL,
  sheet_id VARCHAR(255) NOT NULL,
  timezone VARCHAR(100) DEFAULT 'America/New_York',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_config_store_id ON store_config(store_id);

-- Step 3: Create user_stores junction table
CREATE TABLE IF NOT EXISTS user_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id VARCHAR(50) NOT NULL REFERENCES store_config(store_id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'MANAGER', 'STAFF')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stores_user_id ON user_stores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stores_store_id ON user_stores(store_id);

-- Step 4: Create other existing tables (if they don't exist)

-- user_directory table (for WhatsApp phone directory)
CREATE TABLE IF NOT EXISTS user_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(255) NULL,
  role VARCHAR(20) DEFAULT 'STAFF' CHECK (role IN ('OWNER', 'MANAGER', 'STAFF')),
  store_id VARCHAR(50) NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_directory_phone_e164 ON user_directory(phone_e164);
CREATE INDEX IF NOT EXISTS idx_user_directory_store_id ON user_directory(store_id);

-- pending_actions table
CREATE TABLE IF NOT EXISTS pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID UNIQUE DEFAULT gen_random_uuid(),
  phone_e164 VARCHAR(20) NOT NULL,
  store_id VARCHAR(50) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('ORDER_REQUEST', 'STORE_SALES', 'FUEL_SALES', 'INVOICE_EXPENSE', 'PAID_OUT', 'UNKNOWN')),
  payload_json JSONB NOT NULL,
  confidence FLOAT NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
  message_id_inbound VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_phone_status ON pending_actions(phone_e164, status);
CREATE INDEX IF NOT EXISTS idx_pending_actions_store_id ON pending_actions(store_id);
CREATE INDEX IF NOT EXISTS idx_pending_actions_action_id ON pending_actions(action_id);

-- vendor_contacts table
CREATE TABLE IF NOT EXISTS vendor_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id VARCHAR(50) NOT NULL,
  vendor_name VARCHAR(255) NOT NULL,
  send_method VARCHAR(20) NOT NULL CHECK (send_method IN ('WHATSAPP', 'SMS', 'EMAIL')),
  destination VARCHAR(255) NOT NULL,
  format_template TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_contacts_store_vendor ON vendor_contacts(store_id, vendor_name);

-- message_log table
CREATE TABLE IF NOT EXISTS message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id VARCHAR(255) UNIQUE NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  store_id VARCHAR(50) NULL,
  message_type VARCHAR(50) NOT NULL,
  message_text TEXT NULL,
  media_url VARCHAR(500) NULL,
  media_id VARCHAR(255) NULL,
  classification VARCHAR(50) NULL,
  extracted_data JSONB NULL,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_log_message_id ON message_log(message_id);
CREATE INDEX IF NOT EXISTS idx_message_log_phone_e164 ON message_log(phone_e164);
CREATE INDEX IF NOT EXISTS idx_message_log_store_id ON message_log(store_id);
CREATE INDEX IF NOT EXISTS idx_message_log_created_at ON message_log(created_at);

-- Verify tables were created
SELECT 
  table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'store_config', 'user_stores', 'user_directory', 'pending_actions', 'vendor_contacts', 'message_log')
ORDER BY table_name;
