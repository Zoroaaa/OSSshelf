# 文件命名唯一索引（119）排查与修复

迁移 `119_file_name_unique.sql` 会创建部分唯一索引：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uniq_files_name_per_parent_active
ON files (
  COALESCE('team:' || team_id, 'user:' || user_id),
  COALESCE(parent_id, ''),
  name
)
WHERE deleted_at IS NULL;
```

## 失败表现

生产库存在历史重名（未软删除）时，`wrangler d1 migrations apply` 会失败：

```
D1_ERROR: UNIQUE constraint failed: index 'uniq_files_name_per_parent_active'
```

迁移不会自动改名，也不会被标记为已应用；修复数据后重跑即可。

## 1. 只读查重

```sql
SELECT
  CASE WHEN team_id IS NOT NULL THEN 'team:' || team_id ELSE 'user:' || user_id END AS namespace,
  COALESCE(parent_id, '') AS parent_key,
  name,
  COUNT(*) AS cnt,
  GROUP_CONCAT(id) AS ids
FROM files
WHERE deleted_at IS NULL
GROUP BY namespace, parent_key, name
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
```

## 2. 人工去重

优先通过应用的重命名入口逐条改名：它会同步 `path`、子树与全文索引。
批量处理时，先导出上面的清单确认保留项，再执行下面的 SQL（按创建时间保留最早一条）：

```sql
WITH ranked AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE WHEN team_id IS NOT NULL THEN 'team:' || team_id ELSE 'user:' || user_id END,
        COALESCE(parent_id, ''),
        name
      ORDER BY created_at, id
    ) AS rn
  FROM files
  WHERE deleted_at IS NULL
)
UPDATE files
SET name = (
      SELECT
        CASE
          WHEN instr(ranked.name, '.') > 1
            THEN substr(ranked.name, 1, instr(ranked.name, '.') - 1)
                 || ' (' || ranked.rn || ')'
                 || substr(ranked.name, instr(ranked.name, '.'))
          ELSE ranked.name || ' (' || ranked.rn || ')'
        END
      FROM ranked
      WHERE ranked.id = files.id
    )
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```

改名只动 `name`。若重命名的是文件夹，子项 `path` 仍指向旧名，需要重算路径（与 117 同一算法，幂等）：

```sql
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
```

## 3. 验证

```sql
SELECT COUNT(*) FROM (
  SELECT CASE WHEN team_id IS NOT NULL THEN 'team:' || team_id ELSE 'user:' || user_id END,
         COALESCE(parent_id, ''), name
  FROM files
  WHERE deleted_at IS NULL
  GROUP BY 1, 2, 3
  HAVING COUNT(*) > 1
);
```

结果为 `0` 后重新执行迁移。
