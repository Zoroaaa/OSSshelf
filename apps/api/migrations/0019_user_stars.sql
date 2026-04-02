-- 0019_user_stars.sql
-- 用户收藏表（支持用户维度的文件收藏）

-- 用户收藏关联表
-- 解决原 isStarred 字段为全局状态的问题，实现每用户独立收藏
CREATE TABLE IF NOT EXISTS user_stars (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, file_id)
);

-- 索引：按用户查询收藏列表
CREATE INDEX IF NOT EXISTS idx_user_stars_user ON user_stars(user_id);

-- 索引：按文件查询被收藏情况
CREATE INDEX IF NOT EXISTS idx_user_stars_file ON user_stars(file_id);

-- 数据迁移：将现有 isStarred=true 的记录迁移到 user_stars 表
-- 仅迁移文件所有者自己的收藏（因为原字段是全局的，只有所有者可能设置）
INSERT OR IGNORE INTO user_stars (user_id, file_id, created_at)
SELECT user_id, id, updated_at
FROM files
WHERE is_starred = 1 AND deleted_at IS NULL;
