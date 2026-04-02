-- 0018_email.sql
-- 邮件通知系统数据表

-- 邮件验证Token表（注册验证、密码重置、邮箱更换）
CREATE TABLE IF NOT EXISTS email_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  type        TEXT NOT NULL,  -- verify_email | reset_password | change_email
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, type);
CREATE INDEX IF NOT EXISTS idx_email_tokens_expires ON email_tokens(expires_at);

-- users表新增字段
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_preferences TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
