import { filterModels, prettyModelLabel, type ModelInfo } from "./models/catalog";
import type { HarnessStatus } from "./detect";

/**
 * The rows behind the harness-and-model picker.
 *
 * Kept apart from the component because the interesting part is not the markup:
 * it is that a row carries its harness. Picking "Sonnet" while browsing Claude
 * Code from a Codex selection switches both — "run this on Sonnet" is a sentence
 * about the next message, not about which CLI happens to be selected.
 */
export type ModelRow = {
  /** Unique per rendered list, harness included: the same model can appear under two. */
  key: string;
  harnessId: string;
  harnessLabel: string;
  /** '' means "whatever the CLI is configured to use". */
  model: string;
  label: string;
  detail: string;
  ready: boolean;
  /** Null for the inherit row: there is nothing stable to pin. */
  favKey: string | null;
};

export const favKeyFor = (harnessId: string, model: string) => `${harnessId}:${model}`;

const detailFor = (model: ModelInfo) => model.description ?? (model.displayName ? model.id : "");

/** One harness's rows: its default first, then its models. */
export function harnessRows(harness: HarnessStatus): ModelRow[] {
  const base: ModelRow = {
    key: `${harness.id}:`,
    harnessId: harness.id,
    harnessLabel: harness.label,
    model: "",
    label: harness.inheritLabel,
    detail: "Whatever the CLI is configured to use",
    ready: harness.ready,
    favKey: null,
  };
  return [
    base,
    ...harness.models.map((model) => ({
      key: favKeyFor(harness.id, model.id),
      harnessId: harness.id,
      harnessLabel: harness.label,
      model: model.id,
      label: prettyModelLabel(model),
      detail: detailFor(model),
      ready: harness.ready,
      favKey: favKeyFor(harness.id, model.id),
    })),
  ];
}

/**
 * The starred rows, across harnesses. A favourite whose harness is gone from this
 * machine is dropped rather than shown dead: the star was about reaching a model
 * quickly, and a row that cannot run is not quick, it is a dead end.
 */
export function favoriteRows(favorites: Record<string, string>, harnesses: HarnessStatus[]): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const harness of harnesses) {
    for (const row of harnessRows(harness)) {
      if (row.favKey && row.favKey in favorites) rows.push({ ...row, detail: harness.label });
    }
  }
  return rows;
}

export function filterRows(rows: ModelRow[], query: string): ModelRow[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return rows;
  // The inherit row has no model id to match on, so it is filtered by its words alone.
  return rows.filter((row) => `${row.label} ${row.detail} ${row.model} ${row.harnessLabel}`.toLowerCase().includes(wanted));
}

/** What the closed chip says. Never a bare slug: the name is the point. */
export function chipLabel(harness: HarnessStatus | undefined, model: string, loading: boolean): string {
  if (!harness) return loading ? "Checking agents…" : "No agent installed";
  const row = model ? harness.models.find((m) => m.id === model) : undefined;
  return `${harness.label} · ${model ? (row ? prettyModelLabel(row) : model) : "default"}`;
}

/** The rail is narrow; the whole sentence lives in the title attribute. */
export function shortReason(harness: HarnessStatus, locked: boolean): string {
  if (!harness.installed) return "not installed";
  if (harness.authState === "unauthenticated") return "signed out";
  return locked ? "run in progress" : "";
}

export function catalogNote(harness: HarnessStatus | undefined): string {
  if (!harness) return "";
  if (harness.modelSource === "curated") return "Built-in list — Refresh asks the CLI";
  const hours = Math.floor((Date.now() - harness.modelsFetchedAt) / 3_600_000);
  return hours < 1
    ? `${harness.models.length} models from ${harness.label}, just now`
    : `${harness.models.length} models from ${harness.label}, ${hours}h ago`;
}

export { filterModels };
