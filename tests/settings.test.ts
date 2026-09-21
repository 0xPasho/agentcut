/**
 * The settings home: the workspace configuration that used to be stacked at the
 * bottom of the library, plus the editors that were never built.
 *
 * What matters here is not that a page renders. It is that the page and an agent
 * are looking at one thing: every control on /settings writes through a tool an
 * agent can call, the validation is the same object, and reading back through the
 * other interface shows what the first one wrote. Plus the two rules a key has to
 * obey — never readable, never in a run directory — and the order a model per task
 * resolves in.
 *
 * Run with: tsx --test tests/settings.test.ts
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let workspace: string;
let secrets: typeof import("../src/lib/secrets");
let selection: typeof import("../src/lib/agent/selection");
let tools: typeof import("../src/lib/editor/tools");
let registry: typeof import("../src/lib/rules/registry");
let preferences: typeof import("../src/lib/preferences");
let section: typeof import("../src/lib/preferences-section");
let glossary: typeof import("../src/lib/glossary");
let database: typeof import("../src/lib/db");

/**
 * Settings are about the owner, not a project, but the editor tools are bound to a
 * project id the way every other tool is — the workspace-level ones take one and
 * ignore it. A row is enough; none of these tools looks at the project's contents.
 */
const PROJECT = "settings-test-project";

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-settings-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  for (const key of ["AGENTCUT_PEXELS_KEY", "AGENTCUT_UNSPLASH_KEY", "AGENTCUT_GOOGLE_CSE_KEY", "AGENTCUT_GOOGLE_CSE_CX"]) delete process.env[key];
  [secrets, selection, tools, registry, preferences, section, glossary, database] = await Promise.all([
    import("../src/lib/secrets"), import("../src/lib/agent/selection"), import("../src/lib/editor/tools"),
    import("../src/lib/rules/registry"), import("../src/lib/preferences"), import("../src/lib/preferences-section"),
    import("../src/lib/glossary"), import("../src/lib/db"),
  ]);
});

after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  database.db.exec("DELETE FROM settings");
  if (!database.q.getProject(PROJECT)) database.q.insertProject({ id: PROJECT, name: "Settings", source_path: "", created_at: Date.now() });
  for (const key of ["AGENTCUT_PEXELS_KEY", "AGENTCUT_UNSPLASH_KEY", "AGENTCUT_GOOGLE_CSE_KEY", "AGENTCUT_GOOGLE_CSE_CX"]) delete process.env[key];
});

// ── Provider keys ────────────────────────────────────────────────────────────

test("a key can be set and spent, and never read back", () => {
  secrets.setProviderKey("pexels", "  sk-not-a-real-key  ");
  // Spendable by the provider that needs it, trimmed.
  assert.equal(secrets.providerKey("pexels"), "sk-not-a-real-key");
  // Never in what a page or an agent is told.
  const listed = secrets.providerKeys();
  const pexels = listed.find((k) => k.id === "pexels")!;
  assert.equal(pexels.set, true);
  assert.equal(pexels.source, "workspace");
  assert.equal(pexels.value, undefined);
  assert.equal(JSON.stringify(listed).includes("sk-not-a-real-key"), false);
});

test("an id that is not a credential is shown, because hiding it helps nobody", () => {
  secrets.setProviderKey("googleCx", "0123456789:abcdef");
  const cx = secrets.providerKeys().find((k) => k.id === "googleCx")!;
  assert.equal(cx.secret, false);
  assert.equal(cx.value, "0123456789:abcdef");
});

test("an empty value clears a key, and the environment answers again", () => {
  process.env.AGENTCUT_UNSPLASH_KEY = "from-the-environment";
  secrets.setProviderKey("unsplash", "from-settings");
  assert.equal(secrets.providerKey("unsplash"), "from-settings");
  assert.equal(secrets.providerKeys().find((k) => k.id === "unsplash")!.source, "workspace");

  secrets.setProviderKey("unsplash", "");
  assert.equal(secrets.providerKey("unsplash"), "from-the-environment");
  const after = secrets.providerKeys().find((k) => k.id === "unsplash")!;
  assert.equal(after.set, true);
  assert.equal(after.source, "environment");
  assert.equal(after.value, undefined);
});

test("an unknown key is refused rather than stored under a name nothing reads", () => {
  assert.throws(() => secrets.setProviderKey("openai", "x"), /Unknown provider key/);
});

test("a key never becomes an environment variable, so no agent inherits it", () => {
  secrets.setProviderKey("google", "sk-google");
  // spawnStream copies process.env into every harness it starts. Nothing may put a
  // key there, which is what keeps it out of an agent's run directory.
  assert.equal(process.env.AGENTCUT_GOOGLE_CSE_KEY, undefined);
  assert.equal(Object.values(process.env).includes("sk-google"), false);
});

test("the picture providers report themselves configured from the saved key", async () => {
  const photos = await import("../src/lib/search/photos");
  assert.deepEqual(photos.configuredKeyedProviders(), []);
  secrets.setProviderKey("pexels", "sk-pexels");
  assert.deepEqual(photos.configuredKeyedProviders(), ["pexels"]);
  // Google needs both halves before it counts as configured.
  secrets.setProviderKey("google", "sk-google");
  assert.deepEqual(photos.configuredKeyedProviders(), ["pexels"]);
  secrets.setProviderKey("googleCx", "cx");
  assert.deepEqual(photos.configuredKeyedProviders(), ["pexels", "google"]);
});

test("the agent's key tools are the page's: write-only, same answer", async () => {
  await tools.executeEditorTool(PROJECT, { tool: "providerkeys.set", id: "pexels", value: "sk-through-the-tool" });
  const listed = (await tools.executeEditorTool(PROJECT, { tool: "providerkeys.list" })) as Array<Record<string, unknown>>;
  assert.equal(listed.find((k) => k.id === "pexels")!.set, true);
  assert.equal(JSON.stringify(listed).includes("sk-through-the-tool"), false);
  // And what the page's own read would say is the same object.
  assert.deepEqual(listed, secrets.providerKeys() as unknown as Array<Record<string, unknown>>);
});

// ── Model per task ───────────────────────────────────────────────────────────

test("a task falls back to the workspace default until it is given one", () => {
  selection.saveSelection({ provider: "claude", model: "sonnet" });
  assert.deepEqual(selection.resolveSelection(undefined, "clipping"), { provider: "claude", model: "sonnet", scope: "workspace" });

  selection.saveTaskSelection("clipping", { provider: "claude", model: "opus" });
  assert.deepEqual(selection.resolveSelection(undefined, "clipping"), { provider: "claude", model: "opus", scope: "task" });
  // Only that task moved.
  assert.equal(selection.resolveSelection(undefined, "observations").model, "sonnet");
  assert.equal(selection.resolveSelection().model, "sonnet");
});

test("a project override beats the task, because it is the more specific statement", () => {
  selection.saveSelection({ provider: "claude", model: "sonnet" });
  selection.saveTaskSelection("clipping", { provider: "claude", model: "opus" });
  selection.saveSelection({ provider: "codex", model: "gpt-5.1-codex" }, "p1");
  assert.deepEqual(selection.resolveSelection("p1", "clipping"), { provider: "codex", model: "gpt-5.1-codex", scope: "project" });
});

test("clearing a task puts it back to inheriting", () => {
  selection.saveSelection({ provider: "claude", model: "sonnet" });
  selection.saveTaskSelection("judging", { provider: "claude", model: "haiku" });
  assert.equal(selection.storedTaskSelection("judging")?.model, "haiku");
  selection.saveTaskSelection("judging", null);
  assert.equal(selection.storedTaskSelection("judging"), null);
  assert.equal(selection.resolveSelection(undefined, "judging").model, "sonnet");
});

test("every job kind that runs an agent names the work it is doing", () => {
  assert.equal(selection.taskForJobKind("analyze"), "clipping");
  assert.equal(selection.taskForJobKind("batch"), "planning");
  assert.equal(selection.taskForJobKind("edit"), "editing");
  // A render spawns no agent, so it has no task and inherits nothing task-shaped.
  assert.equal(selection.taskForJobKind("render"), undefined);
});

test("an explicit provider still wins over a task choice", () => {
  selection.saveTaskSelection("clipping", { provider: "claude", model: "opus" });
  assert.deepEqual(selection.effectiveSelection(undefined, { provider: "codex" }, "clipping"), { provider: "codex" });
  assert.deepEqual(selection.effectiveSelection(undefined, {}, "clipping"), { provider: "claude", model: "opus" });
});

test("the page and the agent choose a model through the same validation", async () => {
  // The page posts to /api/workspace, the agent calls the tool; both land here.
  selection.applySelection({ scope: "task", task: "observations", provider: "claude", model: "haiku" });
  await tools.executeEditorTool(PROJECT, { tool: "agents.select", scope: "task", task: "planning", provider: "claude", model: "opus" });

  const overview = selection.selectionOverview();
  assert.equal(overview.tasks.find((t) => t.task === "observations")!.own!.model, "haiku");
  assert.equal(overview.tasks.find((t) => t.task === "planning")!.own!.model, "opus");
  // Every task is listed with a label, whether or not it has been chosen.
  assert.deepEqual(overview.tasks.map((t) => t.task), selection.AGENT_TASKS.map((t) => t.id));

  assert.throws(() => selection.applySelection({ scope: "task", task: "nonsense", provider: "claude", model: "" }), /Unknown task/);
  assert.throws(() => selection.applySelection({ scope: "workspace", provider: "gemini", model: "" }), /invalid|expected/i);
});

// ── preferences.md by hand ───────────────────────────────────────────────────

test("editing by hand keeps the interview's section, and the markers with it", () => {
  const file = section.mergeOnboardingPreferences("Short hooks.", "Captions two words a line.");
  const split = section.splitOnboardingPreferences(file);
  assert.equal(split.own, "Short hooks.");
  assert.equal(split.generated, "Captions two words a line.");

  // The editor saves the owner's half; reassembling puts the section back untouched.
  const edited = section.mergeOnboardingPreferences("Short hooks. Never emojis.", split.generated);
  assert.equal(section.splitOnboardingPreferences(edited).own, "Short hooks. Never emojis.");
  assert.equal(section.splitOnboardingPreferences(edited).generated, "Captions two words a line.");
  assert.equal(edited.match(/agentcut:onboarding/g)?.length, 2);
});

test("removing the interview's section leaves what the owner wrote", () => {
  const file = section.mergeOnboardingPreferences("Music under the voice.", "Hooks under three seconds.");
  const { own } = section.splitOnboardingPreferences(file);
  assert.equal(own, "Music under the voice.");
  assert.equal(section.splitOnboardingPreferences(own).generated, "");
});

test("two saves at once leave one whole file, not a torn one", async () => {
  const long = "a".repeat(20_000);
  await Promise.all([
    preferences.savePreferences(long, "workspace"),
    preferences.savePreferences("Short hooks.", "workspace"),
    preferences.savePreferences(long, "workspace"),
  ]);
  const text = await fs.readFile(path.join(workspace, "preferences.md"), "utf8");
  assert.ok(text.trim() === long || text.trim() === "Short hooks.", "a save landed half-written");
  // And nothing was left behind mid-rename.
  const stray = (await fs.readdir(workspace)).filter((f) => f.startsWith("preferences.md."));
  assert.deepEqual(stray, []);
});

test("the page writes preferences through the tool an agent calls", async () => {
  await tools.executeEditorTool(PROJECT, { tool: "preferences.set", text: "Never emojis.", level: "workspace" });
  assert.equal((await preferences.readPreferences()).workspace, "Never emojis.");
  const read = (await tools.executeEditorTool(PROJECT, { tool: "preferences.get" })) as { workspace: string };
  assert.equal(read.workspace, "Never emojis.");
});

// ── Rules: order, on and off ─────────────────────────────────────────────────

const rule = (id: string, priority: number) => ({ id, name: id, when: `it is ${id}`, priority, enabled: true, then: {} });

test("moving a rule is a renumber, and the list comes back in that order", async () => {
  for (const [i, id] of ["first", "second", "third"].entries()) await registry.saveRule(rule(id, (i + 1) * 10));
  assert.deepEqual((await registry.listRules()).map((r) => r.id), ["first", "second", "third"]);

  // What the page does when you move "third" up: renumber and save what changed.
  const moved = ["first", "third", "second"];
  for (const [i, id] of moved.entries()) {
    const current = await registry.getRule(id);
    const { level, file, promptText, ...document } = current; void level; void file; void promptText;
    await registry.saveRule({ ...document, priority: (i + 1) * 10 });
  }
  assert.deepEqual((await registry.listRules()).map((r) => r.id), moved);
});

test("turning a rule off leaves it in the list, and an agent sees the same", async () => {
  await registry.saveRule(rule("gameplay", 10));
  await tools.executeEditorTool(PROJECT, { tool: "rules.save", rule: { ...rule("gameplay", 10), enabled: false }, level: "workspace" });
  const listed = (await tools.executeEditorTool(PROJECT, { tool: "rules.list" })) as Array<{ id: string; enabled: boolean }>;
  assert.equal(listed.find((r) => r.id === "gameplay")!.enabled, false);
  assert.equal((await registry.listRules()).find((r) => r.id === "gameplay")!.enabled, false);
});

test("a rule the page could not save is refused the same way for an agent", async () => {
  await assert.rejects(
    () => tools.executeEditorTool(PROJECT, { tool: "rules.save", rule: { ...rule("Not A Slug", 10), id: "Not A Slug" }, level: "workspace" }),
    /lowercase letters, digits and dashes/,
  );
});

// ── Subjects ─────────────────────────────────────────────────────────────────

test("a subject is a glossary term with a look, saved through the glossary tool", async () => {
  await tools.executeEditorTool(PROJECT, {
    tool: "glossary.save",
    level: "workspace",
    glossary: {
      terms: [
        { term: "Deska", aliases: ["desk app"], note: "Desktop app for designers", brand: { palette: { primary: "#ffda2a", secondary: "", text: "", background: "" }, fonts: { captions: "", titles: "" }, logo: { slot: "", assetId: "" } } },
        { term: "Claude", aliases: ["clod"], note: "Anthropic's model" },
      ],
    },
  });
  const saved = await glossary.readGlossaryLevel("workspace");
  const subject = saved.terms.find((t) => t.term === "Deska")!;
  assert.equal(subject.brand?.palette.primary, "#ffda2a");
  // A plain term is not a subject and stays that way.
  assert.equal(saved.terms.find((t) => t.term === "Claude")!.brand, undefined);
  // And the spelling half still works: the subject is in the same glossary.
  assert.equal(glossary.glossaryWhisperPrompt(saved), "Deska, Claude");
});

test("a subject keeps its look when the glossary is edited around it", async () => {
  const kit = { palette: { primary: "#ff0000", secondary: "", text: "", background: "" }, fonts: { captions: "", titles: "" }, logo: { slot: "", assetId: "" } };
  await glossary.saveGlossary({ terms: [{ term: "Deska", aliases: [], note: "", brand: kit }] }, "workspace");
  const current = await glossary.readGlossaryLevel("workspace");
  // What the subjects editor saves: the same list with one term replaced.
  await glossary.saveGlossary({ terms: current.terms.map((t) => (t.term === "Deska" ? { ...t, note: "The app" } : t)) }, "workspace");
  const after = await glossary.readGlossaryLevel("workspace");
  assert.equal(after.terms[0].note, "The app");
  assert.equal(after.terms[0].brand?.palette.primary, "#ff0000");
});

// ── Parity of the whole page ─────────────────────────────────────────────────

test("every control on the settings page has a tool behind it", () => {
  const tool = (name: string) => tools.EditorToolCall.options.some((o) => (o.shape.tool as { value: string }).value === name);
  for (const name of [
    "rules.list", "rules.save", "rules.delete",
    "glossary.get", "glossary.save",
    "preferences.get", "preferences.set",
    "onboarding.status", "onboarding.run", "onboarding.skip", "onboarding.reopen",
    "observations.read", "observations.review",
    "agents.status", "agents.select",
    "providerkeys.list", "providerkeys.set",
    "packs.list", "packs.inspect", "packs.import", "packs.remove", "packs.export",
  ]) assert.equal(tool(name), true, `${name} is on the page but not reachable by an agent`);
});

test("configuring the machine works before any project exists", async () => {
  // A terminal agent setting up a fresh install has no project to name, so the tools
  // that are purely about the owner do not ask for one.
  for (const call of [{ tool: "providerkeys.list" }, { tool: "onboarding.status" }, { tool: "agents.select", scope: "task", task: "judging", provider: "", model: "" }]) {
    await tools.executeEditorTool("nothing-here", call);
  }
  // The rest are still bound to a project, as every other editor tool is: a workspace
  // rule is written through a project's transport, exactly as the panel has always done.
  await assert.rejects(() => tools.executeEditorTool("nothing-here", { tool: "rules.list" }), /Project not found/);
});
