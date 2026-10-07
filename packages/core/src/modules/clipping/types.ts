import { z } from "zod";
import { TemplateSelection } from "../templates/types";

/**
 * What the selection agent is being asked for, resolved. It comes from the template
 * the project is made in — `templates/types.ts` holds the authored form — with the
 * caller's own numbers over the top, and it is the only thing the prompt is built
 * from. Nothing downstream may assume shorts.
 */
export const SelectionSpec = TemplateSelection.extend({
  /** The shape the finished video is in, so the prompt can talk about the real frame. */
  output: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
  }),
});
export type SelectionSpec = z.infer<typeof SelectionSpec>;

/**
 * One stretch of the source the long video keeps, in source seconds. The agent writes
 * these in order; `title` is what that stretch is about, which becomes a chapter.
 */
export const AgentSegment = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  title: z.string().default(""),
  why: z.string().default(""),
});
export type AgentSegment = z.infer<typeof AgentSegment>;

/**
 * The answer to "make one long video out of this". One video, many stretches, in the
 * order they happened — the shape a stream edit actually has, and the reason a clip
 * proposal could not express it.
 */
export const AgentSectionProposal = z.object({
  title: z.string().min(1),
  summary: z.string().default(""),
  reason: z.string().default(""),
  score: z.number().min(0).max(100).default(0),
  segments: z.array(AgentSegment).min(1),
  tags: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
});
export type AgentSectionProposal = z.infer<typeof AgentSectionProposal>;

export const AgentSectionProposals = z.object({ video: AgentSectionProposal });
