-- OSSshelf Database Schema
-- Cloudflare D1 (SQLite) 初始化脚本
-- 包含所有表结构和索引

-- ═══════════════════════════════════════════════════════════════════════════
-- 用户表
-- ═══════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件表
-- ═══════════════════════════════════════════════════════════════════════════
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
  deleted_at TEXT,
  bucket_id TEXT REFERENCES storage_buckets(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 分享表
-- ═══════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- WebDAV 会话表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS webdav_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 存储桶配置表（多厂商支持）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS storage_buckets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  endpoint TEXT,
  region TEXT,
  access_key_id TEXT NOT NULL,
  secret_access_key TEXT NOT NULL,
  path_style INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  storage_used INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  storage_quota INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 索引
-- ═══════════════════════════════════════════════════════════════════════════

-- files 表索引
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(user_id, path);
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_files_bucket_id ON files(bucket_id);

-- shares 表索引
CREATE INDEX IF NOT EXISTS idx_shares_user_id ON shares(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);

-- storage_buckets 表索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_buckets_user_default
  ON storage_buckets(user_id)
  WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_storage_buckets_user_id ON storage_buckets(user_id);
