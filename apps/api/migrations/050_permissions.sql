-- 050_permissions.sql - 权限系统：用户组与权限扩展

-- ═══════════════════════════════════════════════════════════════════════════
-- 用户组
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_groups (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_groups_owner ON user_groups(owner_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 组成员
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS group_members (
  id        TEXT PRIMARY KEY,
  group_id  TEXT NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  added_by  TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件权限表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS file_permissions (
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

CREATE INDEX IF NOT EXISTS idx_file_permissions_file ON file_permissions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_permissions_user ON file_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_file_permissions_group ON file_permissions(group_id);
CREATE INDEX IF NOT EXISTS idx_file_permissions_expires ON file_permissions(expires_at);
CREATE INDEX IF NOT EXISTS idx_file_permissions_scope ON file_permissions(scope);
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_permissions_unique_user ON file_permissions(file_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_permissions_unique_group ON file_permissions(file_id, group_id) WHERE group_id IS NOT NULL;
