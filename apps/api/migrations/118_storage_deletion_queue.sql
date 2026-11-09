-- 118_storage_deletion_queue.sql
-- 对象存储删除补偿队列：S3/R2 删除失败时落库，由定时任务按指数退避重试。
-- 幂等：可重复执行。

CREATE TABLE IF NOT EXISTS storage_deletion_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  bucket_id TEXT,
  object_key TEXT NOT NULL,
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_storage_deletion_due
  ON storage_deletion_queue (resolved_at, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_storage_deletion_object
  ON storage_deletion_queue (object_key);
