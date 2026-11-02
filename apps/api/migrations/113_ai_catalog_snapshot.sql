-- 113_ai_catalog_snapshot.sql
-- models.dev 运行时快照：优先于代码内置快照，表缺失时自动回退。

CREATE TABLE IF NOT EXISTS ai_catalog_snapshot (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  generated_at TEXT,
  fetched_at TEXT NOT NULL,
  provider_count INTEGER NOT NULL DEFAULT 0,
  model_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'models.dev'
);
