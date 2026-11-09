-- 103_upload_tasks_team_id.sql - 补充 upload_tasks 表缺少的 team_id 列
-- ⚠️ 不可重复执行：包含 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS），
--    重跑会报 duplicate column name。请勿在控制台手工执行，只能依赖 d1_migrations 记录。

-- 团队协作功能需要在上传任务中记录团队归属
-- schema.ts 已定义 teamId 字段，但 100 号迁移遗漏了此表的 ALTER
ALTER TABLE upload_tasks ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
