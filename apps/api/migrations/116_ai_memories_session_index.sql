-- 116_ai_memories_session_index.sql
-- AI 记忆按 (user_id, session_id) 过滤/清理缺少索引，会话删除或按会话查询会全表扫描

CREATE INDEX IF NOT EXISTS idx_memories_session ON ai_memories(user_id, session_id);
