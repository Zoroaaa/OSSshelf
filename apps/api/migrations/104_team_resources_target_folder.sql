-- 104_team_resources_target_folder.sql
-- team_resources 表增加 target_folder_id 字段，支持挂载到指定子目录

ALTER TABLE team_resources ADD COLUMN target_folder_id TEXT;

-- 索引：按目标文件夹查询挂载资源
CREATE INDEX IF NOT EXISTS idx_team_resources_target_folder ON team_resources(target_folder_id);
