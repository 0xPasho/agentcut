import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../../../common/server/db";
import { WORKSPACE } from "../../../common/server/config";
import { BOOT_ID } from "../../project/server/reaper";
import { chosenRun, settledStatus, titleFrom } from "../lib";
import { Brief, type Idea, type IdeaPatch, type IdeaRun, type IdeaStatus, type RunStatus, type Save } from "../types";
import { linkSaves, savesOfIdea, unlinkIdea } from "./saves";

// One id per server process: a run still marked running under another id died with it.
const BOOT = BOOT_ID;

db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'inbox',
    note          TEXT NOT NULL DEFAULT '',
    tags          TEXT NOT NULL DEFAULT '[]',
    position      REAL NOT NULL DEFAULT 0,
    chosen_run_id TEXT,
    project_id    TEXT,
    title_auto    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS idea_runs (
    id          TEXT PRIMARY KEY,
    idea_id     TEXT NOT NULL,
    harness     TEXT NOT NULL,
    model       TEXT,
    status      TEXT NOT NULL,
    instruction TEXT NOT NULL DEFAULT '',
    activity    TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL DEFAULT '',
    brief       TEXT,
    error       TEXT,
    cost_usd    REAL,
    boot_id     TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idea_runs_idea ON idea_runs(idea_id, started_at);
`);
// `title_auto`: nobody has typed a title yet, so the first brief may name the idea.

type IdeaRow = {
  id: string; title: string; status: IdeaStatus; note: string; tags: string; position: number;
  chosen_run_id: string | null; project_id: string | null; created_at: number; updated_at: number;
};
type RunRow = {
  id: string; idea_id: string; harness: string; model: string | null; status: RunStatus; instruction: string; activity: string;
  text: string; brief: string | null; error: string | null; cost_usd: number | null; boot_id: string; started_at: number; ended_at: number | null;
};

const parse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

export const ideaDir = (id: string) => path.join(WORKSPACE, "ideas", id.replace(/[^\w-]/g, ""));

/** A run left running by a server that is gone will never finish; say so instead of spinning forever. */
function sweepOrphans() {
  db.prepare("UPDATE idea_runs SET status = 'interrupted', ended_at = ?, error = 'The server restarted while this ran.' WHERE status = 'running' AND boot_id != ?")
    .run(Date.now(), BOOT);
}

const toRun = (row: RunRow): IdeaRun => {
  const brief = row.brief ? Brief.safeParse(parse(row.brief, null)) : null;
  return {
    id: row.id, ideaId: row.idea_id, harness: row.harness, model: row.model, status: row.status, instruction: row.instruction,
    activity: row.activity, text: row.text, brief: brief?.success ? brief.data : null, error: row.error, costUsd: row.cost_usd,
    startedAt: row.started_at, endedAt: row.ended_at,
  };
};

function assemble(rows: IdeaRow[]): Idea[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const runs = db.prepare(`SELECT * FROM idea_runs WHERE idea_id IN (${marks}) ORDER BY started_at`).all(...ids) as RunRow[];
  return rows.map((row) => ({
    id: row.id, title: row.title, status: row.status, note: row.note, tags: parse<string[]>(row.tags, []), position: row.position,
    chosenRunId: row.chosen_run_id, projectId: row.project_id, createdAt: row.created_at, updatedAt: row.updated_at,
    saves: savesOfIdea(row.id),
    runs: runs.filter((r) => r.idea_id === row.id).map(toRun),
  }));
}

export function listIdeas(): Idea[] {
  sweepOrphans();
  return assemble(db.prepare("SELECT * FROM ideas ORDER BY updated_at DESC").all() as IdeaRow[]);
}

export function getIdea(id: string): Idea | null {
  sweepOrphans();
  const row = db.prepare("SELECT * FROM ideas WHERE id = ?").get(id) as IdeaRow | undefined;
  return row ? assemble([row])[0] : null;
}

function mustGet(id: string): Idea {
  const idea = getIdea(id);
  if (!idea) throw new Error(`No idea ${id}`);
  return idea;
}

/** A new idea from saves already kept, plus any new ones captured with it. */
export function createIdea(input: { title?: string; note: string; saves: Save[] }): Idea {
  const id = randomUUID().slice(0, 10);
  const now = Date.now();
  const top = db.prepare("SELECT MIN(position) AS p FROM ideas WHERE status = 'inbox'").get() as { p: number | null };
  const typed = input.title?.trim();
  db.prepare("INSERT INTO ideas (id, title, title_auto, status, note, tags, position, created_at, updated_at) VALUES (?, ?, ?, 'inbox', ?, '[]', ?, ?, ?)")
    .run(id, typed || titleFrom(input.note, input.saves), typed ? 0 : 1, input.note.trim(), (top.p ?? 1) - 1, now, now);
  linkSaves(id, input.saves.map((s) => s.id));
  return mustGet(id);
}

/** More for an idea that exists: the note is appended, never replaced. */
export function appendToIdea(id: string, input: { note: string; saves: Save[] }): Idea {
  const idea = mustGet(id);
  const note = input.note.trim();
  if (note) db.prepare("UPDATE ideas SET note = ? WHERE id = ?").run(idea.note ? `${idea.note}\n\n${note}` : note, id);
  linkSaves(id, input.saves.map((s) => s.id));
  touch(id);
  return mustGet(id);
}

export function removeSaveFromIdea(ideaId: string, saveId: string): Idea {
  db.prepare("DELETE FROM idea_saves WHERE idea_id = ? AND save_id = ?").run(ideaId, saveId);
  touch(ideaId);
  return mustGet(ideaId);
}

const touch = (id: string) => db.prepare("UPDATE ideas SET updated_at = ? WHERE id = ?").run(Date.now(), id);

export function updateIdea(id: string, patch: IdeaPatch): Idea {
  mustGet(id);
  const columns: Record<keyof IdeaPatch, string> = {
    title: "title", note: "note", status: "status", tags: "tags", position: "position", chosenRunId: "chosen_run_id", projectId: "project_id",
  };
  for (const [key, column] of Object.entries(columns) as Array<[keyof IdeaPatch, string]>) {
    const value = patch[key];
    if (value === undefined) continue;
    db.prepare(`UPDATE ideas SET ${column} = ? WHERE id = ?`).run(key === "tags" ? JSON.stringify(value) : (value as string | number | null), id);
  }
  if (patch.title !== undefined) db.prepare("UPDATE ideas SET title_auto = 0 WHERE id = ?").run(id);
  touch(id);
  return mustGet(id);
}

/** The idea goes; the saves it was built from stay in the library. */
export function deleteIdea(id: string): void {
  db.prepare("DELETE FROM idea_runs WHERE idea_id = ?").run(id);
  unlinkIdea(id);
  db.prepare("DELETE FROM ideas WHERE id = ?").run(id);
  fs.rmSync(ideaDir(id), { recursive: true, force: true });
}

export function startRun(ideaId: string, harness: string, model: string | null, instruction: string): IdeaRun {
  const id = randomUUID().slice(0, 10);
  db.prepare("INSERT INTO idea_runs (id, idea_id, harness, model, status, instruction, boot_id, started_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)")
    .run(id, ideaId, harness, model, instruction, BOOT, Date.now());
  settle(ideaId);
  return toRun(db.prepare("SELECT * FROM idea_runs WHERE id = ?").get(id) as RunRow);
}

export function runActivity(runId: string, activity: string) {
  db.prepare("UPDATE idea_runs SET activity = ? WHERE id = ? AND status = 'running'").run(activity.slice(0, 300), runId);
}

export function finishRun(runId: string, result: { status: Exclude<RunStatus, "running">; text?: string; brief?: Brief | null; error?: string | null; costUsd?: number | null }) {
  const row = db.prepare("SELECT idea_id FROM idea_runs WHERE id = ?").get(runId) as { idea_id: string } | undefined;
  if (!row) return;
  db.prepare("UPDATE idea_runs SET status = ?, text = ?, brief = ?, error = ?, cost_usd = ?, ended_at = ? WHERE id = ? AND status = 'running'")
    .run(result.status, result.text ?? "", result.brief ? JSON.stringify(result.brief) : null, result.error ?? null, result.costUsd ?? null, Date.now(), runId);
  settle(row.idea_id);
}

/**
 * Moves an idea between the automatic columns as its runs start and end, and lets its
 * brief name it while the title is still the one made up from a dictated note.
 */
function settle(ideaId: string) {
  const idea = getIdea(ideaId);
  if (!idea) return;
  const status = settledStatus(idea);
  if (status !== idea.status) db.prepare("UPDATE ideas SET status = ? WHERE id = ?").run(status, ideaId);
  const named = chosenRun(idea)?.brief?.title.trim();
  if (named) db.prepare("UPDATE ideas SET title = ? WHERE id = ? AND title_auto = 1").run(named.slice(0, 300), ideaId);
  touch(ideaId);
}
