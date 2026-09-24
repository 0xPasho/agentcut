import fs from "node:fs";
import path from "node:path";
import { db, q } from "../../../common/server/db";
import { projectDir } from "../../../common/server/config";
import { applyOperations, EditRequest, repairWordTimes, validateEdl, type EditorOperation, type EditorSnapshot } from "../lib/operations";
import { Edl } from "../types";
import { observeHumanEdit, recordObservation } from "../../rules/server/observations";

export class RevisionConflict extends Error {
  constructor(public current: EditorSnapshot) { super("This project changed elsewhere. Review the latest version before saving your draft."); }
}
export function readEditor(projectId: string): EditorSnapshot {
  const project = q.getProject(projectId);
  if (!project?.edl) throw new Error("Project has no edit list");
  return { revision: project.revision, edl: repairWordTimes(Edl.parse(JSON.parse(project.edl))) };
}

/** The media index a file server needs, and the revision it was read at. */
let mediaIndex: { key: string; files: Map<string, string> } | null = null;

/**
 * Where one of a project's media files lives on disk.
 *
 * Serving a byte range of a video must not cost a `readEditor`: validating a four-hour
 * project's edit list takes seconds, and a `<video>` element asks for range after range
 * before it can show a single frame — measured at two to four seconds each, which is a
 * large part of why a cut in the Player went black. The `edl` column is still the one
 * authority; this reads the one field a file server needs out of it, and remembers the
 * answer for as long as the revision it came from stands.
 */
export function mediaFile(projectId: string, mediaId: string): string | null {
  const project = q.getProject(projectId);
  if (!project?.edl) return null;
  const key = `${projectId}:${project.revision}`;
  if (mediaIndex?.key !== key) {
    const raw = JSON.parse(project.edl) as { media?: Array<{ id?: unknown; file?: unknown }> };
    const files = new Map<string, string>();
    for (const media of raw.media ?? []) {
      if (typeof media?.id === "string" && typeof media?.file === "string") files.set(media.id, media.file);
    }
    mediaIndex = { key, files };
  }
  return mediaIndex.files.get(mediaId) ?? null;
}

/** DB is authoritative. Serialize writes and mirror a complete snapshot while holding the write lock. */
function commit(projectId: string, expectedRevision: number, build: (current: Edl | null) => Edl): EditorSnapshot {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = q.getProject(projectId);
    if (!row) throw new Error("Project not found");
    if (row.revision !== expectedRevision) throw new RevisionConflict(readEditor(projectId));
    const current = row.edl ? repairWordTimes(Edl.parse(JSON.parse(row.edl))) : null;
    const edl = validateEdl(build(current));
    // A project without a primary source keeps an empty source_path; its identity is
    // still immutable, and imported media never become the primary source.
    if (edl.projectId !== projectId || (edl.source?.file ?? "") !== row.source_path) throw new Error("Project identity and source cannot be changed by an edit");
    if (current && JSON.stringify(edl.source) !== JSON.stringify(current.source)) throw new Error("Source metadata is immutable");
    const revision = row.revision + 1;
    db.prepare("UPDATE projects SET edl = ?, revision = ? WHERE id = ?").run(JSON.stringify(edl), revision, projectId);
    q.insertEvent({ project_id: projectId, job_id: null, kind: "editor", name: "revision", text: `Saved revision ${revision}`, at: Date.now() });
    db.exec("COMMIT");
    // Exports are derived. A failed mirror cannot invalidate an already committed edit.
    try {
      const dir = projectDir(projectId), temp = path.join(dir, `edl.${process.pid}.${revision}.tmp`);
      fs.writeFileSync(temp, JSON.stringify(edl, null, 2));
      // Other processes may commit between COMMIT and this write. Never publish an older snapshot.
      db.exec("BEGIN IMMEDIATE");
      if (q.getProject(projectId)?.revision === revision) fs.renameSync(temp, path.join(dir, "edl.json"));
      else fs.unlinkSync(temp);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no transaction */ }
      console.error("EDL snapshot export failed; database edit is saved", error);
    }
    return { edl, revision };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* already committed */ }
    throw error;
  }
}
/**
 * `actor` says who is editing. A person's changes to generated work are worth
 * remembering (the observation bank); an agent's are not corrections.
 */
export function editProject(projectId: string, request: unknown, options: { actor?: "human" | "agent" } = {}): EditorSnapshot {
  const { expectedRevision, operations } = EditRequest.parse(request);
  let before: Edl | null = null;
  const saved = commit(projectId, expectedRevision, current => {
    if (!current) throw new Error("Project has no edit list");
    before = current;
    return applyOperations(current, operations);
  });
  if (options.actor === "human" && before) {
    try {
      for (const o of observeHumanEdit(projectId, before, operations)) recordObservation(o);
    } catch (error) { console.error("observation not recorded", error); }
  }
  return saved;
}
/** Selection adds clips; it never replaces edits in existing clips. */
/**
 * Publish what a selection run proposed into the project.
 *
 * A run proposes either a pack of clips or one long video, and both arrive here as an
 * EDL: the clips, the source media they need, and any finished sequence. Onto a project
 * that already has state it goes through the ordinary operations, so a second run adds
 * to what is there instead of replacing it — and so a long video is published by the
 * same path a person adding a shot uses.
 */
export function publishClips(projectId: string, proposal: Edl): EditorSnapshot {
  const row = q.getProject(projectId);
  if (!row) throw new Error("Project not found");
  return commit(projectId, row.revision, current => {
    if (!current) return proposal;
    const operations: EditorOperation[] = [
      ...proposal.media
        .filter(media => !current.media.some(existing => existing.id === media.id || existing.file === media.file))
        .map(media => ({ type: "media.add" as const, media })),
      ...proposal.clips.map(clip => ({ type: "clip.add" as const, clip })),
      ...proposal.sequences
        .filter(sequence => !current.sequences.some(existing => existing.id === sequence.id))
        .map(sequence => ({ type: "sequence.add" as const, sequence })),
    ];
    // A proposal whose media the project already holds under another id would point its
    // shots at nothing. Rewrite them onto the copy that is there.
    const rewritten = operations.map(operation => {
      if (operation.type !== "sequence.add") return operation;
      const items = operation.sequence.items.map(item => {
        if (!item.mediaId || current.media.some(m => m.id === item.mediaId)) return item;
        const byFile = proposal.media.find(m => m.id === item.mediaId);
        const existing = byFile ? current.media.find(m => m.file === byFile.file) : undefined;
        return existing ? { ...item, mediaId: existing.id } : item;
      });
      return { ...operation, sequence: { ...operation.sequence, items } };
    });
    return applyOperations(current, rewritten);
  });
}
