import { DatabaseSync } from "node:sqlite";
import { DB_PATH, ensureWorkspace } from "./config";

declare global {
  // Next.js dev reloads modules; keep one connection across reloads.
  var __agentcutDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  ensureWorkspace();
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      source_path TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'new',
      probe       TEXT,
      edl         TEXT,
      error       TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      kind       TEXT NOT NULL,
      status     TEXT NOT NULL,
      stage      TEXT,
      progress   REAL NOT NULL DEFAULT 0,
      error      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      job_id     TEXT,
      kind       TEXT NOT NULL,
      name       TEXT,
      text       TEXT NOT NULL,
      at         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_project ON events(project_id, id);
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL,
      role        TEXT NOT NULL,
      source      TEXT NOT NULL,
      text        TEXT NOT NULL,
      sequence_id TEXT,
      context     TEXT,
      job_id      TEXT,
      changes     TEXT,
      at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, id);
    CREATE TABLE IF NOT EXISTS assets (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      scope        TEXT NOT NULL,
      project_id   TEXT,
      path         TEXT NOT NULL,
      name         TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '',
      source       TEXT NOT NULL,
      source_url   TEXT,
      license      TEXT,
      attribution  TEXT,
      width        INTEGER,
      height       INTEGER,
      duration_sec REAL,
      sha256       TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assets_scope ON assets(kind, scope, project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS assets_sha ON assets(sha256) WHERE sha256 IS NOT NULL;
  `);
  const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  if (!columns.some(c => c.name === "revision")) db.exec("ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export const db: DatabaseSync = globalThis.__agentcutDb ?? (globalThis.__agentcutDb = open());
// A dev hot reload can reuse a connection opened before a migration existed.
if (!(db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).some(c => c.name === "revision")) {
  db.exec("ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
}

if (!(db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).some(c => c.name === "changes")) {
  db.exec("ALTER TABLE messages ADD COLUMN changes TEXT");
}
db.exec(`CREATE TABLE IF NOT EXISTS project_assets (
  project_id TEXT NOT NULL, asset_id TEXT NOT NULL,
  PRIMARY KEY (project_id, asset_id)
)`);

export type ProjectRow = {
  id: string;
  name: string;
  source_path: string;
  revision: number;
  status: string;
  probe: string | null;
  edl: string | null;
  error: string | null;
  created_at: number;
};

export type JobRow = {
  id: string;
  project_id: string;
  kind: string;
  status: string;
  stage: string | null;
  progress: number;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type AssetRow = {
  id: string;
  kind: "image" | "audio" | "video";
  scope: "library" | "project";
  project_id: string | null;
  path: string;
  name: string;
  tags: string;
  source: string;
  source_url: string | null;
  license: string | null;
  attribution: string | null;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  sha256: string | null;
  created_at: number;
};

/** One turn of a project's conversation. `role` is who spoke; `source` is which interface. */
export type MessageRow = {
  id: number;
  project_id: string;
  role: "user" | "agent";
  source: "web" | "cli" | "mcp" | "agent" | "brief";
  text: string;
  sequence_id: string | null;
  /** JSON: selection, playhead, visible range at the time of the message. */
  context: string | null;
  job_id: string | null;
  /** Agent turns: JSON of what the run changed and how to undo it. */
  changes: string | null;
  at: number;
};

export type EventRow = {
  id: number;
  project_id: string;
  job_id: string | null;
  kind: string;
  name: string | null;
  text: string;
  at: number;
};

/**
 * node:sqlite returns rows with a null prototype. React refuses to serialize those
 * across the Server/Client Component boundary ("Classes or null prototypes are not
 * supported"), so every row leaves this module as a plain object.
 */
function plain<T>(row: unknown): T | undefined {
  return row ? ({ ...(row as object) } as T) : undefined;
}

function plainAll<T>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as object) }) as T);
}

export const q = {
  insertProject: (p: Omit<ProjectRow, "probe" | "edl" | "error" | "status" | "revision">) =>
    db
      .prepare("INSERT INTO projects (id, name, source_path, status, created_at) VALUES (?, ?, ?, 'new', ?)")
      .run(p.id, p.name, p.source_path, p.created_at),

  listProjects: () =>
    plainAll<ProjectRow>(db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all()),

  getProject: (id: string) =>
    plain<ProjectRow>(db.prepare("SELECT * FROM projects WHERE id = ?").get(id)),

  setProject: (id: string, patch: Partial<Pick<ProjectRow, "status" | "probe" | "error">>) => {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    db.prepare(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => (patch as Record<string, string | null>)[k]), id);
  },

  /**
   * Register or refresh a project from outside the web app. The CLI wrote its EDL
   * to disk but never to SQLite, so CLI runs were invisible in the UI.
   */
  upsertProject: (p: {
    id: string;
    name: string;
    source_path: string;
    status: string;
    probe?: string | null;
  }) =>
    db
      .prepare(
        `INSERT INTO projects (id, name, source_path, status, probe, edl, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           source_path = excluded.source_path,
           status = excluded.status,
           probe = COALESCE(excluded.probe, projects.probe),
           error = NULL`,
      )
      .run(p.id, p.name, p.source_path, p.status, p.probe ?? null, null, Date.now()),

  deleteProject: (id: string) => {
    db.prepare("DELETE FROM project_assets WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM events WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM jobs WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  },

  insertJob: (j: JobRow) =>
    db
      .prepare(
        "INSERT INTO jobs (id, project_id, kind, status, stage, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(j.id, j.project_id, j.kind, j.status, j.stage, j.progress, j.created_at, j.updated_at),

  setJob: (id: string, patch: Partial<Pick<JobRow, "status" | "stage" | "progress" | "error">>) => {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => (patch as Record<string, string | number | null>)[k]), Date.now(), id);
  },

  activeJob: (projectId: string) =>
    plain<JobRow>(
      db
        .prepare(
          "SELECT * FROM jobs WHERE project_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
        )
        .get(projectId),
    ),

  latestJob: (projectId: string) =>
    plain<JobRow>(
      db.prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId),
    ),

  insertAsset: (a: AssetRow) =>
    db
      .prepare(
        `INSERT INTO assets (id, kind, scope, project_id, path, name, tags, source, source_url,
                             license, attribution, width, height, duration_sec, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.kind, a.scope, a.project_id, a.path, a.name, a.tags, a.source, a.source_url,
           a.license, a.attribution, a.width, a.height, a.duration_sec, a.sha256, a.created_at),

  getAsset: (id: string) => plain<AssetRow>(db.prepare("SELECT * FROM assets WHERE id = ?").get(id)),

  assetBySha: (sha: string) =>
    plain<AssetRow>(db.prepare("SELECT * FROM assets WHERE sha256 = ?").get(sha)),

  promoteAsset: (id: string) => db.prepare("UPDATE assets SET scope = 'library', project_id = NULL WHERE id = ?").run(id),
  linkAsset: (projectId: string, assetId: string) => db.prepare("INSERT OR IGNORE INTO project_assets (project_id, asset_id) VALUES (?, ?)").run(projectId, assetId),

  /** Library assets plus the ones belonging to this project. */
  listAssets: (kind: string, projectId?: string) =>
    plainAll<AssetRow>(
      db
        .prepare(
          `SELECT assets.*, EXISTS(SELECT 1 FROM project_assets pa WHERE pa.asset_id = assets.id AND pa.project_id = ?) AS in_project
           FROM assets WHERE kind = ? AND (scope = 'library' OR project_id = ? OR EXISTS(SELECT 1 FROM project_assets pa WHERE pa.asset_id = assets.id AND pa.project_id = ?))
           ORDER BY created_at DESC`,
        )
        .all(projectId ?? "", kind, projectId ?? "", projectId ?? ""),
    ),

  deleteAsset: (id: string) => {
    db.prepare("DELETE FROM project_assets WHERE asset_id = ?").run(id);
    return db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  },

  insertEvent: (e: Omit<EventRow, "id">) =>
    db
      .prepare("INSERT INTO events (project_id, job_id, kind, name, text, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(e.project_id, e.job_id, e.kind, e.name, e.text, e.at),

  insertMessage: (m: Omit<MessageRow, "id">) =>
    Number(db
      .prepare("INSERT INTO messages (project_id, role, source, text, sequence_id, context, job_id, changes, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(m.project_id, m.role, m.source, m.text, m.sequence_id, m.context, m.job_id, m.changes, m.at).lastInsertRowid),

  setMessageChanges: (id: number, changes: string | null) => db.prepare("UPDATE messages SET changes = ? WHERE id = ?").run(changes, id),
  getMessage: (id: number) => plain<MessageRow>(db.prepare("SELECT * FROM messages WHERE id = ?").get(id)),

  /** The latest `limit` messages, oldest first. */
  messages: (projectId: string, limit = 50) =>
    plainAll<MessageRow>(db.prepare("SELECT * FROM (SELECT * FROM messages WHERE project_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id").all(projectId, limit)),

  eventsSince: (projectId: string, sinceId: number) =>
    plainAll<EventRow>(
      db.prepare("SELECT * FROM events WHERE project_id = ? AND id > ? ORDER BY id").all(projectId, sinceId),
    ),
};
