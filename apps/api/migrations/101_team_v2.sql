-- ============================================================
-- 101_team_v2.sql — 团队协作 V2：邀请机制 + 工作空间 + 活动
-- ============================================================

-- 1. 扩展 teams 表
ALTER TABLE teams ADD COLUMN storage_quota INTEGER DEFAULT 5368709120;
ALTER TABLE teams ADD COLUMN storage_used INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE teams ADD COLUMN default_member_role TEXT DEFAULT 'member';

-- 2. 邀请链接表
CREATE TABLE IF NOT EXISTS team_invitations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token TEXT NOT NULL UNIQUE,
  invite_code TEXT UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  message TEXT,
  expires_at TEXT,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_invitations_team ON team_invitations(team_id);
CREATE INDEX IF NOT EXISTS idx_team_invitations_token ON team_invitations(invite_token);
CREATE INDEX IF NOT EXISTS idx_team_invitations_status ON team_invitations(status);
CREATE INDEX IF NOT EXISTS idx_team_invitations_expires ON team_invitations(expires_at);

-- 3. 活动流表
CREATE TABLE IF NOT EXISTS team_activities (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_team_activities_team ON team_activities(team_id, created_at);
CREATE INDEX IF NOT EXISTS idx_team_activities_user ON team_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_team_activities_action ON team_activities(action);
