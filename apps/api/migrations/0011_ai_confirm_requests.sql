-- 0011_ai_confirm_requests.sql
-- AI 工具确认请求表 - 用于存储待用户确认的危险操作

CREATE TABLE IF NOT EXISTS ai_confirm_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    tool_name TEXT NOT NULL,
    args TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_confirm_user_status ON ai_confirm_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_confirm_expires ON ai_confirm_requests(expires_at);
