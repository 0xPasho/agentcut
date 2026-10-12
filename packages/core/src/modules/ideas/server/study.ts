import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { FFMPEG, run } from "../../../common/server/bin";
import { transcribeFile } from "../../transcription/server/dictate";
import type { Save } from "../types";
import { saveDir } from "./saves";

/**
 * What a link cannot tell: what a saved video looks like and what is said in it. Both
 * are worked out once on this computer and cached beside the save, so the preview, a
 * second idea and a third harness all read the same files for free.
 */

const TRANSCRIPT = "transcript.txt";

export async function cachedTranscript(save: Pick<Save, "id">): Promise<string | null> {
  const file = path.join(saveDir(save.id), TRANSCRIPT);
  return existsSync(file) ? fs.readFile(file, "utf8") : null;
}

/** What is said in the saved video, recognised by the local whisper.cpp on first ask. */
export async function transcriptFor(save: Pick<Save, "id" | "mediaStatus" | "mediaFile">): Promise<string> {
  const cached = await cachedTranscript(save);
  if (cached !== null) return cached;
  if (save.mediaStatus !== "done" || !save.mediaFile) throw new Error("The video is not kept yet, so there is nothing to listen to.");
  const { text } = await transcribeFile(path.join(saveDir(save.id), save.mediaFile));
  await fs.writeFile(path.join(saveDir(save.id), TRANSCRIPT), text);
  return text;
}

/** Four stills across the first 40 seconds: where a short's hook and its turn are. */
export async function framesFor(save: Pick<Save, "id" | "mediaStatus" | "mediaFile">): Promise<string[]> {
  if (save.mediaStatus !== "done" || !save.mediaFile) return [];
  const dir = saveDir(save.id);
  if (!existsSync(path.join(dir, "frame-1.jpg"))) {
    const video = path.join(dir, save.mediaFile);
    for (const [i, at] of [1, 4, 12, 30].entries()) {
      await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(at), "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", path.join(dir, `frame-${i + 1}.jpg`)]).catch(() => {});
    }
  }
  return [1, 2, 3, 4].map((i) => `frame-${i}.jpg`).filter((f) => existsSync(path.join(dir, f)));
}
