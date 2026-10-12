import fs, { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../../../common/server/db";
import { WORKSPACE } from "../../../common/server/config";
import { ReferenceInput, type MediaStatus, type ReferenceDraft, type Save, type SavePatch } from "../types";

/**
 * Saves: what the person kept while browsing, each on its own, before anybody decided
 * what it is for. An idea links to several saves; a save can feed several ideas.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS saves (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    url          TEXT NOT NULL,
    data         TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    screenshot   TEXT,
    media_status TEXT NOT NULL DEFAULT 'none',
    media_file   TEXT,
    media_error  TEXT,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS saves_created ON saves(created_at);
  CREATE TABLE IF NOT EXISTS idea_saves (
    idea_id  TEXT NOT NULL,
    save_id  TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (idea_id, save_id)
  );
  CREATE INDEX IF NOT EXISTS idea_saves_save ON idea_saves(save_id);
`);

type SaveRow = {
  id: string; kind: Save["kind"]; url: string; data: string; note: string; screenshot: string | null;
  media_status: MediaStatus; media_file: string | null; media_error: string | null; created_at: number;
};

export const saveDir = (id: string) => path.join(WORKSPACE, "saves", id.replace(/[^\w-]/g, ""));

const parse = <T>(raw: string, fallback: T): T => {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

function hydrate(rows: SaveRow[]): Save[] {
  if (!rows.length) return [];
  const marks = rows.map(() => "?").join(",");
  const links = db.prepare(`SELECT idea_id, save_id FROM idea_saves WHERE save_id IN (${marks})`).all(...rows.map((r) => r.id)) as Array<{ idea_id: string; save_id: string }>;
  return rows.map((row) => ({
    ...parse<Omit<ReferenceInput, "screenshot">>(row.data, { kind: row.kind, url: row.url }),
    id: row.id, kind: row.kind, url: row.url, note: row.note, screenshot: row.screenshot,
    mediaStatus: row.media_status, mediaFile: row.media_file, mediaError: row.media_error,
    hasTranscript: existsSync(path.join(saveDir(row.id), "transcript.txt")),
    ideaIds: links.filter((l) => l.save_id === row.id).map((l) => l.idea_id),
    createdAt: row.created_at,
  }));
}

export function listSaves(options: { since?: number; limit?: number } = {}): Save[] {
  const rows = db.prepare("SELECT * FROM saves WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?")
    .all(options.since ?? 0, options.limit ?? 1000) as SaveRow[];
  return hydrate(rows);
}

export function getSave(id: string): Save | null {
  const row = db.prepare("SELECT * FROM saves WHERE id = ?").get(id) as SaveRow | undefined;
  return row ? hydrate([row])[0] : null;
}

export function savesOfIdea(ideaId: string): Save[] {
  const rows = db.prepare("SELECT s.* FROM saves s JOIN idea_saves l ON l.save_id = s.id WHERE l.idea_id = ? ORDER BY l.position, s.created_at")
    .all(ideaId) as SaveRow[];
  return hydrate(rows);
}

export const countSaves = (since = 0) =>
  (db.prepare("SELECT COUNT(*) AS n FROM saves WHERE created_at >= ?").get(since) as { n: number }).n;

const IMAGE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * Whether a save points at a video worth keeping a copy of. A post with a video in it
 * counts; a page that merely has one somewhere does not.
 */
export const wantsMedia = (save: Pick<Save, "kind" | "media" | "site">) =>
  save.kind === "video" || (save.kind === "x_post" && !!save.media?.some((m) => m.type === "video"));

export function createSave(input: ReferenceDraft): Save {
  const id = randomUUID().slice(0, 10);
  const { screenshot, note, ...data } = ReferenceInput.parse(input);
  let file: string | null = null;
  const picture = screenshot?.match(IMAGE);
  if (picture) {
    fs.mkdirSync(saveDir(id), { recursive: true });
    file = `shot.${picture[1] === "jpeg" ? "jpg" : picture[1]}`;
    fs.writeFileSync(path.join(saveDir(id), file), Buffer.from(picture[2], "base64"));
  }
  const media: MediaStatus = wantsMedia(data) ? "pending" : "none";
  db.prepare("INSERT INTO saves (id, kind, url, data, note, screenshot, media_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, data.kind, data.url, JSON.stringify(data), note?.trim() ?? "", file, media, Date.now());
  return getSave(id)!;
}

export function updateSave(id: string, patch: SavePatch): Save {
  const save = getSave(id);
  if (!save) throw new Error(`No save ${id}`);
  let note = patch.note ?? save.note ?? "";
  const extra = patch.appendNote?.trim();
  if (extra) note = note ? `${note}\n${extra}` : extra;
  db.prepare("UPDATE saves SET note = ? WHERE id = ?").run(note, id);
  return getSave(id)!;
}

export function setMedia(id: string, status: MediaStatus, file: string | null = null, error: string | null = null) {
  db.prepare("UPDATE saves SET media_status = ?, media_file = ?, media_error = ? WHERE id = ?").run(status, file, error, id);
}

export const pendingMedia = () =>
  (db.prepare("SELECT id FROM saves WHERE media_status = 'pending' ORDER BY created_at").all() as Array<{ id: string }>).map((r) => r.id);

export function deleteSave(id: string) {
  db.prepare("DELETE FROM idea_saves WHERE save_id = ?").run(id);
  db.prepare("DELETE FROM saves WHERE id = ?").run(id);
  fs.rmSync(saveDir(id), { recursive: true, force: true });
}

export function linkSaves(ideaId: string, saveIds: string[]) {
  const top = (db.prepare("SELECT MAX(position) AS p FROM idea_saves WHERE idea_id = ?").get(ideaId) as { p: number | null }).p ?? -1;
  const insert = db.prepare("INSERT OR IGNORE INTO idea_saves (idea_id, save_id, position) VALUES (?, ?, ?)");
  saveIds.forEach((saveId, i) => {
    if (!getSave(saveId)) throw new Error(`No save ${saveId}`);
    insert.run(ideaId, saveId, top + 1 + i);
  });
}

export function unlinkSave(ideaId: string, saveId: string) {
  db.prepare("DELETE FROM idea_saves WHERE idea_id = ? AND save_id = ?").run(ideaId, saveId);
}

export const unlinkIdea = (ideaId: string) => db.prepare("DELETE FROM idea_saves WHERE idea_id = ?").run(ideaId);
