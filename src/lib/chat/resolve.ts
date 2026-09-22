import type { Edl, SequenceItem } from "../edl";
import { probe } from "../media";
import type { PlannedComment } from "../templates/plan";
import type { VideoTemplate } from "../templates/schema";
import { answers, chatSource, chatWindow, commentById, rankComments, readComments, type ChatComment, type RankedComment } from "./comments";

/**
 * Which comment a video opens on, and why — or why none.
 *
 * Shared by the template (the dry run, the apply, and so every rule that names one) and
 * by the tools both editors use to list and choose a comment by hand, so the choice a
 * person sees offered is the choice the template would have made.
 */

export type CommentLookup = {
  /** The shot the chat is read against: the first one on the main track with words in it. */
  item: SequenceItem | null;
  /** Epoch ms the recording began, when the file says. */
  recordedAt: number | null;
  /** Comments from the window around the clip, best match first. */
  ranked: RankedComment[];
  /** Why there is nothing to choose from, when there is not. */
  problem: string | null;
};

const recordedAtCache = new Map<string, number | null>();

async function recordingStart(file: string): Promise<number | null> {
  if (!recordedAtCache.has(file)) recordedAtCache.set(file, await probe(file).then((p) => p.recordedAt).catch(() => null));
  return recordedAtCache.get(file)!;
}

/** Every comment the chat holds around this video, ranked by what the clip says. */
export async function lookupComments(edl: Edl, sequenceId: string, lookbackSec?: number): Promise<CommentLookup> {
  const sequence = edl.sequences.find((s) => s.id === sequenceId);
  const clip = edl.clips.find((c) => c.id === sequenceId);
  // A generated clip that has not been promoted yet is its own shot on the primary source.
  const item: SequenceItem | null = sequence
    ? sequence.items.find((entry) => (entry.layer ?? 0) === 0 && entry.mediaId && entry.clip.words.length) ?? null
    : clip ? { id: clip.id, mediaId: "__primary", clip } as SequenceItem : null;
  const none = (problem: string): CommentLookup => ({ item, recordedAt: null, ranked: [], problem });
  if (!item) return none("This video has no spoken shot to read the chat against.");
  const source = chatSource();
  if (!source.path) return none("No chat database is set. Point the workspace at the stream chat's chat.db.");
  const file = item.mediaId === "__primary" ? edl.source?.file : edl.media.find((m) => m.id === item.mediaId)?.file;
  if (!file) return none("The shot's footage is not in this project.");
  const recordedAt = await recordingStart(file);
  if (!recordedAt) return none("The recording does not say when it started, so its chat cannot be lined up with it.");
  const window = chatWindow(item.clip, recordedAt, lookbackSec);
  let comments: ChatComment[];
  try { comments = readComments(source.path, window.from, window.to); }
  catch (error) { return { ...none(`The chat database could not be read: ${(error as Error).message}`), recordedAt }; }
  if (!comments.length) return { item, recordedAt, ranked: [], problem: "Nobody wrote in the chat around this clip." };
  return { item, recordedAt, ranked: rankComments(comments, item.clip, recordedAt), problem: null };
}

export const plannedComment = (comment: RankedComment | ChatComment, clipStart: number, recordedAt: number, chosen: PlannedComment["chosen"]): PlannedComment => ({
  id: comment.id, platform: comment.platform, name: comment.name, text: comment.text,
  offsetSec: Math.round(((comment.ts - recordedAt) / 1000 - clipStart) * 10) / 10,
  matched: "matched" in comment ? comment.matched : [],
  chosen,
});

/**
 * The comment a template application opens on. `commentId` from the request wins; a
 * template that opens on comments finds one; otherwise there is none and nothing is said.
 */
export async function resolveTemplateComment(
  edl: Edl, sequenceId: string, template: VideoTemplate, commentId: number | "none" | undefined,
): Promise<{ comment: ChatComment | null; planned: PlannedComment | null; warning: string | null }> {
  if (commentId === "none" || (commentId === undefined && !template.comment.enabled)) return { comment: null, planned: null, warning: null };
  if (typeof commentId === "number") {
    const source = chatSource();
    const found = source.path ? commentById(source.path, commentId) : null;
    if (!found) throw new Error(`There is no chat message ${commentId}${source.path ? "" : " — no chat database is set"}.`);
    const lookup = await lookupComments(edl, sequenceId, template.comment.lookbackSec);
    const planned = plannedComment(lookup.ranked.find((r) => r.id === found.id) ?? found, lookup.item?.clip.start ?? 0, lookup.recordedAt ?? found.ts, "request");
    return { comment: found, planned, warning: null };
  }
  const lookup = await lookupComments(edl, sequenceId, template.comment.lookbackSec);
  if (lookup.problem) return { comment: null, planned: null, warning: `No comment to open on: ${lookup.problem}` };
  const best = lookup.ranked.find(answers);
  if (!best) {
    return { comment: null, planned: null, warning:
      `No comment to open on: none of the ${lookup.ranked.length} messages around this clip is one the streamer reads out. Choose one by hand if it answers somebody.` };
  }
  return { comment: best, planned: plannedComment(best, lookup.item!.clip.start, lookup.recordedAt!, "matched"), warning: null };
}
