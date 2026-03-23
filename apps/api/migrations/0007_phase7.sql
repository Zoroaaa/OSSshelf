-- ═══════════════════════════════════════════════════════════════════════════
-- 0007_phase7.sql
-- Phase 7: 搜索历史 + WebDAV path修复 + 审计日志清理配置
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 搜索历史表 ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS search_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_search_history_user
  ON search_history(user_id, created_at DESC);

-- ── 审计日志保留天数配置（存入 KV，此处仅记录默认值说明）────────────────
-- 默认 90 天，通过 AUDIT_RETENTION_DAYS env var 配置，无需 DB 字段。

-- ── files.path 格式统一备注 ────────────────────────────────────────────────
-- WebDAV PUT 写入的 path 为绝对路径 /a/b/file.txt
-- 普通上传写入的 path 为 parentId/fileName 格式
-- findFileByPath 已修复为同时支持两种格式，存量数据无需迁移。
