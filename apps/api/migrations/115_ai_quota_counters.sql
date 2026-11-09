-- 115_ai_quota_counters.sql
-- AI 配额原子计数（幂等）
--
-- 背景：
--   原先 checkAiQuota 只统计已落库的 ai_usage_events，并发请求会同时通过校验，
--   日配额与分钟限流都能被 burst 击穿。
--
-- 方案：
--   ai_quota_counters 以 (user_id, window_key) 为唯一键保存窗口内的请求数/token 数，
--   窗口键：
--     day:YYYY-MM-DD          → 日配额（UTC）
--     min:YYYY-MM-DDTHH:mm    → 分钟限流（UTC）
--   预扣通过单条 INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING 完成，
--   由 D1 串行写保证并发正确性；条件不满足时不更新且不返回行，即为超额拒绝路径。

CREATE TABLE IF NOT EXISTS ai_quota_counters (
  user_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, window_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_quota_counters_updated_at ON ai_quota_counters(updated_at);
