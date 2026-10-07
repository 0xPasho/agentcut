import { draftRule } from "@agentcut/core/modules/rules/server/draft";
import { saveRule, deleteRule } from "@agentcut/core/modules/rules/server/registry";
import { saveGlossary } from "@agentcut/core/modules/rules/server/glossary";
import { savePreferences } from "@agentcut/core/modules/rules/server/preferences";
import { reviewObservations } from "@agentcut/core/modules/rules/server/observations";
import { onboardingState, runOnboarding, skipOnboarding, saveOnboardingAnswers, reopenOnboarding, dismissOnboardingReminder, ONBOARDING_QUESTIONS } from "@agentcut/core/modules/onboarding/server/onboarding";
import { readStyle, saveStyle, addExample, updateExample, removeExample } from "@agentcut/core/modules/packs/server/style";
import { inspectPack, importPack, removePack, exportPack } from "@agentcut/core/modules/packs/server/packs";
import { recipeSources, trustRecipes } from "@agentcut/core/modules/packs/server/recipes";
import { marketUrl, searchPacks } from "@agentcut/core/modules/packs/server/market";
import { readPackReview, savePackReview } from "@agentcut/core/modules/review/server/criteria";
import { lintReview } from "@agentcut/core/modules/review/lib/lint";
import { PackReview } from "@agentcut/core/modules/review/types";
import { METRICS } from "@agentcut/core/modules/review/data";
import { effectiveSelection, applySelection, selectionOverview } from "@agentcut/core/modules/agent/server/selection";
import { setProviderKey } from "@agentcut/core/common/server/secrets";
import { workspaceOverview } from "@agentcut/core/modules/settings/server/workspace";
import { deleteTemplate } from "@agentcut/core/modules/templates/server/registry";
import { saveTranscribeMode, resolveTranscribeMode, type TranscribeMode } from "@agentcut/core/modules/transcription/server/settings";
import { saveChatSource } from "@agentcut/core/modules/stream-comments/server/comments";
export const runtime = "nodejs";

/** Everything the settings pages read, in one answer. */
export async function GET() {
  return Response.json(await workspaceOverview());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; rule?: unknown; review?: unknown; id?: string; glossary?: unknown; text?: string; answers?: unknown; source?: string; query?: string; replace?: boolean; pack?: Parameters<typeof exportPack>[0]; scope?: string; task?: string; provider?: string; model?: string; value?: string; file?: string; title?: string; note?: string; mode?: string | null; path?: string; trust?: boolean };
  try {
    switch (body.action) {
      case "rules.draft": return Response.json(await draftRule(body));
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
      case "packs.search": return Response.json({ market: marketUrl(), packs: await searchPacks(String(body.query ?? "")) });
      case "packs.inspect": return Response.json(await inspectPack(String(body.source ?? "")));
      case "packs.import": return Response.json(await importPack(String(body.source ?? ""), { replace: !!body.replace }));
      case "packs.remove": return Response.json(await removePack(String(body.id ?? "")));
      case "packs.export": return Response.json(await exportPack(body.pack as Parameters<typeof exportPack>[0]));
      // Trusting a pack's code is a person's decision (decision 143): this route and the
      // terminal are the only ways in, and no editor tool reaches it.
      case "packs.recipes.source": return Response.json(await recipeSources(String(body.id ?? "")));
      case "packs.recipes.trust": return Response.json(await trustRecipes(String(body.id ?? ""), body.trust !== false));
      case "review.catalogue": return Response.json(METRICS);
      case "packs.review.get": { const review = await readPackReview(String(body.id ?? "")); return Response.json({ review, warnings: lintReview(review) }); }
      case "packs.review.set": return Response.json(await savePackReview(String(body.id ?? ""), PackReview.parse(body.review)));
      case "packs.style.get": return Response.json(await readStyle(String(body.id ?? "")));
      case "packs.style.set": return Response.json(await saveStyle(String(body.id ?? ""), String(body.text ?? "")));
      case "packs.examples.add": return Response.json(await addExample(String(body.id ?? ""), String(body.file ?? ""), { title: body.title, note: body.note }));
      case "packs.examples.update": return Response.json(await updateExample(String(body.id ?? ""), String(body.file ?? ""), { title: body.title, note: body.note }));
      case "packs.examples.remove": return Response.json(await removeExample(String(body.id ?? ""), String(body.file ?? "")));
      // The same functions the agent tools call, with the level fixed at workspace.
      case "agents.select": { applySelection({ scope: body.scope ?? "workspace", task: body.task, provider: body.provider ?? "", model: body.model ?? "" }); return Response.json(selectionOverview()); }
      // Workspace-level settings that only had a project-bound tool: the same functions,
      // with the level fixed (decision 135). A template is deleted with the tool's function.
      case "templates.delete": return Response.json(await deleteTemplate(String(body.id ?? "")));
      case "transcription.set": { saveTranscribeMode((body.mode ?? null) as TranscribeMode | null); return Response.json(resolveTranscribeMode()); }
      case "chat.source.set": return Response.json(saveChatSource(String(body.path ?? "")));
      case "providerkeys.set": return Response.json(setProviderKey(String(body.id ?? ""), String(body.value ?? "")));
      default: return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
