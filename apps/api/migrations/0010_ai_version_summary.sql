-- 0010_ai_version_summary.sql
-- 为 file_versions 表添加 AI 变更摘要字段

ALTER TABLE file_versions ADD COLUMN ai_change_summary TEXT;
