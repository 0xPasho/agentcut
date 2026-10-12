import path from "node:path";
import fs from "node:fs/promises";
import { downloadUrl } from "../../project/server/ingest";
import { getSave, pendingMedia, saveDir, setMedia } from "./saves";

declare global {
  // One queue per server process, kept across dev reloads.
  var __agentcutSaveDownloads: { queue: string[]; busy: boolean } | undefined;
}
const state = globalThis.__agentcutSaveDownloads ?? (globalThis.__agentcutSaveDownloads = { queue: [], busy: false });

/**
 * Keep a copy of a saved video, so a save outlives a deleted post. One download at a
 * time, in the order things were saved; a failure is written on the save and never
 * stops the next one. The download is yt-dlp, the same as a project from a link.
 */
export function queueDownload(saveId: string) {
  if (!state.queue.includes(saveId)) state.queue.push(saveId);
  void drain();
}

/** Downloads a restarted server never finished. Cheap to call on every read. */
export function resumeDownloads() {
  for (const id of pendingMedia()) queueDownload(id);
}

async function drain() {
  if (state.busy) return;
  state.busy = true;
  try {
    while (state.queue.length) {
      const id = state.queue.shift()!;
      const save = getSave(id);
      if (!save || save.mediaStatus !== "pending") continue;
      try {
        const dir = saveDir(id);
        await fs.mkdir(dir, { recursive: true });
        const file = await downloadUrl(save.url, dir);
        setMedia(id, "done", path.basename(file));
      } catch (error) {
        setMedia(id, "failed", null, (error as Error).message.slice(0, 500));
      }
    }
  } finally {
    state.busy = false;
  }
}
