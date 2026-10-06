import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../../../common/server/config";
import { q } from "../../../common/server/db";
import { readEditor } from "../../editor/server/store";
import { sameContent } from "../../editor/server/signature";

/**
 * Which signed exports still match their video, worked out once per revision: a download
 * is served range by range, and validating a long project's edit list takes seconds.
 */
let signatureCache: { key: string; matches: Set<string> } | null = null;
function signaturesAt(projectId: string, revision: number, manifest: Record<string, { signature?: string }>): Set<string> {
  const key = `${projectId}:${revision}:${Object.entries(manifest).map(([id, entry]) => `${id}=${entry.signature ?? ""}`).join(",")}`;
  if (signatureCache?.key === key) return signatureCache.matches;
  const edl = readEditor(projectId).edl;
  const matches = new Set(Object.entries(manifest).filter(([id, entry]) => entry.signature && sameContent(edl, id, entry.signature)).map(([id]) => id));
  signatureCache = { key, matches };
  return matches;
}

/** Only exports of what each video is now are offered as current downloads. */
export async function renderedClips(projectId: string): Promise<Record<string, string>> {
  const dir = projectDir(projectId);
  const project = q.getProject(projectId);
  if (!project) return {};
  const manifest = await fs.readFile(path.join(dir, "rendered.json"), "utf8").then(JSON.parse).catch(() => null) as Record<string, { revision: number; file: string; signature?: string }> | null;
  if (manifest) {
    const out: Record<string, string> = {};
    // An export is current while its own video is: one word fixed in another of a
    // project's hundred videos used to take every download in it away.
    const signed = Object.values(manifest).some((entry) => entry.signature);
    const matches = signed ? signaturesAt(projectId, project.revision, manifest) : null;
    for (const [id, entry] of Object.entries(manifest)) {
      const current = entry.signature && matches ? matches.has(id) : entry.revision === project.revision;
      if (current && path.basename(entry.file) === entry.file) {
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
