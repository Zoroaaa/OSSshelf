-- 104_team_resources_target_folder.sql
-- team_resources 表增加 target_folder_id 字段，支持挂载到指定子目录
-- ⚠️ 不可重复执行：包含 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS），
--    重跑会报 duplicate column name。请勿在控制台手工执行，只能依赖 d1_migrations 记录。

ALTER TABLE team_resources ADD COLUMN target_folder_id TEXT;

-- 索引：按目标文件夹查询挂载资源
CREATE INDEX IF NOT EXISTS idx_team_resources_target_folder ON team_resources(target_folder_id);
