-- 0009_file_versions.sql
-- 文件版本控制功能
-- 创建 file_versions 表，为 files 表添加版本相关字段

-- 文件版本表
CREATE TABLE IF NOT EXISTS file_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  hash TEXT,
  ref_count INTEGER NOT NULL DEFAULT 1,
  change_summary TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(file_id, version)
);

-- 版本查询索引（按文件ID和创建时间降序）
CREATE INDEX idx_file_versions_file ON file_versions(file_id, created_at DESC);

-- 版本哈希索引（用于去重查询）
CREATE INDEX idx_file_versions_hash ON file_versions(hash);

-- 为 files 表添加版本相关字段
ALTER TABLE files ADD COLUMN current_version INTEGER DEFAULT 1;
ALTER TABLE files ADD COLUMN max_versions INTEGER DEFAULT 10;
ALTER TABLE files ADD COLUMN version_retention_days INTEGER DEFAULT 30;

-- 版本设置索引
CREATE INDEX idx_files_version_settings ON files(max_versions, version_retention_days);
