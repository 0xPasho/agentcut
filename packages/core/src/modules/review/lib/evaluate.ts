import { metric } from "../data";
import type { CheckResult, MetricBag, PlanReview, ReviewCheck, RubricAnswer, RubricItem, RubricResult, Severity, SkippedCheck, Verdict } from "../types";

/**
 * Holding a video to the criteria: pure, so what a review says can be tested without a
 * render, an agent or a workspace.
 *
 * The rules that matter are in here rather than in the caller. A check whose metric was
 * not measured is skipped with a reason, never failed. A waiver leaves the finding where
 * it is and records why it was allowed. A severity is a field — nothing is inferred from
 * the wording of a message, which is how a gate quietly stops firing.
 */

const RANK: Record<Severity, number> = { nitpick: 0, suggestion: 1, critical: 2 };

/** The severity this level holds a check to, and whether lowering it was explained. */
export function severityOf(check: { id: string; severity: Severity }, plan: PlanReview): { severity: Severity; lowered: boolean } {
  const asked = plan.severities[check.id];
  if (!asked || asked === check.severity) return { severity: check.severity, lowered: false };
  return { severity: asked, lowered: RANK[asked] < RANK[check.severity] };
}

/** More local wins, and what is not named locally is inherited whole. */
export function stackPlanReviews(...levels: PlanReview[]): PlanReview {
  return levels.reduce<PlanReview>((all, level) => ({
    severities: { ...all.severities, ...level.severities },
    reasons: { ...all.reasons, ...level.reasons },
    waivers: [...all.waivers.filter((w) => !level.waivers.some((o) => o.id === w.id)), ...level.waivers],
  }), { severities: {}, reasons: {}, waivers: [] });
}

/** A check applies to this video when nothing narrows it, or when what narrows it holds. */
export function applies(check: ReviewCheck, video: { tags: string[]; aspect: string }): boolean {
  if (check.tags.length && !check.tags.some((t) => video.tags.includes(t.toLowerCase()))) return false;
  if (check.aspect && check.aspect !== video.aspect) return false;
  return true;
}

const sentence = (check: ReviewCheck): string => {
  const parts: string[] = [];
  if (check.is !== undefined) parts.push(check.is ? "true" : "false");
  if (check.min !== undefined) parts.push(`at least ${check.min}`);
  if (check.max !== undefined) parts.push(`at most ${check.max}`);
  return parts.join(" and ") || "anything";
};

export type Evaluation = { checks: CheckResult[]; skipped: SkippedCheck[] };

/**
 * Every check that applies, against what was measured. `stages` says which tiers were
 * actually taken, so a check whose metric belongs to a tier that did not run is skipped
 * as "not rendered yet" rather than as "could not be read".
 */
export function evaluateChecks(
  checks: ReviewCheck[],
  bag: MetricBag,
  o: { plan: PlanReview; video: { tags: string[]; aspect: string }; stages: Array<"project" | "export"> },
): Evaluation {
  const results: CheckResult[] = [];
  const skipped: SkippedCheck[] = [];
  for (const check of checks) {
    if (!applies(check, o.video)) { skipped.push({ id: check.id, why: check.aspect && check.aspect !== o.video.aspect ? `this video is ${o.video.aspect}` : `this video is not tagged ${check.tags.join(" or ")}` }); continue; }
    const known = metric(check.metric);
    if (!known) { skipped.push({ id: check.id, why: `nothing here measures ${check.metric}` }); continue; }
    if (!o.stages.includes(known.stage)) { skipped.push({ id: check.id, why: known.stage === "export" ? "not rendered yet" : "the project was not read" }); continue; }
    const value = bag[check.metric];
    if (value === undefined) { skipped.push({ id: check.id, why: `${check.metric} cannot be read on this video` }); continue; }
    const { severity } = severityOf(check, o.plan);
    const ok = holds(check, value);
    const waiver = o.plan.waivers.find((w) => w.id === check.id);
    results.push({
      id: check.id, metric: check.metric, severity, value, limit: sentence(check), ok,
      fix: check.fix, ...(ok || !waiver ? {} : { waived: waiver.reason }),
    });
  }
  return { checks: results, skipped };
}

function holds(check: ReviewCheck, value: number | boolean): boolean {
  if (typeof value === "boolean") return check.is === undefined ? true : value === check.is;
  if (check.min !== undefined && value < check.min) return false;
  if (check.max !== undefined && value > check.max) return false;
  return true;
}

/** The judged tier, once the agent has answered. An answer with no evidence is not one. */
export function evaluateRubric(items: RubricItem[], answers: RubricAnswer[], plan: PlanReview): RubricResult[] {
  const byId = new Map(answers.map((a) => [a.id, a]));
  return items.map((item) => {
    const { severity } = severityOf(item, plan);
    const answer = byId.get(item.id);
    const evidence = answer?.evidence.trim() ?? "";
    const verdict: RubricAnswer["verdict"] = !answer
      ? "cannot-tell"
      : answer.verdict === "holds" && !evidence
        ? "cannot-tell"
        : answer.verdict;
    const note = !answer
      ? "The review did not reach this question."
      : answer.verdict === "holds" && !evidence
        ? `Answered "holds" with nothing to look at. ${answer.note}`.trim()
        : answer.note;
    const waiver = plan.waivers.find((w) => w.id === item.id);
    const ok = verdict === "holds";
    return { id: item.id, ask: item.ask, severity, fix: item.fix, verdict, evidence, note, ok, ...(ok || !waiver ? {} : { waived: waiver.reason }) };
  });
}

/**
 * What the whole thing comes to. A waived finding does not decide the verdict — that is
 * what waiving one is for — and nothing below `critical` can fail a video.
 */
export function verdictOf(checks: CheckResult[], rubric: RubricResult[]): Verdict {
  const findings = [...checks, ...rubric].filter((r) => !r.ok && !r.waived);
  if (!findings.length) return checks.length || rubric.length ? "passed" : "not-reviewed";
  return findings.some((f) => f.severity === "critical") ? "failed" : "passed-with-findings";
}

/** The findings that stop an export, in the order a person should read them. */
export const blocking = (checks: CheckResult[]) =>
  checks.filter((c) => !c.ok && !c.waived && c.severity === "critical");
