-- 119_file_name_unique.sql
-- 文件命名唯一约束：同一归属命名空间 + 同一父目录 + 同名，只允许一个未删除项。
--
-- 命名空间（按现有 schema 建模）：
--   - 团队空间：team_id 非空 → 'team:' || team_id
--   - 个人空间：team_id 为空 → 'user:' || user_id
--   不同用户/团队之间重名不受影响。
--
-- 根目录处理：
--   SQLite 中 NULL 互不相等，普通唯一索引对 parent_id IS NULL 不生效，
--   因此对 parent_id 使用 COALESCE(parent_id, '') 归一化为空串。
--
-- 软删除处理：
--   部分索引 WHERE deleted_at IS NULL，回收站中的同名文件不参与约束，
--   删除（软删）后可以再次创建同名文件。不要把该条件改成 IS NULL 的反面。
--
-- 幂等：CREATE UNIQUE INDEX IF NOT EXISTS，可重复执行。
--
-- 部署风险：
--   若生产库已存在未删除的同名数据，本迁移会以
--   `D1_ERROR: UNIQUE constraint failed: index 'uniq_files_name_per_parent_active'`
--   失败并阻断部署。迁移不会静默改名，需先按
--   docs/runbooks/file-name-dedup.md 排查并人工去重后再重跑迁移。

CREATE UNIQUE INDEX IF NOT EXISTS uniq_files_name_per_parent_active
ON files (
  COALESCE('team:' || team_id, 'user:' || user_id),
  COALESCE(parent_id, ''),
  name
)
WHERE deleted_at IS NULL;
