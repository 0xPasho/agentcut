import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

/**
 * The edges of a stream short: the material nobody plans for. A clip shorter than the
 * card that ends it, a recording at a frame rate the output is not, a transcript of one
 * word, a hook that is an emoji, a rule pointing at something that is not there any more.
 *
 * Each of these was reachable from the panel or from an agent before it was written down.
 */

let workspace: string;
let source: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let registry: typeof import("../src/lib/templates/registry");
let rules: typeof import("../src/lib/rules/registry");
let assets: typeof import("../src/lib/assets");
let planner: typeof import("../src/lib/templates/plan");

const video = (file: string, size: string, seconds: number, fps = 30, colour = "navy") => {
  const result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${colour}:size=${size}:rate=${fps}:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return file;
};

function speak(sentences: string[], gap = 1.4) {
  const words: Array<{ t: number; d: number; w: string }> = [];
  let t = 0;
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/)) { words.push({ t, d: 0.34, w: word }); t += 0.4; }
    t += gap;
  }
  return words;
}
const SCRIPT = ["Esto es lo que nadie te dice.", "Y por eso todo el mundo se atora."];

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-stream-edges-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, registry, rules, assets, planner] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"),
    import("../src/lib/db"), import("../src/lib/templates/registry"), import("../src/lib/rules/registry"),
    import("../src/lib/assets"), import("../src/lib/templates/plan"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([]));
  await brandIndex();
  source = video(path.join(workspace, "stream.mp4"), "1728x1116", 20);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

const STREAM_OVERRIDES = {
  layout: { camera: { x: 0.69, y: 0.72, w: 0.31, h: 0.28 }, screen: { x: 0, y: 0, w: 0.69, h: 1 } },
};

async function project(file = source, words = speak(SCRIPT), end = 12) {
  const { id } = await mediaService.createVideoProject("Edges", [{ file }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.patch", sequenceId: sequence.id, itemId: sequence.items[0].id,
      patch: { title: "Corte", hook: "¿Y si nadie lo dice?", start: 0, end, words } },
  ] });
  return { id, sequenceId: sequence.id, itemId: sequence.items[0].id };
}

async function endCard(name = "card.mp4", seconds = 4) {
  const file = video(path.join(workspace, name), "480x854", seconds, 30, "green");
  return assets.uploadLibraryAsset(name, await fs.readFile(file));
}

test("a card longer than the video it ends still plays whole, and the hook still stops at it", async () => {
  const card = await endCard("long-card.mp4", 9);
  await registry.saveTemplate({ id: "long-end", extends: "stream-short", name: "Long end", outro: { enabled: true, slot: "endcard" }, ...STREAM_OVERRIDES });
  const { id, sequenceId } = await project(source, speak(SCRIPT), 6);
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "long-end", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } });

  const { sequenceFrames } = await import("../src/lib/sequences");
  const sequence = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const frames = sequenceFrames(sequence);
  const fps = sequence.output.fps;
  const outro = frames.items.find((e) => e.item.clip.title === "Outro")!;
  const hook = frames.items.find((e) => e.item.clip.title === "Hook")!;
  assert.ok(Math.abs(outro.duration / fps - 9) < 0.2, `the card plays whole even when it is longer: ${outro.duration / fps}s`);
  assert.ok(Math.abs((hook.from + hook.duration) / fps - outro.from / fps) < 0.05, "and the hook still ends where it starts");
  assert.ok(hook.duration / fps > 0.2, "the hook is still on screen for something");
});

test("a recording at another frame rate, and one four times the size, are framed in their own pixels", async () => {
  await registry.saveTemplate({ id: "edge-split", extends: "stream-short", name: "Edge split", outro: { enabled: false }, ...STREAM_OVERRIDES });
  for (const [size, fps, expected] of [["1280x720", 25, { x: 883, y: 518, w: 397, h: 202 }], ["3840x2160", 60, { x: 2650, y: 1555, w: 1190, h: 605 }]] as const) {
    const file = video(path.join(workspace, `odd-${size}-${fps}.mp4`), size, 8, fps);
    const { id, sequenceId } = await project(file, speak(SCRIPT), 8);
    await tools.executeEditorTool(id, { tool: "template.apply", templateId: "edge-split", sequenceId, expectedRevision: store.readEditor(id).revision });
    const shot = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.mediaId)!;
    assert.equal(shot.clip.layout.type, "split", `${size} was not framed`);
    if (shot.clip.layout.type !== "split") continue;
    assert.deepEqual(shot.clip.layout.bottom, expected, `${size}: the camera rectangle is in that recording's own pixels`);
    // The output is the template's, whatever the source was shot at.
    assert.equal(store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.output.fps, 30);
  }
});

test("a transcript of one word, and a shot of one frame, are planned without anything dividing by zero", async () => {
  const { id, sequenceId } = await project(source, [{ t: 0.2, d: 0.3, w: "hola" }], 4);
  const plan = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "edge-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(plan.totals.sentences, 1);
  assert.equal(plan.totals.silences, 0, "one word has no gap in it");
  assert.ok(plan.hook, "and the hook is whatever the shot says");
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "edge-split", sequenceId, expectedRevision: store.readEditor(id).revision });

  // A word with no duration is refused at the door rather than dividing by zero later.
  await assert.rejects(project(source, [{ t: 1, d: 0, w: "uno" }], 6), /positive duration/);
  await assert.rejects(project(source, [{ t: -1, d: 0.2, w: "uno" }], 6), /nonnegative/);
  // Words out of order are not a crash: the planner reads what it was given.
  const odd = await project(source, [{ t: 1, d: 0.2, w: "uno" }, { t: 0.5, d: 0.2, w: "dos" }, { t: 3, d: 0.2, w: "tres" }], 6);
  const oddPlan = await tools.executeEditorTool(odd.id, { tool: "template.plan", templateId: "edge-split", sequenceId: odd.sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(oddPlan.totals.sentences >= 1);
  assert.ok(oddPlan.items.every((item) => item.silences.every((cut) => cut.d > 0 && cut.t >= 0)), "no cut of negative length");
});

test("a hook that is an emoji, a hook with newlines, and a hook of one word", () => {
  assert.deepEqual(planner.shortenHook("🚀", 10), { text: "🚀", shortened: false });
  assert.deepEqual(planner.shortenHook("Una\nlínea\nrota", 10), { text: "Una línea rota", shortened: false });
  assert.deepEqual(planner.shortenHook("   ", 10), { text: "", shortened: false });
  assert.deepEqual(planner.shortenHook("¿Sí?", 1), { text: "¿Sí?", shortened: false });
  // Punctuation alone is not a sentence to cut at, and does not become an ellipsis on its own.
  const marks = planner.shortenHook("... ... ... ... ... ... ... ... ... ... ... ...", 3);
  assert.ok(marks.text.length > 0 && !marks.text.includes("undefined"));
});

test("a rule that points at something that is not there says which one", async () => {
  const card = await endCard("gone-card.mp4");
  await rules.saveRule({ id: "missing-template", name: "Missing template", when: "always", then: { template: "no-such-template" } });
  const { id, sequenceId } = await project();
  await assert.rejects(
    tools.executeEditorTool(id, { tool: "rules.apply", ruleIds: ["missing-template"], sequenceId, expectedRevision: store.readEditor(id).revision }),
    /no-such-template/,
  );

  await rules.saveRule({ id: "gone-card", name: "Gone card", when: "always",
    then: { template: "long-end", slots: { endcard: { assetId: card.id } } } });
  database.q.deleteAsset(card.id);
  await assert.rejects(
    tools.executeEditorTool(id, { tool: "rules.apply", ruleIds: ["gone-card"], sequenceId, expectedRevision: store.readEditor(id).revision }),
    new RegExp(card.id),
    "the error names the asset that is gone, not just 'not found'",
  );

  // A slot the template does not declare is ignored rather than fatal: a rule may be
  // written for a template it is only sometimes applied with.
  await rules.saveRule({ id: "stray-slot", name: "Stray slot", when: "always",
    then: { template: "edge-split", slots: { nothing: { text: "unused" } } } });
  const applied = await tools.executeEditorTool(id, { tool: "rules.apply", ruleIds: ["stray-slot"], sequenceId, expectedRevision: store.readEditor(id).revision }) as import("../src/lib/rules/apply").RuleApplyResult;
  assert.ok(applied.applied, "the rule still edited the video");
});

test("a disabled rule is not applied, and a rule that only fills a slot for a template with none changes nothing on the timeline", async () => {
  const { id, sequenceId } = await project();
  await rules.saveRule({ id: "switched-off", name: "Off", when: "always", enabled: false, then: { template: "edge-split" } });
  const result = await tools.executeEditorTool(id, { tool: "rules.apply", ruleIds: ["switched-off", "stray-slot"], sequenceId, expectedRevision: store.readEditor(id).revision }) as import("../src/lib/rules/apply").RuleApplyResult;
  assert.deepEqual(result.ignored, ["switched-off"]);
  assert.equal(result.templateId, "edge-split", "the rule that is still on decides");
});

test("a template applied to a video with no footage at all leaves the framing alone and still captions it", async () => {
  const { id } = await mediaService.createVideoProject("Canvas only", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.remove", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id },
    { type: "item.add", sequenceId, item: { id: "i_scene", mediaId: null, layer: 0,
      clip: { id: "i_scene", title: "Escena", start: 0, end: 8, words: speak(SCRIPT) } } },
  ] });
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "edge-split", sequenceId, expectedRevision: store.readEditor(id).revision });
  const scene = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === "i_scene")!;
  assert.equal(scene.clip.layout.type, "crop", "there is nothing to split");
  assert.equal(scene.clip.captions.preset, "popline", "but the words are still captioned in the template's style");
  assert.ok(scene.clip.edits.some((e) => e.type === "silence"), "and its dead air is still cut");
});

test("two videos in one project each get their own framing, hook and card", async () => {
  const card = await endCard("both-card.mp4");
  const { id } = await mediaService.createVideoProject("Two videos", [{ file: source }]);
  const first = store.readEditor(id);
  const firstSeq = first.edl.sequences[0].id;
  store.editProject(id, { expectedRevision: first.revision, operations: [
    { type: "item.patch", sequenceId: firstSeq, itemId: first.edl.sequences[0].items[0].id,
      patch: { title: "Uno", hook: "El primero", start: 0, end: 8, words: speak(SCRIPT) } },
    { type: "sequence.add", sequence: { id: "s_second", title: "Dos", output: { width: 1080, height: 1920, fps: 30 },
      items: [{ id: "i_second", mediaId: first.edl.media[0].id, layer: 0,
        clip: { id: "i_second", title: "Dos", hook: "El segundo", start: 8, end: 16, words: speak(SCRIPT).map((w) => ({ ...w, t: w.t })) } }] } },
  ] });

  for (const sequenceId of [firstSeq, "s_second"]) {
    await tools.executeEditorTool(id, { tool: "template.apply", templateId: "long-end", sequenceId,
      expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } });
  }
  const edl = store.readEditor(id).edl;
  for (const sequenceId of [firstSeq, "s_second"]) {
    const sequence = edl.sequences.find((s) => s.id === sequenceId)!;
    assert.ok(sequence.items.some((i) => i.clip.title === "Outro"), `${sequenceId} ends on the card`);
    assert.ok(sequence.items.some((i) => i.clip.title === "Hook"), `${sequenceId} carries its own hook`);
    assert.ok(sequence.items.some((i) => i.mediaId && i.clip.layout.type === "split"), `${sequenceId} is framed`);
  }
  assert.equal(edl.media.length, 2, "the card is one media entry for the whole project, not one per video");
  const hooks = edl.sequences.flatMap((s) => s.items.filter((i) => i.clip.title === "Hook").flatMap((i) => i.clip.edits.filter((e) => e.type === "text").map((e) => e.text)));
  assert.deepEqual(hooks, ["El primero", "El segundo"], "each video's own hook, not the first one twice");
});

test("a file name is never the hook, and a video with no hook at all says so", async () => {
  // Exactly a fresh import: the timeline is "Main video" and the shot is the file.
  const { id } = await mediaService.createVideoProject("Raw import", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequenceId = snapshot.edl.sequences[0].id;
  // Exactly what an import looks like before anyone has written anything: the shot is
  // called after the file it came from.
  assert.match(snapshot.edl.sequences[0].items[0].clip.title, /\.mp4$/);
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.patch", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id, patch: { start: 0, end: 8, words: speak(SCRIPT) } },
  ] });

  const bare = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "edge-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(bare.hook, null, "a file name is not held on screen for the whole video");
  assert.ok(bare.warnings.some((w) => w.includes("no hook line")), bare.warnings.join(" | "));

  // A hook written on the shot, or handed in with the request, is used as it always was.
  const asked = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "edge-split", sequenceId, hookText: "¿Y si nadie lo dice?" }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(asked.hook?.text, "¿Y si nadie lo dice?");
  assert.ok(!asked.warnings.some((w) => w.includes("no hook line")));

  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.patch", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id, patch: { hook: "Lo que nadie te dice" } },
  ] });
  const written = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "edge-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(written.hook?.text, "Lo que nadie te dice");

  // A timeline someone has actually named is a hook again.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.patch", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id, patch: { hook: "" } },
    { type: "sequence.patch", sequenceId, title: "Lo que aprendí del bug" },
  ] });
  const named = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "edge-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(named.hook?.text, "Lo que aprendí del bug");

  // And a title that merely contains a dot is still a title.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.patch", sequenceId, itemId: snapshot.edl.sequences[0].items[0].id, patch: { hook: "", title: "Next.js y el editor" } },
  ] });
  const dotted = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "edge-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(dotted.hook?.text, "Next.js y el editor");
});

test("a plan that names a rule brings the rule's inputs with it, not only its overrides", async () => {
  const card = await endCard("plan-card.mp4");
  await registry.saveTemplate({ id: "plan-short", extends: "stream-short", name: "Plan short",
    outro: { enabled: true, slot: "endcard" }, ...STREAM_OVERRIDES });
  await rules.saveRule({ id: "plan-outro", name: "Plan outro", when: "the clip is from a stream", stage: "edit",
    then: { template: "plan-short", slots: { endcard: { assetId: card.id } }, overrides: { hook: { mode: "sticky" } } } });

  const { id, sequenceId } = await project();
  // The plan names the rule, the way the home screen writes it — and nothing else.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "plan.patch", patch: { rules: ["plan-outro"] } },
  ] });
  const applied = await tools.executeEditorTool(id, { tool: "plan.apply", sequenceId, expectedRevision: store.readEditor(id).revision }) as { templateId: string };
  assert.equal(applied.templateId, "plan-short");
  const sequence = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const outro = sequence.items.find((i) => i.clip.title === "Outro");
  assert.ok(outro, "the rule's end card is on the timeline, not silently left off");
  assert.equal(store.readEditor(id).edl.media.find((m) => m.id === outro!.mediaId)!.file, assets.toAbs(card.path));
});

test("footage with no sound at all still takes the whole look, end card included", async () => {
  const silent = path.join(workspace, "silent.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0x203040:size=1728x1116:rate=15:duration=10",
    "-pix_fmt", "yuv420p", silent], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const card = await endCard("silent-card.mp4");
  await registry.saveTemplate({ id: "silent-ok", extends: "stream-short", name: "Silent ok",
    outro: { enabled: true, slot: "endcard" }, ...STREAM_OVERRIDES });

  const { id, sequenceId } = await project(silent, speak(SCRIPT), 8);
  const applied = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "silent-ok", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } }) as { plan: { framing: unknown } };
  assert.deepEqual(applied.plan.framing, { mode: "split", seam: 0.68, camera: "bottom" });

  const sequence = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const outro = sequence.items.find((i) => i.clip.title === "Outro")!;
  assert.ok(outro, "the end card is there");
  // Nothing to measure against, so the card plays as it was mixed rather than at a
  // gain computed from silence.
  assert.equal(outro.volume, undefined, "a video with no sound gives the card no level to meet");
  assert.ok(sequence.items.some((i) => i.mediaId && i.clip.layout.type === "split"), "and it is still framed");
});

test("switching a video from one template to another replaces the first one's work", async () => {
  const card = await endCard("switch-card.mp4");
  await registry.saveTemplate({ id: "look-a", extends: "stream-short", name: "Look A",
    captions: { preset: "popline", positionY: 0.6, maxWordsPerLine: 1 },
    outro: { enabled: true, slot: "endcard" }, ...STREAM_OVERRIDES });
  await registry.saveTemplate({ id: "look-b", extends: "stream-short", name: "Look B",
    captions: { preset: "karaoke", positionY: 0.8, maxWordsPerLine: 3, uppercase: true },
    hook: { mode: "off" }, outro: { enabled: false },
    layout: { mode: "split", cameraPosition: "top", cameraPct: 40, camera: STREAM_OVERRIDES.layout.camera, screen: STREAM_OVERRIDES.layout.screen } });

  const { id, sequenceId, itemId } = await project();
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "look-a", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } });
  const first = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  assert.ok(first.items.some((i) => i.clip.title === "Hook"));
  assert.ok(first.items.some((i) => i.clip.title === "Outro"));

  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "look-b", sequenceId, expectedRevision: store.readEditor(id).revision });
  const second = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const shot = second.items.find((i) => i.id === itemId)!;
  assert.equal(shot.clip.captions.preset, "karaoke", "the new look's captions");
  assert.equal(shot.clip.captions.positionY, 0.8);
  assert.ok(shot.clip.layout.type === "split" && shot.clip.layout.camera === "top" && shot.clip.layout.topPct === 40, "the new look's framing");
  assert.ok(!second.items.some((i) => i.clip.title === "Hook"), "the first template's hook went with it");
  assert.ok(!second.items.some((i) => i.clip.title === "Outro"), "and so did its end card");
  assert.ok(shot.clip.edits.every((e) => !e.by.startsWith("template:look-a")), "no edit of the first template is left");
  assert.ok(shot.clip.edits.some((e) => e.by.startsWith("template:look-b")), "and the second wrote its own");
});

test("a video recorded quietly is placed at the loudness the template asks for, and the card follows it there", async () => {
  const quiet = path.join(workspace, "quiet-stream.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=15:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=1000:duration=10", "-af", "volume=0.5", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", quiet], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const card = await endCard("level-card.mp4");

  const { loudness } = await import("../src/lib/media");
  const before = await loudness(quiet);
  assert.ok(before !== null && before < -17, `the footage is quiet to begin with: ${before}`);

  await registry.saveTemplate({ id: "levelled-stream", extends: "stream-short", name: "Levelled stream",
    // A target this material can actually reach: a shot's volume is bounded at twice,
    // and these tones are further from the target than a stream's speech ever is.
    audio: { targetLufs: -22 }, outro: { enabled: true, slot: "endcard" }, ...STREAM_OVERRIDES });
  const { id, sequenceId, itemId } = await project(quiet, speak(SCRIPT), 8);
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "levelled-stream", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } });

  const sequence = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const shot = sequence.items.find((i) => i.id === itemId)!;
  assert.ok(shot.volume !== undefined && shot.volume > 1, `the footage is turned up: ${shot.volume}`);
  const reached = before! + 20 * Math.log10(shot.volume!);
  assert.ok(Math.abs(reached - -22) < 1.5, `and lands near the target: ${reached.toFixed(1)} LUFS`);

  // The card is levelled against where the video now plays, not where it was recorded.
  const outro = sequence.items.find((i) => i.clip.title === "Outro")!;
  const cardLufs = await loudness(assets.toAbs(database.q.getAsset(card.id)!.path));
  const cardReached = cardLufs! + 20 * Math.log10(outro.volume ?? 1);
  assert.ok(Math.abs(cardReached - reached) < 1.5, `the card meets the video at ${cardReached.toFixed(1)} against ${reached.toFixed(1)}`);

  // Applying again changes nothing: the same footage measures the same.
  const settled = store.readEditor(id).revision;
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "levelled-stream", sequenceId,
    expectedRevision: settled, slots: { endcard: { assetId: card.id } } });
  const again = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
  assert.equal(again.volume, shot.volume, "the level converges rather than creeping up on every apply");

  // Footage too quiet to reach the target at all lands at the loudest the timeline
  // allows rather than at a number the editor would refuse.
  const whisper = path.join(workspace, "whisper.mp4");
  const quietly = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=15:duration=8",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=8", "-af", "volume=0.03", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", whisper], { encoding: "utf8" });
  assert.equal(quietly.status, 0, quietly.stderr);
  const { id: faint, sequenceId: faintSeq, itemId: faintItem } = await project(whisper, speak(SCRIPT), 8);
  await tools.executeEditorTool(faint, { tool: "template.apply", templateId: "levelled-stream", sequenceId: faintSeq,
    expectedRevision: store.readEditor(faint).revision, slots: { endcard: { assetId: card.id } } });
  assert.equal(store.readEditor(faint).edl.sequences.find((s) => s.id === faintSeq)!.items.find((i) => i.id === faintItem)!.volume, 2);

  // A template that names no target leaves the sound where it was recorded.
  await registry.saveTemplate({ id: "unlevelled", extends: "stream-short", name: "Unlevelled", audio: { targetLufs: null }, outro: { enabled: false }, ...STREAM_OVERRIDES });
  const { id: other, sequenceId: otherSeq, itemId: otherItem } = await project(quiet, speak(SCRIPT), 8);
  await tools.executeEditorTool(other, { tool: "template.apply", templateId: "unlevelled", sequenceId: otherSeq, expectedRevision: store.readEditor(other).revision });
  assert.equal(store.readEditor(other).edl.sequences.find((s) => s.id === otherSeq)!.items.find((i) => i.id === otherItem)!.volume, undefined);
});
