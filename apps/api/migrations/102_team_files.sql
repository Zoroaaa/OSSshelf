-- ============================================================
-- 102_team_files.sql — 团队共享空间：files 表增加 team_id
-- ============================================================

ALTER TABLE files ADD COLUMN team_id TEXT;

-- 索引：按团队查询共享空间的文件
CREATE INDEX IF NOT EXISTS idx_files_team ON files(team_id);

-- 复合索引：团队内未删除的文件（工作区主查询）
CREATE INDEX IF NOT EXISTS idx_files_team_active ON files(team_id, deleted_at);
