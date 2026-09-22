import { z } from "zod";
import { readEditor } from "../editor/store";
import { promoteClipToSequence } from "../editor/editable-timeline";
import { resolveTarget, TemplateTarget, SlotValue } from "../templates/plan";
import { applyTemplate, type TemplateApplyResult } from "../templates/apply";
import { listRules } from "./registry";
import type { RuleRecord } from "./schema";

/**
 * Executing rules is deterministic. The judgement — which rules match this
 * video — was made before, by an agent or by a person ticking boxes. From here
 * on it is the same template application a person makes from the panel, with
 * the matched rules deciding which template and what to override.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Same semantics as a template override: objects merge, arrays and scalars replace. */
export function mergeOverrides(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  if (!isPlainObject(patch)) return base;
  const target: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    target[key] = isPlainObject(value) && isPlainObject(target[key]) ? mergeOverrides(target[key] as Record<string, unknown>, value) : value;
  }
  return target;
}

export type ResolvedRules = {
  /** The template the highest-priority matched rule asked for, if any. */
  templateId?: string;
  /** Every matched rule's overrides, merged in priority order (later wins on a field). */
  overrides: Record<string, unknown>;
  /** Slot values the matched rules supply, merged the same way. The caller's win over these. */
  slots: Record<string, SlotValue>;
  /** Constraint text from every matched rule, in priority order. */
  prompts: string[];
  rules: RuleRecord[];
};

export function resolveRules(matched: RuleRecord[]): ResolvedRules {
  const ordered = [...matched].filter((r) => r.enabled).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  let overrides: Record<string, unknown> = {};
  const slots: Record<string, SlotValue> = {};
  const prompts: string[] = [];
  let templateId: string | undefined;
  for (const rule of ordered) {
    if (rule.then.template && !templateId) templateId = rule.then.template;
    overrides = mergeOverrides(overrides, rule.then.overrides);
    // A slot is one value, not a patch: the later rule replaces it whole.
    for (const [id, value] of Object.entries(rule.then.slots ?? {})) slots[id] = value;
    if (rule.promptText.trim()) prompts.push(rule.promptText.trim());
  }
  return { templateId, overrides, slots, prompts, rules: ordered };
}

/**
 * Who wrote an edit. The `template:` prefix is kept so re-applying the template
 * replaces these edits like its own; the `/rule:` suffix says which rules chose it,
 * which is what "why is this here" reads.
 */
export const ruleAuthor = (templateId: string, ruleIds: string[]) => `template:${templateId}/rule:${ruleIds.join(",")}`;
export const rulesInAuthor = (by: string): string[] => by.match(/\/rule:([^/]+)$/)?.[1].split(",").filter(Boolean) ?? [];
export const templateInAuthor = (by: string): string | null => by.match(/^template:([^/]+)/)?.[1] ?? null;

/** The template last applied to this video, read from its own edits. */
export function appliedTemplate(edl: ReturnType<typeof readEditor>["edl"], target: { sequenceId?: string; clipId?: string }): string | null {
  const { sequenceId, promotes } = resolveTarget(edl, target);
  const working = promotes ? promoteClipToSequence(edl, sequenceId) : edl;
  const sequence = working.sequences.find((s) => s.id === sequenceId);
  for (const item of sequence?.items ?? []) for (const edit of item.clip.edits) {
    const id = templateInAuthor(edit.by);
    if (id) return id;
  }
  return null;
}

export const RuleApplyRequest = z.object({
  /** Rules judged to match. Order does not matter; priority does. */
  ruleIds: z.array(z.string().min(1)).min(1),
  ...TemplateTarget.shape,
  /** Used when no matched rule names a template and the video has none applied yet. */
  templateId: z.string().optional(),
  hookText: z.string().optional(),
  slots: z.record(z.string(), SlotValue).default({}),
  providers: z.array(z.string()).optional(),
});
export type RuleApplyRequest = z.infer<typeof RuleApplyRequest>;

export type RuleApplyResult = {
  revision: number;
  templateId: string;
  /** How the template was chosen. */
  templateFrom: "rule" | "request" | "applied" | "suggested";
  overrides: Record<string, unknown>;
  prompts: string[];
  applied: TemplateApplyResult["applied"] | null;
  plan: TemplateApplyResult["plan"] | null;
  /** Rule ids that were asked for but do not exist or are disabled. */
  ignored: string[];
};

/** Rule > request > the template already on the video > the best-scoring one. */
async function chooseTemplate(
  edl: ReturnType<typeof readEditor>["edl"], target: { sequenceId?: string; clipId?: string },
  fromRule: string | undefined, fromRequest: string | undefined, slots: Record<string, SlotValue>,
): Promise<{ templateId: string; templateFrom: RuleApplyResult["templateFrom"] }> {
  if (fromRule) return { templateId: fromRule, templateFrom: "rule" };
  if (fromRequest) return { templateId: fromRequest, templateFrom: "request" };
  const applied = appliedTemplate(edl, target);
  if (applied) return { templateId: applied, templateFrom: "applied" };
  const { suggestTemplates } = await import("../templates/suggest");
  const best = (await suggestTemplates(edl, target, slots)).suggestions[0];
  if (!best) throw new Error("No template to apply these rules with.");
  return { templateId: best.templateId, templateFrom: "suggested" };
}

export async function applyRules(projectId: string, raw: unknown, expectedRevision: number): Promise<RuleApplyResult> {
  const request = RuleApplyRequest.parse(raw);
  const known = await listRules(projectId);
  const byId = new Map(known.map((r) => [r.id, r]));
  const matched = request.ruleIds.map((id) => byId.get(id)).filter((r): r is RuleRecord => !!r && r.enabled);
  const ignored = request.ruleIds.filter((id) => !byId.get(id)?.enabled);
  const resolved = resolveRules(matched);

  const { edl } = readEditor(projectId);
  const target = { sequenceId: request.sequenceId, clipId: request.clipId };
  // The caller is more specific than the rule that suggested a default, so its slots win.
  const slots = { ...resolved.slots, ...request.slots };
  const chosen = await chooseTemplate(edl, target, resolved.templateId, request.templateId, slots);
  const { templateId, templateFrom } = chosen;

  // A rule that only adds a constraint sentence changes nothing on the timeline.
  if (!matched.some((r) => r.then.template || r.then.overrides || r.then.slots)) {
    return { revision: expectedRevision, templateId, templateFrom, overrides: {}, prompts: resolved.prompts, applied: null, plan: null, ignored };
  }

  const result = await applyTemplate(projectId, {
    templateId, ...target, hookText: request.hookText, slots, providers: request.providers,
    overrides: resolved.overrides,
  }, expectedRevision, { author: ruleAuthor(templateId, resolved.rules.map((r) => r.id)) });
  return { revision: result.revision, templateId, templateFrom, overrides: resolved.overrides, prompts: resolved.prompts, applied: result.applied, plan: result.plan, ignored };
}
