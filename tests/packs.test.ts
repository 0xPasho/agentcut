import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "../src/lib/bin";

let workspace: string;
let database: typeof import("../src/lib/db");
let packs: typeof import("../src/lib/packs");
let registry: typeof import("../src/lib/templates/registry");
let rules: typeof import("../src/lib/rules/registry");
let assets: typeof import("../src/lib/assets");
let glossary: typeof import("../src/lib/glossary");
let tools: typeof import("../src/lib/editor/tools");
let mediaService: typeof import("../src/lib/editor/media");
let store: typeof import("../src/lib/editor/store");
let source: string;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-packs-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [database, packs, registry, rules, assets, glossary, tools, mediaService, store] = await Promise.all([
    import("../src/lib/db"), import("../src/lib/packs"), import("../src/lib/templates/registry"), import("../src/lib/rules/registry"), import("../src/lib/assets"),
    import("../src/lib/glossary"), import("../src/lib/editor/tools"), import("../src/lib/editor/media"), import("../src/lib/editor/store"),
  ]);
  const { resetBrandIndex, brandIndex } = await import("../src/lib/search/brand");
  resetBrandIndex();
  await fs.mkdir(path.join(workspace, "cache"), { recursive: true });
  await fs.writeFile(path.join(workspace, "cache", "brands.json"), JSON.stringify([]));
  await brandIndex();
  source = path.join(workspace, "source.mp4");
  const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=navy:size=320x180:rate=15:duration=8", "-f", "lavfi", "-i", "sine=frequency=300:duration=8", "-pix_fmt", "yuv420p", "-shortest", source], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
after(async () => { database.db.close(); await fs.rm(workspace, { recursive: true, force: true }); });

test("a pack is exported from the workspace with its templates, rules, glossary and assets, and inspected before anything is installed", async () => {
  const logo = path.join(workspace, "logo.png");
  const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=red:size=64x64", "-frames:v", "1", logo], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const mark = await assets.uploadLibraryAsset("mark.png", await fs.readFile(logo));
  await registry.saveTemplate({ id: "stream-look", extends: "talking-head", name: "Stream look", watermark: { enabled: true, assetId: mark.id } });
  await fs.mkdir(path.join(workspace, "rules"), { recursive: true });
  await fs.writeFile(path.join(workspace, "rules", "gaming.md"), "Keep the HUD visible.\n");
  await rules.saveRule({ id: "gaming", name: "Gaming", when: "the clip is gameplay", then: { template: "stream-look", promptFile: "gaming.md" } });
  await glossary.saveGlossary({ terms: [{ term: "Deska", aliases: ["desk app"], note: "" }] });
  const exported = await packs.exportPack({ id: "streamer-kit", name: "Streamer kit", author: "tests", templates: ["stream-look"], rules: ["gaming"], glossary: true, assetIds: [mark.id], quickActions: [{ label: "Stream recap", text: "Cut {selection} into a recap." }] });
  const files = (await fs.readdir(exported.dir, { recursive: true })).map(String).sort();
  assert.deepEqual(files, ["assets", `assets/${mark.id}.png`, "pack.json", "rules", "rules/gaming.json", "rules/gaming.md", "templates", "templates/stream-look.json"]);
  const stored = JSON.parse(await fs.readFile(path.join(exported.dir, "templates", "stream-look.json"), "utf8"));
  assert.equal(stored.extends, "talking-head", "a sparse template travels sparse");
  assert.equal(exported.manifest.assets[0].id, mark.id);

  // A fresh workspace sees it as untrusted text to read before installing.
  const preview = await packs.inspectPack(exported.dir);
  assert.equal(preview.untrusted, true);
  assert.deepEqual(preview.rules.map((x) => [x.id, x.prompt]), [["gaming", "Keep the HUD visible.\n"]]);
  assert.equal(preview.templates[0].exists, true, "this workspace already has the template it exported");
  assert.equal(preview.quickActions[0].label, "Stream recap");
  assert.match(preview.hash, /^[a-f0-9]{64}$/);
  await assert.rejects(packs.inspectPack(path.join(workspace, "nowhere")), /Not found/);
  await fs.writeFile(path.join(exported.dir, "pack.json"), JSON.stringify({ ...exported.manifest, rules: ["../../../preferences"] }));
  try { await assert.rejects(packs.inspectPack(exported.dir), /escapes the pack/); }
  finally { await fs.writeFile(path.join(exported.dir, "pack.json"), JSON.stringify(exported.manifest)); }
});

test("installing from a URL copies everything in, remaps asset ids, records the origin, and can be removed", async () => {
  const dir = path.join(workspace, "exports", "packs", "streamer-kit");
  // Simulate another machine: drop the workspace copies the pack would bring.
  await registry.deleteTemplate("stream-look");
  await rules.deleteRule("gaming");
  const oldMark = database.q.listAssets("image").find((a) => a.name === "mark.png")!;
  database.q.deleteAsset(oldMark.id);
  await fs.rm(assets.toAbs(oldMark.path), { force: true });
  await glossary.saveGlossary({ terms: [] }, "workspace");

  const server = http.createServer(async (req, res) => {
    try {
      const target = path.join(dir, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
      res.end(await fs.readFile(target));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const url = `http://127.0.0.1:${port}/pack.json`;
    const installed = await tools.executeEditorTool((await mediaService.createVideoProject("P", [{ file: source }])).id, { tool: "packs.import", source: url }) as import("../src/lib/packs/schema").InstalledPack;
    assert.equal(installed.id, "streamer-kit");
    assert.equal(installed.source, url);
    assert.deepEqual(installed.templates, ["stream-look"]);
    assert.deepEqual(installed.rules, ["gaming"]);
    assert.deepEqual(installed.glossary, ["Deska"]);
    const newMark = database.q.listAssets("image").find((a) => a.name === "mark.png")!;
    assert.ok(newMark, "the asset landed in the library");
    assert.equal(newMark.source, "pack:streamer-kit");
    assert.equal(installed.assets[oldMark.id], newMark.id, "the pack's asset id maps to the new one");
    const template = await registry.getTemplate("stream-look");
    assert.equal(template.watermark.assetId, newMark.id, "the template now points at the installed asset");
    assert.equal(template.extends, "talking-head");
    const rule = await rules.getRule("gaming");
    assert.equal(rule.promptText, "Keep the HUD visible.\n");
    assert.ok((await glossary.readGlossary()).terms.some((t) => t.term === "Deska"));
    assert.deepEqual((await packs.packQuickActions()).map((a) => a.label), ["Stream recap"]);
    assert.equal((await packs.listPacks()).length, 1);

    // A second install keeps what is there unless told to replace; a removal takes templates and rules but leaves assets.
    await registry.saveTemplate({ id: "stream-look", extends: "talking-head", name: "Edited locally" });
    await packs.importPack(url);
    assert.equal((await registry.getTemplate("stream-look")).name, "Edited locally");
    await packs.importPack(url, { replace: true });
    assert.equal((await registry.getTemplate("stream-look")).name, "Stream look");
    await packs.removePack("streamer-kit");
    assert.equal((await packs.listPacks()).length, 0);
    await assert.rejects(registry.getTemplate("stream-look"));
    assert.ok(database.q.getAsset(newMark.id), "assets stay");
    await assert.rejects(packs.removePack("streamer-kit"), /No installed pack/);
  } finally { server.close(); }
});

test("a punch-in can carry a sound from an audio slot, placed on every punch and replaced on re-apply", async () => {
  const wav = path.join(workspace, "whoosh.wav");
  const r = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "sine=frequency=800:duration=1", wav], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const sound = await assets.uploadLibraryAsset("whoosh.wav", await fs.readFile(wav));
  await registry.saveTemplate({ id: "punchy", extends: "talking-head", name: "Punchy", rhythm: { punch: { enabled: true, perMinute: 12, sfx: { enabled: true, slot: "whoosh", gain: 0.5 } } }, slots: [{ id: "whoosh", label: "Punch sound", kind: "audio" }] });
  const { id } = await mediaService.createVideoProject("Punchy", [{ file: source }]);
  const start = store.readEditor(id);
  const sequenceId = start.edl.sequences[0].id;
  const itemId = start.edl.sequences[0].items[0].id;
  const words: Array<{ t: number; d: number; w: string }> = [];
  let t = 0;
  for (const sentence of ["Google changed everything this year.", "That is the part people miss.", "It took four years to ship it.", "And that is why it matters."]) { for (const w of sentence.split(" ")) { words.push({ t, d: 0.3, w }); t += 0.4; } t += 0.5; }
  store.editProject(id, { expectedRevision: start.revision, operations: [{ type: "item.patch", sequenceId, itemId, patch: { end: 8, words } }] });
  const first = await tools.executeEditorTool(id, { tool: "template.apply", templateId: "punchy", sequenceId, expectedRevision: store.readEditor(id).revision, slots: { whoosh: { assetId: sound.id } } }) as { revision: number; plan: { totals: { punches: number } } };
  assert.ok(first.plan.totals.punches >= 1, `punches planned: ${first.plan.totals.punches}`);
  let edits = store.readEditor(id).edl.sequences[0].items[0].clip.edits;
  const punches = edits.filter((e) => e.type === "punch"), sfx = edits.filter((e) => e.type === "sfx");
  assert.equal(sfx.length, punches.length, "one sound per punch-in");
  assert.deepEqual(sfx.map((e) => e.t), punches.map((e) => e.t));
  assert.ok(sfx.every((e) => (e as { src: string; gain: number; by: string }).src === sound.id && (e as { gain: number }).gain === 0.5 && e.by === "template:punchy"));
  await tools.executeEditorTool(id, { tool: "template.apply", templateId: "punchy", sequenceId, expectedRevision: first.revision, slots: { whoosh: { assetId: sound.id } } });
  edits = store.readEditor(id).edl.sequences[0].items[0].clip.edits;
  assert.equal(edits.filter((e) => e.type === "sfx").length, sfx.length, "re-applying replaces the sounds rather than stacking them");
  await assert.rejects(tools.executeEditorTool(id, { tool: "template.apply", templateId: "punchy", sequenceId, expectedRevision: store.readEditor(id).revision, slots: { whoosh: { assetId: "a_nope" } } }), /Punch sound/);
});

test("a kit travels whole: the end card, the template that has a slot for it, and the rule that fills it", async () => {
  const sting = path.join(workspace, "kit-card.mp4");
  const made = spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=0x20A040:size=240x426:rate=15:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=400:duration=3", "-pix_fmt", "yuv420p", "-shortest", sting], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const card = await assets.uploadLibraryAsset("kit-card.mp4", await fs.readFile(sting));

  // The template names no asset: it says a video belongs at the end, and which slot holds it.
  await registry.saveTemplate({
    id: "kit-short", extends: "stream-short", name: "Kit short",
    outro: { enabled: true, slot: "endcard" },
    slots: [{ id: "endcard", label: "Your end card", kind: "video" }],
  });
  await rules.saveRule({ id: "kit-outro", name: "Kit outro", when: "the clip is from a stream",
    then: { template: "kit-short", slots: { endcard: { assetId: card.id } } } });
  const exported = await packs.exportPack({ id: "stream-kit", name: "Stream kit", author: "tests",
    templates: ["kit-short"], rules: ["kit-outro"], assetIds: [card.id] });
  assert.ok(exported.manifest.assets.some((a) => a.kind === "video" && a.id === card.id), "the card travels with the pack");

  // Another machine: none of it exists here, and the asset will be given a different id.
  await registry.deleteTemplate("kit-short");
  await rules.deleteRule("kit-outro");
  database.q.deleteAsset(card.id);
  await fs.rm(assets.toAbs(card.path), { force: true });

  const installed = await packs.importPack(exported.dir);
  const landed = database.q.listAssets("video").find((a) => a.name === "kit-card.mp4")!;
  assert.ok(landed && landed.id !== card.id, "the same bytes, a different id on this machine");
  assert.equal(installed.assets[card.id], landed.id);
  const rule = await rules.getRule("kit-outro");
  assert.equal(rule.then.slots?.endcard.assetId, landed.id, "the rule points at this machine's copy");

  // And it edits: the rule chooses the template, fills its slot, and the card is on the timeline.
  const { id } = await mediaService.createVideoProject("Imported kit", [{ file: source }]);
  const sequenceId = store.readEditor(id).edl.sequences[0].id;
  const applied = await tools.executeEditorTool(id, { tool: "rules.apply", ruleIds: ["kit-outro"], sequenceId,
    expectedRevision: store.readEditor(id).revision }) as import("../src/lib/rules/apply").RuleApplyResult;
  assert.equal(applied.templateId, "kit-short");
  const edl = store.readEditor(id).edl;
  const outro = edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.clip.title === "Outro")!;
  assert.ok(outro, "the end card is the last shot");
  assert.equal(edl.media.find((m) => m.id === outro.mediaId)!.file, assets.toAbs(landed.path));
  const framed = edl.sequences.find((s) => s.id === sequenceId)!.items.find((i) => i.clip.title !== "Outro" && i.mediaId)!;
  assert.equal(framed.clip.layout.type, "split", "the framing came with the template it extends");
  await packs.removePack("stream-kit");
});
