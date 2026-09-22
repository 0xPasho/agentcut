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

test("a single peak in quiet footage is not a reason to make the whole video quieter", async () => {
  // A stream mixed low with one full-scale sample in it: a mouse click, a cough, a sting.
  // Loudness is gated and integrated, so the click does not move the reading — but it does
  // fill the headroom, and headroom is a ceiling on turning a video up, not a reason to
  // turn one down.
  const clicked = path.join(workspace, "clicked.mp4");
  const tone = "0.05*sin(2*PI*1000*t)+gt(t\\,5)*lt(t\\,5.01)*0.95*sin(2*PI*2000*t)";
  const made = spawnSync(FFMPEG, ["-y",
    "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=15:duration=10",
    "-f", "lavfi", "-i", `aevalsrc=${tone}:d=10`,
    "-map", "0:v", "-map", "1:a", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", clicked], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);

  const { loudness, audioLevel } = await import("../src/lib/media");
  const [measured, peaks] = await Promise.all([loudness(clicked), audioLevel(clicked)]);
  assert.ok(measured !== null && measured < -25, `the footage is quiet: ${measured}`);
  assert.ok(peaks !== null && peaks.maxDb > -1.5, `and it peaks at full scale anyway: ${peaks?.maxDb}`);

  const { targetLevel } = await import("../src/lib/templates/apply");
  const template = (await import("../src/lib/templates/resolve")).resolveTemplate(
    await registry.getTemplate("stream-short"), { aspect: "9:16" });
  // The click fills the headroom, so this material cannot be turned up: reaching the
  // target would mean limiting it. What it must never do is be turned *down* — the
  // template asked for louder, and a single sample is not a reason to deliver quieter.
  const level = await targetLevel({ ...template, audio: { targetLufs: -22 } },
    { file: clicked, start: 0, duration: 10 });
  assert.ok(level === null || level.gain >= 1,
    `asked for louder, so never quieter: ${level ? `${level.gain} → ${level.lufs}` : "left alone"}`);

  // The same footage without the click is turned up, which is what says the click is
  // the only thing standing between it and the target.
  const clean = path.join(workspace, "unclicked.mp4");
  const quietly = spawnSync(FFMPEG, ["-y",
    "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=15:duration=10",
    "-f", "lavfi", "-i", "aevalsrc=0.05*sin(2*PI*1000*t):d=10",
    "-map", "0:v", "-map", "1:a", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", clean], { encoding: "utf8" });
  assert.equal(quietly.status, 0, quietly.stderr);
  const raised = await targetLevel({ ...template, audio: { targetLufs: -22 } }, { file: clean, start: 0, duration: 10 });
  assert.ok(raised && raised.gain > 1, `without the click it reaches for the target: ${raised?.gain}`);
  assert.ok(raised!.lufs > measured!, `and says where it now plays: ${raised!.lufs.toFixed(1)}`);
});

test("the loudness is read off the video, not off the card somebody put in front of it", async () => {
  const card = await endCard("intro-card.mp4");
  await registry.saveTemplate({ id: "opened", extends: "stream-short", name: "Opened",
    audio: { targetLufs: -22 }, intro: { enabled: true, slot: "opencard" }, outro: { enabled: false },
    slots: [{ id: "opencard", kind: "video", label: "Opening card" }], ...STREAM_OVERRIDES });

  const quiet = path.join(workspace, "opened-stream.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=15:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=1000:duration=10", "-af", "volume=0.35", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", quiet], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);

  const { id, sequenceId, itemId } = await project(quiet, speak(SCRIPT), 8);
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "opened", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { opencard: { assetId: card.id } } });
  const first = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const opening = first.items.find((i) => i.clip.title === "Intro");
  assert.ok(opening, "the card is on the front of the video");
  const levelled = first.items.find((i) => i.id === itemId)!.volume;
  assert.ok(levelled !== undefined && levelled > 1, `the quiet footage was turned up: ${levelled}`);

  // The second apply now has the card as the first shot with footage in it. What it
  // measures must still be the video: measuring the card would level the whole timeline
  // to a green 480x854 sting.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "opened", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { opencard: { assetId: card.id } } });
  const again = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
  assert.equal(again.volume, levelled, "the level converges on the video's own loudness");
});

test("a shot with a volume fade takes the rest of the template instead of throwing it away", async () => {
  const card = await endCard("fade-card.mp4");
  await registry.saveTemplate({ id: "faded", extends: "stream-short", name: "Faded",
    audio: { targetLufs: -22 }, outro: { enabled: true, slot: "endcard" }, ...STREAM_OVERRIDES });
  const quiet = path.join(workspace, "faded-stream.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=15:duration=10",
    "-f", "lavfi", "-i", "sine=frequency=1000:duration=10", "-af", "volume=0.35", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", quiet], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);

  const { id, sequenceId, itemId } = await project(quiet, speak(SCRIPT), 8);
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.keyframes", sequenceId, itemId, keyframes: [{ t: 0, volume: 0 }, { t: 1.5, volume: 1 }] },
  ] });

  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "faded", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } });
  const sequence = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const shot = sequence.items.find((i) => i.id === itemId)!;
  assert.equal(shot.keyframes?.length, 2, "the fade somebody drew is still theirs");
  assert.ok(sequence.items.some((i) => i.clip.title === "Outro"), "and the card still went on the end");
  assert.ok(shot.clip.layout.type === "split", "and the framing still happened");
});

test("a split template with no camera rectangle is refused before it imports anything", async () => {
  await registry.saveTemplate({ id: "no-camera", extends: "stream-short", name: "No camera",
    layout: { camera: { x: 0, y: 0, w: 0, h: 0 }, screen: { x: 0, y: 0, w: 0.69, h: 1 } } });
  const { id, sequenceId } = await project();
  const before = store.readEditor(id).revision;
  await assert.rejects(
    () => tools.executeEditorTool(id, { tool: "template.apply", templateId: "no-camera", sequenceId, expectedRevision: before }),
    /camera rectangle/i);
  assert.equal(store.readEditor(id).revision, before, "and the project is exactly as it was");
});

test("the seam check reads the captions of the shot that has words, not of the card in front of it", async () => {
  // A split template that says where the captions go and nothing about their look: the
  // preset then comes from the shot. Read off the wrong shot — a card, an untranscribed
  // clip — it reads "none" and the whole check goes quiet.
  await registry.saveTemplate({ id: "bare-split", name: "Bare split",
    layout: { mode: "split", cameraPosition: "bottom", cameraPct: 32,
      screen: { x: 0, y: 0, w: 0.69, h: 1 }, camera: { x: 0.69, y: 0.72, w: 0.31, h: 0.28 } },
    captions: { positionY: 0.85, fontSizePct: 5, maxWordsPerLine: 1 } });

  const { id, sequenceId, itemId } = await project();
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences.find((s) => s.id === sequenceId)!;
  const media = sequence.items.find((i) => i.id === itemId)!.mediaId!;
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.patch", sequenceId, itemId, patch: { captions: { preset: "popline", positionY: 0.85, fontSizePct: 5, maxWordsPerLine: 1 } } },
  ] });
  // A silent shot with no words and no captions, placed in front of the one that speaks.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.add", sequenceId, index: 0, item: { id: "i_sting", mediaId: media, clip: { id: "c_sting", title: "Sting", start: 0, end: 2, captions: { preset: "none" } } } },
  ] });

  const dry = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "bare-split", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(dry.warnings.some((w) => w.includes("over the person")), dry.warnings.join(" | "));
});

test("an end card somebody pinned is not cut in half by the next apply", async () => {
  const card = await endCard("pinned-card.mp4");
  await registry.saveTemplate({ id: "pinnable", extends: "stream-short", name: "Pinnable",
    outro: { enabled: true, slot: "endcard" }, ...STREAM_OVERRIDES });
  const { id, sequenceId } = await project();
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "pinnable", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } });

  const placed = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const outro = placed.items.find((i) => i.clip.title === "Outro")!;
  assert.equal(outro.clip.layout.type, "crop", "the card was never framed as a screen share");
  // Pinning it makes it the person's, and the template stops owning it.
  const { sequenceFrames } = await import("../src/lib/sequences");
  const at = sequenceFrames(placed).items.find((e) => e.item.id === outro.id)!.from / placed.output.fps;
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.place", sequenceId, itemId: outro.id, patch: { at } },
  ] });
  assert.equal(planner.templateItemState(store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === outro.id)!), "moved");

  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "pinnable", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { endcard: { assetId: card.id } } });
  const after = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === outro.id)!;
  assert.equal(after.clip.layout.type, "crop", "and it is still a card, not two arbitrary halves of one");
});

test("a hook somebody typed is used as typed, even when it looks like a file name", async () => {
  await registry.saveTemplate({ id: "hooked", extends: "stream-short", name: "Hooked", ...STREAM_OVERRIDES });
  const { id, sequenceId } = await project();
  for (const written of ["main video", "dia-169.mp4"]) {
    const dry = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "hooked", sequenceId, hookText: written }) as import("../src/lib/templates/plan").TemplatePlan;
    assert.equal(dry.hook?.text, written, `the line the author wrote is the hook: ${written}`);
    assert.ok(!dry.warnings.some((w) => w.toLowerCase().includes("hook")), dry.warnings.join(" | "));
  }
});

test("how wide a line is, decided without measuring it", async () => {
  const { emWidth, fitScale, fitScaleAll, MIN_FIT } = await import("../src/lib/text-fit");

  // A rough width is enough, but it has to be rough in the safe direction: capitals and
  // wide letters cost more than an average one, thin ones less, and a CJK character a
  // whole em.
  assert.ok(emWidth("MMMM") > emWidth("iiii") * 2, "capitals are not the width of an i");
  assert.ok(emWidth("電気通信") > emWidth("abcd"), "a kanji is wider than a letter");
  assert.equal(emWidth(""), 0);

  // A line that fits is left alone, whatever the box.
  assert.equal(fitScale("corto", 12), 1);
  assert.equal(fitScale("", 12), 1);
  // One that does not is shrunk exactly enough to fit, and never past the floor.
  const box = 9;
  const long = "internacionalización";
  const scale = fitScale(long, box);
  assert.ok(scale < 1 && scale > MIN_FIT, `${scale}`);
  assert.ok(emWidth(long) * scale <= box, "and what comes out fits the box it was given");
  assert.equal(fitScale("x".repeat(400), box), MIN_FIT, "a word nothing could shrink into the box stops at the floor");
  // A box with no room at all is not a division by zero.
  assert.equal(fitScale("hola", 0), 1);
  assert.equal(fitScale("hola", -3), 1);

  // A caption line wraps between its words, so the widest one decides for all of them.
  assert.equal(fitScaleAll(["corto", long], box), fitScale(long, box));
  assert.equal(fitScaleAll([], box), 1);
});

test("three hundred transcripts, and nothing a template writes lands inside a word", async () => {
  // Real recordings are not tidy. These are: long pauses, none at all, words that touch,
  // a gap at the very start, a gap at the very end, a phrase said twice, a stumble. The
  // properties that have to hold on all of them are the ones that are invisible until an
  // export: a cut that eats a syllable, two cuts over each other, a cut off the end of
  // the clip, or a push-in left with no time to happen in.
  const { buildTimeMap, srcToOut } = await import("../src/lib/timeline");
  await registry.saveTemplate({ id: "cuts", extends: "stream-short", name: "Cuts", outro: { enabled: false }, ...STREAM_OVERRIDES });

  // A generator that repeats: a failure here is a failure anybody can run again.
  let seed = 20260922;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const VOCAB = ["hoy", "vamos", "a", "conectar", "el", "editor", "con", "agente", "porque", "eso",
    "es", "lo", "que", "nadie", "dice", "y", "entonces", "te", "atoras", "mira", "aquí", "está"];

  let cuts = 0, punches = 0, checked = 0;
  for (let run = 0; run < 300; run++) {
    const words: Array<{ t: number; d: number; w: string }> = [];
    let t = random() * 3; // sometimes silence before the first word, sometimes none
    const count = 6 + Math.floor(random() * 60);
    // The source is twenty seconds long, and a clip cannot run off the end of it.
    for (let i = 0; i < count && t < 16.5; i++) {
      const d = 0.08 + random() * 0.6;
      words.push({ t: Number(t.toFixed(3)), d: Number(d.toFixed(3)), w: pick(VOCAB) });
      // Touching words, ordinary breaths, and the long pause a stream is full of.
      const gap = random() < 0.25 ? 0 : random() < 0.75 ? random() * 0.5 : random() * 6;
      t += d + gap;
    }
    if (words.length < 6) continue;
    // A phrase said twice, which is what the redundancy pass is for.
    const last = words[words.length - 1];
    if (random() < 0.4 && words.length > 8 && last.t + last.d < 15) {
      const at = 2 + Math.floor(random() * (words.length - 6));
      const run3 = words.slice(at, at + 3).map((w) => w.w);
      let back = words[at + 3].t;
      const said = run3.map((w) => { const said = { t: Number(back.toFixed(3)), d: 0.25, w }; back += 0.3; return said; });
      words.splice(at + 3, 0, ...said);
      for (let i = at + 6; i < words.length; i++) words[i].t = Number((words[i].t + 0.9).toFixed(3));
    }
    const spoken = words[words.length - 1];
    const end = Number(Math.min(19.5, spoken.t + spoken.d + random() * 4).toFixed(3));
    if (end <= spoken.t + spoken.d) continue;

    for (let i = 1; i < words.length; i++)
      assert.ok(words[i].t >= words[i - 1].t + words[i - 1].d - 0.005,
        `run ${run}: the transcript itself is out of order at ${i}: "${words[i - 1].w}" ${words[i - 1].t}+${words[i - 1].d} then "${words[i].w}" ${words[i].t}`);
    const { id, sequenceId, itemId } = await project(source, words, end);
    await tools.executeEditorTool(id, { tool: "template.apply", templateId: "cuts", sequenceId,
      expectedRevision: store.readEditor(id).revision });
    const item = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.id === itemId)!;
    const clip = item.clip;
    const spans = clip.edits.filter((e) => e.type === "silence")
      .map((e) => ({ t: (e as { t: number }).t, d: (e as { d: number }).d }))
      .sort((a, b) => a.t - b.t);
    cuts += spans.length;

    const duration = clip.end - clip.start;
    for (const span of spans) {
      assert.ok(span.d > 0, `run ${run}: a cut of ${span.d}s`);
      assert.ok(span.t >= 0 && span.t + span.d <= duration + 0.001,
        `run ${run}: a cut at ${span.t}..${(span.t + span.d).toFixed(3)} of a ${duration}s clip`);
    }

    // The one thing a cut must never do: take half a word. Dead air is cut between
    // words and a false start is cut whole, so every word is either entirely there or
    // entirely gone — a cut through the middle of one is the syllable a viewer hears
    // disappear. Cuts may overlap each other, and the time map merges them, so this is
    // asked of the timeline they produce rather than of any one edit.
    const map = buildTimeMap(clip);
    const kept = (from: number, to: number) => map.spans.reduce((total, span) =>
      total + Math.max(0, Math.min(to, span.srcEnd) - Math.max(from, span.srcStart)), 0);
    for (const word of clip.words) {
      const left = kept(word.t, word.t + word.d);
      assert.ok(left < 0.02 || left > word.d - 0.02,
        `run ${run}: "${word.w}" at ${word.t} for ${word.d}s is half cut — ${left.toFixed(3)}s of it survives`);
    }

    // A push-in shortened by the cuts underneath it still has time to happen in: a
    // degenerate one crashed a real export with a non-monotonic interpolation range.
    for (const punch of clip.edits.filter((e) => e.type === "punch") as Array<{ t: number; d: number }>) {
      punches += 1;
      const from = srcToOut(map, punch.t), to = srcToOut(map, punch.t + punch.d);
      assert.ok(to >= from, `run ${run}: a push-in from ${from} to ${to} runs backwards`);
    }
    checked += 1;
    database.q.deleteProject(id);
  }
  assert.ok(checked > 250, `${checked} of the three hundred were usable transcripts`);
  assert.ok(cuts > 300, `the run has to actually cut something: ${cuts} cuts over ${checked} transcripts`);
  assert.ok(punches > 0, `and push in somewhere: ${punches}`);
});

test("a frame with an odd side is evened, because the encoder evens it either way", async () => {
  // h264 with 4:2:0 chroma cannot encode an odd side. The encoder rounds it down without
  // saying so, and the project then claims a frame it does not produce: every caption
  // position, seam and audit crop is computed against a number a pixel off the file.
  await registry.saveTemplate({ id: "odd-frame", extends: "stream-short", name: "Odd frame",
    output: { width: 1081, height: 1921, fps: 30 }, outro: { enabled: false }, ...STREAM_OVERRIDES });
  const { id, sequenceId } = await project();
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "odd-frame", sequenceId,
    expectedRevision: store.readEditor(id).revision });
  const output = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.output;
  assert.deepEqual({ width: output.width, height: output.height }, { width: 1080, height: 1920 });

  // Straight through the timeline too, which is the path a person's own output setting takes.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "sequence.patch", sequenceId, output: { width: 999, height: 1777, fps: 30 } },
  ] });
  const patched = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.output;
  assert.deepEqual({ width: patched.width, height: patched.height }, { width: 998, height: 1776 });

  // And a whole even frame is left exactly as it is.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "sequence.patch", sequenceId, output: { width: 1080, height: 1350, fps: 30 } },
  ] });
  const kept = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.output;
  assert.deepEqual({ width: kept.width, height: kept.height }, { width: 1080, height: 1350 });
});

test("a template that would extend itself the long way round is refused before it is written", async () => {
  // Discovered on the next read instead, a ring makes every template in it unreadable:
  // the app drops them from the list with a line on the console, and somebody who edited
  // one of their own templates finds both of them gone and no way back but a text editor.
  await registry.saveTemplate({ id: "uno", name: "Uno" });
  await registry.saveTemplate({ id: "dos", name: "Dos", extends: "uno" });
  await registry.saveTemplate({ id: "tres", name: "Tres", extends: "dos" });

  await assert.rejects(() => registry.saveTemplate({ id: "uno", name: "Uno", extends: "tres" }),
    /uno → tres → dos → uno/);
  await assert.rejects(() => registry.saveTemplate({ id: "uno", name: "Uno", extends: "uno" }), /extends itself/);
  await assert.rejects(() => registry.saveTemplate({ id: "cuatro", name: "Cuatro", extends: "nada" }), /does not exist/);

  // And all three are still there, still readable, still extending what they extended.
  const ids = (await registry.listTemplates()).map((t) => t.id);
  for (const id of ["uno", "dos", "tres"]) assert.ok(ids.includes(id), `${id} survived: ${ids.join(", ")}`);
  assert.equal((await registry.getTemplate("tres")).extends, "dos");

  // A chain that is not a ring still saves.
  await registry.saveTemplate({ id: "cuatro", name: "Cuatro", extends: "tres" });
  assert.equal((await registry.getTemplate("cuatro")).extends, "tres");
});

test("room noise the transcript talks over is reported, not quietly cut", async () => {
  const { deadAir, MIN_DEAD_SEC } = await import("../src/lib/templates/quiet");
  const step = 0.5;
  // Loud, then a hole, then loud: what a microphone left on sounds like.
  const envelope = Array.from({ length: 40 }, (_, i) => ({ t: i * step, db: i >= 10 && i < 20 ? -48 : -22 }));
  const clip = (words: Array<{ t: number; d: number; w: string }>) => ({ start: 0, end: 20, words });

  const spoken = [
    { t: 5.2, d: 0.6, w: "ey" }, { t: 6.0, d: 0.8, w: "¿cómo" }, { t: 7.0, d: 0.7, w: "que?" },
    { t: 8.0, d: 0.9, w: "¿ya" }, { t: 9.0, d: 0.8, w: "hay" },
  ];
  const [run] = deadAir(envelope, clip(spoken), step);
  assert.ok(run, "five seconds of room noise with words over it is worth saying");
  assert.ok(Math.abs(run.t - 5) < step + 0.01 && Math.abs(run.d - 5) < step * 2, `${run.t}..${run.t + run.d}`);
  assert.deepEqual(run.words, ["ey", "¿cómo", "que?", "¿ya", "hay"]);

  // The same hole with nothing claiming it is an ordinary pause: the dead-air pass
  // already cuts it, and saying so twice would be noise.
  assert.deepEqual(deadAir(envelope, clip([{ t: 1, d: 0.5, w: "hola" }, { t: 11, d: 0.5, w: "adiós" }]), step), []);
  // A breath is not a problem.
  const blink = Array.from({ length: 40 }, (_, i) => ({ t: i * step, db: i === 10 ? -48 : -22 }));
  assert.deepEqual(deadAir(blink, clip(spoken), step), []);
  assert.ok(MIN_DEAD_SEC > step, "a single reading can never be a run on its own");
  // Nothing to compare: a tone, a hold, silence throughout.
  assert.deepEqual(deadAir(Array.from({ length: 40 }, (_, i) => ({ t: i * step, db: -22 })), clip(spoken), step), []);
  assert.deepEqual(deadAir([], clip(spoken), step), []);
});

test("a dry run hears the hole in the footage before anything is rendered", async () => {
  // A recording that is loud, silent, then loud again, with a transcript that claims
  // somebody is talking the whole way — which is what a recogniser writes when it is
  // given a long silence and spreads the next phrase back across it.
  const holed = path.join(workspace, "holed.mp4");
  const tone = "0.35*sin(2*PI*220*t)*(lt(t\\,6)+gt(t\\,12))+0.002*sin(2*PI*3000*t)";
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0x102040:size=1728x1116:rate=15:duration=20",
    "-f", "lavfi", "-i", `aevalsrc=${tone}:d=20`,
    "-map", "0:v", "-map", "1:a", "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", holed], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);

  await registry.saveTemplate({ id: "holed", extends: "stream-short", name: "Holed", outro: { enabled: false }, ...STREAM_OVERRIDES });
  const words = Array.from({ length: 30 }, (_, i) => ({ t: 1 + i * 0.6, d: 0.45, w: `palabra${i}` }));
  const { id, sequenceId } = await project(holed, words, 19);
  const dry = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "holed", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  const said = dry.warnings.filter((w) => w.includes("room noise"));
  assert.equal(said.length, 1, dry.warnings.join(" | "));
  assert.match(said[0], /is room noise, but the transcript has \d+ words over it/);
  assert.match(said[0], /Trim the clip past it/);

  // And it is a warning, not an edit: the cuts are still the ones the transcript asked for.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "holed", sequenceId,
    expectedRevision: store.readEditor(id).revision });
  const clip = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.mediaId)!.clip;
  const { buildTimeMap } = await import("../src/lib/timeline");
  const map = buildTimeMap(clip);
  const kept = (w: { t: number; d: number }) => map.spans.reduce((total, span) =>
    total + Math.max(0, Math.min(w.t + w.d, span.srcEnd) - Math.max(w.t, span.srcStart)), 0);
  for (const word of clip.words) assert.ok(kept(word) > word.d - 0.02, `"${word.w}" was cut away by a warning`);
});
