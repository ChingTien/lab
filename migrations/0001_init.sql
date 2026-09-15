PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','published','completed')),
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  owner_answer INTEGER CHECK(owner_answer BETWEEN 1 AND 5),
  UNIQUE(set_id, position)
) STRICT;

CREATE TABLE IF NOT EXISTS submissions (
  set_id TEXT PRIMARY KEY REFERENCES sets(id) ON DELETE CASCADE,
  guest_name TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sets_owner_created ON sets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TRIGGER IF NOT EXISTS questions_only_change_in_draft_before_insert
BEFORE INSERT ON questions
WHEN (SELECT status FROM sets WHERE id = NEW.set_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'published questions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS questions_only_change_in_draft_before_update
BEFORE UPDATE ON questions
WHEN (SELECT status FROM sets WHERE id = OLD.set_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'published questions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS questions_only_change_in_draft_before_delete
BEFORE DELETE ON questions
WHEN (SELECT status FROM sets WHERE id = OLD.set_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'published questions are immutable');
END;
