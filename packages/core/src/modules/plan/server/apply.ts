import { z } from "zod";
import { editProject, readEditor } from "../../editor/server/store";
import { resolveTarget, TemplateTarget, SlotValue } from "../../templates/server/plan";
import { applyTemplate } from "../../templates/server/apply";
import { listRules } from "../../rules/server/registry";
import { appliedTemplate, mergeOverrides, resolveRules } from "../../rules/server/apply";
import type { RuleApplyResult } from "../../rules/server/apply";

/**
 * Applying a plan is deterministic: the template comes from the sequence plan, then
 * the project plan, then whatever is already on the video, then the best-scoring
 * suggestion; overrides stack project → sequence → matched rules; and the whole thing
 * is one template application through the shared operations, marked so "why is this
 * here" can point back at the plan and the rules.
 */

export const PlanApplyRequest = z.object({
  ...TemplateTarget.shape,
  hookText: z.string().optional(),
  slots: z.record(z.string(), SlotValue).default({}),
  providers: z.array(z.string()).optional(),
});

export type PlanApplyResult = RuleApplyResult & { sequenceId: string; status: "edited" };

export async function applyPlan(projectId: string, raw: unknown, expectedRevision: number): Promise<PlanApplyResult> {
  const request = PlanApplyRequest.parse(raw);
  const current = readEditor(projectId);
  const target = { sequenceId: request.sequenceId, clipId: request.clipId };
  const { sequenceId } = resolveTarget(current.edl, target);
  const sequence = current.edl.sequences.find((s) => s.id === sequenceId);
  const project = current.edl.plan;
  const local = sequence?.plan;

  const rules = await listRules(projectId);
  const wanted = new Set([...project.rules, ...(local?.rules ?? [])]);
  const resolved = resolveRules(rules.filter((r) => wanted.has(r.id)));
  const ignored = [...wanted].filter((id) => !rules.some((r) => r.id === id && r.enabled));

  // The rules' own inputs count when measuring which template fits: a template whose
  // required slot a matched rule fills is not a template that cannot be applied.
  const ruleSlots = { ...resolved.slots, ...request.slots };
  let templateId = local?.template ?? null;
  let templateFrom: RuleApplyResult["templateFrom"] = "request";
  if (!templateId && project.template) { templateId = project.template; templateFrom = "request"; }
  if (!templateId && resolved.templateId) { templateId = resolved.templateId; templateFrom = "rule"; }
  if (!templateId) {
    const applied = appliedTemplate(current.edl, target);
    if (applied) { templateId = applied; templateFrom = "applied"; }
  }
  if (!templateId) {
    const { suggestTemplates } = await import("../../templates/server/suggest");
    const best = (await suggestTemplates(current.edl, target, ruleSlots)).suggestions[0];
    if (!best) throw new Error("No template to apply this plan with.");
    templateId = best.templateId; templateFrom = "suggested";
  }
  // A project about a subject inherits that subject's brand kit (decision 48), and it
  // sits under everything else in the stack: a kit is a default for how the subject
  // looks, not a decision about this video, so any override still wins over it.
  const subject = project.subject.trim().toLowerCase();
  const kit = subject
    ? (await (await import("../../rules/server/glossary")).readGlossary(projectId)).terms.find((t) => t.term.toLowerCase() === subject)?.brand
    : undefined;
  const overrides = mergeOverrides(mergeOverrides(mergeOverrides(kit ? { brand: kit } : {}, project.overrides), local?.overrides ?? {}), resolved.overrides);
  const ruleIds = resolved.rules.map((r) => r.id);
  const author = `template:${templateId}/plan${ruleIds.length ? `/rule:${ruleIds.join(",")}` : ""}`;

  // A matched rule brings its own inputs — the card this channel ends on — the same way
  // it brings its overrides. Reading one and not the other applied the rule's template
  // without the rule's end card, and said nothing about it. The caller is more specific,
  // so what it passes still wins.
  const slots = ruleSlots;

  const result = await applyTemplate(projectId, {
    templateId, ...target, hookText: request.hookText, slots, providers: request.providers, overrides,
  }, expectedRevision, { author });
  // The video has now been edited by its plan; say so unless someone already approved it.
  const after = readEditor(projectId);
  const plan = after.edl.sequences.find((s) => s.id === sequenceId)!.plan;
  const status = plan.status === "pending" ? "edited" : plan.status;
  const saved = status !== plan.status
    ? editProject(projectId, { expectedRevision: after.revision, operations: [{ type: "sequence.plan.patch", sequenceId, patch: { status } }] })
    : after;
  return { revision: saved.revision, sequenceId, templateId, templateFrom, overrides, prompts: resolved.prompts, applied: result.applied, plan: result.plan, ignored, status: "edited" };
}

export type ProjectApplyResult = { revision: number; results: Array<{ sequenceId: string; ok: true; result: PlanApplyResult } | { sequenceId: string; ok: false; error: string }> };

/** Every video in the project, one after another, so a change to the shared plan reaches all of them. */
export async function applyProjectPlan(projectId: string, expectedRevision: number, options: { slots?: Record<string, SlotValue>; providers?: string[] } = {}): Promise<ProjectApplyResult> {
  const start = readEditor(projectId);
  if (start.revision !== expectedRevision) throw new (await import("../../editor/server/store")).RevisionConflict(start);
  const ids = [...start.edl.sequences.map((s) => s.id), ...start.edl.clips.map((c) => c.id)];
  const results: ProjectApplyResult["results"] = [];
  for (const id of ids) {
    try {
      const { revision } = readEditor(projectId);
      results.push({ sequenceId: id, ok: true, result: await applyPlan(projectId, { sequenceId: id, slots: options.slots ?? {}, providers: options.providers }, revision) });
    } catch (error) {
      results.push({ sequenceId: id, ok: false, error: (error as Error).message });
    }
  }
  return { revision: readEditor(projectId).revision, results };
}
