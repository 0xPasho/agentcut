import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

let workspace: string;
let source: string;
let sting: string;
let store: typeof import("../src/lib/editor/store");
let mediaService: typeof import("../src/lib/editor/media");
let tools: typeof import("../src/lib/editor/tools");
let database: typeof import("../src/lib/db");
let assets: typeof import("../src/lib/assets");
let registry: typeof import("../src/lib/templates/registry");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-libvideo-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [store, mediaService, tools, database, assets, registry] = await Promise.all([
    import("../src/lib/editor/store"), import("../src/lib/editor/media"), import("../src/lib/editor/tools"), import("../src/lib/db"), import("../src/lib/assets"), import("../src/lib/templates/registry"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([]));
  await brandIndex();
  const make = (file: string, colour: string, seconds: number) => {
    const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${colour}:size=320x180:rate=15:duration=${seconds}`, "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-pix_fmt", "yuv420p", "-shortest", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  source = path.join(workspace, "source.mp4"); make(source, "navy", 10);
  sting = path.join(workspace, "sting.mp4"); make(sting, "orange", 2);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("the library holds video: uploaded, scanned from the folder, listed by kind, with its duration", async () => {
  const uploaded = await assets.uploadLibraryAsset("sting.mp4", await fs.readFile(sting));
  assert.equal(uploaded.kind, "video");
  assert.equal(uploaded.scope, "library");
  assert.ok(uploaded.duration_sec && Math.abs(uploaded.duration_sec - 2) < 0.2, `duration ${uploaded.duration_sec}`);
  assert.equal(uploaded.width, 320);
  assert.ok(assets.toAbs(uploaded.path).startsWith(path.join(workspace, "library", "video")), uploaded.path);
  await fs.copyFile(source, path.join(workspace, "library", "video", "dropped.mp4"));
  assert.equal(await assets.scanLibrary(), 1);
  const listed = database.q.listAssets("video");
  assert.deepEqual(listed.map((a) => a.name).sort(), ["dropped.mp4", "sting.mp4"]);
  assert.equal(assets.kindFor("x.MOV"), "video");
  assert.equal(assets.kindFor("x.txt"), null);
});

test("media.import takes a library video by asset id and can place it as a shot in the same revision, without duplicating media", async () => {
  const { id } = await mediaService.createVideoProject("Uses library", [{ file: source }]);
  const start = store.readEditor(id);
  const sequenceId = start.edl.sequences[0].id;
  const stingAsset = database.q.listAssets("video").find((a) => a.name === "sting.mp4")!;
  const placed = await tools.executeEditorTool(id, { tool: "media.import", file: stingAsset.id, expectedRevision: start.revision, place: { sequenceId, at: null, layer: 0 } }) as { revision: number; edl: typeof start.edl };
  assert.equal(placed.edl.media.length, 2, "the library video is project media now");
  const media = placed.edl.media[1];
  assert.equal(media.file, assets.toAbs(stingAsset.path), "referenced in the workspace, not copied again");
  const items = placed.edl.sequences[0].items;
  assert.equal(items.length, 2);
  assert.equal(items[1].mediaId, media.id);
  assert.ok(Math.abs(items[1].clip.end - 2) < 0.2);
  const again = await tools.executeEditorTool(id, { tool: "media.import", file: stingAsset.id, expectedRevision: placed.revision, place: { sequenceId, at: 0, layer: 1 } }) as { edl: typeof start.edl };
  assert.equal(again.edl.media.length, 2, "the same library video used twice is one media entry");
  assert.equal(again.edl.sequences[0].items.length, 3);
  await assert.rejects(tools.executeEditorTool(id, { tool: "media.import", file: "a_nope", expectedRevision: placed.revision + 1 }), /not found|ENOENT|no such/i);
});

test("a template outro can be a library video: it becomes media and a shot at the end, marked as the template's, and converges", async () => {
  const { id } = await mediaService.createVideoProject("Outro", [{ file: source }]);
  const start = store.readEditor(id);
  const sequenceId = start.edl.sequences[0].id;
  const stingAsset = database.q.listAssets("video").find((a) => a.name === "sting.mp4")!;
  await registry.saveTemplate({ id: "stung", extends: "talking-head", name: "Stung", outro: { enabled: true, assetId: stingAsset.id } });
  const first = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stung", sequenceId, expectedRevision: start.revision }) as { revision: number };
  let edl = store.readEditor(id).edl;
  assert.equal(edl.media.length, 2);
  const outro = edl.sequences[0].items.find((i) => i.clip.title === "Outro")!;
  assert.ok(outro, "an outro shot exists");
  assert.equal(outro.mediaId, edl.media[1].id);
  assert.equal(outro.clip.reason, "template:stung");
  assert.ok(Math.abs(outro.clip.end - 2) < 0.2, "a video outro plays whole");
  const main = edl.sequences[0].items.filter((i) => (i.layer ?? 0) === 0).map((i) => i.clip.title);
  assert.deepEqual(main, ["source.mp4", "Outro"]);
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "stung", sequenceId, expectedRevision: first.revision });
  edl = store.readEditor(id).edl;
  assert.equal(edl.sequences[0].items.filter((i) => i.clip.title === "Outro").length, 1, "re-applying replaces the outro rather than stacking it");
  assert.equal(edl.media.length, 2, "and adds no second media entry");
  // A rule can ask for the same thing through overrides: the "add an asset at the end" action is an outro.
  const { saveRule } = await import("../src/lib/rules/registry");
  await saveRule({ id: "stream-sting", name: "Stream sting", when: "the clip is from a stream", then: { overrides: { outro: { enabled: true, assetId: stingAsset.id } } } });
  const { applyRules } = await import("../src/lib/rules/apply");
  const { id: other } = await mediaService.createVideoProject("Ruled", [{ file: source }]);
  const result = await applyRules(other, { ruleIds: ["stream-sting"], sequenceId: store.readEditor(other).edl.sequences[0].id, templateId: "talking-head" }, store.readEditor(other).revision);
  assert.ok(result.applied);
  assert.ok(store.readEditor(other).edl.sequences[0].items.some((i) => i.clip.title === "Outro" && i.mediaId), "the rule placed the sting");
});

test("a shared template ends on *your* card: a video slot, filled by a rule, refused when it is missing", async () => {
  const second = path.join(workspace, "sting-b.mp4");
  const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=green:size=320x180:rate=15:duration=3", "-f", "lavfi", "-i", "sine=frequency=200:duration=3", "-pix_fmt", "yuv420p", "-shortest", second], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const mine = await assets.uploadLibraryAsset("my-card.mp4", await fs.readFile(sting));
  const theirs = await assets.uploadLibraryAsset("their-card.mp4", await fs.readFile(second));

  // The template names no asset at all — it is the shape of the video, not the content.
  await registry.saveTemplate({
    id: "channel-look", extends: "talking-head", name: "Channel look",
    outro: { enabled: true, slot: "endcard" },
    slots: [{ id: "endcard", label: "Your end card", kind: "video", required: true }],
  });

  const { id } = await mediaService.createVideoProject("Slotted", [{ file: source }]);
  const sequenceId = store.readEditor(id).edl.sequences[0].id;
  await assert.rejects(
    tools.executeEditorTool(id, { tool: "template.apply", templateId: "channel-look", sequenceId, expectedRevision: store.readEditor(id).revision }),
    /Your end card/,
    "a required slot is a refusal, not a video that quietly ends early",
  );

  const { saveRule } = await import("../src/lib/rules/registry");
  const { applyRules, resolveRules } = await import("../src/lib/rules/apply");
  const { listRules } = await import("../src/lib/rules/registry");
  await saveRule({ id: "my-end-card", name: "My end card", when: "always", priority: 20,
    then: { template: "channel-look", slots: { endcard: { assetId: mine.id } } } });

  const applied = await applyRules(id, { ruleIds: ["my-end-card"], sequenceId }, store.readEditor(id).revision);
  assert.ok(applied.applied, "the rule filled the slot the template declared");
  let edl = store.readEditor(id).edl;
  const card = edl.sequences[0].items.find((i) => i.clip.title === "Outro")!;
  assert.ok(card, "the end card is on the timeline");
  assert.equal(edl.media.find((m) => m.id === card.mediaId)!.file, assets.toAbs(mine.path), "and it is mine, not the template author's");
  assert.ok(Math.abs(card.clip.end - 2) < 0.2, "played whole");

  // The caller is more specific than the rule that suggested a default.
  const over = await applyRules(id, { ruleIds: ["my-end-card"], sequenceId, slots: { endcard: { assetId: theirs.id } } }, store.readEditor(id).revision);
  assert.ok(over.applied);
  edl = store.readEditor(id).edl;
  const swapped = edl.sequences[0].items.find((i) => i.clip.title === "Outro")!;
  assert.equal(edl.media.find((m) => m.id === swapped.mediaId)!.file, assets.toAbs(theirs.path), "the request's slot wins over the rule's");
  assert.equal(edl.sequences[0].items.filter((i) => i.clip.title === "Outro").length, 1, "and replaces rather than stacking");

  // Two rules naming the same slot: the higher-priority one runs first and the later replaces it whole.
  await saveRule({ id: "their-end-card", name: "Their end card", when: "always", priority: 90, then: { slots: { endcard: { assetId: theirs.id } } } });
  const rules = await listRules(id);
  const resolved = resolveRules(rules.filter((rule) => ["my-end-card", "their-end-card"].includes(rule.id)));
  assert.deepEqual(resolved.slots, { endcard: { assetId: theirs.id } });
  assert.equal(resolved.templateId, "channel-look", "the template still comes from the first rule that names one");

  // A rule that only fills a slot still changes the timeline, so it is not treated as prompt-only.
  const { id: bare } = await mediaService.createVideoProject("Bare", [{ file: source }]);
  const bareSeq = store.readEditor(bare).edl.sequences[0].id;
  const onlySlots = await applyRules(bare, { ruleIds: ["their-end-card"], sequenceId: bareSeq, templateId: "channel-look" }, store.readEditor(bare).revision);
  assert.ok(onlySlots.applied, "a slot-only rule is an edit, not a constraint sentence");
  assert.ok(store.readEditor(bare).edl.sequences[0].items.some((i) => i.clip.title === "Outro"));
});

test("the end card is the end: the hook, the card and the mark hold across the body and stop where it begins", async () => {
  const logo = path.join(workspace, "mark.png");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0xF032E6:size=64x64", "-frames:v", "1", logo], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const mark = await assets.uploadLibraryAsset("mark.png", await fs.readFile(logo));
  const music = path.join(workspace, "bed.mp3");
  const bed = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "sine=frequency=180:duration=4", music], { encoding: "utf8" });
  assert.equal(bed.status, 0, bed.stderr);
  const bedAsset = await assets.uploadLibraryAsset("bed.mp3", await fs.readFile(music));
  const card = database.q.listAssets("video").find((a) => a.name === "sting.mp4")!;

  await registry.saveTemplate({
    id: "bookended", extends: "talking-head", name: "Bookended",
    hook: { mode: "sticky", text: "Sticky hook" },
    cards: [{ id: "cta", atFraction: 1, text: "Follow", seconds: 1.5, position: "center" }],
    watermark: { enabled: true, slot: "mark", widthPct: 12 },
    music: { enabled: true, slot: "bed" },
    intro: { enabled: true, slot: "card" },
    outro: { enabled: true, slot: "card" },
    slots: [
      { id: "card", label: "Card", kind: "video" },
      { id: "mark", label: "Mark", kind: "image" },
      { id: "bed", label: "Bed", kind: "audio" },
    ],
  });

  const { id } = await mediaService.createVideoProject("Bookended", [{ file: source }]);
  const sequenceId = store.readEditor(id).edl.sequences[0].id;
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "bookended", sequenceId,
    expectedRevision: store.readEditor(id).revision,
    slots: { card: { assetId: card.id }, mark: { assetId: mark.id }, bed: { assetId: bedAsset.id } } });

  const { sequenceFrames } = await import("../src/lib/sequences");
  const sequence = store.readEditor(id).edl.sequences.find((s) => s.id === sequenceId)!;
  const frames = sequenceFrames(sequence);
  const fps = sequence.output.fps;
  const at = (title: string) => {
    const found = frames.items.find((entry) => entry.item.clip.title === title);
    assert.ok(found, `${title} is on the timeline`);
    return { from: found!.from / fps, to: (found!.from + found!.duration) / fps };
  };
  const intro = at("Intro"), outro = at("Outro"), hook = at("Hook"), cta = at("Card: cta"), watermark = at("Watermark"), bedItem = at("Music bed");

  assert.ok(Math.abs(intro.from) < 0.01, "the intro opens the video");
  assert.ok(Math.abs(hook.from - intro.to) < 0.05, `the hook starts when the intro ends, saw ${hook.from} vs ${intro.to}`);
  assert.ok(Math.abs(hook.to - outro.from) < 0.05, `the hook ends where the end card starts, saw ${hook.to} vs ${outro.from}`);
  assert.ok(cta.to <= outro.from + 0.05, `a card at the end lands before the end card, not on it: ${cta.to} vs ${outro.from}`);
  assert.ok(Math.abs(watermark.from - intro.to) < 0.05 && Math.abs(watermark.to - outro.from) < 0.05, "the corner mark holds across the body only");
  assert.ok(Math.abs(bedItem.from) < 0.01, "the bed plays under the intro too");
  assert.ok(Math.abs(bedItem.to - outro.from) < 0.05, `the bed stops at the end card, which has its own sound: ${bedItem.to} vs ${outro.from}`);
});

test("an end card arrives at the loudness of the video it is stuck on, unless it is told not to", async () => {
  const make = (file: string, colour: string, gain: number) => {
    const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", `color=${colour}:size=320x180:rate=15:duration=6`,
      "-f", "lavfi", "-i", "sine=frequency=300:duration=6", "-af", `volume=${gain}`, "-pix_fmt", "yuv420p", "-shortest", "-c:a", "aac", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  const quiet = path.join(workspace, "quiet-source.mp4"); make(quiet, "navy", 0.08);
  const loudCard = path.join(workspace, "loud-card.mp4"); make(loudCard, "red", 0.5);
  const card = await assets.uploadLibraryAsset("loud-card.mp4", await fs.readFile(loudCard));

  const { loudness } = await import("../src/lib/media");
  const cardLufs = await loudness(assets.toAbs(card.path));
  const bodyLufs = await loudness(quiet);
  assert.ok(cardLufs !== null && bodyLufs !== null && cardLufs - bodyLufs > 5, `the card is the louder of the two: ${cardLufs} vs ${bodyLufs}`);

  await registry.saveTemplate({ id: "levelled", extends: "talking-head", name: "Levelled", outro: { enabled: true, assetId: card.id } });
  const { id } = await mediaService.createVideoProject("Levelled", [{ file: quiet }]);
  const sequenceId = store.readEditor(id).edl.sequences[0].id;
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "levelled", sequenceId, expectedRevision: store.readEditor(id).revision });
  const outro = store.readEditor(id).edl.sequences[0].items.find((i) => i.clip.title === "Outro")!;
  assert.ok(outro.volume !== undefined && outro.volume < 1, `the card is turned down to meet the video: ${outro.volume}`);
  const wanted = 10 ** ((bodyLufs! - cardLufs!) / 20);
  assert.ok(Math.abs(outro.volume! - wanted) < 0.05, `${outro.volume} should be about ${wanted.toFixed(3)}`);

  // Re-applying does not stack a second adjustment on the first.
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "levelled", sequenceId, expectedRevision: store.readEditor(id).revision });
  const again = store.readEditor(id).edl.sequences[0].items.find((i) => i.clip.title === "Outro")!;
  assert.ok(Math.abs(again.volume! - outro.volume!) < 0.001, "the same card, the same level");

  // A card mixed on purpose is left exactly as it was mixed.
  await registry.saveTemplate({ id: "as-is", extends: "talking-head", name: "As is", outro: { enabled: true, assetId: card.id, level: "as-is" } });
  const { id: other } = await mediaService.createVideoProject("As is", [{ file: quiet }]);
  const otherSeq = store.readEditor(other).edl.sequences[0].id;
  await tools.executeEditorTool(other, { tool: "template.apply", templateId: "as-is", sequenceId: otherSeq, expectedRevision: store.readEditor(other).revision });
  assert.equal(store.readEditor(other).edl.sequences[0].items.find((i) => i.clip.title === "Outro")!.volume, undefined);

  // Two things already at the same loudness are left alone rather than nudged.
  const same = path.join(workspace, "same-card.mp4"); make(same, "green", 0.08);
  const sameCard = await assets.uploadLibraryAsset("same-card.mp4", await fs.readFile(same));
  await registry.saveTemplate({ id: "same-level", extends: "talking-head", name: "Same", outro: { enabled: true, assetId: sameCard.id } });
  const { id: third } = await mediaService.createVideoProject("Same", [{ file: quiet }]);
  const thirdSeq = store.readEditor(third).edl.sequences[0].id;
  await tools.executeEditorTool(third, { tool: "template.apply", templateId: "same-level", sequenceId: thirdSeq, expectedRevision: store.readEditor(third).revision });
  assert.equal(store.readEditor(third).edl.sequences[0].items.find((i) => i.clip.title === "Outro")!.volume, undefined);
});
