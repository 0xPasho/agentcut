import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "./config";

/**
 * Kept separate from render.ts so pages and light routes can list outputs
 * without pulling @remotion/renderer (and its native deps) into the bundle.
 */
export async function renderedClips(projectId: string): Promise<Record<string, string>> {
  const dir = path.join(projectDir(projectId), "clips");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const out: Record<string, string> = {};
  for (const f of files) {
    if (!f.endsWith(".mp4")) continue;
    out[f.split("-")[0]] = path.join(dir, f);
  }
  return out;
}
