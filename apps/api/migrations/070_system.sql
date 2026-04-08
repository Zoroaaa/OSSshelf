-- 070_system.sql - 系统功能：搜索历史、通知、审计日志、全文搜索

-- ═══════════════════════════════════════════════════════════════════════════
-- 搜索历史表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS search_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 通知系统表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  data        TEXT,
  is_read     INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- ═══════════════════════════════════════════════════════════════════════════
-- 审计日志表
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- FTS5 全文搜索虚拟表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  ai_summary,
  content='files',
  content_rowid=rowid,
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files 
BEGIN 
  INSERT INTO files_fts(rowid,id,name,description,ai_summary) 
  VALUES (NEW.rowid,NEW.id,NEW.name,NEW.description,NEW.ai_summary); 
END;

CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files 
BEGIN 
  UPDATE files_fts 
  SET name=NEW.name,description=NEW.description,ai_summary=NEW.ai_summary 
  WHERE rowid=NEW.rowid; 
END;

CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files 
BEGIN 
  DELETE FROM files_fts WHERE rowid=OLD.rowid; 
END;
