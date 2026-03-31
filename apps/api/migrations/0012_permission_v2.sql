-- 0012_permission_v2.sql
-- 权限系统 v2：用户组与权限扩展
-- 支持 RBAC + 继承链

-- 用户组
CREATE TABLE IF NOT EXISTS user_groups (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_groups_owner ON user_groups(owner_id);

-- 组成员
CREATE TABLE IF NOT EXISTS group_members (
  id        TEXT PRIMARY KEY,
  group_id  TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  added_by  TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);

CREATE INDEX idx_group_members_user  ON group_members(user_id);
CREATE INDEX idx_group_members_group ON group_members(group_id);

-- 权限记录扩展字段
ALTER TABLE file_permissions ADD COLUMN subject_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE file_permissions ADD COLUMN group_id TEXT REFERENCES user_groups(id) ON DELETE CASCADE;
ALTER TABLE file_permissions ADD COLUMN expires_at TEXT;
ALTER TABLE file_permissions ADD COLUMN inherit_to_children INTEGER NOT NULL DEFAULT 1;
ALTER TABLE file_permissions ADD COLUMN scope TEXT NOT NULL DEFAULT 'explicit';
ALTER TABLE file_permissions ADD COLUMN source_permission_id TEXT REFERENCES file_permissions(id);

CREATE INDEX idx_file_permissions_group   ON file_permissions(group_id);
CREATE INDEX idx_file_permissions_expires ON file_permissions(expires_at);
CREATE INDEX idx_file_permissions_scope   ON file_permissions(scope);
