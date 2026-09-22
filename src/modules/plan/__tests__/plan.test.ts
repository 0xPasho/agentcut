import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../../../common/server/bin";
import type { AgentProvider } from "../../agent/lib/providers";

let workspace: string;
let source: string;
let store: typeof import("../../editor/server/store");
let mediaService: typeof import("../../media/server/media-import");
let tools: typeof import("../../editor/server/tools");
let database: typeof import("../../../common/server/db");
let operations: typeof import("../../editor/lib/operations");
let history: typeof import("../../editor/lib/history");
let registry: typeof import("../../rules/server/registry");
let planApply: typeof import("../lib/apply");
let generate: typeof import("../server/generate");

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
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-plan-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, operations, history, registry, planApply, generate] = await Promise.all([
    import("../../editor/server/store"), import("../../media/server/media-import"), import("../../editor/server/tools"), import("../../../common/server/db"),
    import("../../editor/lib/operations"), import("../../editor/lib/history"), import("../../rules/server/registry"),
    import("../lib/apply"), import("../server/generate"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../../media/server/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([{ title: "Google", slug: "google", hex: "4285F4", aliases: [] }]));
  await brandIndex();
  source = path.join(workspace, "source.mp4");
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=320x180:rate=15:duration=20",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  await registry.saveRule({ id: "quiet", name: "Quiet", when: "the video is a calm explainer", stage: "edit", then: { overrides: { rhythm: { punch: { enabled: false } } } } });
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

async function projectWithScript() {
  const { id } = await mediaService.createVideoProject("Plan project", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  const item = sequence.items[0];
  store.editProject(id, {
    expectedRevision: snapshot.revision,
    operations: [{ type: "item.patch", sequenceId: sequence.id, itemId: item.id, patch: { title: "Ranking", hook: "How ranking really works", start: 0, end: 20, words: speak(SCRIPT) } }],
  });
  return { id, sequenceId: sequence.id, itemId: item.id };
}

test("plans are part of the project state: patched by operations, validated, pruned with their shots, and undoable", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  const start = store.readEditor(id);
  assert.equal(start.edl.plan.template, null, "an untouched project has an empty plan");
  assert.equal(start.edl.sequences[0].plan.status, "pending");

  const beats = [{ id: "b1", kind: "hook", intent: "the claim", reason: "opens on a name", itemIds: [itemId], atSec: 0, durationSec: 3 }, { id: "b2", kind: "payoff", intent: "the numbers", reason: "", itemIds: [itemId, "ghost"] }];
  const saved = store.editProject(id, { expectedRevision: start.revision, operations: [
    { type: "plan.patch", patch: { brief: { goal: "Explain ranking", platform: "tiktok", audience: "", lengthSec: 45, notes: "" }, template: "talking-head", series: { enabled: true, order: [sequenceId, "nope"], numbering: "n-of-total", covered: [] } } },
    { type: "sequence.plan.patch", sequenceId, patch: { beats, tags: ["Explainer"], summary: "Ranking changed" } },
  ] });
  assert.equal(saved.edl.plan.brief.platform, "tiktok");
  assert.deepEqual(saved.edl.plan.series.order, [sequenceId], "a series only orders videos that exist");
  const plan = saved.edl.sequences[0].plan;
  assert.deepEqual(plan.beats[1].itemIds, [itemId], "a beat only points at shots on this timeline");
  assert.equal(plan.beats[0].durationSec, 3);

  // Both patches are strict: unknown fields and bad values are refused like any other operation.
  assert.throws(() => operations.applyOperations(saved.edl, [{ type: "plan.patch", patch: { template: 5 } }]));
  assert.throws(() => operations.applyOperations(saved.edl, [{ type: "sequence.plan.patch", sequenceId, patch: { status: "done" } }]));
  await assert.rejects(tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: saved.revision, operations: [{ type: "sequence.plan.patch", sequenceId: "missing", patch: { status: "approved" } }] }), /Sequence not found/);

  // Removing a shot removes it from every beat; undoing the removal restores both.
  const remove = [{ type: "item.remove" as const, sequenceId, itemId }];
  const inverse = history.invertOperations(saved.edl, remove);
  const removed = operations.applyOperations(saved.edl, remove);
  assert.equal(removed.sequences[0].plan.beats.length, 0, "beats with nothing left to point at are dropped");
  const restored = operations.applyOperations(removed, inverse);
  assert.deepEqual(restored.sequences[0].plan.beats, saved.edl.sequences[0].plan.beats);

  // A plan patch inverts to the previous values of exactly the fields it touched.
  const patch = [{ type: "plan.patch" as const, patch: { template: "explainer-broll" } }];
  const back = operations.applyOperations(operations.applyOperations(saved.edl, patch), history.invertOperations(saved.edl, patch));
  assert.equal(back.plan.template, "talking-head");
  assert.equal(back.plan.brief.platform, "tiktok");
  const read = await tools.executeEditorTool(id, { tool: "plan.read" }) as { project: { template: string }; sequences: Array<{ plan: { summary: string } }> };
  assert.equal(read.project.template, "talking-head");
  assert.equal(read.sequences[0].plan.summary, "Ranking changed");
});

test("an agent writes a sequence plan from the material and the host commits only what exists", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  let material: { items: Array<{ id: string; sentences: Array<{ t: number; text: string }> }> } | null = null;
  let files: string[] = [];
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    files = await fs.readdir(o.cwd);
    material = JSON.parse(await fs.readFile(path.join(o.cwd, "material.json"), "utf8"));
    assert.match(o.prompt, /untrusted/);
    await fs.writeFile(path.join(o.cwd, "plan.json"), JSON.stringify({
      summary: "Why ranking changed", tags: ["Explainer", "tech"], template: "talking-head", rules: ["quiet", "ghost"],
      beats: [
        { kind: "hook", intent: "the claim", reason: "names Google", itemId, atSec: 0, durationSec: 2.8 },
        { kind: "point", intent: "who else", reason: "", itemId: "nope" },
        { kind: "payoff", intent: "the numbers", reason: "", itemIds: [itemId], atSec: 10 },
      ],
      reasons: { template: "one speaker, no screenshots" },
    }));
    return { provider: "test", text: "DONE", events: [], durationMs: 1 };
  } };
  const before = store.readEditor(id).revision;
  const result = await generate.generateSequencePlan(id, { sequenceId }, { runner });
  for (const name of ["material.json", "templates.json", "rules.json", "glossary.json", "project-plan.json"]) assert.ok(files.includes(name), `${name} is in the run directory`);
  assert.equal(material!.items[0].id, itemId);
  assert.ok(material!.items[0].sentences.length >= 5, "sentences are timed for the agent");
  assert.ok(result.revision > before);
  const plan = store.readEditor(id).edl.sequences[0].plan;
  assert.equal(plan.summary, "Why ranking changed");
  assert.deepEqual(plan.tags, ["explainer", "tech"]);
  assert.equal(plan.template, "talking-head");
  assert.deepEqual(plan.rules, ["quiet"], "unknown rule ids are dropped");
  assert.deepEqual(plan.beats.map((b) => b.kind), ["hook", "payoff"], "a beat pointing at no real shot is dropped");
  assert.match(plan.beats[0].id, /^b_/);
  assert.equal(plan.reasons.template, "one speaker, no screenshots");
  assert.ok(plan.generatedAt > 0);
  assert.equal(plan.status, "pending", "planning does not edit the video");
});

test("applying a plan is one template application with the plan's choices, and marks the video edited", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  const start = store.readEditor(id);
  store.editProject(id, { expectedRevision: start.revision, operations: [
    { type: "plan.patch", patch: { template: "explainer-broll", overrides: { images: { mode: "off" } }, rules: ["quiet"] } },
    { type: "sequence.plan.patch", sequenceId, patch: { template: "talking-head", overrides: { hook: { mode: "off" } } } },
  ] });
  const revision = store.readEditor(id).revision;
  const result = await tools.executeEditorTool(id, { tool: "plan.apply", sequenceId, expectedRevision: revision }) as import("../lib/apply").PlanApplyResult;
  assert.equal(result.templateId, "talking-head", "the sequence plan overrides the project's template");
  assert.deepEqual(result.overrides, { images: { mode: "off" }, hook: { mode: "off" }, rhythm: { punch: { enabled: false } } }, "overrides stack project, sequence, rules");
  assert.equal(result.plan!.hook, null);
  assert.equal(result.plan!.totals.punches, 0, "the rule's override reached the template");
  assert.equal(result.status, "edited");
  const after = store.readEditor(id);
  const item = after.edl.sequences[0].items.find((i) => i.id === itemId)!;
  assert.ok(item.clip.edits.length > 0);
  assert.ok(item.clip.edits.every((e) => e.by === "template:talking-head/plan/rule:quiet"), item.clip.edits[0]?.by);
  assert.equal(after.edl.sequences[0].plan.status, "edited");
  await assert.rejects(planApply.applyPlan(id, { sequenceId }, revision), store.RevisionConflict);

  // A project-wide apply reaches a generated clip too, promoting it in place, and reports per video.
  const clipped = store.editProject(id, { expectedRevision: after.revision, operations: [{ type: "clip.add", clip: { id: "legacy", title: "Legacy clip", start: 0, end: 12, words: speak(SCRIPT.slice(0, 3)), edits: [], crop: [], captions: {}, hook: "", reason: "", score: 50, layout: { type: "crop" }, tags: [] } }] });
  store.editProject(id, { expectedRevision: clipped.revision, operations: [{ type: "sequence.plan.patch", sequenceId, patch: { status: "approved" } }] });
  const wide = await planApply.applyProjectPlan(id, store.readEditor(id).revision);
  assert.deepEqual(wide.results.map((r) => [r.sequenceId, r.ok]), [[sequenceId, true], ["legacy", true]]);
  const final = store.readEditor(id).edl;
  assert.equal(final.sequences[0].plan.status, "approved", "an approved video stays approved when re-applied");
  const promoted = final.sequences.find((s) => s.id === "legacy")!;
  assert.equal(promoted.plan.status, "edited");
  assert.ok(promoted.items[0].clip.edits.every((e) => e.by.startsWith("template:explainer-broll/plan")), "the clip took the project's template");
});

test("an agent writes the shared plan from every video's summary, and only orders videos that exist", async () => {
  const { id, sequenceId } = await projectWithScript();
  let videos: Array<{ id: string; summary: string }> = [];
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    videos = JSON.parse(await fs.readFile(path.join(o.cwd, "videos.json"), "utf8"));
    await fs.writeFile(path.join(o.cwd, "project-plan.json"), JSON.stringify({
      template: "talking-head", rules: ["quiet"], tags: ["series"], subject: "Google",
      series: { enabled: true, order: [sequenceId, "missing"], numbering: "n-of-total", covered: ["ranking changed"] }, reasons: { series: "three parts" },
    }));
    return { provider: "test", text: "DONE", events: [], durationMs: 1 };
  } };
  await tools.executeEditorTool(id, { tool: "project.edit", expectedRevision: store.readEditor(id).revision, operations: [{ type: "sequence.plan.patch", sequenceId, patch: { summary: "Ranking changed" } }] });
  const result = await generate.generateProjectPlan(id, { runner });
  assert.equal(videos[0].summary, "Ranking changed");
  assert.equal(result.plan.template, "talking-head");
  const plan = store.readEditor(id).edl.plan;
  assert.deepEqual(plan.series.order, [sequenceId]);
  assert.equal(plan.series.numbering, "n-of-total");
  assert.deepEqual(plan.rules, ["quiet"]);
  assert.equal(plan.subject, "Google");
  assert.ok(plan.generatedAt > 0);
});
