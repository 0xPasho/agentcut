import { listRules, ruleSchema } from "../../rules/server/registry";
import { readGlossaryLevel } from "../../rules/server/glossary";
import { readPreferences } from "../../rules/server/preferences";
import { readObservations } from "../../rules/server/observations";
import { listTemplates } from "../../templates/server/registry";
import { onboardingState, ONBOARDING_QUESTIONS } from "../../onboarding/server/onboarding";
import { listPacks } from "../../packs/server/packs";
import { selectionOverview } from "../../agent/server/selection";
import { providerKeys } from "../../../common/server/secrets";
import { scanLibrary } from "../../media/server/assets";
import { q } from "../../../common/server/db";
import { WORKSPACE, DB_PATH } from "../../../common/server/config";
import { resolveTranscribeMode, storedTranscribeMode } from "../../transcription/server/settings";
import { chatSource } from "../../stream-comments/server/comments";
import type { WorkspaceSettings } from "../types";

/**
 * Everything that belongs to the person rather than to a project, in one answer, for
 * the pages that have no project open. The same functions back the project tools;
 * this only fixes the level at workspace.
 */
export async function workspaceOverview(): Promise<WorkspaceSettings> {
  const [rules, glossary, preferences, templates, packs] = await Promise.all([listRules(), readGlossaryLevel("workspace"), readPreferences(), listTemplates(), listPacks()]);
  // The library's own assets, because a rule may fill a template's slots — the end card
  // a channel finishes on — and the only assets a rule can name are ones that are on
  // this machine and travel in a pack.
  await scanLibrary();
  const assets = (["video", "image", "audio"] as const).flatMap((kind) =>
    q.listAssets(kind).filter((asset) => asset.scope === "library").map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind })));
  // Which pack brought a template or a rule, so a list can say where a thing came
  // from. A pack's manifest names it (`provides`); that it was written by this
  // install is what `templates`/`rules` record, and a template the workspace already
  // had is still the pack's template for this purpose.
  const packOf = (kind: "templates" | "rules", id: string) => packs.find((p) => p.provides[kind].includes(id) || p[kind].includes(id))?.id ?? null;
  const transcribe = resolveTranscribeMode();
  // Everything the pages read in one answer, except which CLIs are on the machine:
  // that probe spawns four binaries and belongs on /api/agents, which the agents page
  // asks separately so the rest of the shell paints immediately.
  return {
    rules: rules.map((r) => ({ ...r, pack: packOf("rules", r.id) })),
    glossary,
    preferences: preferences.workspace,
    templates: templates.map((t) => ({
      id: t.id, name: t.name, description: t.description, tags: t.tags, builtin: t.builtin, slots: t.slots,
      extends: t.extends ?? null, makes: t.selection ?? null, output: t.output ?? null, pack: packOf("templates", t.id),
    })),
    assets,
    schema: ruleSchema(),
    observations: readObservations({ limit: 100 }),
    onboarding: { ...(await onboardingState()), questions: ONBOARDING_QUESTIONS },
    packs,
    providerKeys: providerKeys(),
    machine: {
      workspace: WORKSPACE,
      database: DB_PATH,
      transcribe: { mode: transcribe.mode, scope: transcribe.scope, stored: storedTranscribeMode() },
      chat: chatSource(),
    },
    ...selectionOverview(),
  };
}
