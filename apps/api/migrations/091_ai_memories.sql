-- 091_ai_memories.sql - AI 跨会话记忆表

CREATE TABLE IF NOT EXISTS `ai_memories` (
  `id` text PRIMARY KEY,
  `user_id` text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  `session_id` text NOT NULL,
  `type` text NOT NULL DEFAULT 'operation',
  `summary` text NOT NULL,
  `embedding_id` text,
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_user_created
  ON ai_memories(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_user_type
  ON ai_memories(user_id, type);
