-- 100_team_collaboration.sql - 团队协作能力扩展

-- ═══════════════════════════════════════════════════════════════════════════
-- 团队空间表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  settings    TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 团队成员表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS team_members (
  id        TEXT PRIMARY KEY,
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  added_by  TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_group ON team_members(team_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 团队资源挂载表（将文件关联到团队空间）
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS team_resources (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  mounted_by TEXT NOT NULL REFERENCES users(id),
  mounted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_team_resources_team ON team_resources(team_id);
CREATE INDEX IF NOT EXISTS idx_team_resources_file ON team_resources(file_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 权限申请表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS permission_requests (
  id                   TEXT PRIMARY KEY,
  file_id              TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  requester_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_team_id       TEXT REFERENCES teams(id) ON DELETE SET NULL,
  requested_permission TEXT NOT NULL DEFAULT 'read',
  reason               TEXT,
  status               TEXT NOT NULL DEFAULT 'pending',
  reviewed_by          TEXT REFERENCES users(id),
  reviewed_at          TEXT,
  review_comment       TEXT,
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_permission_requests_requester ON permission_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_permission_requests_status ON permission_requests(status);
CREATE INDEX IF NOT EXISTS idx_permission_requests_file ON permission_requests(file_id);
CREATE INDEX IF NOT EXISTS idx_permission_requests_target_team ON permission_requests(target_team_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 角色模板表 + 内置数据
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS role_templates (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  permissions    TEXT NOT NULL DEFAULT '[]',
  is_builtin     INTEGER NOT NULL DEFAULT 0,
  description    TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 插入内置角色模板
INSERT OR IGNORE INTO role_templates (id, name, slug, permissions, is_builtin, description) VALUES
  ('rt-viewer',  '查看者',  'viewer',  '["read"]',                           1, '可查看和下载文件'),
  ('rt-editor',  '编辑者',  'editor',  '["read","write"]',                    1, '可上传、修改、删除、重命名文件'),
  ('rt-manager', '管理者',  'manager', '["read","write","admin"]',            1, '可管理权限并可再授权给他人');

-- ═══════════════════════════════════════════════════════════════════════════
-- 扩展 file_permissions 表：增加 team_id 字段
-- ═══════════════════════════════════════════════════════════════════════════
-- SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS，用 try-catch 风格处理
-- 这里直接添加，如果已存在会报错（可忽略或由应用层处理）

-- 检查列是否已存在，不存在则添加
-- （实际部署时可用 PRAGMA table_info 或应用层容错）
ALTER TABLE file_permissions ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_file_permissions_team ON file_permissions(team_id);
