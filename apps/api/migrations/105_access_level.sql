-- 105_access_level.sql - 文件夹访问级别字段

-- 为 files 表添加 access_level 列，用于 setFolderAccessLevel 功能
ALTER TABLE files ADD COLUMN access_level TEXT;

CREATE INDEX IF NOT EXISTS idx_files_access_level ON files(access_level);
