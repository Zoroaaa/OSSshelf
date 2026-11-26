-- 124_ai_ingest_assets.sql
-- 上传资产的解析策略与状态：一次登记，按步骤（摘要/标签/向量）排队，可单独重试失败步骤。
-- 状态是"派生 + 落库"：读取时按 ai_tasks 的完成情况重算并回写，避免队列中断后状态永远停在 processing。
CREATE TABLE IF NOT EXISTS ai_ingest_assets (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  policy TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  task_ids TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_ingest_assets_file ON ai_ingest_assets(file_id);
CREATE INDEX IF NOT EXISTS idx_ai_ingest_assets_user ON ai_ingest_assets(user_id, updated_at);