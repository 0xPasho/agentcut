import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WORKSPACE } from "../../../common/server/config";
import { resolveProvider, type AgentEvent, type AgentProvider } from "../../agent/lib/providers";
import { readPreferences, savePreferences } from "../../rules/server/preferences";
import { readGlossaryLevel, saveGlossary, GlossaryTerm } from "../../rules/server/glossary";
// The markers and the two functions that respect them live apart from this module so
// the settings editor can use exactly the same split in the browser.
import { mergeOnboardingPreferences } from "../../rules/lib/preferences-section";
export { mergeOnboardingPreferences, splitOnboardingPreferences } from "../../rules/lib/preferences-section";

/**
 * First run: a few questions about who is editing — not about products, not about
 * how they think their videos should look. The answers become preferences.md and,
 * where a name comes up, glossary entries.
 *
 * One interview, two interfaces. The web runs it full screen at /welcome; an agent
 * runs it a question at a time through the same functions, over MCP or the chat
 * panel. Both write the same answers, the same marked section of preferences.md and
 * the same state, so either can finish what the other started.
 *
 * Nothing here is a gate. The first question is the one worth insisting on — with
 * no answer to it there is nothing to write — and every step can be skipped. A skip
 * is a decision, not a deletion: the interview stays reachable from settings and
 * from the agent for as long as it has not been done.
 */
export const ONBOARDING_QUESTIONS = [
  { id: "who", label: "What do you make, and who is it for?", placeholder: "Coding streams on Twitch; clips for TikTok and Shorts aimed at junior devs.", required: true },
  { id: "record", label: "What do you usually record?", placeholder: "Two-hour streams with a webcam in the corner; sometimes a talking-head explainer.", required: false },
  { id: "platforms", label: "Where does it go, and how long should it be?", placeholder: "TikTok and Shorts, 30 to 60 seconds; the odd 16:9 for YouTube.", required: false },
  { id: "annoys", label: "What annoys you about your videos today?", placeholder: "Captions misspell names, hooks are too long, music drowns the voice.", required: false },
  { id: "names", label: "Names that must be spelled right", placeholder: "Deska, Claude, Next.js, my handle @pasho", required: false },
] as const;

export type OnboardingQuestion = (typeof ONBOARDING_QUESTIONS)[number];
export type OnboardingStatus = "pending" | "skipped" | "done";

export type OnboardingState = {
  status: OnboardingStatus;
  /** True once the interview has been run to the end. A skip is not done. */
  done: boolean;
  skipped: boolean;
  /** Whether preferences.md has anything in it, however it got there. */
  hasPreferences: boolean;
  /** Whether the owner still wants to be reminded on the home page. */
  reminder: boolean;
  /** Answers kept between steps, so leaving mid-interview loses nothing. */
  answers: Record<string, string>;
  /** Questions still unanswered, in order. The next one an agent should ask. */
  remaining: string[];
};

const stateFile = () => path.join(WORKSPACE, "onboarding.json");

type Stored = { status?: OnboardingStatus; done?: boolean; skipped?: boolean; reminder?: boolean; answers?: Record<string, string>; at?: number };

async function readStored(): Promise<Stored> {
  const raw = await fs.readFile(stateFile(), "utf8").catch(() => null);
  if (!raw) return {};
  try { return JSON.parse(raw) as Stored; } catch { return {}; }
}

/** Older runs wrote `{ done, skipped }` with no status; read them as the state they meant. */
function statusOf(stored: Stored): OnboardingStatus {
  if (stored.status) return stored.status;
  if (stored.done) return stored.skipped ? "skipped" : "done";
  return "pending";
}

/**
 * Every write is a read-modify-write of one small file, and two interfaces write it:
 * a step saved in the browser can land while the agent saves an answer, or while the
 * owner skips. Left unserialised those interleave and leave torn JSON behind, which
 * reads back as a fresh workspace — the answers and the skip both silently lost. So
 * writes queue in order, and each lands by rename, which is atomic for readers.
 */
let writes: Promise<unknown> = Promise.resolve();

async function writeStored(patch: Stored | ((current: Stored) => Stored)): Promise<Stored> {
  const next = writes.then(async () => {
    // Read inside the queue, not before it: a patch computed from a stale read is
    // how the other interface's answer disappears.
    const current = await readStored();
    const merged = { ...current, ...(typeof patch === "function" ? patch(current) : patch), at: Date.now() };
    await fs.mkdir(WORKSPACE, { recursive: true });
    const file = stateFile();
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(merged, null, 2));
    await fs.rename(temporary, file);
    return merged;
  });
  writes = next.catch(() => { /* a failed write must not block the next one */ });
  return next;
}

const clean = (answers: Record<string, string> | undefined) => {
  const out: Record<string, string> = {};
  for (const q of ONBOARDING_QUESTIONS) {
    const value = answers?.[q.id]?.trim();
    if (value) out[q.id] = value;
  }
  return out;
};

export async function onboardingState(): Promise<OnboardingState> {
  const stored = await readStored();
  const status = statusOf(stored);
  const answers = clean(stored.answers);
  const preferences = await readPreferences();
  return {
    status,
    done: status === "done",
    skipped: status === "skipped",
    hasPreferences: preferences.workspace.length > 0,
    reminder: stored.reminder !== false,
    answers,
    remaining: ONBOARDING_QUESTIONS.filter((q) => !answers[q.id]).map((q) => q.id),
  };
}

const Answers = z.record(z.string(), z.string());

/**
 * Keep what has been answered so far without finishing. This is what makes the
 * interview resumable: a step typed in the browser is there for the agent, and an
 * answer given to the agent is there when /welcome opens again.
 */
export async function saveOnboardingAnswers(raw: unknown): Promise<OnboardingState> {
  const answers = clean(Answers.parse(raw));
  // Saving an answer is not a decision about the interview: only skipping, finishing
  // or reopening moves the status. An answer arriving late — the agent saving one
  // after "Not now" — must never put the interview back in the owner's way.
  await writeStored((current) => ({ answers: { ...clean(current.answers), ...answers } }));
  return onboardingState();
}

/** Skip, from either interface. The answers survive and the interview stays reachable. */
export async function skipOnboarding(): Promise<OnboardingState> {
  await writeStored({ status: "skipped", done: true, skipped: true });
  return onboardingState();
}

/** "Not now" on the home reminder. The settings entry and the agent still offer it. */
export async function dismissOnboardingReminder(): Promise<OnboardingState> {
  await writeStored({ reminder: false });
  return onboardingState();
}

/** Open the interview again, with the previous answers to edit. */
export async function reopenOnboarding(): Promise<OnboardingState> {
  await writeStored({ status: "pending", done: false, skipped: false, reminder: true });
  return onboardingState();
}

const Output = z.object({ preferences: z.string().min(1), glossary: z.array(GlossaryTerm).default([]) });

/**
 * Turn the answers into preferences.md and glossary entries. Answers given here are
 * merged over whatever was saved a step at a time, so an agent that asked three
 * questions and a browser that answered two finish the same interview. With no agent
 * available, the answers are kept verbatim.
 */
export async function runOnboarding(raw: unknown = {}, o: { runner?: AgentProvider; provider?: string; model?: string; onEvent?: (e: AgentEvent) => void } = {}) {
  const given = clean(Answers.parse(raw));
  const stored = await readStored();
  const answers = { ...clean(stored.answers), ...given };
  const filled = ONBOARDING_QUESTIONS.filter((q) => answers[q.id]).map((q) => ({ question: q.label, answer: answers[q.id] }));
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
  await savePreferences(mergeOnboardingPreferences(existing.workspace, result.preferences), "workspace");
  if (result.glossary.length) {
    const current = await readGlossaryLevel("workspace");
    const byTerm = new Map(current.terms.map((t) => [t.term.toLowerCase(), t]));
    for (const term of result.glossary) if (!byTerm.has(term.term.toLowerCase())) byTerm.set(term.term.toLowerCase(), term);
    await saveGlossary({ terms: [...byTerm.values()] }, "workspace");
  }
  await writeStored((current) => ({ status: "done", done: true, skipped: false, answers: { ...clean(current.answers), ...answers } }));
  return { preferences: (await readPreferences()).workspace, glossary: result.glossary, usedAgent: !!provider, answers };
}
