import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";
import type { AgentProvider } from "../src/lib/agent";

let workspace: string;
let source: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let registry: typeof import("../src/lib/rules/registry");
let rulesApply: typeof import("../src/lib/rules/apply");
let evaluate: typeof import("../src/lib/rules/evaluate");
let glossary: typeof import("../src/lib/glossary");
let preferences: typeof import("../src/lib/preferences");

function speak(sentences: string[], gap = 0.5) {
  const words: Array<{ t: number; d: number; w: string }> = [];
  let t = 0;
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/)) { words.push({ t, d: 0.34, w: word }); t += 0.4; }
    t += gap;
  }
  return words;
}
const SCRIPT = [
  "Google changed how ranking works this year.",
  "That is the part everyone keeps getting wrong.",
  "Facebook rebuilt its feed around the same idea.",
  "It took them about four years to ship it.",
  "Nvidia sells the hardware underneath all of it.",
  "And that is why the numbers look the way they do.",
];

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-rules-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, registry, rulesApply, evaluate, glossary, preferences] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"), import("../src/lib/db"),
    import("../src/lib/rules/registry"), import("../src/lib/rules/apply"), import("../src/lib/rules/evaluate"),
    import("../src/lib/glossary"), import("../src/lib/preferences"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([
    { title: "Google", slug: "google", hex: "4285F4", aliases: [] },
    { title: "Facebook", slug: "facebook", hex: "0866FF", aliases: [] },
    { title: "Nvidia", slug: "nvidia", hex: "76B900", aliases: [] },
  ]));
  await brandIndex();
  source = path.join(workspace, "source.mp4");
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=320x180:rate=15:duration=20",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

async function projectWithScript() {
  const { id } = await mediaService.createVideoProject("Rules project", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  const item = sequence.items[0];
  store.editProject(id, {
    expectedRevision: snapshot.revision,
    operations: [{ type: "item.patch", sequenceId: sequence.id, itemId: item.id,
      patch: { title: "Ranking", hook: "How ranking really works", start: 0, end: 20, words: speak(SCRIPT), tags: ["explainer"] } }],
  });
  return { id, sequenceId: sequence.id, itemId: item.id };
}

const gameplay = { id: "gameplay-clean", name: "Gameplay stays clean", when: "the clip is gameplay footage", stage: "edit", priority: 10,
  then: { template: "talking-head", overrides: { images: { mode: "off" } }, prompt: "Never cover the game with pictures." } };
const stream = { id: "stream-outro", name: "Stream mention", when: "the speaker mentions the stream", stage: "both", priority: 50,
  then: { overrides: { hook: { mode: "off" } } } };
const selectOnly = { id: "no-chat-reading", name: "No chat reading", when: "the speaker is reading chat messages", stage: "select",
  then: { prompt: "Do not pick moments where the speaker only reads chat." } };

test("rules live at two levels, the project's winning by id, in priority order, and a bad file hides nothing else", async () => {
  await fs.mkdir(path.join(workspace, "rules"), { recursive: true });
  await fs.writeFile(path.join(workspace, "rules", "broken.json"), "{ not json");
  await registry.saveRule(stream, "workspace");
  await registry.saveRule(gameplay, "workspace");
  await registry.saveRule(selectOnly, "workspace");
  const all = await registry.listRules();
  assert.deepEqual(all.map((r) => r.id), ["gameplay-clean", "stream-outro", "no-chat-reading"]);
  assert.equal(all[0].promptText, "Never cover the game with pictures.");

  const { id } = await projectWithScript();
  await registry.saveRule({ ...stream, priority: 1, then: { overrides: { hook: { mode: "intro" } } } }, "project", id);
  const scoped = await registry.listRules(id);
  assert.equal(scoped[0].id, "stream-outro");
  assert.equal(scoped[0].level, "project");
  assert.equal(scoped.filter((r) => r.id === "stream-outro").length, 1, "a project rule replaces the workspace one");
  assert.equal((await registry.listRules())[1].level, "workspace", "other projects still see the workspace rule");

  // A prompt file is read from the rules folder and nowhere else.
  await fs.writeFile(path.join(workspace, "rules", "gaming.md"), "Keep the HUD visible.\n");
  await registry.saveRule({ ...gameplay, id: "gaming-file", then: { promptFile: "gaming.md" } }, "workspace");
  assert.equal((await registry.getRule("gaming-file")).promptText, "Keep the HUD visible.\n");
  await assert.rejects(registry.saveRule({ ...gameplay, id: "gaming-escape", then: { promptFile: "../preferences.md" } }, "workspace"), /inside the rules folder/);
  await registry.deleteRule("gaming-file");
  await assert.rejects(registry.saveRule({ ...gameplay, id: "Bad Id" }), /lowercase/);
  await assert.rejects(registry.saveRule({ ...gameplay, then: { template: "x", extra: 1 } }));
  await fs.rm(path.join(workspace, "rules", "broken.json"));
});

test("matched rules resolve to one template, merged overrides and ordered prompts", async () => {
  const rules = await registry.listRules();
  const resolved = rulesApply.resolveRules(rules.filter((r) => ["gameplay-clean", "stream-outro"].includes(r.id)).reverse());
  assert.equal(resolved.templateId, "talking-head");
  assert.deepEqual(resolved.overrides, { images: { mode: "off" }, hook: { mode: "off" } });
  assert.deepEqual(resolved.prompts, ["Never cover the game with pictures."]);
  assert.deepEqual(rulesApply.mergeOverrides({ images: { mode: "auto", sources: ["web"] } }, { images: { sources: ["brand"] } }), { images: { mode: "auto", sources: ["brand"] } });
  assert.deepEqual(rulesApply.rulesInAuthor(rulesApply.ruleAuthor("talking-head", ["a", "b"])), ["a", "b"]);
  assert.equal(rulesApply.templateInAuthor("template:talking-head/rule:a"), "talking-head");
  assert.equal(rulesApply.templateInAuthor("agent"), null);
});

test("applying rules is a template application through the shared tools, marked with the rules that chose it", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  const before = store.readEditor(id);
  const result = await tools.executeEditorTool(id, { tool: "rules.apply", ruleIds: ["gameplay-clean", "stream-outro", "nope"], sequenceId, expectedRevision: before.revision }) as import("../src/lib/rules/apply").RuleApplyResult;
  assert.equal(result.templateId, "talking-head");
  assert.equal(result.templateFrom, "rule");
  assert.deepEqual(result.ignored, ["nope"]);
  assert.deepEqual(result.overrides, { images: { mode: "off" }, hook: { mode: "off" } });
  assert.ok(result.applied && result.plan, "rules with a template change the timeline");
  assert.equal(result.applied!.images, 0, "the override switched pictures off");
  assert.equal(result.plan!.hook, null, "the override switched the hook off");

  const after = store.readEditor(id);
  const item = after.edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
  const authors = new Set(item.clip.edits.map((e) => e.by));
  assert.deepEqual([...authors], ["template:talking-head/rule:gameplay-clean,stream-outro"]);
  assert.ok(item.clip.edits.length > 0, "the template's own edits landed");
  assert.equal(item.clip.tags[0], "explainer", "tags are untouched");

  // Applying again converges: the template's edits are replaced, not stacked.
  const again = await rulesApply.applyRules(id, { ruleIds: ["gameplay-clean", "stream-outro"], sequenceId }, after.revision);
  const twice = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
  assert.equal(twice.clip.edits.length, item.clip.edits.length);
  assert.ok(again.revision > after.revision);

  // A rule that only adds a constraint sentence reads the template already on the video and changes nothing.
  const only = await rulesApply.applyRules(id, { ruleIds: ["no-chat-reading"], sequenceId }, again.revision);
  assert.equal(only.applied, null);
  assert.equal(only.templateFrom, "applied");
  assert.equal(only.templateId, "talking-head");
  assert.equal(store.readEditor(id).revision, again.revision);

  // A stale revision is refused the same way any edit is.
  await assert.rejects(rulesApply.applyRules(id, { ruleIds: ["gameplay-clean"], sequenceId }, before.revision), store.RevisionConflict);
});

test("evaluation hands the agent the material and the candidate rules, and keeps only real matches", async () => {
  const { id, sequenceId } = await projectWithScript();
  let seen: { rules: unknown[]; material: { transcript: string; shots: string[]; tags: string[] } } | null = null;
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    seen = {
      rules: JSON.parse(await fs.readFile(path.join(o.cwd, "rules.json"), "utf8")),
      material: JSON.parse(await fs.readFile(path.join(o.cwd, "material.json"), "utf8")),
    };
    assert.match(o.prompt, /untrusted/);
    assert.ok(o.deniedTools?.includes("Bash"));
    await fs.writeFile(path.join(o.cwd, "matches.json"), JSON.stringify({ matches: [{ id: "stream-outro", reason: "talks about the stream" }, { id: "stream-outro", reason: "dup" }, { id: "ghost" }], tags: ["Explainer", "tutorial"] }));
    return { provider: "test", text: "DONE", events: [], durationMs: 1 };
  } };
  const evaluation = await evaluate.evaluateRules(id, { sequenceId }, { runner, stage: "edit" });
  assert.deepEqual(seen!.rules.map((r) => (r as { id: string }).id), ["gameplay-clean", "stream-outro"], "select-only rules are not judged at edit time");
  assert.match(seen!.material.transcript, /Google changed how ranking works/);
  assert.deepEqual(seen!.material.shots, ["Ranking"]);
  assert.deepEqual(evaluation.matches.map((m) => m.id), ["stream-outro"]);
  assert.equal(evaluation.matches[0].rule.level, "workspace");
  assert.deepEqual(evaluation.unknown, ["ghost"]);
  assert.deepEqual(evaluation.tags, ["explainer", "tutorial"]);
  const selection = evaluate.candidateRules(await registry.listRules(), "select").map((r) => r.id);
  assert.deepEqual(selection, ["stream-outro", "no-chat-reading"]);
});

test("the selection agent's clips carry tags and judged rules, and the host executes them after publishing", async () => {
  const { buildEdl, readRuleMatches } = await import("../src/lib/pipeline/select");
  const { applyMatchedRules } = await import("../src/lib/jobs");
  const id = "legacy-rules";
  database.q.insertProject({ id, name: "Legacy", source_path: source, created_at: Date.now() });
  const dir = path.join(workspace, "projects", id);
  await fs.mkdir(dir, { recursive: true });
  const words = speak(SCRIPT);
  const transcript = { language: "en", engine: "test", segments: [{ start: 0, end: 15, text: SCRIPT.join(" ") }], words };
  await fs.writeFile(path.join(dir, "clips.json"), JSON.stringify({ clips: [
    { title: "One", hook: "Google changed", reason: "", score: 90, start: 0, end: 12, tags: ["Gameplay", " "], rules: ["gameplay-clean", "gameplay-clean", "missing"] },
    { title: "Two", hook: "", reason: "", score: 50, start: 0, end: 10, tags: [], rules: [] },
  ] }));
  const edl = await buildEdl({ projectId: id, videoPath: source, dir, probe: { width: 320, height: 180, fps: 15, durationSec: 20 } as never, transcript: transcript as never, minSec: 5 });
  assert.deepEqual(edl.clips.map((c) => c.tags), [["gameplay"], []]);
  const matches = await readRuleMatches(dir);
  assert.deepEqual(Object.values(matches), [["gameplay-clean", "missing"]]);
  store.publishClips(id, edl);

  const reports: string[] = [];
  await applyMatchedRules(id, dir, (kind, text) => reports.push(`${kind}: ${text}`));
  assert.equal(reports.length, 1);
  assert.match(reports[0], /^tool: clip .* template talking-head \(rule\).*ignored missing/);
  const saved = store.readEditor(id).edl;
  const promoted = saved.sequences.find((s) => s.id === edl.clips[0].id)!;
  assert.ok(promoted, "the clip promoted in place, keeping its id");
  assert.ok(promoted.items[0].clip.edits.every((e) => e.by === "template:talking-head/rule:gameplay-clean"));
  assert.equal(saved.clips.find((c) => c.id === edl.clips[1].id)?.tags.length, 0, "the unmatched clip is untouched");
});

test("the glossary fixes known mishearings deterministically and feeds the recogniser only names", async () => {
  await glossary.saveGlossary({ terms: [
    { term: "Claude", aliases: ["clod", "cloud AI"], note: "Anthropic's model" },
    { term: "Deska", aliases: [], note: "desktop app" },
  ] }, "workspace");
  const { id } = await projectWithScript();
  await glossary.saveGlossary({ terms: [{ term: "Deska", aliases: ["desk app"], note: "" }] }, "project", id);
  const merged = await glossary.readGlossary(id);
  assert.deepEqual(merged.terms.map((t) => t.term), ["Claude", "Deska"]);
  assert.deepEqual(merged.terms[1].aliases, ["desk app"], "the project's entry wins on the same term");
  assert.equal(glossary.glossaryWhisperPrompt(merged), "Claude, Deska");
  assert.match(glossary.glossaryBrief(merged), /Claude \(Anthropic's model\) — often misheard as "clod", "cloud AI"/);

  const transcript = {
    language: "en", engine: "test",
    segments: [{ start: 0, end: 4, text: "I asked clod and the cloud ai about deska today." }, { start: 4, end: 6, text: "The cloud is fine." }],
    words: [{ w: "clod", t: 0, d: 0.3 }, { w: "cloud", t: 1, d: 0.3 }, { w: "ai", t: 1.3, d: 0.3 }, { w: "deska,", t: 2, d: 0.3 }, { w: "Claude", t: 3, d: 0.3 }],
  };
  const { transcript: fixed, changed } = glossary.applyGlossary(transcript as never, merged);
  assert.equal(fixed.segments[0].text, "I asked Claude and the Claude about Deska today.");
  assert.equal(fixed.segments[1].text, "The cloud is fine.", "a bare word that is only part of an alias is left alone");
  assert.deepEqual(fixed.words.map((w) => w.w), ["Claude", "cloud", "ai", "Deska,", "Claude"], "two-word aliases never merge timed words");
  assert.equal(changed, 5, "three in the segment text, two in the timed words");
  assert.equal(glossary.applyGlossary(transcript as never, { terms: [] }).changed, 0);

  const viaTool = await tools.executeEditorTool(id, { tool: "glossary.get" }) as typeof merged;
  assert.deepEqual(viaTool, merged);
  await assert.rejects(tools.executeEditorTool(id, { tool: "glossary.save", glossary: { terms: [{ term: "" }] } }));
});

test("preferences are the owner's words, kept per level and handed to every agent as one block", async () => {
  const { id } = await projectWithScript();
  await preferences.savePreferences("Short hooks. Never emojis.\n", "workspace");
  await tools.executeEditorTool(id, { tool: "preferences.set", text: "This series is for TikTok.", level: "project" });
  const read = await tools.executeEditorTool(id, { tool: "preferences.get" }) as import("../src/lib/preferences").Preferences;
  assert.deepEqual(read, { workspace: "Short hooks. Never emojis.", project: "This series is for TikTok." });
  const block = preferences.preferencesBlock(read);
  assert.match(block, /In general\nShort hooks/);
  assert.match(block, /For this project\nThis series/);
  assert.equal(preferences.preferencesBlock({ workspace: "", project: "" }), "");
  assert.equal((await preferences.readPreferences()).project, "", "another project does not inherit project preferences");

  // The editor agent's run directory carries all three, and its prompt carries the preferences.
  let prompt = "";
  let files: string[] = [];
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    prompt = o.prompt; files = await fs.readdir(o.cwd);
    return { provider: "test", text: "done", events: [], durationMs: 1 };
  } };
  const { runEditorAgent } = await import("../src/lib/editor/agent");
  await runEditorAgent(id, "Tighten the hook", { runner });
  for (const name of ["rules.json", "glossary.json", "preferences.md", "templates.json"]) assert.ok(files.includes(name), `${name} is in the run directory`);
  assert.match(prompt, /Short hooks\. Never emojis\./);
  assert.match(prompt, /rules\.apply/);
});
