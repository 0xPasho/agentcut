import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WORKSPACE, projectDir } from "../../../common/server/config";
import type { Transcript } from "../../transcription/lib/transcript";
import { BrandKit } from "../../templates/types";

/**
 * How things are spelled. A glossary is deterministic: it feeds the recogniser's
 * vocabulary hint, the proofreader's brief, and a final pass that rewrites known
 * mishearings in the transcript itself. It needs no judgement, so it is a table,
 * not a rule. The workspace glossary applies everywhere; a project's adds to it
 * and wins on the same term.
 */
export const GlossaryTerm = z.object({
  /** The correct spelling. */
  term: z.string().trim().min(1),
  /** Ways the recogniser writes it wrong: "clod", "cloud AI". Matched case-insensitively on word boundaries. */
  aliases: z.array(z.string().trim().min(1)).default([]),
  /** One line of what it is, for the agent: "desktop app for designers". */
  note: z.string().default(""),
  /** A subject can carry its own brand kit; a project about it inherits the kit when its plan is applied. */
  brand: BrandKit.optional(),
}).strict();
export type GlossaryTerm = z.infer<typeof GlossaryTerm>;
export const Glossary = z.object({ terms: z.array(GlossaryTerm).default([]) }).strict();
export type Glossary = z.infer<typeof Glossary>;

export const glossaryFile = (level: "workspace" | "project", projectId?: string) => {
  if (level === "project") {
    if (!projectId) throw new Error("A project glossary needs a project");
    return path.join(projectDir(projectId), "glossary.json");
  }
  return path.join(WORKSPACE, "glossary.json");
};

async function readFile(file: string): Promise<Glossary> {
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (!raw) return { terms: [] };
  const parsed = Glossary.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : { terms: [] };
}

export async function readGlossaryLevel(level: "workspace" | "project", projectId?: string): Promise<Glossary> {
  return readFile(glossaryFile(level, projectId));
}

/** Workspace terms plus the project's, the project winning on an equal term. */
export async function readGlossary(projectId?: string): Promise<Glossary> {
  const workspace = await readGlossaryLevel("workspace");
  const project = projectId ? await readGlossaryLevel("project", projectId) : { terms: [] };
  const byTerm = new Map<string, GlossaryTerm>();
  for (const t of [...workspace.terms, ...project.terms]) byTerm.set(t.term.toLowerCase(), t);
  return { terms: [...byTerm.values()] };
}

export async function saveGlossary(input: unknown, level: "workspace" | "project" = "workspace", projectId?: string): Promise<Glossary> {
  const glossary = Glossary.parse(input);
  const file = glossaryFile(level, projectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(glossary, null, 2));
  await fs.rename(temp, file);
  return glossary;
}

/**
 * The recogniser's vocabulary hint: names only, comma-separated. Proper nouns read
 * the same in any language, which is why this is safe where a free-text brief is
 * not (see whispercpp.ts). Capped so it does not crowd out the audio context.
 */
export function glossaryWhisperPrompt(glossary: Glossary): string {
  return glossary.terms.map((t) => t.term).join(", ").slice(0, 400);
}

/** What the proofreader is told to spell exactly. */
export function glossaryBrief(glossary: Glossary): string {
  if (!glossary.terms.length) return "";
  const lines = glossary.terms.map((t) => `- ${t.term}${t.note ? ` (${t.note})` : ""}${t.aliases.length ? ` — often misheard as ${t.aliases.map((a) => `"${a}"`).join(", ")}` : ""}`);
  return `Spell these exactly as written:\n${lines.join("\n")}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Replacement = { pattern: RegExp; term: string; single: boolean };

function replacements(glossary: Glossary): Replacement[] {
  const out: Replacement[] = [];
  for (const t of glossary.terms) {
    const forms = new Set(t.aliases.map((a) => a.toLowerCase()));
    // A term with capitals corrects its own lowercase: "claude" -> "Claude".
    if (t.term !== t.term.toLowerCase()) forms.add(t.term.toLowerCase());
    for (const form of forms) {
      if (form === t.term) continue;
      out.push({ pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, "giu"), term: t.term, single: !/\s/.test(form) });
    }
  }
  // Longer forms first, so "cloud ai" is not pre-empted by "cloud".
  return out.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
}

/**
 * Rewrite known mishearings. Segment text takes every alias; the word list only
 * takes single-word aliases, because a two-word alias spans two timed words and
 * merging them would move the captions.
 */
export function applyGlossary(transcript: Transcript, glossary: Glossary): { transcript: Transcript; changed: number } {
  const rules = replacements(glossary);
  if (!rules.length) return { transcript, changed: 0 };
  let changed = 0;
  const segments = transcript.segments.map((s) => {
    let text = s.text;
    for (const r of rules) text = text.replace(r.pattern, (m) => { if (m === r.term) return m; changed += 1; return r.term; });
    return text === s.text ? s : { ...s, text };
  });
  const words = transcript.words.map((w) => {
    let text = w.w;
    for (const r of rules) if (r.single) text = text.replace(r.pattern, (m) => { if (m === r.term) return m; changed += 1; return r.term; });
    return text === w.w ? w : { ...w, w: text };
  });
  return { transcript: changed ? { ...transcript, segments, words } : transcript, changed };
}
