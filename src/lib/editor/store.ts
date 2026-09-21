import fs from "node:fs";
import path from "node:path";
import { db, q } from "../db";
import { projectDir } from "../config";
import { applyOperations, EditRequest, repairWordTimes, validateEdl, type EditorSnapshot } from "./operations";
import { Edl } from "../edl";
import { observeHumanEdit, recordObservation } from "../observations";

export class RevisionConflict extends Error {
  constructor(public current: EditorSnapshot) { super("This project changed elsewhere. Review the latest version before saving your draft."); }
}
export function readEditor(projectId: string): EditorSnapshot {
  const project = q.getProject(projectId);
  if (!project?.edl) throw new Error("Project has no edit list");
  return { revision: project.revision, edl: repairWordTimes(Edl.parse(JSON.parse(project.edl))) };
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
export function publishClips(projectId: string, proposal: Edl): EditorSnapshot {
  const row = q.getProject(projectId);
  if (!row) throw new Error("Project not found");
  return commit(projectId, row.revision, current => current
    ? applyOperations(current, proposal.clips.map(clip => ({ type: "clip.add", clip })))
    : proposal);
}
