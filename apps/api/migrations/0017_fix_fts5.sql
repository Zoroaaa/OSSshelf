-- 0017_fix_fts5.sql
-- 修复 FTS5 虚拟表损坏问题
-- 先删触发器，再重建虚拟表

DROP TRIGGER IF EXISTS files_fts_insert;
DROP TRIGGER IF EXISTS files_fts_update;
DROP TRIGGER IF EXISTS files_fts_delete;

DROP TABLE IF EXISTS files_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  ai_summary,
  content='files',
  content_rowid=rowid,
  tokenize='unicode61'
);

-- 重新同步现有数据
INSERT INTO files_fts(rowid, id, name, description, ai_summary)
SELECT rowid, id, name, description, ai_summary FROM files WHERE deleted_at IS NULL;

-- 重建触发器
CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files
BEGIN
  INSERT INTO files_fts(rowid, id, name, description, ai_summary)
  VALUES (NEW.rowid, NEW.id, NEW.name, NEW.description, NEW.ai_summary);
END;

CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files
BEGIN
  UPDATE files_fts SET
    name = NEW.name,
    description = NEW.description,
    ai_summary = NEW.ai_summary
  WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files
BEGIN
  DELETE FROM files_fts WHERE rowid = OLD.rowid;
END;
