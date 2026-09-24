import { editProject, readEditor } from "../../editor/server/store";
import type { PlanReview, Severity } from "../types";

/**
 * Letting a finding stand, and saying what a finding is worth here.
 *
 * Both go through the same plan operations the panel and the agent already use, so a
 * waiver is revisioned, undoable and visible as an edit — not a switch hidden in a
 * settings file. A waiver never hides the finding: the review still reports it, with the
 * reason beside it, which is the whole difference between a decision and decoration.
 */

type Target = { sequenceId?: string; expectedRevision?: number };

function patch(projectId: string, target: Target, change: (review: PlanReview) => PlanReview) {
  const snapshot = readEditor(projectId);
  const revision = target.expectedRevision ?? snapshot.revision;
  if (target.sequenceId) {
    const sequence = snapshot.edl.sequences.find((s) => s.id === target.sequenceId);
    if (!sequence) throw new Error("Sequence not found");
    return editProject(projectId, { expectedRevision: revision, operations: [{ type: "sequence.plan.patch", sequenceId: sequence.id, patch: { review: change(sequence.plan.review) } }] });
  }
  return editProject(projectId, { expectedRevision: revision, operations: [{ type: "plan.patch", patch: { review: change(snapshot.edl.plan.review) } }] });
}

export function waiveFinding(projectId: string, o: Target & { id: string; reason: string }) {
  return patch(projectId, o, (review) => ({
    ...review,
    waivers: [...review.waivers.filter((w) => w.id !== o.id), { id: o.id, reason: o.reason }],
  }));
}

export function unwaiveFinding(projectId: string, o: Target & { id: string }) {
  return patch(projectId, o, (review) => ({ ...review, waivers: review.waivers.filter((w) => w.id !== o.id) }));
}

/**
 * `null` gives the finding back the severity its pack gave it. Lowering one without
 * saying why is allowed and recorded as such — the reason is what the artifact shows,
 * and an empty one reads as "nobody said".
 */
export function setSeverity(projectId: string, o: Target & { id: string; severity: Severity | null; reason?: string }) {
  return patch(projectId, o, (review) => {
    const severities = { ...review.severities };
    const reasons = { ...review.reasons };
    if (o.severity === null) { delete severities[o.id]; delete reasons[o.id]; }
    else { severities[o.id] = o.severity; if (o.reason) reasons[o.id] = o.reason; }
    return { ...review, severities, reasons };
  });
}
