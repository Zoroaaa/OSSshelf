-- 0008_direct_link.sql
-- 添加文件直链功能
-- 为 files 表添加 direct_link_token 和 direct_link_expires_at 字段

-- 添加直链 token 字段（不带 UNIQUE 约束，SQLite 限制）
ALTER TABLE files ADD COLUMN direct_link_token TEXT;

-- 添加直链过期时间字段
ALTER TABLE files ADD COLUMN direct_link_expires_at TEXT;

-- 创建唯一索引（替代 UNIQUE 约束）
CREATE UNIQUE INDEX idx_files_direct_link_token_unique ON files(direct_link_token) WHERE direct_link_token IS NOT NULL;

-- 创建普通索引加速查询
CREATE INDEX idx_files_direct_link_expires ON files(direct_link_expires_at);
