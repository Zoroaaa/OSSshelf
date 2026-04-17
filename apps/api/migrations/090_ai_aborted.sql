-- 090_ai_aborted.sql - AI 消息中断标记

-- 为 ai_chat_messages 表添加 aborted 字段
ALTER TABLE ai_chat_messages ADD COLUMN aborted INTEGER NOT NULL DEFAULT 0;
