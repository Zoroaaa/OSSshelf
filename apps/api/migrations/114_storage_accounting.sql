-- 114_storage_accounting.sql
-- 存储统计单一来源（幂等）
--
-- 背景：
--   080_optimizations.sql 已通过触发器维护 users.storage_used /
--   storage_buckets.storage_used / file_count，但应用层又在多处手动调用
--   updateUserStorage / updateBucketStats，导致活跃文件统计约为真实值的 2 倍，
--   永久删除后还可能减成负数。
--
-- 本迁移把触发器补齐为唯一记账来源：
--   1. INSERT 活跃文件              → 用户 +size，桶 +size/+1
--   2. UPDATE 活跃文件 size         → 用户/桶 ±delta（桶不变时）
--   3. UPDATE 活跃文件 bucket_id    → 旧桶 -size/-1，新桶 +size/+1
--   4. UPDATE deleted_at 空→非空    → 用户/桶 -size（软删除）
--   5. UPDATE deleted_at 非空→空    → 用户/桶 +size（恢复）
--   6. DELETE 活跃文件              → 用户/桶 -size（硬删除，如 WebDAV DELETE）
--      已软删除的记录被硬删除时不再扣减，避免重复扣减。
--
-- 所有扣减使用 MAX(0, ...) 兜底，避免历史脏数据导致负数。
-- 迁移末尾按活跃文件全量重算一次，修正已经存在的双计数据。

-- ── 1. 插入 ────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_files_storage_insert;
CREATE TRIGGER trg_files_storage_insert
AFTER INSERT ON files
WHEN NEW.deleted_at IS NULL AND NEW.is_folder = 0
BEGIN
  UPDATE users SET storage_used = MAX(0, storage_used + NEW.size) WHERE id = NEW.user_id;
  UPDATE storage_buckets
  SET storage_used = MAX(0, storage_used + NEW.size), file_count = file_count + 1
  WHERE id = NEW.bucket_id;
END;

-- ── 2. 大小变化（桶未变化）─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_files_storage_update;
CREATE TRIGGER trg_files_storage_update
AFTER UPDATE ON files
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
     AND OLD.is_folder = 0 AND NEW.is_folder = 0
     AND OLD.bucket_id IS NEW.bucket_id
     AND OLD.size != NEW.size
BEGIN
  UPDATE users SET storage_used = MAX(0, storage_used - OLD.size + NEW.size) WHERE id = NEW.user_id;
  UPDATE storage_buckets
  SET storage_used = MAX(0, storage_used - OLD.size + NEW.size)
  WHERE id = NEW.bucket_id;
END;

-- ── 3. 桶变化（迁移 / 切换存储）───────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_files_storage_bucket_change;
CREATE TRIGGER trg_files_storage_bucket_change
AFTER UPDATE OF bucket_id ON files
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
     AND OLD.is_folder = 0 AND NEW.is_folder = 0
     AND OLD.bucket_id IS NOT NEW.bucket_id
BEGIN
  -- 桶迁移时 size 可能同时变化，用户配额需按 size 差值调整
  UPDATE users SET storage_used = MAX(0, storage_used - OLD.size + NEW.size) WHERE id = NEW.user_id;
  UPDATE storage_buckets
  SET storage_used = MAX(0, storage_used - OLD.size), file_count = MAX(0, file_count - 1)
  WHERE id = OLD.bucket_id;
  UPDATE storage_buckets
  SET storage_used = MAX(0, storage_used + NEW.size), file_count = file_count + 1
  WHERE id = NEW.bucket_id;
END;

-- ── 4. 软删除 ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_files_storage_delete;
CREATE TRIGGER trg_files_storage_delete
AFTER UPDATE OF deleted_at ON files
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.is_folder = 0
BEGIN
  UPDATE users SET storage_used = MAX(0, storage_used - NEW.size) WHERE id = NEW.user_id;
  UPDATE storage_buckets
  SET storage_used = MAX(0, storage_used - NEW.size), file_count = MAX(0, file_count - 1)
  WHERE id = NEW.bucket_id;
END;

-- ── 5. 回收站恢复 ──────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_files_storage_restore;
CREATE TRIGGER trg_files_storage_restore
AFTER UPDATE OF deleted_at ON files
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.is_folder = 0
BEGIN
  UPDATE users SET storage_used = MAX(0, storage_used + NEW.size) WHERE id = NEW.user_id;
  UPDATE storage_buckets
  SET storage_used = MAX(0, storage_used + NEW.size), file_count = file_count + 1
  WHERE id = NEW.bucket_id;
END;

-- ── 6. 硬删除（未被软删除过的活跃文件）────────────────────────────────────
DROP TRIGGER IF EXISTS trg_files_storage_purge;
CREATE TRIGGER trg_files_storage_purge
AFTER DELETE ON files
WHEN OLD.deleted_at IS NULL AND OLD.is_folder = 0
BEGIN
  UPDATE users SET storage_used = MAX(0, storage_used - OLD.size) WHERE id = OLD.user_id;
  UPDATE storage_buckets
  SET storage_used = MAX(0, storage_used - OLD.size), file_count = MAX(0, file_count - 1)
  WHERE id = OLD.bucket_id;
END;

-- ── 7. 全量重算，修正历史双计 ─────────────────────────────────────────────
-- 语义：storage_used 只统计"未软删除的普通文件"的逻辑大小；
-- 去重共享对象与版本快照不重复计入（版本从未计入，保持一致）。
UPDATE users
SET storage_used = COALESCE(
  (
    SELECT SUM(f.size)
    FROM files f
    WHERE f.user_id = users.id AND f.deleted_at IS NULL AND f.is_folder = 0
  ),
  0
);

UPDATE storage_buckets
SET storage_used = COALESCE(
      (
        SELECT SUM(f.size)
        FROM files f
        WHERE f.bucket_id = storage_buckets.id AND f.deleted_at IS NULL AND f.is_folder = 0
      ),
      0
    ),
    file_count = COALESCE(
      (
        SELECT COUNT(*)
        FROM files f
        WHERE f.bucket_id = storage_buckets.id AND f.deleted_at IS NULL AND f.is_folder = 0
      ),
      0
    );
