import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

let workspace: string;
let source: string;
let screenshots: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let script: typeof import("../src/lib/templates/script");
let planner: typeof import("../src/lib/templates/plan");
let registry: typeof import("../src/lib/templates/registry");
let operations: typeof import("../src/lib/editor/operations");
let edlSchema: typeof import("../src/lib/edl");

/** Word-level timestamps for a script, one word every 0.4s with a gap between sentences. */
function speak(sentences: string[], gap = 0.5) {
  const words: Array<{ t: number; d: number; w: string }> = [];
  let t = 0;
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/)) {
      words.push({ t, d: 0.34, w: word });
      t += 0.4;
    }
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
  "Stripe reported ninety two percent growth last quarter.",
  "So the lesson here is simple enough.",
];

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-templates-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, script, planner, registry, operations, edlSchema] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"),
    import("../src/lib/db"), import("../src/lib/templates/script"), import("../src/lib/templates/plan"),
    import("../src/lib/templates/registry"), import("../src/lib/editor/operations"), import("../src/lib/edl"),
  ]);
  // Seed the brand cache so these tests never depend on a network round trip.
  const { brandIndex, resetBrandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([
    { title: "Google", slug: "google", hex: "4285F4", aliases: [] },
    { title: "Facebook", slug: "facebook", hex: "0866FF", aliases: [] },
    { title: "Nvidia", slug: "nvidia", hex: "76B900", aliases: [] },
    { title: "Stripe", slug: "stripe", hex: "635BFF", aliases: [] },
  ]));
  await brandIndex();

  source = path.join(workspace, "source.mp4");
  let result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=320x180:rate=15:duration=20",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  screenshots = path.join(workspace, "shots");
  await fs.mkdir(screenshots, { recursive: true });
  for (const [index, colour] of ["red", "green", "blue", "orange", "purple"].entries()) {
    result = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${colour}:size=200x200`, "-frames:v", "1",
      path.join(screenshots, `shot-${index + 1}.png`)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("sentences split on punctuation and pauses, and only the ones naming something score high", () => {
  const sentences = script.toSentences(speak(SCRIPT));
  assert.equal(sentences.length, SCRIPT.length);
  assert.equal(sentences[0].text, SCRIPT[0]);
  const analyses = script.analyzeSentences(sentences, new Map([
    [0, [{ text: "Google", slug: "google", hex: "4285F4" }]],
    [2, [{ text: "Facebook", slug: "facebook", hex: "0866FF" }]],
    [4, [{ text: "Nvidia", slug: "nvidia", hex: "76B900" }]],
    [6, [{ text: "Stripe", slug: "stripe", hex: "635BFF" }]],
  ]));
  for (const index of [0, 2, 4, 6]) assert.ok(analyses[index].salience >= 0.6, `sentence ${index} should be illustratable`);
  for (const index of [1, 3, 5, 7]) assert.ok(analyses[index].salience < 0.45, `sentence ${index} should be left bare`);
  assert.deepEqual(analyses[6].numbers, ["ninety", "two", "percent"]);
  assert.equal(analyses[0].subjects[0].brandSlug, "google");
});

test("a picture lands on some sentences, never two in a row, and never past the density ceiling", () => {
  const sentences = script.toSentences(speak(SCRIPT));
  const analyses = script.analyzeSentences(sentences, new Map([
    [0, [{ text: "Google", slug: "google", hex: "4285F4" }]],
    [2, [{ text: "Facebook", slug: "facebook", hex: "0866FF" }]],
    [4, [{ text: "Nvidia", slug: "nvidia", hex: "76B900" }]],
    [6, [{ text: "Stripe", slug: "stripe", hex: "635BFF" }]],
  ]));
  const images = { mode: "auto", density: 0.45, minGapSec: 2.5, minSentenceGap: 1, durationSec: 2.6,
    leadSec: 0.15, maxCount: 24, minSalience: 0.45, y: 0.3, x: null, widthPct: 76, style: "auto",
    caption: "none", sources: ["web"], pairBrands: true } as unknown as import("../src/lib/templates/schema").TemplateImages;
  const cues = script.selectImageCues(analyses, images, { clipDuration: 30 });
  assert.ok(cues.length >= 2 && cues.length <= Math.round(0.45 * SCRIPT.length));
  for (const cue of cues) assert.ok([0, 2, 4, 6].includes(cue.sentenceIndex), `unexpected sentence ${cue.sentenceIndex}`);
  for (let i = 1; i < cues.length; i++) {
    assert.ok(cues[i].sentenceIndex - cues[i - 1].sentenceIndex > 1, "two pictures landed on adjacent sentences");
    assert.ok(cues[i].t - cues[i - 1].t >= 2.5, "two pictures landed too close together");
  }
  assert.ok(cues.every((cue, i) => i === 0 || cue.t > cues[i - 1].t), "cues must be in time order");

  const off = script.selectImageCues(analyses, { ...images, mode: "off" }, { clipDuration: 30 });
  assert.equal(off.length, 0);
  const every = script.selectImageCues(analyses, { ...images, mode: "every", minSentenceGap: 0, minGapSec: 0, density: 1 }, { clipDuration: 30 });
  assert.equal(every.length, 4, "every mode illustrates each eligible sentence");
});

async function projectWithScript() {
  const { id } = await mediaService.createVideoProject("Template project", [{ file: source }]);
  const snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  const item = sequence.items[0];
  store.editProject(id, {
    expectedRevision: snapshot.revision,
    operations: [{ type: "item.patch", sequenceId: sequence.id, itemId: item.id,
      patch: { title: "Ranking", hook: "How ranking really works", start: 0, end: 20, words: speak(SCRIPT) } }],
  });
  return { id, sequenceId: sequence.id, itemId: item.id };
}

test("applying a template edits the project through the shared operations, from either transport", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  const before = store.readEditor(id);

  const plan = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "explainer-broll", sequenceId,
    overrides: { images: { sources: ["slot"] } }, slots: { screenshots: { folder: screenshots } },
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(plan.sequenceId, sequenceId);
  assert.equal(plan.hook?.text, "How ranking really works");
  assert.ok(plan.totals.images >= 2 && plan.totals.silences >= 1 && plan.totals.punches >= 1);

  const applied = await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId, expectedRevision: before.revision,
    overrides: { images: { sources: ["slot"] } }, slots: { screenshots: { folder: screenshots } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  assert.deepEqual(applied.applied.dropped, [], "every planned beat found a picture");
  assert.equal(applied.applied.images, plan.totals.images);
  assert.equal(applied.applied.placed, plan.totals.images);

  const after = store.readEditor(id);
  const sequence = after.edl.sequences.find(s => s.id === sequenceId)!;
  assert.deepEqual(sequence.output, { width: 1080, height: 1920, fps: 30 });
  const shot = sequence.items.find(i => i.id === itemId)!;
  assert.equal(shot.clip.captions.uppercase, true);
  assert.equal(shot.clip.captions.positionY, 0.7);
  const images = shot.clip.edits.filter(e => e.type === "image");
  assert.equal(images.length, plan.totals.images);
  assert.ok(shot.clip.edits.every(e => e.by === "template:explainer-broll"));
  assert.ok(images.every(e => e.src.startsWith("a_")), "pool pictures resolve to real asset ids");

  // The hook is its own canvas layer, so it stays put across every cut underneath it.
  const hook = sequence.items.find(i => i.mediaId === null && i.clip.title === "Hook")!;
  assert.ok(hook, "a sticky hook layer was added");
  assert.equal(hook.at, 0);
  assert.equal((hook.clip.edits[0] as { text: string }).text, "How ranking really works");
  assert.ok((hook.layer ?? 0) > (shot.layer ?? 0));
  const { sequenceFrames } = await import("../src/lib/sequences");
  assert.equal(Math.round(hook.clip.end * 30), sequenceFrames(sequence).duration, "a sticky hook spans the whole video");

  // The HTTP transport reaches the same tool with the same result.
  const { POST } = await import("../src/app/api/projects/[id]/editor/route");
  const response = await POST(new Request(`http://localhost/api/projects/${id}/editor`, {
    method: "POST", body: JSON.stringify({ tool: "template.plan", templateId: "talking-head", sequenceId }),
  }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).templateId, "talking-head");
});

test("re-applying replaces the template's own work and preserves hand edits", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  let snapshot = store.readEditor(id);
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "talking-head", sequenceId, expectedRevision: snapshot.revision });
  snapshot = store.readEditor(id);
  const first = snapshot.edl.sequences.find(s => s.id === sequenceId)!;
  const generated = first.items.find(i => i.id === itemId)!.clip.edits.length;
  assert.ok(generated > 0);

  // A person adds a title of their own, and a title layer of their own.
  const manualItemId = "i_manual";
  snapshot = store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.edit.add", sequenceId, itemId, edit: { type: "text", t: 1, d: 2, text: "Mine", position: "bottom", style: "plain", by: "" } },
    { type: "item.add", sequenceId, item: { id: manualItemId, mediaId: null, layer: 9, at: 0,
      clip: edlSchema.Clip.parse({ id: manualItemId, title: "My layer", start: 0, end: 2,
        edits: [{ type: "text", t: 0, d: 2, text: "Hand made", position: "center", style: "card" }] }) } },
  ] });

  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "explainer-broll", sequenceId,
    expectedRevision: snapshot.revision, overrides: { images: { sources: ["slot"] } },
    slots: { screenshots: { folder: screenshots } } });

  const after = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const shot = after.items.find(i => i.id === itemId)!;
  assert.equal(shot.clip.edits.filter(e => e.by === "").length, 1, "the hand-made edit survived");
  assert.equal((shot.clip.edits.find(e => e.by === "") as { text: string }).text, "Mine");
  assert.ok(shot.clip.edits.some(e => e.type === "image"), "the new template's pictures were added");
  assert.ok(shot.clip.edits.every(e => e.by === "" || e.by === "template:explainer-broll"), "the old template's edits were replaced");
  assert.ok(after.items.some(i => i.id === manualItemId), "the hand-made layer survived");
  assert.equal(after.items.filter(i => i.clip.title === "Hook").length, 1, "the previous hook layer was replaced, not duplicated");
});

test("user templates live in the workspace, override built-ins, and validate", async () => {
  const builtin = await registry.listTemplates();
  assert.ok(builtin.length >= 5 && builtin.every(t => t.builtin));
  assert.ok(builtin.some(t => t.id === "explainer-broll"));

  const saved = await registry.saveTemplate({
    id: "explainer-broll", name: "My explainer", description: "Denser pictures",
    images: { density: 0.8, sources: ["slot"] },
  });
  assert.equal(saved.builtin, false);
  assert.equal(saved.file, path.join(workspace, "templates", "explainer-broll.json"));
  const overridden = await registry.getTemplate("explainer-broll");
  assert.equal(overridden.name, "My explainer");
  assert.equal(overridden.images.density, 0.8);
  assert.equal((await registry.listTemplates()).filter(t => t.id === "explainer-broll").length, 1);

  await assert.rejects(registry.saveTemplate({ id: "Bad Id", name: "x" }), /lowercase/);
  await assert.rejects(registry.getTemplate("nope"), /Template not found/);
  await registry.deleteTemplate("explainer-broll");
  assert.equal((await registry.getTemplate("explainer-broll")).builtin, true);
});

test("overrides patch single fields and cannot change a template's identity", async () => {
  const template = await registry.getTemplate("explainer-broll");
  const merged = planner.mergeTemplate(template, { id: "hijacked", images: { density: 0.9 }, hook: { maxWords: 4 } });
  assert.equal(merged.id, "explainer-broll");
  assert.equal(merged.images.density, 0.9);
  assert.equal(merged.images.minSentenceGap, template.images.minSentenceGap, "untouched fields survive an override");
  assert.equal(merged.hook.maxWords, 4);
  assert.equal(merged.hook.mode, "sticky");
});

test("a template refuses an ambiguous target and reports a missing required slot", async () => {
  const { id, sequenceId } = await projectWithScript();
  const snapshot = store.readEditor(id);
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "sequence.add", sequence: { id: "s_second", title: "Second", output: { width: 1080, height: 1920, fps: 30 }, items: [] } },
  ] });
  await assert.rejects(
    tools.executeEditorTool(id, { tool: "template.plan", templateId: "talking-head" }),
    /several videos/);
  await assert.rejects(
    tools.executeEditorTool(id, { tool: "template.apply", templateId: "chat-story", sequenceId, expectedRevision: store.readEditor(id).revision }),
    /Screenshots folder/);
});

test("a template can illustrate from the footage itself, and pairs two brands named together", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  const snapshot = store.readEditor(id);
  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "product-demo", sequenceId, expectedRevision: snapshot.revision,
    // Frames only: a captured still needs no network, which is what makes this assertable offline.
    overrides: { images: { sources: ["frame"], mode: "auto", maxCount: 3 } },
  });
  const shot = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!.items.find(i => i.id === itemId)!;
  const captured = shot.clip.edits.filter(e => e.type === "image");
  assert.ok(captured.length >= 1, "a still was captured from the shot's own media");
  for (const image of captured) {
    const asset = database.q.getAsset(image.src)!;
    assert.equal(asset.source, "capture");
    await fs.access(path.join(workspace, asset.path));
  }

  // "Google and Facebook" is one beat with two subjects, which is what pairing needs.
  const { brandsInText } = await import("../src/lib/search/brand");
  const found = await brandsInText("Google and Facebook both shipped it.");
  assert.deepEqual(found.map(f => f.brand.slug), ["google", "facebook"]);
  const sentences = script.toSentences(speak(["Google and Facebook both shipped it."]));
  const analyses = script.analyzeSentences(sentences, new Map([[0, found.map(f => ({ text: f.match, slug: f.brand.slug, hex: f.brand.hex }))]]));
  assert.equal(analyses[0].subjects.filter(s => s.kind === "brand").length, 2);
  assert.ok(analyses[0].salience >= 0.65);
});

test("templates the agent reads are the templates the human sees", async () => {
  const listed = await tools.executeEditorTool("", { tool: "templates.list" }).catch(() => null);
  assert.equal(listed, null, "tools are project-scoped");
  const { id } = await projectWithScript();
  const viaTool = await tools.executeEditorTool(id, { tool: "templates.list" }) as Array<{ id: string }>;
  const viaRegistry = await registry.listTemplates();
  assert.deepEqual(viaTool.map(t => t.id), viaRegistry.map(t => t.id));
  const schema = await tools.executeEditorTool(id, { tool: "templates.schema" }) as { properties?: Record<string, unknown> };
  assert.ok(schema.properties?.images && schema.properties?.hook && schema.properties?.slots);
});

test("a transcript with no usable capitalisation still finds brands, and says what it cannot do", async () => {
  const { transcriptCasing, brandsInText } = await import("../src/lib/search/brand");
  const lower = SCRIPT.join(" ").toLowerCase();
  assert.equal(transcriptCasing(lower), "lower");
  assert.equal(transcriptCasing(SCRIPT.join(" ").toUpperCase()), "upper");
  assert.equal(transcriptCasing(SCRIPT.join(" ")), "mixed");

  // Capitalisation is gone, so names have to come from the brand index alone.
  assert.deepEqual((await brandsInText("google changed how ranking works", { casing: "lower" })).map(b => b.brand.slug), ["google"]);
  assert.deepEqual(await brandsInText("google changed how ranking works"), []);
  // ...but not at the cost of matching every ordinary word that happens to be a brand.
  assert.deepEqual(await brandsInText("you have to go and box it up", { casing: "lower" }), []);
  assert.deepEqual(script.entitiesIn("Google changed how Ranking works", "lower"), []);

  // Auto-captions arrive lowercase AND unpunctuated, so the only sentence boundary
  // left is the pause between them. This is what that actually looks like.
  const { id, sequenceId, itemId } = await projectWithScript();
  const spoken = speak(SCRIPT.slice(0, 5).map(line => line.toLowerCase().replace(/[.!?]/g, "")), 0.8);
  let snapshot = store.readEditor(id);
  snapshot = store.editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId,
    patch: { start: 0, end: Math.min(20, spoken.at(-1)!.t + 0.5), words: spoken },
  }] });
  const plan = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "explainer-broll", sequenceId,
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(plan.warnings.some(w => /no capitalisation/.test(w)), `expected a casing warning, got ${JSON.stringify(plan.warnings)}`);
  assert.ok(plan.totals.images >= 2, "the brand names were still found");
  const queries = plan.items[0].cues.map(c => c.query.toLowerCase());
  assert.ok(queries.every(q => ["google", "facebook", "nvidia", "stripe"].includes(q)), `unexpected subjects: ${queries}`);
});

test("a template's cards land where the structure says, and an unfilled one is simply absent", async () => {
  const { id, sequenceId } = await projectWithScript();
  const { sequenceFrames } = await import("../src/lib/sequences");
  let snapshot = store.readEditor(id);
  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "story-arc", sequenceId, expectedRevision: snapshot.revision,
    overrides: { images: { mode: "off" } },
    slots: { turn: { text: "But here is what actually happened" } },
  });
  let sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const duration = sequenceFrames(sequence).duration / sequence.output.fps;
  const turn = sequence.items.find(i => i.clip.title === "Card: turn")!;
  assert.ok(turn, "the mid-point card was placed");
  assert.equal((turn.clip.edits[0] as { text: string }).text, "But here is what actually happened");
  assert.ok(Math.abs((turn.at ?? 0) - duration * 0.45) < 0.1, `card at ${turn.at}, expected ~${duration * 0.45}`);
  assert.ok(Math.abs(turn.clip.end - 1.8) < 0.01);
  assert.ok(!sequence.items.some(i => i.clip.title === "Card: cta"), "the unfilled closing card is absent, not blank");

  // Filling it later adds it without disturbing the one already there.
  snapshot = store.readEditor(id);
  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "story-arc", sequenceId, expectedRevision: snapshot.revision,
    overrides: { images: { mode: "off" } },
    slots: { turn: { text: "But here is what actually happened" }, cta: { text: "Follow for part two" } },
  });
  sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const cta = sequence.items.find(i => i.clip.title === "Card: cta")!;
  assert.ok(cta, "the closing card appeared once its line was written");
  // atFraction 1 anchors the card's END to the end, so it is on screen rather than past it.
  assert.ok((cta.at ?? 0) + cta.clip.end <= duration + 0.01, `card runs to ${(cta.at ?? 0) + cta.clip.end}, video is ${duration}`);
  assert.equal(sequence.items.filter(i => i.clip.title.startsWith("Card:")).length, 2);
  assert.equal(sequence.items.filter(i => i.clip.title === "Hook").length, 1);
});

test("filling a template's music slot lays a ducked bed across the whole video", async () => {
  const { id, sequenceId } = await projectWithScript();
  const tone = path.join(workspace, "bed.wav");
  const result = spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", tone], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const asset = await tools.executeEditorTool(id, { tool: "assets.importLocal", file: tone }) as { id: string };

  const snapshot = store.readEditor(id);
  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId, expectedRevision: snapshot.revision,
    overrides: { images: { mode: "off" } }, slots: { music: { assetId: asset.id } },
  });
  const sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const bed = sequence.items.find(i => i.clip.title === "Music bed")!;
  assert.ok(bed, "a music layer was added");
  const music = bed.clip.edits[0] as { type: string; src: string; duck: boolean; gain: number; d: number };
  assert.equal(music.type, "music");
  assert.equal(music.src, asset.id);
  assert.equal(music.duck, true);
  const { sequenceFrames } = await import("../src/lib/sequences");
  assert.ok(Math.abs(music.d - sequenceFrames(sequence).duration / sequence.output.fps) < 0.05, "the bed spans the finished video");

  // Leaving the slot empty must not invent a bed, and must not fail either.
  const { id: other, sequenceId: otherSequence } = await projectWithScript();
  await tools.executeEditorTool(other, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId: otherSequence,
    expectedRevision: store.readEditor(other).revision, overrides: { images: { mode: "off" } },
  });
  assert.ok(!store.readEditor(other).edl.sequences.find(s => s.id === otherSequence)!.items.some(i => i.clip.title === "Music bed"));

  // A picture asset in an audio slot is a mistake worth naming.
  const { id: third, sequenceId: thirdSequence } = await projectWithScript();
  await assert.rejects(tools.executeEditorTool(third, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId: thirdSequence,
    expectedRevision: store.readEditor(third).revision, slots: { music: { assetId: "a_not_audio" } },
  }), /not an audio asset/);
});

test("suggestion ranks templates on the material, by their settings rather than their names", async () => {
  const { id, sequenceId } = await projectWithScript();
  const suggest = (slots?: Record<string, unknown>) => tools.executeEditorTool(id, {
    tool: "templates.suggest", sequenceId, ...(slots ? { slots } : {}),
  }) as Promise<{ signals: import("../src/lib/templates/suggest").SequenceSignals; suggestions: import("../src/lib/templates/suggest").TemplateSuggestion[] }>;

  const { signals, suggestions } = await suggest();
  assert.equal(signals.sentences, SCRIPT.length);
  assert.ok(signals.brandShare >= 0.4, `brand share was ${signals.brandShare}`);
  assert.ok(signals.hasFootage);
  assert.equal(suggestions[0].templateId, "brand-explainer", "a script full of company names wants the logo template");
  assert.ok(suggestions[0].why.some(w => /name a company/.test(w)));

  // Being listed is not being reached: a frame over real footage always answers first.
  const demo = suggestions.find(s => s.templateId === "product-demo")!;
  assert.ok(demo.fit < suggestions[0].fit);
  assert.ok(demo.why.some(w => /logo it would never reach/.test(w)));

  // A required slot that is not filled disqualifies a template rather than hiding it.
  const chat = suggestions.find(s => s.templateId === "chat-story")!;
  assert.deepEqual(chat.missingSlots, ["Screenshots folder"]);
  assert.equal(chat.fit, 0);
  const withPool = (await suggest({ screenshots: { folder: screenshots } })).suggestions;
  assert.ok(withPool.find(s => s.templateId === "chat-story")!.fit > 0.5, "filling the slot makes it a real candidate");
  // Every template that actually takes a pool says so; the ones that do not, do not.
  for (const suggestion of withPool) {
    const template = await registry.getTemplate(suggestion.templateId);
    const takesPool = template.images.sources.some(source => source.startsWith("slot"));
    assert.equal(suggestion.why.some(w => /your pictures come first/.test(w)), takesPool && template.images.mode !== "off",
      `${suggestion.templateId} should ${takesPool ? "" : "not "}mention the supplied pictures`);
  }

  // The count is the planner's own, not a second guess at the same rule.
  for (const suggestion of withPool) {
    const plan = await tools.executeEditorTool(id, {
      tool: "template.plan", templateId: suggestion.templateId, sequenceId,
      slots: { screenshots: { folder: screenshots } },
    }).catch(() => null) as import("../src/lib/templates/plan").TemplatePlan | null;
    if (plan) assert.equal(suggestion.expectedImages, plan.totals.images,
      `${suggestion.templateId} promised ${suggestion.expectedImages} pictures but plans ${plan.totals.images}`);
  }

  // A user template is scored on the same evidence, not excluded for being new.
  await registry.saveTemplate({ id: "mine-quiet", name: "Mine, quiet", images: { mode: "off" }, hook: { mode: "off" } });
  const mine = (await suggest()).suggestions.find(s => s.templateId === "mine-quiet")!;
  assert.ok(mine, "a user template is ranked alongside the built-ins");
  assert.equal(mine.builtin, false);
  assert.equal(mine.expectedImages, 0);
  await registry.deleteTemplate("mine-quiet");
});

test("a logo slot holds a mark in the corner for the whole video, and is optional", async () => {
  const { id, sequenceId } = await projectWithScript();
  const { sequenceFrames } = await import("../src/lib/sequences");
  const logo = await tools.executeEditorTool(id, { tool: "assets.importLocal", file: path.join(screenshots, "shot-1.png") }) as { id: string };

  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "brand-explainer", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    overrides: { images: { mode: "off" } }, slots: { logo: { assetId: logo.id } },
  });
  const sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const mark = sequence.items.find(i => i.clip.title === "Watermark")!;
  assert.ok(mark, "the logo was placed");
  assert.equal(mark.at, 0);
  assert.ok(Math.abs(mark.clip.end - sequenceFrames(sequence).duration / sequence.output.fps) < 0.05, "it is held for the whole video");
  assert.equal(mark.transform?.opacity, 0.9);
  const image = mark.clip.edits[0] as { type: string; src: string; x: number; y: number; widthPct: number; style: string };
  assert.equal(image.type, "image");
  assert.equal(image.src, logo.id);
  assert.equal(image.style, "plain");
  assert.equal(image.widthPct, 12);
  // Bottom-right of a 1080x1920 frame: the mark's own half-width and half-height clear
  // the margin, and it stays out of the top corner where a sticky hook lives.
  assert.ok(image.x > 0.85 && image.x < 1, `x was ${image.x}`);
  assert.ok(image.y > 0.85 && image.y < 1, `y was ${image.y}`);
  const hookLayer = sequence.items.find(i => i.clip.title === "Hook")!;
  assert.ok((mark.layer ?? 0) > (hookLayer.layer ?? 0), "it draws above the hook");
  const hookText = hookLayer.clip.edits[0] as { position: string };
  assert.equal(hookText.position, "top");
  assert.ok(image.y > 0.5, "a top hook and a corner mark must not want the same corner");

  // A template is still free to take a top corner back.
  const { id: top, sequenceId: topSequence } = await projectWithScript();
  await tools.executeEditorTool(top, { tool: "assets.importLocal", file: path.join(screenshots, "shot-2.png") });
  const topLogo = (await tools.executeEditorTool(top, { tool: "assets.list", kind: "image" }) as Array<{ id: string }>)[0];
  await tools.executeEditorTool(top, {
    tool: "template.apply", templateId: "brand-explainer", sequenceId: topSequence,
    expectedRevision: store.readEditor(top).revision,
    overrides: { images: { mode: "off" }, watermark: { corner: "top-left" } },
    slots: { logo: { assetId: topLogo.id } },
  });
  const topMark = store.readEditor(top).edl.sequences.find(s => s.id === topSequence)!.items.find(i => i.clip.title === "Watermark")!;
  const topImage = topMark.clip.edits[0] as { x: number; y: number };
  assert.ok(topImage.x < 0.15 && topImage.y < 0.15, `top-left was ${topImage.x},${topImage.y}`);

  // No logo chosen is not an error, and an audio file in a picture slot is.
  const { id: bare, sequenceId: bareSequence } = await projectWithScript();
  await tools.executeEditorTool(bare, {
    tool: "template.apply", templateId: "brand-explainer", sequenceId: bareSequence,
    expectedRevision: store.readEditor(bare).revision, overrides: { images: { mode: "off" } },
  });
  assert.ok(!store.readEditor(bare).edl.sequences.find(s => s.id === bareSequence)!.items.some(i => i.clip.title === "Watermark"));

  const tone = path.join(workspace, "not-a-logo.wav");
  const result = spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", tone], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const audio = await tools.executeEditorTool(id, { tool: "assets.importLocal", file: tone }) as { id: string };
  const { id: third, sequenceId: thirdSequence } = await projectWithScript();
  await assert.rejects(tools.executeEditorTool(third, {
    tool: "template.apply", templateId: "brand-explainer", sequenceId: thirdSequence,
    expectedRevision: store.readEditor(third).revision, slots: { logo: { assetId: audio.id } },
  }), /not an image asset/);
});

test("image providers report what this machine can actually reach", async () => {
  const { id } = await projectWithScript();
  const providers = await tools.executeEditorTool(id, { tool: "assets.providers" }) as Array<{ id: string; configured: boolean; kind: string }>;
  const byId = new Map(providers.map(p => [p.id, p]));
  // These three need no key and must never report otherwise.
  for (const free of ["brand", "commons", "openverse"]) assert.equal(byId.get(free)?.configured, true, `${free} should need no key`);
  assert.equal(byId.get("brand")?.kind, "logo");
  // Keyed providers are honest about a machine with no keys, and return nothing rather than failing.
  for (const keyed of ["pexels", "unsplash", "google"]) {
    assert.equal(byId.get(keyed)?.configured, !!process.env[keyed === "google" ? "AGENTCUT_GOOGLE_CSE_KEY" : `AGENTCUT_${keyed.toUpperCase()}_KEY`]);
  }
  const { pexels, unsplash, googleImages } = await import("../src/lib/search/photos");
  for (const provider of [pexels, unsplash, googleImages]) assert.deepEqual(await provider.search("google", 5), []);
});

/** A project shaped like the clipping flow: a primary source and a generated clip. */
async function projectWithGeneratedClip() {
  const id = `gen${Math.random().toString(36).slice(2, 8)}`;
  const { probe } = await import("../src/lib/media");
  const metadata = await probe(source);
  database.q.insertProject({ id, name: "Generated", source_path: source, created_at: Date.now() });
  const clip = edlSchema.Clip.parse({
    id: "clip1", title: "Ranking", hook: "How ranking really works", score: 80,
    start: 0, end: 18, words: speak(SCRIPT.slice(0, 5), 0.6),
  });
  store.publishClips(id, edlSchema.Edl.parse({
    projectId: id, source: { file: source, ...metadata },
    output: { width: 1080, height: 1920, fps: 30 }, clips: [clip],
  }));
  database.q.setProject(id, { status: "ready" });
  return { id, clipId: clip.id };
}

test("a template applied to a generated clip promotes it in place, keeping its id and its footage", async () => {
  const { id, clipId } = await projectWithGeneratedClip();
  const before = store.readEditor(id);
  assert.equal(before.edl.clips.length, 1);
  assert.equal(before.edl.sequences.length, 0);

  const plan = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "product-demo", clipId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(plan.promotes, true);
  assert.equal(plan.sequenceId, clipId);
  assert.ok(plan.totals.images >= 1);

  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "product-demo", clipId, expectedRevision: before.revision,
    // `frame` is the source that only works if the promoted shot kept its media.
    overrides: { images: { sources: ["frame"] } },
  });

  const after = store.readEditor(id);
  assert.equal(after.edl.clips.length, 0, "the clip was promoted, not copied");
  const sequence = after.edl.sequences.find(s => s.id === clipId)!;
  assert.ok(sequence, "the timeline kept the clip's own id, so existing links still open it");
  const shot = sequence.items.find(i => i.id === clipId)!;
  assert.ok(shot.mediaId, "the promoted shot is still backed by the original source");
  assert.equal(shot.clip.title, "Ranking");
  assert.equal(shot.clip.start, 0);
  assert.equal(shot.clip.end, 18);
  assert.equal(shot.clip.words.length, before.edl.clips[0].words.length, "the transcript survived promotion");

  const images = shot.clip.edits.filter(e => e.type === "image");
  assert.ok(images.length >= 1, "stills were captured from the promoted shot's own footage");
  for (const image of images) assert.equal(database.q.getAsset(image.src)!.source, "capture");
  assert.ok(sequence.items.some(i => i.clip.title === "Hook"), "the hook layer spans the promoted timeline");
});

test("a template treats every shot of a multi-shot video on its own, and leaves hand-made layers alone", async () => {
  const { id } = await mediaService.createVideoProject("Two shots", [{ file: source }, { file: source }]);
  let snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  const [first, second] = sequence.items;
  const manualId = "i_byhand";
  snapshot = store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    // Two shots with different scripts, plus a title layer nobody asked the template to touch.
    { type: "item.patch", sequenceId: sequence.id, itemId: first.id, patch: { title: "One", hook: "First half", start: 0, end: 1.9, words: speak(SCRIPT.slice(0, 3), 0.1).map(w => ({ ...w, t: w.t / 6, d: 0.05 })) } },
    { type: "item.patch", sequenceId: sequence.id, itemId: second.id, patch: { title: "Two", start: 0, end: 1.9, words: speak(SCRIPT.slice(4, 7), 0.1).map(w => ({ ...w, t: w.t / 6, d: 0.05 })) } },
    { type: "item.add", sequenceId: sequence.id, item: { id: manualId, mediaId: null, layer: 7, at: 0,
      clip: edlSchema.Clip.parse({ id: manualId, title: "My title", start: 0, end: 1, captions: { preset: "none" },
        edits: [{ type: "text", t: 0, d: 1, text: "Mine", position: "bottom", style: "plain" }] }) } },
  ] });

  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId: sequence.id,
    expectedRevision: snapshot.revision, overrides: { images: { sources: ["slot"] } },
    slots: { screenshots: { folder: screenshots } },
  });

  const after = store.readEditor(id).edl.sequences[0];
  for (const itemId of [first.id, second.id]) {
    const shot = after.items.find(i => i.id === itemId)!;
    assert.ok(shot.clip.edits.some(e => e.by === "template:explainer-broll"), `shot ${shot.clip.title} was edited`);
    assert.equal(shot.clip.captions.uppercase, true);
  }
  // Each shot's edits are clip-relative, so none may point past its own source.
  for (const item of after.items) {
    for (const edit of item.clip.edits) assert.ok(edit.t + edit.d <= item.clip.end - item.clip.start + 0.01,
      `an edit on "${item.clip.title}" runs past the shot: ${edit.type} at ${edit.t}+${edit.d} of ${item.clip.end - item.clip.start}`);
  }
  const manual = after.items.find(i => i.id === manualId)!;
  assert.deepEqual(manual.clip.edits.map(e => e.by), [""], "the hand-made title was not touched");
  assert.equal(manual.clip.captions.preset, "none", "and was not restyled");

  // One hook spans the whole video rather than one per shot.
  const hooks = after.items.filter(i => i.clip.title === "Hook");
  assert.equal(hooks.length, 1);
  const { sequenceFrames } = await import("../src/lib/sequences");
  assert.ok(Math.abs(hooks[0].clip.end - sequenceFrames(after).duration / after.output.fps) < 0.05);
  assert.equal((hooks[0].clip.edits[0] as { text: string }).text, "First half", "the hook comes from the first shot that has one");
});

test("a save that lands while a template is resolving is rejected, not half-applied", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  const stale = store.readEditor(id).revision;
  // Somebody else saves between the template reading the project and committing.
  store.editProject(id, { expectedRevision: stale, operations: [
    { type: "item.patch", sequenceId, itemId, patch: { title: "Renamed elsewhere" } },
  ] });

  await assert.rejects(
    tools.executeEditorTool(id, { tool: "template.apply", templateId: "talking-head", sequenceId, expectedRevision: stale }),
    (error: Error) => /changed elsewhere/.test(error.message));

  const after = store.readEditor(id);
  assert.equal(after.revision, stale + 1, "the other save stands and the template added no revision");
  const shot = after.edl.sequences.find(s => s.id === sequenceId)!.items.find(i => i.id === itemId)!;
  assert.equal(shot.clip.title, "Renamed elsewhere");
  assert.equal(shot.clip.edits.length, 0, "nothing was half-applied");
  // Reading the current revision and retrying is all that is needed.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "talking-head", sequenceId, expectedRevision: after.revision });
  assert.ok(store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!.items.find(i => i.id === itemId)!.clip.edits.length > 0);
});

test("applying the same template twice converges instead of accumulating", async () => {
  const { id, sequenceId } = await projectWithScript();
  const apply = async () => {
    await tools.executeEditorTool(id, {
      tool: "template.apply", templateId: "explainer-broll", sequenceId,
      expectedRevision: store.readEditor(id).revision,
      overrides: { images: { sources: ["slot"] } }, slots: { screenshots: { folder: screenshots } },
    });
    const sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
    // Ids of generated layers are new each time; their shape is what must be stable.
    return {
      items: sequence.items.length,
      layers: sequence.items.map(i => ({ title: i.clip.title, at: i.at, layer: i.layer, edits: i.clip.edits.length })),
      shotEdits: sequence.items.filter(i => i.mediaId).flatMap(i => i.clip.edits.map(e => `${e.type}@${e.t.toFixed(3)}`)).sort(),
      captions: sequence.items.filter(i => i.mediaId).map(i => i.clip.captions),
    };
  };
  const once = await apply();
  const twice = await apply();
  assert.deepEqual(twice, once, "a second apply produced a different timeline");
});

test("a beat that finds no picture says which source declined and why", async () => {
  const { id, sequenceId } = await projectWithScript();

  // More beats than the folder has pictures: the overflow must name the real reason.
  const exhausted = await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    overrides: { images: { mode: "every", sources: ["slot"], minSentenceGap: 0, minGapSec: 0, density: 1 } },
    slots: { screenshots: { folder: screenshots } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  assert.equal(exhausted.applied.placed, 5, "the folder holds five pictures");
  assert.ok(exhausted.applied.dropped.length >= 1, "the beats past the fifth were reported");
  for (const beat of exhausted.applied.dropped) {
    assert.deepEqual(beat.attempts.map(a => a.source), ["slot"]);
    assert.equal(beat.attempts[0].outcome, "empty");
    assert.match(beat.attempts[0].detail!, /ran out of pictures/);
    assert.ok(beat.sentence.length > 0, "the sentence that wanted a picture is named");
  }

  // A source that has nothing to work with is skipped, not failed — a different thing.
  const { id: other, sequenceId: otherSequence, itemId } = await projectWithScript();
  let snapshot = store.readEditor(other);
  snapshot = store.editProject(other, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId: otherSequence, itemId,
    patch: { words: speak(["Marcus rebuilt the whole thing in Barcelona last winter.", "Nobody thought it would work at all.", "Priya shipped the second version from Lisbon.", "It turned out fine in the end."], 0.8) },
  }] });
  const noBrands = await tools.executeEditorTool(other, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId: otherSequence,
    expectedRevision: snapshot.revision,
    overrides: { images: { sources: ["brand", "project"], mode: "auto" } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  assert.equal(noBrands.applied.placed, 0, "no company was named and nothing is in the project");
  assert.ok(noBrands.applied.dropped.length >= 1);
  const attempts = noBrands.applied.dropped[0].attempts;
  assert.deepEqual(attempts.map(a => a.source), ["brand", "project"]);
  assert.equal(attempts[0].outcome, "skipped");
  assert.match(attempts[0].detail!, /names no company or product/);
  assert.equal(attempts[1].outcome, "empty");
  assert.match(attempts[1].detail!, /nothing already in this project/);
  // The names were still found; they just had nowhere to come from.
  assert.ok(noBrands.applied.dropped.some(b => /Marcus|Priya|Barcelona|Lisbon/.test(b.query)), `queries were ${noBrands.applied.dropped.map(b => b.query)}`);

  // Footage capture on a canvas layer is skipped with a reason, not a crash.
  const { id: third, sequenceId: thirdSequence } = await projectWithScript();
  const canvasId = "i_canvas";
  let third3 = store.readEditor(third);
  third3 = store.editProject(third, { expectedRevision: third3.revision, operations: [{
    type: "item.add", sequenceId: thirdSequence, item: { id: canvasId, mediaId: null, layer: 0, at: 30,
      clip: edlSchema.Clip.parse({ id: canvasId, title: "Canvas", start: 0, end: 6, words: speak(SCRIPT.slice(0, 2), 0.8) }) },
  }] });
  const onCanvas = await tools.executeEditorTool(third, {
    tool: "template.apply", templateId: "product-demo", sequenceId: thirdSequence,
    expectedRevision: third3.revision, overrides: { images: { sources: ["frame"], mode: "every", minSentenceGap: 0, minGapSec: 0 } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  const canvasDrops = onCanvas.applied.dropped.filter(b => b.itemId === canvasId);
  assert.ok(canvasDrops.length >= 1, "the canvas scene's beats were reported");
  assert.equal(canvasDrops[0].attempts[0].outcome, "skipped");
  assert.match(canvasDrops[0].attempts[0].detail!, /no footage to capture from/);
  assert.ok(onCanvas.applied.placed > 0, "the footage-backed shot was still illustrated");
});

test("a provider that breaks is reported as a failure, not as an empty result", async () => {
  const { searchImagesDetailed, resolveQueryDetailed } = await import("../src/lib/search");
  // Every provider is reachable in a test run only if the network is; ask for one that is not.
  // A provider asked for by name that cannot answer is a failure that names itself —
  // a typo or a missing key must not read as "no picture matched".
  const missing = await searchImagesDetailed("google", 3, ["nosuchprovider"]);
  assert.deepEqual(missing.hits, []);
  assert.equal(missing.failures.length, 1);
  assert.match(missing.failures[0].message, /unknown image provider "nosuchprovider"/);
  const unkeyed = await searchImagesDetailed("google", 3, ["unsplash"]);
  assert.ok(unkeyed.failures.some(f => f.provider === "unsplash" && /AGENTCUT_UNSPLASH_KEY/.test(f.message)),
    `a keyed provider without its key should say so, got ${JSON.stringify(unkeyed.failures)}`);

  const original = process.env.AGENTCUT_PEXELS_KEY;
  process.env.AGENTCUT_PEXELS_KEY = "definitely-not-a-valid-key";
  try {
    const { failures } = await searchImagesDetailed("laptop", 3, ["pexels"]);
    assert.equal(failures.length, 1, "a rejected key is a failure, not a quiet zero");
    assert.equal(failures[0].provider, "pexels");
    const result = await resolveQueryDetailed("laptop", "irrelevant", ["pexels"]);
    assert.equal(result.asset, null);
    assert.equal(result.reason, "search-failed");
    assert.match(result.detail!, /pexels/);
  } finally {
    if (original === undefined) delete process.env.AGENTCUT_PEXELS_KEY;
    else process.env.AGENTCUT_PEXELS_KEY = original;
  }
});

test("suggestion and folder import work on a project that has no footage at all", async () => {
  const { id } = await mediaService.createVideoProject("Empty canvas");
  const snapshot = store.readEditor(id);
  assert.equal(snapshot.edl.source, null);
  assert.equal(snapshot.edl.sequences[0].items.length, 0);

  const { signals, suggestions } = await tools.executeEditorTool(id, { tool: "templates.suggest" }) as {
    signals: import("../src/lib/templates/suggest").SequenceSignals;
    suggestions: import("../src/lib/templates/suggest").TemplateSuggestion[];
  };
  assert.equal(signals.sentences, 0);
  assert.equal(signals.hasFootage, false);
  assert.equal(signals.durationSec, 0);
  // With nothing to read, the honest answer is a template that needs nothing to read.
  // Which one of those wins a tie is not the invariant; that it leads is.
  assert.ok(suggestions[0].why.some(w => /needs no transcript/.test(w)), JSON.stringify(suggestions[0]));
  assert.ok(suggestions.find(s => s.templateId === "talking-head")!.why.some(w => /needs no transcript/.test(w)));
  const broll = suggestions.find(s => s.templateId === "explainer-broll")!;
  assert.ok(broll.why.some(w => /no transcript yet/.test(w)));
  // A template that wants stills from footage must not be recommended for a blank canvas.
  const demo = suggestions.find(s => s.templateId === "product-demo")!;
  assert.ok(demo.why.some(w => /footage this video does not have/.test(w)));
  assert.ok(demo.fit < suggestions[0].fit);

  // Nothing can place a picture on a canvas with no shot to place it on, whatever is
  // supplied — and nothing claims it can.
  const withPool = await tools.executeEditorTool(id, {
    tool: "templates.suggest", slots: { screenshots: { folder: screenshots } },
  }) as { suggestions: import("../src/lib/templates/suggest").TemplateSuggestion[] };
  const chat = withPool.suggestions.find(s => s.templateId === "chat-story")!;
  assert.deepEqual(chat.missingSlots, [], "the slot is filled, so it is no longer blocked");
  for (const suggestion of withPool.suggestions) assert.equal(suggestion.expectedImages, 0);

  // Footage without a transcript is the real case: pictures from a folder still work.
  const { id: silent } = await mediaService.createVideoProject("No transcript", [{ file: source }]);
  const pooled = await tools.executeEditorTool(silent, {
    tool: "templates.suggest", slots: { screenshots: { folder: screenshots } },
  }) as { signals: import("../src/lib/templates/suggest").SequenceSignals; suggestions: import("../src/lib/templates/suggest").TemplateSuggestion[] };
  assert.equal(pooled.signals.sentences, 0);
  assert.ok(pooled.signals.hasFootage);
  const pooledChat = pooled.suggestions.find(s => s.templateId === "chat-story")!;
  assert.ok(pooledChat.expectedImages > 0, "a folder of pictures over silent footage is its own format");
  assert.ok(pooledChat.why.some(w => /needs no transcript/.test(w)), `chat-story reasons were ${pooledChat.why}`);

  // assets.importFolder is the same folder read, exposed on its own.
  const imported = await tools.executeEditorTool(id, { tool: "assets.importFolder", folder: screenshots }) as {
    folder: string; imported: Array<{ id: string; name: string }>; failed: string[];
  };
  assert.equal(imported.failed.length, 0);
  assert.equal(imported.imported.length, 5);
  assert.deepEqual(imported.imported.map(a => a.name), imported.imported.map(a => a.name).toSorted(), "filename order is preserved");
  const listed = await tools.executeEditorTool(id, { tool: "assets.list", kind: "image" }) as Array<{ id: string }>;
  for (const asset of imported.imported) assert.ok(listed.some(a => a.id === asset.id), "imported pictures are in the project browser");
  await assert.rejects(tools.executeEditorTool(id, { tool: "assets.importFolder", folder: path.join(workspace, "nothing-here") }));
});

test("a logo plate is sized as a symbol, a photograph as a picture", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  // A picture already in the project named after a company resolves through the brand
  // branch without touching the network, which is the same sizing decision.
  const named = path.join(workspace, "Google logo.png");
  const result = spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=white:size=256x256", "-frames:v", "1", named], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  await tools.executeEditorTool(id, { tool: "assets.importLocal", file: named });

  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    overrides: { images: { sources: ["project"], mode: "auto" } },
  });
  const shot = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!.items.find(i => i.id === itemId)!;
  const images = shot.clip.edits.filter((e): e is Extract<typeof e, { type: "image" }> => e.type === "image");
  const template = await registry.getTemplate("explainer-broll");
  assert.ok(template.images.logoWidthPct < template.images.widthPct, "a mark is narrower than a photograph");

  const logos = images.filter(i => i.style === "logo");
  assert.ok(logos.length >= 1, "the company name resolved to the logo plate");
  for (const logo of logos) {
    assert.equal(logo.widthPct, template.images.logoWidthPct,
      "a logo plate at photograph width swamps the frame and collides with a sticky hook");
  }

  // The same template, told to use photo cards, keeps the photograph width.
  const { id: photo, sequenceId: photoSequence, itemId: photoItem } = await projectWithScript();
  await tools.executeEditorTool(photo, { tool: "assets.importLocal", file: named });
  await tools.executeEditorTool(photo, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId: photoSequence,
    expectedRevision: store.readEditor(photo).revision,
    overrides: { images: { sources: ["project"], mode: "auto", style: "card" } },
  });
  const cards = store.readEditor(photo).edl.sequences.find(s => s.id === photoSequence)!
    .items.find(i => i.id === photoItem)!.clip.edits.filter((e): e is Extract<typeof e, { type: "image" }> => e.type === "image");
  assert.ok(cards.length >= 1);
  for (const card of cards) {
    assert.equal(card.style, "card");
    assert.equal(card.widthPct, template.images.widthPct);
  }
});

test("an overlay is bounded by height as well as width, so a portrait picture fits a portrait frame", async () => {
  const chat = await registry.getTemplate("chat-story");
  // A chat crop is portrait: 86% of 1080 is 929px, and a 900x1900 screenshot at that
  // width is 1961px tall in a 1920px frame. Width alone cannot express that.
  assert.ok(chat.images.heightPct < 100, "chat-story bounds its screenshots by height");
  assert.ok((chat.images.widthPct / 100) * 1080 * (1900 / 900) > 1920, "the case this exists for");
  assert.ok((chat.images.heightPct / 100) * 1920 < 1920 * 0.6, "and leaves room for the hook and the captions");

  const { id, sequenceId, itemId } = await projectWithScript();
  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "chat-story", sequenceId,
    expectedRevision: store.readEditor(id).revision, slots: { screenshots: { folder: screenshots } },
  });
  const shot = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!.items.find(i => i.id === itemId)!;
  const images = shot.clip.edits.filter((e): e is Extract<typeof e, { type: "image" }> => e.type === "image");
  assert.ok(images.length >= 1);
  for (const image of images) {
    assert.equal(image.heightPct, chat.images.heightPct, "the template's height bound reaches the edit");
    // The band it occupies has to clear the top of the frame and the captions below.
    const half = image.heightPct / 200;
    assert.ok(image.y - half > 0.12, `top edge at ${(image.y - half).toFixed(3)} would reach the hook`);
    assert.ok(image.y + half < shot.clip.captions.positionY, `bottom edge at ${(image.y + half).toFixed(3)} would reach the captions`);
  }

  // An unbounded edit is still expressible; the default is simply not to blow the frame.
  const edit = edlSchema.Edit.parse({ type: "image", t: 0, d: 1, src: "a_x" });
  assert.equal(edit.type === "image" && edit.heightPct, 100);
});

test("a card at the bottom of the frame is called out, because that is where the captions are", async () => {
  const { id, sequenceId } = await projectWithScript();
  await registry.saveTemplate({
    id: "bottom-card", name: "Bottom card",
    // Imported footage starts with captions off; a template turning them on is what
    // creates the conflict, so that is the case the warning has to catch.
    captions: { preset: "karaoke" },
    cards: [{ id: "cta", atFraction: 1, text: "Follow for part two", seconds: 2, position: "bottom" }],
    images: { mode: "off" },
  });
  const warned = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "bottom-card", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(warned.warnings.some(w => /where the captions are/.test(w)), `warnings were ${JSON.stringify(warned.warnings)}`);

  // A shot whose captions are genuinely off has no conflict to report.
  const noCaptions = await registry.saveTemplate({
    id: "bottom-quiet", name: "Bottom quiet", images: { mode: "off" },
    cards: [{ id: "cta", atFraction: 1, text: "Follow", seconds: 2, position: "bottom" }],
  });
  assert.equal(noCaptions.captions.preset, undefined, "a template that says nothing about captions changes nothing");
  const silent = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "bottom-quiet", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(!silent.warnings.some(w => /where the captions are/.test(w)));
  await registry.deleteTemplate("bottom-quiet");

  // Turning the captions off removes the conflict, so it removes the warning.
  const quiet = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "bottom-card", sequenceId, overrides: { captions: { preset: "none" } },
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(!quiet.warnings.some(w => /where the captions are/.test(w)));
  await registry.deleteTemplate("bottom-card");

  // The built-in that used to do this no longer does.
  const arc = await registry.getTemplate("story-arc");
  assert.ok(arc.cards.length >= 1);
  assert.ok(!arc.cards.some(c => c.position === "bottom"), "story-arc's closing card would have hidden the last spoken line");
  const plan = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "story-arc", sequenceId,
    slots: { cta: { text: "Follow for part two" } },
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(!plan.warnings.some(w => /where the captions are/.test(w)));
  assert.equal(plan.cards.length, 1, "only the filled card is planned");
});

test("brand matching is fast enough for a long transcript, and its cache follows the index", async () => {
  const brand = await import("../src/lib/search/brand");
  await brand.brandIndex();
  const sentence = "Google changed how ranking works and Facebook copied it later.";
  assert.deepEqual((await brand.brandsInText(sentence)).map(b => b.brand.slug), ["google", "facebook"]);

  // The name table is derived from the index; rebuilding it per sentence is thousands
  // of map writes, and a ten-minute video is a few hundred sentences.
  const started = Date.now();
  for (let i = 0; i < 300; i++) await brand.brandsInText(sentence);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 150, `300 sentences took ${elapsed}ms; the name table is being rebuilt per call`);

  // Whatever is cached has to be thrown away with the index, or a reload serves stale names.
  brand.resetBrandIndex();
  assert.deepEqual((await brand.brandsInText(sentence)).map(b => b.brand.slug), ["google", "facebook"]);
  assert.equal((await brand.findBrand("Stripe"))?.slug, "stripe");
  assert.equal(await brand.findBrand("definitely not a brand"), null);
});

/** A walkthrough script: it describes what is on screen without ever naming a thing. */
const UNNAMED = [
  "The settings panel is where the whole thing starts.",
  "Most people never open it even once.",
  "The export queue shows every render you have running.",
  "It updates about twice a second while it works.",
  "The timeline itself is the part that took longest.",
  "And that is the piece I want to show you now.",
];

test("a source that needs no subject does not need the script to name one", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  let snapshot = store.readEditor(id);
  const spoken = speak(UNNAMED, 0.8);
  snapshot = store.editProject(id, { expectedRevision: snapshot.revision, operations: [{
    type: "item.patch", sequenceId, itemId, patch: { start: 0, end: Math.min(20, spoken.at(-1)!.t + 0.5), words: spoken },
  }] });
  const analyses = script.analyzeSentences(script.toSentences(spoken), new Map());
  assert.ok(analyses.every(a => !a.subjects.length), "this script names nothing, which is the point");

  // A still comes out of the footage in front of you: it needs a moment, not a name.
  const captured = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "product-demo", sequenceId,
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(captured.totals.images >= 1, "product-demo could never illustrate a walkthrough otherwise");
  assert.ok(captured.items[0].cues.every(c => c.query === ""), "and it looks for nothing");
  assert.ok(!captured.warnings.some(w => /earns a picture/.test(w)));

  // The same script through sources that must search for something finds nothing, and says so.
  const searched = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "product-demo", sequenceId,
    overrides: { images: { sources: ["brand", "web"] } },
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(searched.totals.images, 0);
  assert.ok(searched.warnings.some(w => /need the script to name something/.test(w)),
    `warnings were ${JSON.stringify(searched.warnings)}`);

  // A supplied folder is the same kind of answer: no name required.
  const pooled = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "explainer-broll", sequenceId,
    slots: { screenshots: { folder: screenshots } },
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(pooled.totals.images >= 1);

  // Applying it really does capture stills, one per planned beat.
  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "product-demo", sequenceId, expectedRevision: store.readEditor(id).revision,
  });
  const shot = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!.items.find(i => i.id === itemId)!;
  const images = shot.clip.edits.filter((e): e is Extract<typeof e, { type: "image" }> => e.type === "image");
  assert.equal(images.length, captured.totals.images);
  for (const image of images) assert.equal(database.q.getAsset(image.src)!.source, "capture");
});

test("saving a variation merges it the same way applying it would", async () => {
  const { id, sequenceId } = await projectWithScript();
  const overrides = { images: { density: 0.8, minSentenceGap: 3 }, hook: { mode: "intro" } };

  const saved = await tools.executeEditorTool(id, {
    tool: "templates.save", from: "explainer-broll", id: "my-dense", name: "My dense explainer",
    author: "you", overrides,
  }) as import("../src/lib/templates/schema").TemplateRecord;
  assert.equal(saved.builtin, false);
  assert.equal(saved.name, "My dense explainer");

  const base = await registry.getTemplate("explainer-broll");
  const merged = planner.mergeTemplate(base, overrides);
  // Saving and applying must agree field for field, or "save these settings" is a lie.
  const { id: _id, name: _name, author: _author, ...savedRest } = saved as unknown as Record<string, unknown>;
  const { id: __id, name: __name, author: __author, ...mergedRest } = merged as unknown as Record<string, unknown>;
  void _id; void _name; void _author; void __id; void __name; void __author;
  assert.deepEqual({ ...savedRest, builtin: undefined, file: undefined }, { ...mergedRest, builtin: undefined, file: undefined });

  // Including the parts this panel cannot edit: they survive rather than reverting.
  assert.deepEqual(saved.watermark, base.watermark, "the watermark settings came along");
  assert.deepEqual(saved.slots, base.slots, "so did the slots");
  assert.equal(saved.images.logoWidthPct, base.images.logoWidthPct);
  assert.equal(saved.images.heightPct, base.images.heightPct);
  assert.equal(saved.images.density, 0.8);
  assert.equal(saved.hook.mode, "intro");

  // And the saved template plans identically to applying the overrides to the original.
  const viaSaved = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "my-dense", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  const viaOverrides = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "explainer-broll", sequenceId, overrides }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.deepEqual(viaSaved.totals, viaOverrides.totals);
  assert.deepEqual(viaSaved.items[0].cues.map(c => c.t), viaOverrides.items[0].cues.map(c => c.t));

  await assert.rejects(tools.executeEditorTool(id, { tool: "templates.save", from: "explainer-broll", name: "No id" }), /needs an id and a name/);
  await assert.rejects(tools.executeEditorTool(id, { tool: "templates.save" }), /Provide a template document/);
  await registry.deleteTemplate("my-dense");
});

test("a dry run counts the folder it is given rather than assuming it is full", async () => {
  const { id, sequenceId } = await projectWithScript();
  const sparse = path.join(workspace, "two-shots");
  await fs.mkdir(sparse, { recursive: true });
  for (const [n, colour] of ["red", "green"].entries()) {
    const result = spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=${colour}:size=300x400`, "-frames:v", "1", path.join(sparse, `msg-0${n + 1}.png`)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }

  // Three beats want a picture, the folder holds two. The dry run can prove that
  // without importing anything, and has to, or the warning never fires on real input.
  const plan = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "chat-story", sequenceId,
    slots: { screenshots: { folder: sparse } },
    overrides: { images: { minSentenceGap: 1, minGapSec: 0 } },
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(plan.totals.images > 2, `wanted more than two beats, planned ${plan.totals.images}`);
  const shortfall = plan.warnings.find(w => /beats want a picture/.test(w));
  assert.ok(shortfall, `warnings were ${JSON.stringify(plan.warnings)}`);
  assert.match(shortfall!, /only 2 were supplied/);
  assert.match(shortfall!, new RegExp(`${plan.totals.images - 2} will be left bare`));

  // And what it predicted is what applying it actually does.
  const applied = await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "chat-story", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    slots: { screenshots: { folder: sparse } },
    overrides: { images: { minSentenceGap: 1, minGapSec: 0 } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  assert.equal(applied.applied.placed, 2, "two pictures, because the folder holds two");
  assert.equal(applied.applied.dropped.length, plan.totals.images - 2, "and the dry run said exactly how many would go bare");
  for (const beat of applied.applied.dropped) assert.match(beat.attempts.at(-1)!.detail ?? "", /ran out of pictures/);

  // A folder that cannot be read counts as nothing, and says so rather than throwing.
  const missing = await tools.executeEditorTool(id, {
    tool: "template.plan", templateId: "chat-story", sequenceId,
    slots: { screenshots: { folder: path.join(workspace, "no-such-folder") } },
  }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.ok(missing.warnings.some(w => /could not be read/.test(w)), `warnings were ${JSON.stringify(missing.warnings)}`);
});

test("every built-in template actually does something on a video it suits", async () => {
  const builtins = (await registry.listTemplates()).filter(t => t.builtin);
  assert.ok(builtins.length >= 11, "the sweep is only worth running if it covers them all");

  const { id, sequenceId, itemId } = await projectWithScript();
  const tone = path.join(workspace, "sweep.wav");
  assert.equal(spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", tone], { encoding: "utf8" }).status, 0);
  const audio = await tools.executeEditorTool(id, { tool: "assets.importLocal", file: tone }) as { id: string };
  const picture = await tools.executeEditorTool(id, { tool: "assets.importLocal", file: path.join(screenshots, "shot-1.png") }) as { id: string };
  // Pictures already in the project, named after what the script names, so the offline
  // `project` source can answer for templates whose other sources need the network.
  for (const [index, name] of ["Google", "Facebook", "Nvidia", "Stripe"].entries()) {
    const file = path.join(workspace, `${name} logo.png`);
    assert.equal(spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=0x${(index + 3) * 111111}:size=320x320`, "-frames:v", "1", file], { encoding: "utf8" }).status, 0);
    await tools.executeEditorTool(id, { tool: "assets.importLocal", file });
  }

  for (const template of builtins) {
    // Fill every slot the template declares, whatever kind it is.
    const slots = Object.fromEntries(template.slots.map(slot => [slot.id,
      slot.kind === "imagePool" ? { folder: screenshots }
        : slot.kind === "audio" ? { assetId: audio.id }
        : slot.kind === "image" ? { assetId: picture.id }
        : { text: "A line for the card" }]));

    const plan = await tools.executeEditorTool(id, {
      tool: "template.plan", templateId: template.id, sequenceId, slots,
    }) as import("../src/lib/templates/plan").TemplatePlan;

    assert.ok(!plan.warnings.some(w => /required and was not filled/.test(w)),
      `${template.id}: a slot read as unfilled although every one was given a value`);

    // The invariant that matters: a template that says it places pictures either does,
    // or says why not. Silence here is how a template ships unable to illustrate anything.
    if (template.images.mode !== "off") {
      assert.ok(plan.totals.images > 0 || plan.warnings.length > 0,
        `${template.id} plans no pictures on a script full of names and gives no reason`);
      assert.ok(plan.totals.images > 0,
        `${template.id} plans no pictures at all: ${JSON.stringify(plan.warnings)}`);
    } else {
      assert.equal(plan.totals.images, 0, `${template.id} has pictures off but planned some`);
    }

    assert.equal(!!plan.hook, template.hook.mode !== "off", `${template.id}: hook presence disagrees with its own mode`);
    assert.equal(plan.cards.length, template.cards.length, `${template.id}: every card's text was supplied, so every card should be planned`);
    assert.ok(plan.totals.silences > 0 === template.rhythm.silence.enabled, `${template.id}: dead-air cuts disagree with its own setting`);

    // And it must produce a real edit rather than a no-op, offline sources only so
    // this sweep never depends on a CDN being reachable.
    const offline = template.images.sources.filter(source => /^(slot|frame|project)/.test(source));
    const applied = await tools.executeEditorTool(id, {
      tool: "template.apply", templateId: template.id, sequenceId, slots,
      expectedRevision: store.readEditor(id).revision,
      ...(offline.length ? { overrides: { images: { sources: offline } } } : {}),
    }) as import("../src/lib/templates/apply").TemplateApplyResult;

    const sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
    const shot = sequence.items.find(i => i.id === itemId)!;
    const author = `template:${template.id}`;
    assert.ok(shot.clip.edits.some(e => e.by === author) || sequence.items.some(i => i.clip.edits.some(e => e.by === author)),
      `${template.id} applied without writing anything`);
    if (template.captions?.preset) assert.equal(shot.clip.captions.preset, template.captions.preset, `${template.id}: its caption preset did not reach the shot`);
    if (template.hook.mode !== "off") assert.ok(sequence.items.some(i => i.clip.title === "Hook"), `${template.id}: no hook layer`);
    if (template.watermark.enabled) assert.ok(sequence.items.some(i => i.clip.title === "Watermark"), `${template.id}: its logo slot was filled but no mark was placed`);
    if (template.music.enabled) assert.ok(sequence.items.some(i => i.clip.title === "Music bed"), `${template.id}: its music slot was filled but no bed was laid`);
    assert.ok(applied.applied.placed > 0 || template.images.mode === "off",
      `${template.id} placed no pictures from ${offline.join("/")}`);
  }
});

test("a slot key that supplies nothing is not a filled slot", async () => {
  const { id, sequenceId } = await projectWithScript();
  // `{}` and a blank path are present keys that supply nothing. Checking the key alone
  // reads them as filled, and the failure then surfaces as an empty pool much later.
  for (const empty of [{}, { folder: "   " }, { text: "" }, { assetIds: [] }]) {
    const plan = await tools.executeEditorTool(id, {
      tool: "template.plan", templateId: "chat-story", sequenceId, slots: { screenshots: empty },
    }) as import("../src/lib/templates/plan").TemplatePlan;
    assert.ok(plan.warnings.some(w => /required and was not filled/.test(w)),
      `${JSON.stringify(empty)} was read as a filled slot`);

    await assert.rejects(tools.executeEditorTool(id, {
      tool: "template.apply", templateId: "chat-story", sequenceId,
      expectedRevision: store.readEditor(id).revision, slots: { screenshots: empty },
    }), /needs "Screenshots folder"/, `${JSON.stringify(empty)} should fail as a missing input`);
  }

  // The suggestion agrees with the plan about what is missing.
  const { suggestions } = await tools.executeEditorTool(id, {
    tool: "templates.suggest", sequenceId, slots: { screenshots: {} },
  }) as { suggestions: import("../src/lib/templates/suggest").TemplateSuggestion[] };
  assert.deepEqual(suggestions.find(s => s.templateId === "chat-story")!.missingSlots, ["Screenshots folder"]);
});

test("the hook comes from a shot's own hook or title, never from whichever layer is first", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  // A hand-placed title layer sorted ahead of the footage in array order.
  const snapshot = store.readEditor(id);
  store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.add", sequenceId, index: 0, item: { id: "i_first", mediaId: null, layer: 5, at: 0,
      clip: edlSchema.Clip.parse({ id: "i_first", title: "Lower third", start: 0, end: 2,
        edits: [{ type: "text", t: 0, d: 2, text: "Lower third", position: "bottom", style: "plain" }] }) } },
  ] });
  const withHook = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "explainer-broll", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(withHook.hook?.text, "How ranking really works", "the shot's written hook wins");

  // With no hook written anywhere, the shot's title wins over the canvas layer's.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.patch", sequenceId, itemId, patch: { hook: "" } },
  ] });
  const withTitle = await tools.executeEditorTool(id, { tool: "template.plan", templateId: "explainer-broll", sequenceId }) as import("../src/lib/templates/plan").TemplatePlan;
  assert.equal(withTitle.hook?.text, "Ranking", `got "${withTitle.hook?.text}" — the canvas layer's title was taken for the hook`);
});

test("a tall logo is boxed into its corner rather than climbing out of it", async () => {
  const { id, sequenceId } = await projectWithScript();
  const tall = path.join(workspace, "tall-logo.png");
  assert.equal(spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=orange:size=100x400", "-frames:v", "1", tall], { encoding: "utf8" }).status, 0);
  const asset = await tools.executeEditorTool(id, { tool: "assets.importLocal", file: tall }) as { id: string };
  await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "brand-explainer", sequenceId,
    expectedRevision: store.readEditor(id).revision, overrides: { images: { mode: "off" } }, slots: { logo: { assetId: asset.id } },
  });
  const sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const mark = sequence.items.find(i => i.clip.title === "Watermark")!.clip.edits[0] as { widthPct: number; heightPct: number };
  // 12% of a 1080-wide frame is 130px; the same 130px is 6.75% of its 1920px height.
  const square = (mark.widthPct / 100) * sequence.output.width / sequence.output.height * 100;
  assert.ok(Math.abs(mark.heightPct - square) < 0.01, `height cap ${mark.heightPct} should box the mark to a square (${square.toFixed(2)})`);
  assert.ok(mark.heightPct < 100, "an uncapped 1:4 mark would stand 520px out of a 12% corner");
});

test("a request that will be refused is refused before any folder is imported", async () => {
  const { id } = await projectWithScript();
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "sequence.add", sequence: { id: "s_other", title: "Other", output: { width: 1080, height: 1920, fps: 30 }, items: [] } },
  ] });
  const before = (await tools.executeEditorTool(id, { tool: "assets.list", kind: "image" }) as unknown[]).length;
  // Two videos and no target named: this cannot be applied, and the folder has five pictures.
  await assert.rejects(tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "chat-story", expectedRevision: store.readEditor(id).revision,
    slots: { screenshots: { folder: screenshots } },
  }), /several videos/);
  const after = (await tools.executeEditorTool(id, { tool: "assets.list", kind: "image" }) as unknown[]).length;
  assert.equal(after, before, "nothing was imported on behalf of a request that was refused");
});

test("a suggestion counts the folder the same way the dry run does", async () => {
  const { id, sequenceId } = await projectWithScript();
  const sparse = path.join(workspace, "one-shot");
  await fs.mkdir(sparse, { recursive: true });
  assert.equal(spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=red:size=300x400", "-frames:v", "1", path.join(sparse, "only.png")], { encoding: "utf8" }).status, 0);
  const { suggestions } = await tools.executeEditorTool(id, {
    tool: "templates.suggest", sequenceId, slots: { screenshots: { folder: sparse } },
  }) as { suggestions: import("../src/lib/templates/suggest").TemplateSuggestion[] };
  const chat = suggestions.find(s => s.templateId === "chat-story")!;
  assert.ok(chat.expectedImages > 1, `chat-story should want more than the one picture supplied, wanted ${chat.expectedImages}`);
  assert.ok(chat.why.some(w => /only 1 were supplied/.test(w)),
    `the suggestion should carry the dry run's shortfall warning, got ${JSON.stringify(chat.why)}`);
});


test("ordinary words that spell a brand when glued together are not that brand", async () => {
  const { brandsInText } = await import("../src/lib/search/brand");
  const slugs = async (text: string, casing: "mixed" | "lower" | "upper" = "mixed") =>
    (await brandsInText(text, { casing })).map(b => b.brand.slug);
  // A one-word brand cannot be claimed by a two-word phrase, in any casing.
  assert.deepEqual(await slugs("i moved next door last week", "lower"), []);
  assert.deepEqual(await slugs("I moved Next Door last week"), []);
  // A sentence-initial capital is grammar, not a name: "Go" and "Meta" are ordinary words there.
  assert.deepEqual(await slugs("Go to the store and buy milk."), []);
  assert.deepEqual(await slugs("Meta question for you here."), []);
  // The same words mid-sentence, capitalised, are the company.
  assert.deepEqual(await slugs("We compared it with Google Drive yesterday."), ["googledrive"]);
  assert.deepEqual(await slugs("Both Google and Facebook shipped it."), ["google", "facebook"]);
});

test("a brand whose own colour is white is drawn dark, so it reads on the plate", async () => {
  const { legibleHex, brandHit } = await import("../src/lib/search/brand");
  assert.equal(legibleHex("FFFFFF"), "111111");
  assert.equal(legibleHex("F5F5F5"), "111111");
  assert.equal(legibleHex("4285F4"), "4285F4", "a saturated colour is left alone");
  assert.equal(legibleHex("000000"), "000000");
  assert.equal(legibleHex("not-hex"), "000000");
  assert.match(brandHit({ title: "Sony", slug: "sony", hex: "FFFFFF", aliases: [] }).url, /\/sony\/111111$/);
});

test("a picture already in the project is matched by whole words, never by a fragment", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  // "train-station" contains the letters "ai"; it is not a picture of AI.
  for (const name of ["train-station.png", "logo.png"]) {
    const file = path.join(workspace, name);
    assert.equal(spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=gray:size=200x200", "-frames:v", "1", file], { encoding: "utf8" }).status, 0);
    await tools.executeEditorTool(id, { tool: "assets.importLocal", file });
  }
  const spoken = speak(["AI changed how Go works at Google.", "Nothing else here names a thing."], 0.8);
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [{
    type: "item.patch", sequenceId, itemId, patch: { start: 0, end: 12, words: spoken },
  }] });
  const applied = await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    overrides: { images: { sources: ["project"], mode: "every", minSentenceGap: 0, minGapSec: 0 } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  const shot = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!.items.find(i => i.id === itemId)!;
  const used = shot.clip.edits.filter((e): e is Extract<typeof e, { type: "image" }> => e.type === "image").map(e => database.q.getAsset(e.src)!.name);
  assert.ok(!used.includes("train-station.png"), `"AI" matched the train photo: ${used}`);
  assert.ok(!used.includes("logo.png"), `"Go" matched logo.png: ${used}`);
  assert.ok(applied.applied.dropped.some(d => d.attempts.some(a => a.source === "project" && a.outcome === "empty")));
});

test("a template layer someone has moved survives a re-apply, and is not duplicated", async () => {
  const { id, sequenceId } = await projectWithScript();
  const logo = await tools.executeEditorTool(id, { tool: "assets.importLocal", file: path.join(screenshots, "shot-1.png") }) as { id: string };
  const apply = () => tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "brand-explainer", sequenceId,
    expectedRevision: store.readEditor(id).revision, overrides: { images: { mode: "off" } }, slots: { logo: { assetId: logo.id } },
  });
  await apply();
  let sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const mark = sequence.items.find(i => i.clip.title === "Watermark")!;
  // The person drags the mark to the top-left and fades it.
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [
    { type: "item.place", sequenceId, itemId: mark.id, patch: { transform: { x: 3, y: 3, opacity: 0.5 } } },
  ] });
  await apply();
  sequence = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!;
  const marks = sequence.items.filter(i => i.clip.title === "Watermark");
  assert.equal(marks.length, 1, "the template must not put a second mark back in the corner");
  assert.equal(marks[0].id, mark.id, "the moved layer is the one that survived");
  assert.equal(marks[0].transform?.x, 3);
  assert.equal(marks[0].transform?.opacity, 0.5);
  // A layer left where the template put it is still the template's to replace.
  const hook = sequence.items.find(i => i.clip.title === "Hook")!;
  await apply();
  const hooks = store.readEditor(id).edl.sequences.find(s => s.id === sequenceId)!.items.filter(i => i.clip.title === "Hook");
  assert.equal(hooks.length, 1);
  assert.notEqual(hooks[0].id, hook.id, "an untouched hook was replaced, as before");
});

test("a folder pool imports only the pictures it hands out", async () => {
  const { id, sequenceId } = await projectWithScript();
  const before = (await tools.executeEditorTool(id, { tool: "assets.list", kind: "image" }) as unknown[]).length;
  // The folder holds five; a sparse template consumes fewer than that.
  const applied = await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "explainer-broll", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    overrides: { images: { sources: ["slot"], mode: "auto", density: 0.3, maxCount: 2 } },
    slots: { screenshots: { folder: screenshots } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  const after = (await tools.executeEditorTool(id, { tool: "assets.list", kind: "image" }) as unknown[]).length;
  assert.ok(applied.applied.placed >= 1 && applied.applied.placed < 5);
  assert.equal(after - before, applied.applied.placed, `imported ${after - before} pictures for ${applied.applied.placed} beats`);
});

test("one brand named many times is fetched once", async () => {
  const { id, sequenceId, itemId } = await projectWithScript();
  // The brand branch is reached through a project asset named after the brand, so this
  // needs no network; the cache is what is under test.
  const file = path.join(workspace, "Google logo.png");
  assert.equal(spawnSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=white:size=256x256", "-frames:v", "1", file], { encoding: "utf8" }).status, 0);
  await tools.executeEditorTool(id, { tool: "assets.importLocal", file });
  const spoken = speak(["Google did this.", "Google did that.", "Google did the other.", "Google did more."], 0.8);
  store.editProject(id, { expectedRevision: store.readEditor(id).revision, operations: [{
    type: "item.patch", sequenceId, itemId, patch: { start: 0, end: 14, words: spoken },
  }] });
  const before = (await tools.executeEditorTool(id, { tool: "assets.list", kind: "image" }) as unknown[]).length;
  const applied = await tools.executeEditorTool(id, {
    tool: "template.apply", templateId: "brand-explainer", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    overrides: { images: { sources: ["project"], mode: "every", minSentenceGap: 0, minGapSec: 0 } },
  }) as import("../src/lib/templates/apply").TemplateApplyResult;
  const after = (await tools.executeEditorTool(id, { tool: "assets.list", kind: "image" }) as unknown[]).length;
  assert.equal(applied.applied.placed, 4);
  assert.equal(after, before, "four beats of one brand must not create four assets");
});

test("a download that is not an image is refused, not saved as one", async () => {
  const { adoptHit } = await import("../src/lib/search");
  const http = await import("node:http");
  const server = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>hotlink blocked</html>"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const { id } = await projectWithScript();
  try {
    await assert.rejects(adoptHit({
      provider: "google", id: "x", title: "x", url: `http://127.0.0.1:${port}/photo.jpg`, thumbUrl: "", pageUrl: "",
      license: "Unverified web result", width: 800, height: 600, relevance: 1,
    }, id), /not an image/);
  } finally { server.close(); }
});

test("re-ticking a picture source restores the template's order rather than appending", async () => {
  // The panel's rule, stated as data: the template's order is the order.
  const template = await registry.getTemplate("explainer-broll");
  const order = template.images.sources;
  assert.deepEqual(order, ["slot", "brand", "project", "web"]);
  const without = order.filter(s => s.split(":")[0] !== "slot");
  const chosen = new Set(without.map(s => s.split(":")[0]));
  const restored = order.filter(s => s === "slot" || chosen.has(s.split(":")[0]));
  assert.deepEqual(restored, order, "slot must come back first, where the template put it, not last");
});

test("a template places its sounds as ordinary sfx layers, and one switch turns all of them off", async () => {
  const { installStarterSounds } = await import("../src/lib/assets");
  await installStarterSounds();
  const sound = database.q.listAssets("audio").find(a => a.name === "Whoosh")!;
  assert.ok(sound, "the starter sounds are available offline");

  // Two shots, so there is a cut between them for a transition to land on.
  const { id } = await mediaService.createVideoProject("Sounded", [{ file: source }, { file: source }]);
  let snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  snapshot = store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.patch", sequenceId: sequence.id, itemId: sequence.items[0].id,
      patch: { title: "Ranking", hook: "How ranking really works", start: 0, end: 20, words: speak(SCRIPT) } },
  ] });

  const sounded = {
    rhythm: { punch: { sfx: { enabled: true, assetId: sound.id } } },
    sound: { transitions: { enabled: true, assetId: sound.id }, opener: { enabled: true, assetId: sound.id } },
  };
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "talking-head", sequenceId: sequence.id,
    expectedRevision: snapshot.revision, overrides: sounded });

  const after = store.readEditor(id).edl.sequences.find(s => s.id === sequence.id)!;
  const opener = after.items.find(i => i.clip.title === "Opener")!;
  const transitions = after.items.find(i => i.clip.title === "Transitions")!;
  assert.ok(opener && transitions, after.items.map(i => i.clip.title).join(", "));
  assert.ok(opener.clip.edits.every(e => e.type === "sfx" && e.src === sound.id));
  assert.equal(opener.clip.edits[0].t, 0);
  assert.ok(transitions.clip.edits.length >= 1, "the cut between the two shots gets a sting");
  assert.ok(transitions.clip.edits.every(e => e.t > 0), "nothing is stacked on the first frame");
  assert.ok(after.items.find(i => i.id === sequence.items[0].id)!.clip.edits.some(e => e.type === "sfx"), "punch-ins get their sound");
  assert.ok([...opener.clip.edits, ...transitions.clip.edits].every(e => e.by === "template:talking-head"), "they are the template's, so re-applying replaces them");

  // Off means off: the same template, the same sounds configured, and silence.
  const { id: quiet } = await mediaService.createVideoProject("Quiet", [{ file: source }, { file: source }]);
  let quietSnapshot = store.readEditor(quiet);
  const quietSequence = quietSnapshot.edl.sequences[0];
  quietSnapshot = store.editProject(quiet, { expectedRevision: quietSnapshot.revision, operations: [
    { type: "item.patch", sequenceId: quietSequence.id, itemId: quietSequence.items[0].id,
      patch: { title: "Ranking", start: 0, end: 20, words: speak(SCRIPT) } },
  ] });
  await tools.executeEditorTool(quiet, { tool: "template.apply", templateId: "talking-head", sequenceId: quietSequence.id,
    expectedRevision: quietSnapshot.revision, overrides: { ...sounded, sound: { ...sounded.sound, mode: "off" } } });
  const silent = store.readEditor(quiet).edl.sequences.find(s => s.id === quietSequence.id)!;
  assert.equal(silent.items.filter(i => ["Opener", "Transitions", "Music bed"].includes(i.clip.title)).length, 0);
  assert.ok(silent.items.every(i => i.clip.edits.every(e => e.type !== "sfx" && e.type !== "music")), "no sound of any kind");
});

test("a built-in template arrives with its sound working, offline, without naming an asset id", async () => {
  // Asset ids are generated per machine, so a shipped template cannot contain one. It
  // names the sound instead, and the sounds that ship with the app answer to that name.
  const { id } = await mediaService.createVideoProject("Sounded by default", [{ file: source }, { file: source }]);
  let snapshot = store.readEditor(id);
  const sequence = snapshot.edl.sequences[0];
  snapshot = store.editProject(id, { expectedRevision: snapshot.revision, operations: [
    { type: "item.patch", sequenceId: sequence.id, itemId: sequence.items[0].id,
      patch: { title: "Ranking", hook: "How ranking really works", start: 0, end: 20, words: speak(SCRIPT) } },
  ] });

  // No slots at all: everything this places, it found on this machine.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "fast-cuts", sequenceId: sequence.id,
    expectedRevision: snapshot.revision, overrides: { images: { mode: "off" } } });

  const after = store.readEditor(id).edl.sequences.find(s => s.id === sequence.id)!;
  const named = (itemTitle: string) => {
    const item = after.items.find(i => i.clip.title === itemTitle);
    const src = item?.clip.edits.find(e => e.type === "sfx")?.src ?? "";
    return database.q.getAsset(src)?.name ?? null;
  };
  assert.equal(named("Opener"), "Riser", "the opening sound came from the app's own sounds");
  assert.equal(named("Transitions"), "Swipe", "so did the sting on the cut between the two shots");
  const punches = after.items.find(i => i.id === sequence.items[0].id)!.clip.edits.filter(e => e.type === "sfx");
  assert.ok(punches.length > 0, "every punch-in got its whoosh");
  assert.equal(database.q.getAsset(punches[0].src)?.name, "Whoosh");
  assert.ok(database.q.getAsset(punches[0].src)?.license === null, "a synthesised sound carries no licence to credit");
});

test("the home screen can list templates before a project exists", async () => {
  // The project-scoped tool cannot answer this: on the home screen there is no project
  // yet, and the template is chosen before there is one.
  const { GET } = await import("../src/app/api/templates/route");
  const response = await GET();
  assert.equal(response.status, 200);
  const { templates } = await response.json() as { templates: Array<{ id: string; name: string; description: string; builtin: boolean }> };
  const registry = await tools.executeEditorTool((await mediaService.createVideoProject("Listing")).id, { tool: "templates.list" }) as Array<{ id: string }>;
  assert.deepEqual(templates.map(t => t.id).sort(), registry.map(t => t.id).sort(), "the same registry, seen without a project");
  assert.ok(templates.every(t => t.name && t.description), "a picker needs a name and a line about it");
  assert.ok(templates.some(t => t.id === "fast-cuts" && t.builtin));
});
