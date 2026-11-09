-- 117_path_model_unify_rollback.sql
-- 回滚 117 路径模型统一：把 files.path 恢复为迁移前备份值。
-- 使用方式（本地/预发）：
--   npx wrangler d1 execute <DB_NAME> --local --file=apps/api/scripts/rollback/117_path_model_unify_rollback.sql
--   npx wrangler d1 execute <DB_NAME> --remote --file=apps/api/scripts/rollback/117_path_model_unify_rollback.sql
--
-- 说明：
-- - 备份表 files_path_backup_117 保留，便于重复回滚或人工核对；确认无误后可手工 DROP。
-- - 若迁移后新建的文件不在备份表中，则保持其当前 path 不变。

UPDATE files
SET path = (SELECT b.path FROM files_path_backup_117 b WHERE b.id = files.id)
WHERE EXISTS (SELECT 1 FROM files_path_backup_117 b WHERE b.id = files.id);
