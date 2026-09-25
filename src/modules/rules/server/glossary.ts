import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WORKSPACE, projectDir } from "../../../common/server/config";
import type { Transcript } from "../../transcription/lib/transcript";

export { Glossary, GlossaryTerm } from "../types";
import { Glossary, GlossaryTerm } from "../types";

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
  const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const words = transcript.words.map((w, i) => {
    let text = w.w;
    for (const r of rules) {
      if (!r.single) continue;
      text = text.replace(r.pattern, (m) => {
        if (m === r.term) return m;
        changed += 1;
        // "ILA" is heard for "la IA": after "con" it becomes "con la IA", but after a
        // "la" already said the term's own "la" would say it twice.
        const [lead, ...rest] = r.term.split(/\s+/);
        const before = transcript.words[i - 1];
        return rest.length && before && bare(before.w) === bare(lead) ? rest.join(" ") : r.term;
      });
    }
    return text === w.w ? w : { ...w, w: text };
  });
  // A phrase heard as another phrase of as many words ("la guía" for "la IA") is corrected
  // on the timed words too, word for word: nothing merges, so no caption moves. Phrases of
  // a different length stay a text-only correction, as the note above says.
  for (const t of glossary.terms) {
    const target = t.term.split(/\s+/);
    if (target.length < 2) continue;
    for (const alias of t.aliases) {
      const form = alias.toLowerCase().split(/\s+/);
      if (form.length !== target.length) continue;
      for (let i = 0; i + form.length <= words.length; i++) {
        if (!form.every((f, k) => bare(words[i + k].w) === bare(f))) continue;
        if (target.every((w, k) => words[i + k].w.replace(/[^\p{L}\p{N}]/gu, "") === w.replace(/[^\p{L}\p{N}]/gu, ""))) continue;
        for (let k = 0; k < form.length; k++) {
          // Keep the punctuation the word carried: "guía," stays followed by its comma.
          const tail = /[^\p{L}\p{N}]*$/u.exec(words[i + k].w)?.[0] ?? "";
          words[i + k] = { ...words[i + k], w: target[k] + tail };
        }
        changed += 1;
      }
    }
  }
  return { transcript: changed ? { ...transcript, segments, words } : transcript, changed };
}
