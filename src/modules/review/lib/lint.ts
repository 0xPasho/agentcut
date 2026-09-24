import { METRICS, metric } from "../data";
import type { PackReview } from "../types";

/**
 * What is wrong with a pack's standard, said before the pack is installed.
 *
 * A check nobody can take, or a critical finding with nothing to do about it, is a defect
 * of the pack: it looks like a standard and enforces nothing. `rules/server/registry.ts`
 * already says when a rule judges but does not act; this is the same sentence for the
 * same reason, on the inspect page rather than in a review that silently never runs.
 */
export function lintReview(review: PackReview): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const check of review.checks) {
    if (seen.has(check.id)) warnings.push(`Two checks are called “${check.id}”; a waiver could not say which one it answers.`);
    seen.add(check.id);
    const known = metric(check.metric);
    if (!known) {
      const near = METRICS.map((m) => m.name).filter((n) => n.split(".")[0] === check.metric.split(".")[0]);
      warnings.push(`Check ${check.id} measures “${check.metric}”, which nothing here can read, so it will never run.${near.length ? ` Did you mean ${near.slice(0, 3).join(", ")}?` : ""}`);
      continue;
    }
    const hasLimit = check.min !== undefined || check.max !== undefined || check.is !== undefined;
    if (!hasLimit) warnings.push(`Check ${check.id} sets no limit, so every video passes it.`);
    if (known.kind === "boolean" && (check.min !== undefined || check.max !== undefined))
      warnings.push(`${check.metric} is a yes or a no; check ${check.id} asks for a number. Use "is".`);
    if (known.kind === "number" && check.is !== undefined)
      warnings.push(`${check.metric} is a number; check ${check.id} asks whether it is true. Use "min" or "max".`);
    if (check.min !== undefined && check.max !== undefined && check.min > check.max)
      warnings.push(`Check ${check.id} asks for at least ${check.min} and at most ${check.max}, which nothing can be.`);
    if (check.severity === "critical" && !check.fix.trim())
      warnings.push(`Check ${check.id} is critical and says nothing about what to do; a finding nobody can act on is not critical.`);
  }
  for (const item of review.rubric) {
    if (seen.has(item.id)) warnings.push(`Two criteria are called “${item.id}”; a waiver could not say which one it answers.`);
    seen.add(item.id);
    if (item.severity === "critical" && !item.fix.trim())
      warnings.push(`Question ${item.id} is critical and says nothing about what to do; a finding nobody can act on is not critical.`);
    if (item.compare && !item.compare.startsWith("examples/"))
      warnings.push(`Question ${item.id} compares against “${item.compare}”, which is not one of the pack's examples.`);
  }
  return warnings;
}
