-- 114_ai_request_timeout_90s.sql
-- 视觉/大模型调用耗时可能超过 60 秒：将默认请求超时提升到 90 秒。
-- 只调整 <= 60s 的存量值，已自定义为更长超时的配置保持不变。

UPDATE ai_config
SET number_value = 90000,
    default_value = '90000',
    updated_at = datetime('now')
WHERE key = 'ai.request.timeout_ms'
  AND (number_value IS NULL OR number_value <= 60000);
