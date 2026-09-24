import { z } from "zod";

/**
 * A pack says what its videos must be true of. A template is what gets applied and
 * `STYLE.md` is prose an agent has every reason to agree with; neither can be checked.
 * This is the part of that judgement that can be written as a number with a limit, or
 * as a question whose answer has to point somewhere.
 *
 * The split that makes it trustworthy: a **check** names one metric from a catalogue the
 * host owns (`data.ts`) and sets the limit, so a pack can neither take a measurement nor
 * lie about one; a **rubric item** is a question an agent answers with evidence, and an
 * answer with nothing beside it does not count as a pass. See REVIEW.md.
 */

export const Severity = z.enum(["critical", "suggestion", "nitpick"]);
export type Severity = z.infer<typeof Severity>;

/** What a rubric answer has to point at. Prose alone is not an answer. */
export const EvidenceKind = z.enum(["timestamp", "frame", "field", "quote"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

const CheckId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes");

/**
 * One measured criterion. `metric` is a name from the catalogue; `min`, `max` and `is`
 * are the limit — `is` for the metrics that are a yes or a no. `tags` and `aspect` are
 * the only conditions: "when the clip is gameplay" is a judgement, and judgements are
 * rules, which already have a `when` an agent reads.
 */
export const ReviewCheck = z.object({
  id: CheckId,
  metric: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
  is: z.boolean().optional(),
  severity: Severity.default("suggestion"),
  /** One sentence saying what to do about it. Required at `critical`. */
  fix: z.string().default(""),
  /** Only videos carrying one of these tags. Empty is every video. */
  tags: z.array(z.string()).default([]),
  aspect: z.enum(["9:16", "1:1", "16:9"]).optional(),
}).strict();
export type ReviewCheck = z.infer<typeof ReviewCheck>;

/** One judged criterion: a question, what the answer must carry, and what to do about it. */
export const RubricItem = z.object({
  id: CheckId,
  ask: z.string().min(1),
  evidence: EvidenceKind.default("timestamp"),
  severity: Severity.default("suggestion"),
  fix: z.string().default(""),
  /** An example in the pack the answer compares against, e.g. `examples/reference.mp4`. */
  compare: z.string().default(""),
}).strict();
export type RubricItem = z.infer<typeof RubricItem>;

/** `review.json` as a pack carries it. */
export const PackReview = z.object({
  schema: z.literal(1).default(1),
  checks: z.array(ReviewCheck).default([]),
  rubric: z.array(RubricItem).default([]),
}).strict();
export type PackReview = z.infer<typeof PackReview>;

/**
 * What a project or one of its videos says about the pack's standard. A severity may be
 * raised freely; lowering one, or waiving a check outright, writes a reason that travels
 * into the artifact beside the finding it answers. Silent suppression is what turns a
 * review into decoration.
 */
export const ReviewWaiver = z.object({
  id: CheckId,
  reason: z.string().min(1),
}).strict();
export type ReviewWaiver = z.infer<typeof ReviewWaiver>;

export const PlanReview = z.object({
  /** Check or rubric id → the severity it has here instead of the pack's. */
  severities: z.record(z.string(), Severity).default({}),
  waivers: z.array(ReviewWaiver).default([]),
  /** Lowering a severity needs a reason too, keyed the same way. */
  reasons: z.record(z.string(), z.string()).default({}),
}).strict();
export type PlanReview = z.infer<typeof PlanReview>;
export const emptyPlanReview = (): PlanReview => PlanReview.parse({});

// ------------------------------------------------------------------ what comes back

/** Everything measured about one video, by metric name. A metric that could not be read is absent. */
export type MetricBag = Record<string, number | boolean>;

export type CheckResult = {
  id: string;
  metric: string;
  severity: Severity;
  value: number | boolean;
  /** The limit it was held to, as a sentence: "at most 62", "false". */
  limit: string;
  ok: boolean;
  fix: string;
  /** Set when a waiver answered it: the finding stands, and so does the reason. */
  waived?: string;
};

export type SkippedCheck = { id: string; why: string };

export const RubricAnswer = z.object({
  id: z.string(),
  verdict: z.enum(["holds", "fails", "cannot-tell"]),
  /** Where to look: a timestamp, a frame file, an EDL field, a line of the transcript. */
  evidence: z.string().default(""),
  note: z.string().default(""),
}).strict();
export type RubricAnswer = z.infer<typeof RubricAnswer>;
export const RubricAnswers = z.object({ answers: z.array(RubricAnswer).default([]) }).strict();

/** A check or a question as one line on screen: what was found, and what to do about it. */
export type Finding = {
  id: string;
  severity: Severity;
  ok: boolean;
  waived?: string;
  fix: string;
  /** What the check measured, or the question that was asked. */
  said: string;
  /** The limit it was held to, or the answer that came back. */
  detail: string;
};

/** A judged item as the artifact keeps it: the question, the answer, and what it is worth. */
export type RubricResult = RubricAnswer & { ask: string; severity: Severity; fix: string; ok: boolean; waived?: string };

export type Verdict = "passed" | "passed-with-findings" | "failed" | "not-reviewed";

/**
 * One review of one video. It lives beside `rendered.json` and stays out of the EDL: the
 * EDL is what the video is, and a review is an observation about one export of it — put
 * it in the project state and every review becomes a revision, staling every other review.
 */
export type ReviewArtifact = {
  schema: 1;
  sequenceId: string;
  title: string;
  /** The pack whose standard this was held to, or null when nothing applies. */
  pack: string | null;
  /** Why that pack, or why none. */
  reason: string;
  at: number;
  revision: number;
  /** Which tiers actually ran: the export tier needs a render, the rubric an agent. */
  stages: Array<"project" | "export" | "rubric">;
  verdict: Verdict;
  checks: CheckResult[];
  rubric: RubricResult[];
  skipped: SkippedCheck[];
  /** Set when the export read is older than the project. */
  stale?: string;
};
