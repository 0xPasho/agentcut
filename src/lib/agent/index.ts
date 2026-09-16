import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import type { AgentProvider } from "./types";

export * from "./types";
export { claudeProvider, codexProvider };

export const providers: AgentProvider[] = [claudeProvider, codexProvider];

export function getProvider(id: string): AgentProvider {
  const p = providers.find((x) => x.id === id);
  if (!p) throw new Error(`unknown agent provider: ${id}`);
  return p;
}

/** First installed provider, preferring the configured one. */
export async function resolveProvider(preferred?: string): Promise<AgentProvider> {
  const ordered = preferred
    ? [getProvider(preferred), ...providers.filter((p) => p.id !== preferred)]
    : providers;
  for (const p of ordered) {
    if (await p.available()) return p;
  }
  throw new Error("no agent CLI found on PATH — install Claude Code or Codex");
}

export async function availableProviders() {
  return Promise.all(
    providers.map(async (p) => ({ id: p.id, label: p.label, available: await p.available() })),
  );
}
