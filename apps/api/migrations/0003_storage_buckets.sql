-- Storage bucket configurations (multi-vendor support)
CREATE TABLE IF NOT EXISTS storage_buckets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- Display name
  provider TEXT NOT NULL,           -- 'r2' | 's3' | 'oss' | 'cos' | 'obs' | 'b2' | 'custom'
  bucket_name TEXT NOT NULL,        -- Actual bucket name at provider
  endpoint TEXT,                    -- Custom endpoint URL (for non-AWS S3)
  region TEXT,                      -- AWS region or provider region
  access_key_id TEXT NOT NULL,      -- Encrypted access key
  secret_access_key TEXT NOT NULL,  -- Encrypted secret key
  path_style INTEGER NOT NULL DEFAULT 0,  -- Force path-style URLs (0=virtual-hosted, 1=path-style)
  is_default INTEGER NOT NULL DEFAULT 0,  -- Whether this is the default bucket
  is_active INTEGER NOT NULL DEFAULT 1,   -- Whether this bucket is active
  storage_used INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Each user can only have one default bucket
CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_buckets_user_default
  ON storage_buckets(user_id)
  WHERE is_default = 1;

CREATE INDEX IF NOT EXISTS idx_storage_buckets_user_id ON storage_buckets(user_id);

-- Add bucket_id to files table to track which bucket a file lives in
ALTER TABLE files ADD COLUMN bucket_id TEXT REFERENCES storage_buckets(id) ON DELETE SET NULL;
