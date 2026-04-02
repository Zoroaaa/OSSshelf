-- 0016_fts5.sql
-- FTS5 全文搜索虚拟表

-- 创建 FTS5 虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  ai_summary,
  content='files',
  content_rowid=rowid,
  tokenize='unicode61'
);

-- 同步触发器：插入
CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files BEGIN INSERT INTO files_fts(rowid,id,name,description,ai_summary) VALUES (NEW.rowid,NEW.id,NEW.name,NEW.description,NEW.ai_summary); END;

-- 同步触发器：更新
CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON files BEGIN UPDATE files_fts SET name=NEW.name,description=NEW.description,ai_summary=NEW.ai_summary WHERE rowid=NEW.rowid; END;

-- 同步触发器：删除
CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files BEGIN DELETE FROM files_fts WHERE rowid=OLD.rowid; END;

