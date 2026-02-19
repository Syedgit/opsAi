-- Manual migration for OAuth support
-- Run this SQL directly in Supabase SQL Editor if Prisma migrations fail
-- NOTE: If "users" table doesn't exist, run create-initial-schema.sql FIRST

-- Step 1: Make password nullable (for OAuth users)
-- Only run this if users table exists and password column is NOT NULL
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' 
    AND column_name = 'password' 
    AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
  END IF;
END $$;

-- Step 2: Add OAuth fields
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS picture VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS provider_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS provider_data JSONB NULL;

-- Step 3: Create index for OAuth lookup
CREATE INDEX IF NOT EXISTS idx_users_provider_provider_id ON users(provider, provider_id);

-- Step 4: Create user_stores junction table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS user_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id VARCHAR(50) NOT NULL REFERENCES store_config(store_id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'OWNER' CHECK (role IN ('OWNER', 'MANAGER', 'STAFF')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, store_id)
);

-- Step 5: Create indexes for user_stores
CREATE INDEX IF NOT EXISTS idx_user_stores_user_id ON user_stores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stores_store_id ON user_stores(store_id);

-- Verify the changes
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;

SELECT 
  table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'user_stores');
