-- People who sign in: through GitHub, or through the dev form when DEV_LOGIN is "1".
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  avatar_url TEXT,
  github_id INTEGER UNIQUE,
  created_at INTEGER NOT NULL
);

-- Browser sessions. The cookie carries a random token; only its sha256 is stored.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- API tokens for the CLI. Returned once at creation; only the sha256 is stored.
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);

-- The CLI's device login: the CLI holds device_code, the person types user_code.
CREATE TABLE device_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  -- The User-Agent of the terminal that asked, so the token it gets has a recognisable name.
  client TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One row per pack name. The first publisher owns the name.
CREATE TABLE packs (
  name TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  latest TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  templates INTEGER NOT NULL DEFAULT 0,
  rules INTEGER NOT NULL DEFAULT 0,
  assets INTEGER NOT NULL DEFAULT 0,
  recipes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX packs_rank ON packs(downloads DESC, updated_at DESC);
CREATE INDEX packs_owner ON packs(owner_id);

-- Every published version, with the manifest as it was uploaded.
CREATE TABLE pack_versions (
  name TEXT NOT NULL REFERENCES packs(name) ON DELETE CASCADE,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  size INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  published_by INTEGER NOT NULL REFERENCES users(id),
  published_at INTEGER NOT NULL,
  PRIMARY KEY (name, version)
);
