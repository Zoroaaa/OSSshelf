-- OSSshelf Database Schema
-- 010_core.sql - 核心表：用户、文件、存储桶、分享

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
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_preferences TEXT NOT NULL DEFAULT '{}',
  password_changed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);

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
  allowed_mime_types TEXT,
  ref_count INTEGER NOT NULL DEFAULT 1,
  direct_link_token TEXT UNIQUE,
  direct_link_expires_at TEXT,
  current_version INTEGER DEFAULT 1,
  max_versions INTEGER DEFAULT 10,
  version_retention_days INTEGER DEFAULT 30,
  description TEXT,
  note_count INTEGER DEFAULT 0,
  ai_summary TEXT,
  ai_summary_at TEXT,
  ai_tags TEXT,
  ai_tags_at TEXT,
  vector_indexed_at TEXT,
  is_starred INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(user_id, path);
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_files_bucket_id ON files(bucket_id);
CREATE INDEX IF NOT EXISTS idx_files_user_parent_active ON files(user_id, parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_user_deleted ON files(user_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_user_type ON files(user_id, type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_user_mime ON files(user_id, mime_type) WHERE deleted_at IS NULL AND mime_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_user_created ON files(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_user_updated ON files(user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_user_size ON files(user_id, size DESC) WHERE deleted_at IS NULL AND is_folder = 0;
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash) WHERE hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_hash_bucket ON files(hash, bucket_id) WHERE hash IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_allowed_mime ON files(user_id, allowed_mime_types);
CREATE INDEX IF NOT EXISTS idx_files_direct_link_token_unique ON files(direct_link_token) WHERE direct_link_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_direct_link_expires ON files(direct_link_expires_at);
CREATE INDEX IF NOT EXISTS idx_files_version_settings ON files(max_versions, version_retention_days);
CREATE INDEX IF NOT EXISTS idx_files_vector_indexed ON files(user_id, vector_indexed_at);
CREATE INDEX IF NOT EXISTS idx_files_ai_summary ON files(user_id, ai_summary_at);
CREATE INDEX IF NOT EXISTS idx_files_ai_tags ON files(user_id, ai_tags_at);
CREATE INDEX IF NOT EXISTS idx_files_is_starred ON files(user_id, is_starred, updated_at DESC);

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
  is_upload_link INTEGER NOT NULL DEFAULT 0,
  upload_token TEXT,
  max_upload_size INTEGER,
  upload_allowed_mime_types TEXT,
  max_upload_count INTEGER,
  upload_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_user_id ON shares(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_file_id ON shares(file_id);
CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shares_user_created ON shares(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shares_file_active ON shares(file_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_upload_token ON shares(upload_token) WHERE upload_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shares_is_upload_link ON shares(user_id, is_upload_link) WHERE is_upload_link = 1;

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_buckets_user_default ON storage_buckets(user_id) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_storage_buckets_user_id ON storage_buckets(user_id);
CREATE INDEX IF NOT EXISTS idx_buckets_user_active ON storage_buckets(user_id, is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_buckets_provider ON storage_buckets(provider);
