import { q } from "../../../common/server/db";
import { applyOperations, type EditorOperation } from "../../editor/lib/operations";
import { editProject, readEditor, RevisionConflict } from "../../editor/server/store";
import type { Edit, Edl } from "../../editor/types";
import { sequenceFrames } from "../../editor/lib/sequences";
import { COMMENT_TITLE, commentItem, isBookendTitle, isTemplateEdit, resolveTarget, type PlannedComment } from "../../templates/server/plan";
import { TemplateComment } from "../../templates/types";
import { commentCardAsset } from "./card";
import { answers, chatSource, commentById } from "./comments";
import { commentReading, lookupComments, plannedComment } from "./resolve";
import { blurUnder, popCommentItem, popWindow } from "../../templates/lib/comment";
import { COMMENT_AUTHOR, POP_COMMENT } from "../../templates/data/comment";

/** A sound that ships with the app, by name, as an asset id — or null when the owner deleted it. */
async function starterSound(name: string): Promise<string | null> {
  if (!name) return null;
  const { installStarterSounds } = await import("../../media/server/assets");
  await installStarterSounds();
  return q.listAssets("audio").find((asset) => asset.source === "starter" && asset.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

/**
 * Choosing the comment a video opens on, by hand. The panel's list and the agent's
 * `comments.list` / `comments.place` tools are these two functions, and the layer they
 * write is the one a template writes — same picture, same animation, same hook waiting
 * for it — so either interface can take over from the other.
 */

export type CommentChoices = {
  /** Where the chat is read from, and why nothing is listed when nothing is. */
  source: string | null;
  problem: string | null;
  /** The comment the video opens on now, if it has one: which chat message, and how it enters. */
  current: { itemId: string; assetId: string; seconds: number; commentId: number | null; style: "open" | "pop" } | null;
  comments: Array<PlannedComment & { answers: boolean; score: number }>;
};

const currentComment = (edl: Edl, sequenceId: string) => {
  const item = edl.sequences.find((s) => s.id === sequenceId)?.items.find((entry) => entry.clip.title === COMMENT_TITLE);
  const image = item?.clip.edits.find((edit): edit is Extract<Edit, { type: "image" }> => edit.type === "image");
  if (!item || !image) return null;
  // The card's picture is tagged with the message it draws, which is how "the same comment,
  // the other way in" knows what to redraw.
  const tagged = /\bchat:(\d+)\b/.exec(q.getAsset(image.src)?.tags ?? "")?.[1];
  return {
    itemId: item.id, assetId: image.src, seconds: item.clip.end - item.clip.start,
    commentId: tagged ? Number(tagged) : null, style: item.keyframes?.length ? "open" as const : "pop" as const,
  };
};

export async function listComments(projectId: string, target: { sequenceId?: string; clipId?: string }, limit = 25): Promise<CommentChoices> {
  const { edl } = readEditor(projectId);
  const { sequenceId } = resolveTarget(edl, target);
  const lookup = await lookupComments(edl, sequenceId);
  return {
    source: chatSource().path,
    problem: lookup.problem,
    current: currentComment(edl, sequenceId),
    comments: lookup.ranked.slice(0, limit).map((comment) => ({
      ...plannedComment(comment, lookup.item!.clip.start, lookup.recordedAt!, "matched"),
      answers: answers(comment), score: Math.round(comment.score * 100) / 100,
    })),
  };
}

/**
 * Open the video on this comment, or on none. Replaces whichever comment it had, and
 * moves the hook's words to arrive when the comment leaves — or back to the first frame.
 */
export async function placeComment(
  projectId: string,
  request: {
    sequenceId?: string; clipId?: string; commentId: number | "none"; seconds?: number; expectedRevision: number;
    /** `open` opens the video on it; `pop` bursts it in over the hook while it is read out. Omitted keeps the video's own. */
    style?: "open" | "pop";
  },
  actor: "human" | "agent" = "human",
) {
  const current = readEditor(projectId);
  if (current.revision !== request.expectedRevision) throw new RevisionConflict(current);
  const { sequenceId, promotes } = resolveTarget(current.edl, request);
  const source = chatSource();
  const comment = request.commentId === "none" ? null : source.path ? commentById(source.path, request.commentId) : null;
  if (request.commentId !== "none" && !comment) throw new Error(`There is no chat message ${request.commentId}${source.path ? "" : " — no chat database is set"}.`);

  const operations: EditorOperation[] = [];
  let working = current.edl;
  const push = (op: EditorOperation) => { operations.push(op); working = applyOperations(working, [op]); };
  if (promotes) push({ type: "clip.promote", clipId: sequenceId });
  const sequence = () => working.sequences.find((s) => s.id === sequenceId)!;
  // A comment with no animation on it is a `pop`: it lands and leaves on the frame.
  const existing = sequence().items.find((entry) => entry.clip.title === COMMENT_TITLE);
  const style = request.style ?? (existing && !existing.keyframes?.length ? "pop" : "open");
  for (const item of sequence().items.filter((entry) => entry.clip.title === COMMENT_TITLE))
    push({ type: "item.remove", sequenceId, itemId: item.id });
  // The blur a previous pop put under its card goes with the card. A blur somebody added
  // by hand is theirs and stays.
  for (const item of sequence().items) {
    const edits = item.clip.edits.filter((edit) => !(edit.type === "blur" && (edit.by === COMMENT_AUTHOR || isTemplateEdit(edit))));
    if (edits.length !== item.clip.edits.length) push({ type: "item.patch", sequenceId, itemId: item.id, patch: { edits } });
  }

  const look = style === "pop" ? POP_COMMENT : TemplateComment.parse({});
  const seconds = request.seconds ?? look.seconds;
  // The body starts after an intro card, where the template would have put it.
  const frames = sequenceFrames(sequence());
  const intro = frames.items.find((entry) => (entry.item.layer ?? 0) === 0 && entry.item.clip.title === "Intro");
  const bodyStart = intro ? (intro.from + intro.duration) / sequence().output.fps : 0;
  const topLayer = sequence().items.reduce((highest, item) => Math.max(highest, item.layer ?? 0), 0);
  if (comment && style === "pop") {
    const asset = await commentCardAsset(projectId, comment, look.card);
    const lookup = await lookupComments(working, sequenceId);
    const bodyEnd = frames.duration / sequence().output.fps;
    const window = popWindow(sequence(), { ...look, seconds }, { start: bodyStart, end: bodyEnd }, commentReading(lookup.item, comment));
    const sound = await starterSound(look.sound.starter);
    for (const op of blurUnder(sequence(), window, look.blur, topLayer + 1, COMMENT_AUTHOR)) push(op);
    push(popCommentItem(sequenceId, `i_${crypto.randomUUID().slice(0, 8)}`, asset.id, window, topLayer + 1, look,
      sound ? { src: sound, gain: look.sound.gain, durationSec: look.sound.durationSec } : null, COMMENT_TITLE, COMMENT_AUTHOR));
  } else if (comment) {
    const asset = await commentCardAsset(projectId, comment);
    push(commentItem(sequenceId, `i_${crypto.randomUUID().slice(0, 8)}`, asset.id, bodyStart, seconds, topLayer + 1, look, ""));
  }

  // The hook waits for an opening comment to go, and comes back to the first frame
  // without one — or with a pop, which lands over it.
  const opening = comment && style === "open" ? seconds : 0;
  for (const hook of sequence().items.filter((item) => item.clip.title === "Hook" && !isBookendTitle(item.clip.title))) {
    const edits = hook.clip.edits.map((edit) => {
      if (edit.type !== "text") return edit;
      const end = edit.t + edit.d;
      const start = Math.min(opening, Math.max(0, end - 0.2));
      return { ...edit, t: start, d: Math.max(0.2, hook.clip.end - hook.clip.start - start) };
    });
    if (JSON.stringify(edits) !== JSON.stringify(hook.clip.edits))
      push({ type: "item.patch", sequenceId, itemId: hook.id, patch: { edits } });
  }

  if (!operations.length) return { revision: current.revision, sequenceId, comment: null };
  const saved = editProject(projectId, { expectedRevision: request.expectedRevision, operations }, { actor });
  const lookup = comment ? await lookupComments(saved.edl, sequenceId) : null;
  return {
    revision: saved.revision,
    sequenceId,
    comment: comment ? plannedComment(lookup?.ranked.find((r) => r.id === comment.id) ?? comment, lookup?.item?.clip.start ?? 0, lookup?.recordedAt ?? comment.ts, "request") : null,
  };
}
