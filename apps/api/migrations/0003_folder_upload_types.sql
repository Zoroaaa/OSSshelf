-- 添加文件夹上传类型控制字段
ALTER TABLE files ADD COLUMN allowed_mime_types TEXT;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_files_allowed_mime ON files(user_id, allowed_mime_types);
