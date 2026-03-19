-- ═══════════════════════════════════════════════════════════════════════════
-- 0004_telegram_storage.sql
-- Telegram 存储支持
--
-- 设计说明：
--   storage_buckets 表通过 provider='telegram' 标识 Telegram 桶
--   accessKeyId  → 加密存储的 Telegram Bot Token
--   bucketName   → Telegram Chat ID（频道/群组/私聊）
--   endpoint     → 可选的 Bot API 代理地址（默认 https://api.telegram.org）
--   secretAccessKey → 占位符（'telegram-no-secret'），保持字段约束兼容
--
--   telegram_file_refs 表保存文件 r2Key → Telegram file_id 的映射
--   因为 Telegram 不使用路径寻址，需要持久化 file_id 以便后续下载
-- ═══════════════════════════════════════════════════════════════════════════

-- Telegram 文件引用表
CREATE TABLE IF NOT EXISTS telegram_file_refs (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL,          -- OSSshelf 内部 file uuid
  r2_key      TEXT NOT NULL UNIQUE,   -- 与 files.r2_key 对应（作为唯一索引键）
  tg_file_id  TEXT NOT NULL,          -- Telegram 返回的 file_id
  tg_file_size INTEGER,               -- Telegram 报告的文件大小
  bucket_id   TEXT NOT NULL,          -- 所属存储桶 id
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tg_refs_r2key    ON telegram_file_refs(r2_key);
CREATE INDEX IF NOT EXISTS idx_tg_refs_file_id  ON telegram_file_refs(file_id);
CREATE INDEX IF NOT EXISTS idx_tg_refs_bucket   ON telegram_file_refs(bucket_id);
