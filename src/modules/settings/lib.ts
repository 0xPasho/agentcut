import type { HarnessStatus } from "../agent/server/detect";
import { prettyModelLabel } from "../agent/lib/model-catalog";
import type { Glossary } from "../rules/server/glossary";
import type { Row } from "./types";
import { type WorkspaceSettings, type TemplateOption } from "./types";
import { HARNESSES } from "../agent/lib/registry";
import type { RuleRecord, Rule } from "../rules/types";

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

export function summarise(id: string, data: WorkspaceSettings): string {
  switch (id) {
    case "rules": {
      const workspace = data.rules.filter((r) => r.level === "workspace");
      if (!workspace.length) return "none yet";
      const off = workspace.filter((r) => !r.enabled).length;
      return off ? `${count(workspace.length, "rule")}, ${off} off` : count(workspace.length, "rule");
    }
    case "glossary":
      return data.glossary.terms.length ? count(data.glossary.terms.length, "term") : "none yet";
    case "subjects": {
      const subjects = data.glossary.terms.filter((t) => t.brand);
      return subjects.length ? count(subjects.length, "subject") : "none yet";
    }
    case "preferences": {
      if (!data.preferences.trim()) return "nothing written yet";
      const lines = data.preferences.split("\n").filter((l) => l.trim() && !l.trim().startsWith("<!--")).length;
      return count(lines, "line");
    }
    case "agents": {
      const chosen = data.workspaceDefault?.provider;
      const label = chosen ? (HARNESSES.find((h) => h.id === chosen)?.label ?? chosen) : "first one installed";
      const tasks = data.tasks.filter((t) => t.own?.provider).length;
      return tasks ? `${label}, ${count(tasks, "task")} set apart` : label;
    }
    case "packs":
      return data.packs.length ? count(data.packs.length, "pack") : "none installed";
    default:
      return "";
  }
}

export function interviewLine(status: string, hasSection: boolean): string {
  if (status === "done") return hasSection
    ? "You answered it. The lines it wrote are below, and answering again replaces them."
    : "You answered it, and the section it wrote has since been removed.";
  if (status === "skipped") return "You skipped it. Whatever you had typed is kept, and you can finish it whenever.";
  return "Five questions about what you make and who it is for. The answers become preferences the agent follows.";
}

/** A record carries where it was read from; a rule you save is only the document. */
export const strip = (r: RuleRecord | (Rule & Partial<RuleRecord>)): Rule => {
  const { level, file, promptText, ...rule } = r as RuleRecord;
  void level; void file; void promptText;
  return rule;
};

export function describe(rule: Rule, templates: TemplateOption[]): string {
  const slots = Object.keys(rule.then.slots ?? {}).length;
  const parts = [
    rule.then.template && `uses the ${templates.find((t) => t.id === rule.then.template)?.name ?? rule.then.template} template`,
    rule.then.overrides && Object.keys(rule.then.overrides).length ? "changes template settings" : "",
    slots ? `gives it ${slots === 1 ? "an input of its own" : `${slots} inputs of its own`}` : "",
    (rule.then.prompt || rule.then.promptFile) && "tells the agent something",
  ].filter(Boolean);
  return parts.length ? `Then it ${parts.join(", ")}.` : "It does nothing yet — open it and say what should happen.";
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
