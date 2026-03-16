-- OSSshelf initial schema
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  storage_quota INTEGER NOT NULL DEFAULT 10737418240,
  storage_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  mime_type TEXT,
  hash TEXT,
  is_folder INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password TEXT,
  expires_at TEXT,
  download_limit INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webdav_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(user_id, path);
CREATE INDEX IF NOT EXISTS idx_shares_user_id ON shares(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);
