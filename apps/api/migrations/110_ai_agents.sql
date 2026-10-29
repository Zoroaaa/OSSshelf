-- 110_ai_agents.sql
-- AI 运行时升级（Cloudflare Agents SDK）配套表
-- - ai_usage_events: 真实用量/成本/延迟/错误记账
-- - file_chunks: 分块正文（Vectorize 只存向量，检索时回表取正文）
-- - ai_task_items: 队列任务逐文件状态（幂等 + 真续跑）
-- - ai_feature_config: 功能级模型配置从 KV 迁入 D1
-- - files_fts: 文件名/描述/摘要/标签的 FTS5 关键词索引

CREATE TABLE IF NOT EXISTS `ai_usage_events` (
  `id` text PRIMARY KEY,
  `user_id` text NOT NULL,
  `session_id` text,
  `request_id` text,
  `feature` text NOT NULL DEFAULT 'chat',
  `provider` text NOT NULL,
  `model_id` text NOT NULL,
  `input_tokens` integer NOT NULL DEFAULT 0,
  `output_tokens` integer NOT NULL DEFAULT 0,
  `cached_tokens` integer NOT NULL DEFAULT 0,
  `latency_ms` integer NOT NULL DEFAULT 0,
  `tool_calls` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'completed',
  `error_code` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_model ON ai_usage_events(user_id, model_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_session ON ai_usage_events(session_id);

CREATE TABLE IF NOT EXISTS `file_chunks` (
  `id` text PRIMARY KEY,
  `file_id` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `embedding_model` text NOT NULL,
  `token_count` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunks_file_index ON file_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_file_chunks_file ON file_chunks(file_id);

CREATE TABLE IF NOT EXISTS `ai_task_items` (
  `id` text PRIMARY KEY,
  `task_id` text NOT NULL,
  `file_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `attempts` integer NOT NULL DEFAULT 0,
  `error` text,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_task_items_task_file ON ai_task_items(task_id, file_id);
CREATE INDEX IF NOT EXISTS idx_ai_task_items_task_status ON ai_task_items(task_id, status);

CREATE TABLE IF NOT EXISTS `ai_feature_config` (
  `id` text PRIMARY KEY,
  `user_id` text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  `feature` text NOT NULL,
  `model_id` text,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feature_config_user_feature ON ai_feature_config(user_id, feature);

-- FTS5 关键词索引（应用层 syncFileFts 维护；D1 若不支持 FTS5 则检索层自动回退 LIKE）
CREATE VIRTUAL TABLE IF NOT EXISTS `files_fts` USING fts5(
  `file_id` UNINDEXED,
  `name`,
  `description`,
  `ai_summary`,
  `ai_tags`,
  tokenize = 'unicode61'
);
