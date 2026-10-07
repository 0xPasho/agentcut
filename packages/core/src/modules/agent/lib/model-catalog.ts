import type { HarnessId } from "./registry";

/**
 * One model row, provider-native. `id` is exactly what goes after `--model`,
 * so nothing downstream has to translate.
 */
export type ModelInfo = {
  id: string;
  displayName?: string;
  description?: string;
  /** Floated to the top of its harness's list. */
  recommended?: boolean;
};

export type HarnessCatalog = {
  models: ModelInfo[];
  /** Where the rows came from, so the UI can say "curated, never refreshed". */
  source: "curated" | "cli";
  fetchedAt: number;
};

/**
 * Curated fallbacks — what the picker shows before discovery has ever run, and
 * what it keeps showing on a machine where discovery fails.
 *
 * Kept deliberately short. This is not a mirror of every model each vendor
 * ships; it is enough to make a choice on first paint, and live discovery
 * replaces it wholesale the moment it lands. A long hand-maintained list is a
 * list that is wrong by the time anybody reads it.
 */
export const CURATED: Record<HarnessId, ModelInfo[]> = {
  claude: [
    { id: "opus", displayName: "Opus", description: "Best for everyday, complex tasks", recommended: true },
    { id: "sonnet", displayName: "Sonnet", description: "Efficient for routine tasks", recommended: true },
    { id: "haiku", displayName: "Haiku", description: "Fastest for quick answers" },
  ],
  codex: [
    { id: "gpt-5.1-codex", displayName: "GPT-5.1 Codex", recommended: true },
    { id: "gpt-5.1-codex-mini", displayName: "GPT-5.1 Codex Mini" },
  ],
  cursor: [
    { id: "auto", displayName: "Auto", description: "Cursor picks the model", recommended: true },
  ],
  opencode: [],
};

export function curatedCatalog(id: HarnessId): HarnessCatalog {
  return { models: CURATED[id] ?? [], source: "curated", fetchedAt: 0 };
}

/**
 * Turn a slug into something readable when the CLI gave us no display name.
 * `claude-sonnet-5` → `Claude Sonnet 5`, `anthropic/claude-sonnet-5` →
 * `Claude Sonnet 5` with the provider kept as the detail line by the caller.
 */
export function prettyModelLabel(model: ModelInfo): string {
  if (model.displayName) return model.displayName;
  const tail = model.id.includes("/") ? model.id.slice(model.id.lastIndexOf("/") + 1) : model.id;
  return tail
    .replace(/[-_]/g, " ")
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/\bGpt\b/g, "GPT");
}

/**
 * Merge a discovered list over a curated one.
 *
 * Discovery wins on every id it knows about, and its ORDER wins too — the CLI
 * lists its own models best-first, and re-sorting that on top of our
 * `recommended` guesses would bury the model the vendor just shipped. Curated
 * rows the CLI did not mention are kept at the end: `--model` still accepts
 * them, and dropping a model somebody may have selected would silently change
 * what their next run uses.
 */
export function mergeCatalog(curated: ModelInfo[], discovered: ModelInfo[]): ModelInfo[] {
  if (!discovered.length) return orderModels(curated);
  const seen = new Set(discovered.map((m) => m.id));
  return [...discovered, ...curated.filter((m) => !seen.has(m.id))];
}

/** Recommended first, stable within each tier. Only used for curated-only lists. */
export function orderModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false));
}

/**
 * Substring match over label, description and slug. Deliberately not fuzzy:
 * these slugs are near-identical to each other (`gpt-5.3-codex-high` vs
 * `gpt-5.3-codex-high-fast`) and a fuzzy matcher turns a precise query into a
 * list of things that are not what you typed.
 */
export function filterModels(models: readonly ModelInfo[], query: string): ModelInfo[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...models];
  return models.filter((m) =>
    `${prettyModelLabel(m)} ${m.description ?? ""} ${m.id}`.toLowerCase().includes(wanted),
  );
}
