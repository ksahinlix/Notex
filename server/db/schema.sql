-- Notex database schema (Postgres / Neon).
-- Safe to run repeatedly: every statement is idempotent.

-- One row per note. The client generates the id (UUID) so notes can be
-- created offline and synced later without id collisions.
CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  -- Category path, e.g. {'Software','Notex','Ideas'}. Stays in plaintext even
  -- for encrypted notes so the tree can be drawn before unlocking.
  path          TEXT[]      NOT NULL,
  encrypted     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Plain notes: {text, listItemText, reminderLabel, blocks, comments}.
  -- Encrypted notes: NULL (everything lives in `cipher`).
  content       JSONB,
  -- Encrypted notes: "ivB64:ciphertextB64" (AES-GCM, produced in the browser).
  cipher        TEXT,
  is_list_item  BOOLEAN     NOT NULL DEFAULT FALSE,
  checked       BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Kept in plaintext so the server can send reminder pushes later.
  -- The reminder *label* is part of content/cipher, never stored here.
  reminder_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete ("tombstone") so other devices learn about deletions on sync.
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT notes_payload_check CHECK (
    (encrypted AND cipher IS NOT NULL AND content IS NULL) OR
    (NOT encrypted AND cipher IS NULL AND content IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS notes_updated_at_idx ON notes (updated_at);
CREATE INDEX IF NOT EXISTS notes_reminder_at_idx ON notes (reminder_at)
  WHERE reminder_at IS NOT NULL AND deleted_at IS NULL;

-- Folders protected with a password. The password never reaches the server:
-- the browser derives a key (PBKDF2) and encrypts a known value into
-- `check_cipher`. Unlocking = successfully decrypting it. No password hash is
-- stored, so there is nothing fast to brute-force.
CREATE TABLE IF NOT EXISTS protected_folders (
  path_key      TEXT PRIMARY KEY,           -- path joined with '/'
  salt          TEXT        NOT NULL,       -- hex
  iterations    INTEGER     NOT NULL,
  check_cipher  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Search vectors of plain notes (D15), made by Cloudflare's bge-m3 model.
-- Encrypted notes never get a row. `text_hash` tells whether the vector is
-- still up to date with the note's text; stale rows are recomputed lazily.
CREATE TABLE IF NOT EXISTS note_vectors (
  note_id    TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  text_hash  TEXT        NOT NULL,
  vector     REAL[]      NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Multiple users with Google login (D16) ----------------------------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,            -- random UUID
  google_sub    TEXT UNIQUE NOT NULL,        -- Google's stable account id
  email         TEXT NOT NULL,
  name          TEXT,
  picture       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every note and protected folder belongs to a user. Rows from the
-- single-user era have NULL here until OWNER_EMAIL signs in and claims them.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS notes_user_updated_idx ON notes (user_id, updated_at);

ALTER TABLE protected_folders ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
-- Folder names are only unique per user now ("Kişisel" can exist for everyone).
ALTER TABLE protected_folders DROP CONSTRAINT IF EXISTS protected_folders_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS protected_folders_user_path_idx ON protected_folders (user_id, path_key);

-- AI requests per user per day, to share the free Cloudflare allowance fairly.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  calls   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Reminders without a date ("... hatırlat" with no time given). Like
-- reminder_at it stays in plaintext so the reminders list works while locked.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_reminder BOOLEAN NOT NULL DEFAULT FALSE;
