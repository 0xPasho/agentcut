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

/**
 * Workspace-level rules, glossary and preferences, for pages that have no project
 * open. The same functions back the project tools; this only fixes the level.
 */
export async function workspaceOverview() {
  const [rules, glossary, preferences, templates] = await Promise.all([listRules(), readGlossaryLevel("workspace"), readPreferences(), listTemplates()]);
  // The library's own assets, because a rule may fill a template's slots — the end card
  // a channel finishes on — and the only assets a rule can name are ones that are on
  // this machine and travel in a pack.
  await scanLibrary();
  const assets = (["video", "image", "audio"] as const).flatMap((kind) =>
    q.listAssets(kind).filter((asset) => asset.scope === "library").map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind })));
  // Everything the settings page reads in one answer, except which CLIs are on the
  // machine: that probe spawns four binaries and belongs on /api/agents, which the
  // page asks separately so the rest of it paints immediately.
  return { rules, glossary, preferences: preferences.workspace, templates: templates.map((t) => ({ id: t.id, name: t.name, builtin: t.builtin, slots: t.slots })), assets, schema: ruleSchema(), observations: readObservations({ limit: 100 }), onboarding: { ...(await onboardingState()), questions: ONBOARDING_QUESTIONS }, packs: await listPacks(), providerKeys: providerKeys(), ...selectionOverview() };
}
