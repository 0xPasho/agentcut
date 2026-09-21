import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WORKSPACE } from "./config";
import { resolveProvider, type AgentEvent, type AgentProvider } from "./agent";
import { readPreferences, savePreferences } from "./preferences";
import { readGlossaryLevel, saveGlossary, GlossaryTerm } from "./glossary";

/**
 * First run: a few questions about who is editing — not about products, not about
 * how they think their videos should look. The answers become preferences.md and,
 * where a name comes up, glossary entries. Optional, skippable, never repeated.
 */
export const ONBOARDING_QUESTIONS = [
  { id: "who", label: "What do you make, and who is it for?", placeholder: "Coding streams on Twitch; clips for TikTok and Shorts aimed at junior devs." },
  { id: "record", label: "What do you usually record?", placeholder: "Two-hour streams with a webcam in the corner; sometimes a talking-head explainer." },
  { id: "platforms", label: "Where does it go, and how long should it be?", placeholder: "TikTok and Shorts, 30 to 60 seconds; the odd 16:9 for YouTube." },
  { id: "annoys", label: "What annoys you about your videos today?", placeholder: "Captions misspell names, hooks are too long, music drowns the voice." },
  { id: "names", label: "Names that must be spelled right", placeholder: "Deska, Claude, Next.js, my handle @pasho" },
] as const;

const stateFile = () => path.join(WORKSPACE, "onboarding.json");

export async function onboardingState(): Promise<{ done: boolean; hasPreferences: boolean }> {
  const done = await fs.readFile(stateFile(), "utf8").then((raw) => Boolean(JSON.parse(raw).done)).catch(() => false);
  const preferences = await readPreferences();
  return { done, hasPreferences: preferences.workspace.length > 0 };
}

export async function skipOnboarding() {
  await fs.mkdir(WORKSPACE, { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify({ done: true, skipped: true, at: Date.now() }));
  return { done: true };
}

const Answers = z.record(z.string(), z.string());
const Output = z.object({ preferences: z.string().min(1), glossary: z.array(GlossaryTerm).default([]) });

/** Turn answers into preferences.md and glossary entries. With no agent available, the answers are kept verbatim. */
export async function runOnboarding(raw: unknown, o: { runner?: AgentProvider; provider?: string; model?: string; onEvent?: (e: AgentEvent) => void } = {}) {
  const answers = Answers.parse(raw);
  const filled = ONBOARDING_QUESTIONS.filter((q) => answers[q.id]?.trim()).map((q) => ({ question: q.label, answer: answers[q.id].trim() }));
  if (!filled.length) throw new Error("Answer at least one question, or skip.");
  const fallback = filled.map((f) => `- ${f.question} ${f.answer}`).join("\n");
  let result: z.infer<typeof Output> = { preferences: fallback, glossary: [] };
  const provider = o.runner ?? await resolveProvider(o.provider).catch(() => null);
  if (provider) {
    const dir = path.join(WORKSPACE, "onboarding-runs", randomUUID());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "answers.json"), JSON.stringify(filled, null, 2));
    await provider.run({
      cwd: dir, allowedTools: ["Read", "Write", "Glob", "Grep"], deniedTools: ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"], model: o.model, onEvent: o.onEvent,
      prompt: [
        "Someone is setting up a video editor that is driven by an agent. Read answers.json: their answers about what they make, for whom, what they record, where it goes and what annoys them.",
        "Write profile.json as {\"preferences\":\"<markdown>\",\"glossary\":[{\"term\":\"\",\"aliases\":[],\"note\":\"\"}]}.",
        "preferences: 6-12 short lines in their voice, second person avoided, each a concrete editing preference the agent can act on (hook length, caption density, music level, platforms and lengths, what to never do). Only what the answers support; no invented taste.",
        "glossary: every proper name they mentioned that a speech recogniser could misspell, with a one-line note. Empty if none.",
        "When profile.json is written, reply with just: DONE",
      ].join("\n\n"),
    });
    const written = await fs.readFile(path.join(dir, "profile.json"), "utf8").catch(() => null);
    if (written) {
      const parsed = Output.safeParse(JSON.parse(written));
      if (parsed.success) result = parsed.data;
    }
  }
  const existing = await readPreferences();
  await savePreferences([existing.workspace, result.preferences].filter(Boolean).join("\n\n"), "workspace");
  if (result.glossary.length) {
    const current = await readGlossaryLevel("workspace");
    const byTerm = new Map(current.terms.map((t) => [t.term.toLowerCase(), t]));
    for (const term of result.glossary) if (!byTerm.has(term.term.toLowerCase())) byTerm.set(term.term.toLowerCase(), term);
    await saveGlossary({ terms: [...byTerm.values()] }, "workspace");
  }
  await fs.mkdir(WORKSPACE, { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify({ done: true, at: Date.now() }));
  return { preferences: (await readPreferences()).workspace, glossary: result.glossary, usedAgent: !!provider };
}
