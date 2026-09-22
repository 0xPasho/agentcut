import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../../../common/server/config";
import { q } from "../../../common/server/db";

/** Only exports of the current revision are offered as current downloads. */
export async function renderedClips(projectId: string): Promise<Record<string, string>> {
  const dir = projectDir(projectId);
  const project = q.getProject(projectId);
  if (!project) return {};
  const manifest = await fs.readFile(path.join(dir, "rendered.json"), "utf8").then(JSON.parse).catch(() => null) as Record<string, { revision: number; file: string }> | null;
  if (manifest) {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(manifest)) {
      if (entry.revision === project.revision && path.basename(entry.file) === entry.file) {
        const file = path.join(dir, "clips", entry.file);
        if (await fs.stat(file).then(s => s.isFile()).catch(() => false)) out[id] = file;
      }
    }
    return out;
  }
  // Existing projects before revisions were introduced retain their original exports.
  if (project.revision !== 0) return {};
  const files = await fs.readdir(path.join(dir, "clips")).catch(() => [] as string[]);
  return Object.fromEntries(files.filter(f => f.endsWith(".mp4")).map(f => [f.split("-")[0], path.join(dir, "clips", f)]));
}
