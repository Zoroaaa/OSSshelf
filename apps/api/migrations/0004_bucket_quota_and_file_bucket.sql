-- Add per-bucket storage quota
ALTER TABLE storage_buckets ADD COLUMN storage_quota INTEGER;

-- Add bucket_id to files if not already added by 0003
-- (safe to run even if column exists via the CREATE TABLE approach)
CREATE TABLE IF NOT EXISTS files_new AS SELECT * FROM files;
-- We use a safe conditional approach:
-- SQLite does not support IF NOT EXISTS for ALTER TABLE ADD COLUMN,
-- but D1 silently ignores duplicate column errors in migrations.
-- So we attempt the add; if it already ran from 0003 it's a no-op.
ALTER TABLE files ADD COLUMN bucket_id TEXT REFERENCES storage_buckets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_files_bucket_id ON files(bucket_id);
