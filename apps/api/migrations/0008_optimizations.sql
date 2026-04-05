-- 0008_optimizations.sql
-- 数据库优化：触发器、清理冗余索引、添加约束

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. 自动更新 updated_at 触发器
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_files_updated_at
AFTER UPDATE ON files
BEGIN
  UPDATE files SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_storage_buckets_updated_at
AFTER UPDATE ON storage_buckets
BEGIN
  UPDATE storage_buckets SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_user_groups_updated_at
AFTER UPDATE ON user_groups
BEGIN
  UPDATE user_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_file_permissions_updated_at
AFTER UPDATE ON file_permissions
BEGIN
  UPDATE file_permissions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_file_notes_updated_at
AFTER UPDATE ON file_notes
BEGIN
  UPDATE file_notes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_models_updated_at
AFTER UPDATE ON ai_models
BEGIN
  UPDATE ai_models SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_chat_sessions_updated_at
AFTER UPDATE ON ai_chat_sessions
BEGIN
  UPDATE ai_chat_sessions SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_config_updated_at
AFTER UPDATE ON ai_config
BEGIN
  UPDATE ai_config SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_updated_at
AFTER UPDATE ON ai_tasks
BEGIN
  UPDATE ai_tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_upload_tasks_updated_at
AFTER UPDATE ON upload_tasks
BEGIN
  UPDATE upload_tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_download_tasks_updated_at
AFTER UPDATE ON download_tasks
BEGIN
  UPDATE download_tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. 存储空间统计触发器
-- ═══════════════════════════════════════════════════════════════════════════

-- 文件创建时：增加用户存储使用量
CREATE TRIGGER IF NOT EXISTS trg_files_storage_insert
AFTER INSERT ON files
WHEN NEW.deleted_at IS NULL AND NEW.is_folder = 0
BEGIN
  UPDATE users SET storage_used = storage_used + NEW.size WHERE id = NEW.user_id;
  UPDATE storage_buckets 
  SET storage_used = storage_used + NEW.size, file_count = file_count + 1 
  WHERE id = NEW.bucket_id;
END;

-- 文件更新时：调整存储使用量（大小变化）
CREATE TRIGGER IF NOT EXISTS trg_files_storage_update
AFTER UPDATE ON files
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL 
     AND OLD.is_folder = 0 AND NEW.is_folder = 0
     AND OLD.size != NEW.size
BEGIN
  UPDATE users SET storage_used = storage_used - OLD.size + NEW.size WHERE id = NEW.user_id;
  UPDATE storage_buckets 
  SET storage_used = storage_used - OLD.size + NEW.size 
  WHERE id = NEW.bucket_id OR id = OLD.bucket_id;
END;

-- 文件删除时：减少存储使用量
CREATE TRIGGER IF NOT EXISTS trg_files_storage_delete
AFTER UPDATE OF deleted_at ON files
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.is_folder = 0
BEGIN
  UPDATE users SET storage_used = storage_used - NEW.size WHERE id = NEW.user_id;
  UPDATE storage_buckets 
  SET storage_used = storage_used - NEW.size, file_count = file_count - 1 
  WHERE id = NEW.bucket_id;
END;

-- 文件恢复时：增加存储使用量
CREATE TRIGGER IF NOT EXISTS trg_files_storage_restore
AFTER UPDATE OF deleted_at ON files
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.is_folder = 0
BEGIN
  UPDATE users SET storage_used = storage_used + NEW.size WHERE id = NEW.user_id;
  UPDATE storage_buckets 
  SET storage_used = storage_used + NEW.size, file_count = file_count + 1 
  WHERE id = NEW.bucket_id;
END;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. 笔记计数触发器
-- ═══════════════════════════════════════════════════════════════════════════

-- 创建笔记时增加计数
CREATE TRIGGER IF NOT EXISTS trg_file_notes_count_insert
AFTER INSERT ON file_notes
WHEN NEW.deleted_at IS NULL
BEGIN
  UPDATE files SET note_count = note_count + 1 WHERE id = NEW.file_id;
END;

-- 删除笔记时减少计数
CREATE TRIGGER IF NOT EXISTS trg_file_notes_count_delete
AFTER UPDATE OF deleted_at ON file_notes
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE files SET note_count = note_count - 1 WHERE id = NEW.file_id;
END;

-- 恢复笔记时增加计数
CREATE TRIGGER IF NOT EXISTS trg_file_notes_count_restore
AFTER UPDATE OF deleted_at ON file_notes
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  UPDATE files SET note_count = note_count + 1 WHERE id = NEW.file_id;
END;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. AI 会话最后消息时间触发器
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TRIGGER IF NOT EXISTS trg_ai_chat_sessions_message
AFTER INSERT ON ai_chat_messages
BEGIN
  UPDATE ai_chat_sessions SET updated_at = datetime('now') WHERE id = NEW.session_id;
END;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. 删除冗余索引（可选，根据实际查询模式决定）
-- ═══════════════════════════════════════════════════════════════════════════

-- 以下索引可能冗余，建议在确认查询模式后删除：
-- DROP INDEX IF EXISTS idx_files_user_id;
-- DROP INDEX IF EXISTS idx_files_deleted_at;
-- DROP INDEX IF EXISTS idx_files_bucket_id;
-- DROP INDEX IF EXISTS idx_files_allowed_mime;
-- DROP INDEX IF EXISTS idx_files_version_settings;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. 添加有用的约束和索引
-- ═══════════════════════════════════════════════════════════════════════════

-- 防止同一用户短时间内重复请求同一类型验证码
-- SQLite 不支持部分唯一索引带表达式，这里用普通索引
CREATE INDEX IF NOT EXISTS idx_email_tokens_user_type_created 
  ON email_tokens(user_id, type, created_at);

-- AI 任务状态变更时间索引
CREATE INDEX IF NOT EXISTS idx_ai_tasks_completed 
  ON ai_tasks(completed_at) WHERE completed_at IS NOT NULL;
