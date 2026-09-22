import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import { cursorProvider } from "./cursor";
import { opencodeProvider } from "./opencode";
import { HARNESSES, harness, type HarnessId } from "./registry";
import type { AgentProvider } from "../types";

export * from "../types";

/**
 * NOTE: this barrel stays free of anything that touches the workspace —
 * `./selection` (SQLite) and `./detect` / `./models/cache` (which read
 * common/server/config). Both of those resolve the workspace path at module load, so
 * re-exporting them here would freeze it for every file that imports a driver,
 * including ones imported before a caller sets AGENTCUT_WORKSPACE. That is not
 * hypothetical: it silently pointed the transcript tests at the real database.
 * Import `@/modules/agent/server/selection`, `@/modules/agent/server/detect` and
 * `@/modules/agent/server/model-cache` directly from the places that own a request.
 */
export { claudeProvider, codexProvider, cursorProvider, opencodeProvider };
export { HARNESSES, HARNESS_IDS, harness, orderedHarnesses } from "./registry";
export type { Harness, HarnessId } from "./registry";
export { harnessBinary, resolveBinary, spawnable } from "../server/binary";
export { probeAuth, usable, type AuthState, type AuthProbe } from "../server/auth";
export { CURATED, curatedCatalog, prettyModelLabel, filterModels, mergeCatalog, orderModels } from "./model-catalog";
export type { ModelInfo, HarnessCatalog } from "./model-catalog";

/** Registry order, so the picker and the fallback walk agree. */
export const providers: AgentProvider[] = [claudeProvider, codexProvider, cursorProvider, opencodeProvider];

export function getProvider(id: string): AgentProvider {
  const p = providers.find((x) => x.id === id);
  if (!p) throw new Error(`unknown agent provider: ${id}`);
  return p;
}

/**
 * The provider a run should use.
 *
 * Two different questions share this function, and they get different answers
 * on purpose:
 *
 *   - **No preference.** Walk the registry and take the first installed
 *     harness. This is the old behaviour and it is right: nobody chose, so any
 *     working CLI is a better outcome than an error.
 *   - **A named preference.** Use it or fail. Falling through to the next
 *     harness would run somebody's edit on a different model than the one they
 *     picked, label it with the name they chose, and never say so.
 */
export async function resolveProvider(preferred?: string): Promise<AgentProvider> {
  if (preferred) {
    const chosen = getProvider(preferred);
    if (await chosen.available()) return chosen;
    const entry = harness(preferred);
    throw new Error(
      `${entry?.label ?? preferred} was selected but is not installed — no \`${entry?.bin ?? preferred}\` found. Pick another harness or install it.`,
    );
  }
  for (const p of providers) {
    if (await p.available()) return p;
  }
  throw new Error("no agent CLI found on PATH — install Claude Code, Codex, Cursor or OpenCode");
}

export async function availableProviders() {
  return Promise.all(
    providers.map(async (p) => ({
      id: p.id as HarnessId,
      label: p.label,
      available: await p.available(),
    })),
  );
}
