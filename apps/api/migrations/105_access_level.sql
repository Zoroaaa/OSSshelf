-- 105_access_level.sql - 文件夹访问级别字段
-- ⚠️ 不可重复执行：包含 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS），
--    重跑会报 duplicate column name。请勿在控制台手工执行，只能依赖 d1_migrations 记录。

-- 为 files 表添加 access_level 列，用于 setFolderAccessLevel 功能
ALTER TABLE files ADD COLUMN access_level TEXT;

CREATE INDEX IF NOT EXISTS idx_files_access_level ON files(access_level);
