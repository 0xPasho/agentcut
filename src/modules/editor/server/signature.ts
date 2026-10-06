import { createHash } from "node:crypto";
import type { Edl } from "../types";

/**
 * What one video is made of, as a hash: its own timeline and the media under it, not its
 * plan or anything else in the project. Two snapshots with the same signature render the
 * same file, which is what lets an export outlive edits to the project's other videos.
 */
export function contentSignature(edl: Edl, sequenceId: string): string {
  const video = edl.sequences.find(s => s.id === sequenceId) ?? edl.clips.find(c => c.id === sequenceId);
  if (!video) throw new Error("Video no longer exists");
  const value = { ...video, ...("plan" in video ? { plan: undefined } : {}) };
  const media = "items" in video ? edl.media.filter(m => video.items.some(i => i.mediaId === m.id)) : [];
  return createHash("sha256").update(JSON.stringify({ video: value, media, source: edl.source, output: "output" in video ? video.output : edl.output })).digest("hex");
}

/** Whether a video still has the content it had when it was signed. A video that is gone has not. */
export function sameContent(edl: Edl, sequenceId: string, signature: string): boolean {
  try { return contentSignature(edl, sequenceId) === signature; } catch { return false; }
}
