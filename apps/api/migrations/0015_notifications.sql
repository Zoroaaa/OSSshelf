-- 0015_notifications.sql
-- 通知系统数据表

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,    -- share_received | mention | permission_granted | quota_warning | ai_complete | system
  title       TEXT NOT NULL,
  body        TEXT,
  data        TEXT,             -- JSON 附加数据
  is_read     INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
