import { DatabaseSync } from "node:sqlite";
import { DB_PATH, ensureWorkspace } from "./config";

declare global {
  // Next.js dev reloads modules; keep one connection across reloads.
  var __clipsmithDb: DatabaseSync | undefined;
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
  `);
  return db;
}

export const db: DatabaseSync = globalThis.__clipsmithDb ?? (globalThis.__clipsmithDb = open());

export type ProjectRow = {
  id: string;
  name: string;
  source_path: string;
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

export type EventRow = {
  id: number;
  project_id: string;
  job_id: string | null;
  kind: string;
  name: string | null;
  text: string;
  at: number;
};

export const q = {
  insertProject: (p: Omit<ProjectRow, "probe" | "edl" | "error" | "status">) =>
    db
      .prepare("INSERT INTO projects (id, name, source_path, status, created_at) VALUES (?, ?, ?, 'new', ?)")
      .run(p.id, p.name, p.source_path, p.created_at),

  listProjects: () =>
    db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as unknown as ProjectRow[],

  getProject: (id: string) =>
    db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as ProjectRow | undefined,

  setProject: (id: string, patch: Partial<Pick<ProjectRow, "status" | "probe" | "edl" | "error">>) => {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    db.prepare(`UPDATE projects SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => (patch as Record<string, string | null>)[k]), id);
  },

  deleteProject: (id: string) => {
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
    db
      .prepare("SELECT * FROM jobs WHERE project_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1")
      .get(projectId) as unknown as JobRow | undefined,

  latestJob: (projectId: string) =>
    db.prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(projectId) as unknown as JobRow | undefined,

  insertEvent: (e: Omit<EventRow, "id">) =>
    db
      .prepare("INSERT INTO events (project_id, job_id, kind, name, text, at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(e.project_id, e.job_id, e.kind, e.name, e.text, e.at),

  eventsSince: (projectId: string, sinceId: number) =>
    db.prepare("SELECT * FROM events WHERE project_id = ? AND id > ? ORDER BY id")
      .all(projectId, sinceId) as unknown as EventRow[],
};
