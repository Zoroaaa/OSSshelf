-- ═══════════════════════════════════════════════════════════════════════════
-- 122_files_fts_v2.sql
-- 修复 FTS5 表结构冲突（R3）
--
-- 背景：070_system.sql 建的 files_fts 列名是 id（外部内容表，content='files'），
--       110_ai_agents.sql 又声明了同名表但列名是 file_id，被 IF NOT EXISTS 跳过。
--       运行时按 110 的列名查询 → "no such column: file_id" → 永久回退 LIKE。
--
-- 方案：新建 files_fts_v2（standalone 表，列名统一为 file_id），应用层写入与查询都指向它。
--       - 不 DROP 旧表：保留回退路径，且旧表的触发器继续维护，熔断降级时仍可用。
--       - 旧表缺 ai_tags 列，v2 补上，标签检索不再走 LIKE 补漏。
-- ═══════════════════════════════════════════════════════════════════════════

CREATE VIRTUAL TABLE IF NOT EXISTS `files_fts_v2` USING fts5(
  `file_id` UNINDEXED,
  `name`,
  `description`,
  `ai_summary`,
  `ai_tags`,
  tokenize = 'unicode61'
);

-- 存量回填：迁移只执行一次，不需要去重保护；只回填未删除文件。
INSERT INTO `files_fts_v2` (`file_id`, `name`, `description`, `ai_summary`, `ai_tags`)
SELECT
  `id`,
  COALESCE(`name`, ''),
  COALESCE(`description`, ''),
  COALESCE(`ai_summary`, ''),
  COALESCE(`ai_tags`, '')
FROM `files`
WHERE `deleted_at` IS NULL;
