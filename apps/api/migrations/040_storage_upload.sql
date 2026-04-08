-- 040_storage_upload.sql - 存储与上传：上传任务、下载任务、Telegram存储

-- ═══════════════════════════════════════════════════════════════════════════
-- 分片上传任务表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS upload_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT,
  parent_id TEXT,
  bucket_id TEXT,
  r2_key TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  total_parts INTEGER NOT NULL,
  uploaded_parts TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_tasks_user ON upload_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_tasks_expires ON upload_tasks(expires_at) WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════
-- 离线下载任务表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS download_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  parent_id TEXT,
  bucket_id TEXT,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_download_tasks_user ON download_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_download_tasks_status ON download_tasks(status, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Telegram 文件引用表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS telegram_file_refs (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL,
  r2_key      TEXT NOT NULL UNIQUE,
  tg_file_id  TEXT NOT NULL,
  tg_file_size INTEGER,
  bucket_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tg_refs_r2key ON telegram_file_refs(r2_key);
CREATE INDEX IF NOT EXISTS idx_tg_refs_file_id ON telegram_file_refs(file_id);
CREATE INDEX IF NOT EXISTS idx_tg_refs_bucket ON telegram_file_refs(bucket_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Telegram 分片存储表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS telegram_file_chunks (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL,
  chunk_index  INTEGER NOT NULL,
  tg_file_id   TEXT NOT NULL,
  chunk_size   INTEGER NOT NULL,
  bucket_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tg_chunks_group ON telegram_file_chunks(group_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_tg_chunks_bucket ON telegram_file_chunks(bucket_id);
