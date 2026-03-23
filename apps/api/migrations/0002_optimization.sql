-- OSSshelf Database Schema - Performance Optimization Migration
-- Cloudflare D1 (SQLite) 性能优化索引
-- 此迁移添加性能关键索引，提升查询效率

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件表性能索引
-- ═══════════════════════════════════════════════════════════════════════════

-- 用户+父目录复合索引（最常用的文件列表查询）
CREATE INDEX IF NOT EXISTS idx_files_user_parent_active
  ON files(user_id, parent_id)
  WHERE deleted_at IS NULL;

-- 用户+删除时间索引（回收站查询优化）
CREATE INDEX IF NOT EXISTS idx_files_user_deleted
  ON files(user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 文件类型索引（按类型筛选）
CREATE INDEX IF NOT EXISTS idx_files_user_type
  ON files(user_id, type)
  WHERE deleted_at IS NULL;

-- MIME类型索引（按文件类别筛选）
CREATE INDEX IF NOT EXISTS idx_files_user_mime
  ON files(user_id, mime_type)
  WHERE deleted_at IS NULL AND mime_type IS NOT NULL;

-- 创建时间索引（按时间排序）
CREATE INDEX IF NOT EXISTS idx_files_user_created
  ON files(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- 更新时间索引（最近修改）
CREATE INDEX IF NOT EXISTS idx_files_user_updated
  ON files(user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

-- 文件大小索引（按大小排序）
CREATE INDEX IF NOT EXISTS idx_files_user_size
  ON files(user_id, size DESC)
  WHERE deleted_at IS NULL AND is_folder = 0;

-- 文件哈希索引（去重查询）
CREATE INDEX IF NOT EXISTS idx_files_hash
  ON files(hash)
  WHERE hash IS NOT NULL AND deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 分享表性能索引
-- ═══════════════════════════════════════════════════════════════════════════

-- 过期时间索引（清理过期分享）
CREATE INDEX IF NOT EXISTS idx_shares_expires
  ON shares(expires_at)
  WHERE expires_at IS NOT NULL;

-- 用户分享列表索引
CREATE INDEX IF NOT EXISTS idx_shares_user_created
  ON shares(user_id, created_at DESC);

-- 文件分享关联索引（检查文件是否已分享）
CREATE INDEX IF NOT EXISTS idx_shares_file_active
  ON shares(file_id, expires_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 存储桶表性能索引
-- ═══════════════════════════════════════════════════════════════════════════

-- 用户活跃存储桶索引
CREATE INDEX IF NOT EXISTS idx_buckets_user_active
  ON storage_buckets(user_id, is_active)
  WHERE is_active = 1;

-- 存储桶厂商索引（按厂商统计）
CREATE INDEX IF NOT EXISTS idx_buckets_provider
  ON storage_buckets(provider);

-- ═══════════════════════════════════════════════════════════════════════════
-- 用户表性能索引
-- ═══════════════════════════════════════════════════════════════════════════

-- 角色索引（管理员查询）
CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role);

-- 创建时间索引（用户注册统计）
CREATE INDEX IF NOT EXISTS idx_users_created
  ON users(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件标签表（新增）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS file_tags (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_tags_file
  ON file_tags(file_id);

CREATE INDEX IF NOT EXISTS idx_file_tags_user_name
  ON file_tags(user_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_tags_unique
  ON file_tags(file_id, name);

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件权限表（新增）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS file_permissions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'read',
  granted_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_permissions_file
  ON file_permissions(file_id);

CREATE INDEX IF NOT EXISTS idx_file_permissions_user
  ON file_permissions(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_permissions_unique
  ON file_permissions(file_id, user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 审计日志表（新增）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
  ON audit_logs(resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 登录安全表（新增）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email
  ON login_attempts(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON login_attempts(ip_address, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 用户设备表（新增）
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT,
  ip_address TEXT,
  user_agent TEXT,
  last_active TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user
  ON user_devices(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_unique
  ON user_devices(user_id, device_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 分片上传任务表（新增）
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_upload_tasks_user
  ON upload_tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_upload_tasks_expires
  ON upload_tasks(expires_at)
  WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════════
-- 离线下载任务表（新增）
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

CREATE INDEX IF NOT EXISTS idx_download_tasks_user
  ON download_tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_download_tasks_status
  ON download_tasks(status, created_at DESC);
