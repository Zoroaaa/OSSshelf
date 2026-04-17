-- 092_ai_mentioned_files.sql - AI 聊天消息 @文件引用字段

ALTER TABLE ai_chat_messages ADD COLUMN mentioned_files text;
