import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, RevisionConflict } from "./store";
import { projectDir } from "../config";
import type { RenderProgress } from "../render";

export async function renderProject(projectId: string, options: { only?: string[]; expectedRevision?: number; onProgress?: (p: RenderProgress) => void } = {}) {
  const dir = projectDir(projectId);
  const lockPath = path.join(dir, "render.lock");
  let lock;
  try { lock = await fs.open(lockPath, "wx"); }
  catch { throw new Error("This project already has a render in progress. If a previous render process crashed, remove its render.lock before retrying."); }
  try {
    const snapshot = readEditor(projectId);
    if (options.expectedRevision !== undefined && snapshot.revision !== options.expectedRevision) throw new RevisionConflict(snapshot);
    if (options.only?.some(id => ![...snapshot.edl.clips, ...snapshot.edl.sequences].some(clip => clip.id === id))) throw new Error("A requested clip no longer exists");
    const { renderClips } = await import("../render");
    const outputs = await renderClips(snapshot.edl, dir, options);
    const file = path.join(dir, "rendered.json");
    const manifest: Record<string, { revision: number; file: string }> = await fs.readFile(file, "utf8").then(JSON.parse).catch(() => ({}));
    for (const output of outputs) manifest[output.clip.id] = { revision: snapshot.revision, file: path.basename(output.file) };
    await fs.writeFile(`${file}.tmp`, JSON.stringify(manifest));
    await fs.rename(`${file}.tmp`, file);
    return { revision: snapshot.revision, outputs };
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
