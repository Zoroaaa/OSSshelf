-- 092_ai_mentioned_files.sql - AI 聊天消息 @文件引用字段
-- ⚠️ 不可重复执行：包含 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS），
--    重跑会报 duplicate column name。请勿在控制台手工执行，只能依赖 d1_migrations 记录。

ALTER TABLE ai_chat_messages ADD COLUMN mentioned_files text;
