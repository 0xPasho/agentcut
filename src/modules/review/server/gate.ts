import { readEditor } from "../../editor/server/store";
import type { Edl, VideoSequence } from "../../editor/types";
import { blocking, evaluateChecks, stackPlanReviews } from "../lib/evaluate";
import { projectMetrics } from "../lib/metrics";
import { activeCriteria } from "./criteria";
import { aspectOf } from "./review";

/**
 * The one thing a review stops: an export that the pack's own standard says is wrong,
 * where the project already knows it — a video too long for the platform it is for, a
 * caption band cut in half by the seam, a hook nobody wrote.
 *
 * Only the project tier runs here, because it is the only one a render does not have to
 * happen first for; only `critical` blocks; and a waiver written on the plan is how it is
 * answered, since the point of a waiver is that the decision stays visible beside the
 * finding. Nothing here reads pixels, so exporting never waits on an audit.
 */

export type Block = { sequenceId: string; title: string; findings: Array<{ id: string; fix: string; said: string }> };

export async function reviewBeforeRender(projectId: string, only?: string[]): Promise<Block[]> {
  const { edl } = readEditor(projectId);
  const chosen = only?.length ? edl.sequences.filter((s) => only.includes(s.id)) : edl.sequences;
  const blocks: Block[] = [];
  for (const sequence of chosen) {
    const found = await findingsFor(projectId, edl, sequence);
    if (found.length) blocks.push({ sequenceId: sequence.id, title: sequence.title, findings: found });
  }
  return blocks;
}

async function findingsFor(projectId: string, edl: Edl, sequence: VideoSequence) {
  const criteria = await activeCriteria(projectId, sequence.id);
  const { checks } = evaluateChecks(criteria.checks, projectMetrics(edl, sequence), {
    plan: stackPlanReviews(edl.plan.review, sequence.plan.review),
    video: {
      tags: [...new Set([...sequence.plan.tags, ...edl.plan.tags, ...sequence.items.flatMap((i) => i.clip.tags)].map((t) => t.toLowerCase()))],
      aspect: aspectOf(sequence),
    },
    stages: ["project"],
  });
  return blocking(checks).map((c) => ({
    id: c.id,
    fix: c.fix,
    said: `${c.metric} is ${typeof c.value === "number" ? c.value : c.value ? "true" : "false"}, and this pack asks for ${c.limit}`,
  }));
}

/** What the person or the agent is told instead of an export, with the way out of it. */
export function refusal(blocks: Block[]): string {
  const lines = blocks.flatMap((b) => [
    `${b.title || b.sequenceId}:`,
    ...b.findings.map((f) => `  • ${f.said}.${f.fix ? ` ${f.fix}` : ""}`),
  ]);
  return [
    `This project is held to a standard it does not meet yet, so nothing was exported.`,
    ...lines,
    `Fix them, or waive one on the video's plan with a reason — a waived check still shows in the review.`,
  ].join("\n");
}
