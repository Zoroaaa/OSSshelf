-- 111_remove_legacy_chat.sql
-- Agent 运行时接管后清理旧 SSE 链路遗留：
-- - ai_confirm_requests：工具审批已迁移到 AI SDK needsApproval（DO 内状态）
-- - ai_config 中 ai.runtime.* 灰度开关：运行时固定为 Agent

DROP TABLE IF EXISTS `ai_confirm_requests`;

DELETE FROM `ai_config` WHERE `key` LIKE 'ai.runtime.%';
