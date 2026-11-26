-- 125: file_tags.file_id 允许 NULL —— 标签定义行不再伪装成“文件引用”
--
-- 背景：030 把 file_id 定义成 NOT NULL REFERENCES files(id)，而“还没挂到任何文件上”的
-- 标签定义行只能用 file_id='' 占位。D1 默认开启外键校验（等价 PRAGMA foreign_keys=on），
-- '' 在 files 里找不到父行 → 每次创建标签都 FOREIGN KEY constraint failed（接口 500），
-- 于是标签只能以“已挂在某个文件上的关联行”存在，标签库里永远没有未被引用的标签。
-- 本地 miniflare 不开启外键校验，问题只在线上暴露。
--
-- 修法：file_id 改为可空，NULL 表示标签定义；真实关联行仍受 files 外键与
-- ON DELETE CASCADE 保护（删文件仍然自动清掉它的标签关联）。
-- SQLite 不能放宽列约束，只能重建表；没有任何表引用 file_tags，重建是安全的。
-- 旧库里遗留的 file_id='' 伪引用在复制时用 NULLIF 转成 NULL（旧表列是 NOT NULL，
-- 不能先 UPDATE 置空，只能在新表里转换），否则新表会再次撞外键。

CREATE TABLE file_tags_new (
  id TEXT PRIMARY KEY,
  file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO file_tags_new (id, file_id, user_id, name, color, created_at)
  SELECT id, NULLIF(file_id, ''), user_id, name, color, created_at FROM file_tags;

DROP TABLE file_tags;

ALTER TABLE file_tags_new RENAME TO file_tags;

CREATE INDEX IF NOT EXISTS idx_file_tags_file ON file_tags(file_id);
CREATE INDEX IF NOT EXISTS idx_file_tags_user_name ON file_tags(user_id, name);
-- 定义行 file_id 为 NULL，SQLite 视 NULL 互不相等，因此这里只约束关联行唯一；
-- 定义行的同名去重由 /tags/create 的 (user_id, name) 预检负责。
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_tags_unique ON file_tags(file_id, name);
