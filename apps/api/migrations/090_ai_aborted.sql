-- 090_ai_aborted.sql - AI 消息中断标记
-- ⚠️ 不可重复执行：包含 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS），
--    重跑会报 duplicate column name。请勿在控制台手工执行，只能依赖 d1_migrations 记录。

-- 为 ai_chat_messages 表添加 aborted 字段
ALTER TABLE ai_chat_messages ADD COLUMN aborted INTEGER NOT NULL DEFAULT 0;
