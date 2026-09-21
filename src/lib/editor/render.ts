import fs from "node:fs/promises";
import path from "node:path";
import { readEditor, RevisionConflict } from "./store";
import { projectDir } from "../config";
import type { RenderProgress } from "../render";
import { processAlive } from "../reaper";

/**
 * The lock file names its owner, so a render killed mid-flight does not lock the
 * project's exports out forever — the next render sees the pid is gone and takes over.
 * Used to require deleting render.lock by hand after checking `ps`.
 */
async function claimRenderLock(lockPath: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await fs.open(lockPath, "wx");
      await lock.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      return lock;
    } catch {
      const owner = await fs.readFile(lockPath, "utf8").then((t) => JSON.parse(t) as { pid?: number }).catch(() => null);
      if (owner?.pid && processAlive(owner.pid)) break;
      await fs.unlink(lockPath).catch(() => {}); // abandoned, or written before owners were recorded
    }
  }
  throw new Error("This project already has a render in progress.");
}

export async function renderProject(projectId: string, options: { only?: string[]; expectedRevision?: number; onProgress?: (p: RenderProgress) => void } = {}) {
  const dir = projectDir(projectId);
  const lockPath = path.join(dir, "render.lock");
  const lock = await claimRenderLock(lockPath);
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
