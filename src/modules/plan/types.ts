import { z } from "zod";
import { PlanReview } from "../review/types";

/**
 * The plan is what the agent decided and why, kept next to the timeline it
 * describes. It lives inside the project state, so it is revisioned, undoable,
 * readable through project.read and editable through project.edit like anything
 * else. Two levels: the project plan holds what every video shares; a sequence
 * plan holds what is local to one video and may override the shared choice.
 */

export const BeatKind = z.enum(["hook", "point", "payoff", "outro", "other"]);
export type BeatKind = z.infer<typeof BeatKind>;

export const Beat = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  kind: BeatKind.default("point"),
  /** What this stretch is for, in one line: "the claim", "the turn", "call to action". */
  intent: z.string().default(""),
  /** Why it sits here. */
  reason: z.string().default(""),
  /** The timeline items this beat spans. Ranges resolve from the items, so a hand trim moves the beat. */
  itemIds: z.array(z.string()).default([]),
  /** Where inside the first item it starts and how long it runs, in the item's source seconds. Omitted means the whole item. */
  atSec: z.number().nonnegative().optional(),
  durationSec: z.number().positive().optional(),
}).strict();
export type Beat = z.infer<typeof Beat>;

export const SequenceStatus = z.enum(["pending", "edited", "approved", "rendered"]);
export type SequenceStatus = z.infer<typeof SequenceStatus>;

export const SequencePlan = z.object({
  /** Overrides the project's template for this video only. */
  template: z.string().nullable().default(null),
  /** Template overrides on top of the project's. */
  overrides: z.record(z.string(), z.unknown()).default({}),
  /** Rules judged to hold for this video. */
  rules: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /**
   * How strongly the agent rated the moment this video was cut from, 0–100.
   * `null` for a video that was never a proposal — a blank canvas or a hand-made cut.
   * A generated clip carries its score across `clip.promote`: at forty candidates the
   * ranking is how you decide what to watch, and losing it on the first edit means
   * losing it exactly when you start working.
   */
  score: z.number().min(0).max(100).nullable().default(null),
  /** One line of what this video says, read by the series section to avoid saying it twice. */
  summary: z.string().default(""),
  beats: z.array(Beat).default([]),
  status: SequenceStatus.default("pending"),
  /** Why each decision was made, keyed by field: template, rules, status… */
  reasons: z.record(z.string(), z.string()).default({}),
  /** What this video says about the standard its pack holds it to: severities and waivers. */
  review: PlanReview.prefault({}),
  /** When the plan was last written by an agent, epoch ms. 0 = never. */
  generatedAt: z.number().nonnegative().default(0),
}).strict();
export type SequencePlan = z.infer<typeof SequencePlan>;

export const Brief = z.object({
  goal: z.string().default(""),
  platform: z.string().default(""),
  audience: z.string().default(""),
  lengthSec: z.number().positive().nullable().default(null),
  notes: z.string().default(""),
}).strict();
export type Brief = z.infer<typeof Brief>;

export const Series = z.object({
  enabled: z.boolean().default(false),
  /** Sequence ids in the order they should be published. */
  order: z.array(z.string()).default([]),
  numbering: z.enum(["none", "n-of-total", "n"]).default("none"),
  /** Points already covered, one per line, so a later video does not repeat them. */
  covered: z.array(z.string()).default([]),
}).strict();

export const ProjectPlan = z.object({
  brief: Brief.prefault({}),
  template: z.string().nullable().default(null),
  /**
   * The templates this project may be made in. One of them and `template` names it; several
   * and the choice is made per video, from this shortlist and no further — which is what
   * picking several on the home screen means. Empty is "anything on this machine".
   */
  templates: z.array(z.string()).default([]),
  overrides: z.record(z.string(), z.unknown()).default({}),
  rules: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /** A glossary subject this project is about, if any. */
  subject: z.string().default(""),
  series: Series.prefault({}),
  /** The same, for every video in the project. A video's own says the rest. */
  review: PlanReview.prefault({}),
  reasons: z.record(z.string(), z.string()).default({}),
  generatedAt: z.number().nonnegative().default(0),
}).strict();
export type ProjectPlan = z.infer<typeof ProjectPlan>;

/** For code that builds a sequence or project literally rather than parsing one. */
export const emptySequencePlan = (): SequencePlan => SequencePlan.parse({});
export const emptyProjectPlan = (): ProjectPlan => ProjectPlan.parse({});
