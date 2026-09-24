import fs from "node:fs/promises";
import path from "node:path";
import { listPacks, packFolder } from "../../packs/server/packs";
import { activeStyle } from "../../packs/server/style";
import { scanStyle, styleRefusal } from "../../packs/lib/style";
import { BUILTIN_CHECKS, PACK_REVIEW_FILE } from "../data";
import { lintReview } from "../lib/lint";
import { PackReview, ReviewCheck, type RubricItem } from "../types";

/**
 * Which standard a video is held to, and where it comes from.
 *
 * The standard travels with the style guide: a pack that says how its videos are made is
 * the pack that says when one came out wrong, so this asks `activeStyle` rather than
 * inventing a second way to pick a pack. What a pack does not say, the built-in
 * thresholds still say — they are the ones `style.audit` has always used, so a workspace
 * with no pack in it reads exactly as it did before.
 */

export const reviewFile = (id: string) => path.join(packFolder(id), PACK_REVIEW_FILE);

export async function readPackReview(id: string): Promise<PackReview> {
  const raw = await fs.readFile(reviewFile(id), "utf8").catch(() => null);
  if (!raw) return PackReview.parse({});
  return PackReview.parse(JSON.parse(raw));
}

export async function hasPackReview(id: string): Promise<boolean> {
  return (await fs.stat(reviewFile(id)).catch(() => null)) !== null;
}

/**
 * The text a pack's standard puts in front of an agent — every question and every fix
 * sentence — held to the same scan as the style guide, because it reaches the same place.
 */
export function reviewText(review: PackReview): string {
  return [...review.checks.map((c) => c.fix), ...review.rubric.map((r) => `${r.ask}\n${r.fix}`)].join("\n");
}

/** Save a pack's standard. Refused whole if it reads as instructions, or if a check is not one. */
export async function savePackReview(id: string, review: PackReview): Promise<{ review: PackReview; warnings: string[] }> {
  if (!(await listPacks()).some((p) => p.id === id)) throw new Error(`No installed pack named ${id}.`);
  const parsed = PackReview.parse(review);
  const problems = scanStyle(reviewText(parsed));
  if (problems.length) throw new Error(styleRefusal(problems));
  const warnings = lintReview(parsed);
  await fs.mkdir(packFolder(id), { recursive: true });
  if (parsed.checks.length || parsed.rubric.length) await fs.writeFile(reviewFile(id), JSON.stringify(parsed, null, 2) + "\n");
  else await fs.rm(reviewFile(id), { force: true });
  return { review: parsed, warnings };
}

export type Criteria = {
  pack: string | null;
  name: string;
  reason: string;
  checks: ReviewCheck[];
  rubric: RubricItem[];
  /** Examples the rubric may compare against, as absolute paths to their stills. */
  examples: Array<{ file: string; title: string; note: string; still: string }>;
};

/**
 * The checks and questions this video answers to.
 *
 * A pack's check replaces the built-in one for the metric it names and leaves the rest
 * alone: a pack that wants its framing tighter should not thereby stop anyone noticing
 * that the end card is cut off.
 */
export async function activeCriteria(projectId: string, sequenceId?: string): Promise<Criteria> {
  const style = await activeStyle(projectId, sequenceId);
  const review = style.pack ? await readPackReview(style.pack) : PackReview.parse({});
  const named = new Set(review.checks.map((c) => c.metric));
  const builtin = BUILTIN_CHECKS.filter((c) => !named.has(c.metric)).map((c) => ReviewCheck.parse(c));
  return {
    pack: style.pack,
    name: style.name,
    reason: style.pack && (review.checks.length || review.rubric.length)
      ? style.reason
      : style.pack
        ? `${style.name} says how its videos are made and not how they are checked, so these are the built-in ones.`
        : "No pack applies here, so these are the built-in checks.",
    checks: [...builtin, ...review.checks],
    rubric: review.rubric,
    examples: style.examples.map((e) => ({ file: e.file, title: e.title, note: e.note, still: e.still })),
  };
}
