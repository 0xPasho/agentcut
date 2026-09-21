import { listRules, saveRule, deleteRule, ruleSchema } from "@/lib/rules/registry";
import { readGlossaryLevel, saveGlossary } from "@/lib/glossary";
import { readPreferences, savePreferences } from "@/lib/preferences";
import { listTemplates } from "@/lib/templates/registry";
import { readObservations, reviewObservations } from "@/lib/observations";
import { onboardingState, runOnboarding, skipOnboarding, saveOnboardingAnswers, reopenOnboarding, dismissOnboardingReminder, ONBOARDING_QUESTIONS } from "@/lib/onboarding";
import { listPacks, inspectPack, importPack, removePack, exportPack } from "@/lib/packs";
import { effectiveSelection } from "@/lib/agent/selection";
export const runtime = "nodejs";

/**
 * Workspace-level rules, glossary and preferences, for pages that have no project
 * open. The same functions back the project tools; this route only fixes the level.
 */
export async function GET() {
  const [rules, glossary, preferences, templates] = await Promise.all([listRules(), readGlossaryLevel("workspace"), readPreferences(), listTemplates()]);
  return Response.json({ rules, glossary, preferences: preferences.workspace, templates: templates.map((t) => ({ id: t.id, name: t.name, builtin: t.builtin })), schema: ruleSchema(), observations: readObservations({ limit: 100 }), onboarding: { ...(await onboardingState()), questions: ONBOARDING_QUESTIONS }, packs: await listPacks() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; rule?: unknown; id?: string; glossary?: unknown; text?: string; answers?: unknown; source?: string; replace?: boolean; pack?: Parameters<typeof exportPack>[0] };
  try {
    switch (body.action) {
      case "rules.save": return Response.json(await saveRule(body.rule, "workspace"));
      case "rules.delete": return Response.json(await deleteRule(String(body.id ?? ""), "workspace"));
      case "glossary.save": return Response.json(await saveGlossary(body.glossary, "workspace"));
      case "preferences.set": return Response.json(await savePreferences(String(body.text ?? ""), "workspace"));
      // Workspace-scoped agent runs are not jobs, so they fold in the selection here.
      case "observations.review": return Response.json(await reviewObservations(undefined, effectiveSelection(undefined)));
      case "onboarding.status": return Response.json({ ...(await onboardingState()), questions: ONBOARDING_QUESTIONS });
      case "onboarding.answer": return Response.json(await saveOnboardingAnswers(body.answers ?? {}));
      case "onboarding.run": return Response.json(await runOnboarding(body.answers ?? {}, effectiveSelection(undefined)));
      case "onboarding.skip": return Response.json(await skipOnboarding());
      case "onboarding.reopen": return Response.json(await reopenOnboarding());
      case "onboarding.dismiss": return Response.json(await dismissOnboardingReminder());
      case "packs.inspect": return Response.json(await inspectPack(String(body.source ?? "")));
      case "packs.import": return Response.json(await importPack(String(body.source ?? ""), { replace: !!body.replace }));
      case "packs.remove": return Response.json(await removePack(String(body.id ?? "")));
      case "packs.export": return Response.json(await exportPack(body.pack as Parameters<typeof exportPack>[0]));
      default: return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
