-- 117_path_model_unify.sql
-- 路径模型统一：files.path 从 `<parentId>/<name>` 改为由 parentId 链拼出的逻辑路径。
--   - 根目录文件/文件夹：/name
--   - 子项：/parent/child/...
--   - 不带尾部斜杠
--
-- 幂等：可重复执行（仅重算，不改其他列）。
-- 回滚：apps/api/scripts/rollback/117_path_model_unify_rollback.sql
--       （迁移前已把旧 path 全量备份到 files_path_backup_117）

-- 1) 备份旧路径（只在首次执行时写入，后续重跑不覆盖）
CREATE TABLE IF NOT EXISTS files_path_backup_117 (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  backed_up_at TEXT NOT NULL
);

INSERT OR IGNORE INTO files_path_backup_117 (id, path, backed_up_at)
SELECT id, path, datetime('now') FROM files;

-- 2) 按 parentId 链重算全量路径
--    团队根文件使用 /teams/<teamId>/ 命名空间，避免与个人路径冲突
WITH RECURSIVE tree(id, computed_path, depth) AS (
  SELECT id,
    CASE
      WHEN team_id IS NOT NULL THEN '/teams/' || team_id || '/' || name
      ELSE '/' || name
    END,
    0
  FROM files
  WHERE parent_id IS NULL

  UNION ALL

  SELECT f.id, tree.computed_path || '/' || f.name, tree.depth + 1
  FROM files f
  JOIN tree ON f.parent_id = tree.id
  WHERE tree.depth < 64
)
UPDATE files
SET path = (SELECT computed_path FROM tree WHERE tree.id = files.id)
WHERE EXISTS (SELECT 1 FROM tree WHERE tree.id = files.id);
