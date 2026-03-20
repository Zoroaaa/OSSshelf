-- ═══════════════════════════════════════════════════════════════════════════
-- 0006_upload_progress.sql
-- Telegram 异步上传进度追踪
--
-- 变更说明：
--   upload_tasks.progress      - 上传进度百分比（0-100）
--   upload_tasks.error_message - 上传失败时的错误信息
--
-- 用途：
--   Telegram 大文件上传改为异步模式，前端通过轮询获取实时进度
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE upload_tasks ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upload_tasks ADD COLUMN error_message TEXT;
