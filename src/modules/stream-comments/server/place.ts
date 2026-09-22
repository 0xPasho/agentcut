import { applyOperations, type EditorOperation } from "../../editor/lib/operations";
import { editProject, readEditor, RevisionConflict } from "../../editor/server/store";
import type { Edit, Edl } from "../../editor/types";
import { sequenceFrames } from "../../editor/lib/sequences";
import { COMMENT_TITLE, commentItem, isBookendTitle, resolveTarget, type PlannedComment } from "../../templates/lib/plan";
import { TemplateComment } from "../../templates/types";
import { commentCardAsset } from "./card";
import { answers, chatSource, commentById } from "./comments";
import { lookupComments, plannedComment } from "./resolve";

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
  /** The comment the video opens on now, if it has one. */
  current: { itemId: string; assetId: string; seconds: number } | null;
  comments: Array<PlannedComment & { answers: boolean; score: number }>;
};

const currentComment = (edl: Edl, sequenceId: string) => {
  const item = edl.sequences.find((s) => s.id === sequenceId)?.items.find((entry) => entry.clip.title === COMMENT_TITLE);
  const image = item?.clip.edits.find((edit): edit is Extract<Edit, { type: "image" }> => edit.type === "image");
  return item && image ? { itemId: item.id, assetId: image.src, seconds: item.clip.end - item.clip.start } : null;
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
  request: { sequenceId?: string; clipId?: string; commentId: number | "none"; seconds?: number; expectedRevision: number },
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
  for (const item of sequence().items.filter((entry) => entry.clip.title === COMMENT_TITLE))
    push({ type: "item.remove", sequenceId, itemId: item.id });

  const look = TemplateComment.parse({});
  const seconds = request.seconds ?? look.seconds;
  // The body starts after an intro card, where the template would have put it.
  const frames = sequenceFrames(sequence());
  const intro = frames.items.find((entry) => (entry.item.layer ?? 0) === 0 && entry.item.clip.title === "Intro");
  const bodyStart = intro ? (intro.from + intro.duration) / sequence().output.fps : 0;
  const topLayer = sequence().items.reduce((highest, item) => Math.max(highest, item.layer ?? 0), 0);
  if (comment) {
    const asset = await commentCardAsset(projectId, comment);
    push(commentItem(sequenceId, `i_${crypto.randomUUID().slice(0, 8)}`, asset.id, bodyStart, seconds, topLayer + 1, look, ""));
  }

  // The hook waits for the comment to go, and comes back to the first frame without one.
  const opening = comment ? seconds : 0;
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
