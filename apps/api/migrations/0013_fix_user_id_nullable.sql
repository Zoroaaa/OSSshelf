-- 0013_fix_user_id_nullable.sql
-- 修复 file_permissions.user_id NOT NULL 约束
-- 背景：0002 建表时 user_id 为 NOT NULL，0012 新增 group 授权后 group 类型记录 user_id 为 NULL，导致插入失败
-- SQLite 不支持 ALTER COLUMN DROP NOT NULL，需重建表

PRAGMA foreign_keys = OFF;

-- 1. 重命名旧表
ALTER TABLE file_permissions RENAME TO file_permissions_old;

-- 2. 建新表（user_id 改为可 NULL）
CREATE TABLE file_permissions (
  id                   TEXT PRIMARY KEY,
  file_id              TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id              TEXT REFERENCES users(id) ON DELETE CASCADE,
  permission           TEXT NOT NULL DEFAULT 'read',
  granted_by           TEXT NOT NULL REFERENCES users(id),
  subject_type         TEXT NOT NULL DEFAULT 'user',
  group_id             TEXT REFERENCES user_groups(id) ON DELETE CASCADE,
  expires_at           TEXT,
  inherit_to_children  INTEGER NOT NULL DEFAULT 1,
  scope                TEXT NOT NULL DEFAULT 'explicit',
  source_permission_id TEXT,
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. 迁移现有数据
INSERT INTO file_permissions
SELECT
  id, file_id, user_id, permission, granted_by,
  subject_type, group_id, expires_at,
  inherit_to_children, scope, source_permission_id,
  created_at, updated_at
FROM file_permissions_old;

-- 4. 重建索引
CREATE INDEX IF NOT EXISTS idx_file_permissions_file    ON file_permissions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_permissions_user    ON file_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_file_permissions_group   ON file_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_file_permissions_expires ON file_permissions(expires_at);
CREATE INDEX IF NOT EXISTS idx_file_permissions_scope   ON file_permissions(scope);

-- 部分索引：NULL 值不参与唯一约束，避免多条 group 权限互相冲突
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_permissions_unique_user
  ON file_permissions(file_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_file_permissions_unique_group
  ON file_permissions(file_id, group_id)
  WHERE group_id IS NOT NULL;

-- 5. 删除旧表
DROP TABLE file_permissions_old;

PRAGMA foreign_keys = ON;
