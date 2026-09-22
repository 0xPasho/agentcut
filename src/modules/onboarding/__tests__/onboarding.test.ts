/**
 * The first-run interview: one set of answers, one preferences section, two
 * interfaces. What matters here is that a skip is reversible, that answers survive
 * being given a step at a time from either side, and that running it twice does not
 * leave two copies of the same preferences or bury what the owner wrote by hand.
 *
 * Run with: tsx --test src/modules/onboarding/__tests__/onboarding.test.ts
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AgentProvider } from "../../agent/lib/providers";

let workspace: string;
let onboarding: typeof import("../server/onboarding");
let preferences: typeof import("../../rules/server/preferences");
let glossary: typeof import("../../rules/server/glossary");
let tools: typeof import("../../editor/server/tools");

/** The interview is workspace-level; the tools take a project id and ignore it. */
const NO_PROJECT = "no-project-yet";

/** Stands in for Claude Code: writes the profile the real prompt asks for. */
const writer = (profile: { preferences: string; glossary?: Array<{ term: string; aliases: string[]; note: string }> }): AgentProvider => ({
  id: "fake", label: "Fake",
  available: async () => true,
  run: async ({ cwd }) => {
    await fs.writeFile(path.join(cwd, "profile.json"), JSON.stringify({ preferences: profile.preferences, glossary: profile.glossary ?? [] }));
    return { text: "DONE", events: [], provider: "fake", durationMs: 0 };
  },
});

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-onboarding-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [onboarding, preferences, glossary, tools] = await Promise.all([
    import("../server/onboarding"), import("../../rules/server/preferences"), import("../../rules/server/glossary"), import("../../editor/server/tools"),
  ]);
});
after(async () => { await fs.rm(workspace, { recursive: true, force: true }); });

beforeEach(async () => {
  await fs.rm(path.join(workspace, "onboarding.json"), { force: true });
  await fs.rm(path.join(workspace, "preferences.md"), { force: true });
  await fs.rm(path.join(workspace, "glossary.json"), { force: true });
});

test("a fresh workspace is pending, and every question is still to ask", async () => {
  const state = await onboarding.onboardingState();
  assert.equal(state.status, "pending");
  assert.equal(state.done, false);
  assert.equal(state.hasPreferences, false);
  assert.equal(state.reminder, true);
  assert.deepEqual(state.remaining, onboarding.ONBOARDING_QUESTIONS.map((q) => q.id));
  assert.equal(onboarding.ONBOARDING_QUESTIONS.filter((q) => q.required).length, 1, "exactly one question is worth insisting on");
});

test("an answer saved after a skip does not put the interview back in the way", async () => {
  await onboarding.skipOnboarding();
  await onboarding.saveOnboardingAnswers({ who: "Streams" });
  const state = await onboarding.onboardingState();
  assert.equal(state.status, "skipped", "only skipping, finishing or reopening moves the status");
  assert.equal(state.answers.who, "Streams");
});

test("skipping is a decision, not a deletion: answers survive and the interview reopens", async () => {
  await onboarding.saveOnboardingAnswers({ who: "Coding streams for junior devs" });
  const skipped = await onboarding.skipOnboarding();
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.done, false, "a skip is not a finished interview");
  assert.equal(skipped.answers.who, "Coding streams for junior devs");

  const dismissed = await onboarding.dismissOnboardingReminder();
  assert.equal(dismissed.reminder, false, "the home reminder can be silenced");
  assert.equal(dismissed.status, "skipped", "silencing the reminder is not answering");

  const reopened = await onboarding.reopenOnboarding();
  assert.equal(reopened.status, "pending");
  assert.equal(reopened.answers.who, "Coding streams for junior devs", "the previous answers come back to edit");
});

test("answers given one at a time from either interface add up to one interview", async () => {
  // The web flow saves a step; the agent saves another; neither loses the other's.
  await onboarding.saveOnboardingAnswers({ who: "Streams" });
  await tools.executeEditorTool(NO_PROJECT, { tool: "onboarding.answer", answers: { platforms: "TikTok, 30 to 60 seconds" } } as never);
  const state = await onboarding.onboardingState();
  assert.deepEqual(state.answers, { who: "Streams", platforms: "TikTok, 30 to 60 seconds" });
  assert.deepEqual(state.remaining, ["record", "annoys", "names"]);

  const status = await tools.executeEditorTool(NO_PROJECT, { tool: "onboarding.status" } as never) as { next: { id: string } | null };
  assert.equal(status.next?.id, "record", "the agent is told which question to ask next, in order");
});

test("blank answers are not answers", async () => {
  const state = await onboarding.saveOnboardingAnswers({ who: "   ", record: "Long streams" });
  assert.deepEqual(state.answers, { record: "Long streams" });
  await fs.rm(path.join(workspace, "onboarding.json"), { force: true });
  // Nothing typed anywhere: there is nothing to write, and no agent is spawned to try.
  await assert.rejects(() => onboarding.runOnboarding({ who: "  " }, { runner: writer({ preferences: "unreachable" }) }), /at least one question/);
});

test("running it writes preferences and glossary, and merges answers saved earlier", async () => {
  await onboarding.saveOnboardingAnswers({ who: "Coding streams" });
  const result = await onboarding.runOnboarding({ names: "Deska, Next.js" }, {
    runner: writer({ preferences: "- Hooks under three seconds.\n- Never emojis.", glossary: [{ term: "Deska", aliases: [], note: "the product" }] }),
  });
  assert.deepEqual(result.answers, { who: "Coding streams", names: "Deska, Next.js" });
  assert.match((await preferences.readPreferences()).workspace, /Hooks under three seconds/);
  assert.deepEqual((await glossary.readGlossaryLevel("workspace")).terms.map((t) => t.term), ["Deska"]);
  const state = await onboarding.onboardingState();
  assert.equal(state.status, "done");
  assert.equal(state.hasPreferences, true);
});

test("running it again replaces what it wrote and keeps what the owner wrote by hand", async () => {
  await onboarding.runOnboarding({ who: "Streams" }, { runner: writer({ preferences: "- Hooks under three seconds." }) });
  await preferences.savePreferences((await preferences.readPreferences()).workspace + "\n\nMine: captions two words per line.");

  await onboarding.runOnboarding({ who: "Podcasts now" }, { runner: writer({ preferences: "- Hooks under six seconds." }) });
  const text = (await preferences.readPreferences()).workspace;
  assert.equal(text.match(/Hooks under/g)?.length, 1, "the interview's section is replaced, not appended to");
  assert.match(text, /Hooks under six seconds/);
  assert.match(text, /Mine: captions two words per line/, "hand-written preferences survive a rerun");
});

test("with no agent available the answers are kept verbatim rather than lost", async () => {
  const result = await onboarding.runOnboarding({ who: "Streams about Rust" }, { runner: undefined, provider: "definitely-not-installed" });
  assert.match(result.preferences, /Streams about Rust/);
});

test("the marked section is what makes a rerun safe", () => {
  const first = onboarding.mergeOnboardingPreferences("", "- One.");
  const second = onboarding.mergeOnboardingPreferences(first + "\n\nBy hand.", "- Two.");
  assert.match(second, /- Two\./);
  assert.doesNotMatch(second, /- One\./);
  assert.match(second, /By hand\./);
  assert.equal(second.match(/agentcut:onboarding/g)?.length, 2, "one marked section, however many reruns");
});

test("the agent can skip on the owner's behalf, through the same tools", async () => {
  await tools.executeEditorTool(NO_PROJECT, { tool: "onboarding.skip" } as never);
  const state = await onboarding.onboardingState();
  assert.equal(state.status, "skipped");
  assert.equal(state.hasPreferences, false, "skipping writes no preferences at all");
});

test("concurrent writes from both interfaces do not tear the state file", async () => {
  // What the browser does on "Skip for now": save what was typed, then skip — while
  // the agent may be saving an answer of its own. Unserialised, these interleaved
  // and left invalid JSON, which read back as a fresh workspace: both the answers
  // and the skip silently lost.
  await Promise.all([
    onboarding.saveOnboardingAnswers({ who: "Coding streams" }),
    onboarding.saveOnboardingAnswers({ platforms: "TikTok" }),
    tools.executeEditorTool(NO_PROJECT, { tool: "onboarding.answer", answers: { record: "Long streams" } } as never),
    onboarding.skipOnboarding(),
  ]);
  const raw = await fs.readFile(path.join(workspace, "onboarding.json"), "utf8");
  JSON.parse(raw); // throws if a write landed on top of another
  const state = await onboarding.onboardingState();
  assert.equal(state.status, "skipped", "the skip is not lost to a concurrent save, whichever lands last");
  assert.deepEqual(state.answers, { who: "Coding streams", record: "Long streams", platforms: "TikTok" }, "no answer overwrites another");
});
