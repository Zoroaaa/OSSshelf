-- ═══════════════════════════════════════════════════════════════════════════
-- 0005_dedup_and_upload_links.sql
-- Phase 6: 文件去重（Copy-on-Write）+ 上传链接
--
-- 变更说明：
--   files.ref_count        - 同一 r2Key 的引用计数（去重 CoW 机制）
--                            初始值为 1，每新增一个引用 +1，删除时 -1
--                            ref_count > 1 时删除文件只减引用，不删存储对象
--   files.hash             - 已存在（0001），此处无需变更
--
--   shares.is_upload_link  - 标记此分享为上传链接（非下载分享）
--   shares.upload_token    - 上传令牌（UUID），用于无账号上传验证
--   shares.max_upload_size - 单文件大小上限（字节，null=继承系统上限）
--   shares.upload_allowed_mime_types - 允许上传的 MIME 类型 JSON 数组
--                                      null=继承文件夹 allowedMimeTypes 策略
--   shares.max_upload_count - 最多允许上传文件数（null=不限）
--   shares.upload_count    - 已上传文件数（统计用）
-- ═══════════════════════════════════════════════════════════════════════════

-- ── files 表：去重引用计数字段 ───────────────────────────────────────────
ALTER TABLE files ADD COLUMN ref_count INTEGER NOT NULL DEFAULT 1;

-- 索引：快速查找同 hash 下的 ref_count（去重查询）
CREATE INDEX IF NOT EXISTS idx_files_hash_bucket ON files(hash, bucket_id)
  WHERE hash IS NOT NULL AND deleted_at IS NULL;

-- ── shares 表：上传链接字段 ──────────────────────────────────────────────
ALTER TABLE shares ADD COLUMN is_upload_link INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shares ADD COLUMN upload_token TEXT;
ALTER TABLE shares ADD COLUMN max_upload_size INTEGER;
ALTER TABLE shares ADD COLUMN upload_allowed_mime_types TEXT;
ALTER TABLE shares ADD COLUMN max_upload_count INTEGER;
ALTER TABLE shares ADD COLUMN upload_count INTEGER NOT NULL DEFAULT 0;

-- 唯一索引：upload_token 必须全局唯一（用于公开端点查找）
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_upload_token
  ON shares(upload_token) WHERE upload_token IS NOT NULL;

-- 索引：加速 isUploadLink 的列表查询
CREATE INDEX IF NOT EXISTS idx_shares_is_upload_link
  ON shares(user_id, is_upload_link) WHERE is_upload_link = 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- Telegram 分片存储表
-- 每条记录对应一个 49MB 分片，同一文件所有分片共享 group_id
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS telegram_file_chunks (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL,          -- 同一文件所有分片共享的 UUID
  chunk_index  INTEGER NOT NULL,       -- 0-based 分片序号
  tg_file_id   TEXT NOT NULL,          -- Telegram file_id（此分片）
  chunk_size   INTEGER NOT NULL,       -- 此块字节数
  bucket_id    TEXT NOT NULL,          -- 所属存储桶
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tg_chunks_group
  ON telegram_file_chunks(group_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_tg_chunks_bucket
  ON telegram_file_chunks(bucket_id);
