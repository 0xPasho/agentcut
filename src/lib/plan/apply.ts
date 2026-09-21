import { z } from "zod";
import { editProject, readEditor } from "../editor/store";
import { resolveTarget, TemplateTarget, SlotValue } from "../templates/plan";
import { applyTemplate } from "../templates/apply";
import { listRules } from "../rules/registry";
import { appliedTemplate, mergeOverrides, resolveRules } from "../rules/apply";
import type { RuleApplyResult } from "../rules/apply";

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

  let templateId = local?.template ?? null;
  let templateFrom: RuleApplyResult["templateFrom"] = "request";
  if (!templateId && project.template) { templateId = project.template; templateFrom = "request"; }
  if (!templateId && resolved.templateId) { templateId = resolved.templateId; templateFrom = "rule"; }
  if (!templateId) {
    const applied = appliedTemplate(current.edl, target);
    if (applied) { templateId = applied; templateFrom = "applied"; }
  }
  if (!templateId) {
    const { suggestTemplates } = await import("../templates/suggest");
    const best = (await suggestTemplates(current.edl, target, request.slots)).suggestions[0];
    if (!best) throw new Error("No template to apply this plan with.");
    templateId = best.templateId; templateFrom = "suggested";
  }
  const overrides = mergeOverrides(mergeOverrides({ ...project.overrides }, local?.overrides ?? {}), resolved.overrides);
  const ruleIds = resolved.rules.map((r) => r.id);
  const author = `template:${templateId}/plan${ruleIds.length ? `/rule:${ruleIds.join(",")}` : ""}`;

  const result = await applyTemplate(projectId, {
    templateId, ...target, hookText: request.hookText, slots: request.slots, providers: request.providers, overrides,
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
  if (start.revision !== expectedRevision) throw new (await import("../editor/store")).RevisionConflict(start);
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
