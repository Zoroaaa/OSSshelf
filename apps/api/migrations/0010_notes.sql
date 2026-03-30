-- 0010_notes.sql
-- 文件笔记功能
-- 创建 file_notes, file_note_history, note_mentions 表，为 files 表添加笔记相关字段

-- 文件笔记表
CREATE TABLE IF NOT EXISTS file_notes (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_html TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  parent_id TEXT REFERENCES file_notes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

-- 笔记版本历史表
CREATE TABLE IF NOT EXISTS file_note_history (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 笔记 @提及表
CREATE TABLE IF NOT EXISTS note_mentions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 笔记查询索引
CREATE INDEX idx_file_notes_file ON file_notes(file_id, deleted_at, created_at DESC);
CREATE INDEX idx_file_notes_user ON file_notes(user_id, created_at DESC);
CREATE INDEX idx_file_notes_pinned ON file_notes(file_id, is_pinned);
CREATE INDEX idx_file_notes_parent ON file_notes(parent_id);

-- 笔记历史索引
CREATE INDEX idx_file_note_history_note ON file_note_history(note_id, created_at DESC);

-- 提及索引
CREATE INDEX idx_note_mentions_user ON note_mentions(user_id, is_read);
CREATE INDEX idx_note_mentions_note ON note_mentions(note_id);

-- 为 files 表添加笔记相关字段
ALTER TABLE files ADD COLUMN description TEXT;
ALTER TABLE files ADD COLUMN note_count INTEGER DEFAULT 0;
