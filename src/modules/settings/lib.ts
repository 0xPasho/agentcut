import type { HarnessStatus } from "../agent/server/detect";
import { prettyModelLabel } from "../agent/lib/model-catalog";
import type { Glossary } from "../rules/server/glossary";
import type { Row, TemplateOption, WorkspaceSettings, ExportDraft } from "./types";
import { HARNESSES } from "../agent/lib/registry";
import type { RuleRecord, Rule } from "../rules/types";
import type { InstalledPack } from "../packs/types";
import type { ExportRequest } from "../packs/server/packs";
import { ASSET_SOURCE_LABELS } from "./data";

export const encode = (provider: string, model: string) => (provider ? `${provider}:${model}` : "");

export const decode = (value: string): [string, string] => {
  if (!value) return ["", ""];
  const cut = value.indexOf(":");
  return [value.slice(0, cut), value.slice(cut + 1)];
};

export function label(harnesses: HarnessStatus[], provider: string, model: string): string {
  const harness = harnesses.find((h) => h.id === provider);
  if (!harness) return provider || "nothing yet";
  const row = model ? harness.models.find((m) => m.id === model) : undefined;
  return `${harness.label} · ${model ? (row ? prettyModelLabel(row) : model) : "its default model"}`;
}

export const labelFor = (harnesses: HarnessStatus[], encoded: string) => {
  const [provider, model] = decode(encoded);
  return label(harnesses, provider, model);
};

export const toRows = (glossary: Glossary): Row[] =>
  glossary.terms.map((t) => ({ term: t.term, aliases: t.aliases.join(", "), note: t.note, brand: t.brand }));

export const rowsToGlossary = (rows: Row[]): Glossary => ({
  terms: rows
    .filter((r) => r.term.trim())
    .map((r) => ({
      term: r.term.trim(),
      aliases: r.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      note: r.note.trim(),
      ...(r.brand ? { brand: r.brand } : {}),
    })),
});

export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The line under each section's name in the rail: what it holds right now. */
export function summarise(id: string, data: WorkspaceSettings): string {
  switch (id) {
    case "library":
      return data.assets.length ? count(data.assets.length, "file") : "empty";
    case "profile": {
      const answered = Object.values(data.onboarding.answers ?? {}).filter((a) => a.trim()).length;
      const own = data.preferences.trim() ? "preferences written" : "no preferences yet";
      return answered ? `${own}, ${count(answered, "answer")}` : own;
    }
    case "rules": {
      const workspace = data.rules.filter((r) => r.level === "workspace");
      if (!workspace.length) return "none yet";
      const off = workspace.filter((r) => !r.enabled).length;
      return off ? `${count(workspace.length, "rule")}, ${off} off` : count(workspace.length, "rule");
    }
    case "glossary": {
      const subjects = data.glossary.terms.filter((t) => t.brand).length;
      if (!data.glossary.terms.length) return "none yet";
      return subjects ? `${count(data.glossary.terms.length, "name")}, ${count(subjects, "subject")}` : count(data.glossary.terms.length, "name");
    }
    case "packs":
      return data.packs.length ? count(data.packs.length, "pack") : "none installed";
    case "templates": {
      const yours = data.templates.filter((t) => !t.builtin).length;
      return yours ? `${count(data.templates.length, "template")}, ${yours} yours` : count(data.templates.length, "template");
    }
    case "agents": {
      const chosen = data.workspaceDefault?.provider;
      const name = chosen ? (HARNESSES.find((h) => h.id === chosen)?.label ?? chosen) : "first one installed";
      const tasks = data.tasks.filter((t) => t.own?.provider).length;
      return tasks ? `${name}, ${count(tasks, "task")} set apart` : name;
    }
    case "machine": {
      const keys = data.providerKeys.filter((k) => k.set).length;
      return keys ? count(keys, "key") : "no keys";
    }
    default:
      return "";
  }
}

export function interviewLine(status: string, hasSection: boolean): string {
  if (status === "done") return hasSection
    ? "Answered. The lines it wrote are below; rewriting them replaces that section and leaves your own lines alone."
    : "Answered, and the section it wrote has since been removed. Rewrite it from the answers above whenever you like.";
  if (status === "skipped") return "Skipped. Whatever you typed is kept above; finish it whenever.";
  return "Five questions about what you make and who it is for. The answers become preferences the agent follows.";
}

/** A record carries where it was read from; a rule you save is only the document. */
export const strip = (r: RuleRecord | (Rule & Partial<RuleRecord> & { pack?: string | null })): Rule => {
  const { level, file, promptText, warnings, pack, ...rule } = r as RuleRecord & { pack?: string | null };
  void level; void file; void promptText; void warnings; void pack;
  return rule;
};

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** What a pack brought, as one line: "2 templates · 3 rules · 12 names". */
export function packContents(pack: InstalledPack): string {
  const assets = Object.keys(pack.assets).length;
  return [
    pack.provides.templates.length && count(pack.provides.templates.length, "template"),
    pack.provides.rules.length && count(pack.provides.rules.length, "rule"),
    pack.glossary.length && count(pack.glossary.length, "name"),
    assets && count(assets, "asset"),
    pack.examples.length && count(pack.examples.length, "reference"),
    pack.quickActions.length && count(pack.quickActions.length, "quick action"),
  ].filter(Boolean).join(" · ") || "nothing of its own";
}

/** A source string as a pack recorded it, shortened to what a person recognises. */
export function packOrigin(source: string): { kind: "url" | "folder"; short: string } {
  if (/^https?:\/\//.test(source)) {
    try { const url = new URL(source); return { kind: "url", short: url.host + (url.pathname.length > 1 ? url.pathname : "") }; }
    catch { return { kind: "url", short: source }; }
  }
  const home = source.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
  return { kind: "folder", short: home };
}

/** The export form as the `packs.export` tool takes it. */
export function toExportRequest(draft: ExportDraft, packs: InstalledPack[]): ExportRequest {
  const quickActions = packs.flatMap((p) => p.quickActions.filter((a) => draft.quickActions.has(`${p.id}:${a.label}`)));
  return {
    id: draft.id.trim(),
    name: draft.name.trim() || draft.id.trim(),
    version: draft.version.trim() || undefined,
    description: draft.description.trim() || undefined,
    author: draft.author.trim() || undefined,
    templates: [...draft.templates],
    rules: [...draft.rules],
    glossary: draft.glossary,
    assetIds: [...draft.assets],
    quickActions,
    stylePack: draft.stylePack || undefined,
  };
}

/** Where a library asset came from, for the line under its name. */
export function assetOrigin(source: string | null | undefined, packs: InstalledPack[]): string {
  if (!source) return "";
  if (source.startsWith("pack:")) {
    const id = source.slice(5);
    return `From the ${packs.find((p) => p.id === id)?.name ?? id} pack`;
  }
  return ASSET_SOURCE_LABELS[source] ?? "";
}

export const seconds = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s.toFixed(1)}s`);

/** "Six clips, 20–75 s" or "One 3–5 minute section": what a template asks to be chosen. */
export function makesLine(makes: TemplateOption["makes"]): string {
  if (!makes) return "";
  if (makes.mode === "section") {
    const target = makes.targetSec ? ` around ${Math.round(makes.targetSec / 60)} min` : "";
    return `One long section${target}`;
  }
  return `${count(makes.count, "clip")}, ${Math.round(makes.minSec)}–${Math.round(makes.maxSec)} s each`;
}
