import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "./config";
import { audioPeaks } from "./media";
import type { MediaSource } from "./edl";

export type MediaPeaks = { rate: number; peaks: number[] };

/** Ten buckets a second: a 30-second shot drawn 600px wide has more detail than it can show. */
const PER_SECOND = 10;

/**
 * Peaks for one imported source, cached on disk. Decoding a long stream costs real
 * seconds, and the timeline mounts and unmounts these clips constantly while editing.
 */
export async function mediaPeaks(projectId: string, media: MediaSource): Promise<MediaPeaks> {
  const dir = path.join(projectDir(projectId), "cache");
  const file = path.join(dir, `peaks-${media.id}.json`);
  const cached = await fs.readFile(file, "utf8").catch(() => null);
  if (cached) {
    try { return JSON.parse(cached) as MediaPeaks; } catch { /* a truncated cache is rewritten below */ }
  }
  const result = await audioPeaks(media.file, PER_SECOND);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(result));
  return result;
}
