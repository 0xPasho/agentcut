-- People who sign in through Clerk, and the local identity a `pnpm dev` checkout uses.
-- `login` is the GitHub login: a pack is a repository, and only its owner may register it.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_id TEXT UNIQUE,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);

-- One row per pack name, pointing at the repository it lives in. The first submitter owns
-- the name. `latest_sha` is the commit the latest version is pinned to, which is what the
-- source URL is built from.
CREATE TABLE packs (
  name TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  -- '' when the pack is the whole repository.
  folder TEXT NOT NULL DEFAULT '',
  -- The branch new versions are looked for on.
  branch TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  latest TEXT NOT NULL,
  latest_sha TEXT NOT NULL,
  -- GitHub's star count, read whenever the pack is submitted or refreshed. GitHub serves
  -- the files, so there is no download of ours to count.
  stars INTEGER NOT NULL DEFAULT 0,
  templates INTEGER NOT NULL DEFAULT 0,
  rules INTEGER NOT NULL DEFAULT 0,
  assets INTEGER NOT NULL DEFAULT 0,
  recipes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX packs_rank ON packs(stars DESC, updated_at DESC);
CREATE INDEX packs_owner ON packs(owner_id);
-- One pack per folder: two names cannot claim the same files.
CREATE UNIQUE INDEX packs_repo ON packs(repo_owner, repo_name, folder);

-- Every registered version, pinned to the commit it was read at, with the manifest as it
-- was there. A version is never re-pinned: a new version means a new row.
CREATE TABLE pack_versions (
  name TEXT NOT NULL REFERENCES packs(name) ON DELETE CASCADE,
  version TEXT NOT NULL,
  sha TEXT NOT NULL,
  manifest TEXT NOT NULL,
  size INTEGER NOT NULL,
  published_at INTEGER NOT NULL,
  PRIMARY KEY (name, version)
);
