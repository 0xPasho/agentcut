import { saveRule, deleteRule } from "@/modules/rules/server/registry";
import { saveGlossary } from "@/modules/rules/server/glossary";
import { savePreferences } from "@/modules/rules/server/preferences";
import { reviewObservations } from "@/modules/rules/server/observations";
import { onboardingState, runOnboarding, skipOnboarding, saveOnboardingAnswers, reopenOnboarding, dismissOnboardingReminder, ONBOARDING_QUESTIONS } from "@/modules/onboarding/server/onboarding";
import { readStyle, saveStyle, addExample, updateExample, removeExample } from "@/modules/packs/server/style";
import { inspectPack, importPack, removePack, exportPack } from "@/modules/packs/server/packs";
import { effectiveSelection, applySelection, selectionOverview } from "@/modules/agent/server/selection";
import { setProviderKey } from "@/common/server/secrets";
import { workspaceOverview } from "@/modules/settings/server/workspace";
export const runtime = "nodejs";

/** Everything the settings pages read, in one answer. */
export async function GET() {
  return Response.json(await workspaceOverview());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; rule?: unknown; id?: string; glossary?: unknown; text?: string; answers?: unknown; source?: string; replace?: boolean; pack?: Parameters<typeof exportPack>[0]; scope?: string; task?: string; provider?: string; model?: string; value?: string; file?: string; title?: string; note?: string };
  try {
    switch (body.action) {
      case "rules.save": return Response.json(await saveRule(body.rule, "workspace"));
      case "rules.delete": return Response.json(await deleteRule(String(body.id ?? ""), "workspace"));
      case "glossary.save": return Response.json(await saveGlossary(body.glossary, "workspace"));
      case "preferences.set": return Response.json(await savePreferences(String(body.text ?? ""), "workspace"));
      // Workspace-scoped agent runs are not jobs, so they fold in the selection here.
      case "observations.review": return Response.json(await reviewObservations(undefined, effectiveSelection(undefined, {}, "observations")));
      case "onboarding.status": return Response.json({ ...(await onboardingState()), questions: ONBOARDING_QUESTIONS });
      case "onboarding.answer": return Response.json(await saveOnboardingAnswers(body.answers ?? {}));
      case "onboarding.run": return Response.json(await runOnboarding(body.answers ?? {}, effectiveSelection(undefined, {}, "observations")));
      case "onboarding.skip": return Response.json(await skipOnboarding());
      case "onboarding.reopen": return Response.json(await reopenOnboarding());
      case "onboarding.dismiss": return Response.json(await dismissOnboardingReminder());
      case "packs.inspect": return Response.json(await inspectPack(String(body.source ?? "")));
      case "packs.import": return Response.json(await importPack(String(body.source ?? ""), { replace: !!body.replace }));
      case "packs.remove": return Response.json(await removePack(String(body.id ?? "")));
      case "packs.export": return Response.json(await exportPack(body.pack as Parameters<typeof exportPack>[0]));
      case "packs.style.get": return Response.json(await readStyle(String(body.id ?? "")));
      case "packs.style.set": return Response.json(await saveStyle(String(body.id ?? ""), String(body.text ?? "")));
      case "packs.examples.add": return Response.json(await addExample(String(body.id ?? ""), String(body.file ?? ""), { title: body.title, note: body.note }));
      case "packs.examples.update": return Response.json(await updateExample(String(body.id ?? ""), String(body.file ?? ""), { title: body.title, note: body.note }));
      case "packs.examples.remove": return Response.json(await removeExample(String(body.id ?? ""), String(body.file ?? "")));
      // The same functions the agent tools call, with the level fixed at workspace.
      case "agents.select": { applySelection({ scope: body.scope ?? "workspace", task: body.task, provider: body.provider ?? "", model: body.model ?? "" }); return Response.json(selectionOverview()); }
      case "providerkeys.set": return Response.json(setProviderKey(String(body.id ?? ""), String(body.value ?? "")));
      default: return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
