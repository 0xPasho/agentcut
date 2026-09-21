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
let logo: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let registry: typeof import("../src/lib/templates/registry");
let resolve: typeof import("../src/lib/templates/resolve");
let preview: typeof import("../src/lib/templates/preview");
let derive: typeof import("../src/lib/editor/derive");
let onboarding: typeof import("../src/lib/onboarding");

function speak(sentences: string[], gap = 0.5) {
  const words: Array<{ t: number; d: number; w: string }> = [];
  let t = 0;
  for (const sentence of sentences) { for (const word of sentence.split(/\s+/)) { words.push({ t, d: 0.34, w: word }); t += 0.4; } t += gap; }
  return words;
}
const SCRIPT = ["Google changed how ranking works this year.", "That is the part everyone keeps getting wrong.", "It took them about four years to ship it."];

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-m6-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, registry, resolve, preview, derive, onboarding] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"), import("../src/lib/db"),
    import("../src/lib/templates/registry"), import("../src/lib/templates/resolve"), import("../src/lib/templates/preview"), import("../src/lib/editor/derive"), import("../src/lib/onboarding"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([{ title: "Google", slug: "google", hex: "4285F4", aliases: [] }]));
  await brandIndex();
  source = path.join(workspace, "source.mp4");
  let result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=320x180:rate=15:duration=12", "-f", "lavfi", "-i", "sine=frequency=300:duration=12", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  logo = path.join(workspace, "logo.png");
  result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=red:size=200x200", "-frames:v", "1", logo], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

async function projectWithScript() {
  const { id } = await mediaService.createVideoProject("M6", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  const item = sequence.items[0];
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [{ type: "item.patch", sequenceId: sequence.id, itemId: item.id, patch: { title: "Ranking", hook: "How ranking works", start: 0, end: 12, words: speak(SCRIPT) } }] });
  return { id, sequenceId: sequence.id, itemId: item.id };
}

test("a template can extend another: the child is the parent with its few fields changed, stored sparse, and cycles are refused", async () => {
  await registry.saveTemplate({ id: "quiet-explainer", extends: "explainer-broll", name: "Quiet explainer", captions: { uppercase: false }, rhythm: { punch: { enabled: false } } });
  const child = await registry.getTemplate("quiet-explainer");
  const parent = await registry.getTemplate("explainer-broll");
  assert.equal(child.extends, "explainer-broll");
  assert.equal(child.captions.uppercase, false);
  assert.equal(child.captions.preset, "karaoke", "the parent's other caption fields flow through");
  assert.equal(child.rhythm.punch.enabled, false);
  assert.equal(child.rhythm.silence.enabled, parent.rhythm.silence.enabled);
  assert.deepEqual(child.images.sources, parent.images.sources);
  assert.equal(child.slots.length, parent.slots.length, "slots are inherited");
  const stored = JSON.parse(await fs.readFile(child.file!, "utf8"));
  assert.deepEqual(Object.keys(stored).sort(), ["captions", "extends", "id", "name", "rhythm"], "stored as the sparse patch");

  // Change the parent and the child follows; a grandchild follows both.
  await registry.saveTemplate({ ...parent, id: "explainer-broll", images: { ...parent.images, density: 0.9 } });
  assert.equal((await registry.getTemplate("quiet-explainer")).images.density, 0.9);
  await registry.saveTemplate({ id: "quieter", extends: "quiet-explainer", name: "Quieter", hook: { mode: "off" } });
  const grandchild = await registry.getTemplate("quieter");
  assert.equal(grandchild.hook.mode, "off"); assert.equal(grandchild.captions.uppercase, false); assert.equal(grandchild.images.density, 0.9);
  await assert.rejects(registry.saveTemplate({ id: "orphan", extends: "nope", name: "Orphan" }), /does not exist/);
  await fs.writeFile(path.join(workspace, "templates", "loop-a.json"), JSON.stringify({ id: "loop-a", extends: "loop-b", name: "A" }));
  await fs.writeFile(path.join(workspace, "templates", "loop-b.json"), JSON.stringify({ id: "loop-b", extends: "loop-a", name: "B" }));
  const listed = await registry.listTemplates();
  assert.ok(!listed.some((t) => t.id === "loop-a" || t.id === "loop-b"), "a cycle hides only the templates in it");
  assert.ok(listed.some((t) => t.id === "quieter"));
  await registry.deleteTemplate("explainer-broll");
});

test("resolving folds the caption look and the brand kit under the template's own fields, and the aspect variant over everything", () => {
  const { VideoTemplate } = require("../src/lib/templates/schema") as typeof import("../src/lib/templates/schema");
  const template = VideoTemplate.parse({
    id: "t", name: "T", captionLook: "clean-white", captions: { maxWordsPerLine: 2 },
    brand: { palette: { primary: "#ff0055", text: "#eeeeee", background: "#000000" }, fonts: { captions: "Space Grotesk" }, logo: { assetId: "a_logo" } },
    watermark: { enabled: true },
    variants: { "16:9": { captions: { positionY: 0.85 }, hook: { position: "bottom" } } },
  });
  const vertical = resolve.resolveTemplate(template, { aspect: "9:16" });
  assert.equal(vertical.captions.maxWordsPerLine, 2, "the template's own field wins");
  assert.equal(vertical.captions.uppercase, false, "the look supplies what the template did not set");
  assert.equal(vertical.captions.highlight, "#ff0055", "the brand's primary colour is the highlight");
  assert.equal(vertical.captions.color, "#eeeeee");
  assert.equal(vertical.captions.fontFamily, "Space Grotesk");
  assert.equal(vertical.watermark.assetId, "a_logo", "the brand logo is lent to the watermark");
  assert.equal(vertical.hook.position, "top");
  const wide = resolve.resolveTemplate(template, { aspect: "16:9" });
  assert.equal(wide.captions.positionY, 0.85); assert.equal(wide.hook.position, "bottom");
  assert.equal(wide.captions.highlight, "#ff0055", "the variant does not lose the brand");
  assert.equal(resolve.aspectOf({ width: 1080, height: 1920 }), "9:16");
  assert.equal(resolve.aspectOf({ width: 1920, height: 1080 }), "16:9");
  assert.equal(resolve.aspectOf({ width: 1000, height: 1000 }), "1:1");
  assert.equal(resolve.aspectOf({ width: 320, height: 180 }), "16:9");
  assert.throws(() => resolve.resolveTemplate(VideoTemplate.parse({ id: "x", name: "X", captionLook: "nope" })), /Unknown caption look/);
  const svg = preview.templatePreviewSvg(template, "9:16");
  assert.match(svg, /^<svg /); assert.match(svg, /#ff0055/); assert.match(svg, /HOOK/);
  assert.ok(preview.templatePreviewSvg(template, "16:9").includes('width="640"'));
});

test("an intro and an outro are placed on the main track from image slots, shift the video, and converge on re-apply", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  const { registerAsset } = await import("../src/lib/assets");
  const asset = await registerAsset({ file: logo, scope: "project", projectId: id, source: "test" });
  await registry.saveTemplate({ id: "bookended", extends: "talking-head", name: "Bookended", intro: { enabled: true, slot: "cover", seconds: 1.5 }, outro: { enabled: true, assetId: asset.id, seconds: 2 },
    slots: [{ id: "cover", label: "Cover", kind: "image" }] });
  const before = store.readEditor(id);
  const first = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "bookended", sequenceId, expectedRevision: before.revision, slots: { cover: { assetId: asset.id } } }) as { revision: number };
  let sequence = store.readEditor(id).edl.sequences[0];
  const titles = sequence.items.filter((i) => (i.layer ?? 0) === 0).map((i) => i.clip.title);
  assert.deepEqual(titles, ["Intro", "Ranking", "Outro"], "the intro leads and the outro closes the main track");
  const { sequenceFrames } = await import("../src/lib/sequences");
  const resolved = sequenceFrames(sequence).items;
  const start = (title: string) => resolved.find((r) => r.item.clip.title === title)!.from / sequence.output.fps;
  assert.ok(Math.abs(start("Ranking") - 1.5) < 0.05, `the shot moved to make room: ${start("Ranking")}`);
  // The template cuts dead air, so the shot runs shorter than its 12 source seconds; the outro follows whatever is left.
  assert.ok(start("Outro") > start("Ranking") + 9 && start("Outro") < 13.6, `the outro follows the shot: ${start("Outro")}`);
  const intro = sequence.items.find((i) => i.clip.title === "Intro")!;
  assert.equal(intro.clip.edits[0].by, "template:bookended");
  assert.equal((intro.clip.edits[0] as { widthPct: number }).widthPct, 100);
  const hook = sequence.items.find((i) => i.clip.title === "Hook")!;
  assert.ok(hook && (hook.at ?? 0) === 0, "the hook still opens the video");

  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "bookended", sequenceId, expectedRevision: first.revision, slots: { cover: { assetId: asset.id } } });
  sequence = store.readEditor(id).edl.sequences[0];
  assert.equal(sequence.items.filter((i) => i.clip.title === "Intro").length, 1, "re-applying does not stack intros");
  assert.equal(sequence.items.filter((i) => i.clip.title === "Outro").length, 1);
  assert.ok(sequence.items.some((i) => i.id === itemId));
});

test("a derived sequence is a full editable copy in another aspect, recentred, linked to its original, pending", async () => {
  const { id, sequenceId } = await projectWithScript();
  const before = store.readEditor(id);
  store.editProject(id, { expectedRevision: before.revision, operations: [{ type: "item.patch", sequenceId, itemId: before.edl.sequences[0].items[0].id, patch: { crop: [{ t: 0, x: 0, y: 0, w: 101, h: 180 }] } }, { type: "sequence.plan.patch", sequenceId, patch: { template: "talking-head", status: "approved", summary: "Ranking" } }] });
  const result = await tools.executeEditorTool(id, { tool: "sequence.derive", sequenceId, aspect: "16:9", expectedRevision: store.readEditor(id).revision }) as { sequenceId: string; output: { width: number; height: number } };
  assert.deepEqual(result.output, { width: 1920, height: 1080 });
  const edl = store.readEditor(id).edl;
  const copy = edl.sequences.find((s) => s.id === result.sequenceId)!;
  assert.equal(copy.title, "Ranking (16:9)".replace("Ranking", edl.sequences[0].title));
  assert.equal(copy.output.width, 1920);
  assert.equal(copy.items.length, 1);
  assert.notEqual(copy.items[0].id, edl.sequences[0].items[0].id, "items get their own ids");
  assert.equal(copy.items[0].clip.crop[0].w, 320, "the crop is recentred for the wide frame");
  assert.equal(copy.plan.template, "talking-head");
  assert.equal(copy.plan.status, "pending", "a derived video waits for approval on its own");
  assert.equal(copy.plan.summary, "Ranking");
  assert.match(copy.plan.reasons.derivedFrom, new RegExp(`^${sequenceId} as 16:9$`));
  assert.equal(edl.sequences[0].plan.status, "approved", "the original is untouched");
  await assert.rejects(derive.deriveSequence(id, { sequenceId, aspect: "1:1" }, before.revision), store.RevisionConflict);
});

test("onboarding turns answers into preferences and glossary entries, once, and can be skipped instead", async () => {
  const state = await onboarding.onboardingState();
  assert.equal(state.status, "pending");
  assert.equal(state.done, false);
  assert.equal(state.hasPreferences, false);
  await assert.rejects(onboarding.runOnboarding({ who: "  " }, { runner: { id: "t", label: "t", available: async () => true, run: async () => ({ provider: "t", text: "", events: [], durationMs: 1 }) } }), /Answer at least one/);
  let answers: unknown = null;
  const runner: AgentProvider = { id: "test", label: "Test", available: async () => true, run: async (o) => {
    answers = JSON.parse(await fs.readFile(path.join(o.cwd, "answers.json"), "utf8"));
    await fs.writeFile(path.join(o.cwd, "profile.json"), JSON.stringify({ preferences: "- Hooks under three seconds.\n- Music under the voice.", glossary: [{ term: "Deska", aliases: [], note: "the app" }] }));
    return { provider: "test", text: "DONE", events: [], durationMs: 1 };
  } };
  const result = await onboarding.runOnboarding({ who: "Coding streams for junior devs", names: "Deska" }, { runner });
  assert.equal((answers as unknown[]).length, 2);
  assert.match(result.preferences, /Hooks under three seconds/);
  assert.equal(result.glossary[0].term, "Deska");
  const { readGlossary } = await import("../src/lib/glossary");
  assert.ok((await readGlossary()).terms.some((t) => t.term === "Deska"));
  const finished = await onboarding.onboardingState();
  assert.equal(finished.status, "done");
  assert.equal(finished.hasPreferences, true);
  // Without any agent the answers are kept verbatim rather than lost.
  const { savePreferences } = await import("../src/lib/preferences");
  await savePreferences("", "workspace");
  const broken: AgentProvider = { ...runner, run: async () => { throw new Error("no CLI"); } };
  await assert.rejects(onboarding.runOnboarding({ who: "x" }, { runner: broken }));
  // A skip ends the asking without pretending the interview was answered: it stays
  // reachable, which is what lets the Library and the agent offer it again.
  await onboarding.skipOnboarding();
  const skipped = await onboarding.onboardingState();
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.done, false);
});
