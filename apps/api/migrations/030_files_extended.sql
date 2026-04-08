-- 030_files_extended.sql - 文件扩展：版本控制、笔记、标签、收藏

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件版本表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS file_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT,
  hash TEXT,
  ref_count INTEGER NOT NULL DEFAULT 1,
  change_summary TEXT,
  ai_change_summary TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(file_id, version)
);

CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_versions_hash ON file_versions(hash);

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件笔记表
-- ═══════════════════════════════════════════════════════════════════════════
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

CREATE INDEX IF NOT EXISTS idx_file_notes_file ON file_notes(file_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_notes_user ON file_notes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_notes_pinned ON file_notes(file_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_file_notes_parent ON file_notes(parent_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 笔记版本历史表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS file_note_history (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_note_history_note ON file_note_history(note_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 笔记 @提及表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS note_mentions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES file_notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_note_mentions_user ON note_mentions(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_note_mentions_note ON note_mentions(note_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 文件标签表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS file_tags (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_tags_file ON file_tags(file_id);
CREATE INDEX IF NOT EXISTS idx_file_tags_user_name ON file_tags(user_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_tags_unique ON file_tags(file_id, name);

-- ═══════════════════════════════════════════════════════════════════════════
-- 用户收藏表
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_stars (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stars_user ON user_stars(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stars_file ON user_stars(file_id);
